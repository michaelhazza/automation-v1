// Pure helpers for Policy Envelope resolver (spec §4.5.5).
// No DB access, no side effects — all inputs come from callers.

import { createHash } from 'crypto';
import type { PolicyEnvelopeSnapshot } from '../../shared/types/policyEnvelope.js';
import type { RiskTier, GateLevel } from '../../shared/types/riskTier.js';
import { RISK_TIERS } from '../../shared/types/riskTier.js';
import type { ControllerStyle, ControllerLimits } from '../../shared/types/controllerStyle.js';
import type { ExecutionEnvironment, ExecutionMode } from '../../shared/types/executionEnvironment.js';

// ── buildRiskTierApprovalDefaults ─────────────────────────────────────────────

/**
 * For a given maxRiskTier, map each risk tier 0–6 to its GateLevel:
 *   - tiers > maxRiskTier → 'block'
 *   - tiers === maxRiskTier → 'review'
 *   - tiers < maxRiskTier → 'auto'
 */
export function buildRiskTierApprovalDefaults(
  maxRiskTier: RiskTier,
): Record<RiskTier, GateLevel> {
  const result = {} as Record<RiskTier, GateLevel>;
  for (const tier of RISK_TIERS) {
    if (tier > maxRiskTier) {
      result[tier] = 'block';
    } else if (tier === maxRiskTier) {
      result[tier] = 'review';
    } else {
      result[tier] = 'auto';
    }
  }
  return result;
}

// ── computeSourceVersion ──────────────────────────────────────────────────────

/**
 * Deterministic hash of a set of source objects.
 * Same inputs always produce the same output; different inputs produce different outputs.
 */
export function computeSourceVersion(sources: Record<string, unknown>): string {
  const stable = JSON.stringify(sources, Object.keys(sources).sort());
  return createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

// ── assembleSnapshot ─────────────────────────────────────────────────────────

export interface AssembleSnapshotInputs {
  runId: string;
  agentId: string;
  subaccountAgentId: string | null;
  organisationId: string;
  subaccountId: string | null;
  controllerStyle: ControllerStyle;
  executionMode: ExecutionMode;
  controllerLimits: ControllerLimits;
  allowedControllers: ControllerStyle[];
  allowedEnvironments: ExecutionEnvironment[];
  allowedSkillSlugs: string[];
  allowedIntegrationSlugs: string[];
  maxRiskTier: RiskTier;
  tokenBudget: number;
  maxToolCalls: number;
  maxCostCents: number;
  maxLlmCalls: number;
  sendEmailToClientGate: GateLevel;
  sendSlackToClientGate: GateLevel;
  deployOrFundsTransferGate: GateLevel;
  availableCredentialIds: string[];
  activePolicyRuleIds: string[];
  subaccountAgentVersion: string | null;
  spendingPoliciesVersion: string | null;
  activePolicyRulesVersion: string | null;
  capabilityMapVersion: string | null;
}

/**
 * Compose the v1 PolicyEnvelopeSnapshot from collected inputs.
 */
export function assembleSnapshot(inputs: AssembleSnapshotInputs): PolicyEnvelopeSnapshot {
  const riskTierApprovalDefaults = buildRiskTierApprovalDefaults(inputs.maxRiskTier);

  return {
    schemaVersion: 1,
    resolvedAt: new Date().toISOString(),

    runId: inputs.runId,
    agentId: inputs.agentId,
    subaccountAgentId: inputs.subaccountAgentId,
    organisationId: inputs.organisationId,
    subaccountId: inputs.subaccountId,

    controllerStyle: inputs.controllerStyle,
    executionMode: inputs.executionMode,
    controllerLimits: inputs.controllerLimits,

    allowedControllers: inputs.allowedControllers,
    allowedEnvironments: inputs.allowedEnvironments,
    allowedSkillSlugs: inputs.allowedSkillSlugs,
    allowedIntegrationSlugs: inputs.allowedIntegrationSlugs,

    maxRiskTier: inputs.maxRiskTier,
    riskTierApprovalDefaults,

    budgets: {
      tokenBudget: inputs.tokenBudget,
      maxToolCalls: inputs.maxToolCalls,
      maxCostCents: inputs.maxCostCents,
      maxLlmCalls: inputs.maxLlmCalls,
    },

    approvalDefaults: {
      sendEmailToClient: inputs.sendEmailToClientGate,
      sendSlackToClient: inputs.sendSlackToClientGate,
      deployOrFundsTransfer: inputs.deployOrFundsTransferGate,
    },

    availableCredentialIds: inputs.availableCredentialIds,
    activePolicyRuleIds: inputs.activePolicyRuleIds,

    sources: {
      subaccountAgentVersion: inputs.subaccountAgentVersion,
      spendingPoliciesVersion: inputs.spendingPoliciesVersion,
      activePolicyRulesVersion: inputs.activePolicyRulesVersion,
      capabilityMapVersion: inputs.capabilityMapVersion,
    },
  };
}
