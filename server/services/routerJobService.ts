import { db } from '../db/index.js';
import { llmRequests, budgetReservations, costAggregates } from '../db/schema/index.js';
import { eq, and, lt, sql } from 'drizzle-orm';
import { costAggregateService } from './costAggregateService.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import { isNonRetryable, isTimeoutError, getRetryCount, withTimeout } from '../lib/jobErrors.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';

// ---------------------------------------------------------------------------
// Router job service — manages async jobs for the LLM router
//
// Uses pg-boss if configured, falls back to immediate in-process execution.
// Jobs:
//   llm-aggregate-update    — upsert cost_aggregates after each request
//   llm-reconcile-reservations — commit/release orphaned reservations
//   llm-clean-old-aggregates   — purge minute/hour rows older than 2h
//   llm-monthly-invoices       — billing reconciliation + invoice generation
// ---------------------------------------------------------------------------

const JOB_AGGREGATE_UPDATE    = 'llm-aggregate-update';
const JOB_RECONCILE            = 'llm-reconcile-reservations';
const JOB_CLEAN_AGGREGATES     = 'llm-clean-old-aggregates';
const JOB_MONTHLY_INVOICES     = 'llm-monthly-invoices';

// ---------------------------------------------------------------------------
// Enqueue aggregate update after each LLM request
// ---------------------------------------------------------------------------

export async function enqueueAggregateUpdate(idempotencyKey: string): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    await processAggregateUpdate(idempotencyKey);
    return;
  }
  const boss = await getPgBoss();
  await boss.send(JOB_AGGREGATE_UPDATE, { idempotencyKey }, getJobConfig('llm-aggregate-update'));
}

async function processAggregateUpdate(idempotencyKey: string): Promise<void> {
  const [request] = await db
    .select()
    .from(llmRequests)
    .where(eq(llmRequests.idempotencyKey, idempotencyKey))
    .limit(1);

  if (!request) return;

  await costAggregateService.upsertAggregates(request);
  await costAggregateService.checkAlertThresholds(
    request.organisationId,
    request.subaccountId,
    request.billingMonth,
  );
}

// ---------------------------------------------------------------------------
// Reservation reconciliation — fix orphaned reservations
// Runs every 2 minutes
// ---------------------------------------------------------------------------

export async function reconcileReservations(): Promise<void> {
  const now = new Date();

  // 1. Find all active reservations
  const activeReservations = await db
    .select()
    .from(budgetReservations)
    .where(eq(budgetReservations.status, 'active'));

  for (const reservation of activeReservations) {
    // Check if the llm_request has been written with success
    const [request] = await db
      .select({ status: llmRequests.status, costWithMarginCents: llmRequests.costWithMarginCents })
      .from(llmRequests)
      .where(eq(llmRequests.idempotencyKey, reservation.idempotencyKey))
      .limit(1);

    if (request && (request.status === 'success' || request.status === 'partial')) {
      // Request succeeded but reservation wasn't committed — commit it now
      await db
        .update(budgetReservations)
        .set({ status: 'committed', actualCostCents: request.costWithMarginCents })
        .where(eq(budgetReservations.id, reservation.id));
    } else if (request && !['success', 'partial'].includes(request.status)) {
      // Request failed — release
      await db
        .update(budgetReservations)
        .set({ status: 'released' })
        .where(eq(budgetReservations.id, reservation.id));
    } else if (reservation.expiresAt < now) {
      // No request found and expired — release with warning
      console.warn(`[routerJobService] Releasing expired reservation id=${reservation.id} key=${reservation.idempotencyKey}`);
      await db
        .update(budgetReservations)
        .set({ status: 'released' })
        .where(eq(budgetReservations.id, reservation.id));
    }
    // else: not expired and no request yet — leave active (call may be in-flight)
  }
}

// ---------------------------------------------------------------------------
// Clean old aggregates — purge minute/hour rows older than 2 hours
// Runs every hour
// ---------------------------------------------------------------------------

export async function cleanOldAggregates(): Promise<void> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const cutoffMinute = twoHoursAgo.toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:mm'

  // Delete minute rows older than 2h
  await db
    .delete(costAggregates)
    .where(
      and(
        sql`${costAggregates.periodType} IN ('minute', 'hour')`,
        lt(costAggregates.periodKey, cutoffMinute),
      ),
    );
}

// ---------------------------------------------------------------------------
// Monthly invoice generation
// Runs on the 1st of each month
// ---------------------------------------------------------------------------

export async function generateMonthlyInvoices(): Promise<void> {
  const now = new Date();
  // Generate for previous month
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const period = prevMonth.toISOString().slice(0, 7); // 'YYYY-MM'

  console.info(`[routerJobService] Generating invoices for period ${period}`);

  // Get all subaccounts with spend in this period
  const subaccountAggregates = await db
    .select()
    .from(costAggregates)
    .where(
      and(
        eq(costAggregates.entityType, 'subaccount'),
        eq(costAggregates.periodType, 'monthly'),
        eq(costAggregates.periodKey, period),
      ),
    );

  for (const agg of subaccountAggregates) {
    try {
      await generateInvoiceForSubaccount(agg.entityId, period);
    } catch (err) {
      console.error(`[routerJobService] Invoice generation failed for subaccount ${agg.entityId} period ${period}`, err);
    }
  }
}

async function generateInvoiceForSubaccount(subaccountId: string, period: string): Promise<void> {
  // Reconciliation check: sum(llm_requests) must match cost_aggregates
  const ledgerTotal = await db
    .select({ total: sql<number>`COALESCE(SUM(${llmRequests.costWithMarginCents}), 0)` })
    .from(llmRequests)
    .where(
      and(
        eq(llmRequests.subaccountId, subaccountId),
        eq(llmRequests.billingMonth, period),
        eq(llmRequests.status, 'success'),
      ),
    );

  const aggregateTotal = await db
    .select({ total: costAggregates.totalCostCents })
    .from(costAggregates)
    .where(
      and(
        eq(costAggregates.entityType, 'subaccount'),
        eq(costAggregates.entityId, subaccountId),
        eq(costAggregates.periodType, 'monthly'),
        eq(costAggregates.periodKey, period),
      ),
    );

  const ledger = Number(ledgerTotal[0]?.total ?? 0);
  const aggregate = aggregateTotal[0]?.total ?? 0;

  if (Math.abs(ledger - aggregate) > 0) {
    console.error(`[routerJobService] BILLING MISMATCH: subaccount=${subaccountId} period=${period} ledger=${ledger}¢ aggregate=${aggregate}¢ — invoice NOT generated`);
    return; // Do NOT generate invoice on mismatch
  }

  // Invoice is ready — log the data (wire to Stripe/billing system when ready)
  console.info(`[routerJobService] Invoice ready: subaccount=${subaccountId} period=${period} total=${ledger}¢`);
  // TODO: Insert into invoices table / create Stripe invoice when billing system is added
}

// ---------------------------------------------------------------------------
// Initialize jobs — registers workers + schedules cron jobs
// Called once at server startup
// ---------------------------------------------------------------------------

export async function initializeRouterJobs(): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    logger.info('router_jobs_skipped', { reason: 'pg-boss not configured — router jobs run in-process' });
    return;
  }

  const boss = await getPgBoss();
  const workOpts = { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 };

  // Register workers

  // Aggregate update — Tier 2, has retries
  await (boss as any).work(JOB_AGGREGATE_UPDATE, workOpts, async (job: any) => {
    const retryCount = getRetryCount(job);
    if (retryCount > 0) {
      logger.warn('job_retry', { queue: JOB_AGGREGATE_UPDATE, jobId: job.id, retryCount });
    }
    try {
      const idempotencyKey = String(job.data.idempotencyKey ?? '');
      if (!idempotencyKey) return;
      await withTimeout(processAggregateUpdate(idempotencyKey), 30_000); // 60 - 30
    } catch (err) {
      if (isNonRetryable(err)) {
        logger.error('job_non_retryable_failure', { queue: JOB_AGGREGATE_UPDATE, jobId: job.id, error: String(err) });
        await (boss as any).fail(job.id);
        return;
      }
      if (isTimeoutError(err)) {
        logger.error('job_timeout', { queue: JOB_AGGREGATE_UPDATE, jobId: job.id, retryCount });
      }
      throw err;
    }
  });

  // Schedule recurring jobs
  try {
    await boss.schedule(JOB_RECONCILE,        '*/2 * * * *',  {}, { tz: 'UTC' });
    await boss.schedule(JOB_CLEAN_AGGREGATES, '0 * * * *',    {}, { tz: 'UTC' });
    await boss.schedule(JOB_MONTHLY_INVOICES, '0 1 1 * *',    {}, { tz: 'UTC' }); // 1am on 1st of month
  } catch {
    // schedule() may fail if already registered — safe to ignore
  }

  // Reconcile reservations — Tier 2, no retries, just timeout
  await (boss as any).work(JOB_RECONCILE, workOpts, async () => {
    await withTimeout(reconcileReservations(), 60_000); // 90 - 30
  });

  // Clean old aggregates — Tier 3, no retries, just timeout
  await (boss as any).work(JOB_CLEAN_AGGREGATES, workOpts, async () => {
    await withTimeout(cleanOldAggregates(), 90_000); // 120 - 30
  });

  // Monthly invoices — Tier 2, has retries
  await (boss as any).work(JOB_MONTHLY_INVOICES, workOpts, async (job: any) => {
    const retryCount = getRetryCount(job);
    if (retryCount > 0) {
      logger.warn('job_retry', { queue: JOB_MONTHLY_INVOICES, jobId: job.id, retryCount });
    }
    try {
      await withTimeout(generateMonthlyInvoices(), 570_000); // 600 - 30
    } catch (err) {
      if (isNonRetryable(err)) {
        logger.error('job_non_retryable_failure', { queue: JOB_MONTHLY_INVOICES, jobId: job.id, error: String(err) });
        await (boss as any).fail(job.id);
        return;
      }
      if (isTimeoutError(err)) {
        logger.error('job_timeout', { queue: JOB_MONTHLY_INVOICES, jobId: job.id, retryCount });
      }
      throw err;
    }
  });

  logger.info('router_jobs_registered', { jobs: [JOB_AGGREGATE_UPDATE, JOB_RECONCILE, JOB_CLEAN_AGGREGATES, JOB_MONTHLY_INVOICES] });
}

export const routerJobService = {
  enqueueAggregateUpdate,
  reconcileReservations,
  cleanOldAggregates,
  generateMonthlyInvoices,
  initializeRouterJobs,
};
