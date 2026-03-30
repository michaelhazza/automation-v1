import { createHash } from 'crypto';
import { db } from '../db/index.js';
import { llmRequests, TASK_TYPES, SOURCE_TYPES } from '../db/schema/index.js';
import type { TaskType, SourceType } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getProviderAdapter } from './providers/registry.js';
import { pricingService } from './pricingService.js';
import { budgetService, BudgetExceededError, RateLimitError } from './budgetService.js';
import type { ProviderMessage, ProviderTool, ProviderResponse } from './providers/types.js';

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

  // ── 8. Call the provider ─────────────────────────────────────────────────
  const providerStart = Date.now();
  let providerResponse: ProviderResponse | null = null;
  let callStatus: string = 'success';
  let callError: string | null = null;
  let attemptNumber = 1;

  try {
    providerResponse = await adapter.call({
      model:       ctx.model,
      messages:    params.messages,
      system:      params.system,
      tools:       params.tools,
      maxTokens:   params.maxTokens,
      temperature: params.temperature,
    });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; statusCode?: number };

    if (e.code === 'PROVIDER_UNAVAILABLE') {
      callStatus = 'provider_unavailable';
    } else if (e.code === 'PROVIDER_NOT_CONFIGURED') {
      callStatus = 'provider_not_configured';
    } else {
      callStatus = 'error';
    }
    callError = e.message ?? 'Unknown error';

    // Release reservation — no cost incurred
    if (reservationId) await budgetService.releaseReservation(reservationId);

    const providerLatencyMs = Date.now() - providerStart;
    const routerOverheadMs  = Date.now() - routerStart - providerLatencyMs;

    // Structured log before DB write (paper trail)
    console.error('[llmRouter] Provider call failed', {
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

    throw err;
  }

  const providerLatencyMs = Date.now() - providerStart;

  // ── 9. Calculate actual cost ─────────────────────────────────────────────
  const costResult = await pricingService.calculateCost(
    ctx.provider,
    ctx.model,
    providerResponse.tokensIn,
    providerResponse.tokensOut,
    ctx.organisationId,
  );

  // ── 10. Compute response payload hash ───────────────────────────────────
  const responsePayloadHash = createHash('sha256')
    .update(JSON.stringify(providerResponse.content))
    .digest('hex');

  const routerOverheadMs = Date.now() - routerStart - providerLatencyMs;

  // ── 11. Structured log — paper trail before DB write ────────────────────
  console.info('[llmRouter] request_completed', {
    idempotencyKey,
    organisationId:    ctx.organisationId,
    subaccountId:      ctx.subaccountId,
    runId:             ctx.runId,
    provider:          ctx.provider,
    model:             ctx.model,
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

  // ── 12. Write ledger (ON CONFLICT DO NOTHING — idempotent) ──────────────
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
    .onConflictDoNothing();

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
