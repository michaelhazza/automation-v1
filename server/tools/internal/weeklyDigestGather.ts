/**
 * weekly_digest_gather — aggregates 7-day retrospective data
 *
 * Called by the Weekly Digest playbook's Gather step. Produces the structured
 * payload the Draft step's LLM prompt renders into markdown.
 *
 * Memory health section is a stub until S14 lands in Phase 4 — see
 * `memoryHealth.stub: true`.
 *
 * Spec: docs/memory-and-briefings-spec.md §7.2 (S19)
 */

import { eq, and, gte, sql, count, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  agentRuns,
  taskDeliverables,
  actions,
  workspaceMemoryEntries,
  agentBeliefs,
  memoryBlocks,
  memoryReviewQueue,
  scheduledTasks,
} from '../../db/schema/index.js';

interface Input {
  subaccountId: string;
  organisationId: string;
  windowDays?: number;
}

export async function executeWeeklyDigestGather(
  input: Record<string, unknown>,
): Promise<unknown> {
  const parsed = input as unknown as Input;
  if (!parsed.subaccountId || !parsed.organisationId) {
    return { success: false, error: 'subaccountId and organisationId are required' };
  }

  const windowDays = parsed.windowDays ?? 7;
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const nextWindowEnd = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000);

  const { subaccountId, organisationId } = parsed;

  // ── 1. workCompleted ────────────────────────────────────────────────────
  const [tasksRun] = await db
    .select({ value: count() })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.subaccountId, subaccountId),
        eq(agentRuns.organisationId, organisationId),
        eq(agentRuns.status, 'completed'),
        gte(agentRuns.completedAt, windowStart),
      ),
    );

  const [deliverables] = await db
    .select({ value: count() })
    .from(taskDeliverables)
    .where(
      and(
        eq(taskDeliverables.organisationId, organisationId),
        gte(taskDeliverables.createdAt, windowStart),
      ),
    );

  const [actionsTaken] = await db
    .select({ value: count() })
    .from(actions)
    .where(
      and(
        eq(actions.organisationId, organisationId),
        gte(actions.createdAt, windowStart),
      ),
    );

  // ── 2. learned ──────────────────────────────────────────────────────────
  const [newEntries] = await db
    .select({ value: count() })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
        gte(workspaceMemoryEntries.createdAt, windowStart),
      ),
    );

  const [beliefsUpdated] = await db
    .select({ value: count() })
    .from(agentBeliefs)
    .where(
      and(
        eq(agentBeliefs.subaccountId, subaccountId),
        isNull(agentBeliefs.deletedAt),
        gte(agentBeliefs.updatedAt, windowStart),
      ),
    );

  const [blocksCreated] = await db
    .select({ value: count() })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.subaccountId, subaccountId),
        isNull(memoryBlocks.deletedAt),
        gte(memoryBlocks.createdAt, windowStart),
      ),
    );

  // ── 3. kpiMovement — placeholder ────────────────────────────────────────
  const kpiMovement: Array<{ name: string; delta: string }> = [];

  // ── 4. itemsPending ─────────────────────────────────────────────────────
  const [clarBlocked] = await db
    .select({ value: count() })
    .from(memoryReviewQueue)
    .where(
      and(
        eq(memoryReviewQueue.subaccountId, subaccountId),
        eq(memoryReviewQueue.organisationId, organisationId),
        eq(memoryReviewQueue.itemType, 'clarification_pending'),
        eq(memoryReviewQueue.status, 'pending'),
      ),
    );

  const [reviewPending] = await db
    .select({ value: count() })
    .from(memoryReviewQueue)
    .where(
      and(
        eq(memoryReviewQueue.subaccountId, subaccountId),
        eq(memoryReviewQueue.organisationId, organisationId),
        eq(memoryReviewQueue.status, 'pending'),
      ),
    );

  const [failedTasks] = await db
    .select({ value: count() })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.subaccountId, subaccountId),
        eq(agentRuns.organisationId, organisationId),
        eq(agentRuns.status, 'failed'),
        gte(agentRuns.updatedAt, windowStart),
      ),
    );

  // ── 5. memoryHealth — Phase 3 stub; replaced by S14 data in Phase 4 ────
  const memoryHealth = {
    conflictsResolved: null,
    entriesPruned: null,
    coverageGaps: null,
    stub: true,
  };

  // ── 6. nextWeekPreview ──────────────────────────────────────────────────
  const nextTasks = await db
    .select({
      taskSlug: scheduledTasks.taskSlug,
      nextRunAt: scheduledTasks.nextRunAt,
    })
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.subaccountId, subaccountId),
        eq(scheduledTasks.organisationId, organisationId),
        eq(scheduledTasks.isActive, true),
        gte(scheduledTasks.nextRunAt, new Date()),
        sql`${scheduledTasks.nextRunAt} <= ${nextWindowEnd}`,
      ),
    )
    .limit(20);

  return {
    success: true,
    workCompleted: {
      tasksRun: Number(tasksRun?.value ?? 0),
      deliverables: Number(deliverables?.value ?? 0),
      actions: Number(actionsTaken?.value ?? 0),
    },
    learned: {
      newEntries: Number(newEntries?.value ?? 0),
      beliefsUpdated: Number(beliefsUpdated?.value ?? 0),
      blocksCreated: Number(blocksCreated?.value ?? 0),
    },
    kpiMovement,
    itemsPending: {
      clarificationsBlocked: Number(clarBlocked?.value ?? 0),
      reviewQueueItems: Number(reviewPending?.value ?? 0),
      failedTasks: Number(failedTasks?.value ?? 0),
    },
    memoryHealth,
    nextWeekPreview: nextTasks.map((t) => ({
      taskSlug: t.taskSlug ?? 'unknown',
      nextRunAt: t.nextRunAt ? t.nextRunAt.toISOString() : '',
    })),
  };
}
