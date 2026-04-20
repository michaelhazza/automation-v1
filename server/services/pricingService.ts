import { db } from '../db/index.js';
import { llmPricing, orgMarginConfigs } from '../db/schema/index.js';
import { and, gte, isNull, lte, or } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { env } from '../lib/env.js';
import type { SourceType } from '../db/schema/llmRequests.js';

// ---------------------------------------------------------------------------
// Failsafe pricing — used when DB is unavailable on cache miss.
// Always the most expensive known rate per model — never undercharge.
// ---------------------------------------------------------------------------

const FAILSAFE_PRICING: Record<string, { inputRate: number; outputRate: number }> = {
  'anthropic:claude-opus-4-6':   { inputRate: 0.015,    outputRate: 0.075    },
  'anthropic:claude-sonnet-4-6': { inputRate: 0.003,    outputRate: 0.015    },
  'anthropic:claude-haiku-4-5':  { inputRate: 0.00025,  outputRate: 0.00125  },
  'openai:gpt-4o':               { inputRate: 0.0025,   outputRate: 0.01     },
  'openai:gpt-4o-mini':          { inputRate: 0.00015,  outputRate: 0.0006   },
  'gemini:gemini-2.0-flash':     { inputRate: 0.0001,   outputRate: 0.0004   },
  'gemini:gemini-2.5-flash':     { inputRate: 0.0003,   outputRate: 0.0025   },
  'gemini:gemini-2.5-flash-lite': { inputRate: 0.0001,  outputRate: 0.0004   },
  'openrouter:deepseek/deepseek-v3':            { inputRate: 0.00027, outputRate: 0.0011  },
  'openrouter:arcee-ai/trinity-large-thinking': { inputRate: 0.0003,  outputRate: 0.0009  },
  'openrouter:anthropic/claude-sonnet-4-6':     { inputRate: 0.003,   outputRate: 0.015   },
  '__default__':                 { inputRate: 0.015,    outputRate: 0.075    },
};

// ---------------------------------------------------------------------------
// Cache read discount multipliers by provider
// Applied to cached input tokens — reduces effective input cost.
// ---------------------------------------------------------------------------

export const CACHE_READ_MULTIPLIERS: Record<string, number> = {
  anthropic:  0.10,   // 90% discount on cached tokens
  openai:     0.50,   // 50% discount (automatic caching)
  gemini:     0.25,   // 75% discount
  openrouter: 1.00,   // no caching through OpenRouter
};

// ---------------------------------------------------------------------------
// In-process caches — 1 hour TTL
// ---------------------------------------------------------------------------

interface PricingCache {
  data: { inputRate: number; outputRate: number };
  expiresAt: number;
}

interface MarginCache {
  data: { multiplier: number; fixedFeeCents: number };
  expiresAt: number;
}

const pricingCache = new Map<string, PricingCache>();
const marginCache = new Map<string, MarginCache>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Pricing lookup
// ---------------------------------------------------------------------------

export async function getPricing(
  provider: string,
  model: string,
): Promise<{ inputRate: number; outputRate: number }> {
  const cacheKey = `${provider}:${model}`;
  const cached = pricingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const now = new Date();
    const [row] = await db
      .select()
      .from(llmPricing)
      .where(
        and(
          eq(llmPricing.provider, provider),
          eq(llmPricing.model, model),
          lte(llmPricing.effectiveFrom, now),
          or(isNull(llmPricing.effectiveTo), gte(llmPricing.effectiveTo!, now)),
        ),
      )
      .orderBy(llmPricing.effectiveFrom)
      .limit(1);

    if (!row) {
      console.warn(`[pricingService] No pricing row for ${cacheKey}, using failsafe`);
      return FAILSAFE_PRICING[cacheKey] ?? FAILSAFE_PRICING['__default__'];
    }

    const data = {
      inputRate:  parseFloat(row.inputRate),
      outputRate: parseFloat(row.outputRate),
    };

    pricingCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    console.warn(`[pricingService] DB unavailable for pricing lookup ${cacheKey}, using failsafe`);
    return FAILSAFE_PRICING[cacheKey] ?? FAILSAFE_PRICING['__default__'];
  }
}

// ---------------------------------------------------------------------------
// Margin resolution — org override wins over platform default
// ---------------------------------------------------------------------------

export async function getMargin(
  orgId: string,
): Promise<{ multiplier: number; fixedFeeCents: number }> {
  const cached = marginCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    // Try org-specific override first
    const [orgRow] = await db
      .select()
      .from(orgMarginConfigs)
      .where(eq(orgMarginConfigs.organisationId, orgId))
      .orderBy(orgMarginConfigs.effectiveFrom)
      .limit(1);

    if (orgRow) {
      const data = {
        multiplier:     parseFloat(orgRow.marginMultiplier),
        fixedFeeCents:  orgRow.fixedFeeCents,
      };
      marginCache.set(orgId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    }

    // Fall back to platform default (null organisation_id)
    const [defaultRow] = await db
      .select()
      .from(orgMarginConfigs)
      .where(isNull(orgMarginConfigs.organisationId))
      .limit(1);

    const data = defaultRow
      ? { multiplier: parseFloat(defaultRow.marginMultiplier), fixedFeeCents: defaultRow.fixedFeeCents }
      : { multiplier: env.PLATFORM_MARGIN_MULTIPLIER, fixedFeeCents: 0 };

    marginCache.set(orgId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    console.warn(`[pricingService] DB unavailable for margin lookup orgId=${orgId}, using env default`);
    return { multiplier: env.PLATFORM_MARGIN_MULTIPLIER, fixedFeeCents: 0 };
  }
}

// ---------------------------------------------------------------------------
// Cost calculation
// costWithMargin = (costRaw * multiplier) + (fixedFeeCents / 100)
// ---------------------------------------------------------------------------

export interface CostResult {
  costRaw:             number;
  costWithMargin:      number;
  costWithMarginCents: number;
  marginMultiplier:    number;
  fixedFeeCents:       number;
}

export async function calculateCost(
  provider: string,
  model:    string,
  tokensIn: number,
  tokensOut: number,
  orgId:    string,
  cachedPromptTokens: number = 0,
  sourceType: SourceType | undefined = undefined,
): Promise<CostResult> {
  const [pricing, margin] = await Promise.all([
    getPricing(provider, model),
    resolveMargin(orgId, sourceType),
  ]);

  const cacheMultiplier = CACHE_READ_MULTIPLIERS[provider] ?? 1.0;
  const uncachedIn = tokensIn - cachedPromptTokens;
  const costRaw =
    (uncachedIn / 1000) * pricing.inputRate +
    (cachedPromptTokens / 1000) * pricing.inputRate * cacheMultiplier +
    (tokensOut / 1000) * pricing.outputRate;

  const costWithMargin =
    costRaw * margin.multiplier + margin.fixedFeeCents / 100;

  return {
    costRaw,
    costWithMargin,
    costWithMarginCents: Math.round(costWithMargin * 100),
    marginMultiplier:    margin.multiplier,
    fixedFeeCents:       margin.fixedFeeCents,
  };
}

// ---------------------------------------------------------------------------
// Margin resolver — spec §7.4
//
// Returns { multiplier, fixedFeeCents } for a call context. System-level and
// analyzer work is internal cost (not a billable line), so margin collapses
// to 1.0× with no fixed fee. Billable sourceTypes fall through to the
// org-scoped `getMargin()` lookup.
//
// This is the single source of truth for margin policy. Future extensions
// (per-agent overrides, promotional pricing, partner splits) add branches
// here rather than in the router — the router consumes the verdict.
//
// `resolveMarginMultiplier()` is the narrower public contract per spec
// §19.11 — it returns the multiplier alone. `resolveMargin()` is the
// internal wrapper used by `calculateCost()` which needs both fields.
// ---------------------------------------------------------------------------

async function resolveMargin(
  orgId: string,
  sourceType: SourceType | undefined,
): Promise<{ multiplier: number; fixedFeeCents: number }> {
  if (sourceType === 'system' || sourceType === 'analyzer') {
    return { multiplier: 1.0, fixedFeeCents: 0 };
  }
  return await getMargin(orgId);
}

export async function resolveMarginMultiplier(
  ctx: { organisationId: string; sourceType?: SourceType },
): Promise<number> {
  const margin = await resolveMargin(ctx.organisationId, ctx.sourceType);
  return margin.multiplier;
}

// ---------------------------------------------------------------------------
// Estimate cost before the call (uses maxTokensPerRequest as upper bound)
// ---------------------------------------------------------------------------

export async function estimateCost(
  provider:           string,
  model:              string,
  maxTokensPerRequest: number,
  orgId:              string,
): Promise<number> {
  // Conservative: assume all tokens are output (higher rate)
  const pricing = await getPricing(provider, model);
  const margin  = await getMargin(orgId);
  const worstCaseRaw = (maxTokensPerRequest / 1000) * pricing.outputRate;
  const worstCaseWithMargin = worstCaseRaw * margin.multiplier + margin.fixedFeeCents / 100;
  return Math.round(worstCaseWithMargin * 100); // cents
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

export function invalidatePricingCache(provider?: string, model?: string): void {
  if (provider && model) {
    pricingCache.delete(`${provider}:${model}`);
  } else {
    pricingCache.clear();
  }
}

export function invalidateMarginCache(orgId?: string): void {
  if (orgId) {
    marginCache.delete(orgId);
  } else {
    marginCache.clear();
  }
}

export const pricingService = {
  getPricing,
  getMargin,
  resolveMarginMultiplier,
  calculateCost,
  estimateCost,
  invalidatePricingCache,
  invalidateMarginCache,
};
