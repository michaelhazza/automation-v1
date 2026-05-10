/**
 * policyEngineService.riskTier.test.ts — Chunk 4 pure tests
 *
 * Spec: synthetos-foundation-refactor §7.6 scenarios 3, 4, 5
 *
 * Tests the pure risk-tier derivation and subaccount-constraint application
 * logic. Uses:
 *   - `deriveGateLevel` from shared/types/riskTier (pure function)
 *   - `applySubaccountConstraintsPure` from policyEngineServicePure (pure function)
 *
 * No DB, no Drizzle, no network.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/policyEngineService.riskTier.test.ts
 */

import { describe, expect, it } from 'vitest';
import { deriveGateLevel } from '../../../shared/types/riskTier.js';
import { applySubaccountConstraintsPure } from '../policyEngineServicePure.js';
import type { RiskTier } from '../../../shared/types/riskTier.js';

// ---------------------------------------------------------------------------
// Scenario 3 — tier-default block (spec §7.6 scenario 3)
// ---------------------------------------------------------------------------

describe('Scenario 3 — tier-default block', () => {
  it('tier 5 yields block via tier_default when no defaultGateLevel is set', () => {
    const riskTier: RiskTier = 5;
    const result = deriveGateLevel(riskTier, undefined, undefined);
    expect(result.gateLevel).toBe('block');
    expect(result.source).toBe('tier_default');
  });

  it('tier 6 yields block via tier_default', () => {
    const riskTier: RiskTier = 6;
    const result = deriveGateLevel(riskTier, undefined, undefined);
    expect(result.gateLevel).toBe('block');
    expect(result.source).toBe('tier_default');
  });

  it('tier 0 yields auto via tier_default', () => {
    const riskTier: RiskTier = 0;
    const result = deriveGateLevel(riskTier, undefined, undefined);
    expect(result.gateLevel).toBe('auto');
    expect(result.source).toBe('tier_default');
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — preserved-existing preservation (spec §7.6 scenario 4, INV-8)
// ---------------------------------------------------------------------------

describe('Scenario 4 — preserved-existing preservation (INV-8)', () => {
  it('existing defaultGateLevel review is preserved even when tier default would be auto', () => {
    // Tier 1 default = auto, but action has defaultGateLevel='review'
    const riskTier: RiskTier = 1;
    const result = deriveGateLevel(riskTier, 'review', undefined);
    expect(result.gateLevel).toBe('review');
    expect(result.source).toBe('preserved_existing');
  });

  it('existing defaultGateLevel auto is preserved even when tier default would be review', () => {
    // Tier 3 default = review, but action has defaultGateLevel='auto'
    const riskTier: RiskTier = 3;
    const result = deriveGateLevel(riskTier, 'auto', undefined);
    expect(result.gateLevel).toBe('auto');
    expect(result.source).toBe('preserved_existing');
  });

  it('policy_override wins over preserved_existing', () => {
    const riskTier: RiskTier = 1;
    const result = deriveGateLevel(riskTier, 'review', 'block');
    expect(result.gateLevel).toBe('block');
    expect(result.source).toBe('policy_override');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5a — max_risk_tier override-to-block (spec §7.6 scenario 5)
// ---------------------------------------------------------------------------

describe('Scenario 5a — max_risk_tier override-to-block', () => {
  it('riskTier > maxRiskTier forces block regardless of base decision', () => {
    const result = applySubaccountConstraintsPure(
      'auto',
      'tier_default',
      4,
      { maxRiskTier: 3, requireApprovalAtTier: 5 },
    );
    expect(result.decision).toBe('block');
    expect(result.gateLevelSource).toBe('subaccount_constraint');
  });

  it('riskTier > maxRiskTier overrides even an existing review decision', () => {
    const result = applySubaccountConstraintsPure(
      'review',
      'preserved_existing',
      5,
      { maxRiskTier: 3, requireApprovalAtTier: 4 },
    );
    expect(result.decision).toBe('block');
    expect(result.gateLevelSource).toBe('subaccount_constraint');
  });

  it('riskTier === maxRiskTier does NOT trigger block', () => {
    const result = applySubaccountConstraintsPure(
      'auto',
      'tier_default',
      3,
      { maxRiskTier: 3, requireApprovalAtTier: 5 },
    );
    expect(result.decision).toBe('auto');
    expect(result.gateLevelSource).toBe('tier_default');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5b — require_approval_at_tier upgrade-to-review (spec §7.6 scenario 5)
// ---------------------------------------------------------------------------

describe('Scenario 5b — require_approval_at_tier upgrade-to-review', () => {
  it('riskTier >= requireApprovalAtTier upgrades auto to review', () => {
    const result = applySubaccountConstraintsPure(
      'auto',
      'tier_default',
      4,
      { maxRiskTier: 6, requireApprovalAtTier: 4 },
    );
    expect(result.decision).toBe('review');
    expect(result.gateLevelSource).toBe('subaccount_constraint');
  });

  it('riskTier >= requireApprovalAtTier does NOT upgrade review (already review)', () => {
    const result = applySubaccountConstraintsPure(
      'review',
      'preserved_existing',
      4,
      { maxRiskTier: 6, requireApprovalAtTier: 4 },
    );
    expect(result.decision).toBe('review');
    expect(result.gateLevelSource).toBe('preserved_existing');
  });

  it('riskTier < requireApprovalAtTier does NOT upgrade auto', () => {
    const result = applySubaccountConstraintsPure(
      'auto',
      'tier_default',
      2,
      { maxRiskTier: 6, requireApprovalAtTier: 4 },
    );
    expect(result.decision).toBe('auto');
    expect(result.gateLevelSource).toBe('tier_default');
  });

  it('null governance passes through base decision unchanged', () => {
    const result = applySubaccountConstraintsPure(
      'auto',
      'tier_default',
      5,
      null,
    );
    expect(result.decision).toBe('auto');
    expect(result.gateLevelSource).toBe('tier_default');
  });

  it('undefined riskTier passes through base decision unchanged', () => {
    const result = applySubaccountConstraintsPure(
      'review',
      'preserved_existing',
      undefined,
      { maxRiskTier: 3, requireApprovalAtTier: 4 },
    );
    expect(result.decision).toBe('review');
    expect(result.gateLevelSource).toBe('preserved_existing');
  });
});
