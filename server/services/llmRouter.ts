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
import {
  PROVIDER_CALL_TIMEOUT_MS,
  PROVIDER_MAX_RETRIES,
  PROVIDER_BACKOFF_MS,
  PROVIDER_FALLBACK_CHAIN,
  PROVIDER_COOLDOWN_MS,
} from '../config/limits.js';

// ---------------------------------------------------------------------------
// LLM Router — the financial chokepoint for every LLM call in the platform.
//
// Every callAnthropic() becomes routeCall() with a context object.
// The router owns: attribution, cost, budget enforcement, idempotency, audit.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  executionPhase:     z.enum(EXECUTION_PHASES),
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
});

export type LLMCallContext = z.infer<typeof LLMCallContextSchema>;

export interface RouterCallParams {
  messages:     ProviderMessage[];
  system?:      string;
  tools?:       ProviderTool[];
  maxTokens?:   number;
  temperature?: number;
  estimatedContextTokens?: number;
  context:      LLMCallContext;
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

  return [
    ctx.organisationId,
    ctx.runId ?? ctx.executionId ?? 'system',
    ctx.agentName ?? 'no-agent',
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
// Provider timeout guard
// ---------------------------------------------------------------------------

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Provider call timed out after ${ms}ms (${label})`)), ms)
    ),
  ]);
}

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

  // ── 1b. Resolve provider + model from execution phase ─────────────────
  let effectiveProvider: string;
  let effectiveModel: string;
  let routingTier: 'frontier' | 'economy' = 'frontier';
  let wasDowngraded = false;
  let routingReason: string = 'ceiling';

  if (env.ROUTER_FORCE_FRONTIER) {
    // Kill switch: skip all routing, use ceiling model.
    effectiveProvider = ctx.provider ?? 'anthropic';
    effectiveModel = ctx.model ?? 'claude-sonnet-4-6';
    routingReason = 'forced';
  } else {
    const resolved = resolveLLM({
      phase:    ctx.executionPhase,
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
        organisationId:   ctx.organisationId,
        subaccountId:     ctx.subaccountId,
        runId:            ctx.runId,
        subaccountAgentId: ctx.subaccountAgentId,
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
        callSite:            ctx.callSite ?? 'app',
        agentName:           ctx.agentName,
        taskType:            ctx.taskType,
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
      try {
        providerResponse = await withTimeout(
          providerAdapter.call({
            model:       mappedModel,
            messages:    params.messages,
            system:      params.system,
            tools:       params.tools,
            maxTokens:   params.maxTokens,
            temperature: params.temperature,
          }),
          PROVIDER_CALL_TIMEOUT_MS,
          `${provider}/${mappedModel}`
        );

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

        // Non-retryable errors propagate immediately
        if (isNonRetryableError(err)) {
          if (reservationId) await budgetService.releaseReservation(reservationId);
          throw err;
        }

        createEvent('llm.router.fallback', {
          failedProvider: provider,
          failedModel: mappedModel,
          error: String(err).slice(0, 200),
          attemptIndex: attempt,
        });

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
    const e = lastError as { code?: string; message?: string };

    if (e?.code === 'PROVIDER_UNAVAILABLE') {
      callStatus = 'provider_unavailable';
    } else if (e?.code === 'PROVIDER_NOT_CONFIGURED') {
      callStatus = 'provider_not_configured';
    } else {
      callStatus = 'error';
    }
    callError = (e?.message ?? 'All providers failed') + (lastError instanceof Error && lastError.message.includes('timed out') ? ' (timeout)' : '');

    // Release reservation — no cost incurred
    if (reservationId) await budgetService.releaseReservation(reservationId);

    const providerLatencyMs = Date.now() - providerStart;
    const routerOverheadMs  = Date.now() - routerStart - providerLatencyMs;

    console.error('[llmRouter] All providers failed', {
      idempotencyKey, organisationId: ctx.organisationId, runId: ctx.runId,
      provider: effectiveProvider, model: effectiveModel, status: callStatus, error: callError,
    });

    const hasFallbackFailures = fallbackAttempts.some(a => a.error);

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
        callSite:            ctx.callSite ?? 'app',
        agentName:           ctx.agentName,
        taskType:            ctx.taskType,
        executionPhase:      ctx.executionPhase,
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
        requestedProvider:   effectiveProvider,
        requestedModel:      effectiveModel,
        fallbackChain:       hasFallbackFailures ? JSON.stringify(fallbackAttempts) : null,
        wasEscalated:        ctx.wasEscalated ?? false,
        escalationReason:    ctx.escalationReason,
        billingMonth,
        billingDay,
      })
      .onConflictDoNothing();

    throw lastError ?? new Error('All providers exhausted');
  }

  const providerLatencyMs = Date.now() - providerStart;

  // ── 9. Calculate actual cost ─────────────────────────────────────────────
  const costResult = await pricingService.calculateCost(
    actualProvider,
    actualModel,
    providerResponse.tokensIn,
    providerResponse.tokensOut,
    ctx.organisationId,
    providerResponse.cachedPromptTokens ?? 0,
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
      callSite:            ctx.callSite ?? 'app',
      agentName:           ctx.agentName,
      taskType:            ctx.taskType,
      executionPhase:      ctx.executionPhase,
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
    });

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
  if (reservationId) {
    await budgetService.commitReservation(reservationId, costResult.costWithMarginCents);
  }

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
