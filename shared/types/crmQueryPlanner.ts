// CRM Query Planner — shared type contracts (spec §6)
// Consumed by server and (future) client. All types are pure data shapes.

import type { BriefCostPreview } from './briefResultContract.js';

// ---------------------------------------------------------------------------
// §6.1 Normalised intent
// ---------------------------------------------------------------------------

export interface NormalisedIntent {
  hash: string;        // sha256(tokens.join(' ')).slice(0, 16)
  tokens: string[];    // lowercased, stop-word stripped, synonym-collapsed
  rawIntent: string;   // preserved for logging + error responses
}

// ---------------------------------------------------------------------------
// §6.2 QueryPlan
// ---------------------------------------------------------------------------

export type QuerySource = 'canonical' | 'live' | 'hybrid';

export type QueryIntentClass =
  | 'list_entities'
  | 'count_entities'
  | 'aggregate'
  | 'lookup'
  | 'trend_request'
  | 'segment_request'
  | 'unsupported'; // planner-internal — never emitted on the wire

export type PrimaryEntity =
  | 'contacts'
  | 'opportunities'
  | 'appointments'
  | 'conversations'
  | 'revenue'
  | 'tasks';

export type StageResolved = 1 | 2 | 3;

export interface QueryFilter {
  field: string;
  operator:
    | 'eq' | 'ne' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte'
    | 'contains' | 'starts_with' | 'is_null' | 'is_not_null' | 'between';
  value?: unknown;
  humanLabel: string; // for filtersApplied rendering
}

// Wire translation — three planner-internal operators need mapping (spec §6.2)
export function mapOperatorForWire(
  op: QueryFilter['operator'],
): { operator: string; value?: unknown } {
  switch (op) {
    case 'ne':          return { operator: 'neq' };
    case 'is_null':     return { operator: 'exists', value: false };
    case 'is_not_null': return { operator: 'exists', value: true };
    default:            return { operator: op };
  }
}

export interface QueryPlan {
  source: QuerySource;
  intentClass: QueryIntentClass;
  primaryEntity: PrimaryEntity;
  relatedEntities?: PrimaryEntity[];
  filters: QueryFilter[];
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  limit: number;
  projection?: string[];
  aggregation?: {
    type: 'count' | 'sum' | 'avg' | 'group_by';
    field?: string;
    groupBy?: string[];
  };
  dateContext?: {
    kind: 'relative' | 'absolute';
    from?: string;   // ISO 8601
    to?: string;
    description?: string;
  };
  canonicalCandidateKey: string | null; // registry key if canonical-promotable
  confidence: number;                   // 0..1; always 1.0 for Stages 1 & 2
  stageResolved: StageResolved;
  hybridPattern?: 'canonical_base_with_live_filter'; // v1 sole pattern
  costPreview: BriefCostPreview;
  validated: true; // literal — present only after Stage 4
}

// Shape Stage 3 emits before validation. costPreview is NOT on the draft.
export interface DraftQueryPlan extends Omit<QueryPlan, 'validated' | 'stageResolved' | 'costPreview'> {
  clarificationNeeded?: boolean;
  clarificationPrompt?: string;
}

// ---------------------------------------------------------------------------
// §6.3 Canonical query registry
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  filters?: QueryFilter[];
  dateContext?: QueryPlan['dateContext'];
  limit?: number;
  sort?: QueryPlan['sort'];
  projection?: string[];
}

export interface CanonicalQueryHandlerArgs {
  orgId: string;
  subaccountId: string;
  filters: QueryFilter[];
  dateContext?: QueryPlan['dateContext'];
  limit: number;
  sort?: QueryPlan['sort'];
  projection?: string[];
}

export type CanonicalQueryHandler = (
  args: CanonicalQueryHandlerArgs,
) => Promise<ExecutorResult>;

export interface CanonicalQueryRegistryEntry {
  key: string;
  aliases: readonly string[];
  primaryEntity: PrimaryEntity;
  requiredCapabilities: readonly string[];
  handler: CanonicalQueryHandler;
  description: string;
  allowedFields: Record<string, {
    operators: readonly QueryFilter['operator'][];
    projectable: boolean;
    sortable: boolean;
  }>;
  parseArgs?: (intent: NormalisedIntent) => ParsedArgs | null;
}

export type CanonicalQueryRegistry = Readonly<Record<string, CanonicalQueryRegistryEntry>>;

// ---------------------------------------------------------------------------
// §6.4 Executor result (internal — not on the wire)
// ---------------------------------------------------------------------------

export interface ExecutorResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  truncationReason?: 'result_limit' | 'cost_limit' | 'time_limit';
  actualCostCents: number;
  source: QuerySource;           // echoed for provenance
  providerLatencyMs?: number;    // for live / hybrid only
}

// ---------------------------------------------------------------------------
// §6.5 Plan cache entry
// ---------------------------------------------------------------------------

export const NORMALISER_VERSION = 1;

export interface PlanCacheEntry {
  plan: QueryPlan;
  cachedAt: number;                         // epoch ms
  subaccountId: string;
  hits: number;
  cacheConfidence: 'high' | 'medium' | 'low';
  normaliserVersion: number;
}

// ---------------------------------------------------------------------------
// §6.6 Planner events
// ---------------------------------------------------------------------------

export type PlannerEventKind =
  | 'planner.stage1_matched'
  | 'planner.stage1_missed'
  | 'planner.stage2_cache_hit'
  | 'planner.stage2_cache_miss'
  | 'planner.stage3_parse_started'
  | 'planner.stage3_parse_completed'
  | 'planner.stage3_escalated'
  | 'planner.validation_failed'
  | 'planner.classified'
  | 'planner.executor_dispatched'
  | 'planner.canonical_promoted'
  | 'planner.result_emitted'
  | 'planner.error_emitted';

export interface PlannerEvent<K extends PlannerEventKind = PlannerEventKind> {
  kind: K;
  at: number;
  orgId: string;
  subaccountId: string;
  runId?: string;
  briefId?: string;
  intentHash: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// §6.7 Planner trace
// ---------------------------------------------------------------------------

export interface PlannerPlanMutation {
  stage: 'canonical_precedence_promotion' | 'p2_hybrid_rewrite';
  field: 'source' | 'intentClass';
  before: unknown;
  after: unknown;
  reason: string;
}

export interface PlannerTrace {
  intentHash: string;
  briefId?: string;
  normaliserVersion: number;
  normalisedIntentTokens: string[];
  stage1: { hit: boolean; candidateKey?: string; rejectedBy?: 'rule_2' | 'rule_3' | 'rule_9' };
  stage2: { hit: boolean; reason?: 'not_present' | 'expired' | 'principal_mismatch' };
  stage3?: {
    used: boolean;
    defaultTierTokens?: { input: number; output: number };
    escalationTierTokens?: { input: number; output: number };
    escalationReason?: 'low_confidence' | 'hybrid_detected' | 'large_schema';
    parseFailure?: boolean;
  };
  validator: { passed: boolean; failedRule?: number; rejectedValue?: unknown };
  canonicalPromoted?: { fromSource: 'live'; toSource: 'canonical' | 'hybrid' };
  executor?: { kind: 'canonical' | 'live' | 'hybrid'; callCount?: number; capShortCircuited?: boolean };
  finalPlan?: { source: QuerySource; primaryEntity: PrimaryEntity; filterCount: number };
  mutations: PlannerPlanMutation[];
  terminalOutcome: 'structured' | 'approval' | 'error';
  terminalErrorCode?: string;
  /**
   * Top-level observability flag (§17.1) making it unambiguous at a glance
   * which path produced the terminal emission:
   *   - 'stage1'       — registry match (Stage 1 hit)
   *   - 'stage2_cache' — plan cache reuse (Stage 2 hit)
   *   - 'stage3_live'  — Stage 3 (LLM) freshly produced + validated a plan
   * Set at every terminal emission site in the orchestrator. Optional so the
   * field is additive — older consumers that don't read it continue to work.
   */
  executionMode?: 'stage1' | 'stage2_cache' | 'stage3_live';
}

// ---------------------------------------------------------------------------
// ExecutorContext — passed to every executor
// ---------------------------------------------------------------------------

export interface ExecutorContext {
  orgId: string;
  organisationId: string;
  subaccountId: string;
  /**
   * @deprecated The real GHL locationId lives on `integration_connections.configJson`
   * and is resolved at dispatch time by the live executor (`ghlCtx.locationId`
   * from `resolveGhlContext`). This field is retained for backwards compatibility
   * with existing callers but the rate-limiter no longer consults it — keeping
   * it would bucket planner calls separately from ClientPulse polling.
   */
  subaccountLocationId?: string;
  runId?: string;
  briefId?: string;
  principalType: 'user' | 'agent' | 'system';
  principalId: string;
  teamIds: string[];
  callerCapabilities: Set<string>;
  defaultSenderIdentifier?: string;
}
