// Shared wire types for the Brief result contract.
// Spec: docs/brief-result-contract.md
//
// These types are the canonical contract between:
//  - Brief chat surfaces (client) — render artefacts
//  - Orchestrator / capability skills (server) — produce artefacts
//  - Downstream capabilities (e.g. CRM Query Planner, on a separate branch)
//    — emit results in this shape
//
// Any capability that wants to render into a Brief chat must emit one of
// these artefact kinds. The shape is designed to support rich rendering
// (tables, approval cards, error surfaces with refinement suggestions)
// without forcing callers into a specific UI framework.
//
// Versioning: this is v1. Breaking changes require bumping
// CONTRACT_VERSION and surfacing a migration path for consumers.
// Additive changes (new optional fields, new enum values) do not require
// a bump — consumers ignore unknown fields.

export const BRIEF_RESULT_CONTRACT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Shared primitives — common to all artefact kinds
// ---------------------------------------------------------------------------

/**
 * Lifecycle status for an artefact. 'final' means this artefact is authoritative
 * and won't change. 'pending' means a refinement is expected (e.g., long-running
 * query). 'updated' means this artefact supersedes a previous one
 * (parentArtefactId points to the predecessor). 'invalidated' means this artefact
 * is no longer accurate (e.g., underlying data changed) and the UI should
 * visually mark it as stale. Default interpretation when omitted: 'final'.
 */
export type BriefArtefactStatus = 'final' | 'pending' | 'updated' | 'invalidated';

/**
 * Budget context for "you've used N% of your limit" UX messaging.
 * All fields optional — capabilities may report remaining, limit, window,
 * or any combination depending on what budget layer is active (per-Brief,
 * per-run, per-day, per-month). When `window` is set, it disambiguates
 * which budget layer the `remainingCents` / `limitCents` refer to —
 * essential once multiple overlapping budgets exist.
 */
export interface BriefBudgetContext {
  remainingCents?: number;
  limitCents?: number;
  window?: 'per_run' | 'per_day' | 'per_month' | 'unknown';
}

/**
 * Soft schema hint for UI rendering of structured results. Capabilities
 * producing tabular data may include this so the UI renders deterministically
 * without per-entityType defensive logic. Keys match field names in the
 * corresponding `rows` entries.
 */
export interface BriefColumnHint {
  key: string;
  label: string;
  type?: 'string' | 'number' | 'date' | 'currency' | 'boolean';
}

/**
 * Fields common to every artefact kind. The discriminated union below
 * extends this base to add kind-specific fields.
 */
export interface BriefArtefactBase {
  /** Unique identifier for this artefact. Required so artefacts can reference each other. */
  artefactId: string;
  /** Lifecycle status. Defaults to 'final' when omitted. */
  status?: BriefArtefactStatus;
  /** When status is 'updated' or 'invalidated', the previous artefact this supersedes. */
  parentArtefactId?: string;
  /** Loose relationships to other artefacts (e.g., approval card → result that spawned it). */
  relatedArtefactIds?: string[];
  /** Per-artefact contract version. Defaults to BRIEF_RESULT_CONTRACT_VERSION when omitted. */
  contractVersion?: number;
}

// ---------------------------------------------------------------------------
// Result-specific primitives
// ---------------------------------------------------------------------------

/**
 * The canonical entity a structured result describes. 'other' is a pragmatic
 * escape hatch for non-CRM surfaces (e.g. PR activity, run logs, connector
 * health). Consumers should treat 'other' as "render rows without entity-
 * specific affordances like open-record links."
 */
export type BriefResultEntityType =
  | 'contacts'
  | 'opportunities'
  | 'appointments'
  | 'conversations'
  | 'revenue'
  | 'tasks'
  | 'runs'
  | 'other';

/**
 * Where the data came from. 'canonical' = our ingested tables. 'live' = direct
 * provider API call. 'hybrid' = combined. Lets the UI flag freshness and the
 * caller decide whether to cache.
 */
export type BriefResultSource = 'canonical' | 'live' | 'hybrid';

/**
 * Why the result set was truncated. Distinguishing these matters for
 * suggestion generation — 'result_limit' suggests narrowing filters;
 * 'cost_limit' suggests a cheaper query; 'time_limit' suggests a longer
 * window.
 */
export type BriefTruncationReason = 'result_limit' | 'cost_limit' | 'time_limit';

/**
 * A filter the system interpreted from the user's request and applied
 * to the underlying query. Rendered as chips in the UI so users can see
 * (and correct) how their intent was parsed.
 */
export interface BriefResultFilter {
  /** Canonical field name, e.g. 'tags', 'lastActivityAt', 'stage'. */
  field: string;
  /** Operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'between' | 'exists' */
  operator: string;
  /** Raw value — shape depends on operator (scalar for eq, array for in, tuple for between). */
  value: unknown;
  /** UI-friendly label, e.g. "Tag is VIP" or "Last activity older than 30 days". */
  humanLabel: string;
}

/**
 * A follow-up affordance rendered below the result. `intent` must be phrased
 * so the Orchestrator can parse it as a new Brief (i.e. it's a self-contained
 * instruction, not a fragment).
 */
export interface BriefResultSuggestion {
  /** Short UI label, e.g. "Narrow to last 7 days". */
  label: string;
  /** Full re-parseable instruction, e.g. "Show VIP contacts inactive 30d in the last 7 days." */
  intent: string;
  /** Classification for UI grouping. */
  kind: 'narrow' | 'broaden' | 'sort' | 'action' | 'other';
}

// ---------------------------------------------------------------------------
// Structured result — the common "here's what you asked for" artefact
// ---------------------------------------------------------------------------

export interface BriefStructuredResult extends BriefArtefactBase {
  kind: 'structured';
  /** One-sentence human summary, e.g. "18 VIP contacts inactive 30d". */
  summary: string;
  entityType: BriefResultEntityType;
  filtersApplied: BriefResultFilter[];
  /** Rows rendered in the UI table. Schema is entity-dependent — consumers render by entityType. */
  rows: Array<Record<string, unknown>>;
  /**
   * Soft schema hint for deterministic UI rendering. Capabilities may omit when
   * the UI can infer columns from `entityType` alone. When present, UI renders
   * exactly these columns in this order with these labels.
   */
  columns?: BriefColumnHint[];
  /** Total matching count — may exceed rows.length when truncated. */
  rowCount: number;
  truncated: boolean;
  truncationReason?: BriefTruncationReason;
  /** Refinement / follow-up suggestions. May be empty. */
  suggestions: BriefResultSuggestion[];
  /** Actual spend for this result, in cents. Always present. */
  costCents: number;
  source: BriefResultSource;
  /**
   * Age of the underlying data in milliseconds at the moment this result
   * was produced. Complements `source` — a 'canonical' read with
   * freshnessMs=90000 (1.5min old) is meaningfully different from
   * freshnessMs=7200000 (2h old). Optional; capabilities that can't
   * estimate (e.g., hybrid aggregations) may omit.
   */
  freshnessMs?: number;
  /**
   * System's self-assessed confidence in the interpretation, 0.0–1.0.
   * Optional: capabilities that can't meaningfully estimate confidence may omit.
   * When present, the UI surfaces a confidence indicator for values below a
   * threshold (e.g. < 0.8) so users can spot-check borderline results.
   * See docs/brief-result-contract.md §"Confidence surfaces" for rendering guidance.
   */
  confidence?: number;
  /**
   * Provenance of the confidence score. Debugging + tuning aid — lets
   * downstream consumers weigh LLM-derived confidence differently from
   * deterministic confidence. Optional.
   */
  confidenceSource?: 'llm' | 'heuristic' | 'deterministic';
  /**
   * Budget context for "you've used N% of your limit" UX.
   * Typically populated by the orchestrator after the capability returns, not
   * by the capability itself. Optional.
   */
  budgetContext?: BriefBudgetContext;
}

// ---------------------------------------------------------------------------
// Approval card — for write actions the Orchestrator wants to take
// ---------------------------------------------------------------------------

export type BriefApprovalRiskLevel = 'low' | 'medium' | 'high';

export type BriefExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BriefApprovalCard extends BriefArtefactBase {
  kind: 'approval';
  /** Human summary of the proposed action, e.g. "Send follow-up email to 14 contacts". */
  summary: string;
  /** Must be a registered actionSlug in server/config/actionRegistry.ts. */
  actionSlug: string;
  /** Arguments matching the registered action's typed schema. Validated on dispatch. */
  actionArgs: Record<string, unknown>;
  /** Record IDs the action affects — used for preview rendering and audit. */
  affectedRecordIds: string[];
  /** Predicted spend for executing the action. Optional because some actions are free. */
  estimatedCostCents?: number;
  /**
   * Risk tier. 'high' forces explicit approval even if the user has auto-approve
   * enabled for routine actions. Derived from the action's defaultGateLevel and
   * the scope/blast-radius of the args.
   */
  riskLevel: BriefApprovalRiskLevel;
  /**
   * System's self-assessed confidence that this action matches user intent, 0.0–1.0.
   * Optional. When present and below a threshold, the UI surfaces an uncertainty
   * indicator prompting explicit user scrutiny before approval. See
   * docs/brief-result-contract.md §"Confidence surfaces" for rendering guidance.
   */
  confidence?: number;
  /**
   * Provenance of the confidence score. See BriefStructuredResult.confidenceSource.
   */
  confidenceSource?: 'llm' | 'heuristic' | 'deterministic';
  /**
   * Execution linkage — populated after the user approves and the action dispatches.
   * Links this approval card to the run / action-execution record for audit trail
   * and UI post-dispatch state (e.g., "✓ Completed" / "✗ Failed — retry").
   *
   * Reuse rule: `executionId` always refers to the LATEST execution. If the user
   * retries a failed action or re-runs a completed one, a new approval artefact
   * is emitted (via `parentArtefactId` chain) with the new `executionId`. The
   * chain preserves history; this field always points at the current attempt.
   */
  executionId?: string;
  executionStatus?: BriefExecutionStatus;
  /**
   * Budget context for "this action will take you to N% of limit" UX.
   * Populated by the orchestrator when the action is priced. Optional.
   */
  budgetContext?: BriefBudgetContext;
}

// ---------------------------------------------------------------------------
// Error result — with refinement suggestions where possible
// ---------------------------------------------------------------------------

export type BriefErrorCode =
  | 'unsupported_query'
  | 'ambiguous_intent'
  | 'missing_permission'
  | 'cost_exceeded'
  | 'rate_limited'
  | 'provider_error'
  | 'internal_error';

export type BriefErrorSeverity = 'low' | 'medium' | 'high';

export interface BriefErrorResult extends BriefArtefactBase {
  kind: 'error';
  errorCode: BriefErrorCode;
  /** Plain-English explanation suitable for rendering in chat. */
  message: string;
  /** Optional refinement suggestions — what the user could try instead. */
  suggestions?: BriefResultSuggestion[];
  /**
   * How critical is this error to the user's flow? Drives UX treatment —
   * 'low' = inline toast, 'medium' = banner in chat, 'high' = modal or
   * blocking state. Optional; defaults to 'medium' behaviour when omitted.
   */
  severity?: BriefErrorSeverity;
  /**
   * Whether the user should be offered a retry action. True for transient
   * failures (rate_limited, provider_error), typically false for
   * unsupported_query or missing_permission. Optional.
   */
  retryable?: boolean;
}

// ---------------------------------------------------------------------------
// Cost preview — returned before execution for user-confirmed dispatch
// ---------------------------------------------------------------------------

export interface BriefCostPreview {
  predictedCostCents: number;
  confidence: 'low' | 'medium' | 'high';
  /** How the prediction was derived — affects how much to trust it. */
  basedOn: 'planner_estimate' | 'cached_similar_query' | 'static_heuristic';
}

// ---------------------------------------------------------------------------
// Discriminated union — the top-level artefact type
// ---------------------------------------------------------------------------

/**
 * A single "thing" rendered into a Brief chat by the system. Consumers
 * discriminate by `kind`. Each new chat turn may produce 0..N artefacts.
 */
export type BriefChatArtefact =
  | BriefStructuredResult
  | BriefApprovalCard
  | BriefErrorResult;

// ---------------------------------------------------------------------------
// Type guards — convenience for consumers
// ---------------------------------------------------------------------------

export function isBriefStructuredResult(a: BriefChatArtefact): a is BriefStructuredResult {
  return a.kind === 'structured';
}

export function isBriefApprovalCard(a: BriefChatArtefact): a is BriefApprovalCard {
  return a.kind === 'approval';
}

export function isBriefErrorResult(a: BriefChatArtefact): a is BriefErrorResult {
  return a.kind === 'error';
}
