import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { modelTierBudgetPolicies } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { ResolvedExecutionBudget } from '../../shared/types/cachedContext.js';
import {
  resolveBudgetPure,
  BudgetResolutionError,
  CACHED_CONTEXT_BUDGET_NO_POLICY,
} from './executionBudgetResolverPure.js';

export { BudgetResolutionError };
export type { ResolvedExecutionBudget };

export interface ExecutionBudgetOverrides {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalCostUsdCents?: number;
}

// ---------------------------------------------------------------------------
// resolve — stateful wrapper: queries model_tier_budget_policies then delegates
// to pure resolution arithmetic.
//
// Resolution:
//   1. Fetch org-specific row for (organisationId, modelFamily) if present.
//   2. Fetch platform-default row where organisation_id IS NULL.
//   3. Resolve via resolveBudgetPure with taskConfig override.
// ---------------------------------------------------------------------------
export async function resolve(input: {
  organisationId: string;
  modelFamily: string;
  taskConfig?: ExecutionBudgetOverrides;
}): Promise<ResolvedExecutionBudget> {
  const db = getOrgScopedDb('executionBudgetResolver.resolve');
  // Fetch both org-specific (ceiling) and platform-default rows
  const [orgRow, platformRow] = await Promise.all([
    db
      .select()
      .from(modelTierBudgetPolicies)
      .where(
        and(
          eq(modelTierBudgetPolicies.organisationId, input.organisationId),
          eq(modelTierBudgetPolicies.modelFamily, input.modelFamily)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),

    db
      .select()
      .from(modelTierBudgetPolicies)
      .where(
        and(
          isNull(modelTierBudgetPolicies.organisationId),
          eq(modelTierBudgetPolicies.modelFamily, input.modelFamily)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!platformRow) {
    throw new BudgetResolutionError(
      CACHED_CONTEXT_BUDGET_NO_POLICY,
      `No model_tier_budget_policies row for modelFamily "${input.modelFamily}" (no platform default)`
    );
  }

  return resolveBudgetPure({
    taskConfig: input.taskConfig ?? null,
    modelTierPolicy: platformRow as any,
    orgCeilingPolicy: orgRow as any,
  });
}
