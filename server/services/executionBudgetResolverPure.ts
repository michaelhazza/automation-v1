import type { ResolvedExecutionBudget } from '../../shared/types/cachedContext.js';

// ---------------------------------------------------------------------------
// executionBudgetResolverPure — pure resolution arithmetic (§6.5)
//
// Resolution order: platform-default policy → org-ceiling override → task config.
// Each step can only NARROW (min), never widen.
// ---------------------------------------------------------------------------

export interface ModelTierPolicyRow {
  id: string;
  organisationId: string | null;
  modelFamily: string;
  modelContextWindow: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  reserveOutputTokens: number;
  maxTotalCostUsdCents: number;
  perDocumentMaxTokens: number;
  softWarnRatio: string; // numeric string from DB
}

export interface TaskConfigOverride {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalCostUsdCents?: number;
}

export class BudgetResolutionError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.statusCode = code === 'CACHED_CONTEXT_BUDGET_NARROWED_TO_ZERO' ? 400 : 500;
  }
}

export const CACHED_CONTEXT_BUDGET_NO_POLICY          = 'CACHED_CONTEXT_BUDGET_NO_POLICY';
export const CACHED_CONTEXT_BUDGET_INVARIANT_VIOLATED = 'CACHED_CONTEXT_BUDGET_INVARIANT_VIOLATED';
export const CACHED_CONTEXT_BUDGET_NARROWED_TO_ZERO   = 'CACHED_CONTEXT_BUDGET_NARROWED_TO_ZERO';

export function resolveBudgetPure(input: {
  taskConfig: TaskConfigOverride | null;
  modelTierPolicy: ModelTierPolicyRow;
  orgCeilingPolicy: ModelTierPolicyRow | null;
}): ResolvedExecutionBudget {
  const { taskConfig, modelTierPolicy, orgCeilingPolicy } = input;

  // Step 1: start from the model-tier policy
  let maxInputTokens      = modelTierPolicy.maxInputTokens;
  let maxOutputTokens     = modelTierPolicy.maxOutputTokens;
  let maxTotalCostUsdCents = modelTierPolicy.maxTotalCostUsdCents;
  let perDocumentMaxTokens = modelTierPolicy.perDocumentMaxTokens;
  let reserveOutputTokens  = modelTierPolicy.reserveOutputTokens;
  const softWarnRatio      = parseFloat(modelTierPolicy.softWarnRatio);

  const orgCeilingPolicyId = orgCeilingPolicy?.id ?? null;

  // Step 2: narrow by org ceiling
  if (orgCeilingPolicy) {
    maxInputTokens       = Math.min(maxInputTokens, orgCeilingPolicy.maxInputTokens);
    maxOutputTokens      = Math.min(maxOutputTokens, orgCeilingPolicy.maxOutputTokens);
    maxTotalCostUsdCents = Math.min(maxTotalCostUsdCents, orgCeilingPolicy.maxTotalCostUsdCents);
    perDocumentMaxTokens = Math.min(perDocumentMaxTokens, orgCeilingPolicy.perDocumentMaxTokens);
    reserveOutputTokens  = Math.min(reserveOutputTokens, orgCeilingPolicy.reserveOutputTokens);
  }

  // Step 3: narrow by task config
  if (taskConfig) {
    if (taskConfig.maxInputTokens !== undefined)       maxInputTokens       = Math.min(maxInputTokens, taskConfig.maxInputTokens);
    if (taskConfig.maxOutputTokens !== undefined)      maxOutputTokens      = Math.min(maxOutputTokens, taskConfig.maxOutputTokens);
    if (taskConfig.maxTotalCostUsdCents !== undefined) maxTotalCostUsdCents = Math.min(maxTotalCostUsdCents, taskConfig.maxTotalCostUsdCents);
  }

  // Step 4: reserveOutputTokens narrows to resolved maxOutputTokens
  reserveOutputTokens = Math.min(reserveOutputTokens, maxOutputTokens);

  // Step 5: capacity invariant check
  if (maxInputTokens + reserveOutputTokens > modelTierPolicy.modelContextWindow) {
    throw new BudgetResolutionError(
      CACHED_CONTEXT_BUDGET_INVARIANT_VIOLATED,
      `maxInputTokens (${maxInputTokens}) + reserveOutputTokens (${reserveOutputTokens}) > modelContextWindow (${modelTierPolicy.modelContextWindow})`
    );
  }

  // Step 6: validate all fields > 0
  const dims: Array<[string, number]> = [
    ['maxInputTokens', maxInputTokens],
    ['maxOutputTokens', maxOutputTokens],
    ['maxTotalCostUsdCents', maxTotalCostUsdCents],
    ['perDocumentMaxTokens', perDocumentMaxTokens],
    ['reserveOutputTokens', reserveOutputTokens],
  ];
  for (const [name, val] of dims) {
    if (val <= 0) {
      throw new BudgetResolutionError(
        CACHED_CONTEXT_BUDGET_NARROWED_TO_ZERO,
        `Budget dimension "${name}" narrowed to ${val} ≤ 0`
      );
    }
  }
  if (softWarnRatio <= 0 || softWarnRatio >= 1) {
    throw new BudgetResolutionError(
      CACHED_CONTEXT_BUDGET_INVARIANT_VIOLATED,
      `softWarnRatio (${softWarnRatio}) must be in (0, 1)`
    );
  }

  return {
    maxInputTokens,
    maxOutputTokens,
    maxTotalCostUsd: maxTotalCostUsdCents / 100,
    perDocumentMaxTokens,
    reserveOutputTokens,
    softWarnRatio,
    resolvedFrom: {
      taskConfigId: null,
      modelTierPolicyId: modelTierPolicy.id,
      orgCeilingPolicyId,
    },
    modelFamily: modelTierPolicy.modelFamily as ResolvedExecutionBudget['modelFamily'],
    modelContextWindow: modelTierPolicy.modelContextWindow,
  };
}
