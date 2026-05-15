import { z } from 'zod';
import { TASK_TYPES, SOURCE_TYPES, EXECUTION_PHASES, ROUTING_MODES, CALL_SITES } from '../../db/schema/index.js';
import type { ProviderMessage, ProviderTool } from '../providers/types.js';

// Rev §6 — caller policy for system-scoped consumers. Defaults to
// 'respect_routing' so existing callers keep their auto-routed behaviour.
// 'bypass_routing' is the escape hatch for callers that pin a specific
// model (e.g. skill analyzer Sonnet classifier). See spec §5.4 + §7.2.
const SYSTEM_CALLER_POLICIES = ['respect_routing', 'bypass_routing'] as const;
export type SystemCallerPolicy = typeof SYSTEM_CALLER_POLICIES[number];

export const LLMCallContextSchema = z.object({
  organisationId:     z.string().uuid(),
  subaccountId:       z.string().uuid().optional(),
  userId:             z.string().uuid().optional(),
  runId:              z.string().uuid().optional(),
  executionId:        z.string().uuid().optional(),
  subaccountAgentId:  z.string().uuid().optional(),
  sourceType:         z.enum(SOURCE_TYPES),
  agentName:          z.string().optional(),
  taskType:           z.enum(TASK_TYPES),
  // Rev §6 — nullable for system/analyzer. Required for agent_run /
  // process_execution / iee (enforced by DB CHECK + runtime guard below).
  executionPhase:     z.enum(EXECUTION_PHASES).optional(),
  provider:           z.string().min(1).optional(),
  model:              z.string().min(1).optional(),
  routingMode:        z.enum(ROUTING_MODES).default('ceiling'),
  // Escalation tracking — set by agentExecutionService when economy model fails validation
  wasEscalated:       z.boolean().optional(),
  escalationReason:   z.string().optional(),
  // ── IEE attribution (rev 6 §11.7.1, §13.1) ──────────────────────────────
  // `callSite` distinguishes app-side LLM calls from worker-side calls so the
  // run-detail Cost panel can split LLM cost between the two for the same run.
  callSite:           z.enum(CALL_SITES).optional(),
  // `ieeRunId` MUST be set when sourceType='iee' or callSite='worker'.
  // Enforced by the runtime guard below AND a database CHECK constraint.
  ieeRunId:           z.string().uuid().optional(),
  // ── Operator Backend attribution (migration 0339, spec §3.12, §4.10) ───────
  // Optional nullable FK to operator_runs.id. Populated for per_token rows
  // written during operator-session fallback. Does NOT participate in the
  // per-token row's idempotency key — it is attribution only.
  operatorRunId:      z.string().uuid().optional(),
  // Cost-accounting boundary within a chain link (part of idempotency key for
  // subscription_mediated and sandbox_compute rows).
  boundary:           z.string().optional(),
  // ── Rev §6 polymorphic attribution (spec §5.1 / §6.1) ────────────────────
  // `sourceId` is the polymorphic FK for non-agent consumers. Required when
  // sourceType='analyzer'; optional when sourceType='system'; must be NULL
  // otherwise (CHECK constraint + runtime guard below).
  sourceId:           z.string().uuid().optional(),
  // `featureTag` identifies the feature end-to-end for dashboards. Kebab-case
  // string, e.g. 'skill-analyzer-classify'. Defaults to 'unknown' with a
  // router-side warning to nudge callers toward explicit tagging.
  featureTag:         z.string().min(1).optional(),
  // System-caller routing opt-out. Only meaningful when sourceType='system'
  // or 'analyzer'; ignored for billable callers (they always route normally).
  // Defaulted to 'respect_routing' at the usage site below so existing
  // callers don't have to touch every LLMCallContext literal.
  systemCallerPolicy: z.enum(SYSTEM_CALLER_POLICIES).optional(),
});

// Use z.input not z.infer so Zod's `.default()` fields (routingMode) stay
// optional for callers. `.parse()` fills the defaults in, so internal code
// can still rely on them being present on the parsed `ctx` object.
export type LLMCallContext = z.input<typeof LLMCallContextSchema>;

export interface RouterCallParams {
  messages:     ProviderMessage[];
  system?:      string | { stablePrefix: string; dynamicSuffix: string };
  tools?:       ProviderTool[];
  maxTokens?:   number;
  temperature?: number;
  estimatedContextTokens?: number;
  context:      LLMCallContext;
  /**
   * Caller's AbortSignal — threaded through the adapter's fetch so mid-flight
   * cancellation actually kills the HTTP request. When the signal fires, the
   * adapter throws a CLIENT_DISCONNECTED error and the router writes a row
   * with status='aborted_by_caller' and abortReason from AbortSignal.reason
   * (convention: 'caller_timeout' or 'caller_cancel'). See spec §8.1.
   */
  abortSignal?: AbortSignal;
  /**
   * Post-processing hook — invoked after the adapter returns a 200 OK
   * response, before the ledger row is written. Throw `ParseFailureError`
   * to signal the response failed the caller's schema check; the router
   * records status='parse_failure' + parseFailureRawExcerpt and re-throws
   * for caller control flow. See spec §8.3 / §19.7.
   */
  postProcess?: (content: string) => void | Promise<void>;
  /**
   * Deferred-items brief §5 — opt-in token-level streaming. When true,
   * the router uses `providerAdapter.stream()` (if the adapter implements
   * it) and forwards throttled progress events to the in-flight registry.
   * The final ProviderResponse shape is identical to `call()` — postProcess
   * runs on the complete accumulated response, not on each chunk. Adapters
   * that don't implement `stream()` transparently fall through to `call()`.
   *
   * Streaming MUST coordinate with the partial-external-success work
   * (brief §1) — a provider that has emitted N tokens has already billed
   * for them, so an aborted stream is handled by the same `'started'`
   * row + reconciliation contract as a non-streamed call.
   */
  stream?:      boolean;
  /**
   * Cached Context Infrastructure §6.6 — assembled prefix hash for this call.
   * Optional; only passed by cachedContextOrchestrator. Phase 4 accepts the
   * param but does NOT persist it (column lands in Phase 5 / migration 0210).
   */
  prefixHash?:  string;
  /**
   * Cached Context Infrastructure §6.6 — caller TTL hint for ephemeral cache.
   * Passed through to the provider adapter's cache_control block. Defaults to
   * '1h' when not provided. Resolver-narrowed TTL is deferred (§12.15).
   */
  cacheTtl?:    '5m' | '1h';
}

// Fallback chain entry — tracks each provider attempt for debugging
export interface FallbackAttempt {
  provider: string;
  model: string;
  error?: string;
  success?: boolean;
}
