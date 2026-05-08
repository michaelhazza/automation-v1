import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { agentPresenceProjections, agentExecutionEvents, agentRuns } from '../db/schema/index.js';
import {
  resolvePresenceFromEvents,
  type PresenceInput,
} from './agentPresenceServicePure.js';
import type { AgentPresenceState } from '../../shared/types/agentPresence.js';
import type { AgentExecutionEvent } from '../../shared/types/agentExecutionLog.js';
import type { AgentPresenceProjection } from '../db/schema/agentPresenceProjections.js';
import type { PrincipalContext } from './principal/types.js';

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

  // Resolve agentId from the run
  const runRows = await db
    .select({ agentId: agentRuns.agentId })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, event.runId),
        eq(agentRuns.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (runRows.length === 0) return;
  const agentId = runRows[0].agentId;

  // Fetch recent execution events for this agent to build PresenceInput.
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

  // Read the current projection row to check the state transition
  const existing = await db
    .select({
      presenceState: agentPresenceProjections.presenceState,
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

  // §11.1 watermark upsert — latest-wins, with last_event_id as tiebreaker
  await db.execute(sql`
    INSERT INTO agent_presence_projections (
      agent_id,
      organisation_id,
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
}
