import { createHash } from 'crypto';
import { db } from '../db/index.js';
import { llmRequests, TASK_TYPES, SOURCE_TYPES, EXECUTION_PHASES, ROUTING_MODES, CALL_SITES } from '../db/schema/index.js';
import { createGeneration, createEvent } from '../lib/tracing.js';
import type { TaskType, SourceType, ExecutionPhase, RoutingMode, CallSite } from '../db/schema/index.js';
import { RouterContractError } from '../../shared/iee/index.js';
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
}

// ---------------------------------------------------------------------------
// Idempotency key
// Includes provider + model: different provider/model = distinct financial event
// ---------------------------------------------------------------------------

function generateIdempotencyKey(
  ctx: LLMCallContext,
  messages: ProviderMessage[],
  provider: string,
  model: string,
): string {
  const messageHash = createHash('sha256')
    .update(JSON.stringify(messages))
    .digest('hex')
    .slice(0, 32);

  // Rev §6 — extend the attribution position to include ieeRunId and the
  // polymorphic sourceId so analyzer/system callers dedupe meaningfully
  // within the same job. Without sourceId in the key, every analyzer call
  // for the same org would collide on 'system'. Similarly, the agent slot
  // falls back to featureTag so non-agent callers dedupe by feature rather
  // than colliding on 'no-agent'. See spec §6.5.
  return [
    ctx.organisationId,
    ctx.runId ?? ctx.executionId ?? ctx.ieeRunId ?? ctx.sourceId ?? 'system',
    ctx.agentName ?? ctx.featureTag ?? 'no-agent',
    ctx.taskType,
    provider,
    model,
    messageHash,
  ].join(':');
}

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
// Main router — drop-in replacement for callAnthropic()
// ---------------------------------------------------------------------------

export async function routeCall(params: RouterCallParams): Promise<ProviderResponse> {
  const routerStart = Date.now();

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

  // ── 4+7. Atomic idempotency check + budget reservation ─────────────────
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

    return { cached: false as const };
  });

  if (idempotencyResult.cached) {
    createEvent('llm.router.cache_hit', {
      idempotencyKey,
      model: effectiveModel,
      provider: effectiveProvider,
    });
    return idempotencyResult.response;
  }

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

  // Write the audit record for blocked calls (budget_blocked / rate_limited)
  if (budgetBlockedStatus) {
    await db
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
      .onConflictDoNothing();

    throw {
      statusCode: 402,
      code: budgetBlockedStatus === 'budget_blocked' ? 'BUDGET_EXCEEDED' : 'RATE_LIMITED',
      message: budgetErrorMessage,
    };
  }

  // ── 8. Call the provider with retry-fallback loop ───────────────────────
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

  // Build fallback chain: primary provider first, then others in order
  const fallbackChain = [
    effectiveProvider,
    ...PROVIDER_FALLBACK_CHAIN.filter(p => p !== effectiveProvider),
  ];

  let lastError: unknown = null;

  providerLoop:
  for (const provider of fallbackChain) {
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
      inflightRegistry.add({
        idempotencyKey,
        attempt,
        startedAt:      attemptStartedAt,
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

      try {
        providerResponse = await callWithTimeout(
          `${provider}/${mappedModel}`,
          PROVIDER_CALL_TIMEOUT_MS,
          params.abortSignal,
          (signal) => providerAdapter.call({
            model:       mappedModel,
            messages:    params.messages,
            system:      params.system,
            tools:       params.tools,
            maxTokens:   params.maxTokens,
            temperature: params.temperature,
            signal,
          }),
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

    const hasFallbackFailures = fallbackAttempts.some(a => a.error);

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
      .onConflictDoNothing()
      .returning({ id: llmRequests.id });

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
      // Only overwrite if the existing row is an error state — never downgrade success.
      set: {
        providerRequestId:   providerResponse.providerRequestId,
        tokensIn:            providerResponse.tokensIn,
        tokensOut:           providerResponse.tokensOut,
        providerTokensIn:    providerResponse.tokensIn,
        providerTokensOut:   providerResponse.tokensOut,
        costRaw:             String(costResult.costRaw),
        costWithMargin:      String(costResult.costWithMargin),
        costWithMarginCents: costResult.costWithMarginCents,
        responsePayloadHash,
        providerLatencyMs,
        routerOverheadMs,
        status:              callStatus,
        errorMessage:        null,
        attemptNumber,
      },
      // Drizzle where clause: only update if current row is not already a success
      where: sql`${llmRequests.status} != 'success'`,
    })
    .returning({ id: llmRequests.id });

  // ── 12a. Remove the in-flight registry entry for the successful attempt ──
  // Emitted AFTER the ledger upsert so `ledgerRowId` + `ledgerCommittedAt`
  // are populated on the removal payload (spec §5). When the upsert hits
  // the `where: status != 'success'` guard on an already-success row,
  // `.returning()` comes back empty — we fall back to `null` and the UI
  // retries via idempotencyKey.
  if (currentRuntimeKey) {
    const ledgerRowId = successInsertedRows[0]?.id ?? null;
    inflightRegistry.remove({
      runtimeKey:        currentRuntimeKey,
      terminalStatus:    'success',
      completedAt:       new Date().toISOString(),
      ledgerRowId,
      ledgerCommittedAt: ledgerRowId ? new Date().toISOString() : null,
      sweepReason:       null,
      evictionContext:   null,
    });
    currentRuntimeKey = null;
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
