export const IEE_SESSION_IDLE_TIMEOUT_SECONDS = 300;

export interface SessionSnapshot {
  status: 'active' | 'idle' | 'torn_down' | 'failed';
  lastHeartbeatAt: string | null;
  startedAt: string;
  releasedAt: string | null;
  idleTimeoutSeconds: number;
}

export type IdleDecision = 'keep' | 'tear_down';

export type TeardownReason =
  | 'run_completed'
  | 'idle_timeout'
  | 'orphan_cleanup'
  | 'failed'
  | 'operator_cancelled';

/**
 * Decides whether to tear down an idle session based on heartbeat age.
 */
export function decideIdleTimeout(session: SessionSnapshot, now: Date): IdleDecision {
  if (session.status !== 'active' && session.status !== 'idle') {
    return 'tear_down'; // already terminal — no-op
  }

  const lastHeartbeat = session.lastHeartbeatAt
    ? new Date(session.lastHeartbeatAt).getTime()
    : new Date(session.startedAt).getTime();

  const idleMs = now.getTime() - lastHeartbeat;
  const timeoutMs = session.idleTimeoutSeconds * 1000;

  return idleMs >= timeoutMs ? 'tear_down' : 'keep';
}

/**
 * Classifies a trigger event into a teardown reason.
 */
export function classifyTeardownReason(triggerEventType: string): TeardownReason {
  const map: Record<string, TeardownReason> = {
    run_completed: 'run_completed',
    run_failed: 'failed',
    run_cancelled: 'operator_cancelled',
    idle_timeout: 'idle_timeout',
    orphan_detected: 'orphan_cleanup',
  };
  return map[triggerEventType] ?? 'orphan_cleanup';
}

/**
 * Detects if a session is orphaned:
 * no heartbeat for > 2× idleTimeoutSeconds AND the run is in a terminal state.
 */
export function detectOrphan(session: SessionSnapshot, now: Date, runIsTerminal: boolean): boolean {
  if (session.status === 'torn_down' || session.status === 'failed') return false;
  if (!runIsTerminal) return false;

  const lastHeartbeat = session.lastHeartbeatAt
    ? new Date(session.lastHeartbeatAt).getTime()
    : new Date(session.startedAt).getTime();

  const idleMs = now.getTime() - lastHeartbeat;
  return idleMs > session.idleTimeoutSeconds * 1000 * 2;
}
