import { routeCall } from './llmRouter.js';
import { withBackoff } from '../lib/withBackoff.js';
import {
  deriveCacheKey,
  validateSuggestionResponse,
  type SuggestionResult,
} from './skillRuntimeCheckSuggestionServicePure.js';
import { logger } from '../lib/logger.js';

// ── In-process TTL cache ─────────────────────────────────────────────────────
// Phase 1: in-process Map. No persistence across server restarts.
// Phase 2+: consider a shared cache_kv table for multi-instance deployments.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheEntry {
  result: SuggestionResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// ── Constants ─────────────────────────────────────────────────────────────────

const SUGGESTION_TIMEOUT_MS = 8_000;
const MIN_DESCRIPTION_LENGTH = 20;

// ── suggestRuntimeCheck ───────────────────────────────────────────────────────

export async function suggestRuntimeCheck(input: {
  description: string;
  apiSpec?: string;
  organisationId: string;
  subaccountId?: string | null;
}): Promise<SuggestionResult> {
  const { description, apiSpec, organisationId, subaccountId } = input;

  if (description.length < MIN_DESCRIPTION_LENGTH) {
    throw {
      statusCode: 422,
      message: 'description must be at least 20 characters',
      errorCode: 'DESCRIPTION_TOO_SHORT',
    };
  }

  const cacheKey = deriveCacheKey(description, apiSpec);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.result, cacheHit: true };
  }

  const prompt = buildPrompt(description, apiSpec);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort('caller_timeout'), SUGGESTION_TIMEOUT_MS);

  let rawContent: string;
  try {
    const response = await withBackoff(
      () =>
        routeCall({
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 512,
          abortSignal: abortController.signal,
          context: {
            organisationId,
            subaccountId: subaccountId ?? undefined,
            sourceType: 'system',
            agentName: 'skill-suggestion',
            taskType: 'general',
            featureTag: 'skill-runtime-check-suggestion',
          },
        }),
      {
        label: 'skill-runtime-check-suggestion',
        maxAttempts: 3,
        baseDelayMs: 500,
        isRetryable: (err: unknown) => {
          if (abortController.signal.aborted) return false;
          if (err !== null && typeof err === 'object') {
            const e = err as { statusCode?: number };
            // Do not retry on client errors
            if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) return false;
          }
          return true;
        },
        correlationId: cacheKey,
        runId: organisationId,
      },
    );
    rawContent = typeof response.content === 'string' ? response.content.trim() : '';
  } catch (err) {
    logger.warn('skillRuntimeCheckSuggestionService.llm_call_failed', {
      organisationId,
      error: String(err),
    });
    throw {
      statusCode: 503,
      message: 'Runtime check suggestion unavailable',
      errorCode: 'SUGGESTION_UNAVAILABLE',
    };
  } finally {
    clearTimeout(timeoutId);
  }

  const parsed = parseJsonSafe(rawContent);
  const result = validateSuggestionResponse(parsed);
  if (!result) {
    logger.warn('skillRuntimeCheckSuggestionService.invalid_response', {
      organisationId,
      rawContent: rawContent.slice(0, 500),
    });
    throw {
      statusCode: 503,
      message: 'Runtime check suggestion unavailable',
      errorCode: 'SUGGESTION_UNAVAILABLE',
    };
  }

  cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });

  return { ...result, cacheHit: false };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPrompt(description: string, apiSpec?: string): string {
  const apiSpecSection = apiSpec
    ? `\n\nAPI specification:\n${apiSpec}`
    : '';

  return `You are a runtime-check advisor for an automation platform. Given a skill description, suggest the best deterministic runtime check that can verify the skill executed correctly.

Skill description: ${description}${apiSpecSection}

Respond with ONLY a JSON object (no markdown fences, no preamble) with this exact shape:
{
  "name": "<short human-readable name for the check>",
  "blastRadius": "<one of: self, tenant, external>",
  "reversible": <true or false>,
  "suggestedCheck": {
    "kind": "<one of: api_status_2xx, row_exists, field_match, external_returns, custom_handler>",
    "parameters": { <kind-specific parameters> }
  },
  "plainEnglish": "<one sentence describing what the check verifies>"
}

Blast radius definitions:
- self: affects only the data of the immediate caller (e.g. local computation)
- tenant: affects data within the organisation (e.g. database writes)
- external: calls external APIs or services that may have real-world side effects

Choose the most specific check kind that applies. For external API calls, prefer api_status_2xx. For database writes, prefer row_exists. For field verification, prefer field_match.`;
}

function parseJsonSafe(text: string): unknown {
  try {
    // Strip markdown fences if the LLM includes them despite instructions
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
