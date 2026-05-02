/**
 * server/services/optimiser/optimiserOrchestrator.ts
 *
 * Top-level orchestration for the subaccount-optimiser agent.
 *
 * Called with { subaccountId, organisationId, agentId }. Runs all 8 scan
 * skills sequentially, evaluates each result, sorts candidates by priority,
 * renders operator copy via Sonnet, and calls output.recommend for each.
 *
 * Key invariants:
 * - Global kill switch: OPTIMISER_DISABLED=true → return immediately, no run_summary.
 * - Per-run wall-clock budget: OPTIMISER_RUN_BUDGET_MS (60s).
 * - Per-run candidate cap: OPTIMISER_RUN_CANDIDATE_CAP (25).
 * - Render cache: in-process LRU map keyed by (category:dedupeKey:evidenceHash:renderVersion).
 * - Run summary: always emitted in try/finally.
 *
 * Spec: docs/sub-account-optimiser-spec.md §4, §6.2, §8, §9 Phase 2
 */

import { logger } from '../../lib/logger.js';
import { routeCall } from '../llmRouter.js';
import type { UpsertRecommendationContext } from '../agentRecommendationsService.js';
import type { OutputRecommendInput } from '../../../shared/types/agentRecommendations.js';
import { severityRank } from '../../../shared/types/agentRecommendations.js';
import { evidenceHash as computeEvidenceHash } from '../../../shared/types/agentRecommendations.js';
import { RENDER_VERSION } from './renderVersion.js';
import { queryAgentBudget } from './queries/agentBudget.js';
import { queryEscalationRate } from './queries/escalationRate.js';
import { querySkillLatency } from './queries/skillLatency.js';
import { queryInactiveWorkflows } from './queries/inactiveWorkflows.js';
import { queryEscalationPhrases } from './queries/escalationPhrases.js';
import { queryMemoryCitation } from './queries/memoryCitation.js';
import { queryRoutingUncertainty } from './queries/routingUncertainty.js';
import { queryCacheEfficiency } from './queries/cacheEfficiency.js';
import { evaluateAgentBudget } from './recommendations/agentBudget.js';
import { evaluatePlaybookEscalation } from './recommendations/playbookEscalation.js';
import { evaluateSkillSlow } from './recommendations/skillSlow.js';
import { evaluateInactiveWorkflow } from './recommendations/inactiveWorkflow.js';
import { evaluateRepeatPhrase } from './recommendations/repeatPhrase.js';
import { evaluateMemoryCitation } from './recommendations/memoryCitation.js';
import { evaluateRoutingUncertainty } from './recommendations/routingUncertainty.js';
import { evaluateCacheEfficiency } from './recommendations/cacheEfficiency.js';
import type { RecommendationCandidate } from './recommendations/agentBudget.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const OPTIMISER_RUN_BUDGET_MS = 60_000;
export const OPTIMISER_RUN_CANDIDATE_CAP = 25;

// ---------------------------------------------------------------------------
// In-process render cache (LRU Map bounded at 5000 entries)
// Keyed by: `${category}:${dedupeKey}:${evidenceHash}:${renderVersion}`
// ---------------------------------------------------------------------------

interface RenderCacheEntry {
  title: string;
  body: string;
}

const RENDER_CACHE_MAX = 5000;
const renderCache = new Map<string, RenderCacheEntry>();

function renderCacheGet(key: string): RenderCacheEntry | undefined {
  const entry = renderCache.get(key);
  if (entry) {
    // Move to most-recently-used: delete + re-insert
    renderCache.delete(key);
    renderCache.set(key, entry);
  }
  return entry;
}

function renderCacheSet(key: string, entry: RenderCacheEntry): void {
  // LRU eviction: remove the oldest entry (first inserted) when at capacity
  if (renderCache.size >= RENDER_CACHE_MAX) {
    const oldestKey = renderCache.keys().next().value;
    if (oldestKey !== undefined) {
      renderCache.delete(oldestKey);
    }
  }
  renderCache.set(key, entry);
}

// Export for testing only
export { renderCache as _renderCache };

// ---------------------------------------------------------------------------
// Render validation
// ---------------------------------------------------------------------------

interface RenderOutput {
  title: string;
  body: string;
}

function validateRenderOutput(output: RenderOutput): string | null {
  const title = output.title?.trim() ?? '';
  const body = output.body?.trim() ?? '';

  if (title.length < 10 || title.length > 120) {
    return `title length ${title.length} not in [10, 120]`;
  }
  if (body.length < 40 || body.length > 600) {
    return `body length ${body.length} not in [40, 600]`;
  }
  if (!/[.!?]$/.test(body)) {
    return 'body does not end with . ! or ?';
  }
  if (!/\d/.test(body)) {
    return 'body contains no digit';
  }
  return null;
}

async function renderRecommendation(
  candidate: RecommendationCandidate,
  ctx: { organisationId: string; subaccountId: string },
): Promise<RenderOutput | null> {
  const hash = computeEvidenceHash(candidate.evidence);
  const cacheKey = `${candidate.category}:${candidate.dedupe_key}:${hash}:${RENDER_VERSION}`;

  const cached = renderCacheGet(cacheKey);
  if (cached) return cached;

  const promptBase = `You are writing a recommendation for an operator dashboard. Write a title and body for this finding.

Category: ${candidate.category}
Evidence: ${JSON.stringify(candidate.evidence, null, 2)}

Rules:
- Title: 10-120 characters, plain English, no internal slugs.
- Body: 2-3 sentences, 40-600 characters, must end with . ! or ? and include at least one number from the evidence.
- Do not include the category slug in the title or body.
- Write for a non-technical operator.

Respond with ONLY valid JSON: {"title": "...", "body": "..."}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? promptBase
        : `${promptBase}\n\nIMPORTANT: Respond in exactly 2 sentences, 40-200 characters total, ending with a period. Include a specific number from the evidence.`;

    try {
      const response = await routeCall({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 300,
        temperature: 0.2,
        context: {
          organisationId: ctx.organisationId,
          subaccountId: ctx.subaccountId,
          sourceType: 'system',
          taskType: 'memory_compile',
          featureTag: 'optimiser-render',
          model: 'claude-sonnet-4-6',
        },
      });

      const raw = typeof response.content === 'string' ? response.content.trim() : '';
      let parsed: RenderOutput;
      try {
        parsed = JSON.parse(raw) as RenderOutput;
      } catch {
        logger.warn('recommendations.render_parse_failed', {
          category: candidate.category,
          dedupe_key: candidate.dedupe_key,
          attempt,
          raw_excerpt: raw.slice(0, 200),
        });
        continue;
      }

      const validationError = validateRenderOutput(parsed);
      if (!validationError) {
        renderCacheSet(cacheKey, parsed);
        return parsed;
      }

      logger.warn('recommendations.render_validation_failed_attempt', {
        category: candidate.category,
        dedupe_key: candidate.dedupe_key,
        attempt,
        fail_reason: validationError,
      });
    } catch (err) {
      logger.warn('recommendations.render_failed', {
        category: candidate.category,
        dedupe_key: candidate.dedupe_key,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Both attempts failed
  logger.warn('recommendations.render_validation_failed', {
    category: candidate.category,
    dedupe_key: candidate.dedupe_key,
    attempts: 2,
    fail_reason: 'both_attempts_failed',
  });
  return null;
}

// ---------------------------------------------------------------------------
// Priority sorting (spec §6.2)
// Severity desc → updated_at desc (use Date.now() as proxy) → category asc → dedupe_key asc
// ---------------------------------------------------------------------------

function sortCandidates(candidates: RecommendationCandidate[]): RecommendationCandidate[] {
  return [...candidates].sort((a, b) => {
    const sevDiff = severityRank(b.severity) - severityRank(a.severity);
    if (sevDiff !== 0) return sevDiff;
    // category asc as tiebreaker (no updated_at yet — these are new)
    if (a.category < b.category) return -1;
    if (a.category > b.category) return 1;
    if (a.dedupe_key < b.dedupe_key) return -1;
    if (a.dedupe_key > b.dedupe_key) return 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Scan definitions
// ---------------------------------------------------------------------------

interface ScanDefinition {
  category: string;
  query: (input: { subaccountId: string; organisationId: string }) => Promise<unknown[]>;
  evaluate: (rows: unknown[], ctx: { subaccountId: string; organisationId: string }) => RecommendationCandidate[] | Promise<RecommendationCandidate[]>;
}

function buildScans(ctx: { subaccountId: string; organisationId: string }): ScanDefinition[] {
  return [
    {
      category: 'optimiser.agent.over_budget',
      query: (i) => queryAgentBudget(i) as Promise<unknown[]>,
      evaluate: (rows, c) => evaluateAgentBudget(rows as Parameters<typeof evaluateAgentBudget>[0], { subaccountId: c.subaccountId }),
    },
    {
      category: 'optimiser.playbook.escalation_rate',
      query: (i) => queryEscalationRate(i) as Promise<unknown[]>,
      evaluate: (rows) => evaluatePlaybookEscalation(rows as Parameters<typeof evaluatePlaybookEscalation>[0]),
    },
    {
      category: 'optimiser.skill.slow',
      query: (i) => querySkillLatency(i) as Promise<unknown[]>,
      evaluate: (rows) => evaluateSkillSlow(rows as Parameters<typeof evaluateSkillSlow>[0]),
    },
    {
      category: 'optimiser.inactive.workflow',
      query: (i) => queryInactiveWorkflows(i) as Promise<unknown[]>,
      evaluate: (rows) => evaluateInactiveWorkflow(rows as Parameters<typeof evaluateInactiveWorkflow>[0]),
    },
    {
      category: 'optimiser.escalation.repeat_phrase',
      query: (i) => queryEscalationPhrases(i) as Promise<unknown[]>,
      evaluate: (rows, c) => evaluateRepeatPhrase(rows as Parameters<typeof evaluateRepeatPhrase>[0], { subaccountId: c.subaccountId }),
    },
    {
      category: 'optimiser.memory.low_citation_waste',
      query: (i) => queryMemoryCitation(i) as Promise<unknown[]>,
      evaluate: (rows) => evaluateMemoryCitation(rows as Parameters<typeof evaluateMemoryCitation>[0]),
    },
    {
      category: 'optimiser.agent.routing_uncertainty',
      query: (i) => queryRoutingUncertainty(i) as Promise<unknown[]>,
      evaluate: (rows) => evaluateRoutingUncertainty(rows as Parameters<typeof evaluateRoutingUncertainty>[0]),
    },
    {
      category: 'optimiser.llm.cache_poor_reuse',
      query: (i) => queryCacheEfficiency(i) as Promise<unknown[]>,
      evaluate: (rows) => evaluateCacheEfficiency(rows as Parameters<typeof evaluateCacheEfficiency>[0]),
    },
  ];
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export interface OptimiserRunInput {
  subaccountId: string;
  organisationId: string;
  agentId: string;
}

export async function runOptimiser(input: OptimiserRunInput): Promise<void> {
  const { subaccountId, organisationId, agentId } = input;

  // Global kill switch
  if (process.env['OPTIMISER_DISABLED'] === 'true') {
    logger.info('recommendations.run_skipped', {
      reason: 'global_kill_switch',
      subaccount_id: subaccountId,
      agent_id: agentId,
    });
    return; // No run_summary emitted — the run never started
  }

  const runStartedAt = Date.now();
  const scans = buildScans({ subaccountId, organisationId });

  // Run summary counters
  let totalCandidates = 0;
  let written = 0;
  let updatedInPlace = 0;
  let skippedCooldown = 0;
  let skippedSubThreshold = 0;
  let skippedNoChange = 0;
  let evictedLowerPriority = 0;
  let droppedDueToCap = 0;
  let renderFailures = 0;
  let candidateCapExceeded = false;
  let status: 'completed' | 'completed_with_failures' | 'timed_out' = 'completed';
  const completedCategories: string[] = [];
  const remainingCategories: string[] = scans.map((s) => s.category);
  let scanFailureCount = 0;

  try {
    const allCandidates: RecommendationCandidate[] = [];

    // ── Phase 1: Scan all categories ─────────────────────────────────────────
    for (const scan of scans) {
      // Pre-scan timeout check
      if (Date.now() - runStartedAt > OPTIMISER_RUN_BUDGET_MS) {
        logger.warn('recommendations.run_timeout', {
          subaccount_id: subaccountId,
          agent_id: agentId,
          completed_categories: completedCategories,
          remaining_categories: [...remainingCategories],
          elapsed_ms: Date.now() - runStartedAt,
        });
        status = 'timed_out';
        break;
      }

      remainingCategories.shift();

      try {
        const rows = await scan.query({ subaccountId, organisationId });
        const candidates = await scan.evaluate(rows, { subaccountId, organisationId });
        allCandidates.push(...candidates);
        completedCategories.push(scan.category);
      } catch (err) {
        scanFailureCount++;
        status = 'completed_with_failures';
        logger.warn('recommendations.scan_failed', {
          category: scan.category,
          subaccount_id: subaccountId,
          agent_id: agentId,
          error_type: err instanceof Error ? err.constructor.name : 'unknown',
          error_message_redacted: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
        });
        completedCategories.push(scan.category);
      }
    }

    // ── Phase 2: Sort and cap ────────────────────────────────────────────────
    const sorted = sortCandidates(allCandidates);

    if (sorted.length > OPTIMISER_RUN_CANDIDATE_CAP) {
      candidateCapExceeded = true;
      logger.info('recommendations.run_candidate_cap_exceeded', {
        subaccount_id: subaccountId,
        agent_id: agentId,
        total: sorted.length,
        kept: OPTIMISER_RUN_CANDIDATE_CAP,
        dropped: sorted.length - OPTIMISER_RUN_CANDIDATE_CAP,
      });
    }

    const cappedCandidates = sorted.slice(0, OPTIMISER_RUN_CANDIDATE_CAP);
    totalCandidates = cappedCandidates.length;

    // ── Phase 3: Render + recommend ──────────────────────────────────────────
    // Skip entirely if Phase 1 already timed out — avoids a duplicate run_timeout log
    if (status !== 'timed_out') {
      const { upsertRecommendation } = await import('../agentRecommendationsService.js');

      for (const candidate of cappedCandidates) {
        // Pre-render timeout check
        if (Date.now() - runStartedAt > OPTIMISER_RUN_BUDGET_MS) {
          logger.warn('recommendations.run_timeout', {
            subaccount_id: subaccountId,
            agent_id: agentId,
            completed_categories: completedCategories,
            remaining_categories: [],
            elapsed_ms: Date.now() - runStartedAt,
          });
          status = 'timed_out';
          break;
        }

        const rendered = await renderRecommendation(candidate, { organisationId, subaccountId });
        if (!rendered) {
          renderFailures++;
          continue;
        }

        const upsertCtx: UpsertRecommendationContext = {
          organisationId,
          agentId,
          agentNamespace: 'optimiser',
        };

        const upsertInput: OutputRecommendInput = {
          scope_type: 'subaccount',
          scope_id: subaccountId,
          category: candidate.category,
          severity: candidate.severity,
          title: rendered.title,
          body: rendered.body,
          evidence: candidate.evidence,
          action_hint: candidate.action_hint ?? null,
          dedupe_key: candidate.dedupe_key,
        };

        try {
          const result = await upsertRecommendation(upsertCtx, upsertInput);

          if (result.was_new && result.reason !== 'evicted_lower_priority') {
            written++;
          } else if (!result.was_new && result.reason === 'updated_in_place') {
            updatedInPlace++;
          } else if (!result.was_new && result.reason === 'cooldown') {
            skippedCooldown++;
          } else if (!result.was_new && result.reason === 'sub_threshold') {
            skippedSubThreshold++;
          } else if (!result.was_new && !result.reason) {
            skippedNoChange++;
          } else if (result.reason === 'evicted_lower_priority') {
            evictedLowerPriority++;
            written++;
          } else if (result.reason === 'cap_reached') {
            droppedDueToCap++;
          }
        } catch (err) {
          renderFailures++;
          logger.warn('recommendations.upsert_failed', {
            category: candidate.category,
            dedupe_key: candidate.dedupe_key,
            subaccount_id: subaccountId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    if (scanFailureCount > 0 && status !== 'timed_out') {
      status = 'completed_with_failures';
    }
  } finally {
    logger.info('recommendations.run_summary', {
      subaccount_id: subaccountId,
      agent_id: agentId,
      total_candidates: totalCandidates,
      written,
      updated_in_place: updatedInPlace,
      skipped_cooldown: skippedCooldown,
      skipped_sub_threshold: skippedSubThreshold,
      skipped_no_change: skippedNoChange,
      evicted_lower_priority: evictedLowerPriority,
      dropped_due_to_cap: droppedDueToCap,
      render_failures: renderFailures,
      candidate_cap_exceeded: candidateCapExceeded,
      duration_ms: Date.now() - runStartedAt,
      status,
    });
  }
}
