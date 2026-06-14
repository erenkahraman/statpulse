#!/usr/bin/env node
// Materializes unmatched-query log from Vercel KV (Upstash Redis) into
// data/unmatched-queries.json for dashboard consumption.
// Env: KV_REST_API_URL, KV_REST_API_TOKEN — same values as in Vercel project settings.
// If env vars are absent, exits 0 with a notice (no store provisioned yet).

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH  = join(__dirname, '..', 'data', 'unmatched-queries.json');
const DASH_PATH = join(__dirname, '..', 'dashboard', 'unmatched-queries.json');
const KEY       = 'oos_queries';
const CAP       = 1000;

const kvUrl   = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;

if (!kvUrl || !kvToken) {
  console.log('KV_REST_API_URL / KV_REST_API_TOKEN not set — no store provisioned. Skipping materialization.');
  process.exit(0);
}

// LRANGE 0 CAP-1 via Upstash REST API
const res = await fetch(`${kvUrl}/lrange/${KEY}/0/${CAP - 1}`, {
  headers: { Authorization: `Bearer ${kvToken}` }
});

if (!res.ok) {
  console.error(`KV lrange failed: HTTP ${res.status}`);
  process.exit(1);
}

const body = await res.json();
const raw  = body.result || [];

// Each element was stored as JSON.stringify(entry) — parse back
const entries = raw.map(s => {
  try { return JSON.parse(s); } catch { return null; }
}).filter(Boolean);

// Keep only the most recent CAP entries (list is LPUSH so newest-first, reverse for chronological)
const ordered = [...entries].reverse();

mkdirSync(join(__dirname, '..', 'data'), { recursive: true });
writeFileSync(OUT_PATH,  JSON.stringify(ordered, null, 2), 'utf8');
writeFileSync(DASH_PATH, JSON.stringify(ordered, null, 2), 'utf8');

console.log(`Materialized ${ordered.length} OOS query entries → data/unmatched-queries.json`);
