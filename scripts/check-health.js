/**
 * @fileoverview StatPulse health check script for SIS-CC .Stat Suite SDMX API endpoints.
 *
 * Runs against three public, auth-free endpoints every time the GitHub Actions
 * cron fires. Results are appended to data/health-log.json and committed back
 * to the repo by the workflow — the dashboard reads that file directly from
 * GitHub Pages, so no backend is needed.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ---------------------------------------------------------------------------
// Named constants — change values here rather than hunting for magic numbers
// ---------------------------------------------------------------------------

/** Maximum number of check results to keep in the log file.
 *  200 entries at 6-hour intervals ≈ 50 days of history, enough for trend
 *  analysis without making the JSON file unwieldy for GitHub Pages to serve. */
const MAX_LOG_ENTRIES = 200;

/** Per-request timeout in milliseconds.
 *  15 s is generous for a well-behaved NSI but still catches hung connections
 *  before the GitHub Actions job times out at 10 minutes. */
const TIMEOUT_MS = 15_000;

/** Number of previous checks per endpoint to include in the rolling average.
 *  10 checks = 2.5 days of history at 6-hour intervals — long enough to smooth
 *  out transient spikes but short enough to track genuine degradation trends. */
const ANOMALY_WINDOW = 10;

/** Minimum number of historical samples required before anomaly detection fires.
 *  Prevents false positives during the first few runs when the baseline is
 *  too small to be statistically meaningful. */
const ANOMALY_MIN_SAMPLES = 5;

/** Response time deviation factor that triggers a WARNING anomaly.
 *  2× the rolling average is the threshold — a doubling of response time
 *  is significant enough to warrant attention without over-alerting. */
const ANOMALY_WARNING_FACTOR = 2;

/** Response time deviation factor that triggers a CRITICAL anomaly.
 *  3× the rolling average indicates a severe degradation that likely
 *  impacts end users of the Data Explorer directly. */
const ANOMALY_CRITICAL_FACTOR = 3;

/** Path resolution so the script works regardless of cwd.
 *  Using import.meta.url is the ESM equivalent of __dirname. */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_PATH = join(__dirname, '..', 'data', 'health-log.json');

// ---------------------------------------------------------------------------
// Endpoint definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EndpointConfig
 * @property {string} name        - Human-readable label used in the dashboard.
 * @property {string} url         - Fully-qualified public URL (no auth required).
 * @property {function(string): {label: string, value: string|number}} extraMetric
 *   - Derives a domain-specific metric from the raw response body text.
 */

/** @type {EndpointConfig[]} */
const ENDPOINTS = [
  {
    name: 'Structures',
    url: 'https://nsi-demo-stable.siscc.org/rest/datastructure/all/all/all?detail=allstubs',
    /**
     * Counts DataStructure artefacts returned.
     * A sudden drop signals a publish regression; a large spike might indicate
     * runaway DSD proliferation — both are worth flagging in the dashboard.
     * @param {string} body - Raw XML response text.
     * @returns {{label: string, value: number}}
     */
    extraMetric: (body) => ({
      label: 'DataStructure count',
      value: (body.match(/DataStructure/g) || []).length,
    }),
  },
  {
    name: 'Data Query',
    url: 'https://nsi-demo-stable.siscc.org/rest/data/OECD.CFE,INBOUND@TOURISM_TRIPS,2.0',
    /**
     * Records raw response body size.
     * Tracking KB over time detects dataset growth (expected) vs sudden
     * shrinkage (possible accidental truncation or embargo activation).
     * @param {string} body - Raw response text.
     * @returns {{label: string, value: string}}
     */
    extraMetric: (body) => ({
      label: 'Response size KB',
      value: (Buffer.byteLength(body, 'utf8') / 1024).toFixed(2),
    }),
  },
  {
    name: 'Codelists',
    url: 'https://nsi-demo-stable.siscc.org/rest/codelist/all/all/latest?detail=allstubs',
    /**
     * Counts Codelist artefacts returned.
     * Codelists are a shared dependency; losing even one can break downstream
     * DSD validation, so tracking catalogue size is a cheap early-warning.
     * @param {string} body - Raw XML response text.
     * @returns {{label: string, value: number}}
     */
    extraMetric: (body) => ({
      label: 'Codelist count',
      value: (body.match(/Codelist/g) || []).length,
    }),
  },
];

// ---------------------------------------------------------------------------
// Logging helpers — structured prefixes make it easy to grep CI logs
// ---------------------------------------------------------------------------

/** @param {string} msg */
const logInfo = (msg) => console.log(`[INFO]  ${new Date().toISOString()} ${msg}`);

/** @param {string} msg */
const logWarn = (msg) => console.warn(`[WARN]  ${new Date().toISOString()} ${msg}`);

/** @param {string} msg */
const logError = (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`);

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

/**
 * Computes anomaly status for a single endpoint result by comparing the
 * current response time against the rolling average of recent checks.
 * Detection is intentionally conservative — it requires a minimum sample
 * window before firing to avoid false positives on cold-start checks.
 *
 * The rolling average excludes failed/timed-out requests (null responseTimeMs)
 * so that a previous outage does not artificially lower the baseline and cause
 * subsequent normal responses to appear anomalous.
 *
 * @param {string} endpointName     - Name matching the endpoint's `name` field.
 * @param {number|null} currentMs   - Response time for the current check.
 * @param {Array<Object>} historicalLog - Existing log entries BEFORE this run.
 * @returns {{ detected: boolean, rollingAvgMs?: number, deviationFactor?: number, severity?: string }}
 */
function detectAnomaly(endpointName, currentMs, historicalLog) {
  // A null currentMs means the request failed outright — skip anomaly scoring
  // since the DOWN badge already communicates the problem more clearly.
  if (currentMs === null || currentMs === undefined) {
    return { detected: false };
  }

  // Gather valid historical response times for this endpoint only.
  // Filtering to successful, non-null records keeps the baseline clean.
  const history = historicalLog
    .filter((r) => r.endpoint === endpointName && r.responseTimeMs !== null)
    .slice(-ANOMALY_WINDOW);

  // Refuse to score until we have a statistically meaningful baseline.
  if (history.length < ANOMALY_MIN_SAMPLES) {
    return { detected: false };
  }

  const rollingAvgMs = Math.round(
    history.reduce((sum, r) => sum + r.responseTimeMs, 0) / history.length,
  );

  // Avoid division-by-zero if all historical times were somehow 0.
  if (rollingAvgMs === 0) {
    return { detected: false };
  }

  const deviationFactor = parseFloat((currentMs / rollingAvgMs).toFixed(2));

  if (deviationFactor >= ANOMALY_CRITICAL_FACTOR) {
    return { detected: true, rollingAvgMs, deviationFactor, severity: 'critical' };
  }

  if (deviationFactor >= ANOMALY_WARNING_FACTOR) {
    return { detected: true, rollingAvgMs, deviationFactor, severity: 'warning' };
  }

  return { detected: false };
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Checks a single endpoint and returns a structured result record.
 *
 * Sequential fetches are intentional — parallel execution would skew relative
 * response time comparisons between endpoints because all three requests would
 * compete for the same network interface simultaneously.
 *
 * @param {EndpointConfig} endpoint
 * @returns {Promise<Object>} Result record ready to append to health-log.json.
 */
async function checkEndpoint(endpoint) {
  const controller = new AbortController();
  // Store the timeout ID so we can cancel it if the request resolves first,
  // preventing a dangling timer from keeping the Node process alive.
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const timestamp = new Date().toISOString();
  let result = {
    endpoint: endpoint.name,
    url: endpoint.url,
    timestamp,
    status: null,
    ok: false,
    responseTimeMs: null,
    contentTypeValid: false,
    responseSizeKB: null,
    extraMetric: { label: endpoint.extraMetric('').label, value: null },
    anomaly: { detected: false },
    error: null,
  };

  const t0 = Date.now();

  try {
    logInfo(`Checking ${endpoint.name} — ${endpoint.url}`);

    const response = await fetch(endpoint.url, { signal: controller.signal });
    const responseTimeMs = Date.now() - t0;
    clearTimeout(timeoutId);

    const body = await response.text();
    const contentType = response.headers.get('content-type') || '';

    result = {
      ...result,
      status: response.status,
      ok: response.ok,
      responseTimeMs,
      // The SIS-CC NSI returns application/xml or application/vnd.sdmx.* types.
      // Checking for "xml" or "sdmx" in the header guards against misconfigured
      // proxy layers that silently return HTML error pages with a 200 status.
      contentTypeValid: /xml|sdmx/i.test(contentType),
      responseSizeKB: parseFloat((Buffer.byteLength(body, 'utf8') / 1024).toFixed(2)),
      extraMetric: endpoint.extraMetric(body),
    };

    if (!response.ok) {
      logWarn(`${endpoint.name} returned HTTP ${response.status}`);
    } else if (!result.contentTypeValid) {
      logWarn(`${endpoint.name} returned unexpected Content-Type: ${contentType}`);
    } else {
      logInfo(`${endpoint.name} OK — ${responseTimeMs}ms, ${result.responseSizeKB}KB`);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - t0;
    const errorMessage = err.name === 'AbortError'
      ? `Request timed out after ${TIMEOUT_MS}ms`
      : err.message;

    result = {
      ...result,
      responseTimeMs,
      error: errorMessage,
    };

    logError(`${endpoint.name} failed: ${errorMessage}`);
  }

  return result;
}

/**
 * Reads the existing health log from disk.
 * Returns an empty array on first run or if the file is unparseable —
 * a corrupt log must never block a fresh health check from running.
 *
 * @returns {Array<Object>}
 */
function readLog() {
  try {
    const raw = readFileSync(LOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logWarn('health-log.json is not an array — resetting to empty log');
      return [];
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      logInfo('health-log.json not found — starting fresh');
    } else {
      logWarn(`Could not parse health-log.json (${err.message}) — resetting`);
    }
    return [];
  }
}

/**
 * Persists the updated log back to disk.
 * Capping at MAX_LOG_ENTRIES ensures the JSON file stays small enough for
 * GitHub Pages to serve quickly even after months of automated runs.
 *
 * @param {Array<Object>} log
 */
function writeLog(log) {
  const trimmed = log.slice(-MAX_LOG_ENTRIES);
  writeFileSync(LOG_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
  logInfo(`Log saved — ${trimmed.length} entries (max ${MAX_LOG_ENTRIES})`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Orchestrates the health check run:
 * 1. Checks each endpoint sequentially.
 * 2. Reads the existing log so anomaly detection has a clean historical baseline.
 * 3. Annotates each result with anomaly status before appending to the log.
 * 4. Exits with code 1 only if every single endpoint failed — a partial
 *    outage should not block the git commit step in the workflow.
 */
async function main() {
  logInfo('=== StatPulse health check starting ===');

  const results = [];
  for (const endpoint of ENDPOINTS) {
    const result = await checkEndpoint(endpoint);
    results.push(result);
  }

  // Read existing log BEFORE appending new results so anomaly detection
  // compares each new reading against purely historical data. Including the
  // current run in the baseline would make the comparison self-referential.
  const log = readLog();

  // Annotate each result with anomaly status then log warnings for CI output.
  for (const result of results) {
    result.anomaly = detectAnomaly(result.endpoint, result.responseTimeMs, log);
    if (result.anomaly.detected) {
      logWarn(
        `${result.endpoint} ANOMALY (${result.anomaly.severity}): ` +
        `${result.anomaly.deviationFactor}× rolling avg (${result.anomaly.rollingAvgMs}ms baseline, ${result.responseTimeMs}ms actual)`,
      );
    }
  }

  log.push(...results);
  writeLog(log);

  const failCount = results.filter((r) => !r.ok).length;
  logInfo(`=== Health check complete — ${results.length - failCount}/${results.length} endpoints healthy ===`);

  // Exit 1 only when every endpoint failed simultaneously.
  // A single failure is logged and visible in the dashboard but does not
  // prevent the workflow from committing the (partial) results.
  if (failCount === results.length) {
    logError('All endpoints failed — exiting with code 1');
    process.exit(1);
  }
}

main().catch((err) => {
  logError(`Unhandled error: ${err.message}`);
  process.exit(1);
});
