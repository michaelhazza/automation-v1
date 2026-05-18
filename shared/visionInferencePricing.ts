export type VisionPricingModelId = 'ui-tars-7b';

export interface VisionPricingRate {
  /** Per-image inference cost in cents (float; rounded at computeCostCents). */
  perImageCents: number;
  /** Per-output-token cost in cents (float; rounded at computeCostCents). */
  perOutputTokenCents: number;
}

export const VISION_PRICING_RATES: Readonly<Record<VisionPricingModelId, VisionPricingRate>> = {
  // RunPod managed vLLM placeholder rates — NOT PRODUCTION BILLING AUTHORITATIVE.
  // Replace with actual RunPod GPU instance rates before shipping the full
  // harness wiring (follow-up build, spec §13). These placeholder values are
  // acceptable in V1 only because the harness is a stub and no real inference
  // costs are incurred. Spec §8.4 placeholder behaviour contract; §16 resolved
  // decision #1.
  'ui-tars-7b': { perImageCents: 0.01, perOutputTokenCents: 0.00002 },
} as const;

export interface ComputeCostCentsInput {
  modelId: string;
  imageSizeBytes: number;   // reserved for tiered-pricing extensions; unused in V1
  latencyMs: number;        // reserved for surcharge tiers; unused in V1
  outputTokens: number;
}

/**
 * Compute integer-cent cost for one vision inference call.
 *
 * Throws if modelId is not in VISION_PRICING_RATES (never silently returns 0).
 * Sub-cent results round to 0 (floor of 0 is acceptable in V1; floor of 1 is a
 * deferred option — spec §13).
 * Negative outputTokens are not guarded in V1; the formula produces a
 * non-positive value which rounds to 0 or below.
 *
 * Spec §8.4 placeholder behaviour contract.
 */
export function computeCostCents(input: ComputeCostCentsInput): number {
  const rates = (VISION_PRICING_RATES as Record<string, VisionPricingRate>)[input.modelId];
  if (!rates) {
    throw new Error(`Unknown vision model: ${input.modelId}`);
  }
  const raw = rates.perImageCents + input.outputTokens * rates.perOutputTokenCents;
  return Math.round(raw);
}
