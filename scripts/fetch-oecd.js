import { readFileSync, writeFileSync, existsSync } from 'fs';

const CONFIG = JSON.parse(readFileSync('./config/endpoints.json', 'utf8'));
const MAX_RECORDS = 300;
const TIMEOUT_MS = 20000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/xml, text/xml, */*' }
    });
    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      responseTimeMs: Date.now() - start,
      contentType: res.headers.get('content-type') || '',
      body: text
    };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      responseTimeMs: Date.now() - start,
      contentType: '',
      body: '',
      error: err.message
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseDataflowCatalogue(xmlText) {
  // Match any element ending in :Dataflow or just Dataflow.
  // OECD SDMX-ML uses str:Dataflow or structure:Dataflow.
  const flows = [];

  // Extract all Dataflow elements regardless of namespace prefix.
  const flowRegex = /(?:^|<)[\w]*:?Dataflow\s[^>]*id="([^"]+)"[^>]*agencyID="([^"]+)"[^>]*version="([^"]+)"/gm;
  // Also try reverse attribute order.
  const flowRegex2 = /(?:^|<)[\w]*:?Dataflow\s[^>]*agencyID="([^"]+)"[^>]*id="([^"]+)"[^>]*version="([^"]+)"/gm;

  // Extract names: any element ending in :Name with xml:lang="en".
  const nameRegex = /:Name\s+xml:lang="en"[^>]*>([^<]+)</g;
  const names = [];
  let nm;
  while ((nm = nameRegex.exec(xmlText)) !== null) {
    names.push(nm[1].trim());
  }

  let i = 0;
  let m;
  while ((m = flowRegex.exec(xmlText)) !== null) {
    flows.push({ id: m[1], agencyID: m[2], version: m[3], name: names[i] || m[1] });
    i++;
  }

  // If first regex found nothing, try second (attribute order varies).
  if (flows.length === 0) {
    i = 0;
    while ((m = flowRegex2.exec(xmlText)) !== null) {
      flows.push({ id: m[2], agencyID: m[1], version: m[3], name: names[i] || m[2] });
      i++;
    }
  }

  // If still nothing, log first 500 chars of XML for debugging.
  if (flows.length === 0) {
    console.log('  XML parse debug — first 500 chars:');
    console.log(xmlText.substring(0, 500));
  }

  return flows;
}

function countRecords(body, format) {
  if (format === 'csv') {
    // CSV: count data rows (skip header line and empty lines).
    const lines = body.split('\n').filter(l => l.trim().length > 0);
    return Math.max(0, lines.length - 1);
  }
  if (format === 'xml') {
    // Count <generic:Obs> elements; each is one observation in SDMX-ML Generic format.
    const matches = body.match(/<generic:Obs\s/g);
    if (matches) return matches.length;
    // Fallback: count <Obs> regardless of namespace prefix.
    const matches2 = body.match(/:Obs[\s>]/g);
    return matches2 ? matches2.length : 0;
  }
  return 0;
}

async function run() {
  const results = [];
  const timestamp = new Date().toISOString();

  for (const ep of CONFIG.oecd_production) {
    console.log(`Fetching ${ep.name}...`);
    const res = await fetchWithTimeout(ep.url);

    let recordCount = 0;
    let catalogueSize = 0;

    if (ep.id === 'oecd_dataflows' && res.ok) {
      const flows = parseDataflowCatalogue(res.body);
      catalogueSize = flows.length;
      // Save catalogue separately
      writeFileSync('./data/oecd-catalogue.json', JSON.stringify({
        fetchedAt: timestamp,
        totalFlows: flows.length,
        flows
      }, null, 2));
      console.log(`  Catalogue: ${flows.length} dataflows`);
      if (flows.length > 0) {
        console.log(`  First dataflow: ${flows[0].agencyID}/${flows[0].id} v${flows[0].version} — ${flows[0].name}`);
      }
    } else if (ep.id === 'oecd_dataflows') {
      writeFileSync('./data/oecd-catalogue.json', JSON.stringify({
        fetchedAt: timestamp,
        totalFlows: 0,
        flows: []
      }, null, 2));
    } else if (res.ok) {
      recordCount = countRecords(res.body, ep.format);
    }

    results.push({
      id: ep.id,
      name: ep.name,
      agency: ep.agency,
      dataflowId: ep.dataflowId,
      url: ep.url,
      timestamp,
      status: res.status,
      ok: res.ok,
      responseTimeMs: res.responseTimeMs,
      recordCount,
      catalogueSize,
      error: res.error || null
    });

    console.log(`  Status: ${res.status}, Time: ${res.responseTimeMs}ms, Records: ${recordCount}`);
    if (!res.ok) {
      console.log(`  Raw response: ${res.body || res.error || '(empty)'}`);
    }
  }

  // Append to rolling log
  const logPath = './data/oecd-live.json';
  let log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : [];
  log = [...log, ...results].slice(-MAX_RECORDS);
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`\nSaved ${results.length} records. Log now has ${log.length} entries.`);
}

run().catch(err => { console.error(err); process.exit(1); });
