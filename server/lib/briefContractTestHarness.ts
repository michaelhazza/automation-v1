/**
 * briefContractTestHarness.ts
 *
 * Shared assertion helpers for capability tests. Every capability that emits
 * artefacts into the Brief system imports these helpers and asserts every
 * emitted artefact satisfies them.
 *
 * See spec §6.4 and §12.2.
 *
 * Phase 0: local synthetic-capability example fixture in
 *   server/lib/__tests__/briefContractTestHarness.example.test.ts
 * Phase 9: CRM Query Planner adopts these helpers in its own test suite.
 */

import {
  validateArtefactPure,
  validateLifecycleChainPure,
} from '../services/briefArtefactValidatorPure.js';
import {
  runBackstopChecksPure,
  type IdScopeCheck,
} from '../services/briefArtefactBackstopPure.js';
import type {
  BriefChatArtefact,
  BriefResultEntityType,
  BriefStructuredResult,
  BriefApprovalCard,
} from '../../shared/types/briefResultContract.js';
import type { PrincipalContext } from '../services/principal/types.js';

// ---------------------------------------------------------------------------
// CapabilityTestContext
// ---------------------------------------------------------------------------

export interface CapabilityTestContext {
  organisationId: string;
  subaccountId?: string;
  userPrincipal: PrincipalContext;
  /** Authoritative row count per entityType for aggregate-invariant checks. */
  scopedTotals: Map<BriefResultEntityType, number>;
  /** Set of record IDs per entityType the caller's scope is allowed to see. */
  scopedIds: Map<BriefResultEntityType, Set<string>>;
}

// ---------------------------------------------------------------------------
// Canonical flow types (spec §12.2 assertCanonicalFlowCoverage)
// ---------------------------------------------------------------------------

export type CanonicalFlow =
  | 'read_refinement'      // structured → updated structured → ...
  | 'write_with_execution' // approval (pending) → approval (running) → approval (completed|failed)
  | 'failure_retry';       // error → approval or structured (retry attempt)

// ---------------------------------------------------------------------------
// assertValidArtefact
// ---------------------------------------------------------------------------

/**
 * Asserts that `a` is a valid BriefChatArtefact. Throws on validation failure.
 */
export async function assertValidArtefact(a: unknown): Promise<void> {
  const result = validateArtefactPure(a);
  if (!result.valid) {
    throw new Error(
      `assertValidArtefact failed:\n${result.errors.map(e => JSON.stringify(e)).join('\n')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// assertValidChain
// ---------------------------------------------------------------------------

/**
 * Asserts that the artefact array forms a valid lifecycle chain:
 * - No duplicate tips per chain root.
 * - No unresolvable orphan parents (orphans are reported but not blocking per
 *   brief §12.3; this harness treats orphan_parent as a warning, not a failure,
 *   to match the spec's "treat orphans as new chain roots" posture).
 */
export async function assertValidChain(artefacts: BriefChatArtefact[]): Promise<void> {
  const result = validateLifecycleChainPure(artefacts);
  const blockingErrors = result.errors.filter(e => e.code !== 'orphan_parent');
  if (blockingErrors.length > 0) {
    throw new Error(
      `assertValidChain failed:\n${blockingErrors.map(e => JSON.stringify(e)).join('\n')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// assertRlsScope
// ---------------------------------------------------------------------------

/**
 * Asserts that the artefact contains no IDs outside the caller's scope and
 * no aggregate counts exceeding the scoped total.
 */
export async function assertRlsScope(
  a: BriefChatArtefact,
  ctx: CapabilityTestContext,
): Promise<void> {
  // Build idScopeCheck from ctx.scopedIds for the artefact's entityType
  let idScopeCheck: IdScopeCheck | undefined;

  if (a.kind === 'structured') {
    const structured = a as BriefStructuredResult;
    const allowedIds = ctx.scopedIds.get(structured.entityType);
    if (allowedIds !== undefined) {
      const rowIds = structured.rows
        .map(r => (typeof r['id'] === 'string' ? (r['id'] as string) : null))
        .filter((id): id is string => id !== null);
      const idsOutOfScope = new Set(rowIds.filter(id => !allowedIds.has(id)));
      idScopeCheck = { entityType: structured.entityType, idsInScope: allowedIds, idsOutOfScope };
    }
  }

  if (a.kind === 'approval') {
    const approval = a as BriefApprovalCard;
    // Use contacts as the default entityType for scope checking on approval cards
    // Capabilities should populate ctx.scopedIds with the relevant entityType
    for (const [entityType, allowedIds] of ctx.scopedIds) {
      const idsOutOfScope = new Set(
        approval.affectedRecordIds.filter(id => !allowedIds.has(id)),
      );
      idScopeCheck = { entityType, idsInScope: allowedIds, idsOutOfScope };
      break; // Use the first matching scope entry
    }
  }

  const entityType = a.kind === 'structured'
    ? (a as BriefStructuredResult).entityType
    : (ctx.scopedIds.keys().next().value as BriefResultEntityType | undefined);

  const scopedTotal = entityType ? ctx.scopedTotals.get(entityType) : undefined;

  const result = runBackstopChecksPure({
    artefact: a,
    briefContext: {
      organisationId: ctx.organisationId,
      subaccountId: ctx.subaccountId,
      scope: ctx.subaccountId ? 'subaccount' : 'org',
      userPrincipal: ctx.userPrincipal,
    },
    idScopeCheck,
    scopedTotals: scopedTotal !== undefined && entityType
      ? { entityType, scopedTotal }
      : undefined,
  });

  if (!result.passed) {
    throw new Error(
      `assertRlsScope failed:\n${result.violations.map(v => JSON.stringify(v)).join('\n')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// assertRelatedArtefactIntegrity
// ---------------------------------------------------------------------------

/**
 * Asserts that every artefactId referenced in `relatedArtefactIds` resolves
 * to another artefact in the provided array.
 */
export async function assertRelatedArtefactIntegrity(
  artefacts: BriefChatArtefact[],
): Promise<void> {
  const byId = new Set(artefacts.map(a => a.artefactId));
  for (const a of artefacts) {
    for (const relId of a.relatedArtefactIds ?? []) {
      if (!byId.has(relId)) {
        throw new Error(
          `assertRelatedArtefactIntegrity failed: artefact '${a.artefactId}' references unknown relatedArtefactId '${relId}'`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// assertCanonicalFlowCoverage
// ---------------------------------------------------------------------------

/**
 * Asserts that the artefact chain matches one of the three canonical flows
 * documented in brief §9:
 *   - read_refinement: all structured; statuses progress final → updated → updated
 *   - write_with_execution: all approval; executionStatus progresses pending → running → completed|failed
 *   - failure_retry: first artefact is error; subsequent are approval or structured
 */
export async function assertCanonicalFlowCoverage(
  artefactChain: BriefChatArtefact[],
  expectedFlow: CanonicalFlow,
): Promise<void> {
  if (artefactChain.length === 0) {
    throw new Error('assertCanonicalFlowCoverage: empty chain is not a valid canonical flow');
  }

  switch (expectedFlow) {
    case 'read_refinement': {
      for (const a of artefactChain) {
        if (a.kind !== 'structured') {
          throw new Error(
            `assertCanonicalFlowCoverage(read_refinement): expected all artefacts to be 'structured', got '${a.kind}' for artefactId '${a.artefactId}'`,
          );
        }
      }
      // Check chain linkage — every artefact after the first has a parentArtefactId
      for (let i = 1; i < artefactChain.length; i++) {
        if (!artefactChain[i]!.parentArtefactId) {
          throw new Error(
            `assertCanonicalFlowCoverage(read_refinement): artefact at index ${i} ('${artefactChain[i]!.artefactId}') has no parentArtefactId`,
          );
        }
      }
      break;
    }

    case 'write_with_execution': {
      for (const a of artefactChain) {
        if (a.kind !== 'approval') {
          throw new Error(
            `assertCanonicalFlowCoverage(write_with_execution): expected all artefacts to be 'approval', got '${a.kind}' for artefactId '${a.artefactId}'`,
          );
        }
      }
      // Verify executionStatus progression: last artefact should be completed or failed
      const last = artefactChain[artefactChain.length - 1] as BriefApprovalCard;
      if (artefactChain.length > 1 && last.executionStatus !== 'completed' && last.executionStatus !== 'failed') {
        throw new Error(
          `assertCanonicalFlowCoverage(write_with_execution): final artefact executionStatus should be 'completed' or 'failed', got '${last.executionStatus ?? 'undefined'}'`,
        );
      }
      break;
    }

    case 'failure_retry': {
      if (artefactChain[0]!.kind !== 'error') {
        throw new Error(
          `assertCanonicalFlowCoverage(failure_retry): first artefact must be 'error', got '${artefactChain[0]!.kind}'`,
        );
      }
      // Subsequent artefacts must be approval or structured
      for (let i = 1; i < artefactChain.length; i++) {
        const kind = artefactChain[i]!.kind;
        if (kind !== 'approval' && kind !== 'structured') {
          throw new Error(
            `assertCanonicalFlowCoverage(failure_retry): artefact at index ${i} must be 'approval' or 'structured', got '${kind}'`,
          );
        }
      }
      break;
    }
  }
}
