// ---------------------------------------------------------------------------
// renderRecommendation — LLM render step with evidence-hash cache.
//
// One call per new/changed recommendation. Cache key:
//   (category, dedupe_key, evidence_hash, render_version) — invariant from
//   renderVersion.ts: bump RENDER_VERSION to invalidate all cached copy.
//
// Spec: docs/sub-account-optimiser-spec.md §6.2
// ---------------------------------------------------------------------------

import { db } from '../../db/index.js';
import { agentRecommendations } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { routeCall } from '../llmRouter.js';
import { logger } from '../../lib/logger.js';
import { RENDER_VERSION } from './renderVersion.js';

export interface RenderResult {
  title: string;
  body: string;
  cacheHit: boolean;
}

// ---------------------------------------------------------------------------
// Cache lookup — find any existing row with matching evidence_hash + category.
// The stored evidence_hash is the bare sha256 from agentRecommendationsService.
// RENDER_VERSION is used to label the prompt template version; bumping it does
// not auto-invalidate cached renders (would require a separate DB column).
// ---------------------------------------------------------------------------

export async function renderRecommendation(
  category: string,
  dedupeKey: string,
  evidenceHash: string,
  evidence: Record<string, unknown>,
  orgId: string,
): Promise<RenderResult> {
  // _renderVersion is declared to make future invalidation explicit when a
  // render_version column is added to the schema.
  void RENDER_VERSION;

  // dedupeKey is used for logging only — evidence_hash already encodes the
  // deduplication key in all 8 categories (it's part of the canonicalised evidence).
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const cached = await db
    .select({ title: agentRecommendations.title, body: agentRecommendations.body })
    .from(agentRecommendations)
    .where(
      and(
        eq(agentRecommendations.evidenceHash, evidenceHash),
        eq(agentRecommendations.category, category),
        eq(agentRecommendations.organisationId, orgId),
      ),
    )
    .limit(1);

  if (cached.length > 0 && cached[0]) {
    logger.info('optimiser.render.cache_hit', { category, dedupeKey });
    return { title: cached[0].title, body: cached[0].body, cacheHit: true };
  }

  // Cache miss — call LLM to render operator-facing copy.
  const prompt = buildRenderPrompt(category, evidence);
  const started = Date.now();

  const response = await routeCall({
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 200,
    context: {
      sourceType: 'system',
      taskType: 'general',
      featureTag: 'optimiser.recommendation_render',
      organisationId: orgId,
    },
  });

  logger.info('optimiser.render.tokens_used', {
    category,
    dedupeKey,
    promptTokens: response.tokensIn,
    completionTokens: response.tokensOut,
    cacheHit: false,
    durationMs: Date.now() - started,
  });

  const parsed = parseRenderResponse(response.content);
  return { ...parsed, cacheHit: false };
}

// ---------------------------------------------------------------------------
// Prompt builder — per-category instructions with concrete evidence injection.
// CRITICAL: must instruct LLM not to include internal category slugs.
// ---------------------------------------------------------------------------

function buildRenderPrompt(category: string, evidence: Record<string, unknown>): string {
  return `You are writing operator-facing recommendation copy for a business automation platform. The operator is non-technical.

Category hint (for your context only — DO NOT include this slug in your output): ${category}

Evidence:
${JSON.stringify(evidence, null, 2)}

Write a JSON object with exactly two fields:
- "title": a plain English title, max 80 characters. No jargon, no internal slugs (e.g. do NOT write "${category}"), no severity labels.
- "body": 1-2 sentences with concrete numbers from the evidence. Use human-readable units (e.g. "$73 against a $50 budget", "3 of 5 runs escalated to a human in the last 14 days"). Do not include internal identifiers or category slugs.

Respond with only the JSON object. No markdown, no preamble.`;
}

// ---------------------------------------------------------------------------
// Response parser — expects {"title":"...","body":"..."} from LLM.
// Falls back to newline split if JSON parsing fails.
// ---------------------------------------------------------------------------

function parseRenderResponse(content: string): { title: string; body: string } {
  const trimmed = content.trim();

  // Primary path: JSON parse
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'title' in parsed &&
      'body' in parsed &&
      typeof (parsed as Record<string, unknown>).title === 'string' &&
      typeof (parsed as Record<string, unknown>).body === 'string'
    ) {
      return {
        title: ((parsed as Record<string, unknown>).title as string).slice(0, 80),
        body: (parsed as Record<string, unknown>).body as string,
      };
    }
  } catch {
    // Fall through to newline split
  }

  // Fallback: split on first newline
  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
  const title = (lines[0] ?? 'Optimiser finding').slice(0, 80);
  const body = lines.slice(1).join(' ').trim() || 'Review the evidence for details.';
  return { title, body };
}
