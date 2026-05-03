/**
 * pageIntegrationWorker
 *
 * pg-boss worker that processes form submission integration jobs.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { formSubmissions, integrationConnections, conversionEvents } from '../db/schema/index.js';
import { adapters } from '../adapters/index.js';
import { connectionTokenService } from './connectionTokenService.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

const QUEUE_NAME = 'page-integration';

// ---------------------------------------------------------------------------
// Job payload
// ---------------------------------------------------------------------------

export interface PageIntegrationJobPayload {
  submissionId: string;
  pageId: string;
  purpose: string;
  action: string;
  fields: Record<string, unknown>;
  connectionId: string;
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export async function enqueuePageIntegrationJob(payload: PageIntegrationJobPayload): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    processPageIntegrationJob(payload).catch((err) => {
      logger.error('page_integration_immediate_failed', { error: String(err) });
    });
    return;
  }
  const pgboss = await getPgBoss();
  await pgboss.send(QUEUE_NAME, payload, getJobConfig('page-integration'));
}

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

async function processPageIntegrationJob(payload: PageIntegrationJobPayload): Promise<void> {
  const { submissionId, purpose, action, fields, connectionId, pageId } = payload;

  // 1. Mark submission as processing
  await db
    .update(formSubmissions)
    .set({ integrationStatus: 'processing' })
    .where(eq(formSubmissions.id, submissionId));

  let result: { success: boolean; error?: unknown; data?: unknown };

  try {
    // 2. Look up connection
    const [connection] = await db
      .select()
      .from(integrationConnections)
      // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT; connectionId sourced from job payload derived from org-scoped page project config"
      .where(eq(integrationConnections.id, connectionId));

    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    // 3. Get adapter
    const adapter = adapters[connection.providerType];
    if (!adapter) {
      throw new Error(`No adapter for provider: ${connection.providerType}`);
    }

    // 4–5. Execute the integration action
    if (purpose === 'crm' && action === 'create_contact' && adapter.crm) {
      const contactResult = await adapter.crm.createContact(connection, fields as import('../adapters/integrationAdapter.js').CrmCreateContactInput);
      result = { success: contactResult.success, data: contactResult, error: contactResult.error };

      if (contactResult.success) {
        await db.insert(conversionEvents).values({
          pageId,
          submissionId,
          eventType: 'contact_created',
          metadata: { contactId: contactResult.contactId },
        });
      }
    } else if (purpose === 'payments' && action === 'create_checkout' && adapter.payments) {
      const checkoutResult = await adapter.payments.createCheckout(connection, fields as unknown as import('../adapters/integrationAdapter.js').PaymentsCreateCheckoutInput);
      result = { success: checkoutResult.success, data: checkoutResult, error: checkoutResult.error };

      if (checkoutResult.success) {
        await db.insert(conversionEvents).values({
          pageId,
          submissionId,
          eventType: 'checkout_started',
          metadata: { checkoutUrl: checkoutResult.checkoutUrl, sessionId: checkoutResult.sessionId },
        });
      }
    } else {
      result = { success: false, error: `Unsupported action: ${purpose}/${action}` };
    }
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  // 6. Update integration results — merge per-purpose result
  const [current] = await db
    .select({ integrationResults: formSubmissions.integrationResults })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, submissionId));

  const existingResults = (current?.integrationResults as Record<string, unknown>) ?? {};
  const updatedResults = { ...existingResults, [purpose]: result };

  // 7. Compute overall status
  const allResults = Object.values(updatedResults) as Array<{ success: boolean }>;
  const allSuccess = allResults.every((r) => r.success);
  const allFailed = allResults.every((r) => !r.success);

  let integrationStatus: 'success' | 'failed' | 'partial_failure';
  if (allSuccess) {
    integrationStatus = 'success';
  } else if (allFailed) {
    integrationStatus = 'failed';
  } else {
    integrationStatus = 'partial_failure';
  }

  await db
    .update(formSubmissions)
    .set({ integrationResults: updatedResults, integrationStatus })
    .where(eq(formSubmissions.id, submissionId));
}

// ---------------------------------------------------------------------------
// Initialize worker
// ---------------------------------------------------------------------------

export async function initializePageIntegrationWorker(): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    logger.info('page_integration_worker_skipped', { reason: 'pg-boss not configured' });
    return;
  }
  const pgboss = await getPgBoss();
  await (pgboss as any).work(
    QUEUE_NAME,
    { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 },
    async (job: any) => {
      const payload = job.data as unknown as PageIntegrationJobPayload;
      await processPageIntegrationJob(payload);
    },
  );
  logger.info('page_integration_worker_registered', { queue: QUEUE_NAME });
}
