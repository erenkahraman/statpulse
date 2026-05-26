import { writeFileSync } from 'fs';

const TIMEOUT = 15000;

async function test(label, url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    const ms = Date.now() - start;
    const preview = text.substring(0, 200).replace(/\n/g, ' ');
    console.log(`\n[${label}]`);
    console.log(`  Status: ${res.status} | ${ms}ms`);
    console.log(`  Preview: ${preview}`);
    return { label, status: res.status, preview };
  } catch(e) {
    console.log(`\n[${label}] ERROR: ${e.message}`);
    return { label, status: 0, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

const urls = [
  // CLI - exact URL from OECD official docs (csvfilewithlabels)
  ['CLI_official_doc',
   'https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI/.M.LI...AA...H?startPeriod=2023-02&dimensionAtObservation=AllDimensions&format=csvfilewithlabels'],

  // CLI - try without version in dataflow ref
  ['CLI_no_version',
   'https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI/all?format=csvfilewithlabels&startPeriod=2024-01&lastNObservations=5'],

  // CLI - try with explicit latest version and "all" key
  ['CLI_all_key',
   'https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,1.0/all?format=csvfilewithlabels&startPeriod=2024-01&lastNObservations=5'],

  // Unemployment - from R-bloggers working example
  ['UNE_rbloggers',
   'https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/TUR..PT_LF_SUB._Z.Y._T.Y_GE15..M?startPeriod=2023-11&dimensionAtObservation=AllDimensions&format=csvfilewithlabels'],

  // GDP - try with "all" key
  ['GDP_all',
   'https://sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DSD_NAAG@DF_NAAG_I/all?format=csvfilewithlabels&startPeriod=2023&lastNObservations=3'],

  // Try fetching DSD for CLI to see what dimensions exist
  ['CLI_structure',
   'https://sdmx.oecd.org/public/rest/datastructure/OECD.SDD.STES/DSD_STES?references=none&detail=allstubs'],
];

const results = [];
for (const [label, url] of urls) {
  results.push(await test(label, url));
}

writeFileSync('./data/url-test-results.json', JSON.stringify(results, null, 2));
console.log('\nDone. Results saved to data/url-test-results.json');
