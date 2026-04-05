/**
 * formSubmissionService
 *
 * Processes public form submissions with deduplication, field validation,
 * integration adapter validation, and job enqueueing.
 */

import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  pages,
  formSubmissions,
  conversionEvents,
  projectIntegrations,
  integrationConnections,
} from '../db/schema/index.js';
import { adapters } from '../adapters/index.js';
import { enqueuePageIntegrationJob } from './pageIntegrationWorker.js';

const MAX_PAYLOAD_BYTES = 50 * 1024; // 50 KB

function computeSubmissionHash(pageId: string, data: Record<string, unknown>): string {
  // Exclude sessionId from deduplication hash
  const { sessionId: _ignored, ...rest } = data;
  const sorted = JSON.stringify(rest, Object.keys(rest).sort());
  return crypto.createHash('sha256').update(`${pageId}:${sorted}`).digest('hex');
}

export const formSubmissionService = {
  async submit(
    pageId: string,
    data: Record<string, unknown>,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<{ success: true; duplicate?: boolean; redirect?: string }> {
    // 1. Payload size check
    const payloadSize = Buffer.byteLength(JSON.stringify(data), 'utf8');
    if (payloadSize > MAX_PAYLOAD_BYTES) {
      throw { statusCode: 413, message: 'Payload too large (max 50KB)' };
    }

    // 2. Honeypot check — silently succeed if bot detected
    if (data.__hp) {
      return { success: true };
    }

    // 3. Page lookup — must be published
    const [page] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.id, pageId), eq(pages.status, 'published')));

    if (!page) {
      throw { statusCode: 404, message: 'Page not found or not published' };
    }

    const formConfig = page.formConfig as {
      fields?: Array<{ name: string; type: string; required: boolean }>;
      actions?: Record<string, { action: string; fields: Record<string, unknown> }>;
      thankYou?: { type: 'redirect' | 'message'; value: string };
    } | null;

    // 4. Field validation — check required fields
    if (formConfig?.fields) {
      const missingFields: string[] = [];
      for (const field of formConfig.fields) {
        if (field.required && (data[field.name] === undefined || data[field.name] === null || data[field.name] === '')) {
          missingFields.push(field.name);
        }
      }
      if (missingFields.length > 0) {
        throw { statusCode: 400, message: `Missing required fields: ${missingFields.join(', ')}` };
      }
    }

    // Cache integration lookups for reuse during enqueue
    const integrationCache = new Map<string, { connectionId: string; providerType: string }>();

    // 5. Adapter capability validation
    if (formConfig?.actions) {
      for (const [purpose, actionConfig] of Object.entries(formConfig.actions)) {
        // Look up project integration for this purpose
        const [integration] = await db
          .select()
          .from(projectIntegrations)
          .where(
            and(
              eq(projectIntegrations.projectId, page.projectId),
              eq(projectIntegrations.purpose, purpose as 'crm' | 'payments' | 'email' | 'ads' | 'analytics'),
            ),
          );

        if (!integration) {
          throw {
            statusCode: 422,
            message: `No integration configured for purpose: ${purpose}`,
          };
        }

        // Look up the connection
        const [connection] = await db
          .select()
          .from(integrationConnections)
          .where(eq(integrationConnections.id, integration.connectionId));

        if (!connection) {
          throw {
            statusCode: 422,
            message: `Integration connection not found for purpose: ${purpose}`,
          };
        }

        // Check adapter supports the requested action
        const adapter = adapters[connection.providerType];
        if (!adapter) {
          throw {
            statusCode: 422,
            message: `No adapter available for provider: ${connection.providerType}`,
          };
        }

        if (!adapter.supportedActions.includes(actionConfig.action)) {
          throw {
            statusCode: 422,
            message: `Adapter "${connection.providerType}" does not support action "${actionConfig.action}"`,
          };
        }

        integrationCache.set(purpose, { connectionId: integration.connectionId, providerType: connection.providerType });
      }
    }

    // 6. Deduplication
    const submissionHash = computeSubmissionHash(pageId, data);
    const [existing] = await db
      .select({ id: formSubmissions.id })
      .from(formSubmissions)
      .where(eq(formSubmissions.submissionHash, submissionHash));

    if (existing) {
      return { success: true, duplicate: true };
    }

    const hasActions = formConfig?.actions && Object.keys(formConfig.actions).length > 0;

    // 7. Store submission
    const [submission] = await db
      .insert(formSubmissions)
      .values({
        pageId,
        data,
        submissionHash,
        integrationStatus: hasActions ? 'pending' : 'success',
        ipAddress,
        userAgent,
      })
      .returning();

    // 8. Record conversion event
    const sessionId = typeof data.sessionId === 'string' ? data.sessionId : null;
    await db.insert(conversionEvents).values({
      pageId,
      submissionId: submission.id,
      eventType: 'form_submitted',
      sessionId,
    });

    // 9. Enqueue integration jobs
    if (hasActions) {
      for (const [purpose, actionConfig] of Object.entries(formConfig.actions!)) {
        const cached = integrationCache.get(purpose);
        if (cached) {
          await enqueuePageIntegrationJob({
            submissionId: submission.id,
            pageId,
            purpose,
            action: actionConfig.action,
            fields: actionConfig.fields,
            connectionId: cached.connectionId,
          });
        }
      }
    }

    // 10. Return success with optional redirect
    const redirect =
      formConfig?.thankYou?.type === 'redirect'
        ? formConfig.thankYou.value
        : undefined;

    return { success: true, redirect };
  },
};
