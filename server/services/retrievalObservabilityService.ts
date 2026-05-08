// Retrieval observability — emits retrieval.summary events to agent_execution_events.
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §10.4, §11.4, §11.5

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import type { RetrievalResult } from '../../shared/types/retrieval.js';
import { agentExecutionEvents } from '../db/schema/agentExecutionEvents.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { logger } from '../lib/logger.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { computeDurationSinceRunStartMs } from './agentExecutionEventServicePure.js';

// Re-export constants so UI and other services have a single import point.
export {
  ALWAYS_AVAILABLE_DOC_COUNT_WARN,
  ALWAYS_AVAILABLE_TOKEN_COST_WARN,
} from './retrievalObservabilityServicePure.js';

export async function emitRetrievalSummary(input: {
  runId: string;
  organisationId: string;
  result: RetrievalResult;
  chunkConfig: { targetTokens: number; overlapTokens: number };
}): Promise<void> {
  const { runId, organisationId, result, chunkConfig } = input;
  const db = getOrgScopedDb('retrievalObservabilityService.emitRetrievalSummary');

  try {
    // Allocate a sequence number and insert atomically.
    await db.transaction(async (tx) => {
      const runRows = await tx
        .update(agentRuns)
        .set({ nextEventSeq: sql`${agentRuns.nextEventSeq} + 1` })
        .where(eq(agentRuns.id, runId))
        .returning({ nextEventSeq: agentRuns.nextEventSeq, startedAt: agentRuns.startedAt, subaccountId: agentRuns.subaccountId });

      if (runRows.length === 0) {
        throw new Error(`agent_runs row missing for runId=${runId}`);
      }

      const { nextEventSeq, startedAt, subaccountId } = runRows[0];
      const eventTimestamp = new Date();
      const durationSinceRunStartMs = computeDurationSinceRunStartMs(
        startedAt ? startedAt.getTime() : eventTimestamp.getTime(),
        eventTimestamp.getTime(),
      );

      await tx.insert(agentExecutionEvents).values({
        id: randomUUID(),
        runId,
        organisationId,
        subaccountId: subaccountId ?? null,
        sequenceNumber: nextEventSeq,
        eventType: 'retrieval.summary',
        eventTimestamp,
        durationSinceRunStartMs,
        sourceService: 'retrievalService',
        payload: { eventType: 'retrieval.summary', critical: false, result, chunkConfig } as unknown as Record<string, unknown>,
        linkedEntityType: null,
        linkedEntityId: null,
        eventSubsequence: 0,
        eventSchemaVersion: 1,
      });
    });
  } catch (err) {
    // Unique-violation 23505 — partial unique index on (run_id) WHERE event_type = 'retrieval.summary'.
    // Treat as idempotent hit; do not rethrow (spec §10.4).
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') {
      logger.debug('retrievalObservabilityService.summary_already_emitted', { runId });
      return;
    }
    logger.warn('retrievalObservabilityService.emit_failed', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
