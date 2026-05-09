// Shared types for Risk Tier (spec §4.2.4).
// Pure types and pure derivation function only — no DB access.

export const RISK_TIERS = [0, 1, 2, 3, 4, 5, 6] as const;

export type RiskTier = (typeof RISK_TIERS)[number];

export type GateLevel = 'auto' | 'review' | 'block';

// Tier-to-GateLevel defaults (spec §4.2.3 rubric).
// Tiers 0-2: auto (low risk, no approval needed)
// Tiers 3-4: review (medium risk, operator review)
// Tiers 5-6: block (high risk, blocked by default unless policy overrides)
const TIER_DEFAULTS: Record<RiskTier, GateLevel> = {
  0: 'auto',
  1: 'auto',
  2: 'auto',
  3: 'review',
  4: 'review',
  5: 'block',
  6: 'block',
};

export interface DeriveGateLevelResult {
  gateLevel: GateLevel;
  source: 'policy_override' | 'preserved_existing' | 'tier_default';
}

// INV-8: existing gateLevel is preserved when set unless a policy override takes precedence.
// Source union at this chunk: 'policy_override' | 'preserved_existing' | 'tier_default'
// ('subaccount_constraint' is added in chunk 4 at policyEngineService layer).
export function deriveGateLevel(
  riskTier: RiskTier,
  preservedExisting?: GateLevel,
  policyOverride?: GateLevel,
): DeriveGateLevelResult {
  if (policyOverride !== undefined) {
    return { gateLevel: policyOverride, source: 'policy_override' };
  }
  if (preservedExisting !== undefined) {
    return { gateLevel: preservedExisting, source: 'preserved_existing' };
  }
  return { gateLevel: TIER_DEFAULTS[riskTier], source: 'tier_default' };
}
