import fs from 'node:fs';

const endpoints = JSON.parse(fs.readFileSync('./config/endpoints.json', 'utf8'));
const extended = endpoints.extended_datasets;

async function test(ep) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  const start = Date.now();
  try {
    const res = await fetch(ep.url, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/xml, text/xml, */*' }
    });
    const text = await res.text();
    const ms = Date.now() - start;
    const obsCount = (text.match(/<generic:Obs[\s>]/g) || []).length;
    console.log(`\n[${ep.id}]`);
    console.log(`  Status: ${res.status} | ${ms}ms | ${obsCount} observations`);
    if (res.status !== 200 || obsCount === 0) {
      console.log(`  Preview: ${text.slice(0, 200).replace(/\n/g, ' ')}`);
    }
    return { id: ep.id, ok: res.status === 200 && obsCount > 0, obsCount, ms };
  } catch (e) {
    console.log(`\n[${ep.id}] ERROR: ${e.message}`);
    return { id: ep.id, ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  const results = [];
  for (const ep of extended) results.push(await test(ep));
  console.log('\n=== SUMMARY ===');
  results.forEach(r => console.log(`  ${r.ok ? '✓' : '✗'} ${r.id}: ${r.obsCount || 0} obs`));
  const failed = results.filter(r => !r.ok);
  if (failed.length) console.log(`\n${failed.length} endpoint(s) need attention`);
  else console.log('\nAll endpoints returning data');
})();
