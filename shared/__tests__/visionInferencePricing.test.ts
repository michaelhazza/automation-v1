import { describe, expect, it } from 'vitest';
import { computeCostCents, VISION_PRICING_RATES } from '../visionInferencePricing.js';

describe('computeCostCents', () => {
  // Test 1: ui-tars-7b with outputTokens: 0 — per-image 0.01 rounds to 0
  it('returns 0 for ui-tars-7b with outputTokens 0 (sub-cent per-image cost)', () => {
    const result = computeCostCents({
      modelId: 'ui-tars-7b',
      imageSizeBytes: 100_000,
      latencyMs: 1200,
      outputTokens: 0,
    });
    expect(result).toBe(0);
  });

  // Test 2: ui-tars-7b with outputTokens: 500_000
  // Math.round(0.01 + 500_000 * 0.00002) = Math.round(0.01 + 10) = Math.round(10.01) = 10
  it('returns 10 for ui-tars-7b with outputTokens 500_000', () => {
    const result = computeCostCents({
      modelId: 'ui-tars-7b',
      imageSizeBytes: 100_000,
      latencyMs: 1200,
      outputTokens: 500_000,
    });
    expect(result).toBe(10);
  });

  // Test 3: Math.round boundary
  // outputTokens 24500: 0.01 + 24500 * 0.00002 = 0.01 + 0.49 = 0.50 → Math.round(0.50) = 1
  // outputTokens 24000: 0.01 + 24000 * 0.00002 = 0.01 + 0.48 = 0.49 → Math.round(0.49) = 0
  it('rounds 0.5 up to 1 and 0.49 down to 0', () => {
    const atHalf = computeCostCents({
      modelId: 'ui-tars-7b',
      imageSizeBytes: 0,
      latencyMs: 0,
      outputTokens: 24_500,
    });
    expect(atHalf).toBe(1);

    const belowHalf = computeCostCents({
      modelId: 'ui-tars-7b',
      imageSizeBytes: 0,
      latencyMs: 0,
      outputTokens: 24_000,
    });
    expect(belowHalf).toBe(0);
  });

  // Test 4: unknown modelId throws with message containing the id
  it('throws Error containing the unknown modelId', () => {
    expect(() =>
      computeCostCents({
        modelId: 'gpt-5',
        imageSizeBytes: 0,
        latencyMs: 0,
        outputTokens: 100,
      }),
    ).toThrow('gpt-5');
  });

  // Test 5: sub-cent input returns 0
  // outputTokens: 1 → 0.01 + 1 * 0.00002 = 0.01002 → Math.round = 0
  it('returns 0 for sub-cent input (outputTokens 1)', () => {
    const result = computeCostCents({
      modelId: 'ui-tars-7b',
      imageSizeBytes: 0,
      latencyMs: 0,
      outputTokens: 1,
    });
    expect(result).toBe(0);
  });
});

describe('VISION_PRICING_RATES', () => {
  it('exposes ui-tars-7b with expected placeholder rates', () => {
    expect(VISION_PRICING_RATES['ui-tars-7b'].perImageCents).toBe(0.01);
    expect(VISION_PRICING_RATES['ui-tars-7b'].perOutputTokenCents).toBe(0.00002);
  });
});
