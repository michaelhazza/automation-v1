// ---------------------------------------------------------------------------
// Agent Belief Service — discrete, agent-maintained facts per agent-subaccount.
//
// Phase 1: confidence-scored, individually addressable, supersession-ready.
// Spec: docs/beliefs-spec.md
// ---------------------------------------------------------------------------

import { eq, and, isNull, sql, desc, asc, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentBeliefs } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import {
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
} from '../config/limits.js';
import type { AgentBelief } from '../db/schema/agentBeliefs.js';
import {
  normalizeKey,
  normalizeValueForComparison,
  formatBeliefsForPrompt as formatBeliefsForPromptPure,
  selectBeliefsWithinBudget as selectBeliefsWithinBudgetPure,
  KEY_ALIASES,
  validateKeyAliases,
  type BeliefRecord,
} from './agentBeliefServicePure.js';
import { checkAndResolveConflicts } from './beliefConflictService.js';

// Validate alias map at import time
const aliasError = validateKeyAliases(KEY_ALIASES);
if (aliasError) throw new Error(`KEY_ALIASES invalid: ${aliasError}`);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const agentBeliefService = {
  // ─── Read ────────────────────────────────────────────────────────────────

  /**
   * Get all active beliefs for an agent-subaccount, ordered by category then
   * confidence desc, with belief_key as tie-breaker for deterministic ordering.
   * Returns ALL active beliefs with no token budget applied — use for admin
   * reads (list, delete) where every belief must be visible.
   */
  async listAllActiveBeliefs(
    orgId: string,
    subaccountId: string,
    agentId: string,
  ): Promise<AgentBelief[]> {
    return db
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
  },

  /**
   * Get active beliefs truncated to BELIEFS_TOKEN_BUDGET — use only for
   * agent prompt injection where the token cost must be bounded.
   */
  async getActiveBeliefs(
    orgId: string,
    subaccountId: string,
    agentId: string,
  ): Promise<AgentBelief[]> {
    const rows = await this.listAllActiveBeliefs(orgId, subaccountId, agentId);
    return selectBeliefsWithinBudget(rows, BELIEFS_TOKEN_BUDGET);
  },

  // ─── Format for prompt (delegates to pure module) ──────────────────────

  formatBeliefsForPrompt(beliefs: AgentBelief[]): string {
    return formatBeliefsForPromptPure(beliefs as BeliefRecord[]);
  },

  // ─── Merge extracted beliefs (core merge path, no LLM) ────────────────

  /**
   * Merge a raw beliefs array (already parsed from LLM output) into the DB.
   * Called by agentBriefingService after the combined briefing+beliefs LLM call.
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
      // Memory & Briefings Phase 1 (§4.3 S3): entity key for cross-agent conflict detection
      const entityKey = typeof item.entity_key === 'string' && item.entity_key.trim() ? item.entity_key.trim() : null;

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
            entityKey,
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
              ...(entityKey ? { entityKey } : {}),
              updatedAt: now,
            },
          });
          adds++;
          // Memory & Briefings Phase 1 (§4.3 S3): conflict check on entityKey
          if (entityKey) {
            const [written] = await db
              .select({ id: agentBeliefs.id, confidence: agentBeliefs.confidence })
              .from(agentBeliefs)
              .where(
                and(
                  eq(agentBeliefs.organisationId, orgId),
                  eq(agentBeliefs.subaccountId, subaccountId),
                  eq(agentBeliefs.agentId, agentId),
                  eq(agentBeliefs.beliefKey, key),
                  isNull(agentBeliefs.deletedAt),
                  isNull(agentBeliefs.supersededBy),
                ),
              )
              .limit(1);
            if (written) {
              checkAndResolveConflicts({
                newBelief: {
                  id: written.id,
                  organisationId: orgId,
                  subaccountId,
                  agentId,
                  entityKey,
                  value,
                  confidence: written.confidence,
                },
                activeRunId: runId,
              }).catch((err) =>
                logger.warn('belief_conflict_check_failed', { beliefKey: key, runId, error: String(err) }),
              );
            }
          }
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
    // totalActive reflects the capped count (pre-cleanup count may exceed BELIEFS_MAX_ACTIVE
    // briefly, but the log reports the post-cleanup effective ceiling)
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

  // ─── User override ──────────────────────────────────────────────────────

  async upsertUserOverride(
    orgId: string,
    subaccountId: string,
    agentId: string,
    rawBeliefKey: string,
    data: { value: string; category?: string; subject?: string },
  ): Promise<AgentBelief | null> {
    // Normalize key so user-set beliefs land on the canonical slot
    const { key: beliefKey } = normalizeKey(rawBeliefKey);
    const normalizedKey = beliefKey;
    const now = new Date();
    const value = data.value.slice(0, BELIEFS_MAX_VALUE_LENGTH);

    const [row] = await db
      .insert(agentBeliefs)
      .values({
        organisationId: orgId,
        subaccountId,
        agentId,
        beliefKey: normalizedKey,
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
        // Target the partial unique index: (org, subaccount, agent, key) WHERE deleted_at IS NULL AND superseded_by IS NULL
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
