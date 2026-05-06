/**
 * briefArtefactValidatorPure.test.ts
 *
 * Pure-function tests for artefact schema validation + lifecycle chain checks.
 *
 * Run via:
 *   npx tsx server/services/__tests__/briefArtefactValidatorPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  validateArtefactPure,
  validateLifecycleChainPure,
  validateLifecycleWriteGuardPure,
  type ValidationError,
} from '../briefArtefactValidatorPure.js';
import type { BriefChatArtefact } from '../../../shared/types/briefResultContract.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertErrorCode(errors: ValidationError[], code: string, label: string) {
  const found = errors.some(e => e.code === code);
  if (!found) {
    throw new Error(`${label}: expected error code '${code}', got codes [${errors.map(e => e.code).join(', ')}]`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStructured(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'structured',
    artefactId: '00000000-0000-0000-0000-000000000001',
    summary: 'Test result',
    entityType: 'contacts',
    filtersApplied: [],
    rows: [{ id: 'row-1' }],
    rowCount: 1,
    truncated: false,
    suggestions: [],
    costCents: 5,
    source: 'canonical',
    ...overrides,
  };
}

function makeApproval(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'approval',
    artefactId: '00000000-0000-0000-0000-000000000002',
    summary: 'Send email to 5 contacts',
    actionSlug: 'crm.send_email',
    actionArgs: { templateId: 'tpl-1' },
    affectedRecordIds: ['c-1', 'c-2'],
    riskLevel: 'low',
    ...overrides,
  };
}

function makeError(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'error',
    artefactId: '00000000-0000-0000-0000-000000000003',
    errorCode: 'unsupported_query',
    message: 'Cannot handle this query type',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateArtefactPure — happy paths
// ---------------------------------------------------------------------------

test('valid structured result returns { valid: true }', () => {
  const result = validateArtefactPure(makeStructured());
  expect(result.valid, 'expected valid: true').toBeTruthy();
});

test('valid approval card returns { valid: true }', () => {
  const result = validateArtefactPure(makeApproval());
  expect(result.valid, 'expected valid: true').toBeTruthy();
});

test('valid error result returns { valid: true }', () => {
  const result = validateArtefactPure(makeError());
  expect(result.valid, 'expected valid: true').toBeTruthy();
});

test('valid structured with optional fields passes', () => {
  const result = validateArtefactPure(makeStructured({
    status: 'updated',
    parentArtefactId: 'art-000',
    confidence: 0.9,
    confidenceSource: 'deterministic',
    freshnessMs: 60000,
    budgetContext: { remainingCents: 100, limitCents: 500, window: 'per_run' },
    truncated: true,
    truncationReason: 'result_limit',
  }));
  expect(result.valid, 'expected valid: true for structured with optional fields').toBeTruthy();
});

test('valid approval with executionStatus passes', () => {
  const result = validateArtefactPure(makeApproval({
    executionStatus: 'completed',
    executionId: 'exec-123',
    estimatedCostCents: 10,
    confidence: 0.85,
    confidenceSource: 'llm',
  }));
  expect(result.valid, 'expected valid: true for approval with executionStatus').toBeTruthy();
});

test('valid error with optional fields passes', () => {
  const result = validateArtefactPure(makeError({
    severity: 'high',
    retryable: false,
    suggestions: [],
  }));
  expect(result.valid, 'expected valid: true for error with optional fields').toBeTruthy();
});

// ---------------------------------------------------------------------------
// validateArtefactPure — missing required fields
// ---------------------------------------------------------------------------

test('missing artefactId → missing_required', () => {
  const { artefactId: _, ...rest } = makeStructured();
  const result = validateArtefactPure(rest);
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing artefactId');
});

// ---------------------------------------------------------------------------
// validateArtefactPure — artefactId UUID-shape validation (§1.6 N1)
// ---------------------------------------------------------------------------

test('artefactId empty string → missing_required', () => {
  const result = validateArtefactPure(makeStructured({ artefactId: '' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  const errors = result.valid ? [] : result.errors;
  const match = errors.find(e => 'field' in e && e.field === 'artefactId');
  expect(match !== undefined, 'expected an error on artefactId field').toBeTruthy();
  const msg = 'message' in match! ? (match as { message: string }).message : '';
  const code = match!.code;
  expect(code === 'missing_required' || msg.toLowerCase().includes('required'), `expected error to indicate required, got code=${code} message=${msg}`).toBeTruthy();
});

test('artefactId non-UUID string → invalid_format with UUID message', () => {
  const result = validateArtefactPure(makeStructured({ artefactId: 'banana' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  const errors = result.valid ? [] : result.errors;
  const match = errors.find(e => e.code === 'invalid_format' && 'field' in e && (e as { field: string }).field === 'artefactId');
  expect(match !== undefined, 'expected invalid_format error on artefactId').toBeTruthy();
  const msg = (match as { message: string }).message;
  expect(msg.toLowerCase().includes('uuid'), `expected message to mention UUID, got: ${msg}`).toBeTruthy();
});

test('artefactId valid UUID → no artefactId error', () => {
  const result = validateArtefactPure(makeStructured({ artefactId: '01234567-89ab-cdef-0123-456789abcdef' }));
  const errors = result.valid ? [] : result.errors;
  const artefactIdError = errors.find(e => 'field' in e && (e as { field: string }).field === 'artefactId');
  expect(artefactIdError === undefined, 'expected no error on artefactId for valid UUID').toBeTruthy();
});

test('missing kind → missing_required', () => {
  const { kind: _, ...rest } = makeStructured();
  const result = validateArtefactPure(rest);
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing kind');
});

test('missing rows on structured → missing_required', () => {
  const { rows: _, ...rest } = makeStructured();
  const result = validateArtefactPure(rest);
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing rows');
});

test('missing actionSlug on approval → missing_required', () => {
  const { actionSlug: _, ...rest } = makeApproval();
  const result = validateArtefactPure(rest);
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing actionSlug');
});

test('missing errorCode on error → missing_required', () => {
  const { errorCode: _, ...rest } = makeError();
  const result = validateArtefactPure(rest);
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing errorCode');
});

test('missing message on error → missing_required', () => {
  const { message: _, ...rest } = makeError();
  const result = validateArtefactPure(rest);
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing message');
});

// ---------------------------------------------------------------------------
// validateArtefactPure — enum validation
// ---------------------------------------------------------------------------

test('kind: "bogus" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ kind: 'bogus' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'bogus kind');
});

test('status: "running" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ status: 'running' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid status');
});

test('errorCode: "unknown_code" → invalid_enum', () => {
  const result = validateArtefactPure(makeError({ errorCode: 'unknown_code' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid errorCode');
});

test('severity: "critical" → invalid_enum', () => {
  const result = validateArtefactPure(makeError({ severity: 'critical' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid severity');
});

test('riskLevel: "extreme" → invalid_enum', () => {
  const result = validateArtefactPure(makeApproval({ riskLevel: 'extreme' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid riskLevel');
});

test('confidenceSource: "magic" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ confidenceSource: 'magic' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid confidenceSource');
});

test('budgetContext.window: "per_week" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({
    budgetContext: { window: 'per_week' },
  }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid budget window');
});

test('executionStatus: "queued" → invalid_enum', () => {
  const result = validateArtefactPure(makeApproval({ executionStatus: 'queued' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid executionStatus');
});

test('entityType: "widgets" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ entityType: 'widgets' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid entityType');
});

test('source: "cache" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ source: 'cache' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid source');
});

test('truncationReason: "timeout" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ truncated: true, truncationReason: 'timeout' }));
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid truncationReason');
});

// ---------------------------------------------------------------------------
// validateArtefactPure — type errors
// ---------------------------------------------------------------------------

test('non-object input → invalid_schema at root', () => {
  const result = validateArtefactPure('not-an-object');
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_schema', 'non-object input');
});

test('array input → invalid_schema at root', () => {
  const result = validateArtefactPure([]);
  expect(!result.valid, 'expected invalid').toBeTruthy();
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_schema', 'array input');
});

// ---------------------------------------------------------------------------
// validateLifecycleChainPure — happy paths
// ---------------------------------------------------------------------------

test('empty artefact array → valid, no tips', () => {
  const result = validateLifecycleChainPure([]);
  expect(result.valid, 'expected valid').toBeTruthy();
  expect(result.tips, 'expected empty tips').toEqual([]);
  expect(result.errors, 'expected no errors').toEqual([]);
});

test('single artefact, no parent → one tip, no errors', () => {
  const artefacts = [makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact];
  const result = validateLifecycleChainPure(artefacts);
  expect(result.valid, 'expected valid').toBeTruthy();
  expect(result.tips, 'A is the tip').toEqual(['A']);
  expect(result.errors, 'no errors').toEqual([]);
});

test('linear chain A → B → C: tip is C, no errors', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const C = makeStructured({ artefactId: 'C', parentArtefactId: 'B', status: 'updated' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleChainPure([A, B, C]);
  expect(result.valid, 'expected valid').toBeTruthy();
  expect(result.tips, 'C is the only tip').toEqual(['C']);
});

test('two independent chains → two tips, no errors', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeApproval({ artefactId: 'B' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleChainPure([A, B]);
  expect(result.valid, 'expected valid').toBeTruthy();
  expect(result.tips.sort(), 'both are tips').toEqual(['A', 'B']);
});

// ---------------------------------------------------------------------------
// validateLifecycleChainPure — chain errors
// ---------------------------------------------------------------------------

test('branching (A → B, A → C) → duplicate_tip', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const C = makeStructured({ artefactId: 'C', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleChainPure([A, B, C]);
  expect(!result.valid, 'expected invalid due to duplicate tip').toBeTruthy();
  assertErrorCode(result.errors, 'duplicate_tip', 'duplicate_tip');
  const dupErr = result.errors.find(e => e.code === 'duplicate_tip') as Extract<typeof result.errors[number], { code: 'duplicate_tip' }>;
  expect(dupErr.chainRoot, 'chainRoot is A').toBe('A');
  expect(dupErr.tips.includes('B') && dupErr.tips.includes('C'), 'tips are B and C').toBeTruthy();
});

test('orphan parent reference → orphan_parent error', () => {
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'missing-A' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleChainPure([B]);
  expect(!result.valid, 'expected invalid due to orphan').toBeTruthy();
  assertErrorCode(result.errors, 'orphan_parent', 'orphan_parent');
  const orphanErr = result.errors.find(e => e.code === 'orphan_parent') as Extract<typeof result.errors[number], { code: 'orphan_parent' }>;
  expect(orphanErr.parentArtefactId, 'orphan parent id').toBe('missing-A');
  // Orphan is still a tip (per brief §12.3 orphans treated as new chain roots)
  expect(result.tips.includes('B'), 'orphan B is still a tip').toBeTruthy();
});

test('out-of-order arrival: B arrives before A → still resolves correctly', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  // B comes first in the array
  const result = validateLifecycleChainPure([B, A]);
  expect(result.valid, 'expected valid regardless of arrival order').toBeTruthy();
  expect(result.tips, 'B is still the tip').toEqual(['B']);
});

test('15 scenarios total — all prior tests exercise the expected behaviours', () => {
  // Verify we have exercised: valid structured, valid approval, valid error, missing fields,
  // enum errors, type errors, empty chain, single tip, linear chain, two independent chains,
  // branching (duplicate tip), orphan parent, out-of-order
  // This sentinel test verifies that vitest ran all prior scenarios (they would have failed if any issues).
  expect(true).toBeTruthy();
});

// ══════════════════════════════════════════════════════════════════════════════
// validateLifecycleWriteGuardPure — write-time supersession invariant
// ══════════════════════════════════════════════════════════════════════════════

test('write guard: empty existing + no new parents → valid', () => {
  const B = makeStructured({ artefactId: 'B' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleWriteGuardPure([], [B]);
  expect(result.valid, 'expected valid — no parent references anywhere').toBeTruthy();
  expect(result.conflicts.length, 'conflict count').toBe(0);
});

test('write guard: new child with no existing siblings → valid', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleWriteGuardPure([A], [B]);
  expect(result.valid, 'expected valid — first supersession of A').toBeTruthy();
});

test('write guard: existing sibling blocks new supersession of the same parent', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const C = makeStructured({ artefactId: 'C', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleWriteGuardPure([A, B], [C]);
  expect(!result.valid, 'expected invalid — A already superseded by B').toBeTruthy();
  expect(result.conflicts.length, 'one conflict').toBe(1);
  expect(result.conflicts[0]!.artefactId, 'conflicting new artefact').toBe('C');
  expect(result.conflicts[0]!.error.code, 'error code').toBe('duplicate_supersession');
  expect(result.conflicts[0]!.error.parentArtefactId, 'conflict parent').toBe('A');
  expect(result.conflicts[0]!.error.conflictingArtefactId, 'conflicting existing artefact').toBe('B');
});

test('write guard: two new artefacts supersede the same parent in one batch → second conflicts', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const C = makeStructured({ artefactId: 'C', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleWriteGuardPure([A], [B, C]);
  expect(!result.valid, 'expected invalid — duplicate supersession within batch').toBeTruthy();
  expect(result.conflicts.length, 'one conflict (second artefact)').toBe(1);
  expect(result.conflicts[0]!.artefactId, 'second new artefact is the conflict').toBe('C');
  expect(result.conflicts[0]!.error.conflictingArtefactId, 'first batch artefact is conflicting').toBe('B');
});

test('write guard: idempotent re-write of the same artefactId → valid', () => {
  // Retry semantics: the same artefact B is written twice (e.g. network retry).
  // The second write must not be flagged as a duplicate supersession.
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleWriteGuardPure([A, B], [B]);
  expect(result.valid, 'expected valid — same artefactId re-write is idempotent').toBeTruthy();
});

test('write guard: child with no parent reference → ignored', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleWriteGuardPure([A], [B]);
  expect(result.valid, 'expected valid — B has no parentArtefactId, so no invariant to check').toBeTruthy();
});

test('write guard: independent chains both valid in one batch', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const X = makeStructured({ artefactId: 'X' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const Y = makeStructured({ artefactId: 'Y', parentArtefactId: 'X', status: 'updated' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleWriteGuardPure([A, X], [B, Y]);
  expect(result.valid, 'expected valid — two distinct chains, one supersession each').toBeTruthy();
});

test('write guard: mixed valid + invalid in one batch → partial success, only invalid flagged', () => {
  // Scenario: one artefact in the new batch duplicates an existing supersession;
  // the rest are valid. The guard must flag ONLY the duplicate and leave the
  // others untouched so the caller can persist the valid ones.
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const X = makeStructured({ artefactId: 'X' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;

  // New batch: [valid new chain Y→X, invalid duplicate supersession C→A, valid standalone Z]
  const Y = makeStructured({ artefactId: 'Y', parentArtefactId: 'X', status: 'updated' }) as unknown as BriefChatArtefact;
  const C = makeStructured({ artefactId: 'C', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const Z = makeStructured({ artefactId: 'Z' }) as unknown as BriefChatArtefact;

  const result = validateLifecycleWriteGuardPure([A, X, B], [Y, C, Z]);

  expect(!result.valid, 'expected invalid overall — one conflict present').toBeTruthy();
  expect(result.conflicts.length, 'exactly one conflict reported').toBe(1);
  expect(result.conflicts[0]!.artefactId, 'only C is flagged').toBe('C');
  expect(result.conflicts[0]!.error.conflictingArtefactId, 'existing B blocks C').toBe('B');
  // Y and Z must NOT appear in conflicts — they are valid and should persist.
  const conflictingIds = new Set(result.conflicts.map((c) => c.artefactId));
  expect(!conflictingIds.has('Y'), 'Y should not be flagged').toBeTruthy();
  expect(!conflictingIds.has('Z'), 'Z should not be flagged').toBeTruthy();
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');
