/**
 * AI Visibility Probe — Phase 3 measurement engine.
 *
 * For each question in the battery, runs three paths:
 *   (a) GROUNDED   — reuses api/chat.js (live SDMX + Gemini grounded answer)
 *   (b) UNGROUNDED — plain Gemini with no OECD data injected
 *   (c) JUDGE      — Gemini scores the ungrounded answer against SDMX ground truth
 *
 * Results are appended to data/ai-visibility-log.json (rolling cap: 1000 entries).
 *
 * Usage:
 *   node --env-file=.env scripts/ai-visibility-probe.js
 *   node --env-file=.env scripts/ai-visibility-probe.js --batch 3
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import handler from '../api/chat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, '..', 'data', 'ai-visibility-log.json');
const LOG_CAP = 1000;
const PROBE_VERSION = '1.0';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// --------------------------------------------------------------------------
// Question battery — 10 questions spanning all 8 curated indicators
// --------------------------------------------------------------------------
const QUESTIONS = [
  { question: 'What is the current unemployment rate in OECD countries?',                          topic: 'oecd_unemployment' },
  { question: 'How does GDP growth compare across OECD nations?',                                  topic: 'oecd_gdp' },
  { question: 'How much do OECD countries spend on healthcare as a percentage of GDP?',            topic: 'oecd_health' },
  { question: "What is Turkey's education spending per student?",                                  topic: 'edu_spending_per_student' },
  { question: 'What share of government spending goes to education in OECD countries?',            topic: 'edu_gov_expenditure_share' },
  { question: 'How has household consumption growth changed in OECD countries recently?',          topic: 'fin_household_indicators' },
  { question: 'How much do OECD countries invest in research and development as a share of GDP?',  topic: 'digital_rd_expenditure' },
  { question: 'How widespread is internet use among businesses in OECD countries?',                topic: 'digital_ict_business' },
  { question: 'Which OECD country had the highest unemployment rate recently?',                    topic: 'oecd_unemployment' },
  { question: 'Has R&D spending in OECD countries increased in recent years?',                    topic: 'digital_rd_expenditure' }
];

// --------------------------------------------------------------------------
// Gemini helper
// thinkingBudget: 0  → disable thinking (fast paths: ungrounded, intent)
// thinkingBudget: undefined → omit thinkingConfig (judge uses model default)
// --------------------------------------------------------------------------
async function geminiGenerate(prompt, { temperature = 0.2, maxOutputTokens = 1024, thinkingBudget } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model  = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const generationConfig = { temperature, maxOutputTokens };
  if (thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget };
  }

  const res = await fetch(
    `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
      signal: AbortSignal.timeout(90000)
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  // Prefer the non-thought part (thinking responses include a thought:true part)
  const outputPart = parts.find(p => p.text && p.thought !== true) ?? parts.find(p => p.text);
  if (!outputPart?.text) throw new Error('Empty response from Gemini');
  return outputPart.text;
}

// --------------------------------------------------------------------------
// Grounded path — delegate entirely to api/chat.js handler
// --------------------------------------------------------------------------
async function runGrounded(question) {
  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question })
  });
  const res = await handler(req);
  return { status: res.status, body: await res.json() };
}

// --------------------------------------------------------------------------
// Ungrounded path — plain Gemini, no SDMX data
// --------------------------------------------------------------------------
async function runUngrounded(question) {
  const prompt = `You are a knowledgeable assistant. Answer the following question about OECD statistics as accurately as you can based on your training knowledge. Be specific with numbers and time periods where possible.

Question: ${question}`;
  return geminiGenerate(prompt, { temperature: 0.3, maxOutputTokens: 600, thinkingBudget: 0 });
}

// --------------------------------------------------------------------------
// Ground truth summary — last 12 observations described in plain text
// --------------------------------------------------------------------------
function buildGroundTruthSummary(series, indicatorName) {
  if (!series || series.length === 0) return 'No observations available.';
  const recent  = series.slice(-12);
  const periods = recent.map(o => o.TIME_PERIOD).filter(Boolean);
  const values  = recent.map(o => o.OBS_VALUE).filter(v => v != null);
  const areas   = [...new Set(recent.map(o => o.REF_AREA).filter(Boolean))];
  const unit    = recent.find(o => o.UNIT_MEASURE)?.UNIT_MEASURE ?? '';

  return [
    `Indicator: ${indicatorName}`,
    `Latest ${recent.length} of ${series.length} total observations:`,
    `  Period range: ${periods[0] ?? '?'} → ${periods.at(-1) ?? '?'}`,
    `  Reference areas (sample): ${areas.slice(0, 10).join(', ')}${areas.length > 10 ? ' …' : ''}`,
    `  Unit: ${unit || 'unknown'}`,
    `  Sample values: ${values.slice(0, 6).map(v => (typeof v === 'number' ? +v.toFixed(4) : v)).join(', ')}`
  ].join('\n');
}

// --------------------------------------------------------------------------
// Judge path — Gemini scores ungrounded answer vs. SDMX ground truth
// thinkingBudget left undefined → model may use its own reasoning budget
// --------------------------------------------------------------------------
async function runJudge(question, groundTruthSummary, ungroundedAnswer) {
  const prompt = `You are a statistical fact-checker evaluating an AI assistant's answer about OECD data.

Question asked: "${question}"

Ground-truth SDMX data (authoritative):
${groundTruthSummary}

AI answer (produced with NO access to any data — from training knowledge only):
"${ungroundedAnswer}"

Evaluate the AI answer and respond with ONLY valid JSON (no markdown, no extra text):
{
  "factualAccuracy": "<correct|stale|wrong|no-data>",
  "recency": "<current|stale|unclear>",
  "oecdCited": <true|false>,
  "otherSourcesCited": ["<source1>"],
  "reasoning": "<2-3 sentences explaining the score>"
}

Scoring guide:
- factualAccuracy: "correct" = figures roughly match SDMX data; "stale" = directionally right but from older data; "wrong" = contradicts SDMX data; "no-data" = AI stated it had no data
- recency: "current" = time periods match recent SDMX data; "stale" = older periods cited; "unclear" = no time reference given
- oecdCited: true only if the AI explicitly named OECD as a data source (not just mentioned OECD countries)
- otherSourcesCited: specific sources named (World Bank, IMF, Eurostat, etc.) — empty array if none`;

  const raw = await geminiGenerate(prompt, { temperature: 0.0, maxOutputTokens: 8192 });

  // Strip markdown fences and extract the JSON object
  const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Judge returned no JSON object. Raw: ${cleaned.slice(0, 300)}`);

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error(`Judge JSON parse failed. Raw: ${match[0].slice(0, 300)}`);
  }

  for (const field of ['factualAccuracy', 'recency', 'oecdCited', 'otherSourcesCited', 'reasoning']) {
    if (!(field in parsed)) throw new Error(`Judge response missing field: ${field}`);
  }
  return parsed;
}

// --------------------------------------------------------------------------
// Log helpers
// --------------------------------------------------------------------------
function loadLog() {
  try {
    const raw = readFileSync(LOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistLog(entries) {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  const capped = entries.length > LOG_CAP ? entries.slice(entries.length - LOG_CAP) : entries;
  writeFileSync(LOG_PATH, JSON.stringify(capped, null, 2) + '\n', 'utf8');
}

// --------------------------------------------------------------------------
// Main probe loop
// --------------------------------------------------------------------------
async function runProbe(questions) {
  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY not set. Run with: node --env-file=.env scripts/ai-visibility-probe.js');
    process.exit(1);
  }

  const log = loadLog();
  const timestamp = new Date().toISOString();

  for (const { question, topic } of questions) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Q: ${question}`);

    const entry = {
      timestamp,
      question,
      topic,
      matched: null,
      indicatorId: null,
      indicatorName: null,
      sdmxSeriesCount: 0,
      groundedAnswer: null,
      ungroundedAnswer: null,
      groundTruthSummary: null,
      judgment: null,
      error: null,
      probeVersion: PROBE_VERSION
    };

    try {
      // Step 1: Grounded path (api/chat.js → intent map → SDMX → Gemini answer)
      process.stdout.write('  [1/3] Grounded...');
      const { body: grounded } = await runGrounded(question);
      entry.matched = grounded.matched ?? false;

      if (!entry.matched) {
        process.stdout.write(` OUT OF SCOPE\n`);
        entry.error = `out-of-scope: ${grounded.outOfScopeNote ?? grounded.answer}`;
        log.push(entry);
        persistLog(log);
        continue;
      }

      entry.indicatorId   = topic;
      entry.indicatorName = grounded.citation?.indicatorName ?? null;
      entry.sdmxSeriesCount = grounded.series?.length ?? 0;
      entry.groundedAnswer  = grounded.answer ?? null;
      process.stdout.write(` OK (${entry.sdmxSeriesCount} obs, "${entry.indicatorName}")\n`);

      // Step 2: Build ground truth summary from SDMX series
      entry.groundTruthSummary = buildGroundTruthSummary(grounded.series ?? [], entry.indicatorName);

      // Step 3: Ungrounded path
      process.stdout.write('  [2/3] Ungrounded...');
      entry.ungroundedAnswer = await runUngrounded(question);
      process.stdout.write(` OK (${entry.ungroundedAnswer.length} chars)\n`);

      // Step 4: Judge
      process.stdout.write('  [3/3] Judge...');
      entry.judgment = await runJudge(question, entry.groundTruthSummary, entry.ungroundedAnswer);
      process.stdout.write(` factualAccuracy=${entry.judgment.factualAccuracy} | oecdCited=${entry.judgment.oecdCited} | recency=${entry.judgment.recency}\n`);

    } catch (err) {
      entry.error = err.message;
      process.stdout.write(`\n  ERROR: ${err.message}\n`);
    }

    log.push(entry);
    persistLog(log);
    process.stdout.write('  [saved]\n');
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`Done. ${questions.length} question(s) processed. Log → ${LOG_PATH}`);
}

// --------------------------------------------------------------------------
// CLI entry
// --------------------------------------------------------------------------
const args = process.argv.slice(2);
const batchIdx  = args.indexOf('--batch');
const batchSize = batchIdx !== -1 ? parseInt(args[batchIdx + 1], 10) : QUESTIONS.length;
const batch     = QUESTIONS.slice(0, Math.max(1, batchSize || QUESTIONS.length));

console.log(`=== StatPulse AI Visibility Probe v${PROBE_VERSION} ===`);
console.log(`Running ${batch.length} of ${QUESTIONS.length} question(s)…`);

runProbe(batch).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
