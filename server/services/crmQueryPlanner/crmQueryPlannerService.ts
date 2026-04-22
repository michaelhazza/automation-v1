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
import type { ExecutorContext } from '../../../shared/types/crmQueryPlanner.js';
import type { BriefChatArtefact, BriefCostPreview, BriefResultSuggestion } from '../../../shared/types/briefResultContract.js';
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
  const activeRegistry = deps.registry ??
    (await import('./executors/canonicalQueryRegistry.js')).canonicalQueryRegistry;
  const now = new Date().toISOString();
  const envelope = {
    at:           now,
    orgId:        context.orgId,
    subaccountId: context.subaccountId,
    runId:        context.runId,
    briefId:      input.briefId,
  };

  // ── Intent normalisation ──────────────────────────────────────────────────
  const intent = normaliseIntent(input.rawIntent);
  const intentHash = intent.hash;

  // ── Stage 1 — registry matcher ────────────────────────────────────────────
  const stage1Result = matchRegistryEntry(intent, activeRegistry, {
    callerCapabilities: context.callerCapabilities,
  });

  if (stage1Result !== null) {
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
        await emit({ kind: 'planner.error_emitted', ...envelope, intentHash, errorCode: 'missing_permission', stageResolved: 1 });
        return { artefacts: [artefact], costPreview: { predictedCostCents: 0, confidence: 'high', basedOn: 'static_heuristic' }, stageResolved: 1, intentHash };
      }
      throw err;
    }
  }

  // ── Stage 1 miss ──────────────────────────────────────────────────────────
  await emit({ kind: 'planner.stage1_missed', ...envelope, intentHash });

  // ── Stage 2 — plan cache read ─────────────────────────────────────────────
  const cacheHit = planCache.get(intentHash, context.subaccountId, {
    callerCapabilities: context.callerCapabilities,
    registry: activeRegistry,
  });

  if (cacheHit !== null) {
    await emit({
      kind:      'planner.stage2_cache_hit',
      ...envelope,
      intentHash,
      cachedAt:  cacheHit.entry.cachedAt,
      hitCount:  cacheHit.entry.hits,
    });

    try {
      const execResult = await dispatchBySource(cacheHit.plan, context, activeRegistry, intentHash, envelope);

      const { structured, approvalCards } = normaliseToArtefacts(
        cacheHit.plan,
        execResult,
        {
          subaccountId:            context.subaccountId,
          defaultSenderIdentifier: context.defaultSenderIdentifier,
        },
      );

      const artefacts: BriefChatArtefact[] = [structured, ...approvalCards];

      await emit({
        kind:            'planner.classified',
        ...envelope,
        intentHash,
        source:          cacheHit.plan.source,
        intentClass:     cacheHit.plan.intentClass,
        confidence:      cacheHit.plan.confidence,
        stageResolved:   2,
        canonicalCandidateKey: cacheHit.plan.canonicalCandidateKey,
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
      });

      return {
        artefacts,
        costPreview: cacheHit.plan.costPreview,
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
        await emit({ kind: 'planner.error_emitted', ...envelope, intentHash, errorCode: 'missing_permission', stageResolved: 2 });
        return { artefacts: [artefact], costPreview: { predictedCostCents: 0, confidence: 'high', basedOn: 'static_heuristic' }, stageResolved: 2, intentHash };
      }
      if (err instanceof LiveExecutorError) {
        const artefact = makeLiveCallFailedError(intentHash, err.message);
        await emit({ kind: 'planner.error_emitted', ...envelope, intentHash, errorCode: err.errorCode, stageResolved: 2 });
        return { artefacts: [artefact], costPreview: { predictedCostCents: 0, confidence: 'high', basedOn: 'cached_similar_query' }, stageResolved: 2, intentHash };
      }
      throw err;
    }
  }

  await emit({
    kind:       'planner.stage2_cache_miss',
    ...envelope,
    intentHash,
    reason:     'not_present' as const,
  });

  // ── Stage 3 — LLM planner ─────────────────────────────────────────────────
  await emit({
    kind:       'planner.stage3_parse_started',
    ...envelope,
    intentHash,
    modelTier:  'default',
    schemaTokens: 2000,
  });

  let stage3Output: Awaited<ReturnType<typeof runLlmStage3>>;
  try {
    stage3Output = await runLlmStage3({
      intent,
      registry:       activeRegistry,
      organisationId: context.organisationId,
      subaccountId:   context.subaccountId,
      runId:          context.runId,
    });
  } catch (err) {
    // Parse failure or router error → ambiguous_intent
    const artefact = makeAmbiguousIntentError(intentHash, (err as Error).message);
    await emit({
      kind:             'planner.error_emitted',
      ...envelope,
      intentHash,
      errorCode:        'ambiguous_intent',
      stageResolved:    3,
      errorSubcategory: 'parse_failure',
    });
    return {
      artefacts:    [artefact],
      costPreview:  { predictedCostCents: 0, confidence: 'low', basedOn: 'planner_estimate' },
      stageResolved: 3,
      intentHash,
    };
  }

  const { draft, defaultTierUsage, escalationTierUsage, escalated, escalationReason } = stage3Output;

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

  const perQueryCentsStr = await systemSettingsService.get(SETTING_KEYS.CRM_QUERY_PLANNER_PER_QUERY_CENTS);
  const perQueryCentsCeiling = parseInt(perQueryCentsStr) || 100;

  if (stage3CostCents > perQueryCentsCeiling) {
    const artefact = makeCostExceededError(intentHash);
    await emit({
      kind:             'planner.error_emitted',
      ...envelope,
      intentHash,
      errorCode:        'cost_exceeded',
      stageResolved:    3,
      errorSubcategory: 'cost_exceeded_stage3',
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

  // ── unsupported intent class — never dispatched ────────────────────────────
  if (validatedPlan.intentClass === 'unsupported') {
    await emit({
      kind:             'planner.error_emitted',
      ...envelope,
      intentHash,
      errorCode:        'unsupported_query',
      stageResolved:    3,
      errorSubcategory: 'no_pattern_match',
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

    await emit({
      kind:            'planner.result_emitted',
      ...envelope,
      intentHash,
      artefactKind:    'structured',
      rowCount:        execResult.rowCount,
      truncated:       execResult.truncated,
      actualCostCents,
      stageResolved:   3,
    });

    return {
      artefacts,
      costPreview,
      stageResolved: 3,
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
      await emit({ kind: 'planner.error_emitted', ...envelope, intentHash, errorCode: 'missing_permission', stageResolved: 3 });
      return { artefacts: [artefact], costPreview, stageResolved: 3, intentHash };
    }
    if (err instanceof LiveExecutorError) {
      const artefact = makeLiveCallFailedError(intentHash, err.message);
      await emit({
        kind:             'planner.error_emitted',
        ...envelope,
        intentHash,
        errorCode:        err.errorCode,
        stageResolved:    3,
        errorSubcategory: 'live_call_failed',
      });
      return { artefacts: [artefact], costPreview, stageResolved: 3, intentHash };
    }
    if (err instanceof HybridCapError) {
      const artefact = makeCostExceededError(intentHash);
      await emit({
        kind:             'planner.error_emitted',
        ...envelope,
        intentHash,
        errorCode:        'cost_exceeded',
        stageResolved:    3,
        errorSubcategory: 'cost_exceeded_executor',
      });
      return { artefacts: [artefact], costPreview, stageResolved: 3, intentHash };
    }
    if (err instanceof HybridLiveCallError) {
      const artefact = makeLiveCallFailedError(intentHash, err.message);
      await emit({
        kind:             'planner.error_emitted',
        ...envelope,
        intentHash,
        errorCode:        'live_call_failed',
        stageResolved:    3,
        errorSubcategory: 'live_call_failed',
      });
      return { artefacts: [artefact], costPreview, stageResolved: 3, intentHash };
    }
    throw err;
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
