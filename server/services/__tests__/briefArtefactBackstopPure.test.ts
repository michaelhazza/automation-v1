/**
 * briefArtefactBackstopPure.test.ts
 *
 * Pure-function tests for the artefact backstop: ID-scope leak detection
 * and aggregate-invariant checks.
 *
 * Run via:
 *   npx tsx server/services/__tests__/briefArtefactBackstopPure.test.ts
 */

import {
  runBackstopChecksPure,
  type BackstopPureInput,
} from '../briefArtefactBackstopPure.js';
import type { BriefChatArtefact } from '../../../shared/types/briefResultContract.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
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
  assert(result.passed, 'expected passed: true');
  assertEqual(result.violations, [], 'no violations');
});

test('structured result, idScopeCheck all in scope → passes', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1', 'id-2']), {
    idScopeCheck: {
      entityType: 'contacts',
      idsInScope: new Set(['id-1', 'id-2']),
      idsOutOfScope: new Set(),
    },
  }));
  assert(result.passed, 'expected passed: true');
});

test('structured result, one row ID out of scope → id_scope_leak', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1', 'id-2']), {
    idScopeCheck: {
      entityType: 'contacts',
      idsInScope: new Set(['id-1']),
      idsOutOfScope: new Set(['id-2']),
    },
  }));
  assert(!result.passed, 'expected failed');
  assert(result.violations.length === 1, 'one violation');
  assertEqual(result.violations[0]!.kind, 'id_scope_leak', 'violation kind');
  const v = result.violations[0] as Extract<typeof result.violations[0], { kind: 'id_scope_leak' }>;
  assertEqual(v.offendingIds, ['id-2'], 'offending ID is id-2');
});

test('approval card, all affectedRecordIds in scope → passes', () => {
  const result = runBackstopChecksPure(makeInput(makeApproval(['c-1', 'c-2']), {
    idScopeCheck: {
      entityType: 'contacts',
      idsInScope: new Set(['c-1', 'c-2']),
      idsOutOfScope: new Set(),
    },
  }));
  assert(result.passed, 'expected passed: true');
});

test('approval card, both affectedRecordIds out of scope → id_scope_leak', () => {
  const result = runBackstopChecksPure(makeInput(makeApproval(['c-1', 'c-2']), {
    idScopeCheck: {
      entityType: 'contacts',
      idsInScope: new Set(),
      idsOutOfScope: new Set(['c-1', 'c-2']),
    },
  }));
  assert(!result.passed, 'expected failed');
  const v = result.violations[0] as Extract<typeof result.violations[0], { kind: 'id_scope_leak' }>;
  assert(v.offendingIds.includes('c-1') && v.offendingIds.includes('c-2'), 'both IDs offending');
});

test('structured result rowCount > scopedTotal → aggregate_invariant_violation', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1'], 20), {
    scopedTotals: { entityType: 'contacts', scopedTotal: 10 },
  }));
  assert(!result.passed, 'expected failed');
  assertEqual(result.violations[0]!.kind, 'aggregate_invariant_violation', 'violation kind');
});

test('structured result rowCount === scopedTotal → passes', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1'], 10), {
    scopedTotals: { entityType: 'contacts', scopedTotal: 10 },
  }));
  assert(result.passed, 'expected passed: true');
});

test('structured result rowCount < scopedTotal → passes', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured(['id-1'], 5), {
    scopedTotals: { entityType: 'contacts', scopedTotal: 10 },
  }));
  assert(result.passed, 'expected passed: true');
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
  assert(result.passed, 'expected passed: true for error artefact');
  assertEqual(result.violations, [], 'no violations');
});

test('empty row set (rows: [], rowCount: 0) with scopedTotals → passes', () => {
  const result = runBackstopChecksPure(makeInput(makeStructured([], 0), {
    scopedTotals: { entityType: 'contacts', scopedTotal: 5 },
  }));
  assert(result.passed, 'expected passed: true for empty result set');
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
  assert(!result.passed, 'expected failed');
  assert(result.violations.length === 2, `expected 2 violations, got ${result.violations.length}`);
  const kinds = result.violations.map(v => v.kind).sort();
  assertEqual(kinds, ['aggregate_invariant_violation', 'id_scope_leak'], 'both violation kinds present');
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
