// phase1RunTraceEventEmitter.ts — best-effort double-write helper for Phase 1
// run-rendered events (spec §3.5 / INV-16).
//
// Run-rendered events are the subset of `phase1.*` events that emit from inside
// an agent run and double as `agent_execution_events.event_type` discriminators.
// This helper writes a row to `agent_execution_events` so the outer-loop
// idempotency predicate (NOT EXISTS over the registered event types) can find it.
//
// Best-effort semantics: failures are caught and warn-logged. Callers always
// emit the structured log alongside; the double-write is additive durability.
//
// The helper uses a raw SQL INSERT to avoid extending the closed
// AgentExecutionEventPayload union for these new event types — they are
// validated at the call site by the structured-log shape.

import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';

/** Run-rendered Phase 1 event types — must match spec §3.5 registry. */
export type Phase1RunRenderedEventType =
  | 'phase1.macro.run_started'
  | 'phase1.macro.run_completed'
  | 'phase1.macro.artifact_delivered'
  | 'phase1.macro.login_failed'
  | 'phase1.macro.run_stuck'
  | 'phase1.macro.report_rendering_failed'
  | 'phase1.macro.artifact_upload_failed'
  | 'phase1.support.ticket_classified'
  | 'phase1.support.classify_failed'
  | 'phase1.support.draft_proposed'
  | 'phase1.support.draft_dispatched'
  | 'phase1.support.draft_blocked_by_policy'
  | 'phase1.support.collision_skipped'
  | 'phase1.support.ticket_terminal';

export interface Phase1RunRenderedEventInput {
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  eventType: Phase1RunRenderedEventType;
  payload: Record<string, unknown>;
  sourceService: string;
}

/**
 * Best-effort write to `agent_execution_events`. Allocates the next
 * `sequence_number` atomically from `agent_runs.next_event_seq` so concurrent
 * writes for the same run do not collide on the unique index.
 *
 * Runs inside the caller's open org-scoped transaction (via `getOrgScopedDb`)
 * so the `app.organisation_id` GUC is set and RLS policies on
 * `agent_execution_events` and `agent_runs` evaluate correctly. The double-write
 * is wrapped in a SAVEPOINT so a failure here only rolls back the savepoint —
 * the outer transaction's other work continues.
 *
 * On any failure (FK violation if no agent_runs row exists, transient DB error,
 * etc.), warn-logs and returns. The caller's structured-log emit is the
 * primary observability surface; this is the durability companion.
 *
 * NOTE: callers must already be inside a `withOrgTx(...)` block — typically
 * the outer tx opened by `createWorker` for pg-boss handlers, or the
 * `orgScoping` HTTP middleware.
 */
export async function emitPhase1RunRenderedEvent(
  input: Phase1RunRenderedEventInput,
): Promise<void> {
  let orgDb: ReturnType<typeof getOrgScopedDb>;
  try {
    orgDb = getOrgScopedDb('phase1RunTraceEventEmitter');
  } catch (err) {
    logger.warn('phase1.run_rendered_event_write_failed', {
      runId: input.runId,
      eventType: input.eventType,
      error: err instanceof Error ? err.message : String(err),
      reason: 'no_org_scope',
    });
    return;
  }

  await orgDb.execute(sql`SAVEPOINT phase1_event_emit`);
  try {
    const seqResult = await orgDb.execute<{
      next_event_seq: number;
      started_at: Date | null;
    }>(sql`UPDATE agent_runs
           SET next_event_seq = next_event_seq + 1, updated_at = NOW()
           WHERE id = ${input.runId}
           RETURNING next_event_seq, started_at`);
    const seqRows = Array.isArray(seqResult)
      ? seqResult
      : ((seqResult as { rows?: unknown[] }).rows ?? []);
    const seqRow = seqRows[0] as
      | { next_event_seq: number; started_at: Date | string | null }
      | undefined;
    if (!seqRow) {
      await orgDb.execute(sql`RELEASE SAVEPOINT phase1_event_emit`);
      return;
    }
    const sequenceNumber = Number(seqRow.next_event_seq);
    const startedAt = seqRow.started_at ? new Date(seqRow.started_at) : new Date();
    const durationMs = Math.max(0, Date.now() - startedAt.getTime());

    const payloadJson = JSON.stringify(input.payload);
    await orgDb.execute(sql`
      INSERT INTO agent_execution_events (
        run_id, organisation_id, subaccount_id,
        sequence_number, event_type, duration_since_run_start_ms,
        source_service, payload
      ) VALUES (
        ${input.runId},
        ${input.organisationId},
        ${input.subaccountId},
        ${sequenceNumber},
        ${input.eventType},
        ${durationMs},
        ${input.sourceService},
        ${payloadJson}::jsonb
      )
    `);
    await orgDb.execute(sql`RELEASE SAVEPOINT phase1_event_emit`);
  } catch (err) {
    try {
      await orgDb.execute(sql`ROLLBACK TO SAVEPOINT phase1_event_emit`);
      await orgDb.execute(sql`RELEASE SAVEPOINT phase1_event_emit`);
    } catch {
      // SAVEPOINT may already be torn down by an aborted outer tx; nothing to do.
    }
    logger.warn('phase1.run_rendered_event_write_failed', {
      runId: input.runId,
      eventType: input.eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
