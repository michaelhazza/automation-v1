import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSelectWhere } = vi.hoisted(() => {
  const mockSelectWhere = vi.fn().mockReturnValue({
    orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
  });
  return { mockSelectWhere };
});

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockSelectWhere,
      }),
    }),
  },
}));

vi.mock('../../../../server/db/schema/index.js', () => ({
  llmPricing: {
    provider: 'provider',
    model: 'model',
    effectiveFrom: 'effectiveFrom',
    effectiveTo: 'effectiveTo',
  },
  orgMarginConfigs: {
    organisationId: 'organisationId',
    marginMultiplier: 'marginMultiplier',
    fixedFeeCents: 'fixedFeeCents',
    effectiveFrom: 'effectiveFrom',
  },
}));

vi.mock('../../../../server/lib/env.js', () => ({
  env: { PLATFORM_MARGIN_MULTIPLIER: 1.3 },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  gte: vi.fn((...args: unknown[]) => args),
  lte: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((arg: unknown) => arg),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  calculateCost,
  estimateCost,
  getMargin,
  getPricing,
  invalidatePricingCache,
  invalidateMarginCache,
} from '../../../../server/services/pricingService.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pricingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear internal caches before each test
    invalidatePricingCache();
    invalidateMarginCache();
  });

  describe('getPricing', () => {
    it('returns DB pricing when row exists', async () => {
      mockSelectWhere.mockReturnValueOnce({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ inputRate: '0.005', outputRate: '0.02' }]),
        }),
      });

      const result = await getPricing('anthropic', 'claude-sonnet-4-6');
      expect(result).toEqual({ inputRate: 0.005, outputRate: 0.02 });
    });

    it('returns failsafe pricing when no DB row found', async () => {
      mockSelectWhere.mockReturnValueOnce({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await getPricing('anthropic', 'claude-sonnet-4-6');
      expect(result).toEqual({ inputRate: 0.003, outputRate: 0.015 });
    });

    it('returns default failsafe for unknown models', async () => {
      mockSelectWhere.mockReturnValueOnce({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await getPricing('unknown', 'unknown-model');
      // Falls back to __default__ failsafe
      expect(result).toEqual({ inputRate: 0.015, outputRate: 0.075 });
    });

    it('returns failsafe when DB throws', async () => {
      mockSelectWhere.mockReturnValueOnce({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error('DB down')),
        }),
      });

      const result = await getPricing('openai', 'gpt-4o');
      expect(result).toEqual({ inputRate: 0.0025, outputRate: 0.01 });
    });

    it('caches pricing and returns cached value on second call', async () => {
      mockSelectWhere.mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ inputRate: '0.001', outputRate: '0.002' }]),
        }),
      });

      const first = await getPricing('test', 'model');
      const second = await getPricing('test', 'model');

      expect(first).toEqual(second);
      // DB should only be hit once (second is from cache)
      expect(mockSelectWhere).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMargin', () => {
    it('returns org-specific margin when override exists', async () => {
      mockSelectWhere.mockReturnValueOnce({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{
            marginMultiplier: '1.5',
            fixedFeeCents: 10,
          }]),
        }),
      });

      const result = await getMargin('org-1');
      expect(result).toEqual({ multiplier: 1.5, fixedFeeCents: 10 });
    });

    it('returns platform default when no org override exists', async () => {
      // First call: org-specific query returns empty
      mockSelectWhere
        .mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        })
        // Second call: default (null org) query returns empty too
        .mockReturnValueOnce({
          limit: vi.fn().mockResolvedValue([]),
        });

      const result = await getMargin('org-2');
      // Falls back to env.PLATFORM_MARGIN_MULTIPLIER
      expect(result).toEqual({ multiplier: 1.3, fixedFeeCents: 0 });
    });

    it('returns env default when DB throws', async () => {
      mockSelectWhere.mockReturnValueOnce({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error('DB down')),
        }),
      });

      const result = await getMargin('org-3');
      expect(result).toEqual({ multiplier: 1.3, fixedFeeCents: 0 });
    });
  });

  describe('calculateCost', () => {
    it('computes correct cost for a model call', async () => {
      // Mock pricing: inputRate=0.003, outputRate=0.015
      mockSelectWhere.mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ inputRate: '0.003', outputRate: '0.015' }]),
        }),
      });

      // Clear margin cache too and mock margin
      invalidateMarginCache();
      mockSelectWhere
        .mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ inputRate: '0.003', outputRate: '0.015' }]),
          }),
        })
        .mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ marginMultiplier: '1.0', fixedFeeCents: 0 }]),
          }),
        });

      const result = await calculateCost('anthropic', 'claude-sonnet-4-6', 1000, 500, 'org-1');

      // costRaw = (1000/1000)*0.003 + (500/1000)*0.015 = 0.003 + 0.0075 = 0.0105
      expect(result.costRaw).toBeCloseTo(0.0105, 4);
      expect(result.marginMultiplier).toBe(1.0);
      expect(result.costWithMarginCents).toBeGreaterThanOrEqual(0);
    });

    it('includes margin in costWithMargin', async () => {
      invalidatePricingCache();
      invalidateMarginCache();

      mockSelectWhere
        .mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ inputRate: '0.01', outputRate: '0.01' }]),
          }),
        })
        .mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ marginMultiplier: '2.0', fixedFeeCents: 100 }]),
          }),
        });

      const result = await calculateCost('test', 'model', 1000, 1000, 'org-1');

      // costRaw = (1000/1000)*0.01 + (1000/1000)*0.01 = 0.02
      // costWithMargin = 0.02 * 2.0 + 100/100 = 0.04 + 1.0 = 1.04
      expect(result.costRaw).toBeCloseTo(0.02, 4);
      expect(result.costWithMargin).toBeCloseTo(1.04, 4);
      expect(result.fixedFeeCents).toBe(100);
    });
  });

  describe('estimateCost', () => {
    it('returns estimate in cents using worst-case (all output)', async () => {
      invalidatePricingCache();
      invalidateMarginCache();

      mockSelectWhere
        .mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ inputRate: '0.001', outputRate: '0.01' }]),
          }),
        })
        .mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ marginMultiplier: '1.0', fixedFeeCents: 0 }]),
          }),
        });

      const result = await estimateCost('test', 'model', 4096, 'org-1');

      // worstCaseRaw = (4096/1000) * 0.01 = 0.04096
      // worstCaseWithMargin = 0.04096 * 1.0 + 0 = 0.04096
      // cents = Math.round(0.04096 * 100) = 4
      expect(result).toBe(4);
    });
  });

  describe('cache invalidation', () => {
    it('invalidatePricingCache clears specific key', async () => {
      mockSelectWhere.mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ inputRate: '0.001', outputRate: '0.002' }]),
        }),
      });

      await getPricing('test', 'model');
      invalidatePricingCache('test', 'model');

      // After invalidation, next call should hit DB again
      await getPricing('test', 'model');
      expect(mockSelectWhere).toHaveBeenCalledTimes(2);
    });
  });
});
