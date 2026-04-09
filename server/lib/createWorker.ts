// ---------------------------------------------------------------------------
// createWorker — declarative pg-boss worker registration (Phase A3)
//
// Reads retry, timeout, and error classification from jobConfig.ts.
// Reduces per-queue worker boilerplate from ~30 lines to ~5 lines.
//
// Sprint 2 P1.1 Layer 1 Path 2: every handler runs inside an org-scoped
// Drizzle transaction that has issued `SELECT set_config('app.organisation_id',
// $1)` for the tenant the job belongs to. The job payload MUST carry
// `organisationId` explicitly — pg-boss handlers without it throw a
// structured `missing_org_context` failure before the handler ever runs.
// See docs/improvements-roadmap-spec.md §P1.1 Layer 1.
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { sql } from 'drizzle-orm';
import { JOB_CONFIG, type JobName } from '../config/jobConfig.js';
import { isNonRetryable, isTimeoutError, getRetryCount, withTimeout } from './jobErrors.js';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { throwFailure } from '../../shared/iee/failure.js';

interface WorkerOptions<T> {
  /** Queue name — must match a key in JOB_CONFIG */
  queue: JobName;
  /** pg-boss instance */
  boss: PgBoss;
  /** Handler function — receives the pg-boss job */
  handler: (job: PgBoss.Job<T>) => Promise<void>;
  /** Override concurrency (defaults to env QUEUE_CONCURRENCY or 2) */
  concurrency?: number;
  /** Override timeout in ms (defaults to jobConfig expireInSeconds * 900ms) */
  timeoutMs?: number;
  /**
   * Sprint 2 P1.1 Layer 1 Path 2 — org context resolver.
   *
   * Most handlers read `organisationId` (and optionally `subaccountId`)
   * straight from the job payload. The default resolver does that. A
   * handler whose job payload stores the tenant context under a different
   * field name, or whose payload intentionally has no org context (cross-
   * org maintenance sweeps, admin jobs), can override this.
   *
   * - Return `null` to explicitly opt out of the tx-opening prelude. The
   *   handler is then responsible for using `withAdminConnection` for any
   *   DB access.
   * - Return `{ organisationId, subaccountId? }` to open an org-scoped tx
   *   for the handler. This is the default behaviour.
   */
  resolveOrgContext?: (
    job: PgBoss.Job<T>,
  ) => { organisationId: string; subaccountId?: string | null } | null;
}

/**
 * Default org-context resolver: reads `organisationId` / `subaccountId`
 * from the job payload. Throws a structured failure when `organisationId`
 * is missing — job payload schemas validated at the `boss.send(...)` site
 * must include this field (see docs/pgboss-zod-hardening-spec.md).
 */
function defaultResolveOrgContext<T>(
  job: PgBoss.Job<T>,
): { organisationId: string; subaccountId?: string | null } | null {
  const data = (job.data ?? {}) as Record<string, unknown>;
  const organisationId = data.organisationId ?? data.orgId;
  if (typeof organisationId !== 'string' || organisationId.length === 0) {
    throwFailure(
      'missing_org_context',
      `pg-boss job ${job.id} payload missing organisationId`,
      { jobId: job.id, payloadKeys: Object.keys(data) },
    );
  }
  const subaccountId = data.subaccountId;
  return {
    organisationId,
    subaccountId:
      typeof subaccountId === 'string' && subaccountId.length > 0
        ? subaccountId
        : null,
  };
}

/**
 * Register a pg-boss worker with automatic retry, timeout, and error classification
 * based on the centralised job configuration.
 */
export function createWorker<T>(options: WorkerOptions<T>) {
  const config = JOB_CONFIG[options.queue];
  const teamSize = options.concurrency ?? parseInt(process.env.QUEUE_CONCURRENCY ?? '2', 10);

  // Derive timeout: explicit override > config expireInSeconds * 0.9 > 60s default
  const timeoutMs = options.timeoutMs
    ?? ((config as Record<string, unknown>).expireInSeconds
      ? ((config as Record<string, unknown>).expireInSeconds as number) * 900
      : 60_000);

  const resolveOrgContext = options.resolveOrgContext ?? defaultResolveOrgContext;

  return options.boss.work<T>(
    options.queue,
    { teamSize, teamConcurrency: 1 },
    async (job) => {
      const retryCount = getRetryCount(job as unknown as { retrycount?: number } & Record<string, unknown>);
      if (retryCount > 0) {
        console.warn(`[Worker:${options.queue}] Retry #${retryCount} for job ${job.id}`);
      }

      // Sprint 2 P1.1 Layer 1 Path 2 — open an org-scoped transaction for
      // the handler. Every query the handler issues then runs with
      // `current_setting('app.organisation_id')` set to the tenant id
      // extracted from the job payload, matching the RLS policies.
      //
      // A resolver that returns `null` opts out — used by admin maintenance
      // jobs that must touch multiple tenants via `withAdminConnection`.
      const runHandler = async (): Promise<void> => {
        const orgContext = resolveOrgContext(job);
        if (orgContext === null) {
          // Explicit opt-out: the handler is responsible for its own
          // tx / admin-bypass wiring.
          await options.handler(job);
          return;
        }

        await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('app.organisation_id', ${orgContext.organisationId}, true)`,
          );

          await withOrgTx(
            {
              tx,
              organisationId: orgContext.organisationId,
              subaccountId: orgContext.subaccountId ?? null,
              source: `pgboss:${options.queue}:${job.id}`,
            },
            () => options.handler(job),
          );
        });
      };

      try {
        await withTimeout(runHandler(), timeoutMs);
      } catch (err: unknown) {
        if (isNonRetryable(err)) {
          console.error(`[Worker:${options.queue}] Non-retryable failure for job ${job.id}:`,
            err instanceof Error ? err.message : err);
          await options.boss.fail(job.id);
          return;
        }
        if (isTimeoutError(err)) {
          console.error(`[Worker:${options.queue}] Timeout after ${timeoutMs}ms for job ${job.id}`);
        }
        throw err; // pg-boss handles retry/DLQ
      }
    }
  );
}
