/**
 * briefContractTestHarness.test.ts
 *
 * Tests for the contract harness helpers themselves — verifying that each
 * assertion throws on invalid input and passes on valid input.
 *
 * Run via:
 *   npx tsx server/lib/__tests__/briefContractTestHarness.test.ts
 */

import {
  assertValidArtefact,
  assertValidChain,
  assertRlsScope,
  assertRelatedArtefactIntegrity,
  assertCanonicalFlowCoverage,
  type CapabilityTestContext,
} from '../briefContractTestHarness.js';
import type { BriefChatArtefact } from '../../../shared/types/briefResultContract.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>) {
  return fn()
    .then(() => { passed++; console.log(`  PASS  ${name}`); })
    .catch((err: unknown) => {
      failed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    });
}

async function assertThrows(fn: () => Promise<void>, label: string): Promise<void> {
  try {
    await fn();
    throw new Error(`${label}: expected an error to be thrown but none was`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(label + ': expected')) throw err;
    // Any other error is the expected throw — pass
  }
}

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
    artefactId: 'art-s-1',
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
    artefactId: 'art-a-1',
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
    artefactId: 'art-e-1',
    errorCode: 'internal_error',
    message: 'Something went wrong',
    ...overrides,
  } as BriefChatArtefact;
}

// ---------------------------------------------------------------------------
// assertValidArtefact
// ---------------------------------------------------------------------------

await test('assertValidArtefact: passes on valid structured result', async () => {
  await assertValidArtefact(makeStructured());
});

await test('assertValidArtefact: throws on malformed artefact', async () => {
  await assertThrows(
    () => assertValidArtefact({ kind: 'structured', artefactId: 'x' }), // missing required fields
    'assertValidArtefact',
  );
});

// ---------------------------------------------------------------------------
// assertValidChain
// ---------------------------------------------------------------------------

await test('assertValidChain: passes on valid 3-link chain', async () => {
  const A = makeStructured({ artefactId: 'A' });
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' });
  const C = makeStructured({ artefactId: 'C', parentArtefactId: 'B', status: 'updated' });
  await assertValidChain([A, B, C]);
});

await test('assertValidChain: throws on branching chain (duplicate tip)', async () => {
  const A = makeStructured({ artefactId: 'A' });
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' });
  const C = makeStructured({ artefactId: 'C', parentArtefactId: 'A', status: 'updated' });
  await assertThrows(
    () => assertValidChain([A, B, C]),
    'assertValidChain',
  );
});

await test('assertValidChain: orphan parent is a warning not a throw', async () => {
  // Per spec §12.3: orphans are accepted as new chain roots, not blocking
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'missing-A' });
  await assertValidChain([B]); // should NOT throw
});

// ---------------------------------------------------------------------------
// assertRelatedArtefactIntegrity
// ---------------------------------------------------------------------------

await test('assertRelatedArtefactIntegrity: passes when all refs resolve', async () => {
  const A = makeStructured({ artefactId: 'A' });
  const B = makeApproval({ artefactId: 'B', relatedArtefactIds: ['A'] });
  await assertRelatedArtefactIntegrity([A, B]);
});

await test('assertRelatedArtefactIntegrity: throws on dangling ref', async () => {
  const A = makeStructured({ artefactId: 'A', relatedArtefactIds: ['does-not-exist'] });
  await assertThrows(
    () => assertRelatedArtefactIntegrity([A]),
    'assertRelatedArtefactIntegrity',
  );
});

// ---------------------------------------------------------------------------
// assertCanonicalFlowCoverage
// ---------------------------------------------------------------------------

await test('assertCanonicalFlowCoverage: passes for read_refinement', async () => {
  const A = makeStructured({ artefactId: 'A' });
  const B = makeStructured({ artefactId: 'B', parentArtefactId: 'A', status: 'updated' });
  await assertCanonicalFlowCoverage([A, B], 'read_refinement');
});

await test('assertCanonicalFlowCoverage: passes for write_with_execution', async () => {
  const A = makeApproval({ artefactId: 'A', executionStatus: 'pending' });
  const B = makeApproval({ artefactId: 'B', parentArtefactId: 'A', executionStatus: 'completed' });
  await assertCanonicalFlowCoverage([A, B], 'write_with_execution');
});

await test('assertCanonicalFlowCoverage: passes for failure_retry', async () => {
  const A = makeError({ artefactId: 'A' });
  const B = makeApproval({ artefactId: 'B', parentArtefactId: 'A' });
  await assertCanonicalFlowCoverage([A, B], 'failure_retry');
});

await test('assertCanonicalFlowCoverage: throws on mismatched flow', async () => {
  const A = makeApproval({ artefactId: 'A' }); // approval, not error — wrong for failure_retry
  await assertThrows(
    () => assertCanonicalFlowCoverage([A], 'failure_retry'),
    'assertCanonicalFlowCoverage',
  );
});

// ---------------------------------------------------------------------------
// assertRlsScope
// ---------------------------------------------------------------------------

await test('assertRlsScope: passes when all row IDs are in scope', async () => {
  const A = makeStructured({ artefactId: 'A', rows: [{ id: 'c-1' }, { id: 'c-2' }], rowCount: 2 });
  await assertRlsScope(A, CTX);
});

await test('assertRlsScope: throws when a row ID is out of scope', async () => {
  const A = makeStructured({
    artefactId: 'A',
    rows: [{ id: 'c-1' }, { id: 'c-OUTSIDER' }],
    rowCount: 2,
  });
  await assertThrows(
    () => assertRlsScope(A, CTX),
    'assertRlsScope',
  );
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
