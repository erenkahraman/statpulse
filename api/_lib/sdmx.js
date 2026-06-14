const ALLOWED_HOSTS = ['sdmx.oecd.org', 'nsi-demo-stable.siscc.org'];

export function normalizeTimePeriod(t) {
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

export function parseSdmxGeneric(xml) {
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

export function detectVaryingDimensions(obs) {
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

export async function fetchSdmxObservations(targetUrl, limit = 200) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    const err = new Error('Invalid SDMX URL');
    err.code = 'INVALID_URL';
    throw err;
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    const err = new Error(`Host not allowed: ${parsed.hostname}`);
    err.code = 'HOST_NOT_ALLOWED';
    throw err;
  }

  let fetchUrl = targetUrl
    .replace(/([&?])format=csvfilewithlabels/g, '')
    .replace(/([&?])format=jsondata/g, '');
  if (!fetchUrl.includes('dimensionAtObservation')) {
    fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'dimensionAtObservation=AllDimensions';
  }

  const upstream = await fetch(fetchUrl, {
    headers: {
      'Accept': 'application/vnd.sdmx.genericdata+xml;version=2.1, application/xml, */*',
      'Accept-Encoding': 'gzip, deflate, br'
    },
    signal: AbortSignal.timeout(25000)
  });

  if (!upstream.ok) {
    const err = new Error(`Upstream HTTP ${upstream.status}`);
    err.code = 'UPSTREAM_ERROR';
    err.httpStatus = upstream.status;
    throw err;
  }

  const xml = await upstream.text();

  if (xml.includes('languageTag') || xml.trim().startsWith('<!DOCTYPE html')) {
    const err = new Error('Upstream returned an error page');
    err.code = 'UPSTREAM_ERROR_PAGE';
    throw err;
  }

  const observations = parseSdmxGeneric(xml);
  const cap = Math.min(Math.max(limit, 1), 2000);

  const limited = observations
    .map(o => ({ observation: o, time: normalizeTimePeriod(o.TIME_PERIOD) }))
    .sort((a, b) => String(b.time?.sort || '').localeCompare(String(a.time?.sort || '')))
    .slice(0, cap)
    .sort((a, b) => String(a.time?.sort || '').localeCompare(String(b.time?.sort || '')))
    .map(item => item.observation);

  const dimensions = detectVaryingDimensions(limited);
  const times = limited.map(o => normalizeTimePeriod(o.TIME_PERIOD)).filter(Boolean);
  const sortedTimes = [...new Set(times.map(t => t.label))];

  return {
    observations: limited,
    dimensions,
    meta: {
      count: limited.length,
      totalCount: observations.length,
      limit: cap,
      timeRange: sortedTimes.length ? [sortedTimes[0], sortedTimes[sortedTimes.length - 1]] : [],
      sourceUrl: targetUrl
    }
  };
}
