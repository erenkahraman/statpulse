/**
 * Power BI flat-table export.
 *
 * Reads data/health-log.json and data/ai-visibility-log.json and writes two
 * files to data/exports/:
 *   powerbi-metrics.csv   — CSV flat table (one row per metric observation)
 *   powerbi-metrics.json  — Same data as JSON array (for Power BI JSON connector)
 *
 * Star-schema shape:
 *   date | source | metric | indicator | value | dimension | unit
 *
 * Usage:
 *   node scripts/export-powerbi.js
 *   node scripts/export-powerbi.js --out ./my-export-dir
 *
 * Power BI import:
 *   CSV:  Get data → Text/CSV → select powerbi-metrics.csv
 *   JSON: Get data → JSON → select powerbi-metrics.json
 *   Both produce the same flat table. Use the CSV path for scheduled refreshes
 *   via Power BI Gateway (file connector).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, '..', 'data');

const HEALTH_LOG_PATH = join(DATA_DIR, 'health-log.json');
const AIV_LOG_PATH    = join(DATA_DIR, 'ai-visibility-log.json');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT_DIR = outIdx !== -1 ? args[outIdx + 1] : join(DATA_DIR, 'exports');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonArray(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isoDate(ts) {
  return ts ? ts.split('T')[0] : '';
}

function escapeCsvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowToCsv(row, headers) {
  return headers.map(h => escapeCsvField(row[h])).join(',');
}

// ---------------------------------------------------------------------------
// Flatten health log
// ---------------------------------------------------------------------------

/**
 * Flattens health-log.json entries into metric rows.
 * One row per endpoint check metric (response_time, uptime, anomaly).
 */
function flattenHealthLog(log) {
  const rows = [];
  for (const entry of log) {
    const date = isoDate(entry.timestamp);
    const base = { date, source: 'health-log', indicator: entry.endpoint || '', dimension: '' };

    if (entry.responseTimeMs !== null && entry.responseTimeMs !== undefined) {
      rows.push({ ...base, metric: 'response_time_ms', value: entry.responseTimeMs, unit: 'ms' });
    }
    rows.push({ ...base, metric: 'uptime_ok', value: entry.ok ? 1 : 0, unit: 'binary' });
    if (entry.anomaly?.detected) {
      rows.push({ ...base, metric: 'anomaly_detected', value: 1, unit: 'binary' });
    }
    if (entry.extraMetric?.value !== undefined && entry.extraMetric.value !== null) {
      rows.push({ ...base, metric: entry.extraMetric.label || 'catalogue_count', value: entry.extraMetric.value, unit: 'count' });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Flatten AI visibility log
// ---------------------------------------------------------------------------

/**
 * Flattens ai-visibility-log.json entries into metric rows.
 * One row per scored dimension (factual_accuracy, sov, recency_match).
 */
function flattenAiLog(log) {
  const rows = [];
  const ACCURACY_SCORE = { correct: 1, stale: 0.5, wrong: 0, 'no-data': null };

  for (const entry of log) {
    if (!entry.judgment) continue;
    const date = isoDate(entry.timestamp);
    const base = { date, source: 'ai-visibility', indicator: entry.indicatorName || entry.topic || '', dimension: entry.topic || '' };

    rows.push({ ...base, metric: 'oecd_cited', value: entry.judgment.oecdCited ? 1 : 0, unit: 'binary' });

    const accScore = ACCURACY_SCORE[entry.judgment.factualAccuracy];
    if (accScore !== null && accScore !== undefined) {
      rows.push({ ...base, metric: 'factual_accuracy_score', value: accScore, unit: '0-1' });
    }
    rows.push({ ...base, metric: 'factual_accuracy_label', value: entry.judgment.factualAccuracy || '', unit: 'category' });
    rows.push({ ...base, metric: 'recency', value: entry.judgment.recency || '', unit: 'category' });
    rows.push({ ...base, metric: 'sdmx_series_count', value: entry.sdmxSeriesCount || 0, unit: 'count' });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

const HEADERS = ['date', 'source', 'metric', 'indicator', 'value', 'dimension', 'unit'];

function writeExports(rows, outDir) {
  mkdirSync(outDir, { recursive: true });

  const csvPath  = join(outDir, 'powerbi-metrics.csv');
  const jsonPath = join(outDir, 'powerbi-metrics.json');

  const csvLines = [HEADERS.join(','), ...rows.map(r => rowToCsv(r, HEADERS))];
  writeFileSync(csvPath,  csvLines.join('\n') + '\n', 'utf8');
  writeFileSync(jsonPath, JSON.stringify(rows, null, 2) + '\n', 'utf8');

  return { csvPath, jsonPath, rowCount: rows.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const healthLog = readJsonArray(HEALTH_LOG_PATH);
const aivLog    = readJsonArray(AIV_LOG_PATH);

const healthRows = flattenHealthLog(healthLog);
const aivRows    = flattenAiLog(aivLog);
const allRows    = [...healthRows, ...aivRows];

const { csvPath, jsonPath, rowCount } = writeExports(allRows, OUT_DIR);

console.log(`Power BI export complete — ${rowCount} rows`);
console.log(`  CSV:  ${csvPath}`);
console.log(`  JSON: ${jsonPath}`);
console.log(`  Health rows: ${healthRows.length} | AI-visibility rows: ${aivRows.length}`);
