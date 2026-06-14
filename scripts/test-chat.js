/**
 * Local test harness for api/chat.js.
 * Usage: node --env-file=.env scripts/test-chat.js
 * Or:    npm run test:chat
 *
 * Requires GEMINI_API_KEY in .env (copy .env.example → .env and fill it in).
 */

import handler from '../api/chat.js';

const QUESTIONS = [
  'What is the current unemployment rate in OECD countries?',
  'How does GDP growth compare across OECD nations?',
  'How much do OECD countries spend on healthcare as a percentage of GDP?',
  'What is Turkey\'s education spending per student?',
  'What is the population of Mars?'
];

async function ask(question) {
  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question })
  });

  const res = await handler(req);
  return { status: res.status, body: await res.json() };
}

function summarise(question, status, body) {
  const lines = [
    `Q: ${question}`,
    `HTTP: ${status} | matched: ${body.matched}`
  ];
  if (body.matched) {
    const c = body.citation;
    lines.push(`Citation: ${c.indicatorName} [${c.agency} / ${c.dataflowId}]`);
    lines.push(`Series length: ${body.series?.length ?? 0}`);
    lines.push(`Answer: ${body.answer}`);
  } else {
    lines.push(`Out-of-scope note: ${body.outOfScopeNote}`);
    lines.push(`Answer: ${body.answer}`);
  }
  if (body.error) lines.push(`Error: ${body.error}`);
  return lines.join('\n');
}

console.log('=== StatPulse api/chat.js test harness ===\n');

for (const q of QUESTIONS) {
  console.log('─'.repeat(70));
  try {
    const { status, body } = await ask(q);
    console.log(summarise(q, status, body));
  } catch (err) {
    console.log(`Q: ${q}`);
    console.error(`HARNESS ERROR: ${err.message}`);
  }
  console.log();
}

console.log('─'.repeat(70));
console.log('Done.');
