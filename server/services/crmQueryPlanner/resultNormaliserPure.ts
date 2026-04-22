// Result normaliser — pure functions (spec §15.2, §15.3)
// Approval card generation is in approvalCardGeneratorPure.ts (§15.4).

import { randomUUID } from 'crypto';
import type { QueryPlan, ExecutorResult } from '../../../shared/types/crmQueryPlanner.js';
import type {
  BriefStructuredResult,
  BriefApprovalCard,
  BriefResultFilter,
  BriefResultSuggestion,
} from '../../../shared/types/briefResultContract.js';
import { mapOperatorForWire } from '../../../shared/types/crmQueryPlanner.js';
import { generateApprovalCards as _generateApprovalCards } from './approvalCardGeneratorPure.js';

// ── NormaliserContext ─────────────────────────────────────────────────────────

export interface NormaliserContext {
  subaccountId: string;
  defaultSenderIdentifier?: string;
}

// ── Summary template ──────────────────────────────────────────────────────────

function buildSummary(plan: QueryPlan, execResult: ExecutorResult): string {
  const count = execResult.rowCount;
  const entity = plan.primaryEntity;
  const truncMark = execResult.truncated ? ' (truncated)' : '';
  return `${count} ${entity}${truncMark}`;
}

// ── Filter chips (§15.2) ──────────────────────────────────────────────────────

function buildFilterChips(plan: QueryPlan): BriefResultFilter[] {
  return plan.filters.map(f => {
    const wire = mapOperatorForWire(f.operator);
    return {
      field:      f.field,
      operator:   wire.operator,
      value:      wire.value !== undefined ? wire.value : f.value,
      humanLabel: f.humanLabel,
    };
  });
}

// ── Suggestion generation (§15.3) ─────────────────────────────────────────────

const FALLBACK_SUGGESTIONS: BriefResultSuggestion[] = [
  {
    label: 'Try a supported query',
    intent: "Show contacts inactive for 30 days",
    kind: 'other',
  },
  {
    label: 'View upcoming appointments',
    intent: "Show upcoming appointments this week",
    kind: 'other',
  },
];

export function generateSuggestions(
  plan: QueryPlan,
  execResult: ExecutorResult,
): BriefResultSuggestion[] {
  const suggestions: BriefResultSuggestion[] = [];

  if (execResult.truncated) {
    suggestions.push({
      label: 'Narrow by date range',
      intent: `Show ${plan.primaryEntity} in the last 7 days`,
      kind: 'narrow',
    });
    if (plan.primaryEntity === 'contacts') {
      suggestions.push({
        label: 'Narrow by tag',
        intent: `Show ${plan.primaryEntity} by tag`,
        kind: 'narrow',
      });
    }
    if (plan.primaryEntity === 'opportunities') {
      suggestions.push({
        label: 'Narrow by stage',
        intent: `Show ${plan.primaryEntity} in current stage`,
        kind: 'narrow',
      });
    }
  }

  if (execResult.rowCount > 50) {
    const sortField =
      plan.primaryEntity === 'contacts'    ? 'last activity' :
      plan.primaryEntity === 'opportunities' ? 'amount' :
      plan.primaryEntity === 'revenue'    ? 'date' :
      'created date';
    suggestions.push({
      label: `Sort by ${sortField}`,
      intent: `Sort ${plan.primaryEntity} by ${sortField}`,
      kind: 'sort',
    });
  }

  if (plan.primaryEntity === 'contacts' && execResult.rows.length > 0) {
    suggestions.push({
      label: 'Email these contacts',
      intent: 'Send email to contacts from this result',
      kind: 'action',
    });
  }

  return suggestions;
}

// ── BriefStructuredResult construction (§15.2) ────────────────────────────────

export function buildStructuredResult(
  plan: QueryPlan,
  execResult: ExecutorResult,
): BriefStructuredResult {
  return {
    artefactId:      randomUUID(),
    kind:            'structured',
    summary:         buildSummary(plan, execResult),
    entityType:      plan.primaryEntity as BriefStructuredResult['entityType'],
    filtersApplied:  buildFilterChips(plan),
    rows:            execResult.rows,
    rowCount:        execResult.rowCount,
    truncated:       execResult.truncated,
    truncationReason: execResult.truncationReason,
    suggestions:     generateSuggestions(plan, execResult),
    costCents:       execResult.actualCostCents,
    source:          execResult.source,
    confidence:      plan.confidence,
    confidenceSource: 'deterministic',
  };
}

// ── Approval card generation (§15.4) — delegates to approvalCardGeneratorPure ─

export function generateApprovalCards(
  plan: QueryPlan,
  execResult: ExecutorResult,
  context: NormaliserContext,
): BriefApprovalCard[] {
  return _generateApprovalCards(plan, execResult, context);
}

// ── Top-level normalise (§15.1) ───────────────────────────────────────────────

export function normaliseToArtefacts(
  plan: QueryPlan,
  execResult: ExecutorResult,
  context: NormaliserContext,
): { structured: BriefStructuredResult; approvalCards: BriefApprovalCard[] } {
  return {
    structured:    buildStructuredResult(plan, execResult),
    approvalCards: generateApprovalCards(plan, execResult, context),
  };
}

export { FALLBACK_SUGGESTIONS };
