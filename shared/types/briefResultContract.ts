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
// Shared primitives
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

export interface BriefStructuredResult {
  kind: 'structured';
  /** One-sentence human summary, e.g. "18 VIP contacts inactive 30d". */
  summary: string;
  entityType: BriefResultEntityType;
  filtersApplied: BriefResultFilter[];
  /** Rows rendered in the UI table. Schema is entity-dependent — consumers render by entityType. */
  rows: Array<Record<string, unknown>>;
  /** Total matching count — may exceed rows.length when truncated. */
  rowCount: number;
  truncated: boolean;
  truncationReason?: BriefTruncationReason;
  /** Refinement / follow-up suggestions. May be empty. */
  suggestions: BriefResultSuggestion[];
  /** Actual spend for this result, in cents. Always present. */
  costCents: number;
  source: BriefResultSource;
}

// ---------------------------------------------------------------------------
// Approval card — for write actions the Orchestrator wants to take
// ---------------------------------------------------------------------------

export type BriefApprovalRiskLevel = 'low' | 'medium' | 'high';

export interface BriefApprovalCard {
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

export interface BriefErrorResult {
  kind: 'error';
  errorCode: BriefErrorCode;
  /** Plain-English explanation suitable for rendering in chat. */
  message: string;
  /** Optional refinement suggestions — what the user could try instead. */
  suggestions?: BriefResultSuggestion[];
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
