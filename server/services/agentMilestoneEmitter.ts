/**
 * agentMilestoneEmitter.ts — deferred-emit helper for agent.milestone events.
 *
 * Wraps taskEventService.appendAndEmit with the correct event shape for
 * milestone attribution. Returns a deferred emit closure per the deferred-emit
 * pattern: callers inside an open transaction MUST call emit() after commit.
 *
 * Spec: docs/workflows-dev-spec.md §13 (per-agent milestone emission)
 */

import { TaskEventService } from './taskEventService.js';
import type { OrgScopedTx } from '../db/index.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface EmitMilestoneInput {
  taskId: string;
  organisationId: string;
  agentId: string;
  summary: string;
  linkRef?: { kind: string; id: string; label: string };
  tx?: OrgScopedTx;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Persist an `agent.milestone` event and return a deferred emit closure.
 *
 * Usage inside a transaction:
 *   const { emit } = await emitMilestone({ ..., tx });
 *   // commit the transaction
 *   await emit();
 *
 * Usage without a transaction (DB write commits immediately):
 *   await emitMilestone({ ... }); // emit is called internally before return
 */
export async function emitMilestone(input: EmitMilestoneInput): Promise<{ emit: () => Promise<void> }> {
  const result = await TaskEventService.appendAndEmit({
    taskId: input.taskId,
    runId: null,
    organisationId: input.organisationId,
    eventOrigin: 'orchestrator',
    event: {
      kind: 'agent.milestone',
      payload: {
        agentId: input.agentId,
        summary: input.summary,
        ...(input.linkRef !== undefined ? { linkRef: input.linkRef } : {}),
      },
    },
    tx: input.tx,
  });

  // When no transaction is provided, the write has already committed. Emit
  // immediately and return a no-op closure so callers can use a consistent
  // await emitMilestone(...) / then call emit() pattern interchangeably.
  if (!input.tx) {
    await result.emit();
    return { emit: async () => { /* already emitted */ } };
  }

  return { emit: result.emit };
}
