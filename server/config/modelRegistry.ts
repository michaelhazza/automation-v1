// ---------------------------------------------------------------------------
// Model Registry — static source of truth for available models and capabilities.
// Not a DB table. Changes with code deploys. Models change infrequently.
// ---------------------------------------------------------------------------

import type { CapabilityTier } from '../db/schema/llmRequests.js';

export type ToolCallingReliability = 'stable' | 'experimental' | 'none';

export interface ModelCapability {
  provider:               string;
  model:                  string;
  tier:                   CapabilityTier;
  toolCallingReliability: ToolCallingReliability;
  maxContextTokens:       number;
  supportsPromptCaching:  boolean;
  deprecationDate?:       string;   // ISO date — triggers startup warning within 30 days
  approxInputCostPer1K:   number;   // $ per 1K tokens (sorting only — billing uses pricingService)
  approxOutputCostPer1K:  number;
}

// ── Frontier models (used for planning + synthesis) ─────────────────────────

const FRONTIER_MODELS: ModelCapability[] = [
  {
    provider: 'anthropic', model: 'claude-opus-4-6', tier: 'frontier',
    toolCallingReliability: 'stable', maxContextTokens: 200000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.015, approxOutputCostPer1K: 0.075,
  },
  {
    provider: 'anthropic', model: 'claude-sonnet-4-6', tier: 'frontier',
    toolCallingReliability: 'stable', maxContextTokens: 200000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.003, approxOutputCostPer1K: 0.015,
  },
  {
    provider: 'openai', model: 'gpt-4o', tier: 'frontier',
    toolCallingReliability: 'stable', maxContextTokens: 128000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.0025, approxOutputCostPer1K: 0.01,
  },
];

// ── Economy models (used for execution phase) ───────────────────────────────

const ECONOMY_MODELS: ModelCapability[] = [
  {
    provider: 'gemini', model: 'gemini-2.5-flash-lite', tier: 'economy',
    toolCallingReliability: 'stable', maxContextTokens: 1000000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.0001, approxOutputCostPer1K: 0.0004,
  },
  {
    provider: 'openai', model: 'gpt-4o-mini', tier: 'economy',
    toolCallingReliability: 'experimental', maxContextTokens: 128000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.00015, approxOutputCostPer1K: 0.0006,
  },
  {
    provider: 'gemini', model: 'gemini-2.5-flash', tier: 'economy',
    toolCallingReliability: 'stable', maxContextTokens: 1000000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.0003, approxOutputCostPer1K: 0.0025,
  },
  {
    provider: 'anthropic', model: 'claude-haiku-4-5', tier: 'economy',
    toolCallingReliability: 'stable', maxContextTokens: 200000,
    supportsPromptCaching: true,
    approxInputCostPer1K: 0.001, approxOutputCostPer1K: 0.005,
  },
  {
    provider: 'openrouter', model: 'deepseek/deepseek-v3', tier: 'economy',
    toolCallingReliability: 'stable', maxContextTokens: 128000,
    supportsPromptCaching: false,
    approxInputCostPer1K: 0.00027, approxOutputCostPer1K: 0.0011,
  },
  {
    provider: 'openrouter', model: 'arcee-ai/trinity-large-thinking', tier: 'economy',
    toolCallingReliability: 'experimental', maxContextTokens: 128000,
    supportsPromptCaching: false,
    approxInputCostPer1K: 0.0003, approxOutputCostPer1K: 0.0009,
  },
];

// ── Public API ──────────────────────────────────────────────────────────────

export function getEconomyModels(): ModelCapability[] {
  return [...ECONOMY_MODELS];
}

export function getFrontierModels(): ModelCapability[] {
  return [...FRONTIER_MODELS];
}

export function getAllModels(): ModelCapability[] {
  return [...FRONTIER_MODELS, ...ECONOMY_MODELS];
}

export function getModelsForProvider(provider: string): ModelCapability[] {
  return getAllModels().filter(m => m.provider === provider);
}

// ── Deprecation check (call on server boot) ─────────────────────────────────

export function checkModelDeprecations(): void {
  const now = new Date();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  for (const model of getAllModels()) {
    if (!model.deprecationDate) continue;
    const deprecation = new Date(model.deprecationDate);
    const daysUntil = Math.ceil((deprecation.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    if (deprecation.getTime() <= now.getTime()) {
      console.error(`[modelRegistry] DEPRECATED: ${model.provider}/${model.model} passed deprecation date ${model.deprecationDate}`);
    } else if (deprecation.getTime() - now.getTime() <= thirtyDays) {
      console.warn(`[modelRegistry] WARNING: ${model.provider}/${model.model} deprecates in ${daysUntil} days (${model.deprecationDate})`);
    }
  }
}
