import { eq, and, desc, isNull, gte, lte } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import {
  agents,
  agentPresenceProjections,
  agentObservations,
  agentExecutionEvents,
  agentWorkingTimeRollups,
  agentRuns,
} from '../db/schema/index.js';
import type { AgentPresenceState, CurrentFocus } from '../../shared/types/agentPresence.js';
import type { AgentObservation } from '../../shared/types/agentObservations.js';
import type { PrincipalContext } from './principal/types.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

interface ActiveGoal {
  type: 'scheduled_run' | 'pending_hitl';
  label: string;
  nextRunAt: string | null;
}

interface KnowledgeInUseEntry {
  id: string;
  title: string;
  sourceKind: string;
  retrievedAt: string;
  runId: string;
}

interface FileSnapshotEntry {
  id: string;
  name: string;
  mimeType: string | null;
  versionId: string | null;
  producingRunId: string | null;
  producingEventId: string | null;
  createdAt: string;
}

interface ConnectionHealthEntry {
  id: string;
  name: string;
  status: string;
}

interface WorkingTimeBucket {
  date: string;
  seconds: number;
}

interface ActivityFeedRow {
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  runId: string;
}

export interface OverviewPayload {
  identity: {
    id: string;
    name: string;
    role: string;
    reportsTo: string | null;
    subaccountId: string | null;
  };
  presence: {
    state: AgentPresenceState;
    subtitle: string | null;
    activeRunId: string | null;
    currentFocus: CurrentFocus | null;
    elapsedSinceRunStartMs: number | null;
    serverNow: string;
  };
  activeGoals: ActiveGoal[];
  recentObservations: AgentObservation[];
  knowledgeInUse: KnowledgeInUseEntry[];
  filesSnapshot: FileSnapshotEntry[];
  toolsUsageBands: {
    frequently: string[];
    occasionally: string[];
    rarely: string[];
    asOf: string;
  };
  schedulePeek: { nextRunAt: string | null; trigger: string | null; label: string | null; } | null;
  connectionsHealth: ConnectionHealthEntry[];
  workingTime: {
    range: 'today' | 'week' | 'month' | 'quarter';
    buckets: WorkingTimeBucket[];
    captionTotalSeconds: number;
    captionRunsCount: number;
    captionSuccessRate: number;
    captionAverageRunDurationSeconds: number;
  };
  activityFeed: ActivityFeedRow[];
  /**
   * True if this agent has at least one run with `status = 'completed'`.
   * Drives the first-run vs live-presence branch on AgentOverviewTab — empty
   * observations / activity feed alone is not enough to declare first-run
   * (an agent mid-run has neither but is past first-run).
   */
  hasCompletedRuns: boolean;
}

// ---------------------------------------------------------------------------
// In-process files-snapshot cache
// ---------------------------------------------------------------------------

interface FilesSnapshotCacheEntry {
  snapshot: FileSnapshotEntry[];
  fetchedAt: number;
}

const filesSnapshotCache = new Map<string, FilesSnapshotCacheEntry>();

export function invalidateFilesSnapshotCache(agentId: string): void {
  filesSnapshotCache.delete(agentId);
}

// ---------------------------------------------------------------------------
// Subscriber-inactive log suppression (24h window)
// ---------------------------------------------------------------------------

const subscriberInactiveLoggedAt = new Map<string, number>();

export function subscribeFilesSnapshotInvalidators(): void {
  const FILE_EVENT_TYPES = [
    'run_completed',
    'knowledge.files.promoted',
    'knowledge.files.deleted',
    'knowledge.files.archived',
    'knowledge.files.restored',
    'knowledge.files.metadata_changed',
    'knowledge.files.access_changed',
    'knowledge.files.merged',
  ] as const;

  for (const eventType of FILE_EVENT_TYPES) {
    const lastLogged = subscriberInactiveLoggedAt.get(eventType) ?? 0;
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    if (Date.now() - lastLogged < twentyFourHoursMs) {
      logger.debug('overview.cache_invalidation_subscriber_inactive', { eventType });
    } else {
      logger.info('overview.cache_invalidation_subscriber_inactive', { eventType });
      subscriberInactiveLoggedAt.set(eventType, Date.now());
    }
  }
}

// ---------------------------------------------------------------------------
// Lazy-load stubs (called by overview route endpoints)
// ---------------------------------------------------------------------------

export async function getObservations(
  _agentId: string,
  _ctx: PrincipalContext,
  _opts: { limit?: number; cursor?: string; pinnedOnly?: boolean },
): Promise<{ data: AgentObservation[]; cursor: string | null }> {
  return { data: [], cursor: null };
}

export async function getFilesSnapshot(
  _agentId: string,
  _ctx: PrincipalContext,
  _opts: { limit?: number; cursor?: string },
): Promise<{ data: FileSnapshotEntry[]; cursor: string | null }> {
  return { data: [], cursor: null };
}

export async function getToolsUsage(
  _agentId: string,
  _ctx: PrincipalContext,
): Promise<{ frequently: string[]; occasionally: string[]; rarely: string[]; asOf: string }> {
  return { frequently: [], occasionally: [], rarely: [], asOf: new Date().toISOString() };
}

export async function getActivityFeed(
  _agentId: string,
  _ctx: PrincipalContext,
  _opts: { limit?: number; cursor?: string },
): Promise<{ data: ActivityFeedRow[]; cursor: string | null }> {
  return { data: [], cursor: null };
}

export async function getConnectionHealth(
  _agentId: string,
  _connectionId: string,
  _ctx: PrincipalContext,
): Promise<ConnectionHealthEntry | null> {
  return null;
}

export async function getWorkingTimeForRange(
  agentId: string,
  range: 'week' | 'month' | 'quarter',
  ctx: PrincipalContext,
): Promise<{
  range: 'week' | 'month' | 'quarter';
  buckets: WorkingTimeBucket[];
  captionTotalSeconds: number;
  captionRunsCount: number;
  captionSuccessRate: number;
  captionAverageRunDurationSeconds: number;
}> {
  const db = getOrgScopedDb('agentOverviewAggregator.getWorkingTimeForRange');
  const organisationId = ctx.organisationId;

  const now = new Date();
  let startDate: string;
  const endDate = now.toISOString().slice(0, 10);

  if (range === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    startDate = d.toISOString().slice(0, 10);
  } else if (range === 'month') {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    startDate = d.toISOString().slice(0, 10);
  } else {
    const d = new Date(now);
    d.setDate(d.getDate() - 89);
    startDate = d.toISOString().slice(0, 10);
  }

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const rows = await db
    .select()
    .from(agentWorkingTimeRollups)
    .where(
      and(
        eq(agentWorkingTimeRollups.organisationId, organisationId),
        eq(agentWorkingTimeRollups.agentId, agentId),
        gte(agentWorkingTimeRollups.bucketDate, startDate),
        lte(agentWorkingTimeRollups.bucketDate, endDate),
      ),
    )
    .orderBy(agentWorkingTimeRollups.bucketDate);

  const buckets: WorkingTimeBucket[] = rows.map(r => ({
    date: typeof r.bucketDate === 'string' ? r.bucketDate : (r.bucketDate as unknown as Date).toISOString().slice(0, 10),
    seconds: r.workingTimeSeconds,
  }));

  const captionTotalSeconds = rows.reduce((sum, r) => sum + r.workingTimeSeconds, 0);
  const captionRunsCount = rows.reduce((sum, r) => sum + r.totalRunCount, 0);
  const totalSuccessful = rows.reduce((sum, r) => sum + r.successfulRuns, 0);
  const captionSuccessRate = captionRunsCount > 0 ? totalSuccessful / captionRunsCount : 0;
  const captionAverageRunDurationSeconds = captionRunsCount > 0
    ? Math.floor(captionTotalSeconds / captionRunsCount)
    : 0;

  return {
    range,
    buckets,
    captionTotalSeconds,
    captionRunsCount,
    captionSuccessRate,
    captionAverageRunDurationSeconds,
  };
}

export async function getKnowledgeInUseProvenance(
  _agentId: string,
  _entryId: string,
  _ctx: PrincipalContext,
): Promise<{ entryId: string; provenance: Record<string, unknown> } | null> {
  return null;
}

// ---------------------------------------------------------------------------
// buildOverviewPayload
// ---------------------------------------------------------------------------

export async function buildOverviewPayload(
  agentId: string,
  ctx: PrincipalContext,
): Promise<OverviewPayload> {
  const db = getOrgScopedDb('agentOverviewAggregator.buildOverviewPayload');
  const organisationId = ctx.organisationId;
  const serverNow = new Date().toISOString();

  // Identity
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const agentRows = await db
    .select({
      id: agents.id,
      name: agents.name,
      agentRole: agents.agentRole,
      parentAgentId: agents.parentAgentId,
    })
    .from(agents)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.organisationId, organisationId),
        isNull(agents.deletedAt),
      ),
    )
    .limit(1);

  if (agentRows.length === 0) {
    throw { statusCode: 404, message: 'Agent not found' };
  }

  const agent = agentRows[0];

  // Presence
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const presenceRows = await db
    .select()
    .from(agentPresenceProjections)
    .where(
      and(
        eq(agentPresenceProjections.agentId, agentId),
        eq(agentPresenceProjections.organisationId, organisationId),
      ),
    )
    .limit(1);

  const presenceRow = presenceRows[0] ?? null;

  let elapsedSinceRunStartMs: number | null = null;
  if (presenceRow?.activeRunId) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const runRows = await db
      .select({ startedAt: agentRuns.startedAt })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, presenceRow.activeRunId),
          eq(agentRuns.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (runRows[0]?.startedAt) {
      elapsedSinceRunStartMs = Date.now() - new Date(runRows[0].startedAt).getTime();
    }
  }

  const presence = presenceRow
    ? {
        state: presenceRow.presenceState as AgentPresenceState,
        subtitle: presenceRow.presenceSubtitle ?? null,
        activeRunId: presenceRow.activeRunId ?? null,
        currentFocus: presenceRow.currentFocusText
          ? ({
              text: presenceRow.currentFocusText,
              truncated: false,
              fullText: presenceRow.currentFocusText,
              sourceEventId: presenceRow.currentFocusEventId ?? null,
              sourceKind: 'active_run_step' as const,
              serverNow,
              ageMs: presenceRow.updatedAt
                ? Date.now() - new Date(presenceRow.updatedAt).getTime()
                : 0,
            } satisfies CurrentFocus)
          : null,
        elapsedSinceRunStartMs,
        serverNow,
      }
    : {
        state: 'idle' as AgentPresenceState,
        subtitle: null,
        activeRunId: null,
        currentFocus: null,
        elapsedSinceRunStartMs: null,
        serverNow,
      };

  // Recent observations (top 3, non-superseded)
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const observationRows = await db
    .select()
    .from(agentObservations)
    .where(
      and(
        eq(agentObservations.agentId, agentId),
        eq(agentObservations.organisationId, organisationId),
        isNull(agentObservations.supersedesObservationId),
      ),
    )
    .orderBy(desc(agentObservations.createdAt), desc(agentObservations.id))
    .limit(3);

  const recentObservations: AgentObservation[] = observationRows.map(r => ({
    id: r.id,
    organisationId: r.organisationId,
    subaccountId: r.subaccountId ?? null,
    agentId: r.agentId,
    runId: r.runId ?? null,
    eventId: r.eventId,
    observationType: r.observationType as AgentObservation['observationType'],
    body: r.body,
    bodyTruncated: r.bodyTruncated,
    metadata: r.metadata as AgentObservation['metadata'],
    supersedesObservationId: r.supersedesObservationId ?? null,
    isPinned: r.isPinned,
    pinnedBy: r.pinnedBy ?? null,
    pinnedAt: r.pinnedAt ? (r.pinnedAt instanceof Date ? r.pinnedAt.toISOString() : String(r.pinnedAt)) : null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    idempotencyKey: r.idempotencyKey,
  }));

  // Most-recent run for this agent
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const recentRunRows = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentId, agentId),
        eq(agentRuns.organisationId, organisationId),
      ),
    )
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
    .limit(1);

  const mostRecentRunId = recentRunRows[0]?.id ?? null;

  // Has-completed-runs flag — drives the first-run vs live-presence branch on
  // AgentOverviewTab. "First run" means no completed runs yet, NOT just empty
  // observations / activity feed (an agent mid-run has neither but is not in
  // first-run state). Spec §13 / brief contract.
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const completedRunRows = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentId, agentId),
        eq(agentRuns.organisationId, organisationId),
        eq(agentRuns.status, 'completed'),
      ),
    )
    .limit(1);

  const hasCompletedRuns = completedRunRows.length > 0;

  // Knowledge in use (retrieval.summary events from most-recent run)
  let knowledgeInUse: KnowledgeInUseEntry[] = [];
  if (mostRecentRunId) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const knowledgeRows = await db
      .select({
        id: agentExecutionEvents.id,
        payload: agentExecutionEvents.payload,
        eventTimestamp: agentExecutionEvents.eventTimestamp,
        runId: agentExecutionEvents.runId,
      })
      .from(agentExecutionEvents)
      .where(
        and(
          eq(agentExecutionEvents.runId, mostRecentRunId),
          eq(agentExecutionEvents.organisationId, organisationId),
          eq(agentExecutionEvents.eventType, 'retrieval.summary'),
        ),
      )
      .orderBy(desc(agentExecutionEvents.eventTimestamp), desc(agentExecutionEvents.sequenceNumber))
      .limit(3);

    knowledgeInUse = knowledgeRows.map(r => {
      const payload = r.payload as Record<string, unknown>;
      return {
        id: r.id,
        title: (payload.title as string | undefined) ?? (payload.source_id as string | undefined) ?? r.id,
        sourceKind: (payload.source_kind as string | undefined) ?? 'unknown',
        retrievedAt: r.eventTimestamp instanceof Date ? r.eventTimestamp.toISOString() : String(r.eventTimestamp),
        runId: r.runId,
      };
    });
  }

  // Activity feed (top 5 events from most-recent run)
  let activityFeed: ActivityFeedRow[] = [];
  if (mostRecentRunId) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const activityRows = await db
      .select({
        id: agentExecutionEvents.id,
        eventType: agentExecutionEvents.eventType,
        eventTimestamp: agentExecutionEvents.eventTimestamp,
        runId: agentExecutionEvents.runId,
        sequenceNumber: agentExecutionEvents.sequenceNumber,
      })
      .from(agentExecutionEvents)
      .where(
        and(
          eq(agentExecutionEvents.runId, mostRecentRunId),
          eq(agentExecutionEvents.organisationId, organisationId),
        ),
      )
      .orderBy(desc(agentExecutionEvents.eventTimestamp), desc(agentExecutionEvents.sequenceNumber))
      .limit(5);

    activityFeed = activityRows.map(r => ({
      eventId: r.id,
      eventType: r.eventType,
      eventTimestamp: r.eventTimestamp instanceof Date ? r.eventTimestamp.toISOString() : String(r.eventTimestamp),
      runId: r.runId,
    }));
  }

  // Working time (today)
  const today = new Date().toISOString().slice(0, 10);
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const todayRollupRows = await db
    .select()
    .from(agentWorkingTimeRollups)
    .where(
      and(
        eq(agentWorkingTimeRollups.organisationId, organisationId),
        eq(agentWorkingTimeRollups.agentId, agentId),
        eq(agentWorkingTimeRollups.bucketDate, today),
      ),
    )
    .limit(1);

  const todayRollup = todayRollupRows[0] ?? null;
  const captionTotalSeconds = todayRollup?.workingTimeSeconds ?? 0;
  const captionRunsCount = todayRollup?.totalRunCount ?? 0;
  const totalSuccessful = todayRollup?.successfulRuns ?? 0;
  const captionSuccessRate = captionRunsCount > 0 ? totalSuccessful / captionRunsCount : 0;
  const captionAverageRunDurationSeconds = captionRunsCount > 0
    ? Math.floor(captionTotalSeconds / captionRunsCount)
    : 0;

  const workingTime = {
    range: 'today' as const,
    buckets: todayRollup
      ? [{ date: today, seconds: todayRollup.workingTimeSeconds }]
      : [],
    captionTotalSeconds,
    captionRunsCount,
    captionSuccessRate,
    captionAverageRunDurationSeconds,
  };

  return {
    identity: {
      id: agent.id,
      name: agent.name,
      role: agent.agentRole ?? '',
      reportsTo: agent.parentAgentId ?? null,
      subaccountId: null,
    },
    presence,
    activeGoals: [],
    recentObservations,
    knowledgeInUse,
    filesSnapshot: [],
    toolsUsageBands: {
      frequently: [],
      occasionally: [],
      rarely: [],
      asOf: serverNow,
    },
    schedulePeek: null,
    connectionsHealth: [],
    workingTime,
    activityFeed,
    hasCompletedRuns,
  };
}
