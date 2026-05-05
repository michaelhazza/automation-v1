/**
 * briefContractTestHarness.test.ts
 *
 * Tests for the contract harness helpers themselves — verifying that each
 * assertion throws on invalid input and passes on valid input.
 *
 * Run via:
 *   npx tsx server/lib/__tests__/briefContractTestHarness.test.ts
 */

import { expect, test } from 'vitest';
import {
  assertValidArtefact,
  assertValidChain,
  assertRlsScope,
  assertRelatedArtefactIntegrity,
  assertCanonicalFlowCoverage,
  type CapabilityTestContext,
} from '../briefContractTestHarness.js';
import type { BriefChatArtefact } from '../../../shared/types/briefResultContract.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRINCIPAL = { type: 'user' as const, id: 'u-1', organisationId: 'org-1', subaccountId: 'sub-1', teamIds: [] };

const CTX: CapabilityTestContext = {
  organisationId: 'org-1',
  subaccountId: 'sub-1',
  userPrincipal: PRINCIPAL,
  scopedTotals: new Map([['contacts', 10]]),
  scopedIds: new Map([['contacts', new Set(['c-1', 'c-2', 'c-3'])]]),
};

function makeStructured(overrides: Partial<BriefChatArtefact> = {}): BriefChatArtefact {
  return {
    kind: 'structured',
    artefactId: '00000000-0000-0000-0000-000000000001',
    summary: 'Test result',
    entityType: 'contacts',
    filtersApplied: [],
    rows: [{ id: 'c-1' }, { id: 'c-2' }],
    rowCount: 2,
    truncated: false,
    suggestions: [],
    costCents: 5,
    source: 'canonical',
    ...overrides,
  } as BriefChatArtefact;
}

function makeApproval(overrides: Partial<BriefChatArtefact> = {}): BriefChatArtefact {
  return {
    kind: 'approval',
    artefactId: '00000000-0000-0000-0000-000000000002',
    summary: 'Send email',
    actionSlug: 'crm.send_email',
    actionArgs: {},
    affectedRecordIds: ['c-1'],
    riskLevel: 'low',
    ...overrides,
  } as BriefChatArtefact;
}

function makeError(overrides: Partial<BriefChatArtefact> = {}): BriefChatArtefact {
  return {
    kind: 'error',
    artefactId: '00000000-0000-0000-0000-000000000003',
    errorCode: 'internal_error',
    message: 'Something went wrong',
    ...overrides,
  } as BriefChatArtefact;
}

// ---------------------------------------------------------------------------
// assertValidArtefact
// ---------------------------------------------------------------------------

test('assertValidArtefact: passes on valid structured result', async () => {
  await assertValidArtefact(makeStructured());
});

test('assertValidArtefact: throws on malformed artefact', async () => {
  await expect(() => assertValidArtefact({ kind: 'structured', artefactId: 'x' })).rejects.toThrow();
});

// ---------------------------------------------------------------------------
// assertValidChain
// ---------------------------------------------------------------------------

test('assertValidChain: passes on valid 3-link chain', async () => {
  const A = makeStructured({ artefactId: 'A' });
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' });
  const C = makeStructured({ artefactId: 'C', parentArtefactId: 'B', status: 'updated' });
  await assertValidChain([A, B, C]);
});

test('assertValidChain: throws on branching chain (duplicate tip)', async () => {
  const A = makeStructured({ artefactId: 'A' });
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' });
  const C = makeStructured({ artefactId: 'C', parentArtefactId: 'A', status: 'updated' });
  await expect(() => assertValidChain([A, B, C])).rejects.toThrow();
});

test('assertValidChain: orphan parent is a warning not a throw', async () => {
  // Per spec §12.3: orphans are accepted as new chain roots, not blocking
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'missing-A' });
  await assertValidChain([B]); // should NOT throw
});

// ---------------------------------------------------------------------------
// assertRelatedArtefactIntegrity
// ---------------------------------------------------------------------------

test('assertRelatedArtefactIntegrity: passes when all refs resolve', async () => {
  const A = makeStructured({ artefactId: 'A' });
  const B = makeApproval({ artefactId: 'B', relatedArtefactIds: ['A'] });
  await assertRelatedArtefactIntegrity([A, B]);
});

test('assertRelatedArtefactIntegrity: throws on dangling ref', async () => {
  const A = makeStructured({ artefactId: 'A', relatedArtefactIds: ['does-not-exist'] });
  await expect(() => assertRelatedArtefactIntegrity([A])).rejects.toThrow();
});

// ---------------------------------------------------------------------------
// assertCanonicalFlowCoverage
// ---------------------------------------------------------------------------

test('assertCanonicalFlowCoverage: passes for read_refinement', async () => {
  const A = makeStructured({ artefactId: 'A' });
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' });
  await assertCanonicalFlowCoverage([A, B], 'read_refinement');
});

test('assertCanonicalFlowCoverage: passes for write_with_execution', async () => {
  const A = makeApproval({ artefactId: 'A', executionStatus: 'pending' });
  const B = makeApproval({ artefactId: 'B', parentArtefactId: 'A', executionStatus: 'completed' });
  await assertCanonicalFlowCoverage([A, B], 'write_with_execution');
});

test('assertCanonicalFlowCoverage: passes for failure_retry', async () => {
  const A = makeError({ artefactId: 'A' });
  const B = makeApproval({ artefactId: 'B', parentArtefactId: 'A' });
  await assertCanonicalFlowCoverage([A, B], 'failure_retry');
});

test('assertCanonicalFlowCoverage: throws on mismatched flow', async () => {
  const A = makeApproval({ artefactId: 'A' }); // approval, not error — wrong for failure_retry
  await expect(() => assertCanonicalFlowCoverage([A], 'failure_retry')).rejects.toThrow();
});

// ---------------------------------------------------------------------------
// assertRlsScope
// ---------------------------------------------------------------------------

test('assertRlsScope: passes when all row IDs are in scope', async () => {
  const A = makeStructured({ artefactId: 'A', rows: [{ id: 'c-1' }, { id: 'c-2' }], rowCount: 2 });
  await assertRlsScope(A, CTX);
});

test('assertRlsScope: throws when a row ID is out of scope', async () => {
  const A = makeStructured({
    artefactId: 'A',
    rows: [{ id: 'c-1' }, { id: 'c-OUTSIDER' }],
    rowCount: 2,
  });
  await expect(() => assertRlsScope(A, CTX)).rejects.toThrow();
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');