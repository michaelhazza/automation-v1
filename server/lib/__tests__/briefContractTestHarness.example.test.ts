/**
 * briefContractTestHarness.example.test.ts
 *
 * Phase 0 exit-gate fixture. Defines a synthetic capability that emits a
 * realistic artefact chain, then runs every harness assertion against it.
 *
 * This is the canonical demonstration that the harness works end-to-end
 * before any real capability is wired. CRM Query Planner adopts this pattern
 * in Phase 9 (convergence work).
 *
 * Run via:
 *   npx tsx server/lib/__tests__/briefContractTestHarness.example.test.ts
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
import type {
  BriefChatArtefact,
  BriefStructuredResult,
  BriefApprovalCard,
} from '../../../shared/types/briefResultContract.js';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Synthetic capability: emits a realistic read_refinement chain
// ---------------------------------------------------------------------------

interface SyntheticCapabilityInput {
  entityType: BriefStructuredResult['entityType'];
  rowIds: string[];
}

/**
 * Synthesises a three-artefact chain:
 *  1. Initial structured result (status: 'pending')
 *  2. Updated structured result superseding #1 (status: 'updated')
 *  3. Approval card related to the result
 *
 * All IDs are within the provided rowIds list (no scope leaks).
 */
function synthesiseExampleCapabilityOutput(
  input: SyntheticCapabilityInput,
): BriefChatArtefact[] {
  const rootId = randomUUID();
  const updatedId = randomUUID();
  const approvalId = randomUUID();

  const initialResult: BriefStructuredResult = {
    kind: 'structured',
    artefactId: rootId,
    status: 'pending',
    summary: `Found ${input.rowIds.length} ${input.entityType} (loading...)`,
    entityType: input.entityType,
    filtersApplied: [
      {
        field: 'tags',
        operator: 'in',
        value: ['VIP'],
        humanLabel: 'Tag is VIP',
      },
    ],
    rows: input.rowIds.map(id => ({ id, name: `Contact ${id}`, tags: ['VIP'] })),
    rowCount: input.rowIds.length,
    truncated: false,
    suggestions: [
      {
        label: 'Narrow to last 30 days',
        intent: 'Show VIP contacts inactive in the last 30 days only.',
        kind: 'narrow',
      },
    ],
    costCents: 2,
    source: 'canonical',
    confidence: 0.95,
    confidenceSource: 'deterministic',
  };

  const updatedResult: BriefStructuredResult = {
    ...initialResult,
    artefactId: updatedId,
    status: 'updated',
    parentArtefactId: rootId,
    summary: `Found ${input.rowIds.length} ${input.entityType}`,
    costCents: 3,
  };

  const approvalCard: BriefApprovalCard = {
    kind: 'approval',
    artefactId: approvalId,
    relatedArtefactIds: [updatedId],
    summary: `Send follow-up email to ${input.rowIds.length} VIP contacts`,
    actionSlug: 'crm.send_email',
    actionArgs: {
      templateId: 'tpl-vip-followup',
      recipientIds: input.rowIds,
    },
    affectedRecordIds: input.rowIds,
    riskLevel: 'low',
    estimatedCostCents: 5,
    confidence: 0.88,
    confidenceSource: 'llm',
    budgetContext: { remainingCents: 950, limitCents: 1000, window: 'per_run' },
  };

  return [initialResult, updatedResult, approvalCard];
}

// ---------------------------------------------------------------------------
// Test context — all row IDs and totals within scope
// ---------------------------------------------------------------------------

const ROW_IDS = ['c-001', 'c-002', 'c-003'];

const CTX: CapabilityTestContext = {
  organisationId: 'org-example',
  subaccountId: 'sub-example',
  userPrincipal: {
    type: 'user',
    id: 'u-example',
    organisationId: 'org-example',
    subaccountId: 'sub-example',
    teamIds: [],
  },
  scopedTotals: new Map([['contacts', 10]]),
  scopedIds: new Map([['contacts', new Set(ROW_IDS)]]),
};

const ARTEFACTS = synthesiseExampleCapabilityOutput({
  entityType: 'contacts',
  rowIds: ROW_IDS,
});

const [INITIAL, UPDATED, APPROVAL] = ARTEFACTS as [BriefChatArtefact, BriefChatArtefact, BriefChatArtefact];

// ---------------------------------------------------------------------------
// Phase 0 exit-gate assertions
// ---------------------------------------------------------------------------

test('assertValidArtefact: initial structured result is valid', async () => {
  await assertValidArtefact(INITIAL);
});

test('assertValidArtefact: updated structured result is valid', async () => {
  await assertValidArtefact(UPDATED);
});

test('assertValidArtefact: approval card is valid', async () => {
  await assertValidArtefact(APPROVAL);
});

test('assertValidChain: full chain [initial, updated, approval] is valid', async () => {
  // Chain: initial (root) → updated. Approval is independent (no parentArtefactId).
  // This tests that two chains co-existing in one array is accepted.
  await assertValidChain(ARTEFACTS);
});

test('assertRlsScope: initial structured result — all row IDs in scope', async () => {
  await assertRlsScope(INITIAL, CTX);
});

test('assertRlsScope: updated structured result — all row IDs in scope', async () => {
  await assertRlsScope(UPDATED, CTX);
});

test('assertRlsScope: approval card — all affectedRecordIds in scope', async () => {
  await assertRlsScope(APPROVAL, CTX);
});

test('assertRelatedArtefactIntegrity: approval card relatedArtefactIds → updated result', async () => {
  // approvalCard.relatedArtefactIds = [updatedId]; updatedResult.artefactId = updatedId
  await assertRelatedArtefactIntegrity(ARTEFACTS);
});

test('assertCanonicalFlowCoverage(read_refinement): [initial, updated] matches flow', async () => {
  await assertCanonicalFlowCoverage([INITIAL, UPDATED], 'read_refinement');
});

// ---------------------------------------------------------------------------
// Negative: out-of-scope ID is correctly caught
// ---------------------------------------------------------------------------

test('assertRlsScope: correctly catches a row ID outside the scope', async () => {
  const outsiderResult = synthesiseExampleCapabilityOutput({
    entityType: 'contacts',
    rowIds: ['c-001', 'c-OUTSIDER'], // c-OUTSIDER is not in CTX.scopedIds
  });
  const [outsider] = outsiderResult as [BriefChatArtefact];
  let threw = false;
  try {
    await assertRlsScope(outsider, CTX);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('expected assertRlsScope to throw for out-of-scope ID');
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');