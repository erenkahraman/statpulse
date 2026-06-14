# Product Decision Log
**Purpose:** Records the reasoning behind major product decisions.

---

## 2026-06 — Out-of-scope answers: verified OECD links + Vercel KV logging

**Context:** The grounded chat panel previously returned a terse "outside scope"
message with no answer and no onward path. Users asking about topics not in the
curated corpus (e.g. climate, population, trade) received no value, increasing
bounce rate from the chat panel.

**Decision:** OOS queries now receive:
1. A helpful general-knowledge answer (Gemini, flagged as not from live OECD data).
2. A server-side-verified OECD link — deep link to the best-matching dataflow in
   the 2536-flow catalogue (via keyword search on `api/_lib/catalogue-index.js`),
   falling back to a guaranteed-working Data Explorer search URL. Link is verified
   HEAD→GET before being returned; if neither verifies, no link is shown.
3. Logging to Vercel KV (Upstash) so unmatched queries accumulate as a
   demand/content-gap signal, materialized daily into `data/unmatched-queries.json`
   by `scripts/materialize-oos-queries.js` via CI.

**Verified-link policy:**
- Only `data-explorer.oecd.org` links are used (confirmed 200 for both `vis?`
  deep links and `catalog/datasets?search=` fallback).
- No link is shown if neither URL returns HTTP 200 within 5s — never a broken link.
- `www.oecd.org/en/search.html` was considered but returns 403; rejected.

**Logging design:**
- Edge function cannot write to the repo. Vercel KV (Upstash Redis) is the
  runtime-persistent store. If `KV_REST_API_URL` / `KV_REST_API_TOKEN` are absent,
  logging is silently skipped — answer + link are still returned correctly.
- CI materializes the KV list into `data/unmatched-queries.json` daily. This file
  is included in the deploy-pages and update-vercel-data copy steps so it is always
  served correctly alongside the other data files.

**Integrity rules preserved:**
- In-scope queries: grounded behavior completely unchanged.
- OOS answers: no specific numbers are presented as authoritative OECD data.
- No fabricated or unverified links. Every shown link has been server-side verified.

**To provision logging:** add two Vercel project environment variables and matching
GitHub repository secrets:
- `KV_REST_API_URL` — the Upstash Redis REST URL from your Vercel KV store
- `KV_REST_API_TOKEN` — the Upstash read/write token

**Outcome:** OOS users receive a useful answer and a working OECD entry point.
Unmatched query volume is tracked as KPI 9 (content-gap-coverage).
