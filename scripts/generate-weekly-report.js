/**
 * @fileoverview StatPulse weekly health report generator.
 *
 * Reads the health log, computes per-endpoint stats for the past 7 days,
 * and creates a GitHub Issue containing a structured Markdown report.
 * Designed to run inside GitHub Actions where GITHUB_TOKEN and
 * GITHUB_REPOSITORY are always available as environment variables.
 *
 * Run manually for local testing (without GITHUB_TOKEN set) to confirm
 * graceful failure behaviour — the script will log a clear error and exit
 * without throwing an unhandled exception.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ---------------------------------------------------------------------------
// Named constants
// ---------------------------------------------------------------------------

/** Number of calendar days to include in each weekly report. */
const REPORT_WINDOW_DAYS = 7;

/** Uptime percentage that satisfies the api-availability KPI target. */
const UPTIME_KPI_TARGET_PCT = 99.5;

/** Average response time (ms) that satisfies the api-response-time KPI target. */
const RESPONSE_KPI_TARGET_MS = 3000;

/** Uptime percentage below which availability is considered critical. */
const UPTIME_CRITICAL_THRESHOLD_PCT = 95;

/** Endpoint names must match those used in check-health.js exactly. */
const ENDPOINT_NAMES = ['Structures', 'Data Query', 'Codelists'];

/** Path resolution — works regardless of cwd. */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_PATH = join(__dirname, '..', 'data', 'health-log.json');
const AIV_LOG_PATH = join(__dirname, '..', 'data', 'ai-visibility-log.json');

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

/** @param {string} msg */
const logInfo = (msg) => console.log(`[INFO]  ${new Date().toISOString()} ${msg}`);

/** @param {string} msg */
const logWarn = (msg) => console.warn(`[WARN]  ${new Date().toISOString()} ${msg}`);

/** @param {string} msg */
const logError = (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`);

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

/**
 * Reads and parses health-log.json.
 * Returns an empty array rather than throwing so a missing file produces a
 * graceful "no data" report rather than an unhandled crash.
 *
 * @returns {Array<Object>}
 */
function readLog() {
  try {
    const raw = readFileSync(LOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logWarn('health-log.json is not an array — treating as empty');
      return [];
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      logWarn('health-log.json not found — no data to report');
    } else {
      logWarn(`Could not parse health-log.json (${err.message})`);
    }
    return [];
  }
}

/**
 * Reads and parses ai-visibility-log.json.
 * Returns an empty array on missing file or parse error.
 *
 * @returns {Array<Object>}
 */
function readAiLog() {
  try {
    const raw = readFileSync(AIV_LOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logWarn('ai-visibility-log.json is not an array — treating as empty');
      return [];
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      logWarn('ai-visibility-log.json not found — no AI visibility data to report');
    } else {
      logWarn(`Could not parse ai-visibility-log.json (${err.message})`);
    }
    return [];
  }
}

/**
 * Computes AI visibility summary statistics for the report window.
 *
 * @param {Array<Object>} aiLog   - Full AI visibility log.
 * @param {number} days           - Number of days to include.
 * @returns {Object}              - { sovPct, accPct, totalJudged, notable, lastRun }
 */
function computeAiStats(aiLog, days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const recent = aiLog.filter(e => new Date(e.timestamp) >= cutoff);
  const judged = recent.filter(e => e.matched && e.judgment);

  if (judged.length === 0) {
    return { sovPct: null, accPct: null, totalJudged: 0, notable: [], lastRun: null };
  }

  const sovCount = judged.filter(e => e.judgment.oecdCited === true).length;
  const sovPct = parseFloat(((sovCount / judged.length) * 100).toFixed(1));

  const accCount = judged.filter(e => ['correct', 'stale'].includes(e.judgment.factualAccuracy)).length;
  const accPct = parseFloat(((accCount / judged.length) * 100).toFixed(1));

  // Notable misrepresentations: entries where accuracy is 'wrong' and OECD not cited
  const notable = judged
    .filter(e => e.judgment.factualAccuracy === 'wrong' && !e.judgment.oecdCited)
    .slice(0, 3)
    .map(e => ({ question: e.question, indicator: e.indicatorName || e.topic, reasoning: e.judgment.reasoning || '' }));

  const lastRun = judged.reduce((a, b) => (b.timestamp > a ? b.timestamp : a), '').split('T')[0];

  return { sovPct, accPct, totalJudged: judged.length, notable, lastRun };
}

/**
 * Filters the log to records whose timestamp falls within the past N days.
 * Using Date arithmetic rather than string comparison so timezone edge cases
 * are handled correctly.
 *
 * @param {Array<Object>} log
 * @param {number} days
 * @returns {Array<Object>}
 */
function filterRecentRecords(log, days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return log.filter((r) => new Date(r.timestamp) >= cutoff);
}

/**
 * Computes summary statistics for one endpoint from the filtered record set.
 *
 * @param {Array<Object>} records   - Records already filtered to the report window.
 * @param {string} endpointName     - Endpoint name to filter within the records.
 * @returns {Object|null}           - Stats object, or null if no records found.
 */
function computeEndpointStats(records, endpointName) {
  const endpointRecords = records.filter((r) => r.endpoint === endpointName);
  if (!endpointRecords.length) return null;

  const okCount = endpointRecords.filter((r) => r.ok).length;
  const uptimePercent = parseFloat(((okCount / endpointRecords.length) * 100).toFixed(2));

  // Exclude null/failed response times from performance stats to avoid
  // timed-out requests (which return TIMEOUT_MS) distorting the averages.
  const validTimes = endpointRecords
    .filter((r) => r.responseTimeMs !== null)
    .map((r) => r.responseTimeMs);

  const avgResponseMs = validTimes.length
    ? Math.round(validTimes.reduce((a, b) => a + b, 0) / validTimes.length)
    : null;
  const minResponseMs = validTimes.length ? Math.min(...validTimes) : null;
  const maxResponseMs = validTimes.length ? Math.max(...validTimes) : null;

  const anomalyCount = endpointRecords.filter((r) => r.anomaly?.detected).length;

  // Surface the most recent extra metric value for catalogue stability tracking.
  const latestRecord = endpointRecords[endpointRecords.length - 1];
  const latestExtraMetric = latestRecord?.extraMetric?.value ?? null;

  return { uptimePercent, avgResponseMs, minResponseMs, maxResponseMs, anomalyCount, latestExtraMetric };
}

/**
 * Formats a number with locale-appropriate thousand separators.
 * Improves readability of large catalogue counts like 2591 → 2,591.
 *
 * @param {number|string|null} n
 * @returns {string}
 */
function formatNumber(n) {
  if (n === null || n === undefined) return '—';
  const num = Number(n);
  return isNaN(num) ? String(n) : num.toLocaleString('en-US');
}

/**
 * Returns a status emoji for a KPI value compared against its target.
 * Thresholds follow the same logic used in governance/kpis.yaml.
 *
 * @param {number|null} value
 * @param {number} target
 * @param {'higher'|'lower'} direction - Whether higher or lower values are better.
 * @returns {string} Emoji: ✅ on target, ⚠️ near miss, 🔴 critical failure
 */
function kpiEmoji(value, target, direction) {
  if (value === null) return '—';
  if (direction === 'higher') {
    if (value >= target) return '✅';
    if (value >= UPTIME_CRITICAL_THRESHOLD_PCT) return '⚠️';
    return '🔴';
  }
  // lower is better (response time)
  if (value <= target) return '✅';
  if (value <= target * 1.5) return '⚠️';
  return '🔴';
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

/**
 * Builds the full Markdown body for the weekly GitHub Issue.
 * All dynamic values are derived from the stats and recentRecords arguments —
 * no hard-coded sample data anywhere in this function.
 *
 * @param {Object} stats            - Map of endpointName → computeEndpointStats output.
 * @param {Array<Object>} recentRecords - Records from the report window.
 * @param {string} reportStart      - ISO date string for the window start.
 * @param {string} reportEnd        - ISO date string for the window end.
 * @param {string} dashboardUrl     - Derived from GITHUB_REPOSITORY at call time.
 * @returns {string} Markdown string ready to POST as a GitHub Issue body.
 */
function buildIssueBody(stats, recentRecords, reportStart, reportEnd, dashboardUrl, aiStats = null) {
  const totalChecks = recentRecords.length;
  const runsCount = Math.round(totalChecks / ENDPOINT_NAMES.length);

  // Compute aggregate KPI values across all endpoints.
  const validUptimes = ENDPOINT_NAMES.map((n) => stats[n]?.uptimePercent).filter((v) => v !== null);
  const validAvgMs = ENDPOINT_NAMES.map((n) => stats[n]?.avgResponseMs).filter((v) => v !== null);

  const overallUptimePct = validUptimes.length
    ? parseFloat((validUptimes.reduce((a, b) => a + b, 0) / validUptimes.length).toFixed(2))
    : null;
  const overallAvgMs = validAvgMs.length
    ? Math.round(validAvgMs.reduce((a, b) => a + b, 0) / validAvgMs.length)
    : null;

  // Content-type validity: ratio of ok responses that also had a valid SDMX Content-Type.
  const okRecords = recentRecords.filter((r) => r.ok);
  const validCtRecords = okRecords.filter((r) => r.contentTypeValid);
  const contentTypeValidityPct = okRecords.length
    ? parseFloat(((validCtRecords.length / okRecords.length) * 100).toFixed(1))
    : null;

  // Determine overall assessment text based on the worst-case KPI outcome.
  const anyUptimeCritical = ENDPOINT_NAMES.some(
    (n) => stats[n]?.uptimePercent !== null && stats[n].uptimePercent < UPTIME_CRITICAL_THRESHOLD_PCT,
  );
  const allUptimeOnTarget = validUptimes.every((v) => v >= UPTIME_KPI_TARGET_PCT);
  const anyAnomalies = ENDPOINT_NAMES.some((n) => (stats[n]?.anomalyCount ?? 0) > 0);

  let assessment;
  if (anyUptimeCritical) {
    assessment = '🔴 Critical: availability below acceptable threshold.';
  } else if (!allUptimeOnTarget || anyAnomalies) {
    assessment = '⚠️ One or more KPI thresholds require attention. Review anomaly log.';
  } else {
    assessment = '✅ Platform health is within all KPI targets.';
  }

  const structStats = stats['Structures'] || {};
  const codeStats = stats['Codelists'] || {};

  const lines = [
    '## statpulse Weekly Health Report',
    '',
    `**Period:** ${reportStart} → ${reportEnd}`,
    `**Generated:** ${new Date().toISOString()} UTC`,
    `**Total checks:** ${totalChecks} (3 endpoints × ${runsCount} runs)`,
    '',
    '### Endpoint Summary',
    '',
    '| Endpoint | Uptime | Avg Response | Min | Max | Anomalies |',
    '|---|---|---|---|---|---|',
    ...ENDPOINT_NAMES.map((name) => {
      const s = stats[name] || {};
      return (
        `| ${name} | ` +
        `${s.uptimePercent !== null && s.uptimePercent !== undefined ? s.uptimePercent.toFixed(1) + '%' : '—'} | ` +
        `${s.avgResponseMs !== null && s.avgResponseMs !== undefined ? s.avgResponseMs + 'ms' : '—'} | ` +
        `${s.minResponseMs !== null && s.minResponseMs !== undefined ? s.minResponseMs + 'ms' : '—'} | ` +
        `${s.maxResponseMs !== null && s.maxResponseMs !== undefined ? s.maxResponseMs + 'ms' : '—'} | ` +
        `${s.anomalyCount ?? 0} |`
      );
    }),
    '',
    '### Catalogue Metrics (latest)',
    `- **Data Structures (DSDs):** ${formatNumber(structStats.latestExtraMetric)}`,
    `- **Codelists:** ${formatNumber(codeStats.latestExtraMetric)}`,
    '',
    '### Assessment',
    assessment,
    '',
    '### KPI Status',
    '',
    '| KPI | Target | This Week | Status |',
    '|---|---|---|---|',
    `| API Availability | ≥ 99.5% | ${overallUptimePct !== null ? overallUptimePct.toFixed(1) + '%' : '—'} | ${kpiEmoji(overallUptimePct, UPTIME_KPI_TARGET_PCT, 'higher')} |`,
    `| Avg Response Time | < 3000ms | ${overallAvgMs !== null ? overallAvgMs + 'ms' : '—'} | ${kpiEmoji(overallAvgMs, RESPONSE_KPI_TARGET_MS, 'lower')} |`,
    `| Content-Type Validity | 100% | ${contentTypeValidityPct !== null ? contentTypeValidityPct.toFixed(1) + '%' : '—'} | ${kpiEmoji(contentTypeValidityPct, 100, 'higher')} |`,
    '',
    '---',
    '',
    '### AI Visibility Metrics (OECD Share of Voice)',
    '',
  ];

  if (!aiStats || aiStats.totalJudged === 0) {
    lines.push('*No AI visibility data for this period — probe may not have run yet.*');
  } else {
    const sovEmoji = aiStats.sovPct >= 50 ? '✅' : aiStats.sovPct >= 25 ? '⚠️' : '🔴';
    const accEmoji = aiStats.accPct >= 70 ? '✅' : aiStats.accPct >= 40 ? '⚠️' : '🔴';
    lines.push(
      `| KPI | Target | This Week | Status |`,
      `|---|---|---|---|`,
      `| AI Share of Voice | ≥ 50% | ${aiStats.sovPct !== null ? aiStats.sovPct.toFixed(1) + '%' : '—'} | ${sovEmoji} |`,
      `| AI Factual Accuracy Rate | ≥ 70% | ${aiStats.accPct !== null ? aiStats.accPct.toFixed(1) + '%' : '—'} | ${accEmoji} |`,
      '',
      `**Questions judged:** ${aiStats.totalJudged} | **Last probe run:** ${aiStats.lastRun || '—'}`,
    );

    if (aiStats.notable.length > 0) {
      lines.push('', '#### Notable Misrepresentations (wrong + OECD not cited)', '');
      aiStats.notable.forEach(n => {
        lines.push(`- **${n.indicator}** — "${n.question}"`);
        if (n.reasoning) lines.push(`  > ${n.reasoning}`);
      });
    }
  }

  lines.push(
    '',
    '---',
    `*Generated automatically by [statpulse](${dashboardUrl}) — SDMX API monitoring for the SIS-CC .Stat Suite platform.*`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Orchestrates the weekly report:
 * 1. Validates required environment variables.
 * 2. Reads and filters the health log.
 * 3. Computes per-endpoint statistics.
 * 4. Builds the Markdown report body.
 * 5. Creates a GitHub Issue via the REST API.
 *
 * Exits with code 1 on any unrecoverable error so the GitHub Actions workflow
 * can report failure clearly without needing to parse log output.
 */
async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logError('GITHUB_TOKEN not set — report generation requires GitHub Actions environment');
    process.exit(1);
  }

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    logError('GITHUB_REPOSITORY not set — report generation requires GitHub Actions environment');
    process.exit(1);
  }

  logInfo(`Generating weekly report for ${repo}`);

  const log = readLog();
  const aiLog = readAiLog();
  const recentRecords = filterRecentRecords(log, REPORT_WINDOW_DAYS);

  if (!recentRecords.length) {
    logWarn('No records found in the past 7 days — skipping report creation');
    process.exit(0);
  }

  logInfo(`Found ${recentRecords.length} records in the past ${REPORT_WINDOW_DAYS} days`);

  const stats = {};
  for (const name of ENDPOINT_NAMES) {
    stats[name] = computeEndpointStats(recentRecords, name);
  }

  // Calculate Monday of the current week for the issue title.
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); // ISO week start
  const mondayStr = monday.toISOString().split('T')[0];

  const reportStart = new Date(Date.now() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
  const reportEnd = now.toISOString().split('T')[0];

  // Derive the GitHub Pages URL from the repo slug rather than hard-coding it.
  // For a project repo "owner/repo-name" the Pages URL is "https://owner.github.io/repo-name".
  const [owner, repoName] = repo.split('/');
  const dashboardUrl = `https://${owner}.github.io/${repoName}`;

  const aiStats = computeAiStats(aiLog, REPORT_WINDOW_DAYS);
  const title = `Weekly Platform Health Report — week of ${mondayStr}`;
  const body = buildIssueBody(stats, recentRecords, reportStart, reportEnd, dashboardUrl, aiStats);

  logInfo(`Creating issue: "${title}"`);

  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      title,
      body,
      labels: ['weekly-report'],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logError(`Failed to create issue — HTTP ${response.status}: ${errText}`);
    process.exit(1);
  }

  const issue = await response.json();
  logInfo(`Issue created successfully: ${issue.html_url}`);
}

main().catch((err) => {
  logError(`Unhandled error: ${err.message}`);
  process.exit(1);
});
