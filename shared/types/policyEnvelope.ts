// Shared types for Policy Envelope snapshot (spec §4.5.4).
// Pure types only — no DB access, no service imports.

import type { ControllerStyle, ControllerLimits } from './controllerStyle.js';
import type { ExecutionEnvironment, ExecutionMode } from './executionEnvironment.js';
import type { RiskTier, GateLevel } from './riskTier.js';

export interface PolicyEnvelopeSnapshot {
  schemaVersion: 1;
  resolvedAt: string; // ISO8601

  // Identity context
  runId: string;
  agentId: string;
  subaccountAgentId: string | null;
  organisationId: string;
  subaccountId: string | null;

  // Style and capability
  controllerStyle: ControllerStyle;
  executionMode: ExecutionMode;
  controllerLimits: ControllerLimits; // resolved from CONTROLLER_LIMITS lookup

  // Permitted operations
  allowedControllers: ControllerStyle[];
  allowedEnvironments: ExecutionEnvironment[];
  allowedSkillSlugs: string[];
  allowedIntegrationSlugs: string[];

  // Risk constraints
  maxRiskTier: RiskTier;
  riskTierApprovalDefaults: Record<RiskTier, GateLevel>; // tier -> gateLevel default for this run

  // Budget constraints
  budgets: {
    tokenBudget: number;
    maxToolCalls: number;
    maxCostCents: number;
    maxLlmCalls: number;
  };

  // Approval requirements
  approvalDefaults: {
    sendEmailToClient: GateLevel;
    sendSlackToClient: GateLevel;
    deployOrFundsTransfer: GateLevel;
  };

  // Credential availability snapshot (id list, not material)
  availableCredentialIds: string[];

  // Active policy rules at run start (slugs only)
  activePolicyRuleIds: string[];

  // Source manifest for debugging and audit
  sources: {
    subaccountAgentVersion: string | null; // hash or updatedAt
    spendingPoliciesVersion: string | null;
    activePolicyRulesVersion: string | null;
    capabilityMapVersion: string | null;
  };
}
