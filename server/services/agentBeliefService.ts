// ---------------------------------------------------------------------------
// Agent Belief Service — discrete, agent-maintained facts per agent-subaccount.
//
// Phase 1: confidence-scored, individually addressable, supersession-ready.
// Spec: docs/beliefs-spec.md
// ---------------------------------------------------------------------------

import { eq, and, isNull, sql, desc, asc, inArray } from 'drizzle-orm';
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
  BELIEFS_MAX_RETRIES_PER_RUN,
  BRIEFING_MEMORY_ENTRIES_LIMIT,
  BRIEFING_MEMORY_QUALITY_THRESHOLD,
} from '../config/limits.js';
import type { AgentBelief } from '../db/schema/agentBeliefs.js';
import {
  normalizeKey,
  normalizeValueForComparison,
  formatBeliefsForPrompt as formatBeliefsForPromptPure,
  selectBeliefsWithinBudget as selectBeliefsWithinBudgetPure,
  parseExtractionResponse,
  KEY_ALIASES,
  validateKeyAliases,
  type BeliefRecord,
} from './agentBeliefServicePure.js';

// Validate alias map at import time
const aliasError = validateKeyAliases(KEY_ALIASES);
if (aliasError) throw new Error(`KEY_ALIASES invalid: ${aliasError}`);

// ---------------------------------------------------------------------------
// Extraction prompt builder (standalone LLM call path — see extractAndMerge)
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

  // ─── Format for prompt (delegates to pure module) ──────────────────────

  formatBeliefsForPrompt(beliefs: AgentBelief[]): string {
    return formatBeliefsForPromptPure(beliefs as BeliefRecord[]);
  },

  // ─── Merge extracted beliefs (core merge path, no LLM) ────────────────

  /**
   * Merge a raw beliefs array (already parsed from LLM output) into the DB.
   * Called by agentBriefingService after the combined briefing+beliefs LLM call,
   * and internally by extractAndMerge after its standalone LLM call.
   *
   * Throws on unexpected DB errors — callers must wrap in try/catch.
   */
  async mergeExtracted(
    orgId: string,
    subaccountId: string,
    agentId: string,
    runId: string,
    rawItems: unknown[],
  ): Promise<void> {
    // 1. Load current active beliefs
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

    // 2. Merge loop
    const existingByKey = new Map(existing.map(b => [b.beliefKey, b]));
    let adds = 0, updates = 0, reinforces = 0, removes = 0, skips = 0;
    let retryCount = 0;

    for (const raw of rawItems.slice(0, BELIEFS_MAX_PER_EXTRACTION)) {
      if (retryCount >= BELIEFS_MAX_RETRIES_PER_RUN) {
        logger.error('belief_retry_storm', { runId, orgId, retryCount });
        break;
      }

      const item = raw as Record<string, unknown>;
      if (!item.key || !item.value) { skips++; continue; }

      // Normalize key
      const { key, aliased, originalKey } = normalizeKey(item.key as string);
      if (aliased) {
        logger.info('belief_key_aliased', { from: originalKey, to: key, runId });
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
            target: [agentBeliefs.organisationId, agentBeliefs.subaccountId, agentBeliefs.agentId, agentBeliefs.beliefKey],
            targetWhere: sql`${agentBeliefs.deletedAt} IS NULL AND ${agentBeliefs.supersededBy} IS NULL`,
            set: {
              value,
              confidence: sql`LEAST(${BELIEFS_UPDATE_CONFIDENCE_CAP}, ${confidence})`,
              sourceRunId: runId,
              evidenceCount: 1,
              confidenceReason,
              updatedAt: now,
            },
          });
          adds++;
        } else if (effectiveAction === 'update') {
          const cappedConfidence = Math.min(existingBelief!.confidence, confidence, BELIEFS_UPDATE_CONFIDENCE_CAP);
          const result = await db.update(agentBeliefs)
            .set({
              value,
              confidence: cappedConfidence,
              sourceRunId: runId,
              evidenceCount: 1,
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
            const [fresh] = await db.select().from(agentBeliefs).where(eq(agentBeliefs.id, existingBelief!.id));
            if (fresh && fresh.sourceRunId !== runId && fresh.source !== 'user_override') {
              await db.update(agentBeliefs).set({
                value, confidence: cappedConfidence, sourceRunId: runId,
                evidenceCount: 1, confidenceReason, updatedAt: now,
              }).where(eq(agentBeliefs.id, fresh.id));
              updates++;
            } else { skips++; }
          } else {
            updates++;
          }
        } else if (effectiveAction === 'reinforce') {
          const boostedConfidence = Math.min(BELIEFS_CONFIDENCE_CEILING, existingBelief!.confidence + BELIEFS_CONFIDENCE_BOOST);
          const result = await db.update(agentBeliefs)
            .set({
              evidenceCount: sql`${agentBeliefs.evidenceCount} + 1`,
              confidence: boostedConfidence,
              sourceRunId: runId,
              updatedAt: now,
              lastReinforcedAt: now,
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
              reinforces++;
            } else { skips++; }
          } else {
            reinforces++;
          }
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

    // 3. Post-merge cleanup
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
      const toDelete = await db
        .select({ id: agentBeliefs.id })
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
        .orderBy(asc(agentBeliefs.confidence), asc(agentBeliefs.createdAt))
        .limit(excess);
      if (toDelete.length > 0) {
        await db.update(agentBeliefs)
          .set({ deletedAt: new Date() })
          .where(inArray(agentBeliefs.id, toDelete.map(r => r.id)));
      }
    }

    // 4. Observability
    const totalActive = Math.min(count, BELIEFS_MAX_ACTIVE);
    const churnRate = totalActive > 0 ? (updates + removes) / totalActive : 0;

    const saturatedRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentBeliefs)
      .where(
        and(
          eq(agentBeliefs.organisationId, orgId),
          eq(agentBeliefs.subaccountId, subaccountId),
          eq(agentBeliefs.agentId, agentId),
          isNull(agentBeliefs.deletedAt),
          isNull(agentBeliefs.supersededBy),
          sql`${agentBeliefs.confidence} > 0.85`,
        ),
      );
    const saturatedCount = saturatedRows[0]?.count ?? 0;
    const saturationRate = totalActive > 0 ? saturatedCount / totalActive : 0;

    logger.info('belief_extraction_complete', {
      runId, orgId, subaccountId, agentId,
      adds, updates, reinforces, removes, skips,
      totalActive,
      churnRate: churnRate.toFixed(3),
      saturationRate: saturationRate.toFixed(3),
      retryCount,
    });
  },

  // ─── Extract & Merge — standalone LLM path (fallback / direct call) ─────

  /**
   * Standalone belief extraction: makes its own LLM call then calls
   * mergeExtracted(). Used as a fallback if the combined briefing+beliefs
   * path in agentBriefingJob is unavailable or needs to be bypassed.
   *
   * Fire-and-forget — all errors are swallowed.
   */
  async extractAndMerge(
    orgId: string,
    subaccountId: string,
    agentId: string,
    runId: string,
    handoffJson: object,
  ): Promise<void> {
    try {
      // Load existing beliefs
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

      // Load recent high-quality memory entries (same as briefing)
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

      // LLM extraction call
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

      const parsed = parseExtractionResponse(rawContent);
      if (!parsed) {
        logger.warn('belief_extraction_parse_error', { runId, orgId });
        return;
      }

      await this.mergeExtracted(orgId, subaccountId, agentId, runId, parsed);
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
    rawBeliefKey: string,
    data: { value: string; category?: string; subject?: string },
  ): Promise<AgentBelief | null> {
    const now = new Date();
    const value = data.value.slice(0, BELIEFS_MAX_VALUE_LENGTH);
    // Normalize key so user-set beliefs land on the canonical slot
    const { key: beliefKey } = normalizeKey(rawBeliefKey);

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
        targetWhere: sql`${agentBeliefs.deletedAt} IS NULL AND ${agentBeliefs.supersededBy} IS NULL`,
        set: {
          value,
          category: data.category ?? 'general',
          subject: data.subject ?? null,
          confidence: 1.0,
          source: 'user_override',
          updatedAt: now,
        },
      })
      .returning();

    return (row as AgentBelief | undefined) ?? null;
  },

  /**
   * Find a single active belief by key — no budget truncation.
   * Used by DELETE route where budget-gated getActiveBeliefs would 404 on
   * low-confidence beliefs.
   */
  async findBeliefByKey(
    orgId: string,
    subaccountId: string,
    agentId: string,
    beliefKey: string,
  ): Promise<AgentBelief | null> {
    const [row] = await db
      .select()
      .from(agentBeliefs)
      .where(
        and(
          eq(agentBeliefs.organisationId, orgId),
          eq(agentBeliefs.subaccountId, subaccountId),
          eq(agentBeliefs.agentId, agentId),
          eq(agentBeliefs.beliefKey, beliefKey),
          isNull(agentBeliefs.deletedAt),
          isNull(agentBeliefs.supersededBy),
        ),
      )
      .limit(1);

    return (row as AgentBelief | undefined) ?? null;
  },

  async softDelete(
    orgId: string,
    subaccountId: string,
    agentId: string,
    beliefId: string,
  ): Promise<boolean> {
    const result = await db.update(agentBeliefs)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(agentBeliefs.id, beliefId),
          eq(agentBeliefs.organisationId, orgId),
          eq(agentBeliefs.subaccountId, subaccountId),
          eq(agentBeliefs.agentId, agentId),
          isNull(agentBeliefs.deletedAt),
        ),
      )
      .returning({ id: agentBeliefs.id });

    return result.length > 0;
  },
};

// ---------------------------------------------------------------------------
// Helpers — delegate to pure module
// ---------------------------------------------------------------------------

function selectBeliefsWithinBudget(beliefs: AgentBelief[], tokenBudget: number): AgentBelief[] {
  return selectBeliefsWithinBudgetPure(beliefs as BeliefRecord[], tokenBudget) as AgentBelief[];
}
