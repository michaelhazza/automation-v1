// guard-ignore-file: pure-helper-convention reason="Pure-helper test — no DB imports; client-side pure logic"
/**
 * AgentRecommendationsListPure.test.ts
 *
 * Pure-logic tests for the collapsedDistinctScopeId dedupe + sort helpers
 * extracted to AgentRecommendationsListPure.ts.
 *
 * No React imports, no DB, no I/O.
 *
 * Runnable via:
 *   npx vitest run client/src/components/recommendations/__tests__/AgentRecommendationsListPure.test.ts
 */

import { describe, expect, test } from 'vitest';
import {
  sortRows,
  dedupeByScope,
  applyCollapsedView,
  severityRankLocal,
  type RecommendationRowShape,
} from '../AgentRecommendationsListPure.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const now = '2026-05-02T10:00:00Z';
const later = '2026-05-02T11:00:00Z';
const earliest = '2026-05-01T10:00:00Z';

function makeRow(overrides: Partial<RecommendationRowShape> & { id: string }): RecommendationRowShape {
  return {
    scope_type: 'subaccount',
    scope_id: 'scope-a',
    category: 'optimiser.agent.budget',
    severity: 'warn',
    title: 'Test',
    body: 'Body',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ── severityRankLocal ─────────────────────────────────────────────────────────

describe('severityRankLocal', () => {
  test('critical=3', () => expect(severityRankLocal('critical')).toBe(3));
  test('warn=2', () => expect(severityRankLocal('warn')).toBe(2));
  test('info=1', () => expect(severityRankLocal('info')).toBe(1));
});

// ── sortRows ──────────────────────────────────────────────────────────────────

describe('sortRows', () => {
  test('critical before warn before info', () => {
    const rows = [
      makeRow({ id: 'info', severity: 'info' }),
      makeRow({ id: 'critical', severity: 'critical' }),
      makeRow({ id: 'warn', severity: 'warn' }),
    ];
    const sorted = sortRows(rows);
    expect(sorted.map((r) => r.id)).toEqual(['critical', 'warn', 'info']);
  });

  test('newer updated_at beats older when severity equal', () => {
    const rows = [
      makeRow({ id: 'old', severity: 'warn', updated_at: earliest }),
      makeRow({ id: 'new', severity: 'warn', updated_at: later }),
    ];
    const sorted = sortRows(rows);
    expect(sorted[0].id).toBe('new');
  });

  test('returns a new array (does not mutate input)', () => {
    const rows = [
      makeRow({ id: 'a', severity: 'info' }),
      makeRow({ id: 'b', severity: 'critical' }),
    ];
    const original = [...rows];
    sortRows(rows);
    expect(rows[0].id).toBe(original[0].id);
  });
});

// ── dedupeByScope ─────────────────────────────────────────────────────────────

describe('dedupeByScope', () => {
  test('keeps one row per scope_id — highest severity wins', () => {
    const rows = [
      makeRow({ id: 'a', scope_id: 'scope-1', severity: 'info' }),
      makeRow({ id: 'b', scope_id: 'scope-1', severity: 'critical' }),
      makeRow({ id: 'c', scope_id: 'scope-2', severity: 'warn' }),
    ];
    const result = dedupeByScope(rows);
    expect(result).toHaveLength(2);
    const s1 = result.find((r) => r.scope_id === 'scope-1');
    expect(s1?.id).toBe('b'); // critical wins
  });

  test('newer updated_at wins when severity equal', () => {
    const rows = [
      makeRow({ id: 'old', scope_id: 'scope-1', severity: 'warn', updated_at: earliest }),
      makeRow({ id: 'new', scope_id: 'scope-1', severity: 'warn', updated_at: later }),
    ];
    const result = dedupeByScope(rows);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('new');
  });

  test('different scope_ids are both kept', () => {
    const rows = [
      makeRow({ id: 'a', scope_id: 'scope-1' }),
      makeRow({ id: 'b', scope_id: 'scope-2' }),
    ];
    const result = dedupeByScope(rows);
    expect(result).toHaveLength(2);
  });
});

// ── applyCollapsedView ────────────────────────────────────────────────────────

describe('applyCollapsedView — collapsed mode with deduplication', () => {
  test('dedupes when scopeType=org AND includeDescendantSubaccounts=true AND collapsedDistinctScopeId=true', () => {
    const rows = [
      makeRow({ id: 'a', scope_id: 'scope-1', severity: 'warn' }),
      makeRow({ id: 'b', scope_id: 'scope-1', severity: 'critical' }), // wins for scope-1
      makeRow({ id: 'c', scope_id: 'scope-2', severity: 'info' }),
    ];
    const result = applyCollapsedView(rows, {
      limit: 10,
      collapsedDistinctScopeId: true,
      mode: 'collapsed',
      scopeType: 'org',
      includeDescendantSubaccounts: true,
    });
    expect(result).toHaveLength(2);
    const s1 = result.find((r) => r.scope_id === 'scope-1');
    expect(s1?.id).toBe('b');
  });

  test('does NOT dedupe when scopeType=subaccount (even with collapsedDistinctScopeId=true)', () => {
    const rows = [
      makeRow({ id: 'a', scope_id: 'scope-1' }),
      makeRow({ id: 'b', scope_id: 'scope-1' }),
    ];
    const result = applyCollapsedView(rows, {
      limit: 10,
      collapsedDistinctScopeId: true,
      mode: 'collapsed',
      scopeType: 'subaccount',
      includeDescendantSubaccounts: false,
    });
    expect(result).toHaveLength(2); // no dedupe applied
  });

  test('does NOT dedupe when includeDescendantSubaccounts=false', () => {
    const rows = [
      makeRow({ id: 'a', scope_id: 'scope-1' }),
      makeRow({ id: 'b', scope_id: 'scope-1' }),
    ];
    const result = applyCollapsedView(rows, {
      limit: 10,
      collapsedDistinctScopeId: true,
      mode: 'collapsed',
      scopeType: 'org',
      includeDescendantSubaccounts: false, // off
    });
    expect(result).toHaveLength(2);
  });

  test('does NOT dedupe when collapsedDistinctScopeId=false', () => {
    const rows = [
      makeRow({ id: 'a', scope_id: 'scope-1', severity: 'warn' }),
      makeRow({ id: 'b', scope_id: 'scope-1', severity: 'critical' }),
    ];
    const result = applyCollapsedView(rows, {
      limit: 10,
      collapsedDistinctScopeId: false, // off
      mode: 'collapsed',
      scopeType: 'org',
      includeDescendantSubaccounts: true,
    });
    expect(result).toHaveLength(2);
  });

  test('limit is applied after dedupe', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({ id: `r${i}`, scope_id: `scope-${i}`, severity: 'info' }),
    );
    const result = applyCollapsedView(rows, {
      limit: 3,
      collapsedDistinctScopeId: true,
      mode: 'collapsed',
      scopeType: 'org',
      includeDescendantSubaccounts: true,
    });
    expect(result).toHaveLength(3);
  });
});

describe('applyCollapsedView — expanded mode', () => {
  test('expanded mode returns sorted rows without limit applied', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({ id: `r${i}`, scope_id: `scope-${i}`, severity: 'info' }),
    );
    const result = applyCollapsedView(rows, {
      limit: 2,
      collapsedDistinctScopeId: true,
      mode: 'expanded',
      scopeType: 'org',
      includeDescendantSubaccounts: true,
    });
    // expanded mode returns all rows sorted (no limit)
    expect(result).toHaveLength(5);
  });

  test('expanded mode still sorts by severity desc', () => {
    const rows = [
      makeRow({ id: 'info-row', severity: 'info' }),
      makeRow({ id: 'critical-row', severity: 'critical' }),
    ];
    const result = applyCollapsedView(rows, {
      limit: 10,
      collapsedDistinctScopeId: false,
      mode: 'expanded',
      scopeType: 'org',
      includeDescendantSubaccounts: false,
    });
    expect(result[0].id).toBe('critical-row');
  });
});
