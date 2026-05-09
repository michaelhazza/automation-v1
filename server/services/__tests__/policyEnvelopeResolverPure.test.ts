import { describe, it, expect } from 'vitest';
import {
  buildRiskTierApprovalDefaults,
  computeSourceVersion,
  assembleSnapshot,
} from '../policyEnvelopeResolverPure.js';
import type { RiskTier } from '../../../shared/types/riskTier.js';

// ── buildRiskTierApprovalDefaults ─────────────────────────────────────────────

describe('buildRiskTierApprovalDefaults', () => {
  it('returns all auto when maxRiskTier is 6', () => {
    const result = buildRiskTierApprovalDefaults(6);
    expect(result[0]).toBe('auto');
    expect(result[1]).toBe('auto');
    expect(result[2]).toBe('auto');
    expect(result[3]).toBe('auto');
    expect(result[4]).toBe('auto');
    expect(result[5]).toBe('auto');
    expect(result[6]).toBe('review');
  });

  it('returns all block when maxRiskTier is 0', () => {
    const result = buildRiskTierApprovalDefaults(0);
    expect(result[0]).toBe('review');
    expect(result[1]).toBe('block');
    expect(result[2]).toBe('block');
    expect(result[3]).toBe('block');
    expect(result[4]).toBe('block');
    expect(result[5]).toBe('block');
    expect(result[6]).toBe('block');
  });

  it('uses review at maxRiskTier=3 and block above', () => {
    const result = buildRiskTierApprovalDefaults(3);
    expect(result[0]).toBe('auto');
    expect(result[1]).toBe('auto');
    expect(result[2]).toBe('auto');
    expect(result[3]).toBe('review');
    expect(result[4]).toBe('block');
    expect(result[5]).toBe('block');
    expect(result[6]).toBe('block');
  });

  it('uses review at maxRiskTier=4', () => {
    const result = buildRiskTierApprovalDefaults(4);
    expect(result[0]).toBe('auto');
    expect(result[1]).toBe('auto');
    expect(result[2]).toBe('auto');
    expect(result[3]).toBe('auto');
    expect(result[4]).toBe('review');
    expect(result[5]).toBe('block');
    expect(result[6]).toBe('block');
  });

  it('covers all 7 tiers for each maxRiskTier value', () => {
    const tiers: RiskTier[] = [0, 1, 2, 3, 4, 5, 6];
    for (const max of tiers) {
      const result = buildRiskTierApprovalDefaults(max);
      expect(Object.keys(result)).toHaveLength(7);
      for (const t of tiers) {
        if (t < max) expect(result[t]).toBe('auto');
        else if (t === max) expect(result[t]).toBe('review');
        else expect(result[t]).toBe('block');
      }
    }
  });
});

// ── computeSourceVersion ──────────────────────────────────────────────────────

describe('computeSourceVersion', () => {
  it('same inputs produce same hash', () => {
    const a = computeSourceVersion({ foo: 'bar', count: 1 });
    const b = computeSourceVersion({ foo: 'bar', count: 1 });
    expect(a).toBe(b);
  });

  it('different inputs produce different hashes', () => {
    const a = computeSourceVersion({ foo: 'bar' });
    const b = computeSourceVersion({ foo: 'baz' });
    expect(a).not.toBe(b);
  });

  it('key order does not affect the hash (deterministic)', () => {
    const a = computeSourceVersion({ foo: 'bar', z: 1, a: 2 });
    const b = computeSourceVersion({ z: 1, a: 2, foo: 'bar' });
    expect(a).toBe(b);
  });

  it('empty object produces consistent hash', () => {
    const a = computeSourceVersion({});
    const b = computeSourceVersion({});
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });
});

// ── assembleSnapshot ─────────────────────────────────────────────────────────

describe('assembleSnapshot', () => {
  const baseInputs = {
    runId: 'run-1',
    agentId: 'agent-1',
    subaccountAgentId: 'sa-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    controllerStyle: 'native' as const,
    executionMode: 'api' as const,
    controllerLimits: {
      maxLoopIterations: 25,
      defaultTokenBudgetMultiplier: 1.0,
      maxToolCallsPerRun: 20,
      approvalDefault: 'auto' as const,
    },
    allowedControllers: ['native'] as import('../../../shared/types/controllerStyle.js').ControllerStyle[],
    allowedEnvironments: ['api_tool', 'headless'] as import('../../../shared/types/executionEnvironment.js').ExecutionEnvironment[],
    allowedSkillSlugs: ['email', 'calendar'],
    allowedIntegrationSlugs: ['gmail'],
    maxRiskTier: 3 as RiskTier,
    tokenBudget: 30000,
    maxToolCalls: 20,
    maxCostCents: 5000,
    maxLlmCalls: 25,
    sendEmailToClientGate: 'auto' as const,
    sendSlackToClientGate: 'auto' as const,
    deployOrFundsTransferGate: 'block' as const,
    availableCredentialIds: ['cred-1', 'cred-2'],
    activePolicyRuleIds: ['rule-1'],
    subaccountAgentVersion: 'abc123',
    spendingPoliciesVersion: 'def456',
    activePolicyRulesVersion: 'ghi789',
    capabilityMapVersion: 'jkl012',
  };

  it('sets schemaVersion to 1', () => {
    const snap = assembleSnapshot(baseInputs);
    expect(snap.schemaVersion).toBe(1);
  });

  it('populates identity fields correctly', () => {
    const snap = assembleSnapshot(baseInputs);
    expect(snap.runId).toBe('run-1');
    expect(snap.agentId).toBe('agent-1');
    expect(snap.subaccountAgentId).toBe('sa-1');
    expect(snap.organisationId).toBe('org-1');
    expect(snap.subaccountId).toBe('sub-1');
  });

  it('derives riskTierApprovalDefaults from maxRiskTier', () => {
    const snap = assembleSnapshot(baseInputs);
    expect(snap.riskTierApprovalDefaults[0]).toBe('auto');
    expect(snap.riskTierApprovalDefaults[3]).toBe('review');
    expect(snap.riskTierApprovalDefaults[4]).toBe('block');
  });

  it('includes budgets from inputs', () => {
    const snap = assembleSnapshot(baseInputs);
    expect(snap.budgets.tokenBudget).toBe(30000);
    expect(snap.budgets.maxToolCalls).toBe(20);
    expect(snap.budgets.maxCostCents).toBe(5000);
    expect(snap.budgets.maxLlmCalls).toBe(25);
  });

  it('includes approval defaults from inputs', () => {
    const snap = assembleSnapshot(baseInputs);
    expect(snap.approvalDefaults.sendEmailToClient).toBe('auto');
    expect(snap.approvalDefaults.sendSlackToClient).toBe('auto');
    expect(snap.approvalDefaults.deployOrFundsTransfer).toBe('block');
  });

  it('includes sources manifest', () => {
    const snap = assembleSnapshot(baseInputs);
    expect(snap.sources.subaccountAgentVersion).toBe('abc123');
    expect(snap.sources.spendingPoliciesVersion).toBe('def456');
    expect(snap.sources.activePolicyRulesVersion).toBe('ghi789');
    expect(snap.sources.capabilityMapVersion).toBe('jkl012');
  });

  it('resolvedAt is a valid ISO8601 string', () => {
    const snap = assembleSnapshot(baseInputs);
    expect(() => new Date(snap.resolvedAt)).not.toThrow();
    expect(new Date(snap.resolvedAt).toISOString()).toBe(snap.resolvedAt);
  });

  it('tolerates null versions in sources', () => {
    const snap = assembleSnapshot({
      ...baseInputs,
      subaccountAgentVersion: null,
      spendingPoliciesVersion: null,
      activePolicyRulesVersion: null,
      capabilityMapVersion: null,
    });
    expect(snap.sources.subaccountAgentVersion).toBeNull();
    expect(snap.sources.spendingPoliciesVersion).toBeNull();
    expect(snap.sources.activePolicyRulesVersion).toBeNull();
    expect(snap.sources.capabilityMapVersion).toBeNull();
  });
});
