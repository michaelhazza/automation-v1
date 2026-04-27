/**
 * sweepCoverageDegraded.test.ts — coverage tests for the rolling sweep-coverage
 * synthetic check. Pure decision logic on a process-local ring buffer.
 *
 *   npx tsx server/services/systemMonitor/synthetic/__tests__/sweepCoverageDegraded.test.ts
 */

import { sweepCoverageDegraded } from '../sweepCoverageDegraded.js';
import { recordSweepTick, _resetSweepTickHistory } from '../sweepTickHistory.js';
import type { HeuristicContext } from '../../heuristics/types.js';

// Six lookback ticks at 0.95 threshold ⇒ at most 0 ticks can be limit-reached
// before the rate drops below 0.95 (5/6 ≈ 0.833 → fires).
process.env.SYSTEM_MONITOR_COVERAGE_LOOKBACK_TICKS = '6';
process.env.SYSTEM_MONITOR_COVERAGE_THRESHOLD = '0.95';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  PASS  ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err instanceof Error ? err.message : err}`);
    });
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

const NOW = new Date('2026-04-25T14:00:00.000Z');
const stubCtx = (): HeuristicContext => ({
  baselines: {} as HeuristicContext['baselines'],
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as HeuristicContext['logger'],
  now: NOW,
});

function pushTicks(count: number, opts: { limitReached?: boolean; loadFailed?: boolean } = {}): void {
  const limitReached = opts.limitReached ?? false;
  const loadFailed = opts.loadFailed ?? false;
  for (let i = 0; i < count; i++) {
    recordSweepTick({
      bucketKey: `bucket-${i}`,
      candidatesEvaluated: loadFailed ? 0 : limitReached ? 200 : 10,
      limitReached,
      loadFailed,
      completedAt: new Date(NOW.getTime() - (count - i) * 60_000),
    });
  }
}

async function main(): Promise<void> {
  console.log('\nsweepCoverageDegraded');

  await test('cold-start: empty history → does not fire', async () => {
    _resetSweepTickHistory();
    const r = await sweepCoverageDegraded.run(stubCtx());
    assert(!r.fired, 'should not fire with no history');
  });

  await test('cold-start: fewer than lookback ticks → does not fire', async () => {
    _resetSweepTickHistory();
    pushTicks(3, { limitReached: true });
    const r = await sweepCoverageDegraded.run(stubCtx());
    assert(!r.fired, 'should not fire under lookback floor');
  });

  await test('healthy: all 6 ticks under cap → does not fire', async () => {
    _resetSweepTickHistory();
    pushTicks(6, { limitReached: false });
    const r = await sweepCoverageDegraded.run(stubCtx());
    assert(!r.fired, 'should not fire when all ticks healthy');
  });

  await test('degraded: 1 of 6 ticks limit-reached → fires (rate 0.83 < 0.95)', async () => {
    _resetSweepTickHistory();
    pushTicks(5, { limitReached: false });
    pushTicks(1, { limitReached: true });
    const r = await sweepCoverageDegraded.run(stubCtx());
    assert(r.fired, 'should fire — 1/6 limit-reached drops rate below 0.95');
    if (r.fired) {
      assert(r.severity === 'high', 'severity should be high');
      assert(r.resourceId === 'system-monitor-sweep', 'resource id should be the sweep job');
      assert((r.metadata as { limitReachedCount: number }).limitReachedCount === 1, 'metadata should record 1 limit-reached tick');
    }
  });

  await test('degraded: all 6 ticks limit-reached → fires (rate 0.0)', async () => {
    _resetSweepTickHistory();
    pushTicks(6, { limitReached: true });
    const r = await sweepCoverageDegraded.run(stubCtx());
    assert(r.fired, 'should fire — full degraded window');
  });

  await test('degraded: 1 of 6 ticks load-failed → fires (rate 0.83 < 0.95)', async () => {
    _resetSweepTickHistory();
    pushTicks(5, { limitReached: false });
    pushTicks(1, { loadFailed: true });
    const r = await sweepCoverageDegraded.run(stubCtx());
    assert(r.fired, 'should fire — 1/6 load-failed counts as zero coverage');
    if (r.fired) {
      assert((r.metadata as { loadFailedCount: number }).loadFailedCount === 1, 'metadata should record 1 load-failed tick');
    }
  });

  await test('degraded: all 6 ticks load-failed → fires (rate 0.0)', async () => {
    _resetSweepTickHistory();
    pushTicks(6, { loadFailed: true });
    const r = await sweepCoverageDegraded.run(stubCtx());
    assert(r.fired, 'should fire — sustained load failure');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
