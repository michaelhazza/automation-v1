// ---------------------------------------------------------------------------
// Agent Belief Service — discrete, agent-maintained facts per agent-subaccount.
//
// Phase 1: confidence-scored, individually addressable, supersession-ready.
// Spec: docs/beliefs-spec.md
// ---------------------------------------------------------------------------

import { eq, and, isNull, sql, desc, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentBeliefs, workspaceMemoryEntries } from '../db/schema/index.js';
import { routeCall } from './llmRouter.js';
import { logger } from '../lib/logger.js';
import {
  EXTRACTION_MAX_TOKENS,
  BELIEFS_MAX_PER_EXTRACTION,
  BELIEFS_MAX_ACTIVE,
  BELIEFS_MAX_VALUE_LENGTH,
  BELIEFS_CONFIDENCE_FLOOR,
  BELIEFS_CONFIDENCE_BOOST,
  BELIEFS_CONFIDENCE_CEILING,
  BELIEFS_REMOVE_MIN_CONFIDENCE,
  BELIEFS_UPDATE_CONFIDENCE_CAP,
  BELIEFS_TOKEN_BUDGET,
  BRIEFING_MEMORY_ENTRIES_LIMIT,
  BRIEFING_MEMORY_QUALITY_THRESHOLD,
} from '../config/limits.js';
import type { AgentBelief } from '../db/schema/agentBeliefs.js';

// ---------------------------------------------------------------------------
// Key normalization & aliases
// ---------------------------------------------------------------------------

/** Known key synonyms. No chaining — every target must be a canonical key. */
const KEY_ALIASES: Record<string, string> = {
  ecommerce_platform: 'client_platform',
  cms: 'client_platform',
  cms_platform: 'client_platform',
  preferred_reporting_cadence: 'reporting_cadence',
  report_frequency: 'reporting_cadence',
};

// Validate no chaining at import time
for (const target of Object.values(KEY_ALIASES)) {
  if (target in KEY_ALIASES) {
    throw new Error(`KEY_ALIASES chaining detected: target "${target}" is itself an alias`);
  }
}

function normalizeKey(raw: string): { key: string; aliased: boolean; originalKey?: string } {
  const normalized = raw.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (normalized in KEY_ALIASES) {
    return { key: KEY_ALIASES[normalized], aliased: true, originalKey: normalized };
  }
  return { key: normalized, aliased: false };
}

// ---------------------------------------------------------------------------
// Value normalization for comparison (prevents false updates)
// ---------------------------------------------------------------------------

function normalizeValueForComparison(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?'"]/g, '')
    .replace(/\(.*?\)/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Token estimation (matches briefing service)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

// ---------------------------------------------------------------------------
// Extraction prompt builder
// ---------------------------------------------------------------------------

function buildExtractionPrompt(
  handoffJson: object,
  recentEntries: Array<{ content: string; entryType: string }>,
  existingBeliefs: AgentBelief[],
): string {
  const entriesBlock = recentEntries.length > 0
    ? recentEntries.map((e, i) => `  ${i + 1}. [${e.entryType}] ${e.content}`).join('\n')
    : '  (none)';

  const beliefsBlock = existingBeliefs.length > 0
    ? existingBeliefs.map(b =>
      `  - [${b.beliefKey}] (${b.category}, confidence: ${b.confidence}, source: ${b.source}) ${b.value}`
    ).join('\n')
    : '  (none)';

  return `You are a belief extractor for an AI agent. Given the outcome of the agent's latest run and recent observations, extract discrete factual beliefs the agent should retain about this workspace.

Latest run outcome:
<run-outcome-data>
${JSON.stringify(handoffJson, null, 2)}
</run-outcome-data>

Recent observations:
${entriesBlock}

Current beliefs:
${beliefsBlock}

For each belief, output a JSON array. Each element:
{
  "key": "snake_case_slug",
  "category": "general|preference|workflow|relationship|metric",
  "subject": "what this is about",
  "value": "the belief statement",
  "confidence": 0.0-1.0,
  "confidence_reason": "...",
  "action": "add|update|reinforce|remove"
}

Rules:
- "add": new belief not in current set
- "update": existing belief whose value has changed (key matches, value differs)
- "reinforce": existing belief confirmed by this run (increment evidence, keep value)
- "remove": belief that is no longer true based on this run's evidence
- Do not extract beliefs that are trivially obvious or already covered by existing beliefs with no change
- Maximum ${BELIEFS_MAX_PER_EXTRACTION} beliefs per extraction (focus on highest-signal facts)
- Keys must be deterministic — same concept should always produce same key
- Key format: lowercase snake_case only, e.g. "client_platform" not "ecommercePlatform" or "Client Platform"
- Do not override beliefs with source "user_override" unless this run contains direct contradictory evidence

Respond with only the JSON array. No preamble.`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const agentBeliefService = {
  // ─── Read ────────────────────────────────────────────────────────────────

  /**
   * Get all active beliefs for an agent-subaccount, ordered by category then
   * confidence desc, with belief_key as tie-breaker for deterministic ordering.
   * Truncated to BELIEFS_TOKEN_BUDGET.
   */
  async getActiveBeliefs(
    orgId: string,
    subaccountId: string,
    agentId: string,
  ): Promise<AgentBelief[]> {
    const rows = await db
      .select()
      .from(agentBeliefs)
      .where(
        and(
          eq(agentBeliefs.organisationId, orgId),
          eq(agentBeliefs.subaccountId, subaccountId),
          eq(agentBeliefs.agentId, agentId),
          isNull(agentBeliefs.deletedAt),
          isNull(agentBeliefs.supersededBy),
        ),
      )
      .orderBy(asc(agentBeliefs.category), desc(agentBeliefs.confidence), asc(agentBeliefs.beliefKey));

    return selectBeliefsWithinBudget(rows, BELIEFS_TOKEN_BUDGET);
  },

  // ─── Format for prompt ───────────────────────────────────────────────────

  formatBeliefsForPrompt(beliefs: AgentBelief[]): string {
    if (beliefs.length === 0) return '';

    const grouped = new Map<string, AgentBelief[]>();
    for (const b of beliefs) {
      const list = grouped.get(b.category) ?? [];
      list.push(b);
      grouped.set(b.category, list);
    }

    const parts: string[] = [
      'These are facts you have formed from previous runs. Treat them as your working knowledge — they may be updated or corrected over time.',
      '',
    ];

    for (const [category, items] of grouped) {
      const label = category.charAt(0).toUpperCase() + category.slice(1);
      parts.push(`**${label}:**`);
      for (const b of items) {
        parts.push(`- [${b.confidence.toFixed(2)}] ${b.value}`);
      }
      parts.push('');
    }

    return parts.join('\n').trimEnd();
  },

  // ─── Extract & Merge (post-run, fire-and-forget) ────────────────────────

  async extractAndMerge(
    orgId: string,
    subaccountId: string,
    agentId: string,
    runId: string,
    handoffJson: object,
  ): Promise<void> {
    try {
      // 1. Load existing beliefs
      const existing: AgentBelief[] = await db
        .select()
        .from(agentBeliefs)
        .where(
          and(
            eq(agentBeliefs.organisationId, orgId),
            eq(agentBeliefs.subaccountId, subaccountId),
            eq(agentBeliefs.agentId, agentId),
            isNull(agentBeliefs.deletedAt),
            isNull(agentBeliefs.supersededBy),
          ),
        ) as AgentBelief[];

      // 2. Load recent high-quality memory entries (same as briefing)
      const recentEntries = await db
        .select({
          content: workspaceMemoryEntries.content,
          entryType: workspaceMemoryEntries.entryType,
        })
        .from(workspaceMemoryEntries)
        .where(
          and(
            eq(workspaceMemoryEntries.organisationId, orgId),
            eq(workspaceMemoryEntries.subaccountId, subaccountId),
            eq(workspaceMemoryEntries.agentId, agentId),
            sql`${workspaceMemoryEntries.qualityScore} >= ${BRIEFING_MEMORY_QUALITY_THRESHOLD}`,
          ),
        )
        .orderBy(desc(workspaceMemoryEntries.createdAt))
        .limit(BRIEFING_MEMORY_ENTRIES_LIMIT);

      // 3. LLM extraction call
      const prompt = buildExtractionPrompt(handoffJson, recentEntries, existing);
      const response = await routeCall({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: EXTRACTION_MAX_TOKENS,
        context: {
          organisationId: orgId,
          subaccountId,
          runId,
          sourceType: 'system',
          agentName: 'agent-beliefs',
          taskType: 'belief_extraction',
          executionPhase: 'execution',
          routingMode: 'ceiling',
        },
      });

      const rawContent = typeof response.content === 'string' ? response.content.trim() : '';
      if (!rawContent) return;

      // 4. Parse JSON — extract array from possible markdown fences
      let parsed: unknown[];
      try {
        const jsonStr = rawContent.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        parsed = JSON.parse(jsonStr);
        if (!Array.isArray(parsed)) return;
      } catch {
        logger.warn('belief_extraction_parse_error', { runId, orgId });
        return;
      }

      // 5. Merge
      const existingByKey = new Map(existing.map(b => [b.beliefKey, b]));
      let adds = 0, updates = 0, reinforces = 0, removes = 0, skips = 0;
      let retryCount = 0;
      const MAX_RETRIES_PER_RUN = 50;

      for (const raw of parsed.slice(0, BELIEFS_MAX_PER_EXTRACTION)) {
        if (retryCount >= MAX_RETRIES_PER_RUN) {
          logger.error('belief_retry_storm', { runId, orgId, retryCount });
          break;
        }

        const item = raw as Record<string, unknown>;
        if (!item.key || !item.value) { skips++; continue; }

        // Normalize key
        const { key, aliased, originalKey } = normalizeKey(item.key as string);
        if (aliased) {
          logger.info('belief_key_aliased', { from: originalKey, to: key, runId });
          // Check for alias collision
          const existingForKey = existingByKey.get(key);
          if (existingForKey && normalizeValueForComparison(existingForKey.value) !== normalizeValueForComparison(item.value as string)) {
            logger.warn('belief_alias_collision', { from: originalKey, to: key, existingValue: existingForKey.value, runId });
          }
        }

        const value = (item.value as string).slice(0, BELIEFS_MAX_VALUE_LENGTH);
        const category = typeof item.category === 'string' ? item.category : 'general';
        const subject = typeof item.subject === 'string' ? item.subject : null;
        const confidence = typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 0.7;
        const confidenceReason = typeof item.confidence_reason === 'string' ? item.confidence_reason : null;

        const existingBelief = existingByKey.get(key);

        // Idempotency guard: skip if already applied by this run
        if (existingBelief?.sourceRunId === runId) { skips++; continue; }

        // User override guard
        if (existingBelief?.source === 'user_override') { skips++; continue; }

        // Determine effective action based on DB state (merge logic is authoritative)
        let effectiveAction: 'add' | 'update' | 'reinforce' | 'remove';
        if ((item.action as string) === 'remove') {
          if (!existingBelief || confidence < BELIEFS_REMOVE_MIN_CONFIDENCE || confidence < existingBelief.confidence) {
            skips++;
            continue;
          }
          effectiveAction = 'remove';
        } else if (!existingBelief) {
          effectiveAction = 'add';
        } else if (normalizeValueForComparison(existingBelief.value) === normalizeValueForComparison(value)) {
          effectiveAction = 'reinforce';
        } else {
          effectiveAction = 'update';
        }

        const now = new Date();

        try {
          if (effectiveAction === 'add') {
            await db.insert(agentBeliefs).values({
              organisationId: orgId,
              subaccountId,
              agentId,
              beliefKey: key,
              category,
              subject,
              value,
              confidence: Math.min(confidence, BELIEFS_CONFIDENCE_CEILING),
              sourceRunId: runId,
              evidenceCount: 1,
              source: 'agent',
              confidenceReason,
              createdAt: now,
              updatedAt: now,
            }).onConflictDoUpdate({
              // If key conflict (unique index), treat as update
              target: [agentBeliefs.organisationId, agentBeliefs.subaccountId, agentBeliefs.agentId, agentBeliefs.beliefKey],
              set: {
                value,
                confidence: sql`LEAST(${BELIEFS_UPDATE_CONFIDENCE_CAP}, ${confidence})`,
                sourceRunId: runId,
                evidenceCount: 1,
                confidenceReason,
                updatedAt: now,
              },
              // Only apply to rows matching the partial index conditions
              setWhere: sql`${agentBeliefs.deletedAt} IS NULL AND ${agentBeliefs.supersededBy} IS NULL`,
            });
            adds++;
          } else if (effectiveAction === 'update') {
            // Optimistic concurrency: include updated_at in WHERE
            const cappedConfidence = Math.min(existingBelief!.confidence, confidence, BELIEFS_UPDATE_CONFIDENCE_CAP);
            const result = await db.update(agentBeliefs)
              .set({
                value,
                confidence: cappedConfidence,
                sourceRunId: runId,
                evidenceCount: 1, // Reset on value change
                confidenceReason,
                updatedAt: now,
              })
              .where(
                and(
                  eq(agentBeliefs.id, existingBelief!.id),
                  eq(agentBeliefs.updatedAt, existingBelief!.updatedAt),
                ),
              )
              .returning({ id: agentBeliefs.id });

            if (result.length === 0) {
              retryCount++;
              // Re-read and retry once
              const [fresh] = await db.select().from(agentBeliefs).where(eq(agentBeliefs.id, existingBelief!.id));
              if (fresh && fresh.sourceRunId !== runId && fresh.source !== 'user_override') {
                await db.update(agentBeliefs).set({
                  value, confidence: cappedConfidence, sourceRunId: runId,
                  evidenceCount: 1, confidenceReason, updatedAt: now,
                }).where(eq(agentBeliefs.id, fresh.id));
              }
            }
            updates++;
          } else if (effectiveAction === 'reinforce') {
            const boostedConfidence = Math.min(BELIEFS_CONFIDENCE_CEILING, existingBelief!.confidence + BELIEFS_CONFIDENCE_BOOST);
            const result = await db.update(agentBeliefs)
              .set({
                evidenceCount: sql`${agentBeliefs.evidenceCount} + 1`,
                confidence: boostedConfidence,
                sourceRunId: runId,
                updatedAt: now,
                lastReinforcedAt: now,
                // Only overwrite confidence_reason if LLM provided one
                ...(confidenceReason ? { confidenceReason } : {}),
              })
              .where(
                and(
                  eq(agentBeliefs.id, existingBelief!.id),
                  eq(agentBeliefs.updatedAt, existingBelief!.updatedAt),
                ),
              )
              .returning({ id: agentBeliefs.id });

            if (result.length === 0) {
              retryCount++;
              const [fresh] = await db.select().from(agentBeliefs).where(eq(agentBeliefs.id, existingBelief!.id));
              if (fresh && fresh.sourceRunId !== runId && fresh.source !== 'user_override') {
                await db.update(agentBeliefs).set({
                  evidenceCount: sql`${agentBeliefs.evidenceCount} + 1`,
                  confidence: Math.min(BELIEFS_CONFIDENCE_CEILING, fresh.confidence + BELIEFS_CONFIDENCE_BOOST),
                  sourceRunId: runId, updatedAt: now, lastReinforcedAt: now,
                  ...(confidenceReason ? { confidenceReason } : {}),
                }).where(eq(agentBeliefs.id, fresh.id));
              }
            }
            reinforces++;
          } else if (effectiveAction === 'remove') {
            await db.update(agentBeliefs)
              .set({ deletedAt: now })
              .where(eq(agentBeliefs.id, existingBelief!.id));
            removes++;
          }
        } catch (err) {
          logger.warn('belief_merge_error', { key, action: effectiveAction, runId, error: String(err) });
          skips++;
        }
      }

      // 6. Post-merge cleanup
      // a) Soft-delete beliefs below confidence floor
      await db.update(agentBeliefs)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(agentBeliefs.organisationId, orgId),
            eq(agentBeliefs.subaccountId, subaccountId),
            eq(agentBeliefs.agentId, agentId),
            isNull(agentBeliefs.deletedAt),
            isNull(agentBeliefs.supersededBy),
            sql`${agentBeliefs.confidence} < ${BELIEFS_CONFIDENCE_FLOOR}`,
          ),
        );

      // b) Enforce max active limit
      const activeCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(agentBeliefs)
        .where(
          and(
            eq(agentBeliefs.organisationId, orgId),
            eq(agentBeliefs.subaccountId, subaccountId),
            eq(agentBeliefs.agentId, agentId),
            isNull(agentBeliefs.deletedAt),
            isNull(agentBeliefs.supersededBy),
          ),
        );

      const count = activeCount[0]?.count ?? 0;
      if (count > BELIEFS_MAX_ACTIVE) {
        const excess = count - BELIEFS_MAX_ACTIVE;
        // Soft-delete lowest-confidence beliefs
        await db.execute(sql`
          UPDATE agent_beliefs SET deleted_at = now()
          WHERE id IN (
            SELECT id FROM agent_beliefs
            WHERE organisation_id = ${orgId}
              AND subaccount_id = ${subaccountId}
              AND agent_id = ${agentId}
              AND deleted_at IS NULL
              AND superseded_by IS NULL
            ORDER BY confidence ASC, created_at ASC
            LIMIT ${excess}
          )
        `);
      }

      // 7. Observability
      const totalActive = count > BELIEFS_MAX_ACTIVE ? BELIEFS_MAX_ACTIVE : count;
      const churnRate = totalActive > 0 ? (updates + removes) / totalActive : 0;

      logger.info('belief_extraction_complete', {
        runId, orgId, subaccountId, agentId,
        adds, updates, reinforces, removes, skips,
        totalActive,
        churnRate: churnRate.toFixed(3),
        retryCount,
      });

    } catch (err) {
      // Fire-and-forget — never let belief errors bubble up
      logger.error('belief_extraction_failed', { runId, orgId, error: String(err) });
    }
  },

  // ─── User override ──────────────────────────────────────────────────────

  async upsertUserOverride(
    orgId: string,
    subaccountId: string,
    agentId: string,
    beliefKey: string,
    data: { value: string; category?: string; subject?: string },
  ): Promise<AgentBelief | null> {
    const now = new Date();
    const value = data.value.slice(0, BELIEFS_MAX_VALUE_LENGTH);

    const [row] = await db
      .insert(agentBeliefs)
      .values({
        organisationId: orgId,
        subaccountId,
        agentId,
        beliefKey,
        category: data.category ?? 'general',
        subject: data.subject ?? null,
        value,
        confidence: 1.0,
        source: 'user_override',
        evidenceCount: 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [agentBeliefs.organisationId, agentBeliefs.subaccountId, agentBeliefs.agentId, agentBeliefs.beliefKey],
        set: {
          value,
          category: data.category ?? 'general',
          subject: data.subject ?? null,
          confidence: 1.0,
          source: 'user_override',
          updatedAt: now,
        },
        setWhere: sql`${agentBeliefs.deletedAt} IS NULL AND ${agentBeliefs.supersededBy} IS NULL`,
      })
      .returning();

    return row ?? null;
  },

  async softDelete(
    orgId: string,
    beliefId: string,
  ): Promise<boolean> {
    const result = await db.update(agentBeliefs)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(agentBeliefs.id, beliefId),
          eq(agentBeliefs.organisationId, orgId),
          isNull(agentBeliefs.deletedAt),
        ),
      )
      .returning({ id: agentBeliefs.id });

    return result.length > 0;
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSingleBelief(b: AgentBelief): string {
  return `- [${b.confidence.toFixed(2)}] ${b.value}`;
}

function selectBeliefsWithinBudget(
  beliefs: AgentBelief[],
  tokenBudget: number,
): AgentBelief[] {
  // Sort by confidence descending — highest confidence survives budget cuts
  const sorted = [...beliefs].sort((a, b) => b.confidence - a.confidence);
  const selected: AgentBelief[] = [];
  let tokens = 0;
  const safetyBudget = tokenBudget * 0.9; // 10% safety buffer

  for (const belief of sorted) {
    const beliefTokens = estimateTokens(formatSingleBelief(belief));
    if (tokens + beliefTokens > safetyBudget) break;
    selected.push(belief);
    tokens += beliefTokens;
  }

  return selected;
}
