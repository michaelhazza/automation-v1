// ---------------------------------------------------------------------------
// stateMachineGuards — centralised assertion for run/step transitions
// ---------------------------------------------------------------------------
//
// Defence-in-depth guard for status-write boundaries on the three state
// machines that drive execution: agent_runs, workflow_runs, workflow_step_runs.
// Most call sites already gate writes with state-based UPDATE WHERE clauses
// (`inArray(status, [...non-terminal])`), but a no-op UPDATE is silent — it
// returns 0 rows but does not surface the contract violation. This helper
// makes the contract explicit and exception-raising at the call site so
// invalid transitions show up as caught errors and observable log lines
// rather than silent corruption.
//
// Scope (intentionally minimal):
//   - Once a record reaches a TERMINAL status, no further transitions are
//     permitted. Catches duplicate-terminal writes (e.g. completed→completed
//     with different payload) and post-terminal mutations (completed→failed),
//     which are the highest-blast-radius corruption modes.
//   - Same-state writes (`from === to`) are always allowed (idempotent retry).
//   - Transitions to unknown statuses are rejected.
//
// Intermediate (non-terminal → non-terminal) transitions are NOT validated
// here. The documented step/run lifecycles are covered by existing WHERE
// guards and a comprehensive transition table is out of scope.
// ---------------------------------------------------------------------------

import { TERMINAL_RUN_STATUSES, AGENT_RUN_STATUS } from './runStatus.js';

export type StateMachineKind = 'agent_run' | 'workflow_run' | 'workflow_step_run' | 'workflow_step_gate';

const AGENT_RUN_TERMINAL: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);
const AGENT_RUN_KNOWN: ReadonlySet<string> = new Set(Object.values(AGENT_RUN_STATUS));

export const WORKFLOW_RUN_TERMINAL: ReadonlySet<string> = new Set([
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'partial',
]);
const WORKFLOW_RUN_KNOWN: ReadonlySet<string> = new Set([
  'pending',
  'running',
  'paused',
  'awaiting_input',
  'awaiting_approval',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelling',
  'cancelled',
  'partial',
]);

// ---------------------------------------------------------------------------
// Workflow Step Gate machine
// ---------------------------------------------------------------------------
// States: 'null' (before creation), 'open' (resolvedAt IS NULL), 'resolved'
// Terminal: 'resolved'
// Forbidden: 'resolved' → *, 'null' → 'resolved' (must go null→open→resolved)
// ---------------------------------------------------------------------------

const WORKFLOW_STEP_GATE_TERMINAL: ReadonlySet<string> = new Set(['resolved']);
const WORKFLOW_STEP_GATE_KNOWN: ReadonlySet<string> = new Set(['null', 'open', 'resolved']);

const WORKFLOW_STEP_TERMINAL: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'skipped',
  'invalidated',
  'cancelled',
]);
const WORKFLOW_STEP_KNOWN: ReadonlySet<string> = new Set([
  'pending',
  'running',
  'awaiting_input',
  'awaiting_approval',
  'completed',
  'failed',
  'skipped',
  'invalidated',
  'cancelled',
]);

interface KindSets {
  terminal: ReadonlySet<string>;
  known: ReadonlySet<string>;
}

function setsForKind(kind: StateMachineKind): KindSets {
  switch (kind) {
    case 'agent_run':
      return { terminal: AGENT_RUN_TERMINAL, known: AGENT_RUN_KNOWN };
    case 'workflow_run':
      return { terminal: WORKFLOW_RUN_TERMINAL, known: WORKFLOW_RUN_KNOWN };
    case 'workflow_step_run':
      return { terminal: WORKFLOW_STEP_TERMINAL, known: WORKFLOW_STEP_KNOWN };
    case 'workflow_step_gate':
      return { terminal: WORKFLOW_STEP_GATE_TERMINAL, known: WORKFLOW_STEP_GATE_KNOWN };
  }
}

export class InvalidTransitionError extends Error {
  readonly kind: StateMachineKind;
  readonly recordId: string;
  readonly from: string;
  readonly to: string;

  constructor(message: string, kind: StateMachineKind, recordId: string, from: string, to: string) {
    super(message);
    this.name = 'InvalidTransitionError';
    this.kind = kind;
    this.recordId = recordId;
    this.from = from;
    this.to = to;
  }
}

export interface TransitionAssertion {
  kind: StateMachineKind;
  recordId: string;
  from: string;
  to: string;
}

/**
 * Assert that a state-machine transition is valid. Throws
 * `InvalidTransitionError` on violation; returns void on success.
 *
 * Pure (set lookups, no I/O) — safe to call inside a transaction immediately
 * before the UPDATE that performs the transition.
 */
export function assertValidTransition(t: TransitionAssertion): void {
  if (t.from === t.to) return;

  const { terminal, known } = setsForKind(t.kind);

  if (!known.has(t.to)) {
    throw new InvalidTransitionError(
      `Invalid ${t.kind} transition for ${t.recordId}: target status '${t.to}' is not in the canonical set`,
      t.kind,
      t.recordId,
      t.from,
      t.to,
    );
  }

  if (terminal.has(t.from)) {
    throw new InvalidTransitionError(
      `Invalid ${t.kind} transition for ${t.recordId}: '${t.from}' is terminal; cannot transition to '${t.to}'`,
      t.kind,
      t.recordId,
      t.from,
      t.to,
    );
  }
}

// ---------------------------------------------------------------------------
// Observability companion — for sites that cannot yet adopt the assertion
// ---------------------------------------------------------------------------

export interface TransitionEvent {
  kind: StateMachineKind;
  recordId: string;
  /**
   * Previous status. May be omitted at sites where the caller does not have
   * a row in scope (e.g. write-then-check using `.returning()`); consumers
   * read `from === undefined` as "not observed".
   */
  from?: string;
  to: string;
  /** Identifier for the call site, e.g. `agentExecutionService.finishLoop_normal`. */
  site: string;
  /** Whether this site has already enforced the transition via assertValidTransition. */
  guarded: boolean;
}

/**
 * Build a structured payload describing a status transition. Returned to
 * the caller so the calling module can log via its own logger; this keeps
 * `shared/` free of server/client logger dependencies.
 *
 * Usage:
 *   logger.info('state_transition', describeTransition({ ... }));
 *
 * Sites that go through assertValidTransition pass `guarded: true`. Sites
 * that have not yet adopted the assertion pass `guarded: false` so log
 * queries can distinguish enforced vs observed transitions and quantify
 * the remaining unguarded surface area.
 */
export function describeTransition(event: TransitionEvent): Record<string, unknown> {
  return {
    event: 'state_transition',
    kind: event.kind,
    recordId: event.recordId,
    from: event.from ?? null,
    to: event.to,
    site: event.site,
    guarded: event.guarded,
  };
}

// ---------------------------------------------------------------------------
// Gate-specific transition helpers
// ---------------------------------------------------------------------------

export type GateStatus = 'null' | 'open' | 'resolved';

/**
 * Assert that a workflow_step_gate transition is valid.
 *
 * Additional constraint beyond the base machine: 'null' → 'resolved' is
 * forbidden (must go null → open → resolved).
 */
export function assertValidGateTransition(
  gateId: string | null,
  from: GateStatus,
  to: GateStatus
): void {
  // The base machine already rejects resolved→* and unknown states.
  assertValidTransition({
    kind: 'workflow_step_gate',
    recordId: gateId ?? 'new',
    from,
    to,
  });

  // Extra gate-specific rule: null → resolved is forbidden.
  if (from === 'null' && to === 'resolved') {
    throw new InvalidTransitionError(
      `Invalid workflow_step_gate transition for ${gateId ?? 'new'}: 'null' → 'resolved' is forbidden — gate must pass through 'open' first`,
      'workflow_step_gate',
      gateId ?? 'new',
      from,
      to,
    );
  }
}
