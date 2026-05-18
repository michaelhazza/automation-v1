// ---------------------------------------------------------------------------
// waitpointService.ts
//
// Generalised pause/resume primitive — createWaitpoint, completeWaitpoint,
// expireWaitpoints.
//
// Spec: docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md §5.1-§5.3
//
// Admin-role org-predicate invariant (§5.3 + §16):
//   expireWaitpoints uses withAdminConnection. The FIRST statement inside the
//   callback MUST be SET LOCAL ROLE admin_role (bypasses FORCE RLS on waitpoints).
//   Every downstream SELECT and UPDATE MUST carry an explicit organisation_id
//   predicate to preserve the tenant boundary the RLS policy would otherwise
//   enforce. A bare WHERE id = $1 crosses orgs under admin_role — never write that.
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
// guard-ignore-next-line: with-org-tx-or-scoped-db reason="cross-tenant sweep"
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { waitpoints } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { sendWithTx } from '../lib/pgBossTxSend.js';
import { getJobConfig, type JobName } from '../config/jobConfig.js';
import { buildFailStepRunColumnSet } from './workflowEngine/stepLifecyclePure.js';
import {
  generateWaitpointPlaintext,
  validateCreateWaitpointParams,
  validateCompleteInputShapeMatchesKind,
  deriveTokenHash,
  type CreateWaitpointParams,
} from './waitpointServicePure.js';

export type { CreateWaitpointParams };

export interface TxHandle {
  execute: (q: ReturnType<typeof sql>) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// createWaitpoint
// ---------------------------------------------------------------------------

export async function createWaitpoint(
  params: CreateWaitpointParams,
  opts?: { tx?: TxHandle },
): Promise<{ id: string; plaintext: string; expiresAt: Date }> {
  validateCreateWaitpointParams(params);

  const plaintext = generateWaitpointPlaintext();
  const tokenHash = deriveTokenHash(plaintext);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + params.expiresInSeconds * 1000);

  const row = {
    id: tokenHash,
    kind: params.kind,
    organisationId: params.organisationId,
    subaccountId: params.subaccountId ?? null,
    boundRunId: params.boundRunId ?? null,
    expiresAt,
    status: 'pending' as const,
    resumeQueue: params.resumeQueue,
    resumePayload: params.resumePayload,
  };

  const doInsert = async (tx: { insert: typeof import('../db/index.js').db.insert }) => {
    await tx.insert(waitpoints).values(row);
  };

  if (opts?.tx) {
    // Caller provides a transaction handle (TxHandle shape from sendWithTx contract).
    // We need to use raw SQL to stay within the TxHandle interface.
    await opts.tx.execute(sql`
      INSERT INTO waitpoints
        (id, kind, organisation_id, subaccount_id, bound_run_id, expires_at, status,
         resume_queue, resume_payload, created_at)
      VALUES
        (${tokenHash}, ${params.kind}, ${params.organisationId}::uuid,
         ${params.subaccountId ?? null}::uuid, ${params.boundRunId ?? null}::uuid,
         ${expiresAt.toISOString()}::timestamptz, 'pending',
         ${params.resumeQueue}, ${JSON.stringify(params.resumePayload)}::jsonb,
         now())
    `);
  } else {
    const scopedDb = getOrgScopedDb('waitpointService.createWaitpoint');
    await doInsert(scopedDb as unknown as { insert: typeof import('../db/index.js').db.insert });
  }

  // Emit waitpoint.created post-insert.
  // Per spec §9: live execution log only when bound_run_id is set (oauth kind).
  logger.info('waitpoint.created', {
    event: 'waitpoint.created',
    waitpointId: tokenHash,
    kind: params.kind,
    organisationId: params.organisationId,
    boundRunId: params.boundRunId ?? null,
    expiresAt: expiresAt.toISOString(),
    // plaintext is NEVER included in telemetry (spec §8.1)
  });

  return { id: tokenHash, plaintext, expiresAt };
}

// ---------------------------------------------------------------------------
// completeWaitpoint
// ---------------------------------------------------------------------------

export async function completeWaitpoint(
  params:
    | { plaintext: string; organisationId: string; tx?: TxHandle }
    | { waitpointId: string; organisationId: string; tx?: TxHandle },
): Promise<{ status: 'completed' | 'already_completed' }> {
  const inputShape = 'plaintext' in params ? 'plaintext' : 'waitpointId';
  const resolvedId =
    inputShape === 'plaintext'
      ? deriveTokenHash((params as { plaintext: string }).plaintext)
      : (params as { waitpointId: string }).waitpointId;
  const { organisationId } = params;

  const runComplete = async (
    tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  ): Promise<{ status: 'completed' | 'already_completed' }> => {
    // Optimistic UPDATE: only succeeds if pending and not yet expired.
    const updated = (await tx.execute(sql`
      UPDATE waitpoints
      SET status = 'completed', completed_at = now()
      WHERE id = ${resolvedId}
        AND organisation_id = ${organisationId}::uuid
        AND status = 'pending'
        AND expires_at > now()
      RETURNING id, kind, resume_queue, resume_payload, bound_run_id
    `)) as unknown as
      | Array<{ id: string; kind: string; resume_queue: string | null; resume_payload: unknown; bound_run_id: string | null }>
      | { rows?: Array<{ id: string; kind: string; resume_queue: string | null; resume_payload: unknown; bound_run_id: string | null }> };

    const updatedRows = Array.isArray(updated)
      ? updated
      : Array.isArray((updated as { rows?: unknown[] }).rows)
        ? (updated as { rows: Array<{ id: string; kind: string; resume_queue: string | null; resume_payload: unknown; bound_run_id: string | null }> }).rows
        : [];

    if (updatedRows.length === 0) {
      // 0 rows updated — read row to determine the closed-set state mapping (spec §5.2).
      const existing = (await tx.execute(sql`
        SELECT status, expires_at
        FROM waitpoints
        WHERE id = ${resolvedId}
          AND organisation_id = ${organisationId}::uuid
        LIMIT 1
      `)) as unknown as
        | Array<{ status: string; expires_at: string }>
        | { rows?: Array<{ status: string; expires_at: string }> };

      const existingRows = Array.isArray(existing)
        ? existing
        : Array.isArray((existing as { rows?: unknown[] }).rows)
          ? (existing as { rows: Array<{ status: string; expires_at: string }> }).rows
          : [];

      if (existingRows.length > 0 && existingRows[0].status === 'completed') {
        return { status: 'already_completed' };
      }

      // status='expired', status='pending' with expires_at <= now(), or row missing —
      // all map to RESUME_TOKEN_EXPIRED (HTTP 410) per spec §5.2 closed-set mapping.
      throw Object.assign(
        new Error('Resume token expired or invalid'),
        { statusCode: 410, errorCode: 'RESUME_TOKEN_EXPIRED' as const },
      );
    }

    const updatedRow = updatedRows[0];
    const rowKind = updatedRow.kind as 'oauth' | 'approval' | 'external_event';

    // Defence in depth: verify input shape matches row kind (Round 2 finding 5).
    validateCompleteInputShapeMatchesKind(inputShape, rowKind);

    // Per-kind resume behaviour (spec §5.2 "1 row updated" path).
    if (rowKind === 'oauth') {
      if (updatedRow.resume_queue === null) {
        // CHECK constraint guarantees this cannot happen, but TypeScript sees
        // resume_queue as nullable. Fail-closed per spec §5.2 and risks table.
        throw Object.assign(
          new Error('oauth waitpoint has null resume_queue — CHECK constraint violated'),
          { statusCode: 500, errorCode: 'INTERNAL_ERROR' as const },
        );
      }

      const resumeQueue = updatedRow.resume_queue;
      const jobCfg = getJobConfig(resumeQueue as JobName);
      const resumePayload = updatedRow.resume_payload as { runId: string };
      const queueOptions = {
        retryLimit: jobCfg.retryLimit,
        expireInSeconds: jobCfg.expireInSeconds,
        priority: (jobCfg as { priority?: number }).priority,
        singletonKey: resumePayload.runId,
        // deadLetter is NOT forwarded — it is a processor-creation option, not
        // a per-job-row option (spec §5.2).
      };

      await sendWithTx(tx, resumeQueue, resumePayload, queueOptions);
    }
    // kind='approval': NO enqueue (Path B — inline resume via reviewService).
    // kind='external_event': V1 dormant — no side effects.

    return { status: 'completed' };
  };

  let result: { status: 'completed' | 'already_completed' };

  if (params.tx) {
    result = await runComplete(params.tx);
  } else {
    const scopedDb = getOrgScopedDb('waitpointService.completeWaitpoint');
    result = await scopedDb.transaction(async (tx) => {
      return runComplete(tx as unknown as { execute: (q: ReturnType<typeof sql>) => Promise<unknown> });
    });
  }

  if (result.status === 'completed') {
    logger.info('waitpoint.completed', {
      event: 'waitpoint.completed',
      waitpointId: resolvedId,
      organisationId,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// expireWaitpoints
// ---------------------------------------------------------------------------

export async function expireWaitpoints(): Promise<{ expiredCount: number }> {
  const now = new Date();
  let expiredCount = 0;

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="cross-tenant sweep"
  await withAdminConnection(
    {
      source: 'waitpointService.expireWaitpoints',
      reason: 'Bulk-expire pending waitpoints whose expires_at < now() across all orgs',
    },
    async (tx) => {
      // INVARIANT: SET LOCAL ROLE admin_role MUST be the first statement inside
      // withAdminConnection to bypass FORCE RLS on the waitpoints table.
      // Without this, the UPDATE would see zero rows (fail-closed RLS).
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Step 1: bulk-transition pending rows whose expiry has passed.
      const expired = (await tx.execute(sql`
        UPDATE waitpoints
        SET status = 'expired'
        WHERE status = 'pending'
          AND expires_at < ${now.toISOString()}::timestamptz
        RETURNING
          id,
          kind,
          organisation_id,
          bound_run_id,
          resume_payload
      `)) as unknown as
        | Array<{ id: string; kind: string; organisation_id: string; bound_run_id: string | null; resume_payload: unknown }>
        | { rows?: Array<{ id: string; kind: string; organisation_id: string; bound_run_id: string | null; resume_payload: unknown }> };

      const expiredRows = Array.isArray(expired)
        ? expired
        : Array.isArray((expired as { rows?: unknown[] }).rows)
          ? (expired as { rows: Array<{ id: string; kind: string; organisation_id: string; bound_run_id: string | null; resume_payload: unknown }> }).rows
          : [];

      expiredCount = expiredRows.length;

      // Step 2: per-row downstream cleanup.
      // INVARIANT: every SELECT and UPDATE below MUST carry AND organisation_id = wp.organisation_id
      // to preserve the org boundary that FORCE RLS would otherwise enforce.
      for (const wp of expiredRows) {
        const orgId = wp.organisation_id;

        if (wp.kind === 'oauth') {
          if (!wp.bound_run_id) {
            logger.info('waitpoint.expired_no_run', {
              event: 'waitpoint.expired_no_run',
              waitpointId: wp.id,
              kind: wp.kind,
              organisationId: orgId,
            });
            continue;
          }

          // Read current status to capture $observed for assertValidTransition.
          const runs = (await tx.execute(sql`
            SELECT id, status
            FROM agent_runs
            WHERE id = ${wp.bound_run_id}::uuid
              AND organisation_id = ${orgId}::uuid
            LIMIT 1
          `)) as unknown as
            | Array<{ id: string; status: string }>
            | { rows?: Array<{ id: string; status: string }> };

          const runRows = Array.isArray(runs)
            ? runs
            : Array.isArray((runs as { rows?: unknown[] }).rows)
              ? (runs as { rows: Array<{ id: string; status: string }> }).rows
              : [];

          if (runRows.length === 0) {
            logger.info('waitpoint.expired_no_run', {
              event: 'waitpoint.expired_no_run',
              waitpointId: wp.id,
              kind: wp.kind,
              organisationId: orgId,
              boundRunId: wp.bound_run_id,
            });
            continue;
          }

          const run = runRows[0];

          const updatedRun = (await tx.execute(sql`
            UPDATE agent_runs
            SET
              status = 'cancelled',
              run_result_status = 'failed',
              blocked_reason = NULL,
              blocked_expires_at = NULL,
              integration_resume_token = NULL,
              completed_at = ${now.toISOString()}::timestamptz,
              updated_at = ${now.toISOString()}::timestamptz,
              run_metadata = jsonb_set(
                COALESCE(run_metadata, '{}'::jsonb),
                '{cancelReason}',
                '"integration_connect_timeout"'::jsonb
              )
            WHERE id = ${wp.bound_run_id}::uuid
              AND organisation_id = ${orgId}::uuid
              AND status = ${run.status}
            RETURNING id
          `)) as unknown as
            | Array<{ id: string }>
            | { rows?: Array<{ id: string }> };

          const updatedRunRows = Array.isArray(updatedRun)
            ? updatedRun
            : Array.isArray((updatedRun as { rows?: unknown[] }).rows)
              ? (updatedRun as { rows: Array<{ id: string }> }).rows
              : [];

          if (updatedRunRows.length === 1) {
            logger.info('state_transition', {
              kind: 'agent_run',
              recordId: run.id,
              from: run.status,
              to: 'cancelled',
              site: 'waitpointService.expireWaitpoints',
              guarded: true,
            });
            logger.info('waitpoint.expired', {
              event: 'waitpoint.expired',
              waitpointId: wp.id,
              kind: wp.kind,
              organisationId: orgId,
              boundRunId: wp.bound_run_id,
            });
          }

        } else if (wp.kind === 'approval') {
          const resumePayload = wp.resume_payload as Record<string, unknown>;
          const stepRunId = resumePayload.workflowStepRunId as string | undefined;

          if (!stepRunId) {
            logger.info('waitpoint.expired_no_step', {
              event: 'waitpoint.expired_no_step',
              waitpointId: wp.id,
              kind: wp.kind,
              organisationId: orgId,
              reason: 'missing workflowStepRunId in resumePayload',
            });
            continue;
          }

          // Read the step run + parent run (needed for workflow-run-tick enqueue).
          const stepRuns = (await tx.execute(sql`
            SELECT sr.id, sr.version, sr.status, sr.run_id, wr.id AS run_id_check, wr.organisation_id AS wr_org_id
            FROM workflow_step_runs sr
            JOIN workflow_runs wr ON sr.run_id = wr.id
            WHERE sr.id = ${stepRunId}::uuid
              AND wr.organisation_id = ${orgId}::uuid
              AND sr.status = 'awaiting_approval'
            LIMIT 1
          `)) as unknown as
            | Array<{ id: string; version: number; status: string; run_id: string; wr_org_id: string }>
            | { rows?: Array<{ id: string; version: number; status: string; run_id: string; wr_org_id: string }> };

          const stepRunRows = Array.isArray(stepRuns)
            ? stepRuns
            : Array.isArray((stepRuns as { rows?: unknown[] }).rows)
              ? (stepRuns as { rows: Array<{ id: string; version: number; status: string; run_id: string; wr_org_id: string }> }).rows
              : [];

          if (stepRunRows.length === 0) {
            logger.info('waitpoint.expired_no_step', {
              event: 'waitpoint.expired_no_step',
              waitpointId: wp.id,
              kind: wp.kind,
              organisationId: orgId,
              stepRunId,
              reason: 'step run not found, already terminal, or cross-org',
            });
            continue;
          }

          const sr = stepRunRows[0];
          const cols = buildFailStepRunColumnSet('approval_timed_out', sr.version, now);

          const updatedStep = (await tx.execute(sql`
            UPDATE workflow_step_runs sr
            SET
              status = ${cols.status},
              error = ${cols.error},
              completed_at = ${cols.completedAt.toISOString()}::timestamptz,
              version = ${cols.version},
              updated_at = ${cols.updatedAt.toISOString()}::timestamptz
            FROM workflow_runs wr
            WHERE sr.id = ${stepRunId}::uuid
              AND sr.run_id = wr.id
              AND wr.organisation_id = ${orgId}::uuid
              AND sr.status = 'awaiting_approval'
            RETURNING sr.id, wr.id AS workflow_run_id
          `)) as unknown as
            | Array<{ id: string; workflow_run_id: string }>
            | { rows?: Array<{ id: string; workflow_run_id: string }> };

          const updatedStepRows = Array.isArray(updatedStep)
            ? updatedStep
            : Array.isArray((updatedStep as { rows?: unknown[] }).rows)
              ? (updatedStep as { rows: Array<{ id: string; workflow_run_id: string }> }).rows
              : [];

          if (updatedStepRows.length === 1) {
            const workflowRunId = updatedStepRows[0].workflow_run_id ?? sr.run_id;
            const tickCfg = getJobConfig('workflow-run-tick');
            await sendWithTx(
              tx as unknown as { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
              'workflow-run-tick',
              { runId: workflowRunId },
              {
                retryLimit: tickCfg.retryLimit,
                expireInSeconds: tickCfg.expireInSeconds,
                singletonKey: workflowRunId,
                // deadLetter not forwarded (processor-creation option, not per-job-row).
                // useSingletonQueue is a pg-boss options flag not part of sendWithTx contract.
              },
            );
            logger.info('waitpoint.expired', {
              event: 'waitpoint.expired',
              waitpointId: wp.id,
              kind: wp.kind,
              organisationId: orgId,
              stepRunId,
            });
          } else {
            logger.info('waitpoint.expired_no_step', {
              event: 'waitpoint.expired_no_step',
              waitpointId: wp.id,
              kind: wp.kind,
              organisationId: orgId,
              stepRunId,
              reason: 'step UPDATE matched 0 rows (race with another writer)',
            });
          }

        }
        // kind='external_event': V1 has no callers — only the waitpoint row is
        // transitioned to 'expired'; no downstream cleanup.
      }
    },
  );

  return { expiredCount };
}
