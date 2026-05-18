import type {
  BriefChatArtefact,
  BriefResultEntityType,
  BriefStructuredResult,
  BriefApprovalCard,
} from '../../shared/types/briefResultContract.js';
import type { PrincipalContext } from './principal/types.js';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface IdScopeCheck {
  entityType: BriefResultEntityType;
  idsInScope: Set<string>;
  idsOutOfScope: Set<string>;
}

export interface ScopedTotals {
  entityType: BriefResultEntityType;
  /** Authoritative count of records in the caller's scope. */
  scopedTotal: number;
}

export interface BackstopPureInput {
  artefact: BriefChatArtefact;
  briefContext: {
    organisationId: string;
    subaccountId?: string;
    scope: 'subaccount' | 'org' | 'system';
    userPrincipal: PrincipalContext;
  };
  /**
   * Optional — resolved by the async wrapper via DB reads.
   * When absent, ID-scope checks are skipped for this artefact.
   */
  idScopeCheck?: IdScopeCheck;
  /**
   * Optional — resolved by the async wrapper.
   * When absent, aggregate-invariant checks are skipped.
   */
  scopedTotals?: ScopedTotals;
}

export type BackstopViolation =
  | { kind: 'id_scope_leak'; detail: string; offendingIds: string[] }
  | { kind: 'aggregate_invariant_violation'; detail: string }
  | { kind: 'referenced_field_violation'; detail: string; offendingIds?: string[] };

export interface BackstopPureResult {
  passed: boolean;
  violations: BackstopViolation[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function collectStructuredRowIds(artefact: BriefStructuredResult): string[] {
  const ids: string[] = [];
  for (const row of artefact.rows) {
    // Collect any 'id' field present on the row
    if (typeof row['id'] === 'string') ids.push(row['id'] as string);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Public: runBackstopChecksPure
// ---------------------------------------------------------------------------

export function runBackstopChecksPure(input: BackstopPureInput): BackstopPureResult {
  const violations: BackstopViolation[] = [];
  const { artefact, idScopeCheck, scopedTotals } = input;

  if (artefact.kind === 'structured') {
    const structured = artefact as BriefStructuredResult;

    // Aggregate invariant: rowCount must not exceed the scope's authoritative count
    if (scopedTotals !== undefined && structured.rowCount > scopedTotals.scopedTotal) {
      violations.push({
        kind: 'aggregate_invariant_violation',
        detail: `rowCount (${structured.rowCount}) exceeds scopedTotal (${scopedTotals.scopedTotal}) for entityType '${structured.entityType}'`,
      });
    }

    // ID-scope leak: any row ID that is out of scope
    if (idScopeCheck !== undefined && idScopeCheck.idsOutOfScope.size > 0) {
      const rowIds = collectStructuredRowIds(structured);
      const offending = rowIds.filter(id => idScopeCheck.idsOutOfScope.has(id));
      if (offending.length > 0) {
        violations.push({
          kind: 'id_scope_leak',
          detail: `Structured result contains ${offending.length} row ID(s) outside the caller's scope`,
          offendingIds: offending,
        });
      }
    }
  }

  if (artefact.kind === 'approval') {
    const approval = artefact as BriefApprovalCard;

    // ID-scope leak: any affectedRecordId out of scope
    if (idScopeCheck !== undefined && idScopeCheck.idsOutOfScope.size > 0) {
      const offending = approval.affectedRecordIds.filter(id => idScopeCheck.idsOutOfScope.has(id));
      if (offending.length > 0) {
        violations.push({
          kind: 'id_scope_leak',
          detail: `Approval card contains ${offending.length} affectedRecordId(s) outside the caller's scope`,
          offendingIds: offending,
        });
      }
    }
  }

  // Error artefacts carry no scope-sensitive IDs — pass trivially
  return { passed: violations.length === 0, violations };
}
