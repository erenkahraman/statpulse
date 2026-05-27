export const config = { runtime: 'edge' };

const ALLOWED_HOSTS = [
  'sdmx.oecd.org',
  'nsi-demo-stable.siscc.org'
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

function normalizeTimePeriod(t) {
  if (!t) return null;
  const s = String(t).trim();
  if (/^\d{4}$/.test(s)) return { iso: `${s}-01-01`, sort: s + '0000', label: s };
  if (/^\d{4}-\d{2}$/.test(s)) return { iso: `${s}-01`, sort: s.replace('-', '') + '00', label: s };
  if (/^\d{4}-Q[1-4]$/.test(s)) {
    const year = s.slice(0, 4);
    const q = parseInt(s.slice(-1), 10);
    const month = String((q - 1) * 3 + 1).padStart(2, '0');
    return { iso: `${year}-${month}-01`, sort: year + month + '00', label: s };
  }
  if (/^\d{4}-S[1-2]$/.test(s)) {
    const year = s.slice(0, 4);
    const half = parseInt(s.slice(-1), 10);
    const month = half === 1 ? '01' : '07';
    return { iso: `${year}-${month}-01`, sort: year + month + '00', label: s };
  }
  if (/^\d{4}-W\d{1,2}$/.test(s)) {
    const year = s.slice(0, 4);
    return { iso: `${year}-01-01`, sort: year + '0000', label: s };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { iso: s, sort: s.replace(/-/g, ''), label: s };
  return { iso: s, sort: s, label: s };
}

function parseSdmxGeneric(xml) {
  const observations = [];
  const obsBlocks = xml.split(/<generic:Obs>/).slice(1);

  for (const block of obsBlocks) {
    const obsEnd = block.indexOf('</generic:Obs>');
    const obsXml = obsEnd >= 0 ? block.slice(0, obsEnd) : block;

    const record = {};
    const valueRegex = /<generic:Value\s+id="([^"]+)"\s+value="([^"]*)"\s*\/>/g;
    let m;
    while ((m = valueRegex.exec(obsXml)) !== null) {
      record[m[1]] = m[2];
    }

    const obsValueMatch = obsXml.match(/<generic:ObsValue\s+value="([^"]*)"\s*\/>/);
    if (obsValueMatch) {
      const v = parseFloat(obsValueMatch[1]);
      if (!Number.isNaN(v)) record.OBS_VALUE = v;
    }

    if (record.TIME_PERIOD && record.OBS_VALUE !== undefined) {
      observations.push(record);
    }
  }
  return observations;
}

function detectVaryingDimensions(obs) {
  if (!obs.length) return [];
  const allKeys = new Set();
  obs.forEach(o => Object.keys(o).forEach(k => {
    if (k !== 'OBS_VALUE' && k !== 'TIME_PERIOD') allKeys.add(k);
  }));
  const varying = [];
  for (const key of allKeys) {
    const distinct = new Set(obs.map(o => o[key]).filter(Boolean));
    if (distinct.size > 1 && distinct.size <= 60) {
      varying.push({ id: key, count: distinct.size });
    }
  }
  const priority = ['REF_AREA', 'MEASURE', 'FREQ', 'UNIT_MEASURE', 'TRANSACTION'];
  varying.sort((a, b) => {
    const pa = priority.indexOf(a.id);
    const pb = priority.indexOf(b.id);
    if (pa !== -1 && pb !== -1) return pa - pb;
    if (pa !== -1) return -1;
    if (pb !== -1) return 1;
    return a.count - b.count;
  });
  return varying.map(v => v.id);
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');

  if (!target) return jsonResponse({ error: 'Missing url parameter' }, 400);

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return jsonResponse({ error: 'Invalid url' }, 400);
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return jsonResponse({ error: 'Host not allowed' }, 403);
  }

  let fetchUrl = target
    .replace(/([&?])format=csvfilewithlabels/g, '')
    .replace(/([&?])format=jsondata/g, '');
  if (!fetchUrl.includes('dimensionAtObservation')) {
    fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'dimensionAtObservation=AllDimensions';
  }

  try {
    const upstream = await fetch(fetchUrl, {
      headers: { 'Accept': 'application/vnd.sdmx.genericdata+xml;version=2.1, application/xml, */*' },
      signal: AbortSignal.timeout(25000)
    });

    if (!upstream.ok) {
      return jsonResponse({ error: `Upstream returned HTTP ${upstream.status}`, status: upstream.status }, 502);
    }

    const xml = await upstream.text();

    if (xml.includes('languageTag') || xml.trim().startsWith('<!DOCTYPE html')) {
      return jsonResponse({ error: 'Upstream returned an error page. The query key may be invalid.' }, 422);
    }

    const observations = parseSdmxGeneric(xml);

    if (!observations.length) {
      return jsonResponse({ error: 'No observations found', observations: [] }, 200);
    }

    const dimensions = detectVaryingDimensions(observations);
    const times = observations.map(o => normalizeTimePeriod(o.TIME_PERIOD)).filter(Boolean);
    const sortedTimes = [...new Set(times.map(t => t.label))];

    return jsonResponse({
      observations,
      dimensions,
      meta: {
        count: observations.length,
        timeRange: sortedTimes.length ? [sortedTimes[0], sortedTimes[sortedTimes.length - 1]] : [],
        sourceUrl: target
      }
    });

  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'Upstream request timed out' : err.message;
    return jsonResponse({ error: msg }, 504);
  }
}
