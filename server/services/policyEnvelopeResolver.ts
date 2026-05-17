// Policy Envelope Resolver — aggregates six constraint sources and persists the
// v1 snapshot onto agent_runs before the agent loop starts (INV-19).

import { and, eq, isNull } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  agentRuns,
  subaccountAgents,
  policyRules,
} from '../db/schema/index.js';
import { spendingBudgets } from '../db/schema/spendingBudgets.js';
import { spendingPolicies } from '../db/schema/spendingPolicies.js';
import { credentialBrokerService } from './credentialBrokerService.js';
import { CONTROLLER_LIMITS } from '../config/controllerLimits.js';
import {
  buildRiskTierApprovalDefaults,
  computeSourceVersion,
  assembleSnapshot,
} from './policyEnvelopeResolverPure.js';
import type { PolicyEnvelopeSnapshot } from '../../shared/types/policyEnvelope.js';
import type { ControllerStyle } from '../../shared/types/controllerStyle.js';
import type { ExecutionMode } from '../../shared/types/executionEnvironment.js';
import type { RiskTier } from '../../shared/types/riskTier.js';
import type { GateLevel } from '../../shared/types/riskTier.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface PolicyEnvelopeContext {
  runId: string;
  agentId: string;
  subaccountAgentId: string;
  organisationId: string;
  subaccountId: string;
  controllerStyle: ControllerStyle;
  executionMode: ExecutionMode;
  tokenBudget: number;
  maxToolCalls: number;
}

// ── Error class ───────────────────────────────────────────────────────────────

export class PolicyEnvelopePersistFailedError extends Error {
  readonly statusCode = 500;
  readonly errorCode = 'policy_envelope_persist_failed';

  constructor(runId: string) {
    super(`Policy envelope persist failed for run ${runId}: both UPDATE and re-read returned null`);
    this.name = 'PolicyEnvelopePersistFailedError';
  }
}

// Thrown by agentExecutionService when the resolved Policy Envelope's
// allowedEnvironments does not include the environment derived from the
// run's executionMode. Spec §4.2.8 requires this gate before tool/IEE
// dispatch (the envelope captures the constraint; this error enforces it).
// Spec §4.2.8 line 636: HTTP 422 with code execution_mode_not_allowed_for_agent.
export class ExecutionModeNotAllowedForAgentError extends Error {
  readonly statusCode = 422;
  readonly errorCode = 'execution_mode_not_allowed_for_agent';

  constructor(executionMode: string, environment: string) {
    super(
      `Execution mode '${executionMode}' (environment '${environment}') ` +
        `is not in the agent's allowed_environments list.`,
    );
    this.name = 'ExecutionModeNotAllowedForAgentError';
  }
}

// ── resolvePolicyEnvelope ─────────────────────────────────────────────────────

/**
 * Aggregates six constraint sources per spec §4.5.5 and composes the v1 snapshot.
 * No DB writes — use persist() to save the result.
 */
export async function resolvePolicyEnvelope(
  ctx: PolicyEnvelopeContext,
): Promise<PolicyEnvelopeSnapshot> {
  // Source 1: subaccountAgent constraints (governance columns from chunk 2).
  // App-layer org filter required even with RLS (DEVELOPMENT_GUIDELINES §1).
  const scopedDb = getOrgScopedDb('policyEnvelopeResolver.resolvePolicyEnvelope');
  const [saRow] = await scopedDb
    .select()
    .from(subaccountAgents)
    .where(and(
      eq(subaccountAgents.id, ctx.subaccountAgentId),
      eq(subaccountAgents.organisationId, ctx.organisationId),
    ))
    .limit(1);

  const maxRiskTier: RiskTier = (saRow?.maxRiskTier ?? 3) as RiskTier;
  const allowedEnvironments = (saRow?.allowedEnvironments ?? ['api_tool', 'headless', 'browser']) as string[];
  const allowedSkillSlugs = (saRow?.allowedSkillSlugs ?? saRow?.skillSlugs ?? []) as string[];
  const controllerStyleAllowed = saRow?.controllerStyleAllowed ?? 'native_only';
  const capabilityMap = saRow?.capabilityMap ?? null;
  const saUpdatedAt = saRow?.updatedAt?.toISOString() ?? null;

  // Derive allowed controllers from governance column
  const allowedControllers: ControllerStyle[] =
    controllerStyleAllowed === 'native_and_operator' ? ['native', 'operator'] : ['native'];

  // Source 2: org/subaccount spending policies
  const spendingRows = await scopedDb
    .select({ policy: spendingPolicies })
    .from(spendingBudgets)
    .innerJoin(spendingPolicies, eq(spendingPolicies.spendingBudgetId, spendingBudgets.id))
    .where(
      and(
        eq(spendingBudgets.organisationId, ctx.organisationId),
        eq(spendingBudgets.subaccountId, ctx.subaccountId),
      ),
    );

  // Best-effort: pick the first active policy for cost cap; 0 = uncapped
  const activePolicySummary = spendingRows.map(r => ({
    id: r.policy.id,
    monthlyLimitMinor: r.policy.monthlyLimitMinor,
    version: r.policy.version,
  }));
  const maxCostCents = activePolicySummary.length > 0
    ? Math.max(0, activePolicySummary[0].monthlyLimitMinor)
    : 0;

  const spendingPoliciesVersion = activePolicySummary.length > 0
    ? computeSourceVersion({ ids: activePolicySummary.map(p => `${p.id}:${p.version}`) })
    : null;

  // Source 3: active policy rules
  const activeRules = await scopedDb
    .select({ id: policyRules.id, updatedAt: policyRules.updatedAt })
    .from(policyRules)
    .where(
      and(
        eq(policyRules.organisationId, ctx.organisationId),
        eq(policyRules.isActive, true),
      ),
    );

  const activePolicyRuleIds = activeRules.map(r => r.id);
  const activePolicyRulesVersion = activePolicyRuleIds.length > 0
    ? computeSourceVersion({
        ids: activeRules.map(r => `${r.id}:${r.updatedAt?.toISOString() ?? ''}`),
      })
    : null;

  // Source 4: available credentials via credentialBrokerService (chunk 5)
  const availableCredentials = await credentialBrokerService.resolveAvailableCredentials({
    organisationId: ctx.organisationId,
    subaccountId: ctx.subaccountId,
  });
  const availableCredentialIds = availableCredentials.map(c => c.credentialId);

  // Source 5: capability map (from subaccountAgents.capabilityMap)
  const allowedIntegrationSlugs = capabilityMap?.integrations ?? [];
  const capabilityMapVersion = capabilityMap?.computedAt
    ? computeSourceVersion({ computedAt: capabilityMap.computedAt })
    : null;

  // Source 6: controller limits from CONTROLLER_LIMITS[controllerStyle] (chunk 3)
  const controllerLimits = CONTROLLER_LIMITS[ctx.controllerStyle];

  // Derive approval gate defaults from maxRiskTier
  const riskTierApprovalDefaults = buildRiskTierApprovalDefaults(maxRiskTier);
  const requireApprovalAtTier = (saRow?.requireApprovalAtTier ?? 4) as RiskTier;
  const sendEmailGate: GateLevel =
    requireApprovalAtTier <= 3 ? 'review' : 'auto';
  const sendSlackGate: GateLevel =
    requireApprovalAtTier <= 3 ? 'review' : 'auto';
  const deployOrFundsGate: GateLevel =
    riskTierApprovalDefaults[6] ?? 'block';

  const subaccountAgentVersion = saUpdatedAt
    ? computeSourceVersion({ updatedAt: saUpdatedAt })
    : null;

  return assembleSnapshot({
    runId: ctx.runId,
    agentId: ctx.agentId,
    subaccountAgentId: ctx.subaccountAgentId,
    organisationId: ctx.organisationId,
    subaccountId: ctx.subaccountId,
    controllerStyle: ctx.controllerStyle,
    executionMode: ctx.executionMode,
    controllerLimits,
    allowedControllers,
    allowedEnvironments: allowedEnvironments as import('../../shared/types/executionEnvironment.js').ExecutionEnvironment[],
    allowedSkillSlugs,
    allowedIntegrationSlugs,
    maxRiskTier,
    tokenBudget: ctx.tokenBudget,
    maxToolCalls: ctx.maxToolCalls,
    maxCostCents,
    maxLlmCalls: controllerLimits.maxLoopIterations,
    sendEmailToClientGate: sendEmailGate,
    sendSlackToClientGate: sendSlackGate,
    deployOrFundsTransferGate: deployOrFundsGate,
    availableCredentialIds,
    activePolicyRuleIds,
    subaccountAgentVersion,
    spendingPoliciesVersion,
    activePolicyRulesVersion,
    capabilityMapVersion,
  });
}

// ── persist ───────────────────────────────────────────────────────────────────

/**
 * State-based UPDATE: sets policy_envelope_snapshot only if currently NULL (INV-9).
 * First-resolver-wins: if another process already set the snapshot, this is a no-op.
 * Throws PolicyEnvelopePersistFailedError only if both UPDATE and re-read fail.
 */
export async function persist(
  runId: string,
  snapshot: PolicyEnvelopeSnapshot,
): Promise<void> {
  // App-layer org filter required even with RLS (DEVELOPMENT_GUIDELINES §1).
  // The snapshot already encodes the run's organisationId; use it as the predicate.
  const organisationId = snapshot.organisationId;
  const scopedDb = getOrgScopedDb('policyEnvelopeResolver.persist');
  const updated = await scopedDb
    .update(agentRuns)
    .set({ policyEnvelopeSnapshot: snapshot })
    .where(and(
      eq(agentRuns.id, runId),
      eq(agentRuns.organisationId, organisationId),
      isNull(agentRuns.policyEnvelopeSnapshot),
    ))
    .returning({ id: agentRuns.id });

  if (updated.length > 0) {
    return;
  }

  // Zero rows updated — either another resolver won, or the row is missing.
  // Re-read to distinguish first-resolver-wins (ok) from true failure.
  const [existing] = await scopedDb
    .select({ policyEnvelopeSnapshot: agentRuns.policyEnvelopeSnapshot })
    .from(agentRuns)
    .where(and(
      eq(agentRuns.id, runId),
      eq(agentRuns.organisationId, organisationId),
    ))
    .limit(1);

  if (existing?.policyEnvelopeSnapshot != null) {
    return;
  }

  throw new PolicyEnvelopePersistFailedError(runId);
}
