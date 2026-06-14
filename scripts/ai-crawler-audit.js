/**
 * AI Crawler Discoverability Audit
 *
 * Fetches /robots.txt and /llms.txt for each OECD target domain to determine
 * which AI crawlers are allowed, blocked, or partially restricted, and whether
 * an llms.txt summary exists (a key signal for AI content discoverability).
 *
 * This is a CONFIGURATION audit (publicly available robots.txt files).
 * It does not reflect actual crawl traffic or server-level IP blocking.
 *
 * Outputs:
 *   data/ai-crawler-audit.json         — machine-readable result
 *   governance/ai-crawler-audit.md     — human-readable report
 *
 * Usage: node scripts/ai-crawler-audit.js
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// --------------------------------------------------------------------------
// Configuration — edit here to add/remove targets or crawlers
// --------------------------------------------------------------------------

const AUDIT_VERSION = '1.0';
const FETCH_TIMEOUT_MS = 12000;

const TARGETS = [
  { name: 'OECD Main',          domain: 'www.oecd.org' },
  { name: 'OECD SDMX API',      domain: 'sdmx.oecd.org' },
  { name: 'OECD.AI Observatory',domain: 'oecd.ai' },
  { name: 'OECD iLibrary',      domain: 'www.oecd-ilibrary.org' },
  { name: 'OECD Data Explorer', domain: 'data-explorer.oecd.org' },
];

const AI_CRAWLERS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Applebot-Extended',
  'CCBot', 'Bingbot',
];

// --------------------------------------------------------------------------
// robots.txt parser
// Status values: 'allowed' | 'blocked' | 'partial' | 'unknown'
// --------------------------------------------------------------------------

function parseRobotsTxt(text) {
  const agentMap = {};
  let currentAgents = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) {
      currentAgents = [];
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value     = line.slice(colonIdx + 1).trim();

    if (directive === 'user-agent') {
      const key = value.toLowerCase();
      if (!agentMap[key]) agentMap[key] = { disallow: [], allow: [] };
      currentAgents.push(key);
    } else if (directive === 'disallow' && currentAgents.length) {
      currentAgents.forEach(a => agentMap[a].disallow.push(value));
    } else if (directive === 'allow' && currentAgents.length) {
      currentAgents.forEach(a => agentMap[a].allow.push(value));
    }
  }

  return agentMap;
}

function evaluateRules({ disallow, allow }) {
  if (!disallow.length) return 'allowed';
  const blocksRoot = disallow.some(p => p === '/' || p === '');
  const allowsRoot = allow.some(p => p === '/');
  if (blocksRoot && !allowsRoot) return 'blocked';
  if (blocksRoot && allowsRoot) return 'allowed'; // Allow: / overrides Disallow: /
  return 'partial'; // some paths disallowed, but not the root
}

function getBotStatus(agentMap, botName) {
  const botKey  = botName.toLowerCase();
  const rules   = agentMap[botKey] || agentMap['*'];
  if (!rules) return 'allowed';
  return evaluateRules(rules);
}

// --------------------------------------------------------------------------
// Fetch helpers (polite — only /robots.txt and /llms.txt, no content crawling)
// --------------------------------------------------------------------------

const UA = 'StatPulseAudit/1.0 (+https://github.com/erenkahraman/statpulse)';

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { status: res.status, text: res.ok ? await res.text() : null };
}

async function checkUrlStatus(url) {
  // Try HEAD first; fall back to GET (some servers reject HEAD)
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return res.status;
  } catch {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return res.status;
    } catch {
      return null;
    }
  }
}

// --------------------------------------------------------------------------
// Audit one target
// --------------------------------------------------------------------------

async function auditTarget(target) {
  const { name, domain } = target;
  const robotsUrl = `https://${domain}/robots.txt`;
  const llmsUrl   = `https://${domain}/llms.txt`;

  process.stdout.write(`  robots.txt → `);
  let robotsTxtStatus = null;
  let agentMap = {};
  let error = null;

  try {
    const { status, text } = await fetchText(robotsUrl);
    robotsTxtStatus = status;
    if (text) agentMap = parseRobotsTxt(text);
    process.stdout.write(`HTTP ${status}\n`);
  } catch (err) {
    error = err.message;
    process.stdout.write(`ERROR: ${err.message}\n`);
  }

  process.stdout.write(`  llms.txt   → `);
  let llmsTxtStatus = null;
  try {
    llmsTxtStatus = await checkUrlStatus(llmsUrl);
    process.stdout.write(`HTTP ${llmsTxtStatus ?? 'N/A'}\n`);
  } catch {
    process.stdout.write(`ERROR\n`);
  }

  const crawlerStatus = {};
  let allowedCount = 0, blockedCount = 0, partialCount = 0;

  for (const crawler of AI_CRAWLERS) {
    const status = error ? 'unknown' : getBotStatus(agentMap, crawler);
    crawlerStatus[crawler] = status;
    if (status === 'allowed')  allowedCount++;
    else if (status === 'blocked') blockedCount++;
    else if (status === 'partial') partialCount++;
  }

  return {
    name, domain,
    robotsTxtFetched: !error && robotsTxtStatus !== null,
    robotsTxtStatus,
    llmsTxtExists: llmsTxtStatus === 200,
    llmsTxtStatus,
    crawlerStatus,
    allowedCount, blockedCount, partialCount,
    error,
  };
}

// --------------------------------------------------------------------------
// Markdown report builder
// --------------------------------------------------------------------------

const STATUS_EMOJI = { allowed: '✅', blocked: '🚫', partial: '⚠️', unknown: '—' };

function buildMarkdown(results, timestamp) {
  const date = timestamp.split('T')[0];
  const totalAllowed  = results.reduce((a, r) => a + r.allowedCount,  0);
  const totalBlocked  = results.reduce((a, r) => a + r.blockedCount,  0);
  const llmsCount     = results.filter(r => r.llmsTxtExists).length;

  const lines = [
    '# AI Crawler Discoverability Audit',
    '',
    `**Audit date:** ${date}  `,
    `**Targets audited:** ${results.length}  `,
    `**AI crawlers checked:** ${AI_CRAWLERS.length}  `,
    `**Source:** /robots.txt + /llms.txt (configuration audit — no content crawling)  `,
    '',
    '## Summary',
    '',
    '| Target | Domain | Allowed | Blocked | Partial | llms.txt |',
    '|---|---|---|---|---|---|',
    ...results.map(r =>
      `| ${r.name} | \`${r.domain}\` | ${r.allowedCount} | ${r.blockedCount} | ${r.partialCount} | ${r.llmsTxtExists ? '✅ Yes' : '❌ No'} |`
    ),
    '',
    `**Aggregate:** ${totalAllowed} allow vs ${totalBlocked} block across ${results.length} domains × ${AI_CRAWLERS.length} crawlers. llms.txt coverage: ${llmsCount}/${results.length} domains.`,
    '',
    '## Detail by Target',
    '',
  ];

  for (const r of results) {
    lines.push(
      `### ${r.name} (\`${r.domain}\`)`,
      '',
      `- **robots.txt:** HTTP ${r.robotsTxtStatus ?? 'N/A'}${r.error ? ` — fetch error: ${r.error}` : ''}`,
      `- **llms.txt:** ${r.llmsTxtExists ? `✅ exists (HTTP ${r.llmsTxtStatus})` : `❌ not found (HTTP ${r.llmsTxtStatus ?? 'N/A'})`}`,
      '',
      '| AI Crawler | Status |',
      '|---|---|',
      ...AI_CRAWLERS.map(c => `| \`${c}\` | ${STATUS_EMOJI[r.crawlerStatus[c]] ?? '—'} ${r.crawlerStatus[c]} |`),
      '',
    );
  }

  lines.push(
    '---',
    '',
    '## Methodology',
    '',
    '`/robots.txt` is fetched with a 12-second timeout using a transparent User-Agent.',
    'Per-bot status is derived as follows:',
    '- **blocked** — bot (or wildcard `*`) has `Disallow: /` with no overriding `Allow: /`',
    '- **partial** — bot has some `Disallow` rules but root `/` is accessible',
    '- **allowed** — no applicable `Disallow` rules for this bot',
    '',
    '`/llms.txt` is checked via HTTP HEAD (with GET fallback). Presence indicates the',
    'publisher has explicitly summarised content for AI/LLM consumption.',
    '',
    '*This audit does not reflect actual crawl traffic, server-level firewall rules,',
    'or Cloudflare/WAF bot management. It measures publicly declared configuration only.*',
    '',
    `*Generated by StatPulse ai-crawler-audit.js v${AUDIT_VERSION}*`,
  );

  return lines.join('\n') + '\n';
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

console.log('=== StatPulse AI Crawler Discoverability Audit ===\n');
const timestamp = new Date().toISOString();

const results = [];
for (const target of TARGETS) {
  console.log(`\n[${target.name} — ${target.domain}]`);
  results.push(await auditTarget(target));
}

const output = {
  timestamp,
  auditVersion: AUDIT_VERSION,
  crawlers: AI_CRAWLERS,
  targets: results,
};

const jsonPath = join(ROOT, 'data', 'ai-crawler-audit.json');
const mdPath   = join(ROOT, 'governance', 'ai-crawler-audit.md');

writeFileSync(jsonPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
writeFileSync(mdPath,   buildMarkdown(results, timestamp), 'utf8');

// Console summary
console.log('\n' + '─'.repeat(70));
console.log('Target                   Allowed  Blocked  Partial  llms.txt');
console.log('─'.repeat(70));
for (const r of results) {
  const n = r.name.padEnd(25);
  console.log(`${n}${String(r.allowedCount).padEnd(9)}${String(r.blockedCount).padEnd(9)}${String(r.partialCount).padEnd(9)}${r.llmsTxtExists ? 'YES' : 'no'}`);
}
console.log('─'.repeat(70));
console.log(`\n✓ ${jsonPath}`);
console.log(`✓ ${mdPath}`);
