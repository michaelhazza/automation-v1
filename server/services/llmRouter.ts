import { createHash } from 'crypto';
import { db } from '../db/index.js';
import { recordIncident } from './incidentIngestor.js';
import { llmRequests, ieeRuns, agentRunLlmPayloads, TASK_TYPES, SOURCE_TYPES, EXECUTION_PHASES, ROUTING_MODES, CALL_SITES } from '../db/schema/index.js';
import { createGeneration, createEvent } from '../lib/tracing.js';
import type { TaskType, SourceType, ExecutionPhase, RoutingMode, CallSite } from '../db/schema/index.js';
import { RouterContractError } from '../../shared/iee/index.js';
import { FailureError } from '../../shared/iee/failure.js';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getProviderAdapter } from './providers/registry.js';
import { pricingService } from './pricingService.js';
import { budgetService, BudgetExceededError, RateLimitError } from './budgetService.js';
import { resolveLLM } from './llmResolver.js';
import type { ProviderMessage, ProviderTool, ProviderResponse } from './providers/types.js';
import { env } from '../lib/env.js';
import { isParseFailureError } from '../lib/parseFailureError.js';
import { classifyRouterError } from './llmRouterErrorMappingPure.js';
import {
  PROVIDER_CALL_TIMEOUT_MS,
  PROVIDER_MAX_RETRIES,
  PROVIDER_BACKOFF_MS,
  PROVIDER_FALLBACK_CHAIN,
  PROVIDER_COOLDOWN_MS,
} from '../config/limits.js';
import * as inflightRegistry from './llmInflightRegistry.js';
import { buildRuntimeKey } from './llmInflightRegistryPure.js';
import { generateIdempotencyKey } from './llmRouterIdempotencyPure.js';
import { ReconciliationRequiredError } from '../lib/reconciliationRequiredError.js';
import * as llmInflightPayloadStore from './llmInflightPayloadStore.js';
import { logger } from '../lib/logger.js';
import { tryEmitAgentEvent } from './agentExecutionEventEmitter.js';
import { buildPayloadRow } from './agentRunPayloadWriter.js';
import { shouldEmitLaelLifecycle } from './llmRouterLaelPure.js';
export { shouldEmitLaelLifecycle } from './llmRouterLaelPure.js';

// ---------------------------------------------------------------------------
// LLM Router — the financial chokepoint for every LLM call in the platform.
//
// Every callAnthropic() becomes routeCall() with a context object.
// The router owns: attribution, cost, budget enforcement, idempotency, audit.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Rev §6 — caller policy for system-scoped consumers. Defaults to
// 'respect_routing' so existing callers keep their auto-routed behaviour.
// 'bypass_routing' is the escape hatch for callers that pin a specific
// model (e.g. skill analyzer Sonnet classifier). See spec §5.4 + §7.2.
const SYSTEM_CALLER_POLICIES = ['respect_routing', 'bypass_routing'] as const;
type SystemCallerPolicy = typeof SYSTEM_CALLER_POLICIES[number];

const LLMCallContextSchema = z.object({
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

// ---------------------------------------------------------------------------
// Idempotency key — pure derivation lives in `llmRouterIdempotencyPure.ts`
// so the v1:-prefixed contract (deferred-items brief §2) can be pinned by
// a pure test without booting the env-dependent router module.
// Includes provider + model: different provider/model = distinct financial event
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Billing period helpers — always UTC
// ---------------------------------------------------------------------------

function getBillingPeriods(): { billingMonth: string; billingDay: string } {
  const now = new Date();
  return {
    billingMonth: now.toISOString().slice(0, 7),   // 'YYYY-MM'
    billingDay:   now.toISOString().slice(0, 10),  // 'YYYY-MM-DD'
  };
}

// ---------------------------------------------------------------------------
// Provider timeout guard — pure implementation lives in llmRouterTimeoutPure
// so tests can exercise it without booting the env-dependent router module.
// Imported AND re-exported: the router uses it locally on every call and
// callers of routeCall may need the typed error for their own classification.
// ---------------------------------------------------------------------------

import { ProviderTimeoutError, callWithTimeout } from './llmRouterTimeoutPure.js';
export { ProviderTimeoutError, callWithTimeout };

// ---------------------------------------------------------------------------
// Provider cooldown map — skip recently-failed providers
// ---------------------------------------------------------------------------

const providerCooldowns: Map<string, number> = new Map();

function isProviderCoolingDown(provider: string): boolean {
  const cooldownUntil = providerCooldowns.get(provider);
  if (!cooldownUntil) return false;
  if (Date.now() > cooldownUntil) {
    providerCooldowns.delete(provider);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Model mapping for fallback providers
// Maps Anthropic model names → equivalent models on other providers
// ---------------------------------------------------------------------------

const FALLBACK_MODEL_MAP: Record<string, Record<string, string>> = {
  openai: {
    'claude-sonnet-4-6': 'gpt-4o',
    'claude-haiku-4-5':  'gpt-4o-mini',
    'claude-opus-4-6':   'gpt-4o',
  },
  gemini: {
    'claude-sonnet-4-6': 'gemini-2.5-flash',
    'claude-haiku-4-5':  'gemini-2.5-flash-lite',
    'claude-opus-4-6':   'gemini-2.5-flash',
  },
  openrouter: {
    'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
    'claude-haiku-4-5':  'anthropic/claude-haiku-4-5',
    'claude-opus-4-6':   'anthropic/claude-opus-4-6',
    'gpt-4o':            'openai/gpt-4o',
    'gpt-4o-mini':       'openai/gpt-4o-mini',
  },
};

// Fallback chain entry — tracks each provider attempt for debugging
interface FallbackAttempt {
  provider: string;
  model: string;
  error?: string;
  success?: boolean;
}

function isNonRetryableError(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string; message?: string };
  if (e.statusCode === 400 || e.statusCode === 401 || e.statusCode === 403) return true;
  if (e.code === 'PROVIDER_NOT_CONFIGURED') return true;
  // Rev §6 — caller-initiated aborts must not retry. The caller decided to
  // stop; re-hitting the provider on their behalf wastes tokens and can
  // produce confusing duplicate calls in the Anthropic console.
  if (e.code === 'CLIENT_DISCONNECTED') return true;
  // Provider timeouts are "ambiguous state" — the provider may have already
  // completed generation server-side. A retry under the same idempotency key
  // would issue a second concurrent call and double-bill at the provider
  // layer (no LLM provider currently supports request-level dedup headers).
  // Propagate immediately; the caller decides whether to replay under a new
  // idempotency key. See spec §17 deferred items.
  if (e.code === 'PROVIDER_TIMEOUT') return true;
  const code = (e.code ?? '').toLowerCase();
  return code.includes('auth') || code.includes('invalid') || code.includes('bad_request');
}

// ---------------------------------------------------------------------------
// IEE run-id resolver (Hermes Tier 1 Phase C §7.6)
// ---------------------------------------------------------------------------
//
// The cost breaker requires an `agent_runs.id` (`runId`) to look up the
// per-run cost ceiling. IEE-sourced calls (`sourceType='iee'`) may or may
// not carry `runId` directly; when they don't, `ieeRunId` is the handle
// and the parent `agent_run_id` lives on `iee_runs`.
//
// Kept local to the router per §7.6: the breaker stays agnostic about how
// its `runId` was derived, and the router already owns `iee_runs` reads
// for other routing metadata. One indexed primary-key lookup per
// `routeCall`; no memoisation across calls (the cache key would be
// `routeCall` invocation itself, and each invocation runs once).
async function resolveRunIdFromIee(ieeRunId: string | undefined): Promise<string | null> {
  if (!ieeRunId) return null;
  const [row] = await db
    .select({ agentRunId: ieeRuns.agentRunId })
    .from(ieeRuns)
    .where(eq(ieeRuns.id, ieeRunId))
    .limit(1);
  return row?.agentRunId ?? null;
}

// ---------------------------------------------------------------------------
// Main router — drop-in replacement for callAnthropic()
// ---------------------------------------------------------------------------

export async function routeCall(params: RouterCallParams): Promise<ProviderResponse> {
  const routerStart = Date.now();
  // `queuedAt` — captured at the very top of routeCall so the gap between
  // caller invocation and adapter dispatch (budget lock wait, provider
  // cooldown bounce chain, model resolver) is visible to the In-Flight tab.
  // See deferred-items brief §3. Pre-dispatch terminals (budget_blocked,
  // rate_limited) never produce a registry entry so `queuedAt` only surfaces
  // on entries that reach inflightRegistry.add().
  const queuedAt = new Date(routerStart).toISOString();

  // ── 1. Validate context ─────────────────────────────────────────────────
  const ctx = LLMCallContextSchema.parse(params.context);

  // ── 1a. IEE contract guards (rev 6 §13.1) ───────────────────────────────
  // Two layers protect cost-attribution integrity for IEE runs:
  //   1. This runtime guard — fast feedback to the caller.
  //   2. A database CHECK constraint (llm_requests_iee_requires_run_id) that
  //      catches any future code path that bypasses the router.
  if (ctx.sourceType === 'iee' && !ctx.ieeRunId) {
    throw new RouterContractError('llmRouter: ieeRunId is required when sourceType="iee"');
  }
  if (ctx.callSite === 'worker' && !ctx.ieeRunId) {
    throw new RouterContractError('llmRouter: ieeRunId is required when callSite="worker"');
  }

  // ── 1a'. Rev §6 — polymorphic attribution + feature-tag guards ───────────
  //
  // Mirrors the DB CHECK constraint llm_requests_attribution_ck from
  // migration 0185. Fails closed at the router so callers get an immediate
  // contract error rather than a cryptic 23514 from Postgres.
  if (ctx.sourceType === 'analyzer') {
    if (!ctx.sourceId) {
      throw new RouterContractError('llmRouter: sourceId is required when sourceType="analyzer"');
    }
    if (ctx.runId || ctx.executionId || ctx.ieeRunId) {
      throw new RouterContractError(
        'llmRouter: analyzer rows must not set runId/executionId/ieeRunId — use sourceId instead',
      );
    }
  }
  if (ctx.sourceType === 'agent_run' && !ctx.runId) {
    throw new RouterContractError('llmRouter: runId is required when sourceType="agent_run"');
  }
  if (ctx.sourceType === 'process_execution' && !ctx.executionId) {
    throw new RouterContractError('llmRouter: executionId is required when sourceType="process_execution"');
  }
  // executionPhase must be set for billable (agent-execution) rows and NULL
  // for system/analyzer — mirrors DB CHECK llm_requests_execution_phase_ck.
  const isSystemScoped = ctx.sourceType === 'system' || ctx.sourceType === 'analyzer';
  if (!isSystemScoped && !ctx.executionPhase) {
    throw new RouterContractError(
      `llmRouter: executionPhase is required when sourceType="${ctx.sourceType}"`,
    );
  }
  if (isSystemScoped && ctx.executionPhase) {
    throw new RouterContractError(
      `llmRouter: executionPhase must be null when sourceType="${ctx.sourceType}"`,
    );
  }
  // Feature-tag hygiene — warn (don't throw) when a caller forgets to tag.
  // In tests, the default 'unknown' is expected; in production code paths
  // it signals a missed wiring opportunity for the System P&L page.
  if (!ctx.featureTag && process.env.NODE_ENV !== 'test') {
    console.warn('[llmRouter] missing feature_tag', {
      sourceType: ctx.sourceType,
      organisationId: ctx.organisationId,
    });
  }

  // ── 1b. Resolve provider + model from execution phase ─────────────────
  let effectiveProvider: string;
  let effectiveModel: string;
  let routingTier: 'frontier' | 'economy' = 'frontier';
  let wasDowngraded = false;
  let routingReason: string = 'ceiling';

  const systemCallerPolicy = ctx.systemCallerPolicy ?? 'respect_routing';
  if (systemCallerPolicy === 'bypass_routing') {
    // Rev §6 — caller has pinned provider+model (typical for non-agent
    // consumers whose prompts are model-specific). Skip resolveLLM() but
    // still go through the router so the call lands in llm_requests.
    effectiveProvider = ctx.provider ?? 'anthropic';
    effectiveModel = ctx.model ?? 'claude-sonnet-4-6';
    routingReason = 'forced';
  } else if (env.ROUTER_FORCE_FRONTIER) {
    // Kill switch: skip all routing, use ceiling model.
    effectiveProvider = ctx.provider ?? 'anthropic';
    effectiveModel = ctx.model ?? 'claude-sonnet-4-6';
    routingReason = 'forced';
  } else {
    // Fall through to the resolver. resolveLLM requires a concrete phase;
    // system-scoped callers should always use bypass_routing so this branch
    // is never reached without an executionPhase. If a caller misconfigures
    // themselves, fall back to 'execution' rather than throwing — the
    // runtime guard above already rejects the inconsistent combination.
    const resolved = resolveLLM({
      phase:    ctx.executionPhase ?? 'execution',
      taskType: ctx.taskType,
      ceiling:  (ctx.provider && ctx.model) ? { provider: ctx.provider, model: ctx.model } : undefined,
      mode:     ctx.routingMode ?? 'ceiling',
      constraints: {
        requiresToolCalling: !!(params.tools && params.tools.length > 0),
        estimatedContextTokens: params.estimatedContextTokens,
        expectedMaxOutputTokens: params.maxTokens,
      },
    });

    if (env.ROUTER_SHADOW_MODE) {
      // Shadow mode: log what would have been used, but use ceiling
      console.info('[llmRouter] shadow:', JSON.stringify({
        wouldUse: { provider: resolved.provider, model: resolved.model, tier: resolved.tier },
        actuallyUsing: { provider: ctx.provider, model: ctx.model },
        reason: resolved.reason,
      }));
      effectiveProvider = ctx.provider ?? 'anthropic';
      effectiveModel = ctx.model ?? 'claude-sonnet-4-6';
      routingReason = 'ceiling';
    } else {
      effectiveProvider = resolved.provider;
      effectiveModel = resolved.model;
      routingTier = resolved.tier;
      wasDowngraded = resolved.wasDowngraded;
      routingReason = resolved.reason;
    }
  }

  // ── 2. Check provider is registered ────────────────────────────────────
  const adapter = getProviderAdapter(effectiveProvider);

  // ── 3. Generate idempotency key ─────────────────────────────────────────
  const idempotencyKey = generateIdempotencyKey(ctx, params.messages, effectiveProvider, effectiveModel);

  // ── 4–7. Idempotency check + budget reservation (atomic transaction) ────
  // Wrap the idempotency lookup and budget reservation in a single transaction
  // so two concurrent requests with the same key cannot both pass through.
  const { billingMonth, billingDay } = getBillingPeriods();

  // ── 5. Resolve pricing and estimate cost (outside tx — read-only, no race) ──
  const [pricing, margin] = await Promise.all([
    pricingService.getPricing(effectiveProvider, effectiveModel),
    pricingService.getMargin(ctx.organisationId),
  ]);

  const maxTokensForEstimate = params.maxTokens ?? 4096;
  const estimatedCostCents = await pricingService.estimateCost(
    effectiveProvider, effectiveModel, maxTokensForEstimate, ctx.organisationId,
  );

  // ── 6. Compute request payload hash ────────────────────────────────────
  const requestPayloadHash = createHash('sha256')
    .update(JSON.stringify(params.messages))
    .digest('hex');

  // ── 4+7. Atomic idempotency check + provisional ledger write ───────────
  //
  // Deferred-items brief §1 — the provisional `'started'` row MUST be
  // inserted inside this transaction, not after. A SELECT FOR UPDATE only
  // locks existing rows; when no row exists for `idempotencyKey`, two
  // concurrent first-calls both pass the check, both commit, and both
  // proceed to dispatch — the exact double-bill window §1 exists to
  // prevent. Pulling the INSERT into the transaction makes the second
  // caller block on the unique-constraint conflict until the first
  // transaction commits; the second tx's own SELECT FOR UPDATE then
  // returns the `'started'` row and correctly takes the reconciliation
  // branch.
  //
  // pr-review finding #1 (2026-04-21): this contract was previously
  // violated — the INSERT was after the transaction and the race window
  // was open. DO NOT move the INSERT back out of this block.
  let reservationId: string | null = null;
  let budgetBlockedStatus: string | null = null;
  let budgetErrorMessage: string | null = null;

  const idempotencyResult = await db.transaction(async (tx) => {
    // Check for existing record inside the transaction
    const existing = await tx
      .select()
      .from(llmRequests)
      .where(eq(llmRequests.idempotencyKey, idempotencyKey))
      .for('update')
      .limit(1);

    if (existing.length > 0 && existing[0].status === 'success') {
      return {
        cached: true as const,
        response: {
          content:           '',
          stopReason:        'cached' as const,
          tokensIn:          existing[0].tokensIn,
          tokensOut:         existing[0].tokensOut,
          providerRequestId: existing[0].providerRequestId ?? '',
        },
      };
    }

    // Deferred-items brief §1 — a provisional `'started'` row means a prior
    // attempt under the same idempotencyKey already called the provider
    // (which has billed). A retry cannot safely re-dispatch. Surface a
    // typed error so the caller owns the reconciliation decision.
    //
    // Important: this check is ONLY for rows whose status is literally
    // 'started'. Terminal error/timeout rows are still overwritable by
    // the usual upsert path (see `where status != 'success'` clause on
    // the success-insert at the bottom of this function).
    if (existing.length > 0 && existing[0].status === 'started') {
      return { inflight: true as const } as const;
    }

    // Terminal error/terminal-failure rows from a prior attempt exist but
    // are overwritable — fall through to write a fresh `'started'` row
    // below. The upsert conflict target is idempotencyKey and the
    // onConflictDoUpdate `where: status != 'success'` guard keeps any
    // prior success row (which was already returned above) untouched.
    const provisional = await tx
      .insert(llmRequests)
      .values({
        idempotencyKey,
        organisationId:      ctx.organisationId,
        subaccountId:        ctx.subaccountId,
        userId:              ctx.userId,
        sourceType:          ctx.sourceType,
        runId:               ctx.runId,
        executionId:         ctx.executionId,
        ieeRunId:            ctx.ieeRunId,
        sourceId:            ctx.sourceId,
        featureTag:          ctx.featureTag ?? 'unknown',
        callSite:            ctx.callSite ?? 'app',
        agentName:           ctx.agentName,
        taskType:            ctx.taskType,
        executionPhase:      ctx.executionPhase,
        provider:            effectiveProvider,
        model:               effectiveModel,
        tokensIn:            0,
        tokensOut:           0,
        costRaw:             '0',
        costWithMargin:      '0',
        costWithMarginCents: 0,
        marginMultiplier:    String(margin.multiplier),
        fixedFeeCents:       margin.fixedFeeCents,
        requestPayloadHash,
        status:              'started',
        requestedProvider:   effectiveProvider,
        requestedModel:      effectiveModel,
        wasEscalated:        ctx.wasEscalated ?? false,
        escalationReason:    ctx.escalationReason,
        billingMonth,
        billingDay,
      })
      // A prior terminal-error row may still own this key. Overwrite it
      // with a fresh `'started'` so the retry path works as expected; the
      // `where: status != 'success'` guard protects committed successes
      // (which have already been caught and returned above anyway).
      //
      // `createdAt: sql\`now()\`` resets the row's age so a revived
      // terminal-error row (which may be hours old) doesn't appear
      // immediately sweep-eligible to `llmStartedRowSweepJob`. Without
      // this reset, a retry on a key whose prior error row is older than
      // PROVIDER_CALL_TIMEOUT_MS + 60s would be reaped by the sweep while
      // the provider call is still in flight — reopening the double-bill
      // window this provisional-row mechanism exists to prevent.
      .onConflictDoUpdate({
        target: [llmRequests.idempotencyKey],
        set: {
          status:              'started',
          errorMessage:        null,
          provider:            effectiveProvider,
          model:               effectiveModel,
          requestPayloadHash,
          requestedProvider:   effectiveProvider,
          requestedModel:      effectiveModel,
          marginMultiplier:    String(margin.multiplier),
          fixedFeeCents:       margin.fixedFeeCents,
          tokensIn:            0,
          tokensOut:           0,
          costRaw:             '0',
          costWithMargin:      '0',
          costWithMarginCents: 0,
          createdAt:           sql`now()`,
        },
        where: sql`${llmRequests.status} != 'success'`,
      })
      .returning({ id: llmRequests.id });

    return { cached: false as const, provisionalRowId: provisional[0]?.id ?? null };
  });

  if ('inflight' in idempotencyResult) {
    createEvent('llm.router.reconciliation_required', {
      idempotencyKey,
      model: effectiveModel,
      provider: effectiveProvider,
    });
    throw new ReconciliationRequiredError({ idempotencyKey });
  }

  if (idempotencyResult.cached) {
    createEvent('llm.router.cache_hit', {
      idempotencyKey,
      model: effectiveModel,
      provider: effectiveProvider,
    });
    return idempotencyResult.response;
  }
  // `provisionalLedgerRowId` is the UUID of the `'started'` row created
  // in the idempotency-check transaction above. The terminal upsert (both
  // success and failure paths) writes to the same idempotencyKey, so the
  // row's UUID does not change — `provisionalLedgerRowId` equals the final
  // terminal `ledgerRowId`. Threaded to `llm.requested` (§1.1 LAEL-P1-1).
  const provisionalLedgerRowId = idempotencyResult.provisionalRowId;

  try {
    reservationId = await budgetService.checkAndReserve(
      {
        organisationId:    ctx.organisationId,
        subaccountId:      ctx.subaccountId,
        runId:             ctx.runId,
        subaccountAgentId: ctx.subaccountAgentId,
        sourceType:        ctx.sourceType,
        billingDay,
        billingMonth,
      },
      estimatedCostCents,
      idempotencyKey,
    );
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      budgetBlockedStatus = 'budget_blocked';
      budgetErrorMessage = err.message;
      createEvent('llm.router.budget_exceeded', {
        estimatedCostCents,
        reason: 'insufficient_budget',
      });
    } else if (err instanceof RateLimitError) {
      budgetBlockedStatus = 'rate_limited';
      budgetErrorMessage = err.message;
    } else {
      throw err;
    }
  }

  // Write the audit record for blocked calls (budget_blocked / rate_limited).
  // The provisional `'started'` row was already inserted inside the
  // idempotency-check transaction above, so we must overwrite it here
  // — not onConflictDoNothing — otherwise the `'started'` row stays in
  // the table until the sweep reaps it 660s later. `where status != 'success'`
  // preserves the invariant that a committed success is never downgraded.
  if (budgetBlockedStatus) {
    const budgetBlockedInsertedRows = await db
      .insert(llmRequests)
      .values({
        idempotencyKey,
        organisationId:      ctx.organisationId,
        subaccountId:        ctx.subaccountId,
        userId:              ctx.userId,
        sourceType:          ctx.sourceType,
        runId:               ctx.runId,
        executionId:         ctx.executionId,
        ieeRunId:            ctx.ieeRunId,        // §11.7.1
        sourceId:            ctx.sourceId,        // rev §6
        featureTag:          ctx.featureTag ?? 'unknown',  // rev §6
        callSite:            ctx.callSite ?? 'app',
        agentName:           ctx.agentName,
        taskType:            ctx.taskType,
        executionPhase:      ctx.executionPhase,  // nullable for system/analyzer
        provider:            effectiveProvider,
        model:               effectiveModel,
        tokensIn:            0,
        tokensOut:           0,
        costRaw:             '0',
        costWithMargin:      '0',
        costWithMarginCents: 0,
        marginMultiplier:    String(margin.multiplier),
        fixedFeeCents:       margin.fixedFeeCents,
        requestPayloadHash,
        routerOverheadMs:    Date.now() - routerStart,
        status:              budgetBlockedStatus,
        errorMessage:        budgetErrorMessage,
        requestedProvider:   effectiveProvider,
        requestedModel:      effectiveModel,
        wasEscalated:        ctx.wasEscalated ?? false,
        escalationReason:    ctx.escalationReason,
        billingMonth,
        billingDay,
      })
      .onConflictDoUpdate({
        target: [llmRequests.idempotencyKey],
        set: {
          status:           budgetBlockedStatus,
          errorMessage:     budgetErrorMessage,
          routerOverheadMs: Date.now() - routerStart,
        },
        // Dual-review round 2 / reviewer feedback: tighten from
        // `!= 'success'` to `= 'started'`. The budget-blocked path runs
        // milliseconds after the provisional INSERT in the idempotency tx,
        // so the row is expected to be in 'started' state. A mismatch
        // (sweep fired, prior retry already terminalised, etc.) means
        // something raced and the budget-block's audit record is being
        // silently discarded — log it rather than swallow.
        where: sql`${llmRequests.status} = 'started'`,
      })
      .returning({ id: llmRequests.id });

    if (budgetBlockedInsertedRows.length === 0) {
      logger.warn('llm_router.budget_block_upsert_ghost', {
        idempotencyKey,
        budgetBlockedStatus,
        note: 'existing row was not in started state — audit trail dropped',
      });
    }

    throw {
      statusCode: 402,
      code: budgetBlockedStatus === 'budget_blocked' ? 'BUDGET_EXCEEDED' : 'RATE_LIMITED',
      message: budgetErrorMessage,
    };
  }

  // ── 8. Call the provider with retry-fallback loop ───────────────────────
  // (The provisional `'started'` row is now written atomically inside the
  // idempotency-check transaction above — see the brief §1 / pr-review
  // finding #1. Do NOT re-introduce a separate post-transaction INSERT.)
  const providerStart = Date.now();
  let providerResponse: ProviderResponse | null = null;
  let callStatus: string = 'success';
  let callError: string | null = null;
  let attemptNumber = 1;
  let actualProvider = effectiveProvider;
  let actualModel = effectiveModel;
  const fallbackAttempts: FallbackAttempt[] = [];

  // ── In-flight registry wiring (spec tasks/llm-inflight-realtime-tracker-spec.md) ──
  //
  // `currentRuntimeKey` tracks the attempt currently represented in the
  // in-flight registry. It is set immediately before each provider
  // dispatch and cleared after `inflightRegistry.remove()`. The final
  // attempt's removal fires AFTER the ledger upsert so the removal event
  // carries `ledgerRowId` + `ledgerCommittedAt` for UI reconciliation.
  //
  // An unhandled throw between add() and remove() (e.g. a DB error during
  // the ledger upsert) leaves the entry alive until the deadline-based
  // sweep reaps it — the 30s buffer past `timeoutMs` captures exactly that
  // window. See `llmInflightRegistry.ts` sweep loop for the safety net.
  let currentRuntimeKey: string | null = null;
  // When every attempt is a retryable error, each inner-catch removal
  // clears `currentRuntimeKey` before the outer failure-path ledger
  // write fires — which means the final failure's ledger row never gets
  // linked into the registry's removal event. We record the final
  // removed attempt here so the failure path can call
  // `inflightRegistry.updateLedgerLink()` with the now-known row id,
  // closing the UX gap flagged in pr-review — "[ledger] button missing
  // for retryable-error-only failures".
  let lastRemovedAttempt: {
    runtimeKey:     string;
    idempotencyKey: string;
    attempt:        number;
    startedAt:      string;
    terminalStatus: 'error';
  } | null = null;

  // Cross-provider monotonic counter — ticks once per attempt whether the
  // attempt succeeds, retries, or fans out to a fallback provider. Paired
  // with the per-provider `attempt` counter so the In-Flight tab can show
  // "#3 of the logical call" instead of misleadingly showing "#1 (again)"
  // whenever the fallback chain advances. See deferred-items brief §4.
  let attemptSequence = 0;

  // Build fallback chain: primary provider first, then others in order
  const fallbackChain = [
    effectiveProvider,
    ...PROVIDER_FALLBACK_CHAIN.filter(p => p !== effectiveProvider),
  ];

  let lastError: unknown = null;
  let fallbackIndex = -1;

  // ── §1.1 LAEL-P1-1 pairing-completeness flags ────────────────────────────
  // `laelRequestEmitted` is set to true after emitting `llm.requested` so the
  // finally block below can guarantee a matching `llm.completed` fires even if
  // an exception escapes between the two emission sites. `laelCompletedEmitted`
  // is set to true at each normal `llm.completed` emit site so the finally
  // block does not double-emit on the normal paths.
  let laelRequestEmitted = false;
  let laelCompletedEmitted = false;
  // `terminalStatus` carries the final status value for the finally fallback.
  // Initialised to null; set by the success/failure paths before they emit.
  let terminalStatus: string | null = null;

  providerLoop:
  for (const provider of fallbackChain) {
    fallbackIndex++;
    if (isProviderCoolingDown(provider)) {
      console.warn(`[llmRouter] Skipping provider ${provider} — in cooldown`);
      continue;
    }

    // Map the original model to the equivalent model for this provider
    const mappedModel = provider === effectiveProvider
      ? effectiveModel
      : FALLBACK_MODEL_MAP[provider]?.[effectiveModel];

    // Skip this fallback provider if there is no explicit model mapping for it
    if (mappedModel === undefined) {
      console.warn(`[llmRouter] No model mapping for ${provider}/${ctx.model} — skipping`);
      continue;
    }

    let providerAdapter;
    try {
      providerAdapter = getProviderAdapter(provider);
    } catch {
      // Provider not registered — skip
      continue;
    }

    for (let attempt = 1; attempt <= PROVIDER_MAX_RETRIES + 1; attempt++) {
      // In-flight registry — one entry per attempt. runtimeKey is unique
      // across crash-restarts (see spec §4.2). add() fires post-budget-
      // reservation, immediately before the adapter dispatch.
      //
      // NOTE — `attempt` is the per-provider retry counter; it resets to
      // 1 on each fallback provider. The ledger's `attemptNumber` resets
      // the same way (line `attemptNumber = attempt` below), so the two
      // stay consistent, but the admin UI sees provider-B-attempt-1
      // immediately after provider-A-attempt-2 with no visible indication
      // that the earlier provider already failed. Distinct runtimeKeys
      // (different startedAt) prevent collision; the UX gap is a
      // documented follow-up, not a correctness bug.
      const attemptStartedAt = new Date().toISOString();
      const attemptRuntimeKey = buildRuntimeKey({
        idempotencyKey,
        attempt,
        startedAt: attemptStartedAt,
      });
      // Pre-add invariant (spec §6 llmRouter.ts row). Fail fast in dev so
      // an accidental double-add from a future refactor is caught at the
      // call site rather than silently becoming a registry-layer no-op.
      if (inflightRegistry.has(attemptRuntimeKey)) {
        const invariantMsg =
          `[llmRouter] inflight double-add invariant violated runtimeKey=${attemptRuntimeKey}`;
        if (process.env.NODE_ENV !== 'production') {
          throw new Error(invariantMsg);
        }
        console.error(invariantMsg);
      }
      // Tick the cross-provider sequence immediately before add() so the
      // registry entry carries the correct "this is the Nth attempt of
      // the logical call" value regardless of which provider is running.
      attemptSequence++;
      inflightRegistry.add({
        idempotencyKey,
        attempt,
        attemptSequence,
        fallbackIndex,
        startedAt:      attemptStartedAt,
        queuedAt,
        label:          `${provider}/${mappedModel}`,
        provider,
        model:          mappedModel,
        sourceType:     ctx.sourceType,
        sourceId:       ctx.sourceId ?? null,
        featureTag:     ctx.featureTag ?? 'unknown',
        organisationId: ctx.organisationId,
        subaccountId:   ctx.subaccountId ?? null,
        runId:          ctx.runId ?? null,
        executionId:    ctx.executionId ?? null,
        ieeRunId:       ctx.ieeRunId ?? null,
        callSite:       ctx.callSite ?? 'app',
        timeoutMs:      PROVIDER_CALL_TIMEOUT_MS,
      });
      currentRuntimeKey = attemptRuntimeKey;
      // Deferred-items brief §7 — capture the payload snapshot so the
      // admin live-row drawer can render prompt/system/tools. LRU-bounded
      // in-memory store (see llmInflightPayloadStore.ts), cleared on
      // registry.remove() below. Snapshot is by-reference in-memory only;
      // the store never forwards to the socket or DB.
      llmInflightPayloadStore.set(attemptRuntimeKey, {
        messages:    params.messages,
        system:      params.system,
        tools:       params.tools,
        maxTokens:   params.maxTokens,
        temperature: params.temperature,
      });

      // ── §1.1 LAEL-P1-1: llm.requested emission ──────────────────────────
      // Fired BEFORE the provider dispatch so observers can measure the
      // dispatch-to-completion window. provisionalLedgerRowId is the UUID of
      // the `'started'` row created above — the upsert at terminal time will
      // overwrite the row's fields but preserve the UUID, so this ID matches
      // the final ledger row. Only emitted for agent_run sourceType with a
      // valid runId (see shouldEmitLaelLifecycle — pre-dispatch terminals like
      // budget_blocked/rate_limited have already thrown above, so the only
      // in-scope status here is 'started').
      if (ctx.sourceType === 'agent_run' && ctx.runId && provisionalLedgerRowId) {
        tryEmitAgentEvent({
          runId:          ctx.runId,
          organisationId: ctx.organisationId,
          subaccountId:   ctx.subaccountId ?? null,
          sourceService:  'llmRouter',
          payload: {
            eventType:           'llm.requested',
            critical:            true,
            llmRequestId:        provisionalLedgerRowId,
            provider,
            model:               mappedModel,
            attempt,
            featureTag:          ctx.featureTag ?? 'unknown',
            payloadPreviewTokens: 0,
          },
          linkedEntity: { type: 'llm_request', id: provisionalLedgerRowId },
        });
        laelRequestEmitted = true;
      }

      try {
        providerResponse = await callWithTimeout(
          `${provider}/${mappedModel}`,
          PROVIDER_CALL_TIMEOUT_MS,
          params.abortSignal,
          async (signal) => {
            // Deferred-items brief §5 — opt into streaming when the caller
            // requests it AND the adapter implements `stream()`. Fall
            // through to `call()` otherwise. The streaming path emits
            // throttled progress events to the in-flight registry as
            // tokens arrive; the return shape is identical so the ledger
            // write path is unchanged.
            if (params.stream && typeof providerAdapter.stream === 'function') {
              const iterable = providerAdapter.stream({
                model:       mappedModel,
                messages:    params.messages,
                system:      params.system,
                tools:       params.tools,
                maxTokens:   params.maxTokens,
                temperature: params.temperature,
                signal,
              });
              // pr-review finding #3 (2026-04-21): if the for-await loop
              // exits via exception, `iterable.done` is left as an
              // unobserved Promise and Node.js emits
              // UnhandledPromiseRejection. Attach a no-op catch FIRST so
              // the handler is installed before any throw site, then
              // await it normally at the end. `await iterable.done`
              // re-observes the same Promise; a no-op handler alongside
              // the normal await is the standard node idiom for
              // "observe a Promise twice without double-reporting".
              iterable.done.catch(() => { /* intentional no-op — propagated via for-await */ });
              let tokensSoFar = 0;
              for await (const chunk of iterable) {
                if (typeof chunk.tokensSoFar === 'number') {
                  tokensSoFar = chunk.tokensSoFar;
                } else if (chunk.deltaText) {
                  // Rough token count — 1 per ~4 chars, same heuristic as
                  // TOKEN_INPUT_RATIO math. Adapters that surface the
                  // accurate tokensSoFar override this estimate.
                  tokensSoFar += Math.max(1, Math.round(chunk.deltaText.length / 4));
                }
                inflightRegistry.emitProgress({
                  runtimeKey:     attemptRuntimeKey,
                  idempotencyKey,
                  tokensSoFar,
                });
              }
              return await iterable.done;
            }
            return providerAdapter.call({
              model:       mappedModel,
              messages:    params.messages,
              system:      params.system,
              tools:       params.tools,
              maxTokens:   params.maxTokens,
              temperature: params.temperature,
              signal,
            });
          },
        );

        // Rev §6 — post-process hook. Runs the caller's schema check with
        // the raw content. If it throws ParseFailureError, treat like a
        // retryable provider error so the fallback loop can try again.
        if (params.postProcess) {
          try {
            await params.postProcess(providerResponse.content);
          } catch (postErr) {
            if (isParseFailureError(postErr)) {
              // Treat parse failure as a retryable error — the fallback loop
              // will retry up to PROVIDER_MAX_RETRIES, then the outer catch
              // writes the ledger row with status='parse_failure' and the
              // excerpt from the final attempt.
              providerResponse = null;
              throw postErr;
            }
            throw postErr;
          }
        }

        // Success — record actual provider/model used
        actualProvider = provider;
        actualModel = mappedModel;
        attemptNumber = attempt;
        fallbackAttempts.push({ provider, model: mappedModel, success: true });

        if (provider !== effectiveProvider || mappedModel !== effectiveModel) {
          console.info('[llmRouter] provider_fallback_used', {
            requestedProvider: effectiveProvider, requestedModel: effectiveModel,
            actualProvider: provider, actualModel: mappedModel,
            attemptNumber,
            organisationId: ctx.organisationId, runId: ctx.runId,
          });
        }

        break providerLoop;
      } catch (err: unknown) {
        lastError = err;
        fallbackAttempts.push({ provider, model: mappedModel, error: (err as Error).message });

        // Non-retryable errors break out to the ledger-write-on-failure path
        // below so every terminal attempt produces a ledger row — without
        // this, PROVIDER_TIMEOUT / PROVIDER_NOT_CONFIGURED / auth errors
        // would skip the ledger entirely and become invisible to the P&L
        // surface. The shared failure path at the bottom of this function
        // calls releaseReservation() + writes the row + rethrows lastError.
        if (isNonRetryableError(err)) {
          // Keep `currentRuntimeKey` — the terminal-failure ledger-write
          // path below will remove the entry once `ledgerRowId` is known.
          break providerLoop;
        }

        createEvent('llm.router.fallback', {
          failedProvider: provider,
          failedModel: mappedModel,
          error: String(err).slice(0, 200),
          attemptIndex: attempt,
        });

        // Retryable error — remove this attempt's entry from the registry
        // before the backoff sleep / next attempt. The next attempt's
        // runtimeKey will be distinct (new startedAt) so the pre-add
        // invariant above is honoured. Capture the attempt's identity in
        // `lastRemovedAttempt` so the failure path can re-emit a
        // ledger-linked removal event if all attempts exhaust without
        // entering the `currentRuntimeKey != null` path below.
        if (currentRuntimeKey) {
          inflightRegistry.remove({
            runtimeKey:      currentRuntimeKey,
            terminalStatus:  'error',
            completedAt:     new Date().toISOString(),
            ledgerRowId:     null,
            ledgerCommittedAt: null,
            sweepReason:     null,
            evictionContext: null,
          });
          llmInflightPayloadStore.remove(currentRuntimeKey);
          lastRemovedAttempt = {
            runtimeKey:     currentRuntimeKey,
            idempotencyKey,
            attempt,
            startedAt:      attemptStartedAt,
            terminalStatus: 'error',
          };
          currentRuntimeKey = null;
        }

        if (attempt <= PROVIDER_MAX_RETRIES) {
          const backoff = PROVIDER_BACKOFF_MS[attempt - 1] ?? PROVIDER_BACKOFF_MS[PROVIDER_BACKOFF_MS.length - 1];
          console.warn(`[llmRouter] Provider ${provider} attempt ${attempt} failed, retrying in ${backoff}ms`, {
            error: (err as Error).message,
          });
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }

    // All retries exhausted for this provider — enter cooldown and try next
    if (!providerResponse) {
      providerCooldowns.set(provider, Date.now() + PROVIDER_COOLDOWN_MS);
      console.warn(`[llmRouter] Provider ${provider} exhausted — entering ${PROVIDER_COOLDOWN_MS}ms cooldown`);
    }
  }

  // ── §1.1 LAEL-P1-1 pairing-completeness finally guard ──────────────────────
  // Wraps the entire post-loop body so that if an exception escapes between
  // `llm.requested` emission and the normal `llm.completed` emit sites, the
  // finally block fires `llm.completed` as a fallback, ensuring every emitted
  // `llm.requested` is paired with exactly one `llm.completed`. The normal
  // paths set `laelCompletedEmitted = true` before emitting, so the finally
  // block no-ops on the normal paths.
  try {

  if (!providerResponse) {
    const e = lastError as { message?: string } | null | undefined;

    // Rev §6 / April 2026 timeout hardening — single source of truth for
    // error → ledger-status classification lives in llmRouterErrorMappingPure.
    // Every failure mode (parse_failure, client_disconnected, aborted_by_caller,
    // provider_unavailable, provider_not_configured, timeout, generic error)
    // produces a ledger row here — no skip paths.
    const classification   = classifyRouterError(lastError);
    callStatus             = classification.status;
    const abortReasonValue = classification.abortReason;
    const parseFailureExcerpt = classification.parseFailureExcerpt;

    callError = (e?.message ?? 'All providers failed') + (lastError instanceof Error && lastError.message.includes('timed out') ? ' (timeout)' : '');

    // Release reservation — no cost incurred (tolerates null for system/analyzer)
    await budgetService.releaseReservation(reservationId);

    const providerLatencyMs = Date.now() - providerStart;
    const routerOverheadMs  = Date.now() - routerStart - providerLatencyMs;

    console.error('[llmRouter] All providers failed', {
      idempotencyKey, organisationId: ctx.organisationId, runId: ctx.runId,
      provider: effectiveProvider, model: effectiveModel, status: callStatus, error: callError,
    });
    recordIncident({
      source: 'llm',
      summary: `LLM router failure (${callStatus}): ${callError.slice(0, 200)}`,
      errorCode: callStatus,
      organisationId: ctx.organisationId,
      subaccountId: ctx.subaccountId,
      correlationId: ctx.runId,
      fingerprintOverride: `llm:${effectiveProvider}:${callStatus}`,
      errorDetail: { provider: effectiveProvider, model: effectiveModel },
    });

    const hasFallbackFailures = fallbackAttempts.some(a => a.error);

    // Phase C breaker is NOT called on the failure path — failure rows record
    // costWithMarginCents=0 and do not contribute to per-run spend. If partial-
    // cost-on-failure is ever introduced, the breaker would need wiring here too.
    // Deferred-items brief §1 — the provisional `'started'` row written
    // at §7a above MUST be overwritten with the terminal failure status
    // here, otherwise a crashed/failed call leaves a `'started'` ghost
    // blocking all retries for this idempotencyKey until the sweep
    // reaps it 660s later. `onConflictDoUpdate` with the same
    // "never downgrade a success" guard as the success path keeps the
    // idempotency semantics intact: a retry that somehow lands here
    // after a success (shouldn't happen but defensive) will no-op.
    const failureInsertedRows = await db
      .insert(llmRequests)
      .values({
        idempotencyKey,
        organisationId:      ctx.organisationId,
        subaccountId:        ctx.subaccountId,
        userId:              ctx.userId,
        sourceType:          ctx.sourceType,
        runId:               ctx.runId,
        executionId:         ctx.executionId,
        ieeRunId:            ctx.ieeRunId,        // §11.7.1
        sourceId:            ctx.sourceId,        // rev §6
        featureTag:          ctx.featureTag ?? 'unknown',  // rev §6
        callSite:            ctx.callSite ?? 'app',
        agentName:           ctx.agentName,
        taskType:            ctx.taskType,
        executionPhase:      ctx.executionPhase,  // nullable for system/analyzer
        capabilityTier:      routingTier,
        wasDowngraded,
        routingReason,
        provider:            effectiveProvider,
        model:               effectiveModel,
        tokensIn:            0,
        tokensOut:           0,
        costRaw:             '0',
        costWithMargin:      '0',
        costWithMarginCents: 0,
        marginMultiplier:    String(margin.multiplier),
        fixedFeeCents:       margin.fixedFeeCents,
        requestPayloadHash,
        providerLatencyMs,
        routerOverheadMs,
        status:              callStatus,
        errorMessage:        callError,
        attemptNumber,
        parseFailureRawExcerpt: parseFailureExcerpt,  // rev §6
        abortReason:         abortReasonValue,       // rev §6
        requestedProvider:   effectiveProvider,
        requestedModel:      effectiveModel,
        fallbackChain:       hasFallbackFailures ? JSON.stringify(fallbackAttempts) : null,
        wasEscalated:        ctx.wasEscalated ?? false,
        escalationReason:    ctx.escalationReason,
        billingMonth,
        billingDay,
      })
      .onConflictDoUpdate({
        target: [llmRequests.idempotencyKey],
        set: {
          status:                 callStatus,
          errorMessage:           callError,
          providerLatencyMs,
          routerOverheadMs,
          attemptNumber,
          parseFailureRawExcerpt: parseFailureExcerpt,
          abortReason:            abortReasonValue,
          fallbackChain:          hasFallbackFailures ? JSON.stringify(fallbackAttempts) : null,
          capabilityTier:         routingTier,
          wasDowngraded,
          routingReason,
          // pr-review finding #4 (2026-04-21): mirror the success set's
          // margin-fields policy so a future move of pricingService.getMargin
          // inside the retry loop can't silently leave stale provisional
          // defaults on the terminal failure row.
          marginMultiplier:       String(margin.multiplier),
          fixedFeeCents:          margin.fixedFeeCents,
        },
        // Reviewer follow-up (2026-04-21): tighten the transition guard from
        // `!= 'success'` to `= 'started'`. The idempotency-check transaction
        // above always leaves the row in 'started' state before this path
        // runs — whether it's a fresh call (INSERT 'started') or a retry
        // after a prior error (onConflictDoUpdate 'started' with fresh
        // createdAt). A mismatch at this point means either (a) the sweep
        // fired and claimed the row as provisional_row_expired, or (b) a
        // second concurrent attempt already terminalised it. In either
        // case the guard preserves the earlier terminal signal; we log
        // the ghost so an operator can reconcile rather than silently
        // losing the audit trail.
        where: sql`${llmRequests.status} = 'started'`,
      })
      .returning({ id: llmRequests.id });

    if (failureInsertedRows.length === 0) {
      logger.warn('llm_router.failure_upsert_ghost', {
        idempotencyKey,
        callStatus,
        note: 'existing row was not in started state — terminal failure audit discarded (earlier sweep or race)',
      });
    }

    // Emit the terminal in-flight removal with ledger reconciliation. The
    // caller's UI uses `ledgerRowId` + `ledgerCommittedAt` to link the live
    // row to the ledger detail drawer (spec §5).
    //
    // Two branches:
    //   (a) `currentRuntimeKey` is set — the last attempt was a non-
    //       retryable break (PROVIDER_TIMEOUT, CLIENT_DISCONNECTED,
    //       PROVIDER_NOT_CONFIGURED, auth). The entry is still alive in
    //       the registry; remove it with the now-known ledger row id.
    //   (b) `currentRuntimeKey` is null but `lastRemovedAttempt` is set —
    //       every attempt was a retryable error, and each inner catch
    //       already removed its own entry with `ledgerRowId: null`. The
    //       ledger row has now been written, so we re-emit a ledger-
    //       linked removal for the last attempt's runtimeKey via
    //       `updateLedgerLink`. The client merges the populated
    //       ledgerRowId over the earlier null in `recentlyLanded`, so
    //       the [ledger] button appears on the "Recently landed" row.
    const ledgerRowId = failureInsertedRows[0]?.id ?? null;
    const ledgerCommittedAtISO = ledgerRowId ? new Date().toISOString() : null;
    if (currentRuntimeKey) {
      inflightRegistry.remove({
        runtimeKey:        currentRuntimeKey,
        terminalStatus:    callStatus as
          | 'error' | 'timeout' | 'aborted_by_caller' | 'client_disconnected'
          | 'parse_failure' | 'provider_unavailable' | 'provider_not_configured',
        completedAt:       new Date().toISOString(),
        ledgerRowId,
        ledgerCommittedAt: ledgerCommittedAtISO,
        sweepReason:       null,
        evictionContext:   null,
      });
      llmInflightPayloadStore.remove(currentRuntimeKey);
      currentRuntimeKey = null;
    } else if (lastRemovedAttempt && ledgerRowId && ledgerCommittedAtISO) {
      inflightRegistry.updateLedgerLink({
        runtimeKey:        lastRemovedAttempt.runtimeKey,
        idempotencyKey:    lastRemovedAttempt.idempotencyKey,
        attempt:           lastRemovedAttempt.attempt,
        terminalStatus:    lastRemovedAttempt.terminalStatus,
        completedAt:       new Date().toISOString(),
        durationMs:        Math.max(
          0,
          Date.now() - Date.parse(lastRemovedAttempt.startedAt),
        ),
        ledgerRowId,
        ledgerCommittedAt: ledgerCommittedAtISO,
      });
    }

    // ── §1.1 LAEL-P1-1 — payload row + llm.completed (failure path) ─────
    //
    // Emitted AFTER the ledger row is written and AFTER the registry
    // cleanup above, BEFORE rethrowing. On the failure path there is no
    // provider response, so tokensIn/Out and costWithMarginCents are 0.
    // `shouldEmitLaelLifecycle` returns false for pre-dispatch terminals
    // (budget_blocked / rate_limited / provider_not_configured) — those
    // paths throw earlier and never reach here. The only failure statuses
    // that arrive here are post-dispatch errors (timeout, parse_failure,
    // provider_unavailable, etc.) for which emission is appropriate.
    terminalStatus = callStatus;
    if (shouldEmitLaelLifecycle(ctx, callStatus) && ledgerRowId) {
      // No payload row on failure — no provider response to persist.
      laelCompletedEmitted = true;
      tryEmitAgentEvent({
        runId:          ctx.runId!,
        organisationId: ctx.organisationId,
        subaccountId:   ctx.subaccountId ?? null,
        sourceService:  'llmRouter',
        payload: {
          eventType:           'llm.completed',
          critical:            true,
          llmRequestId:        ledgerRowId,
          status:              callStatus,
          tokensIn:            0,
          tokensOut:           0,
          costWithMarginCents: 0,
          durationMs:          Date.now() - providerStart,
          payloadInsertStatus: 'failed',
          payloadRowId:        null,
        },
      });
    }

    throw lastError ?? new Error('All providers exhausted');
  }

  const providerLatencyMs = Date.now() - providerStart;

  // ── 9. Calculate actual cost ─────────────────────────────────────────────
  //
  // Rev §6 — sourceType threaded through so pricingService's resolveMargin
  // can collapse margin to 1.0× for sourceType ∈ {'system','analyzer'}.
  // Downstream effect: costWithMargin === costRaw for overhead rows, so the
  // System P&L page's net-profit math stays honest.
  const costResult = await pricingService.calculateCost(
    actualProvider,
    actualModel,
    providerResponse.tokensIn,
    providerResponse.tokensOut,
    ctx.organisationId,
    providerResponse.cachedPromptTokens ?? 0,
    ctx.sourceType,
  );

  // ── 10. Compute response payload hash ───────────────────────────────────
  const responsePayloadHash = createHash('sha256')
    .update(JSON.stringify(providerResponse.content))
    .digest('hex');

  const routerOverheadMs = Date.now() - routerStart - providerLatencyMs;

  const usedFallback = actualProvider !== effectiveProvider || actualModel !== effectiveModel;

  // ── 11. Structured log — paper trail before DB write ────────────────────
  console.info('[llmRouter] request_completed', {
    idempotencyKey,
    organisationId:    ctx.organisationId,
    subaccountId:      ctx.subaccountId,
    runId:             ctx.runId,
    provider:          actualProvider,
    model:             actualModel,
    executionPhase:    ctx.executionPhase,
    tier:              routingTier,
    routingReason,
    wasDowngraded,
    cachedPromptTokens: providerResponse.cachedPromptTokens ?? 0,
    ...(usedFallback ? { requestedProvider: effectiveProvider, requestedModel: effectiveModel } : {}),
    providerRequestId: providerResponse.providerRequestId,
    tokensIn:          providerResponse.tokensIn,
    tokensOut:         providerResponse.tokensOut,
    costRaw:           costResult.costRaw,
    costWithMargin:    costResult.costWithMargin,
    costWithMarginCents: costResult.costWithMarginCents,
    requestPayloadHash,
    responsePayloadHash,
    status:            callStatus,
    attemptNumber,
    providerLatencyMs,
    routerOverheadMs,
  });

  // ── 12. Write ledger — upsert so a successful retry overwrites a prior error row ──
  const hasFallbackFailures = fallbackAttempts.some(a => a.error);

  const successInsertedRows = await db
    .insert(llmRequests)
    .values({
      idempotencyKey,
      organisationId:      ctx.organisationId,
      subaccountId:        ctx.subaccountId,
      userId:              ctx.userId,
      sourceType:          ctx.sourceType,
      runId:               ctx.runId,
      executionId:         ctx.executionId,
      ieeRunId:            ctx.ieeRunId,        // §11.7.1
      sourceId:            ctx.sourceId,        // rev §6
      featureTag:          ctx.featureTag ?? 'unknown',  // rev §6
      callSite:            ctx.callSite ?? 'app',
      agentName:           ctx.agentName,
      taskType:            ctx.taskType,
      executionPhase:      ctx.executionPhase,  // nullable for system/analyzer
      capabilityTier:      routingTier,
      wasDowngraded,
      routingReason,
      cachedPromptTokens:  providerResponse.cachedPromptTokens ?? 0,
      cacheCreationTokens: providerResponse.cacheCreationTokens ?? 0,
      prefixHash:          params.prefixHash,
      provider:            actualProvider,
      model:               actualModel,
      providerRequestId:   providerResponse.providerRequestId,
      tokensIn:            providerResponse.tokensIn,
      tokensOut:           providerResponse.tokensOut,
      providerTokensIn:    providerResponse.tokensIn,
      providerTokensOut:   providerResponse.tokensOut,
      costRaw:             String(costResult.costRaw),
      costWithMargin:      String(costResult.costWithMargin),
      costWithMarginCents: costResult.costWithMarginCents,
      marginMultiplier:    String(costResult.marginMultiplier),
      fixedFeeCents:       costResult.fixedFeeCents,
      requestPayloadHash,
      responsePayloadHash,
      providerLatencyMs,
      routerOverheadMs,
      status:              callStatus,
      attemptNumber,
      requestedProvider:   effectiveProvider,
      requestedModel:      effectiveModel,
      fallbackChain:       hasFallbackFailures ? JSON.stringify(fallbackAttempts) : null,
      wasEscalated:        ctx.wasEscalated ?? false,
      escalationReason:    ctx.escalationReason,
      billingMonth,
      billingDay,
    })
    .onConflictDoUpdate({
      target: [llmRequests.idempotencyKey],
      // Only overwrite if the existing row is an error/provisional state —
      // never downgrade success. Deferred-items brief §1: when a provisional
      // `'started'` row exists, the SET clause must fully replace it with
      // the terminal success payload — including provider/model (which may
      // have changed via fallback), capability tier, margin, and cached-
      // prompt tokens. Missing fields leave provisional-row defaults in
      // place and skew downstream cost rollups.
      set: {
        provider:            actualProvider,
        model:               actualModel,
        providerRequestId:   providerResponse.providerRequestId,
        tokensIn:            providerResponse.tokensIn,
        tokensOut:           providerResponse.tokensOut,
        providerTokensIn:    providerResponse.tokensIn,
        providerTokensOut:   providerResponse.tokensOut,
        cachedPromptTokens:  providerResponse.cachedPromptTokens ?? 0,
        cacheCreationTokens: providerResponse.cacheCreationTokens ?? 0,
        prefixHash:          params.prefixHash,
        costRaw:             String(costResult.costRaw),
        costWithMargin:      String(costResult.costWithMargin),
        costWithMarginCents: costResult.costWithMarginCents,
        marginMultiplier:    String(costResult.marginMultiplier),
        fixedFeeCents:       costResult.fixedFeeCents,
        responsePayloadHash,
        providerLatencyMs,
        routerOverheadMs,
        status:              callStatus,
        errorMessage:        null,
        attemptNumber,
        capabilityTier:      routingTier,
        wasDowngraded,
        routingReason,
        fallbackChain:       hasFallbackFailures ? JSON.stringify(fallbackAttempts) : null,
      },
      // Reviewer follow-up (2026-04-21): tighten from `!= 'success'` to
      // `= 'started'`. The idempotency-check transaction always leaves
      // the row in 'started' before this path runs. A mismatch here means
      // another terminal transition has already happened (sweep fired and
      // claimed as `provisional_row_expired`, or a prior retry
      // terminalised). Tightening preserves the earlier terminal signal
      // — the sweep's "call went long enough that something was wrong"
      // signal is operationally more valuable than a late-arriving
      // success that pretends everything was fine. Ghost arrivals are
      // logged below so operators can reconcile.
      where: sql`${llmRequests.status} = 'started'`,
    })
    .returning({ id: llmRequests.id });

  const successLedgerRowId = successInsertedRows[0]?.id ?? null;

  if (successInsertedRows.length === 0) {
    // Mismatch path — either (a) an identical success already exists
    // (idempotency replay — the prior success row has status='success'
    // which our tightened guard correctly refuses to re-overwrite), or
    // (b) the sweep/sibling raced and terminalised with a non-success
    // status. The breaker skip path below already tolerates a null
    // successLedgerRowId by treating it as idempotency replay; this
    // log surfaces the case so operators can spot the "true success
    // was discarded by the sweep" variant from the ledger audit.
    logger.warn('llm_router.success_upsert_ghost', {
      idempotencyKey,
      note: 'terminal success could not transition from started (already success, or sweep/sibling claimed it as terminal-error)',
    });
  }

  // ── 12a. Hermes Tier 1 Phase C — runaway-loop cost breaker ───────────────
  //
  // Call the direct-ledger breaker AFTER the ledger row is durably written
  // and BEFORE the in-flight registry is cleaned up. Ordering rationale
  // pinned in tasks/hermes-audit-tier-1-spec.md §7.3 / §7.4 / §7.4.1:
  //
  //   1. Ledger write first → cost attribution is intact regardless of
  //      whether the breaker trips. The money was already spent with the
  //      provider; recording it is non-negotiable.
  //   2. Direct-ledger read (not cost_aggregates) → cost_aggregates is
  //      updated asynchronously by `routerJobService.enqueueAggregateUpdate`
  //      below, so a rollup-based read would miss this call's cost and
  //      inflate worst-case overshoot by the aggregation-interval's worth
  //      of concurrent traffic.
  //   3. `insertedLedgerRowId` threaded through as REQUIRED parameter →
  //      the helper performs a row-visibility check and fails closed on
  //      null or not-visible. Structural guarantee against a future
  //      refactor that swaps the call above the ledger insert.
  //   4. Skip entirely when runId cannot be resolved (sourceType ∈
  //      {'system','analyzer'} have no run context; IEE runs map via
  //      `resolveRunIdFromIee` below). See §7.5 / §7.6.
  //   5. Fail-open on infra errors (non-'cost_limit_exceeded' throws) →
  //      the breaker is secondary protection; a DB hiccup in the breaker's
  //      own read must not take down the LLM path, which is the primary
  //      business function. `costBreaker.infra_failure` is the signal ops
  //      uses to notice.
  //
  // If the breaker throws `cost_limit_exceeded`, the in-flight registry
  // entry is orphaned until the sweep runs — acceptable per §7.3.2 because
  // the sweep is the existing safety net for orphaned entries and the
  // three-branch cleanup pattern above predates Phase C.
  const breakerRunId = ctx.runId ?? (await resolveRunIdFromIee(ctx.ieeRunId));
  if (breakerRunId) {
    if (!successLedgerRowId) {
      // Upsert hit the `where status = 'started'` guard — existing row is
      // not in 'started' state. Either an idempotency replay against a
      // prior success, or the sweep / sibling claimed the row with a
      // terminal-error status (see ghost log above). Skip the breaker
      // either way — the first insert owns the cost attribution.
      console.debug('[llmRouter] costBreaker.skip_terminal_preempted', { correlationId: idempotencyKey });
    } else {
      try {
        const { assertWithinRunBudgetFromLedger } = await import('../lib/runCostBreaker.js');
        await assertWithinRunBudgetFromLedger({
          runId:               breakerRunId,
          insertedLedgerRowId: successLedgerRowId,
          subaccountAgentId:   ctx.subaccountAgentId ?? null,
          organisationId:      ctx.organisationId,
          // The router ctx does not carry a distinct correlationId; the LLM
          // idempotencyKey is the stable per-call identifier we thread
          // through downstream logs and the breaker's trip payload.
          correlationId:       idempotencyKey,
        });
        console.debug('[llmRouter] costBreaker.checked', {
          runId:         breakerRunId,
          correlationId: idempotencyKey,
        });
      } catch (err) {
        const isExpectedBreakerTrip =
          err instanceof FailureError &&
          err.failure.failureReason === 'internal_error' &&
          err.failure.failureDetail === 'cost_limit_exceeded';
        if (isExpectedBreakerTrip) {
          // Commit the reservation and enqueue the aggregate update before
          // rethrowing — without these calls the over-budget call's cost stays
          // locked in an active reservation and cost_aggregates never receives
          // the row, so RunCostPanel and aggregate-backed readers permanently
          // undercount the triggering call's spend. Both calls are best-effort:
          // failures here must not mask the cost_limit_exceeded error.
          budgetService.commitReservation(reservationId, costResult.costWithMarginCents).catch((e) => {
            console.error('[llmRouter] costBreaker.commit_reservation_failed', {
              runId: breakerRunId, correlationId: idempotencyKey,
              error: e instanceof Error ? e.message : String(e),
            });
          });
          enqueueAggregateUpdate(idempotencyKey).catch((e) => {
            console.error('[llmRouter] costBreaker.enqueue_aggregate_failed', {
              runId: breakerRunId, correlationId: idempotencyKey,
              error: e instanceof Error ? e.message : String(e),
            });
          });
          throw err;
        }
        console.error('[llmRouter] costBreaker.infra_failure', {
          runId:         breakerRunId,
          correlationId: idempotencyKey,
          error:         err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ── 12b. Remove the in-flight registry entry for the successful attempt ──
  // Emitted AFTER the ledger upsert so `ledgerRowId` + `ledgerCommittedAt`
  // are populated on the removal payload (spec §5). When the upsert hits
  // the `where: status != 'success'` guard on an already-success row,
  // `.returning()` comes back empty — we fall back to `null` and the UI
  // retries via idempotencyKey.
  if (currentRuntimeKey) {
    inflightRegistry.remove({
      runtimeKey:        currentRuntimeKey,
      terminalStatus:    'success',
      completedAt:       new Date().toISOString(),
      ledgerRowId:       successLedgerRowId,
      ledgerCommittedAt: successLedgerRowId ? new Date().toISOString() : null,
      sweepReason:       null,
      evictionContext:   null,
    });
    llmInflightPayloadStore.remove(currentRuntimeKey);
    currentRuntimeKey = null;
  }

  // ── 12c. §1.1 LAEL-P1-1 — payload row + llm.completed (success path) ────
  //
  // Ordering: AFTER the ledger upsert (§12), AFTER the registry removal (§12b),
  // BEFORE Langfuse / reservation commit. The payload insert is best-effort
  // inside its own try/catch — a failure does NOT roll back the ledger row.
  // `shouldEmitLaelLifecycle` gates on sourceType='agent_run' + runId present
  // + terminalStatus not in the pre-dispatch blocked set. On the success path
  // terminalStatus is always 'success', so the gate is effectively
  // (sourceType === 'agent_run' && runId present).
  //
  // NOTE: the success terminal-write above does NOT run in a shared db.transaction
  // with the payload insert because (a) the payload insert is best-effort and
  // (b) the terminal row is already committed — wrapping them together would
  // require the ledger write to be inside a new transaction, which changes
  // ordering semantics for the cost breaker. Keeping them separate and
  // best-effort is the correct consistency model (spec §4.5).
  terminalStatus = 'success';
  if (shouldEmitLaelLifecycle(ctx, 'success') && successLedgerRowId) {
    let payloadRowId: string | null = null;
    let payloadInsertStatus: 'ok' | 'failed' = 'failed';
    try {
      const systemPromptStr =
        typeof params.system === 'string'
          ? params.system
          : params.system
            ? `${params.system.stablePrefix}\n${params.system.dynamicSuffix}`
            : '';
      const payloadRow = buildPayloadRow({
        systemPrompt:    systemPromptStr,
        messages:        params.messages,
        toolDefinitions: params.tools ?? [],
        response:        providerResponse as unknown as Record<string, unknown>,
        maxBytes:        64 * 1024,
      });
      const [inserted] = await db.insert(agentRunLlmPayloads).values({
        llmRequestId:   successLedgerRowId,
        runId:          ctx.runId!,
        organisationId: ctx.organisationId,
        subaccountId:   ctx.subaccountId ?? null,
        ...payloadRow,
      }).returning({ id: agentRunLlmPayloads.llmRequestId });
      payloadRowId = inserted?.id ?? null;
      payloadInsertStatus = payloadRowId ? 'ok' : 'failed';
    } catch (err) {
      // Payload is best-effort; ledger is canonical. Insert failure does NOT roll back the ledger row.
      logger.warn('lael_payload_insert_failed', {
        runId: ctx.runId, ledgerRowId: successLedgerRowId, error: err,
      });
      // Defensive: delete any partially-inserted row so the post-commit invariant holds
      // (payloadInsertStatus === 'failed' iff no agent_run_llm_payloads row exists post-commit).
      try {
        await db.delete(agentRunLlmPayloads).where(
          eq(agentRunLlmPayloads.llmRequestId, successLedgerRowId)
        );
      } catch {
        // DELETE failure is swallowed — the primary contract is already broken at this point.
        // payloadInsertStatus: 'failed' on the event is the observable signal.
      }
      payloadInsertStatus = 'failed';
    }

    laelCompletedEmitted = true;
    tryEmitAgentEvent({
      runId:          ctx.runId!,
      organisationId: ctx.organisationId,
      subaccountId:   ctx.subaccountId ?? null,
      sourceService:  'llmRouter',
      payload: {
        eventType:            'llm.completed',
        critical:             true,
        llmRequestId:         successLedgerRowId,
        status:               'success',
        tokensIn:             providerResponse.tokensIn,
        tokensOut:            providerResponse.tokensOut,
        costWithMarginCents:  costResult.costWithMarginCents,
        durationMs:           providerLatencyMs,
        payloadInsertStatus,
        payloadRowId,
      },
    });

    if (payloadInsertStatus === 'failed') {
      logger.warn('lael_payload_insert_status', {
        runId: ctx.runId, ledgerRowId: successLedgerRowId, payloadInsertStatus,
      });
    }
  }

  // ── 13. Emit Langfuse generation span (dual-write — does not replace ledger) ──
  createGeneration('llm.router.call', {
    model: actualModel,
    input: params.messages,
    output: providerResponse.content,
    modelParameters: params.maxTokens ? { maxTokens: params.maxTokens } : undefined,
    usage: {
      input: providerResponse.tokensIn,
      output: providerResponse.tokensOut,
    },
    metadata: {
      provider: actualProvider,
      agentName: ctx.agentName,
      taskType: ctx.taskType,
      executionPhase: ctx.executionPhase,
      routingTier,
      wasDowngraded,
      routingReason,
      wasEscalated: ctx.wasEscalated ?? false,
      escalationReason: ctx.escalationReason ?? null,
      attemptNumber,
      criticalPath: true,
    },
  });

  // ── 14. Commit reservation with actual cost (releases delta) ─────────────
  // commitReservation tolerates null (system/analyzer paths never reserve).
  await budgetService.commitReservation(reservationId, costResult.costWithMarginCents);

  // ── 15. Enqueue aggregate update (async — do not await) ──────────────────
  enqueueAggregateUpdate(idempotencyKey).catch((err) => {
    console.error('[llmRouter] Failed to enqueue aggregate update', err);
  });

  // ── 16. Attach routing metadata for caller visibility ───────────────────
  providerResponse.routing = {
    tier: routingTier,
    wasDowngraded,
    reason: routingReason,
  };

  return providerResponse;

  } finally {
    // Pairing-completeness safety net (§1.1 LAEL-P1-1). Fires only when
    // `llm.requested` was emitted but `llm.completed` was NOT emitted by
    // either the success or failure path — i.e., an unexpected exception
    // escaped between the two emission sites. Uses fallback values:
    // payloadInsertStatus='failed', payloadRowId=null, tokensIn/Out=0,
    // costWithMarginCents=0. provisionalLedgerRowId is the row that was
    // created before the provider call, so it is always available here.
    if (
      laelRequestEmitted &&
      !laelCompletedEmitted &&
      ctx.runId &&
      provisionalLedgerRowId &&
      shouldEmitLaelLifecycle(ctx, terminalStatus ?? 'failed')
    ) {
      tryEmitAgentEvent({
        runId:          ctx.runId,
        organisationId: ctx.organisationId,
        subaccountId:   ctx.subaccountId ?? null,
        sourceService:  'llmRouter',
        payload: {
          eventType:           'llm.completed',
          critical:            true,
          llmRequestId:        provisionalLedgerRowId,
          status:              terminalStatus ?? 'failed',
          tokensIn:            0,
          tokensOut:           0,
          costWithMarginCents: 0,
          durationMs:          Date.now() - providerStart,
          payloadInsertStatus: 'failed',
          payloadRowId:        null,
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Enqueue aggregate update via pg-boss (or in-memory fallback)
// ---------------------------------------------------------------------------

async function enqueueAggregateUpdate(idempotencyKey: string): Promise<void> {
  try {
    const { routerJobService } = await import('./routerJobService.js');
    await routerJobService.enqueueAggregateUpdate(idempotencyKey);
  } catch {
    // Fallback: run synchronously if queue service unavailable
    const [request] = await db
      .select()
      .from(llmRequests)
      .where(eq(llmRequests.idempotencyKey, idempotencyKey))
      .limit(1);

    if (request) {
      const { costAggregateService } = await import('./costAggregateService.js');
      await costAggregateService.upsertAggregates(request);
    }
  }
}

// ---------------------------------------------------------------------------
// Re-export types for callers
// ---------------------------------------------------------------------------
export type { TaskType, SourceType, ExecutionPhase, RoutingMode };
export { TASK_TYPES, SOURCE_TYPES, EXECUTION_PHASES, ROUTING_MODES };

// ---------------------------------------------------------------------------
// Token counting — re-exported from anthropicAdapter so callers import from
// one place (llmRouter) instead of reaching into the provider layer directly.
// ---------------------------------------------------------------------------
export { countTokens, SUPPORTED_MODEL_FAMILIES } from './providers/anthropicAdapter.js';
export type { SupportedModelFamily } from './providers/anthropicAdapter.js';
