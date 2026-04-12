import { eq, and, gt, desc, isNull, sql, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  priorityFeedClaims,
  reviewItems,
  agentRuns,
  agents,
  tasks,
  playbookRuns,
} from '../db/schema/index.js';
import { workspaceHealthFindings } from '../db/schema/workspaceHealthFindings.js';
import { rankFeed, type FeedEntry, type FeedEntrySource } from './priorityFeedServicePure.js';

// ---------------------------------------------------------------------------
// Priority Feed Service — impure (DB access)
// Feature 2: Prioritized Work Feed
// ---------------------------------------------------------------------------

export type PriorityFeedItem = FeedEntry & { score: number };

/**
 * List the priority feed for an agent run. Gathers open work items from
 * multiple sources, scores them, and returns the top N excluding claimed items.
 */
export async function listFeed(
  scope: { orgId: string; subaccountId?: string; agentRunId?: string },
  opts?: { limit?: number },
): Promise<PriorityFeedItem[]> {
  const limit = Math.min(opts?.limit ?? 20, 50);
  const now = new Date();

  // Gather feed entries from multiple sources in parallel
  const [healthFindings, pendingReviews, openTasks, failedRuns, activePbRuns] = await Promise.all([
    fetchHealthFindings(scope.orgId, scope.subaccountId),
    fetchPendingReviews(scope.orgId, scope.subaccountId),
    fetchOpenTasks(scope.orgId, scope.subaccountId),
    fetchFailedRuns(scope.orgId, scope.subaccountId),
    fetchActivePlaybookRuns(scope.orgId, scope.subaccountId),
  ]);

  const allEntries: FeedEntry[] = [
    ...healthFindings,
    ...pendingReviews,
    ...openTasks,
    ...failedRuns,
    ...activePbRuns,
  ];

  // Exclude items with active (non-expired) claims
  const activeClaims = await db
    .select({ itemSource: priorityFeedClaims.itemSource, itemId: priorityFeedClaims.itemId })
    .from(priorityFeedClaims)
    .where(gt(priorityFeedClaims.expiresAt, now));

  const claimedSet = new Set(activeClaims.map((c) => `${c.itemSource}:${c.itemId}`));
  const unclaimed = allEntries.filter((e) => !claimedSet.has(`${e.source}:${e.id}`));

  // Rank and score
  const callerId = { subaccountId: scope.subaccountId ?? '' };
  const ranked = rankFeed(unclaimed, callerId);

  const { scoreEntry } = await import('./priorityFeedServicePure.js');
  return ranked.slice(0, limit).map((entry) => ({
    ...entry,
    score: scoreEntry(entry, callerId),
  }));
}

/**
 * Claim a feed item to prevent other agents from working on it.
 */
export async function claimItem(
  source: string,
  itemId: string,
  agentRunId: string,
  ttlMinutes: number = 30,
): Promise<{ claimed: boolean; reason?: string }> {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  try {
    await db.insert(priorityFeedClaims).values({
      itemSource: source,
      itemId,
      agentRunId,
      expiresAt,
    });
    return { claimed: true };
  } catch (err: unknown) {
    // Unique constraint violation means already claimed
    const message = err instanceof Error ? err.message : '';
    if (message.includes('duplicate') || message.includes('unique') || message.includes('23505')) {
      return { claimed: false, reason: 'Item already claimed by another agent' };
    }
    throw err;
  }
}

/**
 * Release a claim, allowing other agents to pick up the item.
 */
export async function releaseItem(
  source: string,
  itemId: string,
  agentRunId: string,
): Promise<void> {
  await db
    .delete(priorityFeedClaims)
    .where(
      and(
        eq(priorityFeedClaims.itemSource, source),
        eq(priorityFeedClaims.itemId, itemId),
        eq(priorityFeedClaims.agentRunId, agentRunId),
      ),
    );
}

/**
 * Clean up expired claims. Called by the daily pg-boss job.
 */
export async function cleanupExpiredClaims(): Promise<number> {
  const result = await db
    .delete(priorityFeedClaims)
    .where(lt(priorityFeedClaims.expiresAt, new Date()));
  return (result as any)?.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Source fetchers
// ---------------------------------------------------------------------------

function ageInHours(date: Date | null): number {
  if (!date) return 0;
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

async function fetchHealthFindings(orgId: string, subaccountId?: string): Promise<FeedEntry[]> {
  const rows = await db
    .select()
    .from(workspaceHealthFindings)
    .where(
      and(
        eq(workspaceHealthFindings.organisationId, orgId),
        isNull(workspaceHealthFindings.resolvedAt),
      ),
    )
    .limit(50);

  return rows.map((r) => ({
    source: 'health_finding' as const,
    id: r.id,
    subaccountId: '',
    severity: r.severity as 'critical' | 'warning' | 'info',
    ageHours: ageInHours(r.detectedAt),
    metadata: { detector: r.detector, message: r.message },
  }));
}

async function fetchPendingReviews(orgId: string, subaccountId?: string): Promise<FeedEntry[]> {
  const conditions = [
    eq(reviewItems.organisationId, orgId),
    eq(reviewItems.reviewStatus, 'pending'),
  ];
  if (subaccountId) conditions.push(eq(reviewItems.subaccountId, subaccountId));

  const rows = await db.select().from(reviewItems).where(and(...conditions)).limit(50);

  return rows.map((r) => ({
    source: 'review_item' as const,
    id: r.id,
    subaccountId: r.subaccountId ?? '',
    severity: 'warning' as const,
    ageHours: ageInHours(r.createdAt),
    assignedSubaccountId: r.subaccountId ?? undefined,
    metadata: {},
  }));
}

async function fetchOpenTasks(orgId: string, subaccountId?: string): Promise<FeedEntry[]> {
  const conditions = [
    eq(tasks.organisationId, orgId),
    eq(tasks.status, 'inbox'),
    isNull(tasks.deletedAt),
  ];
  if (subaccountId) conditions.push(eq(tasks.subaccountId, subaccountId));

  const rows = await db.select().from(tasks).where(and(...conditions)).limit(50);

  return rows.map((r) => ({
    source: 'task' as const,
    id: r.id,
    subaccountId: r.subaccountId ?? '',
    severity: r.priority === 'urgent' ? 'critical' as const : r.priority === 'high' ? 'warning' as const : 'info' as const,
    ageHours: ageInHours(r.createdAt),
    assignedSubaccountId: r.subaccountId ?? undefined,
    metadata: { title: r.title, priority: r.priority },
  }));
}

async function fetchFailedRuns(orgId: string, subaccountId?: string): Promise<FeedEntry[]> {
  const conditions = [
    eq(agentRuns.organisationId, orgId),
    eq(agentRuns.status, 'failed'),
  ];
  if (subaccountId) conditions.push(eq(agentRuns.subaccountId, subaccountId));

  const rows = await db
    .select({ run: agentRuns, agentName: agents.name })
    .from(agentRuns)
    .innerJoin(agents, and(eq(agents.id, agentRuns.agentId), isNull(agents.deletedAt)))
    .where(and(...conditions))
    .orderBy(desc(agentRuns.createdAt))
    .limit(30);

  return rows.map(({ run, agentName }) => ({
    source: 'agent_run_failure' as const,
    id: run.id,
    subaccountId: run.subaccountId ?? '',
    severity: 'warning' as const,
    ageHours: ageInHours(run.createdAt),
    assignedSubaccountId: run.subaccountId ?? undefined,
    metadata: { agentName, errorMessage: run.errorMessage },
  }));
}

async function fetchActivePlaybookRuns(orgId: string, subaccountId?: string): Promise<FeedEntry[]> {
  const conditions = [
    eq(playbookRuns.organisationId, orgId),
    eq(playbookRuns.status, 'awaiting_input'),
  ];
  if (subaccountId) conditions.push(eq(playbookRuns.subaccountId, subaccountId));

  const rows = await db.select().from(playbookRuns).where(and(...conditions)).limit(30);

  return rows.map((r) => ({
    source: 'playbook_run' as const,
    id: r.id,
    subaccountId: r.subaccountId,
    severity: 'warning' as const,
    ageHours: ageInHours(r.createdAt),
    assignedSubaccountId: r.subaccountId,
    metadata: { status: r.status },
  }));
}
