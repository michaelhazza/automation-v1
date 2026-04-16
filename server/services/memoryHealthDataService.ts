/**
 * memoryHealthDataService — S14 metrics for Weekly Digest Section 5
 *
 * Produces:
 *   - newEntries count + top 3 by quality
 *   - conflicts auto-resolved count (belief_conflict queue rows with status='auto_applied')
 *   - entries pruned count (soft-deleted within window)
 *   - beliefs updated count + uncertain flag
 *   - block proposals pending count
 *   - coverage gaps ("No memories about X despite N recent tasks")
 *
 * Spec: docs/memory-and-briefings-spec.md §5.10 (S14)
 */

import { and, eq, gte, isNull, isNotNull, lt, sql, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  workspaceMemoryEntries,
  agentBeliefs,
  memoryBlocks,
  memoryReviewQueue,
  agentRuns,
  tasks,
} from '../db/schema/index.js';
import {
  rankTopEntriesByQuality,
  detectCoverageGaps,
} from './memoryHealthDataServicePure.js';

export interface MemoryHealthSnapshot {
  newEntries: {
    count: number;
    top3: Array<{ id: string; qualityScore: number | null; topic: string | null }>;
  };
  conflictsAutoResolved: number;
  entriesPruned: number;
  beliefsUpdated: {
    count: number;
    uncertainCount: number;
  };
  blockProposalsPending: number;
  coverageGaps: string[];
  stub: false;
}

export async function getMemoryHealthForSubaccount(
  subaccountId: string,
  organisationId: string,
  windowDays = 7,
): Promise<MemoryHealthSnapshot> {
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // ── newEntries ─────────────────────────────────────────────────────────
  const newEntriesRows = await db
    .select({
      id: workspaceMemoryEntries.id,
      qualityScore: workspaceMemoryEntries.qualityScore,
      citedCount: workspaceMemoryEntries.citedCount,
      topic: workspaceMemoryEntries.topic,
    })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
        gte(workspaceMemoryEntries.createdAt, windowStart),
      ),
    );

  const top3 = rankTopEntriesByQuality(
    newEntriesRows.map((r) => ({
      id: r.id,
      qualityScore: r.qualityScore ?? 0,
      citedCount: r.citedCount ?? 0,
      topic: r.topic,
    })),
    3,
  );

  // ── conflicts auto-resolved ────────────────────────────────────────────
  const [{ value: conflictsAutoResolved }] = await db
    .select({ value: count() })
    .from(memoryReviewQueue)
    .where(
      and(
        eq(memoryReviewQueue.subaccountId, subaccountId),
        eq(memoryReviewQueue.organisationId, organisationId),
        eq(memoryReviewQueue.itemType, 'belief_conflict'),
        eq(memoryReviewQueue.status, 'auto_applied'),
        gte(memoryReviewQueue.createdAt, windowStart),
      ),
    );

  // ── entries pruned (soft-deleted in window) ────────────────────────────
  const [{ value: entriesPruned }] = await db
    .select({ value: count() })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNotNull(workspaceMemoryEntries.deletedAt),
        gte(workspaceMemoryEntries.deletedAt, windowStart),
      ),
    );

  // ── beliefs updated ─────────────────────────────────────────────────────
  const [{ value: beliefsUpdatedCount }] = await db
    .select({ value: count() })
    .from(agentBeliefs)
    .where(
      and(
        eq(agentBeliefs.subaccountId, subaccountId),
        isNull(agentBeliefs.deletedAt),
        gte(agentBeliefs.updatedAt, windowStart),
      ),
    );

  // Uncertain = recently updated beliefs whose confidence is below the midpoint.
  // supersededBy IS NOT NULL means the belief was REPLACED, not that it is uncertain.
  const uncertainRows = await db
    .select({ value: count() })
    .from(agentBeliefs)
    .where(
      and(
        eq(agentBeliefs.subaccountId, subaccountId),
        isNull(agentBeliefs.deletedAt),
        gte(agentBeliefs.updatedAt, windowStart),
        isNull(agentBeliefs.supersededBy),
        lt(agentBeliefs.confidence, 0.5),
      ),
    );
  const uncertainCount = Number(uncertainRows[0]?.value ?? 0);

  // ── block proposals pending ────────────────────────────────────────────
  const [{ value: blockProposalsPending }] = await db
    .select({ value: count() })
    .from(memoryReviewQueue)
    .where(
      and(
        eq(memoryReviewQueue.subaccountId, subaccountId),
        eq(memoryReviewQueue.organisationId, organisationId),
        eq(memoryReviewQueue.itemType, 'block_proposal'),
        eq(memoryReviewQueue.status, 'pending'),
      ),
    );

  // ── coverage gaps (topic frequency heuristic) ──────────────────────────
  // Recent task topics come from tasks.brief / title (top keyword as a rough proxy).
  const taskTopicsRaw = (await db.execute(sql`
    SELECT
      LOWER(SPLIT_PART(COALESCE(title, ''), ' ', 1)) AS topic,
      COUNT(*)::int AS cnt
    FROM tasks
    WHERE subaccount_id = ${subaccountId}
      AND organisation_id = ${organisationId}
      AND deleted_at IS NULL
      AND created_at >= ${windowStart}
    GROUP BY topic
    HAVING LENGTH(LOWER(SPLIT_PART(COALESCE(title, ''), ' ', 1))) > 3
  `)) as unknown as Array<{ topic: string; cnt: number }> | { rows?: Array<{ topic: string; cnt: number }> };

  const topicList = Array.isArray(taskTopicsRaw) ? taskTopicsRaw : taskTopicsRaw.rows ?? [];
  const recentTaskTopics: Record<string, number> = {};
  for (const row of topicList) {
    if (row.topic) recentTaskTopics[row.topic] = Number(row.cnt);
  }

  const coveredTopicRows = await db
    .selectDistinct({ topic: workspaceMemoryEntries.topic })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
        isNotNull(workspaceMemoryEntries.topic),
      ),
    );
  const coveredTopics = new Set<string>(
    coveredTopicRows
      .map((r) => (r.topic ?? '').toLowerCase())
      .filter((t): t is string => t.length > 0),
  );

  const coverageGaps = detectCoverageGaps({
    recentTaskTopics,
    coveredTopics,
  });

  // Touch agentRuns to keep the import available for future enrichment
  void agentRuns;
  void tasks;

  return {
    newEntries: {
      count: newEntriesRows.length,
      top3: top3.map((e) => ({
        id: e.id,
        qualityScore: e.qualityScore,
        topic: e.topic,
      })),
    },
    conflictsAutoResolved: Number(conflictsAutoResolved ?? 0),
    entriesPruned: Number(entriesPruned ?? 0),
    beliefsUpdated: {
      count: Number(beliefsUpdatedCount ?? 0),
      uncertainCount,
    },
    blockProposalsPending: Number(blockProposalsPending ?? 0),
    coverageGaps,
    stub: false,
  };
}
