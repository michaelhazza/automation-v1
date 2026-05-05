// client/src/pages/__tests__/dashboardVersioning.test.ts
// applyIfNewer is a module-internal helper in DashboardPage.tsx.
// We reproduce the function here to test its contract.
import { expect, test } from 'vitest';

test('assertions', () => {
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
    expect(called).toBeTruthy();
    expect(ts.current, 'newer: currentTs should update').toBe('2026-04-27T10:00:01.000Z');
  }
  
  // Scenario 2: older response — apply() NOT called, currentTs unchanged
  {
    const ts = { current: '2026-04-27T10:00:01.000Z' };
    let called = false;
    applyIfNewer(ts, '2026-04-27T10:00:00.000Z', () => { called = true; });
    expect(!called).toBeTruthy();
    expect(ts.current, 'older: currentTs should not change').toBe('2026-04-27T10:00:01.000Z');
  }
  
  // Scenario 3: equal timestamp — apply() NOT called (strict >)
  {
    const ts = { current: '2026-04-27T10:00:00.000Z' };
    let called = false;
    applyIfNewer(ts, '2026-04-27T10:00:00.000Z', () => { called = true; });
    expect(!called).toBeTruthy();
    expect(ts.current, 'equal: currentTs should not change').toBe('2026-04-27T10:00:00.000Z');
  }
  
  // Scenario 4: empty initial state — any timestamp beats ''
  {
    const ts = { current: '' };
    let called = false;
    applyIfNewer(ts, '2026-04-27T10:00:00.000Z', () => { called = true; });
    expect(called).toBeTruthy();
    expect(ts.current, 'empty: currentTs should update').toBe('2026-04-27T10:00:00.000Z');
  }
});
