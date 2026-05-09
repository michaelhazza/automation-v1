import { describe, it, expect } from 'vitest';
import type { PolicyEnvelopeSnapshot } from '../policyEnvelope.js';

// Builds a minimal valid PolicyEnvelopeSnapshot for type-level tests.
function makeSnapshot(overrides?: Partial<PolicyEnvelopeSnapshot>): PolicyEnvelopeSnapshot {
  const base: PolicyEnvelopeSnapshot = {
    schemaVersion: 1,
    resolvedAt: '2026-05-09T12:00:00.000Z',
    runId: 'run-abc',
    agentId: 'agent-abc',
    subaccountAgentId: null,
    organisationId: 'org-abc',
    subaccountId: null,
    controllerStyle: 'native',
    executionMode: 'api',
    controllerLimits: {
      maxLoopIterations: 25,
      defaultTokenBudgetMultiplier: 1.0,
      maxToolCallsPerRun: 20,
      approvalDefault: 'auto',
    },
    allowedControllers: ['native'],
    allowedEnvironments: ['api_tool'],
    allowedSkillSlugs: [],
    allowedIntegrationSlugs: [],
    maxRiskTier: 3,
    riskTierApprovalDefaults: {
      0: 'auto',
      1: 'auto',
      2: 'auto',
      3: 'review',
      4: 'review',
      5: 'block',
      6: 'block',
    },
    budgets: {
      tokenBudget: 100000,
      maxToolCalls: 20,
      maxCostCents: 500,
      maxLlmCalls: 10,
    },
    approvalDefaults: {
      sendEmailToClient: 'review',
      sendSlackToClient: 'auto',
      deployOrFundsTransfer: 'block',
    },
    availableCredentialIds: [],
    activePolicyRuleIds: [],
    sources: {
      subaccountAgentVersion: null,
      spendingPoliciesVersion: null,
      activePolicyRulesVersion: null,
      capabilityMapVersion: null,
    },
    ...overrides,
  };
  return base;
}

describe('policyEnvelope', () => {
  describe('schemaVersion', () => {
    it('is pinned to the literal 1', () => {
      const snapshot = makeSnapshot();
      expect(snapshot.schemaVersion).toBe(1);
    });

    it('schemaVersion 1 satisfies the type constraint', () => {
      const snapshot = makeSnapshot();
      const version: 1 = snapshot.schemaVersion;
      expect(version).toBe(1);
    });
  });

  describe('required-field presence', () => {
    it('has all required identity fields', () => {
      const snapshot = makeSnapshot({ runId: 'r1', agentId: 'a1', organisationId: 'o1' });
      expect(snapshot.runId).toBe('r1');
      expect(snapshot.agentId).toBe('a1');
      expect(snapshot.organisationId).toBe('o1');
    });

    it('allows null subaccountAgentId and subaccountId', () => {
      const snapshot = makeSnapshot({ subaccountAgentId: null, subaccountId: null });
      expect(snapshot.subaccountAgentId).toBeNull();
      expect(snapshot.subaccountId).toBeNull();
    });

    it('accepts non-null subaccountAgentId and subaccountId', () => {
      const snapshot = makeSnapshot({
        subaccountAgentId: 'sa-1',
        subaccountId: 'sub-1',
      });
      expect(snapshot.subaccountAgentId).toBe('sa-1');
      expect(snapshot.subaccountId).toBe('sub-1');
    });

    it('has budgets with all four fields', () => {
      const snapshot = makeSnapshot();
      expect(snapshot.budgets.tokenBudget).toBeDefined();
      expect(snapshot.budgets.maxToolCalls).toBeDefined();
      expect(snapshot.budgets.maxCostCents).toBeDefined();
      expect(snapshot.budgets.maxLlmCalls).toBeDefined();
    });

    it('has approvalDefaults with three required fields', () => {
      const snapshot = makeSnapshot();
      expect(snapshot.approvalDefaults.sendEmailToClient).toBeDefined();
      expect(snapshot.approvalDefaults.sendSlackToClient).toBeDefined();
      expect(snapshot.approvalDefaults.deployOrFundsTransfer).toBeDefined();
    });

    it('has sources object with four version fields', () => {
      const snapshot = makeSnapshot();
      expect('subaccountAgentVersion' in snapshot.sources).toBe(true);
      expect('spendingPoliciesVersion' in snapshot.sources).toBe(true);
      expect('activePolicyRulesVersion' in snapshot.sources).toBe(true);
      expect('capabilityMapVersion' in snapshot.sources).toBe(true);
    });

    it('riskTierApprovalDefaults covers all 7 risk tiers', () => {
      const snapshot = makeSnapshot();
      for (let tier = 0; tier <= 6; tier++) {
        expect(snapshot.riskTierApprovalDefaults[tier as 0 | 1 | 2 | 3 | 4 | 5 | 6]).toBeDefined();
      }
    });
  });

  describe('resolvedAt field', () => {
    it('is an ISO8601 string', () => {
      const snapshot = makeSnapshot({ resolvedAt: '2026-05-09T12:00:00.000Z' });
      expect(new Date(snapshot.resolvedAt).toISOString()).toBe('2026-05-09T12:00:00.000Z');
    });
  });
});
