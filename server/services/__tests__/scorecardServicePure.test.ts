import { describe, it, expect } from 'vitest';
import {
  compressSourcePill,
  resolveAttachAuthority,
  computeRegressionRisk,
  computeBenchComposite,
  applyVisibilityRules,
  assertAgentSubaccountMembership,
} from '../scorecardServicePure.js';
import type { Scorecard } from '../../db/schema/scorecards.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScorecard(overrides: Partial<Scorecard>): Scorecard {
  return {
    id: 'sc-1',
    organisationId: 'org-1',
    scopeType: 'org',
    scopeId: 'org-1',
    name: 'Test Scorecard',
    description: null,
    qualityChecks: [],
    shareWithSubaccounts: false,
    judgeModelId: null,
    inconclusiveAlertThreshold: '0.20',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

// ── compressSourcePill ────────────────────────────────────────────────────────

describe('compressSourcePill', () => {
  it('system × org_admin → system', () => {
    expect(compressSourcePill('system', 'org_admin')).toBe('system');
  });

  it('system × subaccount → platform', () => {
    expect(compressSourcePill('system', 'subaccount')).toBe('platform');
  });

  it('org × org_admin → organisation', () => {
    expect(compressSourcePill('org', 'org_admin')).toBe('organisation');
  });

  it('org × subaccount → custom', () => {
    expect(compressSourcePill('org', 'subaccount')).toBe('custom');
  });

  it('subaccount × org_admin → this_subaccount', () => {
    expect(compressSourcePill('subaccount', 'org_admin')).toBe('this_subaccount');
  });

  it('subaccount × subaccount → this_subaccount', () => {
    expect(compressSourcePill('subaccount', 'subaccount')).toBe('this_subaccount');
  });
});

// ── resolveAttachAuthority ────────────────────────────────────────────────────

describe('resolveAttachAuthority', () => {
  const base = {
    scorecardSlug: 'quality-check-v1',
    systemAgentDefaults: null,
    orgMandatorySlugs: [],
    agentTemplateDefaults: null,
    operatorChecked: false,
  };

  it('returns system_mandatory when slug in default_system_scorecard_slugs', () => {
    expect(resolveAttachAuthority({
      ...base,
      systemAgentDefaults: {
        default_system_scorecard_slugs: ['quality-check-v1'],
        default_org_scorecard_slugs: [],
      },
    })).toBe('system_mandatory');
  });

  it('returns org_mandatory when slug in orgMandatorySlugs (and not in system)', () => {
    expect(resolveAttachAuthority({
      ...base,
      orgMandatorySlugs: ['quality-check-v1'],
    })).toBe('org_mandatory');
  });

  it('system_mandatory wins over org_mandatory', () => {
    expect(resolveAttachAuthority({
      ...base,
      systemAgentDefaults: {
        default_system_scorecard_slugs: ['quality-check-v1'],
        default_org_scorecard_slugs: [],
      },
      orgMandatorySlugs: ['quality-check-v1'],
    })).toBe('system_mandatory');
  });

  it('returns suggested when slug is in agentTemplateDefaults only', () => {
    expect(resolveAttachAuthority({
      ...base,
      agentTemplateDefaults: ['quality-check-v1'],
    })).toBe('suggested');
  });

  it('returns suggested when operator manually attached', () => {
    expect(resolveAttachAuthority({ ...base, operatorChecked: true })).toBe('suggested');
  });

  it('returns suggested for a slug not in any list', () => {
    expect(resolveAttachAuthority(base)).toBe('suggested');
  });
});

// ── computeRegressionRisk ─────────────────────────────────────────────────────

describe('computeRegressionRisk', () => {
  it('low when variance < 0.05 and sampleCount >= 5', () => {
    expect(computeRegressionRisk(0.04, 5)).toBe('low');
    expect(computeRegressionRisk(0, 10)).toBe('low');
  });

  it('medium when variance < 0.05 but sampleCount < 5 (insufficient samples)', () => {
    expect(computeRegressionRisk(0.04, 4)).toBe('medium');
    expect(computeRegressionRisk(0.049, 0)).toBe('medium');
  });

  it('medium when 0.05 <= variance < 0.15', () => {
    expect(computeRegressionRisk(0.05, 10)).toBe('medium');
    expect(computeRegressionRisk(0.149, 10)).toBe('medium');
  });

  it('high when variance >= 0.15', () => {
    expect(computeRegressionRisk(0.15, 10)).toBe('high');
    expect(computeRegressionRisk(1.0, 100)).toBe('high');
  });

  it('high for negative variance (fail-closed)', () => {
    expect(computeRegressionRisk(-0.01, 10)).toBe('high');
  });

  it('high for NaN or Infinity (fail-closed)', () => {
    expect(computeRegressionRisk(NaN, 10)).toBe('high');
    expect(computeRegressionRisk(Infinity, 10)).toBe('high');
    expect(computeRegressionRisk(0.04, NaN)).toBe('high');
  });
});

// ── computeBenchComposite ─────────────────────────────────────────────────────

describe('computeBenchComposite', () => {
  it('returns null when no candidates', () => {
    const result = computeBenchComposite([]);
    expect(result.recommendedModelId).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it('returns null when all candidates fail pass marks', () => {
    const result = computeBenchComposite([
      { candidateModelId: 'model-a', passesAllPassMarks: false, regressionRisk: 'low', totalCostCents: 100 },
    ]);
    expect(result.recommendedModelId).toBeNull();
  });

  it('returns null when all qualifying candidates have high regression risk', () => {
    const result = computeBenchComposite([
      { candidateModelId: 'model-a', passesAllPassMarks: true, regressionRisk: 'high', totalCostCents: 100 },
    ]);
    expect(result.recommendedModelId).toBeNull();
  });

  it('picks cheapest qualifying candidate', () => {
    const result = computeBenchComposite([
      { candidateModelId: 'model-a', passesAllPassMarks: true, regressionRisk: 'low', totalCostCents: 200 },
      { candidateModelId: 'model-b', passesAllPassMarks: true, regressionRisk: 'medium', totalCostCents: 100 },
      { candidateModelId: 'model-c', passesAllPassMarks: false, regressionRisk: 'low', totalCostCents: 50 },
    ]);
    expect(result.recommendedModelId).toBe('model-b');
  });

  it('excludes high-risk candidates even if cheapest', () => {
    const result = computeBenchComposite([
      { candidateModelId: 'cheap-risky', passesAllPassMarks: true, regressionRisk: 'high', totalCostCents: 10 },
      { candidateModelId: 'pricey-safe', passesAllPassMarks: true, regressionRisk: 'low', totalCostCents: 500 },
    ]);
    expect(result.recommendedModelId).toBe('pricey-safe');
  });
});

// ── applyVisibilityRules ──────────────────────────────────────────────────────

describe('applyVisibilityRules', () => {
  const systemSc = makeScorecard({ id: 'sys-1', scopeType: 'system', scopeId: null, organisationId: null, shareWithSubaccounts: true });
  const systemScNoShare = makeScorecard({ id: 'sys-2', scopeType: 'system', scopeId: null, organisationId: null, shareWithSubaccounts: false });
  const orgSc = makeScorecard({ id: 'org-1', scopeType: 'org', scopeId: 'org-a', organisationId: 'org-a', shareWithSubaccounts: true });
  const orgScNoShare = makeScorecard({ id: 'org-2', scopeType: 'org', scopeId: 'org-a', organisationId: 'org-a', shareWithSubaccounts: false });
  const subSc = makeScorecard({ id: 'sub-1', scopeType: 'subaccount', scopeId: 'sub-x', organisationId: 'org-a' });
  const deletedSc = makeScorecard({ id: 'del-1', scopeType: 'org', scopeId: 'org-a', organisationId: 'org-a', deletedAt: new Date() });
  const allCards = [systemSc, systemScNoShare, orgSc, orgScNoShare, subSc, deletedSc];

  it('system_admin sees all scorecards (including system-scope and deleted)', () => {
    const result = applyVisibilityRules({
      scorecards: allCards,
      viewerScope: 'system_admin',
      viewerOrgId: null,
      viewerSubaccountId: null,
    });
    expect(result).toHaveLength(6);
  });

  it('org_admin sees system, own org, and own org subaccount cards (not deleted)', () => {
    const result = applyVisibilityRules({
      scorecards: allCards,
      viewerScope: 'org_admin',
      viewerOrgId: 'org-a',
      viewerSubaccountId: null,
    });
    const ids = result.map(sc => sc.id);
    expect(ids).toContain('sys-1');
    expect(ids).toContain('sys-2');  // org_admin sees all system rows regardless of share flag
    expect(ids).toContain('org-1');
    expect(ids).toContain('org-2');
    expect(ids).toContain('sub-1');
    expect(ids).not.toContain('del-1');
  });

  it('subaccount sees system with shareWithSubaccounts=true, org with shareWithSubaccounts=true, own subaccount', () => {
    const result = applyVisibilityRules({
      scorecards: allCards,
      viewerScope: 'subaccount',
      viewerOrgId: 'org-a',
      viewerSubaccountId: 'sub-x',
    });
    const ids = result.map(sc => sc.id);
    expect(ids).toContain('sys-1');
    expect(ids).not.toContain('sys-2');  // not shared
    expect(ids).toContain('org-1');
    expect(ids).not.toContain('org-2');  // not shared
    expect(ids).toContain('sub-1');
    expect(ids).not.toContain('del-1');
  });

  it('subaccount cannot see another subaccount scorecard', () => {
    const otherSubSc = makeScorecard({ id: 'sub-other', scopeType: 'subaccount', scopeId: 'sub-y', organisationId: 'org-a' });
    const result = applyVisibilityRules({
      scorecards: [otherSubSc],
      viewerScope: 'subaccount',
      viewerOrgId: 'org-a',
      viewerSubaccountId: 'sub-x',
    });
    expect(result).toHaveLength(0);
  });

  it('org_admin cannot see another org scorecard', () => {
    const otherOrgSc = makeScorecard({ id: 'org-other', scopeType: 'org', scopeId: 'org-b', organisationId: 'org-b' });
    const result = applyVisibilityRules({
      scorecards: [otherOrgSc],
      viewerScope: 'org_admin',
      viewerOrgId: 'org-a',
      viewerSubaccountId: null,
    });
    expect(result).toHaveLength(0);
  });
});

// ── assertAgentSubaccountMembership (S-3 cross-subaccount IDOR guard) ─────────

describe('assertAgentSubaccountMembership', () => {
  it('returns ok when an active link exists', () => {
    expect(assertAgentSubaccountMembership({ hasActiveLink: true })).toBe('ok');
  });

  it('returns agent_not_in_subaccount when no link exists', () => {
    expect(assertAgentSubaccountMembership({ hasActiveLink: false })).toBe(
      'agent_not_in_subaccount',
    );
  });

  it('does not leak whether the agent exists elsewhere in the org', () => {
    // The verdict shape is binary — there is no "not found" verdict that could
    // leak the agent's existence in another subaccount. Both the "agent does
    // not exist" and "agent exists in subaccount B" paths funnel into the same
    // 403 AGENT_NOT_IN_SUBACCOUNT response.
    expect(assertAgentSubaccountMembership({ hasActiveLink: false })).not.toBe('not_found');
  });
});
