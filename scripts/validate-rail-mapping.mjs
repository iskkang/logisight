import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ruleParseEvent } = require('../src/rail/ruleParseEvent');
const { matchCorridors } = require('../src/rail/matchCorridors');
const { scoreEvent } = require('../src/rail/scoreEvent');
const { recomputeCorridorStatus } = require('../src/rail/recomputeStatus');

const SAMPLES = [
  {
    name: 'BNSF Transcon interruption',
    source: 'bnsf',
    text: 'BNSF is addressing service interruptions on the Southern Transcon near Marceline, Missouri.',
    expectCorridor: 'LALB_CHI_BNSF',
  },
  {
    name: 'UP Sunset weather',
    source: 'up',
    text: 'Union Pacific weather advisory affecting the Sunset Route near El Paso.',
    expectCorridor: 'LALB_DAL_UP',
  },
  {
    name: 'CN embargo Prince Rupert',
    source: 'aar',
    text: 'An embargo has been issued affecting CN traffic to the Prince Rupert Fairview terminal.',
    expectCorridor: 'PRR_CHI_CN',
  },
  {
    name: 'POLB dwell',
    source: 'polb',
    meta: { event_type: 'terminal_dwell', port: 'polb', location_text: 'Port of Long Beach' },
    text: 'Port of Long Beach on-dock rail dwell elevated.',
    expectCorridor: 'LALB_CHI_BNSF',
  },
  {
    name: 'UP system-wide',
    source: 'up',
    text: 'Union Pacific reports system-wide network congestion.',
    expectCorridor: 'LALB_CHI_UP',
  },
  {
    name: 'macro SCFI unmapped',
    source: 'news',
    text: 'SCFI composite index rose 3% this week on transpacific demand.',
    expectCorridor: null,
  },
];

let pass = 0;
let fail = 0;
const scored = [];
const failures = [];

for (const sample of SAMPLES) {
  const base = ruleParseEvent(sample.text, { source: sample.source, ...(sample.meta || {}) });
  const parsed = sample.meta?.event_type ? { ...base, event_type: sample.meta.event_type } : base;
  const match = matchCorridors({ ...parsed, port: sample.meta?.port });
  const score = scoreEvent(parsed, match.scope);
  const ok = sample.expectCorridor
    ? match.corridorCodes.includes(sample.expectCorridor)
    : match.corridorCodes.length === 0;

  if (match.corridorCodes.length) {
    scored.push({ id: sample.name, ...parsed, corridorCodes: match.corridorCodes, scope: match.scope, score });
  }

  console.log(`\n[${sample.name}]`);
  console.log(`  parsed: rr=${parsed.railroad} type=${parsed.event_type} sev=${parsed.severity} conf=${parsed.confidence_score}`);
  console.log(`  match: ${match.corridorCodes.join(',') || '(none)'} scope=${match.scope} score=${score}`);
  console.log(`  expected corridor=${sample.expectCorridor ?? '(none)'} -> ${ok ? 'OK' : 'FAIL'}`);

  if (ok) pass += 1;
  else {
    fail += 1;
    failures.push({ sample: sample.name, expected: sample.expectCorridor, actual: match.corridorCodes, stage: 'mapping' });
  }
}

const statuses = recomputeCorridorStatus(scored);
console.log('\n=== recomputed corridor status ===');
for (const status of statuses) {
  console.log(`  ${status.corridor_code.padEnd(14)} ${String(status.status).padEnd(8)} score=${status.score ?? '-'}`);
}

console.log(`\n결과: PASS ${pass}/${SAMPLES.length}`);
if (fail > 0) {
  console.log('\nFAIL samples:');
  for (const failure of failures) {
    console.log(`  ${failure.sample}: expected=${failure.expected ?? '(none)'} actual=${failure.actual.join(',') || '(none)'} stage=${failure.stage}`);
  }
  process.exit(1);
}
