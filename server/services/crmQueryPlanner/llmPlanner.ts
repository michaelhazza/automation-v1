// LLM Planner — Stage 3 orchestration (spec §10)
// Calls llmRouter.routeCall with the assembled prompt, handles escalation
// (single retry at elevated tier on low confidence or hybrid detection),
// returns a validated DraftQueryPlan.

import { z } from 'zod';
import { routeCall } from '../llmRouter.js';
import { ParseFailureError } from '../../lib/parseFailureError.js';
import { buildPrompt, extractSystemAndUser } from './llmPlannerPromptPure.js';
import { getSchemaContextText } from './schemaContextService.js';
import { systemSettingsService, SETTING_KEYS } from '../systemSettingsService.js';
import type {
  NormalisedIntent,
  DraftQueryPlan,
  CanonicalQueryRegistry,
} from '../../../shared/types/crmQueryPlanner.js';
import type { ProviderResponse } from '../providers/types.js';

// ── DraftQueryPlanSchema (Zod) ─────────────────────────────────────────────

const QueryFilterSchema = z.object({
  field:      z.string(),
  operator:   z.enum(['eq','ne','in','nin','gt','gte','lt','lte','contains','starts_with','is_null','is_not_null','between']),
  value:      z.unknown(),
  humanLabel: z.string(),
});

export const DraftQueryPlanSchema = z.object({
  source:              z.enum(['canonical','live','hybrid']),
  intentClass:         z.enum(['list_entities','count_entities','aggregate','lookup','trend_request','segment_request','unsupported']),
  primaryEntity:       z.enum(['contacts','opportunities','appointments','conversations','revenue','tasks']),
  relatedEntities:     z.array(z.enum(['contacts','opportunities','appointments','conversations','revenue','tasks'])).optional(),
  filters:             z.array(QueryFilterSchema).default([]),
  sort:                z.array(z.object({ field: z.string(), direction: z.enum(['asc','desc']) })).optional(),
  limit:               z.number().int().min(1).max(500).default(50),
  projection:          z.array(z.string()).optional(),
  aggregation:         z.object({
    type:    z.enum(['count','sum','avg','group_by']),
    field:   z.string().optional(),
    groupBy: z.array(z.string()).optional(),
  }).optional(),
  dateContext:         z.object({
    kind:        z.enum(['relative','absolute']),
    from:        z.string().optional(),
    to:          z.string().optional(),
    description: z.string().optional(),
  }).optional(),
  canonicalCandidateKey: z.string().nullable().default(null),
  confidence:          z.number().min(0).max(1),
  hybridPattern:       z.literal('canonical_base_with_live_filter').optional(),
  clarificationNeeded: z.boolean().optional(),
  clarificationPrompt: z.string().optional(),
});

// ── Config loading ─────────────────────────────────────────────────────────

interface PlannerConfig {
  defaultModel:          string;
  escalationModel:       string;
  confidenceThreshold:   number;
  schemaTokensDefault:   number;
  schemaTokensEscalated: number;
}

async function loadPlannerConfig(): Promise<PlannerConfig> {
  const [
    defaultModel,
    escalationModel,
    confidenceThresholdStr,
    schemaTokensDefaultStr,
    schemaTokensEscalatedStr,
  ] = await Promise.all([
    systemSettingsService.get(SETTING_KEYS.CRM_QUERY_PLANNER_DEFAULT_TIER),
    systemSettingsService.get(SETTING_KEYS.CRM_QUERY_PLANNER_ESCALATION_TIER),
    systemSettingsService.get(SETTING_KEYS.CRM_QUERY_PLANNER_CONFIDENCE_THRESHOLD),
    systemSettingsService.get(SETTING_KEYS.CRM_QUERY_PLANNER_SCHEMA_TOKENS_DEFAULT),
    systemSettingsService.get(SETTING_KEYS.CRM_QUERY_PLANNER_SCHEMA_TOKENS_ESCALATED),
  ]);
  return {
    defaultModel:          defaultModel  || 'claude-haiku-4-5',
    escalationModel:       escalationModel || 'claude-sonnet-4-6',
    confidenceThreshold:   parseFloat(confidenceThresholdStr)  || 0.6,
    schemaTokensDefault:   parseInt(schemaTokensDefaultStr)  || 2000,
    schemaTokensEscalated: parseInt(schemaTokensEscalatedStr) || 4000,
  };
}

// ── Hybrid detection heuristic ────────────────────────────────────────────

function detectLikelyHybrid(intent: NormalisedIntent, registry: CanonicalQueryRegistry): boolean {
  // Simple heuristic: intent tokens reference both a canonical-known entity
  // AND a live-only-signalling term.
  const liveSignals = new Set(['custom','tag','label','field','note','unread','pipeline','calendar','type']);
  const hasLiveSignal = intent.tokens.some(t => liveSignals.has(t));
  const knownEntities = new Set(Object.values(registry).map(e => e.primaryEntity));
  const hasKnownEntity = intent.tokens.some(t => (knownEntities as Set<string>).has(t));
  return hasLiveSignal && hasKnownEntity;
}

// ── Single LLM call ────────────────────────────────────────────────────────

interface LlmCallInput {
  intent:        NormalisedIntent;
  registry:      CanonicalQueryRegistry;
  organisationId: string;
  subaccountId:  string;
  runId?:        string;
  model:         string;
  tokenBudget:   number;
  abortSignal?:  AbortSignal;
}

interface LlmCallOutput {
  draft:   DraftQueryPlan;
  usage:   { inputTokens: number; outputTokens: number; model: string };
  latencyMs: number;
}

async function singleLlmCall(input: LlmCallInput): Promise<LlmCallOutput> {
  const { intent, registry, organisationId, subaccountId, runId, model, tokenBudget, abortSignal } = input;

  const schemaContextText = getSchemaContextText({ subaccountId, intent, tokenBudget });
  const messages = buildPrompt({ intent, registry, schemaContextText });
  const { system, user } = extractSystemAndUser(messages);

  const started = Date.now();
  let response: ProviderResponse;
  let parsedDraft: DraftQueryPlan | null = null;

  response = await routeCall({
    messages: [{ role: 'user', content: user }],
    system,
    context: {
      organisationId,
      subaccountId,
      runId,
      sourceType:         'system',
      taskType:           'crm_query_planner',
      featureTag:         'crm-query-planner',
      model,
      systemCallerPolicy: 'bypass_routing',
    },
    abortSignal,
    postProcess: (content: string) => {
      try {
        // Strip markdown fences if present
        const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        parsedDraft = DraftQueryPlanSchema.parse(JSON.parse(cleaned));
      } catch (err) {
        throw new ParseFailureError({
          rawExcerpt: content.slice(0, 200),
          message: `DraftQueryPlan parse failed: ${(err as Error).message}`,
        });
      }
    },
  });

  const latencyMs = Date.now() - started;

  if (!parsedDraft) {
    // postProcess ran — parse from raw content (postProcess already validated shape)
    const cleaned = response.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    parsedDraft = DraftQueryPlanSchema.parse(JSON.parse(cleaned));
  }

  return {
    draft: parsedDraft!,
    usage: { inputTokens: response.tokensIn, outputTokens: response.tokensOut, model },
    latencyMs,
  };
}

// ── Main export ────────────────────────────────────────────────────────────

export interface RunLlmStage3Input {
  intent:         NormalisedIntent;
  registry:       CanonicalQueryRegistry;
  organisationId: string;
  subaccountId:   string;
  runId?:         string;
  abortSignal?:   AbortSignal;
}

export interface RunLlmStage3Output {
  draft:   DraftQueryPlan;
  // Cost data for per-query ceiling check + cost attribution
  defaultTierUsage?:    { inputTokens: number; outputTokens: number; model: string };
  escalationTierUsage?: { inputTokens: number; outputTokens: number; model: string };
  escalated:    boolean;
  escalationReason?: 'low_confidence' | 'hybrid_detected' | 'large_schema';
  defaultTierLatencyMs?:    number;
  escalationTierLatencyMs?: number;
}

export async function runLlmStage3(input: RunLlmStage3Input): Promise<RunLlmStage3Output> {
  const { intent, registry, organisationId, subaccountId, runId, abortSignal } = input;
  const config = await loadPlannerConfig();

  // Check hybrid heuristic first — skip default tier if likely hybrid
  if (detectLikelyHybrid(intent, registry)) {
    const result = await singleLlmCall({
      intent, registry, organisationId, subaccountId, runId,
      model:       config.escalationModel,
      tokenBudget: config.schemaTokensEscalated,
      abortSignal,
    });
    return {
      draft:                  result.draft,
      escalationTierUsage:    result.usage,
      escalated:              true,
      escalationReason:       'hybrid_detected',
      escalationTierLatencyMs: result.latencyMs,
    };
  }

  // Default tier call
  const defaultResult = await singleLlmCall({
    intent, registry, organisationId, subaccountId, runId,
    model:       config.defaultModel,
    tokenBudget: config.schemaTokensDefault,
    abortSignal,
  });

  // If confidence is sufficient, return immediately
  if (defaultResult.draft.confidence >= config.confidenceThreshold) {
    return {
      draft:               defaultResult.draft,
      defaultTierUsage:    defaultResult.usage,
      escalated:           false,
      defaultTierLatencyMs: defaultResult.latencyMs,
    };
  }

  // Escalate — single retry at elevated tier (spec §10.4 — never a loop)
  const escalationResult = await singleLlmCall({
    intent, registry, organisationId, subaccountId, runId,
    model:       config.escalationModel,
    tokenBudget: config.schemaTokensEscalated,
    abortSignal,
  });

  return {
    draft:                  escalationResult.draft,
    defaultTierUsage:       defaultResult.usage,
    escalationTierUsage:    escalationResult.usage,
    escalated:              true,
    escalationReason:       'low_confidence',
    defaultTierLatencyMs:   defaultResult.latencyMs,
    escalationTierLatencyMs: escalationResult.latencyMs,
  };
}
