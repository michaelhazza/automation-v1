/**
 * scheduleCalendarParity.test.ts — projection/execution parity surrogate.
 *
 * Spec §3.7 calls for an end-to-end "seed an agent, run the scheduler for a
 * fixed window, diff projected vs actual" integration test. That requires
 * booting pg-boss, a real database, and (for heartbeat) a dispatcher that
 * doesn't exist yet. See the gap note at the bottom of this file.
 *
 * Until those are in place, this file acts as a *surrogate* parity test.
 * It enforces the §3.9 projection–execution parity invariant by proving:
 *
 *   1. `projectCronOccurrences` produces the same timestamps as a direct
 *      `cron-parser` invocation with the same expression + timezone pair.
 *      pg-boss uses cron-parser internally, so matching cron-parser is a
 *      sufficient condition for matching pg-boss's cron dispatch.
 *
 *   2. `projectHeartbeatOccurrences` (via `computeNextHeartbeatAt`) is a
 *      pure function of (afterMs, intervalHours, offsetHours, offsetMinutes)
 *      and satisfies the contract the heartbeat dispatcher (when wired)
 *      must conform to: next fire strictly after `afterMs`, UTC-anchored,
 *      DST-invariant. Any dispatcher implementation that deviates from
 *      this contract will diverge from the calendar and must be fixed.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/scheduleCalendarParity.test.ts
 */

import {
  projectCronOccurrences,
  computeNextHeartbeatAt,
  projectHeartbeatOccurrences,
} from '../scheduleCalendarServicePure.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}
function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const BASE = { subaccountId: 'sa-1', subaccountName: 'sa', scopeTag: 'subaccount' as const };

console.log('\nscheduleCalendarParity — Cron parity with cron-parser\n');

await test('projectCronOccurrences: matches cron-parser output exactly (UTC)', async () => {
  const expression = '*/15 * * * *'; // every 15 min
  const tz = 'UTC';
  const start = Date.UTC(2026, 6, 1, 0, 0, 0);
  const end = Date.UTC(2026, 6, 1, 4, 0, 0); // 4-hour window → 16 fires

  const projected = await projectCronOccurrences(
    { ...BASE, cronExpression: expression, cronTimezone: tz, sourceId: 'c1', sourceName: 'c1' },
    start,
    end
  );

  // Golden reference: call cron-parser directly with the same args the
  // pure layer uses. If this drifts, the pure layer is out of parity.
  const cronParser = await import('cron-parser');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parse = (cronParser as any).default?.parseExpression ?? (cronParser as any).parseExpression;
  const iter = parse(expression, {
    tz,
    currentDate: new Date(start - 1),
    endDate: new Date(end),
  });
  const golden: string[] = [];
  while (iter.hasNext()) {
    const d = iter.next().toDate();
    if (d.getTime() >= end) break;
    golden.push(d.toISOString());
  }

  assertEqual(projected.length, golden.length, 'count');
  assertEqual(
    projected.map((o) => o.scheduledAt.toISOString()),
    golden,
    'timestamps'
  );
});

await test('projectCronOccurrences: matches cron-parser across DST boundary (America/New_York)', async () => {
  const expression = '0 10 * * *';
  const tz = 'America/New_York';
  // Window spans the 2026-03-08 spring-forward boundary.
  const start = Date.UTC(2026, 2, 6, 0, 0, 0);
  const end = Date.UTC(2026, 2, 10, 0, 0, 0);

  const projected = await projectCronOccurrences(
    { ...BASE, cronExpression: expression, cronTimezone: tz, sourceId: 'c-dst', sourceName: 'c-dst' },
    start,
    end
  );

  const cronParser = await import('cron-parser');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parse = (cronParser as any).default?.parseExpression ?? (cronParser as any).parseExpression;
  const iter = parse(expression, {
    tz,
    currentDate: new Date(start - 1),
    endDate: new Date(end),
  });
  const golden: string[] = [];
  while (iter.hasNext()) {
    const d = iter.next().toDate();
    if (d.getTime() >= end) break;
    golden.push(d.toISOString());
  }

  assertEqual(
    projected.map((o) => o.scheduledAt.toISOString()),
    golden,
    'timestamps across DST match cron-parser exactly'
  );
  // Sanity: post-DST fire is one UTC hour earlier than pre-DST fire
  // because NY moves from UTC-5 to UTC-4.
  const preDst = projected.find((o) => o.scheduledAt.getUTCDate() === 7);
  const postDst = projected.find((o) => o.scheduledAt.getUTCDate() === 9);
  assert(!!preDst && !!postDst, 'pre + post DST fires present');
  assertEqual(preDst!.scheduledAt.getUTCHours(), 15, 'pre-DST 10:00 NY = 15:00 UTC');
  assertEqual(postDst!.scheduledAt.getUTCHours(), 14, 'post-DST 10:00 NY = 14:00 UTC');
});

console.log('\nscheduleCalendarParity — Heartbeat contract parity\n');

await test('computeNextHeartbeatAt: next fire is strictly after afterMs', () => {
  // Contract: returns smallest k*interval+offset > afterMs for integer k >= 0.
  const interval = 3;
  const offH = 1;
  const offM = 30;
  for (const seed of [0, 1, 1000, 7 * 60 * 60 * 1000, 86_400_000]) {
    const next = computeNextHeartbeatAt(seed, interval, offH, offM);
    assert(next > seed, `next (${next}) > seed (${seed})`);
    // Lattice check: (next - offset) must be a positive multiple of interval.
    const offsetMs = (offH * 60 + offM) * 60 * 1000;
    const intervalMs = interval * 60 * 60 * 1000;
    const k = (next - offsetMs) / intervalMs;
    assert(Number.isInteger(k) && k >= 0, `k (${k}) is a non-negative integer`);
  }
});

await test('computeNextHeartbeatAt: UTC-anchored — DST boundary produces constant UTC interval', () => {
  // Cross the 2026-03-08 NY spring-forward boundary with a 1h heartbeat.
  // Heartbeat contract (§3.9): constant UTC interval, DST-invariant.
  const boundary = Date.UTC(2026, 2, 8, 6, 0, 0); // 06:00 UTC = 01:00 EST
  const next1 = computeNextHeartbeatAt(boundary, 1, 0, 0);
  const next2 = computeNextHeartbeatAt(next1, 1, 0, 0);
  const next3 = computeNextHeartbeatAt(next2, 1, 0, 0);
  const HOUR = 60 * 60 * 1000;
  assertEqual(next1 - boundary, HOUR, 'first interval');
  assertEqual(next2 - next1, HOUR, 'second interval (spans DST)');
  assertEqual(next3 - next2, HOUR, 'third interval');
});

await test('projectHeartbeatOccurrences: projection cadence is uniform across DST', () => {
  // Project across a DST boundary and assert uniform interval spacing.
  const start = Date.UTC(2026, 2, 7, 0, 0, 0);
  const end = Date.UTC(2026, 2, 10, 0, 0, 0); // 3 days
  const out = projectHeartbeatOccurrences(
    {
      ...BASE,
      intervalHours: 6,
      offsetHours: 0,
      offsetMinutes: 0,
      sourceId: 'hb-1',
      sourceName: 'hb',
    },
    start,
    end
  );
  // 3 days × 24 = 72 hours; 72 / 6 = 12 → 12 fires (inclusive-start, exclusive-end).
  assertEqual(out.length, 12, 'count');
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  for (let i = 1; i < out.length; i++) {
    const delta = out[i].scheduledAt.getTime() - out[i - 1].scheduledAt.getTime();
    assertEqual(delta, SIX_HOURS, `interval between fire ${i - 1} and ${i}`);
  }
});

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);

// ---------------------------------------------------------------------------
// Parity gap — heartbeat dispatcher not yet wired.
// ---------------------------------------------------------------------------
// The spec §3.7 calls for an end-to-end parity test that runs the scheduler
// for a fixed window and diffs `agent_runs.startedAt` against projected
// `scheduledAt` timestamps within a 60s tolerance. The cron half of this is
// covered by the surrogate test above (same library as pg-boss). The
// heartbeat half cannot be covered until the heartbeat dispatcher lands —
// today there is no code path that actually fires heartbeat jobs, so there
// is nothing for the calendar projection to diverge from.
//
// When the heartbeat dispatcher ships, extend this file with an integration
// variant that seeds a heartbeat agent + link, runs pg-boss in a sandbox for
// one window, and asserts projected ≡ actual ± 60s tolerance. Marking this
// explicitly instead of silently skipping so future sessions can't miss it.
// ---------------------------------------------------------------------------

if (failed > 0) process.exit(1);
