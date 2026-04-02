/**
 * pageIntegrationWorker
 *
 * pg-boss worker that processes form submission integration jobs.
 * Follows the same lazy-init pattern as agentScheduleService.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { formSubmissions, integrationConnections, conversionEvents } from '../db/schema/index.js';
import { adapters } from '../adapters/index.js';
import { connectionTokenService } from './connectionTokenService.js';

// ---------------------------------------------------------------------------
// pg-boss — lazy loaded
// ---------------------------------------------------------------------------

type PgBoss = {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(name: string, data?: object, options?: object): Promise<string | null>;
  work(
    name: string,
    options: { teamSize?: number; teamConcurrency?: number },
    handler: (job: { data: Record<string, unknown> }) => Promise<void>,
  ): Promise<string>;
};

const QUEUE_NAME = 'page-integration';

let boss: PgBoss | null = null;

async function getBoss(): Promise<PgBoss | null> {
  if (boss) return boss;

  try {
    const PgBossModule = await import('pg-boss');
    const PgBossClass = PgBossModule.default ?? PgBossModule;
    const { env } = await import('../lib/env.js');

    boss = new (PgBossClass as unknown as new (config: { connectionString: string }) => PgBoss)({
      connectionString: env.DATABASE_URL,
    });

    await boss.start();
    return boss;
  } catch (err) {
    console.warn(
      '[PageIntegrationWorker] pg-boss not available, jobs will be processed immediately:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

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
  const pgboss = await getBoss();

  if (pgboss) {
    await pgboss.send(QUEUE_NAME, payload, {
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 120,
    });
  } else {
    // Dev-mode fallback: process immediately
    processPageIntegrationJob(payload).catch((err) => {
      console.error('[PageIntegrationWorker] Immediate processing failed:', err);
    });
  }
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

  let result: { success: boolean; error?: string; data?: unknown } = { success: false };

  try {
    // 2. Look up connection
    const [connection] = await db
      .select()
      .from(integrationConnections)
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
      const contactResult = await adapter.crm.createContact(connection, fields);
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
      const checkoutResult = await adapter.payments.createCheckout(connection, fields);
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
  const pgboss = await getBoss();

  if (!pgboss) {
    console.log('[PageIntegrationWorker] pg-boss not available — worker not registered');
    return;
  }

  await pgboss.work(
    QUEUE_NAME,
    { teamSize: 5, teamConcurrency: 1 },
    async (job) => {
      const payload = job.data as unknown as PageIntegrationJobPayload;
      await processPageIntegrationJob(payload);
    },
  );

  console.log('[PageIntegrationWorker] Worker registered for queue:', QUEUE_NAME);
}
