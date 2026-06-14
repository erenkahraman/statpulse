export const config = { runtime: 'edge' };

import { fetchSdmxObservations } from './_lib/sdmx.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Curated indicators — derived from config/endpoints.json (oecd_production + extended_datasets).
// Do not add entries here without also adding them to config/endpoints.json.
const INDICATORS = [
  {
    id: 'oecd_unemployment',
    name: 'Monthly Unemployment Rates',
    agency: 'OECD.SDD.TPS',
    dataflowId: 'DSD_LFS@DF_IALFS_UNE_M',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/..._Z.Y._T.Y_GE15..M?startPeriod=2023-01&lastNObservations=5&dimensionAtObservation=AllDimensions',
    description: 'Monthly unemployment rates for OECD member countries. Covers total unemployment as a percentage of the labour force, broken down by country and sex.'
  },
  {
    id: 'oecd_gdp',
    name: 'GDP — Expenditure Approach',
    agency: 'OECD.SDD.NAD',
    dataflowId: 'DSD_NAAG@DF_NAAG_I',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DSD_NAAG@DF_NAAG_I,/A.AUS+AUT+BEL+CAN+CHL+COL+CRI+CZE+DNK+EST+FIN+FRA+DEU+GRC+HUN+ISL+IRL+ISR+ITA+JPN+KOR+LVA+LTU+LUX+MEX+NLD+NZL+NOR+POL+PRT+SVK+SVN+ESP+SWE+CHE+TUR+GBR+USA.B1GQ_R_GR..?startPeriod=2018&dimensionAtObservation=AllDimensions',
    description: 'Annual GDP growth rates (expenditure approach) for OECD countries. Measures real gross domestic product, year-on-year percentage change.'
  },
  {
    id: 'oecd_health',
    name: 'Health Expenditure (SHA)',
    agency: 'OECD.ELS.HD',
    dataflowId: 'DSD_SHA@DF_SHA',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.ELS.HD,DSD_SHA@DF_SHA,/.A.EXP_HEALTH.PT_B1GQ._T.._T.._T...?startPeriod=2018&dimensionAtObservation=AllDimensions',
    description: 'Annual health expenditure as a percentage of GDP for OECD countries. Uses System of Health Accounts (SHA) methodology.'
  },
  {
    id: 'edu_spending_per_student',
    name: 'Education Spending per Student',
    agency: 'OECD.EDU.IMEP',
    dataflowId: 'DSD_EAG_UOE_FIN@DF_UOE_FIN_INDIC_SOURCE_NATURE',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.EDU.IMEP,DSD_EAG_UOE_FIN@DF_UOE_FIN_INDIC_SOURCE_NATURE,3.1/TUR.EXP.ISCED11_1T8+ISCED11_1T4+ISCED11_5T8.S13.INST_EDU.DIR_EXP.V.XDC.SOURCE?startPeriod=2018&endPeriod=2022&dimensionAtObservation=AllDimensions',
    description: 'Government expenditure on education per student in national currency (Turkey). Covers primary through tertiary education levels.'
  },
  {
    id: 'edu_gov_expenditure_share',
    name: 'Government Education Expenditure Share',
    agency: 'OECD.EDU.IMEP',
    dataflowId: 'DSD_EAG_UOE_FIN@DF_UOE_FIN_INDIC_SHARE_EDU_GOV',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.EDU.IMEP,DSD_EAG_UOE_FIN@DF_UOE_FIN_INDIC_SHARE_EDU_GOV,3.1/..ISCED11_1T8+ISCED11_1T4+ISCED11_5T8.S13..._Z..?startPeriod=2015&endPeriod=2023&dimensionAtObservation=AllDimensions',
    description: 'Share of government budget spent on education as a percentage of total government expenditure, across OECD countries including France.'
  },
  {
    id: 'fin_household_indicators',
    name: 'Household Economic Indicators',
    agency: 'OECD.SDD.NAD',
    dataflowId: 'DSD_HHDASH@DF_HHDASH_INDIC',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DSD_HHDASH@DF_HHDASH_INDIC,1.0/Q..P3S1M_R_POP_GR.?startPeriod=2020-Q1&dimensionAtObservation=AllDimensions',
    description: 'Quarterly household consumption growth per capita (% change) across OECD countries. Part of the Household Dashboard indicators.'
  },
  {
    id: 'digital_rd_expenditure',
    name: 'R&D Expenditure (MSTI)',
    agency: 'OECD.STI.STP',
    dataflowId: 'DSD_MSTI@DF_MSTI',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.STI.STP,DSD_MSTI@DF_MSTI,1.3/.A.G+T_RS...?startPeriod=2018&dimensionAtObservation=AllDimensions',
    description: 'Annual R&D expenditure by government and total research sectors as a percentage of GDP. From OECD Main Science and Technology Indicators (MSTI).'
  },
  {
    id: 'digital_ict_business',
    name: 'ICT Usage by Businesses',
    agency: 'OECD.STI.DEP',
    dataflowId: 'DSD_ICT_B@DF_BUSINESSES',
    url: 'https://sdmx.oecd.org/public/rest/data/OECD.STI.DEP,DSD_ICT_B@DF_BUSINESSES,1.0/.A.B1_B.._T.S_GE10+S_GE100?startPeriod=2015&dimensionAtObservation=AllDimensions',
    description: 'Annual ICT access and usage indicators for businesses (% of enterprises with 10+ or 100+ employees). Covers internet access, broadband, cloud, and digital tools.'
  }
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function geminiGenerate(apiKey, model, prompt, expectJson = false) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: expectJson ? 0.0 : 0.2,
      maxOutputTokens: expectJson ? 256 : 1024,
      ...(expectJson ? { responseMimeType: 'application/json' } : {})
    }
  };

  const res = await fetch(
    `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Gemini API ${res.status}`);
    err.code = 'GEMINI_ERROR';
    err.detail = detail.slice(0, 200);
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const err = new Error('Empty response from Gemini');
    err.code = 'GEMINI_EMPTY';
    throw err;
  }
  return text;
}

async function mapIntent(question, apiKey, model) {
  const indicatorList = INDICATORS.map((ind, i) =>
    `${i + 1}. id="${ind.id}" | ${ind.name} — ${ind.description}`
  ).join('\n');

  const prompt = `You are a statistical data routing assistant. Given a user question, identify the single best matching indicator from the curated list below, or determine it is out of scope.

Available indicators:
${indicatorList}

Rules:
- Match ONLY if the question clearly relates to one of these specific indicators.
- If multiple indicators could match, pick the single best one.
- If the question is about topics not in this list (e.g. population, inflation, stock prices, climate, crime, trade), mark it out of scope.
- Respond with valid JSON only — no markdown, no explanation outside JSON.

Response format (choose one):
{"matched":true,"indicatorId":"<exact id from list>"}
{"matched":false,"reason":"<brief explanation>"}

User question: "${question.replace(/"/g, '\\"')}"`;

  const text = await geminiGenerate(apiKey, model, prompt, true);
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const err = new Error('Intent mapping returned invalid JSON');
    err.code = 'INTENT_PARSE_ERROR';
    err.raw = cleaned.slice(0, 200);
    throw err;
  }
  if (typeof parsed.matched !== 'boolean') {
    const err = new Error('Intent mapping response missing "matched" field');
    err.code = 'INTENT_PARSE_ERROR';
    throw err;
  }
  return parsed;
}

async function generateGroundedAnswer(question, indicator, sdmxResult, apiKey, model) {
  const recent = sdmxResult.observations.slice(-50);
  const dataLines = recent.map(o => {
    const dims = Object.entries(o)
      .filter(([k]) => k !== 'OBS_VALUE')
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    return `${dims} → ${o.OBS_VALUE}`;
  }).join('\n');

  const [t0, t1] = sdmxResult.meta.timeRange;
  const timeContext = t0 ? `${t0} to ${t1 ?? t0}` : 'unknown range';

  const prompt = `You are a precise statistical analyst. Answer the user question using ONLY the data provided below. Do not invent, extrapolate, or recall any specific numbers from your training — use only the values shown here.

Indicator: ${indicator.name}
Agency: ${indicator.agency} | Dataflow: ${indicator.dataflowId}
Period covered: ${timeContext} | Observations available: ${sdmxResult.meta.count}

Data (most recent up to 50 observations):
${dataLines}

User question: "${question.replace(/"/g, '\\"')}"

Instructions:
1. Answer factually citing only values and time periods visible in the data above.
2. If the data does not contain enough detail to fully answer, state that clearly.
3. Keep the answer concise — 2 to 4 sentences maximum.
4. Do not mention that you are limited to a data sample.`;

  return geminiGenerate(apiKey, model, prompt, false);
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question) return jsonResponse({ error: 'question is required' }, 400);
  if (question.length > 1000) return jsonResponse({ error: 'question too long (max 1000 chars)' }, 400);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'AI service not configured' }, 503);
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  // Step 1: intent mapping
  let intent;
  try {
    intent = await mapIntent(question, apiKey, model);
  } catch (err) {
    if (err.code === 'GEMINI_ERROR') {
      return jsonResponse({ error: 'AI service error during intent mapping', detail: err.detail }, 502);
    }
    return jsonResponse({ error: err.message }, 500);
  }

  if (!intent.matched) {
    const topicList = INDICATORS.map(i => i.name).join(', ');
    return jsonResponse({
      answer: `I can only answer questions about these OECD statistical indicators: ${topicList}. Your question appears to be outside this scope.`,
      matched: false,
      outOfScopeNote: intent.reason || 'Question does not match any curated indicator.',
      series: []
    });
  }

  const indicator = INDICATORS.find(i => i.id === intent.indicatorId);
  if (!indicator) {
    return jsonResponse({ error: `Unknown indicator id: ${intent.indicatorId}`, matched: false }, 500);
  }

  // Step 2: fetch live SDMX data
  let sdmxResult;
  try {
    sdmxResult = await fetchSdmxObservations(indicator.url, 200);
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return jsonResponse({ error: 'Data source timed out', matched: true, citation: buildCitation(indicator), series: [] }, 504);
    }
    return jsonResponse({ error: `Data retrieval failed: ${err.message}`, matched: true, citation: buildCitation(indicator), series: [] }, 502);
  }

  if (!sdmxResult.observations.length) {
    return jsonResponse({
      answer: `The indicator "${indicator.name}" matched your question but returned no observations from the data source.`,
      matched: true,
      citation: buildCitation(indicator),
      series: []
    });
  }

  // Step 3: grounded generation
  let answer;
  try {
    answer = await generateGroundedAnswer(question, indicator, sdmxResult, apiKey, model);
  } catch (err) {
    // Fallback: describe the data without AI prose
    const [t0, t1] = sdmxResult.meta.timeRange;
    answer = `${indicator.name} data from ${indicator.agency} contains ${sdmxResult.meta.count} observations` +
      (t0 ? ` covering ${t0}${t1 ? ' to ' + t1 : ''}` : '') + '.';
  }

  if (answer.length > 2000) answer = answer.slice(0, 1997) + '…';

  return jsonResponse({
    answer,
    matched: true,
    citation: buildCitation(indicator),
    series: sdmxResult.observations
  });
}

function buildCitation(indicator) {
  return {
    indicatorName: indicator.name,
    sourceUrl: indicator.url,
    agency: indicator.agency,
    dataflowId: indicator.dataflowId
  };
}
