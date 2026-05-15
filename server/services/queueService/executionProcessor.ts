import { db } from '../../db/index.js';
import { executions, executionPayloads, automationEngines, users } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { emailService } from '../emailService.js';
import { webhookService } from '../webhookService.js';
import { automationResolutionService } from '../automationResolutionService.js';
import { buildEngineAuthHeaders } from '../../lib/engineAuth.js';
import { emitExecutionUpdate, emitSubaccountUpdate } from '../../websocket/emitters.js';

export async function processExecution(executionId: string): Promise<void> {
  const [execution] = await db
    .select()
    .from(executions)
    .where(eq(executions.id, executionId));

  if (!execution) return;

  // Mark as running
  await db
    .update(executions)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(executions.id, executionId));

  emitExecutionUpdate(executionId, 'execution:status', { status: 'running' });
  if (execution.subaccountId) {
    emitSubaccountUpdate(execution.subaccountId, 'execution:status_changed', {
      executionId, status: 'running',
    });
  }

  // H-5: process snapshot lives in execution_payloads
  const [payloadRow] = await db
    .select({ processSnapshot: executionPayloads.processSnapshot })
    .from(executionPayloads)
    .where(eq(executionPayloads.executionId, executionId));
  const processSnapshot = payloadRow?.processSnapshot as Record<string, unknown> | null ?? null;
  if (!processSnapshot) {
    await db
      .update(executions)
      .set({ status: 'failed', errorMessage: 'Process configuration not found', updatedAt: new Date() })
      .where(eq(executions.id, executionId));
    return;
  }

  // ------------------------------------------------------------------
  // Resolve execution context via the three-level framework.
  // If subaccountId is set, use automationResolutionService for full
  // connection/engine/config resolution. Otherwise fall back to legacy.
  // ------------------------------------------------------------------
  let engine: { id: string; baseUrl: string; engineType: string; apiKey: string | null; hmacSecret: string } | null;
  let authPayload: Record<string, { access_token: string }> | undefined;
  let resolvedConfig: Record<string, unknown> | undefined;
  let resolvedConnections: Record<string, unknown> | undefined;

  if (execution.subaccountId && execution.organisationId) {
    try {
      const context = await automationResolutionService.resolveForExecution(
        execution.processId,
        execution.subaccountId,
        execution.organisationId,
        (execution.resolvedConfig as Record<string, unknown>) ?? undefined
      );
      engine = context.engine;
      resolvedConfig = context.config;
      resolvedConnections = context.connectionSnapshot;

      // Build auth payload from resolved connections
      if (Object.keys(context.connections).length > 0) {
        authPayload = {};
        for (const [key, conn] of Object.entries(context.connections)) {
          authPayload[key] = { access_token: conn.token };
        }
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      await db.update(executions)
        .set({ status: 'failed', errorMessage: e.message ?? 'Process resolution failed', updatedAt: new Date() })
        .where(eq(executions.id, executionId));
      return;
    }
  } else {
    // Legacy path: look up engine from process snapshot
    const [legacyEngine] = await db.select()
      .from(automationEngines)
      .where(and(
        eq(automationEngines.id, processSnapshot.automationEngineId as string),
        eq(automationEngines.organisationId, execution.organisationId),
      ));

    if (!legacyEngine) {
      await db.update(executions)
        .set({ status: 'failed', errorMessage: 'Workflow engine not found', updatedAt: new Date() })
        .where(eq(executions.id, executionId));
      return;
    }
    engine = legacyEngine;
  }

  // Build return URL with per-engine HMAC
  const returnWebhookUrl = webhookService.buildReturnUrl(executionId, engine.hmacSecret);
  const outboundPayload = await webhookService.buildOutboundPayload(
    executionId,
    execution.inputData,
    returnWebhookUrl,
    { auth: authPayload, config: resolvedConfig, processId: execution.processId }
  );

  // Persist audit trail (with auth redacted) BEFORE calling the engine
  const auditPayload = webhookService.redactPayloadForAudit(outboundPayload);
  await db
    .update(executions)
    .set({
      returnWebhookUrl,
      engineId: engine.id,
      resolvedConnections: resolvedConnections as unknown as Record<string, unknown> ?? null,
      resolvedConfig: resolvedConfig as unknown as Record<string, unknown> ?? null,
      updatedAt: new Date(),
    })
    .where(eq(executions.id, executionId));

  // H-5: persist outbound audit payload into execution_payloads
  await db
    .insert(executionPayloads)
    .values({ executionId, outboundPayload: auditPayload as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: executionPayloads.executionId,
      set: { outboundPayload: auditPayload as unknown as Record<string, unknown> },
    });

  const start = Date.now();
  let retryCount = 0;
  const maxRetries = 3;

  // Build engine-specific auth headers + HMAC signature
  const authHeaders = buildEngineAuthHeaders(engine.engineType, engine.apiKey ?? undefined);
  const hmacSignature = webhookService.signOutboundRequest(executionId, engine.hmacSecret);

  while (retryCount <= maxRetries) {
    try {
      const baseUrl = (engine.baseUrl ?? '').replace(/\/$/, '');
      const webhookPath = (processSnapshot.webhookPath as string) ?? '';
      const fullEndpointUrl = `${baseUrl}${webhookPath}`;

      const response = await fetch(fullEndpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': hmacSignature,
          ...authHeaders,
        },
        body: JSON.stringify(outboundPayload),
        signal: AbortSignal.timeout(30_000),
      });

      const durationMs = Date.now() - start;
      let outputData: unknown = null;
      try {
        outputData = await response.json();
      } catch {
        outputData = null;
      }

      const successful = response.ok;
      await db
        .update(executions)
        .set({
          status: successful ? 'completed' : 'failed',
          outputData: successful ? outputData : null,
          errorMessage: successful ? null : `Engine response status ${response.status}`,
          errorDetail: successful ? null : ({ responseStatus: response.status, responseBody: outputData } as Record<string, unknown>),
          completedAt: new Date(),
          durationMs,
          retryCount,
          updatedAt: new Date(),
        })
        .where(eq(executions.id, executionId));

      // Emit real-time status update
      emitExecutionUpdate(executionId, 'execution:status', {
        status: successful ? 'completed' : 'failed',
        outputData: successful ? outputData : null,
        errorMessage: successful ? null : `Engine response status ${response.status}`,
        durationMs,
      });
      if (execution.subaccountId) {
        emitSubaccountUpdate(execution.subaccountId, 'execution:status_changed', {
          executionId, status: successful ? 'completed' : 'failed',
        });
      }

      // Send completion notification only if user opted in
      if (execution.notifyOnComplete && execution.triggeredByUserId) {
        try {
          const [user] = await db.select().from(users).where(eq(users.id, execution.triggeredByUserId));
          if (user) {
            await emailService.sendExecutionCompletionEmail(
              user.email,
              processSnapshot.name as string,
              executionId,
              successful ? 'completed' : 'failed'
            );
          }
        } catch {
          /* Email failures don't affect execution */
        }
      }

      return;
    } catch (err: unknown) {
      const isNetworkError = err instanceof TypeError;
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';

      if (isTimeout) {
        await db
          .update(executions)
          .set({
            status: 'timeout',
            errorMessage: `Execution timed out after 30 seconds`,
            completedAt: new Date(),
            durationMs: Date.now() - start,
            retryCount,
            updatedAt: new Date(),
          })
          .where(eq(executions.id, executionId));

        emitExecutionUpdate(executionId, 'execution:status', {
          status: 'timeout', errorMessage: 'Execution timed out after 30 seconds',
          durationMs: Date.now() - start,
        });
        if (execution.subaccountId) {
          emitSubaccountUpdate(execution.subaccountId, 'execution:status_changed', {
            executionId, status: 'timeout',
          });
        }
        return;
      }

      if (isNetworkError && retryCount < maxRetries) {
        retryCount++;
        await db
          .update(executions)
          .set({ retryCount, updatedAt: new Date() })
          .where(eq(executions.id, executionId));
        await new Promise((r) => setTimeout(r, 1000 * retryCount));
        continue;
      }

      const errorMessage = err instanceof Error ? err.message : 'Execution failed';
      await db
        .update(executions)
        .set({
          status: 'failed',
          errorMessage,
          errorDetail: { error: errorMessage, retryCount } as unknown as Record<string, unknown>,
          completedAt: new Date(),
          durationMs: Date.now() - start,
          retryCount,
          updatedAt: new Date(),
        })
        .where(eq(executions.id, executionId));

      emitExecutionUpdate(executionId, 'execution:status', {
        status: 'failed', errorMessage, durationMs: Date.now() - start,
      });
      if (execution.subaccountId) {
        emitSubaccountUpdate(execution.subaccountId, 'execution:status_changed', {
          executionId, status: 'failed',
        });
      }
      return;
    }
  }
}
