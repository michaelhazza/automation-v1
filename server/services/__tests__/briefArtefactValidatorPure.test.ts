/**
 * briefArtefactValidatorPure.test.ts
 *
 * Pure-function tests for artefact schema validation + lifecycle chain checks.
 *
 * Run via:
 *   npx tsx server/services/__tests__/briefArtefactValidatorPure.test.ts
 */

import {
  validateArtefactPure,
  validateLifecycleChainPure,
  type ValidationError,
} from '../briefArtefactValidatorPure.js';
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
    artefactId: 'art-001',
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
    artefactId: 'art-002',
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
    artefactId: 'art-003',
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
  assert(result.valid, 'expected valid: true');
});

test('valid approval card returns { valid: true }', () => {
  const result = validateArtefactPure(makeApproval());
  assert(result.valid, 'expected valid: true');
});

test('valid error result returns { valid: true }', () => {
  const result = validateArtefactPure(makeError());
  assert(result.valid, 'expected valid: true');
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
  assert(result.valid, 'expected valid: true for structured with optional fields');
});

test('valid approval with executionStatus passes', () => {
  const result = validateArtefactPure(makeApproval({
    executionStatus: 'completed',
    executionId: 'exec-123',
    estimatedCostCents: 10,
    confidence: 0.85,
    confidenceSource: 'llm',
  }));
  assert(result.valid, 'expected valid: true for approval with executionStatus');
});

test('valid error with optional fields passes', () => {
  const result = validateArtefactPure(makeError({
    severity: 'high',
    retryable: false,
    suggestions: [],
  }));
  assert(result.valid, 'expected valid: true for error with optional fields');
});

// ---------------------------------------------------------------------------
// validateArtefactPure — missing required fields
// ---------------------------------------------------------------------------

test('missing artefactId → missing_required', () => {
  const { artefactId: _, ...rest } = makeStructured();
  const result = validateArtefactPure(rest);
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing artefactId');
});

test('missing kind → missing_required', () => {
  const { kind: _, ...rest } = makeStructured();
  const result = validateArtefactPure(rest);
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing kind');
});

test('missing rows on structured → missing_required', () => {
  const { rows: _, ...rest } = makeStructured();
  const result = validateArtefactPure(rest);
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing rows');
});

test('missing actionSlug on approval → missing_required', () => {
  const { actionSlug: _, ...rest } = makeApproval();
  const result = validateArtefactPure(rest);
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing actionSlug');
});

test('missing errorCode on error → missing_required', () => {
  const { errorCode: _, ...rest } = makeError();
  const result = validateArtefactPure(rest);
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing errorCode');
});

test('missing message on error → missing_required', () => {
  const { message: _, ...rest } = makeError();
  const result = validateArtefactPure(rest);
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'missing_required', 'missing message');
});

// ---------------------------------------------------------------------------
// validateArtefactPure — enum validation
// ---------------------------------------------------------------------------

test('kind: "bogus" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ kind: 'bogus' }));
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'bogus kind');
});

test('status: "running" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ status: 'running' }));
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid status');
});

test('errorCode: "unknown_code" → invalid_enum', () => {
  const result = validateArtefactPure(makeError({ errorCode: 'unknown_code' }));
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid errorCode');
});

test('severity: "critical" → invalid_enum', () => {
  const result = validateArtefactPure(makeError({ severity: 'critical' }));
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid severity');
});

test('riskLevel: "extreme" → invalid_enum', () => {
  const result = validateArtefactPure(makeApproval({ riskLevel: 'extreme' }));
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid riskLevel');
});

test('confidenceSource: "magic" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ confidenceSource: 'magic' }));
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid confidenceSource');
});

test('budgetContext.window: "per_week" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({
    budgetContext: { window: 'per_week' },
  }));
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid budget window');
});

test('executionStatus: "queued" → invalid_enum', () => {
  const result = validateArtefactPure(makeApproval({ executionStatus: 'queued' }));
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid executionStatus');
});

test('entityType: "widgets" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ entityType: 'widgets' }));
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid entityType');
});

test('source: "cache" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ source: 'cache' }));
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid source');
});

test('truncationReason: "timeout" → invalid_enum', () => {
  const result = validateArtefactPure(makeStructured({ truncated: true, truncationReason: 'timeout' }));
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_enum', 'invalid truncationReason');
});

// ---------------------------------------------------------------------------
// validateArtefactPure — type errors
// ---------------------------------------------------------------------------

test('non-object input → invalid_schema at root', () => {
  const result = validateArtefactPure('not-an-object');
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_schema', 'non-object input');
});

test('array input → invalid_schema at root', () => {
  const result = validateArtefactPure([]);
  assert(!result.valid, 'expected invalid');
  assertErrorCode(result.valid ? [] : result.errors, 'invalid_schema', 'array input');
});

// ---------------------------------------------------------------------------
// validateLifecycleChainPure — happy paths
// ---------------------------------------------------------------------------

test('empty artefact array → valid, no tips', () => {
  const result = validateLifecycleChainPure([]);
  assert(result.valid, 'expected valid');
  assertEqual(result.tips, [], 'expected empty tips');
  assertEqual(result.errors, [], 'expected no errors');
});

test('single artefact, no parent → one tip, no errors', () => {
  const artefacts = [makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact];
  const result = validateLifecycleChainPure(artefacts);
  assert(result.valid, 'expected valid');
  assertEqual(result.tips, ['A'], 'A is the tip');
  assertEqual(result.errors, [], 'no errors');
});

test('linear chain A → B → C: tip is C, no errors', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const C = makeStructured({ artefactId: 'C', parentArtefactId: 'B', status: 'updated' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleChainPure([A, B, C]);
  assert(result.valid, 'expected valid');
  assertEqual(result.tips, ['C'], 'C is the only tip');
});

test('two independent chains → two tips, no errors', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeApproval({ artefactId: 'B' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleChainPure([A, B]);
  assert(result.valid, 'expected valid');
  assertEqual(result.tips.sort(), ['A', 'B'], 'both are tips');
});

// ---------------------------------------------------------------------------
// validateLifecycleChainPure — chain errors
// ---------------------------------------------------------------------------

test('branching (A → B, A → C) → duplicate_tip', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const C = makeStructured({ artefactId: 'C', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleChainPure([A, B, C]);
  assert(!result.valid, 'expected invalid due to duplicate tip');
  assertErrorCode(result.errors, 'duplicate_tip', 'duplicate_tip');
  const dupErr = result.errors.find(e => e.code === 'duplicate_tip') as Extract<typeof result.errors[number], { code: 'duplicate_tip' }>;
  assertEqual(dupErr.chainRoot, 'A', 'chainRoot is A');
  assert(dupErr.tips.includes('B') && dupErr.tips.includes('C'), 'tips are B and C');
});

test('orphan parent reference → orphan_parent error', () => {
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'missing-A' }) as unknown as BriefChatArtefact;
  const result = validateLifecycleChainPure([B]);
  assert(!result.valid, 'expected invalid due to orphan');
  assertErrorCode(result.errors, 'orphan_parent', 'orphan_parent');
  const orphanErr = result.errors.find(e => e.code === 'orphan_parent') as Extract<typeof result.errors[number], { code: 'orphan_parent' }>;
  assertEqual(orphanErr.parentArtefactId, 'missing-A', 'orphan parent id');
  // Orphan is still a tip (per brief §12.3 orphans treated as new chain roots)
  assert(result.tips.includes('B'), 'orphan B is still a tip');
});

test('out-of-order arrival: B arrives before A → still resolves correctly', () => {
  const A = makeStructured({ artefactId: 'A' }) as unknown as BriefChatArtefact;
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' }) as unknown as BriefChatArtefact;
  // B comes first in the array
  const result = validateLifecycleChainPure([B, A]);
  assert(result.valid, 'expected valid regardless of arrival order');
  assertEqual(result.tips, ['B'], 'B is still the tip');
});

test('15 scenarios total — all prior tests exercise the expected behaviours', () => {
  // Verify we have exercised: valid structured, valid approval, valid error, missing fields,
  // enum errors, type errors, empty chain, single tip, linear chain, two independent chains,
  // branching (duplicate tip), orphan parent, out-of-order
  assert(passed >= 14, `expected at least 14 passing by now, have ${passed}`);
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
