// CRM Query Planner — orchestration layer (spec §3 / §19)
// P2: Stage 1 + Stage 2 (cache read) + Stage 3 (LLM fallback) + live executor.
// P3: hybrid executor wired (P2 sends hybrid to unsupported_query per §19 P2 rejection rule).

import { normaliseIntent } from './normaliseIntentPure.js';
import { matchRegistryEntry } from './registryMatcherPure.js';
import { executeCanonical, MissingPermissionError } from './executors/canonicalExecutor.js';
import { executeLive, LiveExecutorError } from './executors/liveExecutor.js';
import { executeHybrid } from './executors/hybridExecutor.js';
import { HybridCapError, HybridLiveCallError } from './executors/hybridExecutorPure.js';
// canonicalQueryRegistry is lazily loaded so tests can inject a stub via deps.registry
// without triggering the drizzle-orm import chain (canonicalQueryRegistry → canonicalDataService → drizzle).
import { normaliseToArtefacts } from './resultNormaliserPure.js';
import * as planCache from './planCache.js';
import { emit } from './plannerEvents.js';
import { runLlmStage3 } from './llmPlanner.js';
import { validatePlanPure, ValidationError } from './validatePlanPure.js';
import { computePlannerCostPreview, computeActualCostCents } from './plannerCostPure.js';
import { systemSettingsService, SETTING_KEYS } from '../systemSettingsService.js';
import { BudgetExceededError } from '../budgetService.js';
import { FailureError } from '../../../shared/iee/failure.js';
import { withPrincipalContext } from '../../db/withPrincipalContext.js';
import { getOrgTxContext } from '../../instrumentation.js';
import { logger } from '../../lib/logger.js';
import type { ExecutorContext, PlannerTrace, QueryPlan, PlannerPlanMutation } from '../../../shared/types/crmQueryPlanner.js';
import { NORMALISER_VERSION } from '../../../shared/types/crmQueryPlanner.js';
import type { BriefChatArtefact, BriefCostPreview, BriefResultSuggestion } from '../../../shared/types/briefResultContract.js';
import type { PrincipalContext } from '../principal/types.js';
import { FALLBACK_SUGGESTIONS } from './resultNormaliserPure.js';

// ── NotImplementedError ───────────────────────────────────────────────────────

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunQueryInput {
  rawIntent: string;
  subaccountId: string;
  briefId?: string;
}

export interface RunQueryOutput {
  artefacts: BriefChatArtefact[];
  costPreview: BriefCostPreview;
  stageResolved: 1 | 2 | 3;
  intentHash: string;
}

// Optional dependency injection for testing — production callers omit this.
export interface RunQueryDeps {
  registry?: import('../../../shared/types/crmQueryPlanner.js').CanonicalQueryRegistry;
  // Stage 3 seam so unit tests can stub the LLM call without needing real
  // provider credentials or a live DB. Production omits this and the real
  // `runLlmStage3` (imported statically above) is used.
  runLlmStage3?: typeof runLlmStage3;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUnsupportedError(intentHash: string, suggestions?: BriefResultSuggestion[]): BriefChatArtefact {
  return {
    artefactId:  `crm-err-${intentHash}`,
    kind:        'error',
    errorCode:   'unsupported_query',
    message:     'This query is not yet supported. Try one of the listed alternatives.',
    suggestions: suggestions ?? FALLBACK_SUGGESTIONS,
  };
}

function makeAmbiguousIntentError(intentHash: string, message: string, suggestions?: BriefResultSuggestion[]): BriefChatArtefact {
  return {
    artefactId:  `crm-ambig-${intentHash}`,
    kind:        'error',
    errorCode:   'ambiguous_intent',
    message:     message || 'The query could not be clearly interpreted. Please refine your request.',
    suggestions: suggestions ?? FALLBACK_SUGGESTIONS,
  };
}

function makeCostExceededError(intentHash: string): BriefChatArtefact {
  return {
    artefactId:  `crm-cost-${intentHash}`,
    kind:        'error',
    errorCode:   'cost_exceeded',
    message:     'Query cost exceeded the per-query budget. Try a more specific intent.',
    suggestions: FALLBACK_SUGGESTIONS,
  };
}

function makeLiveCallFailedError(intentHash: string, message: string): BriefChatArtefact {
  return {
    artefactId:  `crm-live-${intentHash}`,
    kind:        'error',
    errorCode:   'live_call_failed',
    message,
    suggestions: FALLBACK_SUGGESTIONS,
  };
}

// Recognises every shape `llmRouter` uses to signal budget exhaustion:
//   1. `BudgetExceededError` — original typed error from `budgetService` (not
//      thrown by the router in production, but safe to support).
//   2. Plain-object `{ statusCode: 402, code: 'BUDGET_EXCEEDED' }` — thrown
//      pre-call after the router writes its `budget_blocked` ledger row.
//      NOTE: llmRouter also throws `statusCode: 402` with
//      `code: 'RATE_LIMITED'` for reservation-side rate limiting — that is a
//      transient failure, not a budget overrun, so the `code` discriminator
//      matters. Only `BUDGET_EXCEEDED` matches here; `RATE_LIMITED` falls
//      through to the parse-failure / ambiguous_intent path downstream.
//   3. `FailureError` with `failureDetail === 'cost_limit_exceeded'` — thrown
//      post-call by the `runCostBreaker.assertWithinRunBudgetFromLedger` guard.
function isBudgetExceededError(err: unknown): boolean {
  if (err instanceof BudgetExceededError) return true;
  // FailureError.failure is required and readonly per shared/iee/failure.ts —
  // no optional chain needed.
  if (err instanceof FailureError && err.failure.failureDetail === 'cost_limit_exceeded') return true;
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const shape = err as { statusCode?: unknown; code?: unknown };
    if (shape.statusCode === 402 && shape.code === 'BUDGET_EXCEEDED') return true;
  }
  return false;
}

/**
 * §18.1 helper — resolves `runId` for the planner execution context from the
 * authenticated principal. Returns `principal.runId` if the middleware's
 * principal carries one, otherwise `undefined`.
 */
export function resolveAmbientRunId(principal: { runId?: string } | null | undefined): string | undefined {
  return principal?.runId;
}

// ── runQuery ──────────────────────────────────────────────────────────────────

export async function runQuery(
  input: RunQueryInput,
  context: ExecutorContext,
  deps: RunQueryDeps = {},
): Promise<RunQueryOutput> {
  // §16.4 — Wrap the pipeline in withPrincipalContext so every canonical read
  // (Stage 2 cache-hit re-validation, Stage 4 validator projection check,
  // canonical / hybrid executor dispatch) inherits the principal session
  // variables RLS policies consume. If no outer withOrgTx() is active (test
  // harness, programmatic caller outside HTTP middleware), skip the wrap —
  // the guard inside withPrincipalContext would otherwise throw.
  const runBody = () => runQueryPipeline(input, context, deps);
  if (getOrgTxContext()) {
    return withPrincipalContext(toPrincipalContext(context), runBody);
  }
  return runBody();
}

// PrincipalContext.type is 'user' | 'service' | 'delegated'; ExecutorContext's
// planner-internal principalType widens this to 'user' | 'agent' | 'system'.
// Non-user callers collapse to 'service' because a programmatic agent/system
// invocation is semantically a service principal at the DB layer.
function toPrincipalContext(context: ExecutorContext): PrincipalContext {
  if (context.principalType === 'user') {
    return {
      type:           'user',
      id:             context.principalId,
      organisationId: context.organisationId,
      subaccountId:   context.subaccountId,
      teamIds:        context.teamIds,
    };
  }
  return {
    type:           'service',
    id:             context.principalId,
    organisationId: context.organisationId,
    subaccountId:   context.subaccountId,
    serviceId:      context.principalId,
    teamIds:        context.teamIds,
  };
}

async function runQueryPipeline(
  input: RunQueryInput,
  context: ExecutorContext,
  deps: RunQueryDeps,
): Promise<RunQueryOutput> {
  const activeRegistry = deps.registry ??
    (await import('./executors/canonicalQueryRegistry.js')).canonicalQueryRegistry;
  // Envelope timestamp is epoch ms to match the documented contract at
  // shared/types/crmQueryPlanner.ts §6.6 PlannerEvent.at.
  const envelope = {
    at:           Date.now(),
    orgId:        context.orgId,
    subaccountId: context.subaccountId,
    runId:        context.runId,
    briefId:      input.briefId,
  };

  // ── Intent normalisation ──────────────────────────────────────────────────
  const intent = normaliseIntent(input.rawIntent);
  const intentHash = intent.hash;

  // ── PlannerTrace accumulator (spec §6.7 / §17.1) ──────────────────────────
  // Built progressively through the pipeline and attached to every terminal
  // `planner.result_emitted` / `planner.error_emitted` emission so the log
  // stream carries a flat trace view collated by `intentHash`.
  const trace: PlannerTrace = {
    intentHash,
    briefId: input.briefId,
    normaliserVersion: NORMALISER_VERSION,
    normalisedIntentTokens: intent.tokens,
    stage1: { hit: false },
    stage2: { hit: false },
    validator: { passed: false },
    mutations: [],
    terminalOutcome: 'error',
  };

  // ── Stage 1 — registry matcher ────────────────────────────────────────────
  const stage1Result = matchRegistryEntry(intent, activeRegistry, {
    callerCapabilities: context.callerCapabilities,
  });

  if (stage1Result !== null) {
    trace.stage1 = { hit: true, candidateKey: stage1Result.registryKey };
    trace.validator.passed = true;
    await emit({ kind: 'planner.stage1_matched', ...envelope, intentHash, registryKey: stage1Result.registryKey });

    try {
      const execResult = await executeCanonical(stage1Result.plan, context, activeRegistry);

      const { structured, approvalCards } = normaliseToArtefacts(
        stage1Result.plan,
        execResult,
        {
          subaccountId:            context.subaccountId,
          defaultSenderIdentifier: context.defaultSenderIdentifier,
        },
      );

      const artefacts: BriefChatArtefact[] = [structured, ...approvalCards];

      trace.executor = { kind: 'canonical' };
      trace.finalPlan = finaliseTracePlan(stage1Result.plan);
      trace.terminalOutcome = approvalCards.length > 0 ? 'approval' : 'structured';

      await emit({
        kind:             'planner.classified',
        ...envelope,
        intentHash,
        source:           'canonical',
        intentClass:      stage1Result.plan.intentClass,
        confidence:       1.0,
        stageResolved:    1,
        canonicalCandidateKey: stage1Result.plan.canonicalCandidateKey,
      });

      await emit({
        kind:             'planner.result_emitted',
        ...envelope,
        intentHash,
        artefactKind:     'structured',
        rowCount:         execResult.rowCount,
        truncated:        execResult.truncated,
        actualCostCents:  { total: execResult.actualCostCents, stage3: 0, executor: execResult.actualCostCents },
        stageResolved:    1,
        trace:            freezeTrace(trace),
      });

      return {
        artefacts,
        costPreview: stage1Result.plan.costPreview,
        stageResolved: 1,
        intentHash,
      };
    } catch (err) {
      if (err instanceof MissingPermissionError) {
        const artefact: BriefChatArtefact = {
          artefactId: `crm-perm-${intentHash}`,
          kind:       'error',
          errorCode:  'missing_permission',
          message:    err.message,
        };
        trace.terminalOutcome = 'error';
        trace.terminalErrorCode = 'missing_permission';
        await emit({ kind: 'planner.error_emitted', ...envelope, intentHash, errorCode: 'missing_permission', stageResolved: 1, trace: freezeTrace(trace) });
        return { artefacts: [artefact], costPreview: { predictedCostCents: 0, confidence: 'high', basedOn: 'static_heuristic' }, stageResolved: 1, intentHash };
      }
      throw err;
    }
  }

  // ── Stage 1 miss ──────────────────────────────────────────────────────────
  await emit({ kind: 'planner.stage1_missed', ...envelope, intentHash });

  // ── Stage 2 — plan cache read ─────────────────────────────────────────────
  const cacheResult = planCache.get(intentHash, context.subaccountId, {
    callerCapabilities: context.callerCapabilities,
    registry: activeRegistry,
  });

  if (cacheResult.hit) {
    trace.stage2 = { hit: true };
    trace.validator.passed = true;
    await emit({
      kind:      'planner.stage2_cache_hit',
      ...envelope,
      intentHash,
      cachedAt:  cacheResult.entry.cachedAt,
      hitCount:  cacheResult.entry.hits,
    });

    try {
      const execResult = await dispatchBySource(cacheResult.plan, context, activeRegistry, intentHash, envelope);

      const { structured, approvalCards } = normaliseToArtefacts(
        cacheResult.plan,
        execResult,
        {
          subaccountId:            context.subaccountId,
          defaultSenderIdentifier: context.defaultSenderIdentifier,
        },
      );

      const artefacts: BriefChatArtefact[] = [structured, ...approvalCards];

      trace.executor = { kind: cacheResult.plan.source };
      trace.finalPlan = finaliseTracePlan(cacheResult.plan);
      trace.terminalOutcome = approvalCards.length > 0 ? 'approval' : 'structured';

      await emit({
        kind:            'planner.classified',
        ...envelope,
        intentHash,
        source:          cacheResult.plan.source,
        intentClass:     cacheResult.plan.intentClass,
        confidence:      cacheResult.plan.confidence,
        stageResolved:   2,
        canonicalCandidateKey: cacheResult.plan.canonicalCandidateKey,
      });

      await emit({
        kind:            'planner.result_emitted',
        ...envelope,
        intentHash,
        artefactKind:    'structured',
        rowCount:        execResult.rowCount,
        truncated:       execResult.truncated,
        actualCostCents: { total: execResult.actualCostCents, stage3: 0, executor: execResult.actualCostCents },
        stageResolved:   2,
        trace:           freezeTrace(trace),
      });

      return {
        artefacts,
        costPreview: cacheResult.plan.costPreview,
        stageResolved: 2,
        intentHash,
      };
    } catch (err) {
      if (err instanceof MissingPermissionError) {
        const artefact: BriefChatArtefact = {
          artefactId: `crm-perm-${intentHash}`,
          kind:       'error',
          errorCode:  'missing_permission',
          message:    err.message,
        };
        trace.terminalOutcome = 'error';
        trace.terminalErrorCode = 'missing_permission';
        await emit({ kind: 'planner.error_emitted', ...envelope, intentHash, errorCode: 'missing_permission', stageResolved: 2, trace: freezeTrace(trace) });
        return { artefacts: [artefact], costPreview: { predictedCostCents: 0, confidence: 'high', basedOn: 'static_heuristic' }, stageResolved: 2, intentHash };
      }
      if (err instanceof LiveExecutorError) {
        const artefact = makeLiveCallFailedError(intentHash, err.message);
        trace.terminalOutcome = 'error';
        trace.terminalErrorCode = err.errorCode;
        await emit({ kind: 'planner.error_emitted', ...envelope, intentHash, errorCode: err.errorCode, stageResolved: 2, trace: freezeTrace(trace) });
        return { artefacts: [artefact], costPreview: { predictedCostCents: 0, confidence: 'high', basedOn: 'cached_similar_query' }, stageResolved: 2, intentHash };
      }
      throw err;
    }
  }

  trace.stage2 = { hit: false, reason: cacheResult.reason };
  await emit({
    kind:       'planner.stage2_cache_miss',
    ...envelope,
    intentHash,
    reason:     cacheResult.reason,
  });

  // ── Stage 3 — LLM planner ─────────────────────────────────────────────────
  await emit({
    kind:       'planner.stage3_parse_started',
    ...envelope,
    intentHash,
    modelTier:  'default',
    schemaTokens: 2000,
  });

  const stage3 = deps.runLlmStage3 ?? runLlmStage3;
  let stage3Output: Awaited<ReturnType<typeof runLlmStage3>>;
  try {
    stage3Output = await stage3({
      intent,
      registry:       activeRegistry,
      organisationId: context.organisationId,
      subaccountId:   context.subaccountId,
      runId:          context.runId,
    });
  } catch (err) {
    // Per-run ledger budget exceeded inside llmRouter → cost_exceeded (spec §16.2).
    // Router surfaces three shapes (see `isBudgetExceededError`): the typed
    // `BudgetExceededError`, a plain `{ statusCode: 402 }` pre-call, and a
    // `FailureError` with `cost_limit_exceeded` post-ledger via runCostBreaker.
    if (isBudgetExceededError(err)) {
      const artefact = makeCostExceededError(intentHash);
      trace.stage3 = { used: true, parseFailure: true };
      trace.terminalOutcome = 'error';
      trace.terminalErrorCode = 'cost_exceeded';
      await emit({
        kind:             'planner.error_emitted',
        ...envelope,
        intentHash,
        errorCode:        'cost_exceeded',
        stageResolved:    3,
        errorSubcategory: 'cost_exceeded_stage3',
        trace:            freezeTrace(trace),
      });
      return {
        artefacts:    [artefact],
        costPreview:  { predictedCostCents: 0, confidence: 'low', basedOn: 'planner_estimate' },
        stageResolved: 3,
        intentHash,
      };
    }
    // Parse failure or router error → ambiguous_intent
    const artefact = makeAmbiguousIntentError(intentHash, (err as Error).message);
    trace.stage3 = { used: true, parseFailure: true };
    trace.terminalOutcome = 'error';
    trace.terminalErrorCode = 'ambiguous_intent';
    await emit({
      kind:             'planner.error_emitted',
      ...envelope,
      intentHash,
      errorCode:        'ambiguous_intent',
      stageResolved:    3,
      errorSubcategory: 'parse_failure',
      trace:            freezeTrace(trace),
    });
    return {
      artefacts:    [artefact],
      costPreview:  { predictedCostCents: 0, confidence: 'low', basedOn: 'planner_estimate' },
      stageResolved: 3,
      intentHash,
    };
  }

  const { draft, defaultTierUsage, escalationTierUsage, escalated, escalationReason } = stage3Output;
  trace.stage3 = {
    used: true,
    defaultTierTokens:    defaultTierUsage    ? { input: defaultTierUsage.inputTokens,    output: defaultTierUsage.outputTokens }    : undefined,
    escalationTierTokens: escalationTierUsage ? { input: escalationTierUsage.inputTokens, output: escalationTierUsage.outputTokens } : undefined,
    escalationReason:     escalated ? (escalationReason ?? 'low_confidence') : undefined,
  };

  await emit({
    kind:         'planner.stage3_parse_completed',
    ...envelope,
    intentHash,
    modelTier:    escalated ? 'escalated' : 'default',
    inputTokens:  (escalationTierUsage ?? defaultTierUsage)?.inputTokens ?? 0,
    outputTokens: (escalationTierUsage ?? defaultTierUsage)?.outputTokens ?? 0,
    latencyMs:    stage3Output.escalationTierLatencyMs ?? stage3Output.defaultTierLatencyMs ?? 0,
    confidence:   draft.confidence,
  });

  if (escalated) {
    await emit({
      kind:      'planner.stage3_escalated',
      ...envelope,
      intentHash,
      fromTier:  'default',
      toTier:    'escalated',
      reason:    escalationReason ?? 'low_confidence',
    });
  }

  // ── Per-query cent ceiling (§16.2) — checked post-Stage 3 before executor ─
  const stage3CostCents = computeActualCostCents({
    stage3ParseUsage:      defaultTierUsage,
    stage3EscalationUsage: escalationTierUsage,
  }).stage3;

  // Default ceiling (100¢ / $1 per query) is applied when the settings row
  // is absent OR when the DB round-trip fails (unit tests, degraded primary).
  // Fail-open to the default rather than surface a generic 500 — spec §16.2
  // designates the per-query ceiling as observability, not a hard cost gate
  // (the real per-run enforcement lives in `runCostBreaker`, which runs
  // independently of this value). The warn log below is the canary operators
  // watch for a degraded settings fetch path so a genuine DB regression
  // doesn't silently revert the ceiling to the default indefinitely.
  let perQueryCentsCeiling = 100;
  try {
    const perQueryCentsStr = await systemSettingsService.get(SETTING_KEYS.CRM_QUERY_PLANNER_PER_QUERY_CENTS);
    const parsed = parseInt(perQueryCentsStr, 10);
    if (!Number.isNaN(parsed) && parsed > 0) perQueryCentsCeiling = parsed;
  } catch (err) {
    logger.warn('crm_query_planner.settings_fetch_failed', {
      setting: SETTING_KEYS.CRM_QUERY_PLANNER_PER_QUERY_CENTS,
      fallbackCents: perQueryCentsCeiling,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (stage3CostCents > perQueryCentsCeiling) {
    const artefact = makeCostExceededError(intentHash);
    trace.terminalOutcome = 'error';
    trace.terminalErrorCode = 'cost_exceeded';
    await emit({
      kind:             'planner.error_emitted',
      ...envelope,
      intentHash,
      errorCode:        'cost_exceeded',
      stageResolved:    3,
      errorSubcategory: 'cost_exceeded_stage3',
      trace:            freezeTrace(trace),
    });
    return {
      artefacts:    [artefact],
      costPreview:  { predictedCostCents: stage3CostCents, confidence: 'high', basedOn: 'planner_estimate' },
      stageResolved: 3,
      intentHash,
    };
  }

  // ── Stage 4 — Validator ───────────────────────────────────────────────────
  // Build costPreview from Stage 3 usage before validation
  const costPreview = computePlannerCostPreview({
    stage3ParseUsage:      defaultTierUsage,
    stage3EscalationUsage: escalationTierUsage,
    basedOn:               'planner_estimate',
  });

  let validatedPlan: import('../../../shared/types/crmQueryPlanner.js').QueryPlan;
  try {
    validatedPlan = validatePlanPure(draft, {
      mode:               'full',
      stageResolved:      3,
      costPreview,
      schemaContext:      null, // v1: schemaContext is built for prompt injection only; validator uses null
      registry:           activeRegistry,
      callerCapabilities: context.callerCapabilities,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      trace.validator = {
        passed:        false,
        failedRule:    ruleNumberForRejection(err.rejectedRule),
        rejectedValue: err.rejectedValue,
      };
      trace.terminalOutcome = 'error';
      trace.terminalErrorCode = 'ambiguous_intent';
      await emit({
        kind:          'planner.validation_failed',
        ...envelope,
        intentHash,
        rejectedRule:  err.rejectedRule,
        rejectedValue: err.rejectedValue,
      });
      const artefact = makeAmbiguousIntentError(intentHash, err.message);
      await emit({
        kind:             'planner.error_emitted',
        ...envelope,
        intentHash,
        errorCode:        'ambiguous_intent',
        stageResolved:    3,
        errorSubcategory: 'validation_failed',
        trace:            freezeTrace(trace),
      });
      return {
        artefacts:    [artefact],
        costPreview,
        stageResolved: 3,
        intentHash,
      };
    }
    throw err;
  }

  trace.validator.passed = true;

  // ── unsupported intent class — never dispatched ────────────────────────────
  if (validatedPlan.intentClass === 'unsupported') {
    trace.terminalOutcome = 'error';
    trace.terminalErrorCode = 'unsupported_query';
    await emit({
      kind:             'planner.error_emitted',
      ...envelope,
      intentHash,
      errorCode:        'unsupported_query',
      stageResolved:    3,
      errorSubcategory: 'no_pattern_match',
      trace:            freezeTrace(trace),
    });
    return {
      artefacts:    [makeUnsupportedError(intentHash)],
      costPreview,
      stageResolved: 3,
      intentHash,
    };
  }

  // ── Canonical promotion event (if rule 8 fired) ────────────────────────────
  if (draft.source === 'live' && validatedPlan.source !== 'live') {
    trace.canonicalPromoted = {
      fromSource: 'live',
      toSource:   validatedPlan.source as 'canonical' | 'hybrid',
    };
    trace.mutations.push({
      stage:  'canonical_precedence_promotion',
      field:  'source',
      before: 'live',
      after:  validatedPlan.source,
      reason: 'rule_8_canonical_precedence',
    });
    await emit({
      kind:       'planner.canonical_promoted',
      ...envelope,
      intentHash,
      fromSource: 'live',
      toSource:   validatedPlan.source,
      registryKey: validatedPlan.canonicalCandidateKey,
    });
  }

  // ── Cache write (§9.3 — only Stage 3 validated plans) ─────────────────────
  const cacheConfidence: 'high' | 'medium' | 'low' =
    escalated ? 'low' : draft.confidence >= 0.6 ? 'medium' : 'low';
  planCache.set(intentHash, context.subaccountId, validatedPlan, cacheConfidence);

  // ── Emit classified event ─────────────────────────────────────────────────
  await emit({
    kind:                  'planner.classified',
    ...envelope,
    intentHash,
    source:                validatedPlan.source,
    intentClass:           validatedPlan.intentClass,
    confidence:            validatedPlan.confidence,
    stageResolved:         3,
    canonicalCandidateKey: validatedPlan.canonicalCandidateKey,
  });

  // ── Executor dispatch ─────────────────────────────────────────────────────
  await emit({
    kind:               'planner.executor_dispatched',
    ...envelope,
    intentHash,
    executor:           validatedPlan.source,
    predictedCostCents: costPreview.predictedCostCents,
  });

  try {
    const execResult = await dispatchBySource(validatedPlan, context, activeRegistry, intentHash, envelope);

    const { structured, approvalCards } = normaliseToArtefacts(
      validatedPlan,
      execResult,
      {
        subaccountId:            context.subaccountId,
        defaultSenderIdentifier: context.defaultSenderIdentifier,
      },
    );

    const artefacts: BriefChatArtefact[] = [structured, ...approvalCards];

    const actualCostCents = computeActualCostCents({
      stage3ParseUsage:      defaultTierUsage,
      stage3EscalationUsage: escalationTierUsage,
      liveCallCount:         validatedPlan.source === 'live' ? 1 : 0,
    });

    // Prediction drift signal (spec §16.2.1) — warn when actual cost more than
    // 2× the predicted. Non-blocking; the response still returns normally.
    if (
      costPreview.predictedCostCents > 0 &&
      actualCostCents.total > costPreview.predictedCostCents * 2
    ) {
      logger.warn('cost_prediction_drift', {
        intentHash,
        predicted:      costPreview.predictedCostCents,
        actual:         actualCostCents.total,
        stageResolved:  3,
        source:         validatedPlan.source,
      });
    }

    trace.executor = { kind: validatedPlan.source };
    trace.finalPlan = finaliseTracePlan(validatedPlan);
    trace.terminalOutcome = approvalCards.length > 0 ? 'approval' : 'structured';

    await emit({
      kind:            'planner.result_emitted',
      ...envelope,
      intentHash,
      artefactKind:    'structured',
      rowCount:        execResult.rowCount,
      truncated:       execResult.truncated,
      actualCostCents,
      stageResolved:   3,
      trace:           freezeTrace(trace),
    });

    return {
      artefacts,
      costPreview,
      stageResolved: 3,
      intentHash,
    };
  } catch (err) {
    trace.executor = trace.executor ?? { kind: validatedPlan.source };
    trace.finalPlan = trace.finalPlan ?? finaliseTracePlan(validatedPlan);
    if (err instanceof MissingPermissionError) {
      const artefact: BriefChatArtefact = {
        artefactId: `crm-perm-${intentHash}`,
        kind:       'error',
        errorCode:  'missing_permission',
        message:    err.message,
      };
      trace.terminalOutcome = 'error';
      trace.terminalErrorCode = 'missing_permission';
      await emit({ kind: 'planner.error_emitted', ...envelope, intentHash, errorCode: 'missing_permission', stageResolved: 3, trace: freezeTrace(trace) });
      return { artefacts: [artefact], costPreview, stageResolved: 3, intentHash };
    }
    if (err instanceof LiveExecutorError) {
      const artefact = makeLiveCallFailedError(intentHash, err.message);
      trace.terminalOutcome = 'error';
      trace.terminalErrorCode = err.errorCode;
      await emit({
        kind:             'planner.error_emitted',
        ...envelope,
        intentHash,
        errorCode:        err.errorCode,
        stageResolved:    3,
        errorSubcategory: 'live_call_failed',
        trace:            freezeTrace(trace),
      });
      return { artefacts: [artefact], costPreview, stageResolved: 3, intentHash };
    }
    if (err instanceof HybridCapError) {
      const artefact = makeCostExceededError(intentHash);
      trace.executor = { kind: 'hybrid', capShortCircuited: true };
      trace.terminalOutcome = 'error';
      trace.terminalErrorCode = 'cost_exceeded';
      await emit({
        kind:             'planner.error_emitted',
        ...envelope,
        intentHash,
        errorCode:        'cost_exceeded',
        stageResolved:    3,
        errorSubcategory: 'cost_exceeded_executor',
        trace:            freezeTrace(trace),
      });
      return { artefacts: [artefact], costPreview, stageResolved: 3, intentHash };
    }
    if (err instanceof HybridLiveCallError) {
      const artefact = makeLiveCallFailedError(intentHash, err.message);
      trace.terminalOutcome = 'error';
      trace.terminalErrorCode = 'live_call_failed';
      await emit({
        kind:             'planner.error_emitted',
        ...envelope,
        intentHash,
        errorCode:        'live_call_failed',
        stageResolved:    3,
        errorSubcategory: 'live_call_failed',
        trace:            freezeTrace(trace),
      });
      return { artefacts: [artefact], costPreview, stageResolved: 3, intentHash };
    }
    throw err;
  }
}

// Snapshot + deep-freeze the accumulator so downstream consumers can't mutate
// the trace after terminal emission (§6.7: trace is frozen at terminal emit).
function freezeTrace(trace: PlannerTrace): PlannerTrace {
  return Object.freeze({
    ...trace,
    stage1:     Object.freeze({ ...trace.stage1 }),
    stage2:     Object.freeze({ ...trace.stage2 }),
    stage3:     trace.stage3 ? Object.freeze({ ...trace.stage3 }) : undefined,
    validator:  Object.freeze({ ...trace.validator }),
    canonicalPromoted: trace.canonicalPromoted ? Object.freeze({ ...trace.canonicalPromoted }) : undefined,
    executor:   trace.executor ? Object.freeze({ ...trace.executor }) : undefined,
    finalPlan:  trace.finalPlan ? Object.freeze({ ...trace.finalPlan }) : undefined,
    mutations:  Object.freeze([...trace.mutations]) as unknown as PlannerPlanMutation[],
    normalisedIntentTokens: Object.freeze([...trace.normalisedIntentTokens]) as unknown as string[],
  }) as PlannerTrace;
}

function finaliseTracePlan(plan: QueryPlan): PlannerTrace['finalPlan'] {
  return {
    source:        plan.source,
    primaryEntity: plan.primaryEntity,
    filterCount:   (plan.filters ?? []).length,
  };
}

// Maps the ValidationError.rejectedRule string to the numeric rule number used
// in PlannerTrace.validator.failedRule (1..10, spec §11.2).
function ruleNumberForRejection(rule: string): number {
  switch (rule) {
    case 'entity_existence':         return 1;
    case 'field_existence':          return 2;
    case 'operator_sanity':          return 3;
    case 'date_range_sanity':        return 4;
    case 'entity_relation_validity': return 5;
    case 'aggregation_compatibility':return 6;
    case 'hybrid_pattern_check':     return 7;
    case 'canonical_precedence':     return 8;
    case 'projection_overlap':       return 9;
    case 'capability_check':         return 10;
    default: return 0;
  }
}

// ── Executor dispatcher ────────────────────────────────────────────────────────

async function dispatchBySource(
  plan: import('../../../shared/types/crmQueryPlanner.js').QueryPlan,
  context: ExecutorContext,
  registry: import('../../../shared/types/crmQueryPlanner.js').CanonicalQueryRegistry,
  intentHash: string,
  envelope: Record<string, unknown>,
): Promise<import('../../../shared/types/crmQueryPlanner.js').ExecutorResult> {
  switch (plan.source) {
    case 'canonical':
      return executeCanonical(plan, context, registry);

    case 'live':
      return executeLive(plan, context);

    case 'hybrid':
      return executeHybrid(plan, context, registry);
  }
}
