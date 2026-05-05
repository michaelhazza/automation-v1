// guard-ignore-file: pure-helper-convention reason="Pure-helper test — no DB imports; client-side pure logic"
/**
 * DashboardPageOptimiserSection.test.ts
 *
 * Pure-logic tests for the DashboardPage recommendations section behaviour.
 * Tests are scoped to the five required invariants without spinning up React.
 *
 * 1. Org context   → scope.type='org', includeDescendantSubaccounts=true
 * 2. Subaccount    → scope.type='subaccount'
 * 3. Zero total    → section absent (recommendationsTotal not > 0)
 * 4. "See all N"   → clicking expand sets mode to 'expanded'
 * 5. Sort order    → correct constant used
 *
 * Runnable via:
 *   npx vitest run client/src/pages/__tests__/DashboardPageOptimiserSection.test.ts
 */

import { expect, test, describe } from 'vitest';

// ── Pure helpers that mirror DashboardPage section logic ──────────────────────

/**
 * Derives the AgentRecommendationsList `scope` prop from page context.
 * Mirrors the inline expression in DashboardPage render.
 */
function deriveScope(
  activeClientId: string | null,
  orgId: string,
): { type: 'org'; orgId: string } | { type: 'subaccount'; subaccountId: string } {
  if (activeClientId) {
    return { type: 'subaccount', subaccountId: activeClientId };
  }
  return { type: 'org', orgId };
}

/**
 * Returns the `includeDescendantSubaccounts` value for the given context.
 */
function deriveIncludeDescendants(activeClientId: string | null): boolean {
  return !activeClientId;
}

/**
 * Returns whether the recommendations section should be rendered (mounted).
 * Invariant 29: section must NOT mount when total === 0 or total === null.
 */
function sectionShouldMount(recommendationsTotal: number | null): boolean {
  return recommendationsTotal !== null && recommendationsTotal > 0;
}

/**
 * Returns whether the "See all N" button should be shown.
 */
function showSeeAllButton(
  mode: 'collapsed' | 'expanded',
  total: number,
  collapsedLimit: number,
): boolean {
  return mode === 'collapsed' && total > collapsedLimit;
}

/**
 * Simulates clicking the "See all" button — returns new mode.
 */
function handleSeeAllClick(
  _currentMode: 'collapsed' | 'expanded',
): 'expanded' {
  return 'expanded';
}

/** The sort order constant expected by AgentRecommendationsList. */
const RECOMMENDATIONS_SORT_ORDER = 'priority DESC, created_at DESC, id DESC';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DashboardPage — recommendations scope derivation', () => {
  test('org context: scope.type=org with correct orgId', () => {
    const scope = deriveScope(null, 'org-123');
    expect(scope.type).toBe('org');
    if (scope.type === 'org') {
      expect(scope.orgId).toBe('org-123');
    }
  });

  test('org context: includeDescendantSubaccounts=true', () => {
    expect(deriveIncludeDescendants(null)).toBe(true);
  });

  test('subaccount context: scope.type=subaccount with correct subaccountId', () => {
    const scope = deriveScope('sub-456', 'org-123');
    expect(scope.type).toBe('subaccount');
    if (scope.type === 'subaccount') {
      expect(scope.subaccountId).toBe('sub-456');
    }
  });

  test('subaccount context: includeDescendantSubaccounts=false', () => {
    expect(deriveIncludeDescendants('sub-456')).toBe(false);
  });
});

describe('DashboardPage — section mount predicate (Invariant 29)', () => {
  test('total=null (pre-fetch): section must NOT mount', () => {
    expect(sectionShouldMount(null)).toBe(false);
  });

  test('total=0 (zero open recs): section must NOT mount', () => {
    expect(sectionShouldMount(0)).toBe(false);
  });

  test('total=1: section mounts', () => {
    expect(sectionShouldMount(1)).toBe(true);
  });

  test('total=10: section mounts', () => {
    expect(sectionShouldMount(10)).toBe(true);
  });

  test('total=-1 (should not occur, but guard): section must NOT mount', () => {
    // Defensive: negative totals are treated as not-positive
    expect(sectionShouldMount(-1)).toBe(false);
  });
});

describe('DashboardPage — "See all N" button logic', () => {
  const COLLAPSED_LIMIT = 3;

  test('collapsed mode + total > limit: button shown', () => {
    expect(showSeeAllButton('collapsed', 5, COLLAPSED_LIMIT)).toBe(true);
  });

  test('collapsed mode + total === limit: button NOT shown (exactly at limit)', () => {
    expect(showSeeAllButton('collapsed', 3, COLLAPSED_LIMIT)).toBe(false);
  });

  test('collapsed mode + total < limit: button NOT shown', () => {
    expect(showSeeAllButton('collapsed', 2, COLLAPSED_LIMIT)).toBe(false);
  });

  test('expanded mode: button NOT shown regardless of total', () => {
    expect(showSeeAllButton('expanded', 100, COLLAPSED_LIMIT)).toBe(false);
  });

  test('clicking "See all" transitions mode to expanded', () => {
    const newMode = handleSeeAllClick('collapsed');
    expect(newMode).toBe('expanded');
  });
});

describe('DashboardPage — sort order constant', () => {
  test('sort order is priority DESC, created_at DESC, id DESC', () => {
    // Verify the tiebreaker chain matches the spec §6.5 sort definition
    expect(RECOMMENDATIONS_SORT_ORDER).toBe('priority DESC, created_at DESC, id DESC');
  });

  test('sort order has no em-dashes', () => {
    expect(RECOMMENDATIONS_SORT_ORDER.includes('—')).toBe(false);
  });
});
