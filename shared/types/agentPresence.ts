export const AGENT_PRESENCE_STATES = [
  'idle',
  'running',
  'waiting_on_human',
  'waiting_on_dependency',
  'scheduled',
  'degraded',
  'failed',
] as const;
export type AgentPresenceState = (typeof AGENT_PRESENCE_STATES)[number];

export const AGENT_DEGRADED_REASONS = [
  'event_stream_delayed',
  'worker_heartbeat_stale',
  'focus_source_unavailable',
] as const;
export type AgentDegradedReason = (typeof AGENT_DEGRADED_REASONS)[number];

export const AGENT_DEGRADED_BASE_STATES = [
  'idle',
  'running',
  'waiting_on_human',
  'waiting_on_dependency',
  'scheduled',
] as const;
export type AgentDegradedBaseState = (typeof AGENT_DEGRADED_BASE_STATES)[number];

export interface CurrentFocus {
  text: string;
  truncated: boolean;
  fullText: string;
  sourceEventId: string | null;
  sourceKind:
    | 'active_run_step'
    | 'pending_hitl_gate'
    | 'scheduled_next_run'
    | 'last_completed_run'
    | 'static_fallback';
  serverNow: string;
  ageMs: number;
}

export const PRESENCE_FRESHNESS_THRESHOLDS_MS = {
  EVENT_STREAM_DELAYED: 10_000,
  WORKER_HEARTBEAT_STALE: 30_000,
  FOCUS_LINE_STALE_COPY: 30_000,
  DEGRADED_HYSTERESIS: 10_000,
  DEGRADED_OSCILLATION_WINDOW: 30_000,
  DEGRADED_OSCILLATION_HOLD: 60_000,
} as const;
