/**
 * shared/types/runtimeCheck.ts
 *
 * Shared types for the Trust & Verification Layer — Stage 1 runtime-check primitives.
 * Spec: tasks/builds/trust-verification-layer/spec.md §6.1, §6.2.
 *
 * Used by:
 *   - server/config/actionRegistry.ts (ActionDefinition.verify field)
 *   - server/services/runtimeCheckServicePure.ts (evaluation functions)
 *   - server/services/runtimeCheckService.ts (impure orchestrator)
 *   - server/db/schema/runtimeCheckResults.ts (column type annotation)
 *   - client/src/lib/runtimeCheckBadgePure.ts (badge collapse)
 */

// ── RuntimeCheckKind — discriminated union of all supported check types ───────
//
// Five built-in kinds + a custom_handler escape hatch for org-specific checks.
// The `kind` discriminant drives exhaustiveness checking in evaluators.

export type RuntimeCheckKind =
  | { kind: 'api_status_2xx'; expectedStatusRange?: [number, number] }
  | { kind: 'row_exists'; table: string; matchKey: string }
  | { kind: 'field_match'; outputPath: string; expectedShape: 'string' | 'number' | 'boolean' | 'date' }
  | { kind: 'external_returns'; provider: string; expectedField: string }
  | { kind: 'custom_handler'; handlerName: string };

// ── State types ───────────────────────────────────────────────────────────────

// Five internal states — preserved at schema and event level for retries,
// analytics, trust reporting, benchmark validity, and operator drill-down (F6).
// Only collapse to operator badge at render time via collapseToOperatorBadge().
export type RuntimeCheckState = 'pass' | 'fail' | 'inconclusive' | 'pending' | 'not_applicable';

// Three operator-visible badge states — see collapseToOperatorBadge() in
// runtimeCheckServicePure.ts for the projection rule.
// @analytics-internal-state — do NOT aggregate trend data on this type;
// always use RuntimeCheckState from the schema for analytics queries.
export type RuntimeCheckOperatorBadge = 'pass' | 'fail' | 'pending';

export type RuntimeCheckBlastRadius = 'self' | 'tenant' | 'external';

// ── RuntimeCheckResult — canonical per-step result shape ─────────────────────
//
// Mirrors the runtime_check_results table columns (spec §6.2).
// The unique constraint (run_id, sequence_number, skill_slug, attempt_number)
// ensures idempotent persistence (spec §10.1).

export interface RuntimeCheckResult {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  runId: string;
  eventId: string | null;
  sequenceNumber: number;
  skillSlug: string;
  attemptNumber: number;
  state: RuntimeCheckState;
  reasonCode: string;
  reasonText: string;
  impact: 'blocking' | 'informational';
  suggestedFix: string | null;
  evaluatedAt: string;
  blastRadius: RuntimeCheckBlastRadius;
  reversible: boolean;
  createdAt: string;
  updatedAt: string;
}
