import { eq, and, gt, lt, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  conversionEvents,
  formSubmissions,
  pages,
  projectIntegrations,
  integrationConnections,
} from '../db/schema/index.js';
import { adapters } from '../adapters/index.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { withTimeout } from '../lib/jobErrors.js';

// ---------------------------------------------------------------------------
// Payment Reconciliation Job — checks pending checkout sessions every 15 min
// ---------------------------------------------------------------------------

const JOB_NAME = 'payment-reconciliation';
const SCHEDULE_CRON = '*/15 * * * *';

/**
 * Core reconciliation logic. Can be called directly for manual/testing use.
 *
 * Finds checkout_started events between 10 minutes and 7 days old,
 * checks whether they already have a terminal event (completed/abandoned),
 * then queries the payment provider for the current status.
 */
export async function runReconciliation(): Promise<void> {
  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // 1. Find checkout_started events in the reconciliation window
  const pendingEvents = await db
    .select()
    .from(conversionEvents)
    .where(
      and(
        eq(conversionEvents.eventType, 'checkout_started'),
        gt(conversionEvents.occurredAt, sevenDaysAgo),
        lt(conversionEvents.occurredAt, tenMinutesAgo),
      ),
    );

  if (pendingEvents.length === 0) {
    console.log('[PaymentReconciliation] No pending checkout events to reconcile');
    return;
  }

  // 2. Gather submissionIds and find which already have terminal events
  const submissionIds = pendingEvents
    .map((e) => e.submissionId)
    .filter((id): id is string => id != null);

  const terminalEvents =
    submissionIds.length > 0
      ? await db
          .select({ submissionId: conversionEvents.submissionId })
          .from(conversionEvents)
          .where(
            and(
              inArray(conversionEvents.submissionId, submissionIds),
              inArray(conversionEvents.eventType, ['checkout_completed', 'checkout_abandoned']),
            ),
          )
      : [];

  const resolvedSubmissionIds = new Set(terminalEvents.map((e) => e.submissionId));

  // Filter to only unresolved events
  const unresolvedEvents = pendingEvents.filter(
    (e) => e.submissionId && !resolvedSubmissionIds.has(e.submissionId),
  );

  if (unresolvedEvents.length === 0) {
    console.log('[PaymentReconciliation] All pending checkouts already resolved');
    return;
  }

  console.log(`[PaymentReconciliation] Reconciling ${unresolvedEvents.length} pending checkout(s)`);

  let completed = 0;
  let abandoned = 0;
  let skipped = 0;
  let errors = 0;

  // Cache: pageId -> { adapter, connection } to avoid repeated lookups
  const adapterCache = new Map<
    string,
    { adapter: (typeof adapters)[string]; connection: typeof integrationConnections.$inferSelect } | null
  >();

  for (const event of unresolvedEvents) {
    try {
      const metadata = event.metadata as Record<string, unknown> | null;
      const stripeSessionId = metadata?.sessionId as string | undefined;

      if (!stripeSessionId) {
        console.warn(`[PaymentReconciliation] Event ${event.id} has no metadata.sessionId, skipping`);
        continue;
      }

      // 3. Resolve adapter for this page
      let cached = adapterCache.get(event.pageId);
      if (cached === undefined) {
        cached = await resolvePaymentAdapter(event.pageId);
        adapterCache.set(event.pageId, cached);
      }

      if (!cached) {
        console.warn(`[PaymentReconciliation] No payment adapter for page ${event.pageId}, skipping`);
        continue;
      }

      const { adapter, connection } = cached;

      if (!adapter.payments) {
        console.warn(`[PaymentReconciliation] Adapter for page ${event.pageId} has no payments capability`);
        continue;
      }

      // 4. Query provider for current status
      const result = await adapter.payments.getPaymentStatus(connection, stripeSessionId);

      if (!result.success) {
        console.error(`[PaymentReconciliation] Status check failed for event ${event.id}: ${result.error}`);
        continue;
      }

      // 5. Act on the status
      if (result.status === 'completed') {
        // Dedupe: check one more time right before insert (handles concurrent workers)
        const [alreadyResolved] = await db
          .select({ id: conversionEvents.id })
          .from(conversionEvents)
          .where(
            and(
              eq(conversionEvents.submissionId, event.submissionId!),
              inArray(conversionEvents.eventType, ['checkout_completed', 'checkout_abandoned']),
            ),
          );
        if (alreadyResolved) continue;

        // Insert checkout_completed event
        await db.insert(conversionEvents).values({
          pageId: event.pageId,
          submissionId: event.submissionId,
          eventType: 'checkout_completed',
          sessionId: event.sessionId,
          metadata: { sessionId: stripeSessionId, reconciledAt: now.toISOString() },
          occurredAt: now,
        });

        // Update submission integrationResults
        if (event.submissionId) {
          const [submission] = await db
            .select()
            .from(formSubmissions)
            .where(eq(formSubmissions.id, event.submissionId))
            .limit(1);

          if (submission) {
            const existingResults = (submission.integrationResults as Record<string, unknown>) ?? {};
            await db
              .update(formSubmissions)
              .set({
                integrationResults: {
                  ...existingResults,
                  payment: { status: 'completed', sessionId: stripeSessionId, reconciledAt: now.toISOString() },
                },
                integrationStatus: 'success',
              })
              .where(eq(formSubmissions.id, event.submissionId));
          }
        }

        completed++;
        console.log(`[PaymentReconciliation] Marked checkout completed for event ${event.id}`);
      } else if (result.status === 'failed' || result.status === 'expired') {
        // Dedupe: check one more time right before insert (handles concurrent workers)
        const [alreadyResolved] = await db
          .select({ id: conversionEvents.id })
          .from(conversionEvents)
          .where(
            and(
              eq(conversionEvents.submissionId, event.submissionId!),
              inArray(conversionEvents.eventType, ['checkout_completed', 'checkout_abandoned']),
            ),
          );
        if (alreadyResolved) continue;

        // Insert checkout_abandoned event
        await db.insert(conversionEvents).values({
          pageId: event.pageId,
          submissionId: event.submissionId,
          eventType: 'checkout_abandoned',
          sessionId: event.sessionId,
          metadata: {
            sessionId: stripeSessionId,
            providerStatus: result.status,
            reconciledAt: now.toISOString(),
          },
          occurredAt: now,
        });

        abandoned++;
        console.log(`[PaymentReconciliation] Marked checkout abandoned (${result.status}) for event ${event.id}`);
      }
      // status === 'pending' -> skip, will check on next run
      else {
        skipped++;
      }
    } catch (err) {
      errors++;
      console.error(
        `[PaymentReconciliation] Error processing event ${event.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log(JSON.stringify({
    event: 'payment.reconciliation.complete',
    total: unresolvedEvents.length,
    completed,
    abandoned,
    skipped,
    errors,
    durationMs: Date.now() - now.getTime(),
  }));
}

/**
 * Resolve page -> project -> projectIntegration (payments) -> connection -> adapter.
 * Returns null if any step fails (no integration configured, etc.).
 */
async function resolvePaymentAdapter(pageId: string) {
  // page -> projectId
  const [page] = await db.select({ projectId: pages.projectId }).from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return null;

  // projectIntegrations where purpose = 'payments'
  const [integration] = await db
    .select()
    .from(projectIntegrations)
    .where(and(eq(projectIntegrations.projectId, page.projectId), eq(projectIntegrations.purpose, 'payments')))
    .limit(1);
  if (!integration) return null;

  // integrationConnection
  const [connection] = await db
    .select()
    .from(integrationConnections)
    // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT; connectionId obtained from projectIntegrations row which was fetched via org-scoped projectId"
    .where(eq(integrationConnections.id, integration.connectionId))
    .limit(1);
  if (!connection) return null;

  const adapter = adapters[connection.providerType];
  if (!adapter) return null;

  return { adapter, connection };
}

/**
 * Initialize the pg-boss schedule and worker for payment reconciliation.
 * Called once on server startup.
 */
export async function initializePaymentReconciliationJob(): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    logger.warn('payment_reconciliation_skipped', { reason: 'pg-boss not configured' });
    return;
  }
  const pgboss = await getPgBoss();
  await (pgboss as any).work(JOB_NAME, { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async () => {
    logger.info('payment_reconciliation_start');
    await withTimeout(runReconciliation(), 270_000); // 300 - 30
  });
  await pgboss.schedule(JOB_NAME, SCHEDULE_CRON, {}, { tz: 'UTC' });
  logger.info('payment_reconciliation_scheduled', { cron: SCHEDULE_CRON });
}
