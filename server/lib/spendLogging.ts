// ---------------------------------------------------------------------------
// spendLogging — structured logger for agent_charges state transitions
//
// Single-source-of-truth for transition log lines (invariant 31).
// Every writer (chargeRouterService, stripeAgentWebhookService, timeout/approval
// jobs, worker-completion handler) calls logChargeTransition — no transition
// is silent.
//
// Log levels per invariant 31:
//   INFO  — happy paths (approved, executed, succeeded, shadow_settled)
//   WARN  — blocked, denied, failed
//   ERROR — trigger rejections caught at the application layer
//
// Trace propagation (invariant 38):
//   withTrace(traceId, fn) attaches the traceId to async-local-storage so
//   downstream handlers can read it via getCurrentTraceId() without explicit
//   threading. Source: agent_runs.id for agent-run-initiated charges; new uuid
//   for direct-call retries.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from 'async_hooks';
import type { AgentChargeStatus, AgentChargeTransitionCaller } from '../../shared/stateMachineGuards.js';
import { logger, type LogLevel } from './logger.js';

// ── Async-local-storage for traceId ─────────────────────────────────────────

const traceStorage = new AsyncLocalStorage<string>();

/**
 * Run fn within an async context where getCurrentTraceId() returns traceId.
 * Used by chargeRouterService, stripeAgentWebhookService, and background jobs
 * so logChargeTransition automatically picks up the trace id without explicit
 * threading (invariant 38).
 */
export function withTrace<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
  return traceStorage.run(traceId, fn);
}

/** Read the current trace id from async-local-storage. Returns undefined outside a withTrace context. */
export function getCurrentTraceId(): string | undefined {
  return traceStorage.getStore();
}

// ── logChargeTransition ──────────────────────────────────────────────────────

export interface ChargeTransitionLogArgs {
  chargeId: string;
  /** Status before the transition. */
  from: AgentChargeStatus;
  /** Status after the transition. */
  to: AgentChargeStatus;
  /**
   * failure_reason for blocked/denied/failed outcomes; a label like
   * 'auto_approved' / 'webhook_succeeded' / 'worker_completed' for happy paths.
   */
  reason?: string | null;
  /** The value written to agent_charges.last_transition_by. */
  caller: AgentChargeTransitionCaller;
  /**
   * The value written to agent_charges.last_transition_event_id.
   * Stripe event id for webhook-driven transitions; pg-boss job id for jobs.
   * Omit or null for charge_router-driven transitions.
   */
  lastEventId?: string | null;
  /** Explicit trace id. Falls back to async-local-storage via getCurrentTraceId(). */
  traceId?: string;
  /** Override the auto-selected log level. Used for trigger-rejection ERROR lines. */
  level?: LogLevel;
}

/** Terminal states that warrant WARN-level logging (invariant 31). */
const WARN_STATES: ReadonlySet<AgentChargeStatus> = new Set<AgentChargeStatus>([
  'blocked',
  'denied',
  'failed',
]);

/**
 * Emit one structured log line for an agent_charges status transition.
 * Single authority for transition logging — every writer MUST call this
 * function (invariant 31). Never throws; logging failures are swallowed.
 */
export function logChargeTransition(args: ChargeTransitionLogArgs): void {
  try {
    const {
      chargeId,
      from,
      to,
      reason,
      caller,
      lastEventId,
      traceId: explicitTraceId,
      level: overrideLevel,
    } = args;

    const resolvedTraceId = explicitTraceId ?? getCurrentTraceId();

    const payload: Record<string, unknown> = {
      chargeId,
      from,
      to,
      caller,
    };

    if (reason != null) payload['reason'] = reason;
    if (lastEventId != null) payload['lastEventId'] = lastEventId;
    if (resolvedTraceId != null) payload['traceId'] = resolvedTraceId;

    const level: LogLevel =
      overrideLevel ??
      (WARN_STATES.has(to) ? 'warn' : 'info');

    logger[level]('charge_transition', payload);
  } catch {
    // Logging failures must never propagate to callers.
  }
}
