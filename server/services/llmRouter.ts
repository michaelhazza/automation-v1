import { createHash } from 'crypto';
import { db } from '../db/index.js';
import { llmRequests, TASK_TYPES, SOURCE_TYPES } from '../db/schema/index.js';
import type { TaskType, SourceType } from '../db/schema/index.js';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getProviderAdapter } from './providers/registry.js';
import { pricingService } from './pricingService.js';
import { budgetService, BudgetExceededError, RateLimitError } from './budgetService.js';
import type { ProviderMessage, ProviderTool, ProviderResponse } from './providers/types.js';
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
  provider:           z.string().min(1),
  model:              z.string().min(1),
});

export type LLMCallContext = z.infer<typeof LLMCallContextSchema>;

export interface RouterCallParams {
  messages:     ProviderMessage[];
  system?:      string;
  tools?:       ProviderTool[];
  maxTokens?:   number;
  temperature?: number;
  context:      LLMCallContext;
}

// ---------------------------------------------------------------------------
// Idempotency key
// Includes provider + model: different provider/model = distinct financial event
// ---------------------------------------------------------------------------

function generateIdempotencyKey(ctx: LLMCallContext, messages: ProviderMessage[]): string {
  const messageHash = createHash('sha256')
    .update(JSON.stringify(messages))
    .digest('hex')
    .slice(0, 32);

  return [
    ctx.organisationId,
    ctx.runId ?? ctx.executionId ?? 'system',
    ctx.agentName ?? 'no-agent',
    ctx.taskType,
    ctx.provider,
    ctx.model,
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
    'claude-haiku-4-5': 'gpt-4o-mini',
  },
  gemini: {
    'claude-sonnet-4-6': 'gemini-2.0-flash',
    'claude-haiku-4-5': 'gemini-2.0-flash-lite',
  },
};

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

  // ── 2. Check provider is registered ────────────────────────────────────
  const adapter = getProviderAdapter(ctx.provider);

  // ── 3. Generate idempotency key ─────────────────────────────────────────
  const idempotencyKey = generateIdempotencyKey(ctx, params.messages);

  // ── 4. Pre-call: check for existing record (exactly-once execution) ─────
  const existing = await db
    .select()
    .from(llmRequests)
    .where(eq(llmRequests.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existing.length > 0 && existing[0].status === 'success') {
    // Return a reconstructed response — Anthropic is NOT called again
    return {
      content:           '',   // callers should handle cached responses gracefully
      stopReason:        'cached',
      tokensIn:          existing[0].tokensIn,
      tokensOut:         existing[0].tokensOut,
      providerRequestId: existing[0].providerRequestId ?? '',
    };
  }

  const { billingMonth, billingDay } = getBillingPeriods();

  // ── 5. Resolve pricing and estimate cost ────────────────────────────────
  const [pricing, margin] = await Promise.all([
    pricingService.getPricing(ctx.provider, ctx.model),
    pricingService.getMargin(ctx.organisationId),
  ]);

  // Default max tokens for estimation if not provided
  const maxTokensForEstimate = params.maxTokens ?? 4096;
  const estimatedCostCents = await pricingService.estimateCost(
    ctx.provider, ctx.model, maxTokensForEstimate, ctx.organisationId,
  );

  // ── 6. Compute request payload hash ────────────────────────────────────
  const requestPayloadHash = createHash('sha256')
    .update(JSON.stringify(params.messages))
    .digest('hex');

  // ── 7. Budget check + reservation ──────────────────────────────────────
  let reservationId: string | null = null;
  let budgetBlockedStatus: string | null = null;
  let budgetErrorMessage: string | null = null;

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
        agentName:           ctx.agentName,
        taskType:            ctx.taskType,
        provider:            ctx.provider,
        model:               ctx.model,
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
  let actualProvider = ctx.provider;
  let actualModel = ctx.model;

  // Build fallback chain: primary provider first, then others in order
  const fallbackChain = [
    ctx.provider,
    ...PROVIDER_FALLBACK_CHAIN.filter(p => p !== ctx.provider),
  ];

  let lastError: unknown = null;

  providerLoop:
  for (const provider of fallbackChain) {
    if (isProviderCoolingDown(provider)) {
      console.warn(`[llmRouter] Skipping provider ${provider} — in cooldown`);
      continue;
    }

    // Map the original model to the equivalent model for this provider
    const mappedModel = provider === ctx.provider
      ? ctx.model
      : (FALLBACK_MODEL_MAP[provider]?.[ctx.model] ?? ctx.model);

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
        break providerLoop;
      } catch (err: unknown) {
        lastError = err;

        // Non-retryable errors propagate immediately
        if (isNonRetryableError(err)) {
          if (reservationId) await budgetService.releaseReservation(reservationId);
          throw err;
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
      provider: ctx.provider, model: ctx.model, status: callStatus, error: callError,
    });

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
        agentName:           ctx.agentName,
        taskType:            ctx.taskType,
        provider:            ctx.provider,
        model:               ctx.model,
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
  );

  // ── 10. Compute response payload hash ───────────────────────────────────
  const responsePayloadHash = createHash('sha256')
    .update(JSON.stringify(providerResponse.content))
    .digest('hex');

  const routerOverheadMs = Date.now() - routerStart - providerLatencyMs;

  const usedFallback = actualProvider !== ctx.provider || actualModel !== ctx.model;

  // ── 11. Structured log — paper trail before DB write ────────────────────
  console.info('[llmRouter] request_completed', {
    idempotencyKey,
    organisationId:    ctx.organisationId,
    subaccountId:      ctx.subaccountId,
    runId:             ctx.runId,
    provider:          actualProvider,
    model:             actualModel,
    ...(usedFallback ? { requestedProvider: ctx.provider, requestedModel: ctx.model } : {}),
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
      agentName:           ctx.agentName,
      taskType:            ctx.taskType,
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

  // ── 13. Commit reservation with actual cost (releases delta) ─────────────
  if (reservationId) {
    await budgetService.commitReservation(reservationId, costResult.costWithMarginCents);
  }

  // ── 14. Enqueue aggregate update (async — do not await) ──────────────────
  enqueueAggregateUpdate(idempotencyKey).catch((err) => {
    console.error('[llmRouter] Failed to enqueue aggregate update', err);
  });

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
export type { TaskType, SourceType };
export { TASK_TYPES, SOURCE_TYPES };
