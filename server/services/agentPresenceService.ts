import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { agentPresenceProjections, agentExecutionEvents, agentRuns } from '../db/schema/index.js';
import { fanOut, fanOutToWorkspace } from './agentPresenceStreamPublisher.js';
import {
  resolvePresenceFromEvents,
  type PresenceInput,
} from './agentPresenceServicePure.js';
import type { AgentPresenceState } from '../../shared/types/agentPresence.js';
import type { AgentExecutionEvent, AgentExecutionEventType } from '../../shared/types/agentExecutionLog.js';
import type { AgentPresenceProjection } from '../db/schema/agentPresenceProjections.js';
import type { PrincipalContext } from './principal/types.js';

// ---------------------------------------------------------------------------
// Activity-feed-visible event types (spec §7.7)
// Used to gate the activity_row SSE fanOut below. Defined here because this is
// where agentId is already resolved (run-to-agent lookup), avoiding a redundant
// DB round-trip in the appendEvent hot path.
// ---------------------------------------------------------------------------
const ACTIVITY_FEED_VISIBLE_TYPES = new Set<AgentExecutionEventType>([
  'run.started',
  'run.completed',
  'run.event_limit_reached',
  'handoff.decided',
  'clarification.requested',
  'llm.completed',
  'skill.invoked',
  'skill.completed',
  'tool.error',
  'observation_emitted',
  'retrieval.summary',
]);

function isActivityFeedVisible(eventType: string): boolean {
  return ACTIVITY_FEED_VISIBLE_TYPES.has(eventType as AgentExecutionEventType);
}

// ---------------------------------------------------------------------------
// In-process monotonic-clock state for degraded-state hysteresis.
// Key: agentId
// ---------------------------------------------------------------------------
interface HysteresisEntry {
  degradedEnteredHrtime: bigint;
  oscillationWindowStartHrtime: bigint;
}

const hysteresisMap = new Map<string, HysteresisEntry>();

// ---------------------------------------------------------------------------
// Legal presence state transition table (§12.2)
// ---------------------------------------------------------------------------
const LEGAL_TRANSITIONS: Record<AgentPresenceState, ReadonlySet<AgentPresenceState>> = {
  idle: new Set<AgentPresenceState>(['running', 'scheduled', 'failed']),
  running: new Set<AgentPresenceState>(['waiting_on_human', 'waiting_on_dependency', 'idle', 'failed', 'degraded']),
  waiting_on_human: new Set<AgentPresenceState>(['running', 'idle', 'failed', 'degraded']),
  waiting_on_dependency: new Set<AgentPresenceState>(['running', 'idle', 'failed', 'degraded']),
  scheduled: new Set<AgentPresenceState>(['running', 'idle', 'failed']),
  degraded: new Set<AgentPresenceState>(['idle', 'running', 'waiting_on_human', 'waiting_on_dependency', 'scheduled', 'failed']),
  failed: new Set<AgentPresenceState>(['idle']),
};

function isLegalTransition(from: AgentPresenceState, to: AgentPresenceState): boolean {
  return LEGAL_TRANSITIONS[from]?.has(to) ?? false;
}

// ---------------------------------------------------------------------------
// resolveAgentPresence
// ---------------------------------------------------------------------------

export async function resolveAgentPresence(
  agentId: string,
  ctx: PrincipalContext,
): Promise<AgentPresenceProjection | null> {
  const db = getOrgScopedDb('agentPresenceService.resolveAgentPresence');
  const organisationId = ctx.organisationId;

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const rows = await db
    .select()
    .from(agentPresenceProjections)
    .where(
      and(
        eq(agentPresenceProjections.agentId, agentId),
        eq(agentPresenceProjections.organisationId, organisationId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// applyEventToPresence
// ---------------------------------------------------------------------------

export async function applyEventToPresence(
  event: AgentExecutionEvent,
  ctx: PrincipalContext,
): Promise<void> {
  const db = getOrgScopedDb('agentPresenceService.applyEventToPresence');
  const organisationId = ctx.organisationId;

  // Resolve agentId and subaccountId from the run
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const runRows = await db
    .select({ agentId: agentRuns.agentId, subaccountId: agentRuns.subaccountId })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, event.runId),
        eq(agentRuns.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (runRows.length === 0) return;
  const { agentId, subaccountId } = runRows[0];

  // Emit activity_row SSE event for activity-feed-visible event types (spec §7.7).
  // Fires regardless of whether the presence projection is actually updated —
  // activity feed reflects what's happening in the run, not just state transitions.
  if (isActivityFeedVisible(event.eventType)) {
    const activityEventTs = typeof event.eventTimestamp === 'string'
      ? event.eventTimestamp
      : new Date(event.eventTimestamp).toISOString();
    const activityEvent = {
      agentId,
      organisationId,
      eventTimestamp: activityEventTs,
      serverNow: new Date().toISOString(),
      eventId: randomUUID(),
      eventType: 'activity_row' as const,
      data: {
        eventId: event.id,
        eventType: event.eventType,
        eventTimestamp: activityEventTs,
        runId: event.runId,
        sequenceNumber: event.sequenceNumber,
      },
    };
    fanOut(activityEvent);
    if (subaccountId) {
      fanOutToWorkspace(subaccountId, activityEvent);
    }
  }

  // Fetch recent execution events for this agent to build PresenceInput.
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const recentEvents = await db
    .select({
      id: agentExecutionEvents.id,
      eventType: agentExecutionEvents.eventType,
      eventTimestamp: agentExecutionEvents.eventTimestamp,
      runId: agentExecutionEvents.runId,
      sequenceNumber: agentExecutionEvents.sequenceNumber,
      payload: agentExecutionEvents.payload,
    })
    .from(agentExecutionEvents)
    .where(
      and(
        eq(agentExecutionEvents.runId, event.runId),
        eq(agentExecutionEvents.organisationId, organisationId),
      ),
    )
    .orderBy(agentExecutionEvents.eventTimestamp, agentExecutionEvents.sequenceNumber)
    .limit(200);

  const presenceInput: PresenceInput = {
    events: recentEvents.map(row => ({
      id: row.id,
      eventType: row.eventType,
      eventTimestamp: row.eventTimestamp instanceof Date
        ? row.eventTimestamp.toISOString()
        : String(row.eventTimestamp),
      runId: row.runId,
      sequenceNumber: row.sequenceNumber,
      payload: row.payload,
    })),
    sessionState: null,
    scheduleState: null,
    serverNow: new Date().toISOString(),
  };

  const resolved = resolvePresenceFromEvents(presenceInput);
  const newState = resolved.state;

  // Hysteresis tracking via monotonic clock (process.hrtime.bigint())
  const now = process.hrtime.bigint();
  if (newState === 'degraded') {
    if (!hysteresisMap.has(agentId)) {
      hysteresisMap.set(agentId, {
        degradedEnteredHrtime: now,
        oscillationWindowStartHrtime: now,
      });
    }
  } else {
    hysteresisMap.delete(agentId);
  }

  // Read the current projection row to check the state transition and current focus
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const existing = await db
    .select({
      presenceState: agentPresenceProjections.presenceState,
      presenceSubtitle: agentPresenceProjections.presenceSubtitle,
    })
    .from(agentPresenceProjections)
    .where(
      and(
        eq(agentPresenceProjections.agentId, agentId),
        eq(agentPresenceProjections.organisationId, organisationId),
      ),
    )
    .limit(1);

  const currentState = existing[0]?.presenceState ?? null;
  const priorSubtitle = existing[0]?.presenceSubtitle ?? null;

  if (currentState !== null && !isLegalTransition(currentState as AgentPresenceState, newState)) {
    logger.warn('presence.illegal_transition_attempt', {
      agentId,
      from: currentState,
      to: newState,
      eventType: event.eventType,
      eventId: event.id,
    });
    return;
  }

  // §11.1 watermark upsert — latest-wins, with last_event_id as tiebreaker.
  // rowCount = 0 means the WHERE predicate blocked the update (out-of-order event);
  // SSE fanOut must only fire when the projection was actually written.
  const upsertResult = await db.execute(sql`
    INSERT INTO agent_presence_projections (
      agent_id,
      organisation_id,
      subaccount_id,
      presence_state,
      presence_subtitle,
      active_run_id,
      last_event_id,
      last_event_run_id,
      last_event_run_seq,
      last_event_timestamp,
      next_run_at,
      scheduled_label,
      degraded_reason,
      degraded_base_state,
      updated_at
    ) VALUES (
      ${agentId}::uuid,
      ${organisationId}::uuid,
      ${subaccountId}::uuid,
      ${newState},
      ${resolved.subtitle},
      ${resolved.activeRunId}::uuid,
      ${event.id}::uuid,
      ${event.runId}::uuid,
      ${event.sequenceNumber},
      ${event.eventTimestamp}::timestamptz,
      ${resolved.nextRunAt}::timestamptz,
      ${resolved.scheduledLabel},
      ${resolved.degradedReason},
      ${resolved.degradedBaseState},
      NOW()
    )
    ON CONFLICT (agent_id) DO UPDATE SET
      subaccount_id        = EXCLUDED.subaccount_id,
      presence_state       = EXCLUDED.presence_state,
      presence_subtitle    = EXCLUDED.presence_subtitle,
      active_run_id        = EXCLUDED.active_run_id,
      last_event_id        = EXCLUDED.last_event_id,
      last_event_run_id    = EXCLUDED.last_event_run_id,
      last_event_run_seq   = EXCLUDED.last_event_run_seq,
      last_event_timestamp = EXCLUDED.last_event_timestamp,
      next_run_at          = EXCLUDED.next_run_at,
      scheduled_label      = EXCLUDED.scheduled_label,
      degraded_reason      = EXCLUDED.degraded_reason,
      degraded_base_state  = EXCLUDED.degraded_base_state,
      updated_at           = EXCLUDED.updated_at
    WHERE
      EXCLUDED.last_event_timestamp > agent_presence_projections.last_event_timestamp
      OR (
        EXCLUDED.last_event_timestamp = agent_presence_projections.last_event_timestamp
        AND EXCLUDED.last_event_id > agent_presence_projections.last_event_id
      )
  `);

  if ((upsertResult as { rowCount?: number }).rowCount !== 1) {
    // Out-of-order event — projection row not updated; do not leak stale state to SSE subscribers.
    return;
  }

  const eventTimestamp = typeof event.eventTimestamp === 'string'
    ? event.eventTimestamp
    : new Date(event.eventTimestamp).toISOString();
  const serverNow = new Date().toISOString();

  const sseEvent = {
    agentId,
    organisationId,
    eventTimestamp,
    serverNow,
    eventId: event.id,
    eventType: 'presence_state_changed' as const,
    data: {
      agentId,
      presenceState: newState,
      degradedBaseState: resolved.degradedBaseState ?? null,
      nextRunAt: resolved.nextRunAt ?? null,
      updatedAt: serverNow,
    },
  };

  fanOut(sseEvent);
  if (subaccountId) {
    fanOutToWorkspace(subaccountId, sseEvent);
  }

  // Emit current_focus_updated when the subtitle (focus line) changes (spec §6.7)
  if (resolved.subtitle !== priorSubtitle) {
    const focusEvent = {
      agentId,
      organisationId,
      eventTimestamp,
      serverNow,
      eventId: event.id,
      eventType: 'current_focus_updated' as const,
      data: {
        agentId,
        currentFocus: resolved.subtitle,
      },
    };
    fanOut(focusEvent);
    if (subaccountId) {
      fanOutToWorkspace(subaccountId, focusEvent);
    }
  }
}
