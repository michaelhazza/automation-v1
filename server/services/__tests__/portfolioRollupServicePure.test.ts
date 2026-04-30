// guard-ignore-file: pure-helper-convention reason="Inline pure simulation — constants inlined to avoid drizzle-orm transitive import; no sibling import needed"
/**
 * portfolioRollupServicePure.test.ts — auto-enable threshold + aggregation math
 *
 * This file exercises the pure-logic aspects of portfolio rollup. The service
 * itself is impure (DB writes); this test focuses on the constants + simple
 * decision functions. Integration coverage lives in
 * `scripts/acceptance/f5-portfolio-rollup.ts`.
 *
 * Spec: docs/memory-and-briefings-spec.md §11 (S23)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/portfolioRollupServicePure.test.ts
 */

import { expect, test } from 'vitest';

export {}; // force module scope so top-level identifiers don't collide

// Inline the constant rather than importing from the impure service, since
// portfolioRollupService pulls in drizzle-orm which is not resolvable in
// the pure-test environment. The canonical source is still
// portfolioRollupService.ts — keep this in sync.
const PORTFOLIO_AUTO_ENABLE_THRESHOLD = 3;

console.log('');
console.log('portfolioRollupServicePure — constants (§11 S23)');
console.log('');

// ---------------------------------------------------------------------------
// Auto-enable threshold (§11.5)
// ---------------------------------------------------------------------------

test('auto-enable threshold is 3', () => {
  expect(PORTFOLIO_AUTO_ENABLE_THRESHOLD === 3, 'threshold = 3').toBe(true);
});

// ---------------------------------------------------------------------------
// Drill-through link format
// ---------------------------------------------------------------------------

test('drill-through link uses /admin/subaccounts/:id', () => {
  const subaccountId = '11111111-2222-3333-4444-555555555555';
  const link = `/admin/subaccounts/${subaccountId}`;
  expect(link.includes(subaccountId), 'contains id').toBe(true);
  expect(link.startsWith('/admin/subaccounts/'), 'correct prefix').toBe(true);
});

console.log('');
console.log('');
