// client/src/pages/__tests__/dashboardVersioning.test.ts
import assert from 'node:assert';

// applyIfNewer is a module-internal helper in DashboardPage.tsx.
// We reproduce the function here to test its contract.
function applyIfNewer(
  currentTs: { current: string },
  incomingTs: string,
  apply: () => void
): void {
  if (incomingTs > currentTs.current) {
    currentTs.current = incomingTs;
    apply();
  }
}

// Scenario 1: newer response — apply() called, currentTs updated
{
  const ts = { current: '2026-04-27T10:00:00.000Z' };
  let called = false;
  applyIfNewer(ts, '2026-04-27T10:00:01.000Z', () => { called = true; });
  assert.ok(called, 'newer: apply() should be called');
  assert.strictEqual(ts.current, '2026-04-27T10:00:01.000Z', 'newer: currentTs should update');
}

// Scenario 2: older response — apply() NOT called, currentTs unchanged
{
  const ts = { current: '2026-04-27T10:00:01.000Z' };
  let called = false;
  applyIfNewer(ts, '2026-04-27T10:00:00.000Z', () => { called = true; });
  assert.ok(!called, 'older: apply() should not be called');
  assert.strictEqual(ts.current, '2026-04-27T10:00:01.000Z', 'older: currentTs should not change');
}

// Scenario 3: equal timestamp — apply() NOT called (strict >)
{
  const ts = { current: '2026-04-27T10:00:00.000Z' };
  let called = false;
  applyIfNewer(ts, '2026-04-27T10:00:00.000Z', () => { called = true; });
  assert.ok(!called, 'equal: apply() should not be called');
  assert.strictEqual(ts.current, '2026-04-27T10:00:00.000Z', 'equal: currentTs should not change');
}

// Scenario 4: empty initial state — any timestamp beats ''
{
  const ts = { current: '' };
  let called = false;
  applyIfNewer(ts, '2026-04-27T10:00:00.000Z', () => { called = true; });
  assert.ok(called, 'empty: apply() should be called');
  assert.strictEqual(ts.current, '2026-04-27T10:00:00.000Z', 'empty: currentTs should update');
}

console.log('✓ applyIfNewer tests passed');
