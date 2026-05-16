// server/services/correctionCaptureService.ts
// Operator correction capture — Stage 3 Trust & Verification Layer.
// Spec: §6.7 (memory_block shape), §10.1 (idempotency), §13.2 (capture flow).

import { sql, eq, and } from 'drizzle-orm';
import { withOrgTx } from '../instrumentation.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { memoryBlocks } from '../db/schema/memoryBlocks.js';
import { agentExecutionEvents } from '../db/schema/agentExecutionEvents.js';
import { agentRuns } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { tryEmitAgentEvent } from './agentExecutionEventEmitter.js';
import { scheduleForcedGrade } from './scorecardJudgeRunner.js';
import type { CorrectionDialogPayload, CorrectionResult } from '../../shared/types/correction.js';

// ── create ────────────────────────────────────────────────────────────────────

/**
 * Persists an operator correction as a memory block, emits a correction.captured
 * event, then fires a forced grade (no-op if no scorecards attached).
 *
 * Cross-entity guard: caller must verify that `eventId` belongs to `runId`
 * AND that `runId` belongs to `organisationId` before calling.
 */
export async function create(
  payload: CorrectionDialogPayload,
  organisationId: string,
  subaccountId: string | null,
): Promise<CorrectionResult> {
  const { runId, eventId, agentId, skillSlug, originalOutput, editedOutput, reason } = payload;

  const blockName = `correction:${agentId}:${skillSlug}:${runId}`;
  const blockContent = buildBlockContent({ skillSlug, originalOutput, editedOutput, reason });

  let memoryBlockId: string;

  // Phase 1: UPSERT inside withOrgTx so RLS GUC is set for the insert.
  await getOrgScopedDb('correctionCaptureService.create').transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);

    memoryBlockId = await withOrgTx(
      { tx, organisationId, source: 'correctionCaptureService.create' },
      async () => {
        const orgDb = getOrgScopedDb('correctionCaptureService.create');

        const [row] = await orgDb
          .insert(memoryBlocks)
          .values({
            organisationId,
            subaccountId,
            ownerAgentId: agentId,
            name: blockName,
            content: blockContent,
            capturedVia: 'operator_correction',
            confidence: 'low',
            qualityScore: '0.85',
            status: 'active',
            source: 'auto_synthesised',
            isReadOnly: false,
            sourceRunId: runId,
          })
          .onConflictDoUpdate({
            // Partial unique index on (organisation_id, source_run_id)
            // WHERE captured_via = 'operator_correction' AND deleted_at IS NULL.
            target: [memoryBlocks.organisationId, memoryBlocks.sourceRunId],
            targetWhere: sql`captured_via = 'operator_correction' AND deleted_at IS NULL`,
            set: {
              content: blockContent,
              confidence: 'low',
              qualityScore: '0.85',
              status: 'active',
              updatedAt: sql`now()`,
              deletedAt: null,
            },
          })
          .returning({ id: memoryBlocks.id });

        return row.id;
      },
    );
  });

  // Phase 2: schedule forced grade (no-op when agent has no scorecards attached).
  // Run BEFORE event emit so the event reflects final forcedGradeEnqueued state (B-2 fix).
  let forcedGradeEnqueued = false;
  try {
    await getOrgScopedDb('correctionCaptureService.forcedGrade').transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
      await withOrgTx(
        { tx, organisationId, source: 'correctionCaptureService.forcedGrade' },
        () => scheduleForcedGrade({
          runId,
          agentId,
          organisationId,
          triggerSource: 'forced_correction',
        }),
      );
    });
    forcedGradeEnqueued = true;
  } catch (err) {
    // Stage 2 soft dependency — log and continue.
    logger.warn('correctionCaptureService.forced_grade_failed', {
      runId, agentId, organisationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Phase 3: emit correction.captured with the final forcedGradeEnqueued value.
  tryEmitAgentEvent({
    runId,
    organisationId,
    subaccountId,
    sourceService: 'correctionCaptureService',
    payload: {
      eventType: 'correction.captured',
      critical: false,
      sourceRunId: runId,
      sourceEventId: eventId,
      skillSlug,
      memoryBlockId: memoryBlockId!,
      forcedGradeEnqueued,
    },
  });

  logger.info('correctionCaptureService.created', {
    runId, agentId, skillSlug, memoryBlockId: memoryBlockId!, forcedGradeEnqueued,
  });

  return { memoryBlockId: memoryBlockId!, forcedGradeEnqueued };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function buildBlockContent(args: {
  skillSlug: string;
  originalOutput: string;
  editedOutput: string;
  reason: string | null;
}): string {
  const lines: string[] = [
    `Skill: ${args.skillSlug}`,
    `Original output: ${args.originalOutput || '(empty)'}`,
    `Corrected output: ${args.editedOutput}`,
  ];
  if (args.reason) {
    lines.push(`Reason: ${args.reason}`);
  }
  return lines.join('\n');
}

// ── run-ownership lookup ─────────────────────────────────────────────────────

/**
 * Returns the run's owning subaccount + agent if the run exists AND belongs
 * to organisationId. Routes use this instead of a direct `db` import (gated
 * by `verify-rls-contract-compliance.sh`); the explicit `organisationId`
 * filter on every read keeps the contract closed regardless of RLS state.
 */
export async function getRunOwnership(
  runId: string,
  organisationId: string,
): Promise<{ subaccountId: string | null; agentId: string } | null> {
  const [row] = await getOrgScopedDb('correctionCaptureService.getRunOwnership')
    .select({
      subaccountId: agentRuns.subaccountId,
      agentId: agentRuns.agentId,
    })
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

// ── cross-entity verification helper ─────────────────────────────────────────

/**
 * Returns true iff eventId exists within runId AND runId belongs to organisationId.
 * Call before create() to satisfy the §9 multi-tenant safety checklist.
 */
export async function verifyEventBelongsToRun(
  eventId: string,
  runId: string,
  organisationId: string,
): Promise<boolean> {
  const [row] = await getOrgScopedDb('correctionCaptureService.verifyEventBelongsToRun')
    .select({ id: agentExecutionEvents.id })
    .from(agentExecutionEvents)
    .where(
      and(
        eq(agentExecutionEvents.id, eventId),
        eq(agentExecutionEvents.runId, runId),
        eq(agentExecutionEvents.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row !== undefined;
}
