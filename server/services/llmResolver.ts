// ---------------------------------------------------------------------------
// LLM Resolver — maps execution phases to capability tiers to provider+model.
//
// Pure, synchronous, deterministic. No DB calls, no LLM calls, no side effects.
// The router calls this before every LLM invocation.
// ---------------------------------------------------------------------------

import type { TaskType, ExecutionPhase, CapabilityTier, RoutingMode, RoutingReason } from '../db/schema/index.js';
import { getEconomyModels } from '../config/modelRegistry.js';
import type { ToolCallingReliability } from '../config/modelRegistry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolveLLMParams {
  phase:       ExecutionPhase;
  taskType:    TaskType;
  ceiling?:    { provider: string; model: string };
  mode:        RoutingMode;
  constraints?: {
    requiresToolCalling?:      boolean;
    requiresStructuredOutput?: boolean;
    estimatedContextTokens?:   number;
    expectedMaxOutputTokens?:  number;
  };
}

export interface ResolveLLMResult {
  provider:      string;
  model:         string;
  tier:          CapabilityTier;
  wasDowngraded: boolean;
  reason:        RoutingReason;
}

// ---------------------------------------------------------------------------
// Reliability sort order — stable preferred over experimental
// ---------------------------------------------------------------------------

const RELIABILITY_ORDER: Record<ToolCallingReliability, number> = {
  stable: 0,
  experimental: 1,
  none: 2,
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export function resolveLLM(params: ResolveLLMParams): ResolveLLMResult {
  const { phase, ceiling, mode, constraints } = params;

  // ── 1. Forced mode — skip all routing ──────────────────────────────
  if (mode === 'forced' && ceiling) {
    return {
      provider: ceiling.provider,
      model:    ceiling.model,
      tier:     'frontier',
      wasDowngraded: false,
      reason: 'forced',
    };
  }

  // ── 2. Determine required tier ─────────────────────────────────────
  const tier: CapabilityTier = phase === 'execution' ? 'economy' : 'frontier';

  // ── 3. If frontier, return ceiling directly ────────────────────────
  if (tier === 'frontier' && ceiling) {
    return {
      provider: ceiling.provider,
      model:    ceiling.model,
      tier:     'frontier',
      wasDowngraded: false,
      reason: 'ceiling',
    };
  }

  // ── 4. Economy tier — find cheapest capable model ──────────────────
  let candidates = getEconomyModels();

  // Filter: tool-calling capability (stable or experimental, exclude 'none')
  if (constraints?.requiresToolCalling) {
    candidates = candidates.filter(m => m.toolCallingReliability !== 'none');
  }

  // Filter: context window — candidate must fit accumulated context + expected output
  const estimatedContext = constraints?.estimatedContextTokens ?? 0;
  const expectedOutput = constraints?.expectedMaxOutputTokens ?? 4096;
  if (estimatedContext > 0) {
    const requiredWindow = estimatedContext + expectedOutput;
    candidates = candidates.filter(m => m.maxContextTokens >= requiredWindow);
  }

  // Sort by cost (cheapest first — output rate dominates total cost)
  // Within same cost band, prefer 'stable' tool calling over 'experimental'
  candidates.sort((a, b) => {
    const costDiff = a.approxOutputCostPer1K - b.approxOutputCostPer1K;
    if (Math.abs(costDiff) > 0.0001) return costDiff;
    return RELIABILITY_ORDER[a.toolCallingReliability] - RELIABILITY_ORDER[b.toolCallingReliability];
  });

  // ── 5. Safety fallback — if no candidates, use ceiling ────────────
  if (candidates.length === 0) {
    return {
      provider: ceiling?.provider ?? 'anthropic',
      model:    ceiling?.model ?? 'claude-sonnet-4-6',
      tier:     'frontier',
      wasDowngraded: false,
      reason: 'fallback',
    };
  }

  // ── 6. Return cheapest candidate ──────────────────────────────────
  const selected = candidates[0];

  console.debug(`[resolver] phase=${phase} → ${selected.provider}/${selected.model} (reason=economy)`);

  return {
    provider:      selected.provider,
    model:         selected.model,
    tier:          'economy',
    wasDowngraded: true,
    reason:        'economy',
  };
}
