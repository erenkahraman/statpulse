export const config = { runtime: 'edge' };

import { fetchSdmxObservations } from './_lib/sdmx.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=900',
      'Vary': 'Accept-Encoding'
    }
  });
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');
  const requestedLimit = Number.parseInt(searchParams.get('limit') || '500', 10);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 500, 1), 2000);

  if (!target) return jsonResponse({ error: 'Missing url parameter' }, 400);

  try {
    const result = await fetchSdmxObservations(target, limit);

    if (!result.observations.length) {
      return jsonResponse({ error: 'No observations found', observations: [] }, 200);
    }

    return jsonResponse(result);
  } catch (err) {
    if (err.code === 'INVALID_URL') return jsonResponse({ error: 'Invalid url' }, 400);
    if (err.code === 'HOST_NOT_ALLOWED') return jsonResponse({ error: 'Host not allowed' }, 403);
    if (err.code === 'UPSTREAM_ERROR') return jsonResponse({ error: err.message, status: err.httpStatus }, 502);
    if (err.code === 'UPSTREAM_ERROR_PAGE') return jsonResponse({ error: 'Upstream returned an error page. The query key may be invalid.' }, 422);
    const msg = err.name === 'TimeoutError' ? 'Upstream request timed out' : err.message;
    return jsonResponse({ error: msg }, 504);
  }
}
