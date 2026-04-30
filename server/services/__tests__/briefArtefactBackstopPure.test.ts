/**
 * briefArtefactBackstopPure.test.ts
 *
 * Pure-function tests for the artefact backstop: ID-scope leak detection
 * and aggregate-invariant checks.
 *
 * Run via:
 *   npx tsx server/services/__tests__/briefArtefactBackstopPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  runBackstopChecksPure,
  type BackstopPureInput,
} from '../briefArtefactBackstopPure.js';
import type { BriefChatArtefact } from '../../../shared/types/briefResultContract.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRINCIPAL = { type: 'user' as const, id: 'u-1', organisationId: 'org-1', subaccountId: 'sub-1', teamIds: [] };

const BASE_CONTEXT = {
  organisationId: 'org-1',
  subaccountId: 'sub-1',
  scope: 'subaccount' as const,
  userPrincipal: PRINCIPAL,
};

function makeStructured(rowIds: string[], rowCount?: number): BriefChatArtefact {
  return {
    kind: 'structured',
    artefactId: 'art-s-1',
    summary: 'Test',
    entityType: 'contacts',
    filtersApplied: [],
    rows: rowIds.map(id => ({ id })),
    rowCount: rowCount ?? rowIds.length,
    truncated: false,
    suggestions: [],
    costCents: 0,
    source: 'canonical',
  } as BriefChatArtefact;
}

function makeApproval(affectedRecordIds: string[]): BriefChatArtefact {
  return {
    kind: 'approval',
    artefactId: 'art-a-1',
    summary: 'Send email',
    actionSlug: 'crm.send_email',
    actionArgs: {},
    affectedRecordIds,
    riskLevel: 'low',
  } as BriefChatArtefact;
}

function makeErrorArtefact(): BriefChatArtefact {
  return {
    kind: 'error',
    artefactId: 'art-e-1',
    errorCode: 'internal_error',
    message: 'Something went wrong',
  } as BriefChatArtefact;
}

function makeInput(artefact: BriefChatArtefact, overrides: Partial<BackstopPureInput> = {}): BackstopPureInput {
  return { artefact, briefContext: BASE_CONTEXT, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('structured result, no idScopeCheck, no scopedTotals → passes', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1', 'id-2'])));
  expect(result.passed, 'expected passed: true').toBeTruthy();
  expect(result.violations, 'no violations').toEqual([]);
});

test('structured result, idScopeCheck all in scope → passes', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1', 'id-2']), {
    idScopeCheck: {
      entityType: 'contacts',
      idsInScope: new Set(['id-1', 'id-2']),
      idsOutOfScope: new Set(),
    },
  }));
  expect(result.passed, 'expected passed: true').toBeTruthy();
});

test('structured result, one row ID out of scope → id_scope_leak', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1', 'id-2']), {
    idScopeCheck: {
      entityType: 'contacts',
      idsInScope: new Set(['id-1']),
      idsOutOfScope: new Set(['id-2']),
    },
  }));
  expect(!result.passed, 'expected failed').toBeTruthy();
  expect(result.violations.length === 1, 'one violation').toBeTruthy();
  expect(result.violations[0]!.kind, 'violation kind').toBe('id_scope_leak');
  const v = result.violations[0] as Extract<typeof result.violations[0], { kind: 'id_scope_leak' }>;
  expect(v.offendingIds, 'offending ID is id-2').toEqual(['id-2']);
});

test('approval card, all affectedRecordIds in scope → passes', () => {
  const result = runBackstopChecksPure(makeInput(makeApproval(['c-1', 'c-2']), {
    idScopeCheck: {
      entityType: 'contacts',
      idsInScope: new Set(['c-1', 'c-2']),
      idsOutOfScope: new Set(),
    },
  }));
  expect(result.passed, 'expected passed: true').toBeTruthy();
});

test('approval card, both affectedRecordIds out of scope → id_scope_leak', () => {
  const result = runBackstopChecksPure(makeInput(makeApproval(['c-1', 'c-2']), {
    idScopeCheck: {
      entityType: 'contacts',
      idsInScope: new Set(),
      idsOutOfScope: new Set(['c-1', 'c-2']),
    },
  }));
  expect(!result.passed, 'expected failed').toBeTruthy();
  const v = result.violations[0] as Extract<typeof result.violations[0], { kind: 'id_scope_leak' }>;
  expect(v.offendingIds.includes('c-1') && v.offendingIds.includes('c-2'), 'both IDs offending').toBeTruthy();
});

test('structured result rowCount > scopedTotal → aggregate_invariant_violation', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1'], 20), {
    scopedTotals: { entityType: 'contacts', scopedTotal: 10 },
  }));
  expect(!result.passed, 'expected failed').toBeTruthy();
  expect(result.violations[0]!.kind, 'violation kind').toBe('aggregate_invariant_violation');
});

test('structured result rowCount === scopedTotal → passes', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1'], 10), {
    scopedTotals: { entityType: 'contacts', scopedTotal: 10 },
  }));
  expect(result.passed, 'expected passed: true').toBeTruthy();
});

test('structured result rowCount < scopedTotal → passes', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1'], 5), {
    scopedTotals: { entityType: 'contacts', scopedTotal: 10 },
  }));
  expect(result.passed, 'expected passed: true').toBeTruthy();
});

test('error artefact → passes trivially (no scope-sensitive content)', () => {
  const result = runBackstopChecksPure(makeInput(makeErrorArtefact(), {
    idScopeCheck: {
      entityType: 'contacts',
      idsInScope: new Set(),
      idsOutOfScope: new Set(['x-1']),
    },
    scopedTotals: { entityType: 'contacts', scopedTotal: 0 },
  }));
  expect(result.passed, 'expected passed: true for error artefact').toBeTruthy();
  expect(result.violations, 'no violations').toEqual([]);
});

test('empty row set (rows: [], rowCount: 0) with scopedTotals → passes', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured([], 0), {
    scopedTotals: { entityType: 'contacts', scopedTotal: 5 },
  }));
  expect(result.passed, 'expected passed: true for empty result set').toBeTruthy();
});

test('combined violations: scope leak + aggregate violation on same artefact → both reported', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1', 'id-2'], 20), {
    idScopeCheck: {
      entityType: 'contacts',
      idsInScope: new Set(['id-1']),
      idsOutOfScope: new Set(['id-2']),
    },
    scopedTotals: { entityType: 'contacts', scopedTotal: 10 },
  }));
  expect(!result.passed, 'expected failed').toBeTruthy();
  expect(result.violations.length === 2, `expected 2 violations, got ${result.violations.length}`).toBeTruthy();
  const kinds = result.violations.map(v => v.kind).sort();
  expect(kinds, 'both violation kinds present').toEqual(['aggregate_invariant_violation', 'id_scope_leak']);
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');
