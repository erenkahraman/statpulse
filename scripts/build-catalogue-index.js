#!/usr/bin/env node
// Generates api/_lib/catalogue-index.js from data/oecd-catalogue.json.
// Run whenever the catalogue is updated: node scripts/build-catalogue-index.js
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cataloguePath = join(__dirname, '..', 'data', 'oecd-catalogue.json');
const outPath = join(__dirname, '..', 'api', '_lib', 'catalogue-index.js');

const { flows = [], fetchedAt } = JSON.parse(readFileSync(cataloguePath, 'utf8'));
const compact = flows.map(({ id, agencyID, name }) => ({ id, agencyID, name }));

const src = `// Auto-generated from data/oecd-catalogue.json by scripts/build-catalogue-index.js
// Snapshot: ${fetchedAt || new Date().toISOString()} — ${compact.length} flows
// Edge-bundle safe: no JSON import assertions needed.
export const CATALOGUE_FLOWS = ${JSON.stringify(compact, null, 0)};
`;

writeFileSync(outPath, src, 'utf8');
console.log(`Written ${compact.length} flows to api/_lib/catalogue-index.js (${Buffer.byteLength(src)} bytes)`);
