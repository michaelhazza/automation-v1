import { AGENT_PRESENCE_STATES, AgentPresenceState, PRESENCE_FRESHNESS_THRESHOLDS_MS } from '../../shared/types/agentPresence';

export interface PresenceInput {
  /** Most-recent agent_execution_events for this agent, ordered (event_timestamp ASC, event_id ASC) */
  events: Array<{
    id: string;
    eventType: string;
    eventTimestamp: string;
    runId: string | null;
    sequenceNumber: number | null;
    payload: unknown;
  }>;
  sessionState: {
    status: 'active' | 'idle' | 'torn_down' | 'failed' | null;
    lastHeartbeatAt: string | null;
    releasedAt: string | null;
  } | null;
  scheduleState: {
    nextRunAt: string | null;
    label: string | null;
  } | null;
  /** Server wall-clock now (ISO string) */
  serverNow: string;
}

export interface PresenceOutput {
  state: AgentPresenceState;
  subtitle: string | null;
  activeRunId: string | null;
  degradedReason: 'event_stream_delayed' | 'worker_heartbeat_stale' | 'focus_source_unavailable' | null;
  degradedBaseState: 'idle' | 'running' | 'waiting_on_human' | 'waiting_on_dependency' | 'scheduled' | null;
  lastEventTimestamp: string | null;
  nextRunAt: string | null;
  scheduledLabel: string | null;
}

/**
 * Pure resolver for AgentPresenceState.
 * Resolution order (first match wins):
 * 1. failed — terminal failure event present
 * 2. degraded — any degradation condition true AND no terminal failure
 * 3. waiting_on_human — active HITL gate
 * 4. running — active step in flight
 * 5. waiting_on_dependency — external wait
 * 6. scheduled — next run time known
 * 7. idle — none of above
 */
export function resolvePresenceFromEvents(input: PresenceInput): PresenceOutput {
  const { events, sessionState, scheduleState, serverNow } = input;
  const nowMs = new Date(serverNow).getTime();

  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const lastEventTimestamp = lastEvent?.eventTimestamp ?? null;

  // Detect terminal failure
  const hasFailed = events.some(e =>
    e.eventType === 'run_failed' || e.eventType === 'run_error' || e.eventType === 'run_terminated_with_error'
  ) || sessionState?.status === 'failed';

  if (hasFailed) {
    return {
      state: 'failed',
      subtitle: null,
      activeRunId: lastEvent?.runId ?? null,
      degradedReason: null,
      degradedBaseState: null,
      lastEventTimestamp,
      nextRunAt: null,
      scheduledLabel: null,
    };
  }

  // Detect active run (run_started but no run_completed/run_failed)
  const runStarted = events.filter(e => e.eventType === 'run_started');
  const runCompleted = new Set(
    events
      .filter(e => e.eventType === 'run_completed' || e.eventType === 'run_failed')
      .map(e => e.runId)
  );
  const activeRuns = runStarted.filter(e => e.runId && !runCompleted.has(e.runId));
  const activeRunId = activeRuns.length > 0 ? activeRuns[activeRuns.length - 1].runId : null;

  // Degradation check
  let degradedReason: PresenceOutput['degradedReason'] = null;
  if (activeRunId) {
    const activeRunEvents = events.filter(e => e.runId === activeRunId);
    const lastActiveEvent = activeRunEvents.at(-1);
    // event_stream_delayed fires only when no activity beyond run_started has been received —
    // steps in flight, HITL gates, and external calls indicate progress even if old
    const hasActivityBeyondStart = activeRunEvents.some(
      e => e.eventType !== 'run_started'
    );
    if (!hasActivityBeyondStart && lastActiveEvent) {
      const msSinceLastEvent = nowMs - new Date(lastActiveEvent.eventTimestamp).getTime();
      if (msSinceLastEvent > PRESENCE_FRESHNESS_THRESHOLDS_MS.EVENT_STREAM_DELAYED) {
        degradedReason = 'event_stream_delayed';
      }
    }
  }
  if (activeRunId && sessionState?.lastHeartbeatAt) {
    const msSinceHeartbeat = nowMs - new Date(sessionState.lastHeartbeatAt).getTime();
    if (msSinceHeartbeat > PRESENCE_FRESHNESS_THRESHOLDS_MS.WORKER_HEARTBEAT_STALE) {
      degradedReason = 'worker_heartbeat_stale';
    }
  }

  if (degradedReason) {
    // Determine what the base state would be without degradation
    let degradedBaseState: PresenceOutput['degradedBaseState'] = 'running';
    const lastRelevantEvent = events.filter(e => e.runId === activeRunId).at(-1);
    if (lastRelevantEvent) {
      if (lastRelevantEvent.eventType === 'hitl_gate_opened') degradedBaseState = 'waiting_on_human';
      else if (lastRelevantEvent.eventType === 'external_call_started' || lastRelevantEvent.eventType === 'sub_agent_delegated') degradedBaseState = 'waiting_on_dependency';
    }
    return {
      state: 'degraded',
      subtitle: 'Status uncertain',
      activeRunId,
      degradedReason,
      degradedBaseState,
      lastEventTimestamp,
      nextRunAt: null,
      scheduledLabel: null,
    };
  }

  // Active run states
  if (activeRunId) {
    const activeRunEvents = events.filter(e => e.runId === activeRunId);
    const lastActiveEvent = activeRunEvents.at(-1);
    if (lastActiveEvent) {
      if (lastActiveEvent.eventType === 'hitl_gate_opened') {
        return { state: 'waiting_on_human', subtitle: null, activeRunId, degradedReason: null, degradedBaseState: null, lastEventTimestamp, nextRunAt: null, scheduledLabel: null };
      }
      if (lastActiveEvent.eventType === 'external_call_started' || lastActiveEvent.eventType === 'sub_agent_delegated') {
        return { state: 'waiting_on_dependency', subtitle: null, activeRunId, degradedReason: null, degradedBaseState: null, lastEventTimestamp, nextRunAt: null, scheduledLabel: null };
      }
    }
    return { state: 'running', subtitle: null, activeRunId, degradedReason: null, degradedBaseState: null, lastEventTimestamp, nextRunAt: null, scheduledLabel: null };
  }

  // Scheduled
  if (scheduleState?.nextRunAt) {
    return {
      state: 'scheduled',
      subtitle: null,
      activeRunId: null,
      degradedReason: null,
      degradedBaseState: null,
      lastEventTimestamp,
      nextRunAt: scheduleState.nextRunAt,
      scheduledLabel: scheduleState.label,
    };
  }

  // Idle
  return {
    state: 'idle',
    subtitle: null,
    activeRunId: null,
    degradedReason: null,
    degradedBaseState: null,
    lastEventTimestamp,
    nextRunAt: null,
    scheduledLabel: null,
  };
}

/** Validates all values in AGENT_PRESENCE_STATES are handled (exhaustiveness check helper) */
export function assertExhaustivePresenceState(state: AgentPresenceState): never {
  throw new Error(`Unhandled presence state: ${state}`);
}
