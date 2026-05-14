/**
 * executionBackends/registry — singleton registry of registered adapters.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 8
 * (registry shape, validation, boot ordering).
 *
 * Pure registry — no I/O, no DB access. The boot path
 * (`server/index.ts`) registers each adapter once at startup; the dispatch
 * path (`agentExecutionService.ts` after Chunk 5) resolves an adapter by
 * id on every run.
 *
 * Invariants:
 *   - `register(b)` is the only path that mutates the internal map.
 *   - `resolve(id)` throws `BackendNotRegistered` on miss; never returns
 *     undefined. Callers narrow on the throw, not on a sentinel.
 *   - `register(b)` validates the adapter at registration time
 *     (capability + sandbox + queue/storage rules). Adapters that fail
 *     validation never reach dispatch.
 *
 * Imports allowed: `./types.js`, `shared/types/executionEnvironment.js`.
 * MUST NOT import from `agentExecutionService.ts` or anything DB-touching.
 */

import {
  BackendCapabilityViolation,
  BackendNotRegistered,
  BackendQueueOwnershipViolation,
  type ExecutionBackend,
  type ExecutionBackendId,
  type SandboxRequirement,
} from './types.js';
import type { ExecutionMode } from '../../../shared/types/executionEnvironment.js';

// ---------------------------------------------------------------------------
// Internal helpers — closed enum membership checks
// ---------------------------------------------------------------------------

/**
 * The `ExecutionMode` values that V1 adapters MAY register under.
 * Mirrors the canonical union in `shared/types/executionEnvironment.ts`;
 * kept inline here as a value-level set so registration validation can run
 * a runtime membership check.
 *
 * Operator Backend forward-compat ids (`'operator_external'`) are reserved
 * type slots and rejected at runtime registration in V1; the operator_external
 * adapter lands in Phase 5.
 */
const EXECUTION_MODES: ReadonlySet<ExecutionMode> = new Set<ExecutionMode>([
  'api',
  'headless',
  'claude-code',
  'iee_browser',
  'iee_dev',
  'operator_managed',
]);

const SANDBOX_REQUIREMENTS: ReadonlySet<SandboxRequirement> = new Set<SandboxRequirement>([
  'none',
  'browser',
  'code_execution',
  'terminal_repo',
]);

function isExecutionMode(id: string): id is ExecutionMode {
  return EXECUTION_MODES.has(id as ExecutionMode);
}

// ---------------------------------------------------------------------------
// ExecutionBackendRegistry
// ---------------------------------------------------------------------------

export class ExecutionBackendRegistry {
  private readonly backends = new Map<ExecutionBackendId, ExecutionBackend>();

  /**
   * Register an adapter. Validates the adapter against the spec § 8.2
   * rules; throws `BackendCapabilityViolation` /
   * `BackendQueueOwnershipViolation` on contract failures. Idempotent —
   * registering the same id twice with the same instance is a no-op;
   * registering a different instance under an already-registered id
   * throws `BackendCapabilityViolation`.
   */
  register(backend: ExecutionBackend): void {
    this.validate(backend);

    const existing = this.backends.get(backend.id);
    if (existing && existing !== backend) {
      throw new BackendCapabilityViolation(
        `adapter id '${backend.id}' is already registered with a different instance; ` +
          `each adapter id must be registered exactly once`,
      );
    }

    this.backends.set(backend.id, backend);
  }

  /**
   * Resolve an adapter by id. Throws `BackendNotRegistered` on miss;
   * never returns undefined.
   *
   * Accepts `ExecutionBackendId` (the wider type) so finalisation /
   * reconciliation paths reading `agent_runs.backend_id` (a `text` column
   * that may carry a future variant id in Phase 5+) type-check
   * cleanly. Dispatch callers passing an `ExecutionMode` value are
   * type-compatible because `ExecutionMode` is a subtype of
   * `ExecutionBackendId`.
   */
  resolve(id: ExecutionBackendId): ExecutionBackend {
    const backend = this.backends.get(id);
    if (!backend) {
      throw new BackendNotRegistered(id);
    }
    return backend;
  }

  /** Iterate every registered adapter. Used by boot-time instrumentation / logs. */
  forEach(callback: (backend: ExecutionBackend) => void): void {
    for (const backend of this.backends.values()) {
      callback(backend);
    }
  }

  /**
   * Return every registered adapter declaring the `'delegated'`
   * capability. Used by `reconcileBackends()` (spec § 9.2) to walk every
   * delegated backend on each cron tick.
   */
  forDelegated(): ExecutionBackend[] {
    const result: ExecutionBackend[] = [];
    for (const backend of this.backends.values()) {
      if (backend.capabilities.includes('delegated')) {
        result.push(backend);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Validation (spec § 8.2)
  // -------------------------------------------------------------------------

  private validate(backend: ExecutionBackend): void {
    // Rule 1: V1-only restriction — id MUST be a valid ExecutionMode value.
    // Operator Backend forward-compat ids (e.g. 'operator_external') are
    // reserved type slots and rejected at runtime registration in V1;
    // the operator_external adapter lands in Phase 5.
    if (!isExecutionMode(backend.id)) {
      throw new BackendCapabilityViolation(
        `adapter id '${backend.id}' is not a valid ExecutionMode value; ` +
          `V1 accepts 'api' | 'headless' | 'claude-code' | 'iee_browser' | 'iee_dev' | 'operator_managed'. ` +
          `operator_external is reserved for Phase 5.`,
      );
    }

    // Rule 4: sandboxRequirement membership.
    if (!SANDBOX_REQUIREMENTS.has(backend.sandboxRequirement)) {
      throw new BackendCapabilityViolation(
        `adapter '${backend.id}' declares sandboxRequirement='${backend.sandboxRequirement}' ` +
          `which is not a valid SandboxRequirement value`,
      );
    }

    // Rule 2: 'delegated' implies the full delegated lifecycle is wired.
    if (backend.capabilities.includes('delegated')) {
      const missing: string[] = [];
      if (backend.completedEventQueue == null) missing.push('completedEventQueue');
      if (backend.terminalStateTable == null) missing.push('terminalStateTable');
      if (backend.completedEventPayload == null) missing.push('completedEventPayload');
      if (typeof backend.loadTerminalState !== 'function') missing.push('loadTerminalState');
      if (typeof backend.finalise !== 'function') missing.push('finalise');
      if (typeof backend.reconcile !== 'function') missing.push('reconcile');
      if (missing.length > 0) {
        throw new BackendCapabilityViolation(
          `adapter '${backend.id}' declares 'delegated' capability but is missing: ` +
            missing.join(', '),
        );
      }
    }

    // Rule 3: 'cancellation' implies cancel() is defined.
    if (
      backend.capabilities.includes('cancellation') &&
      typeof backend.cancel !== 'function'
    ) {
      throw new BackendCapabilityViolation(
        `adapter '${backend.id}' declares 'cancellation' capability but cancel() is not defined`,
      );
    }

    // Rule 5: same-queue MUST share storage.
    // Two adapters MAY share `completedEventQueue` if and only if they
    // share `terminalStateTable`. Same-queue + different-storage is
    // rejected so the queue's single consumer (the shared event handler)
    // cannot be forced to dispatch to disjoint tables.
    if (backend.completedEventQueue != null) {
      for (const existing of this.backends.values()) {
        if (existing.completedEventQueue !== backend.completedEventQueue) continue;
        if (existing.terminalStateTable !== backend.terminalStateTable) {
          throw new BackendQueueOwnershipViolation(
            `adapter '${backend.id}' shares completedEventQueue='${backend.completedEventQueue}' ` +
              `with adapter '${existing.id}' but declares a different terminalStateTable ` +
              `('${backend.terminalStateTable}' vs '${existing.terminalStateTable}'). ` +
              `Adapters sharing a queue MUST share storage (spec § 13.4 / § 8.2).`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton — registered against by `server/index.ts` at boot.
// ---------------------------------------------------------------------------

export const executionBackendRegistry = new ExecutionBackendRegistry();
