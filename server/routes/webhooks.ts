/**
 * Webhook callback routes
 *
 * POST /api/webhooks/callback/:executionId
 *   Called by the external engine (n8n, Make, Zapier, etc.) to deliver the
 *   result of an automation run back to this platform.
 *
 *   The executionId in the URL uniquely identifies the job.  When
 *   WEBHOOK_SECRET is set an HMAC token is expected in the `token` query
 *   param so we can reject spoofed callbacks without exposing secrets.
 *
 *   The route is intentionally unauthenticated (no JWT required) because
 *   external engines cannot be asked to manage user sessions.  The token
 *   param provides equivalent security when WEBHOOK_SECRET is set.
 */

import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { executions, users } from '../db/schema/index.js';
import { webhookService } from '../services/webhookService.js';
import { emailService } from '../services/emailService.js';

const router = Router();

router.post('/api/webhooks/callback/:executionId', async (req, res) => {
  const { executionId } = req.params;
  const token = req.query.token as string | undefined;

  // ------------------------------------------------------------------
  // 1. Verify the HMAC token (no-op when WEBHOOK_SECRET is not set)
  // ------------------------------------------------------------------
  if (!webhookService.verifyCallbackToken(executionId, token)) {
    res.status(401).json({ error: 'Invalid or missing webhook token' });
    return;
  }

  // ------------------------------------------------------------------
  // 2. Look up the execution
  // ------------------------------------------------------------------
  const [execution] = await db
    .select()
    .from(executions)
    .where(eq(executions.id, executionId));

  if (!execution) {
    // Return 200 to prevent the engine from retrying indefinitely
    res.status(200).json({ received: true, note: 'Execution not found — already processed or invalid' });
    return;
  }

  // ------------------------------------------------------------------
  // 3. Idempotency: if already completed/failed, still ack but skip update
  // ------------------------------------------------------------------
  const terminalStatuses = ['completed', 'failed', 'timeout', 'cancelled'];
  if (terminalStatuses.includes(execution.status) && execution.callbackReceivedAt) {
    res.status(200).json({ received: true, note: 'Callback already processed' });
    return;
  }

  // ------------------------------------------------------------------
  // 4. Parse the incoming payload
  // ------------------------------------------------------------------
  const callbackPayload = req.body as Record<string, unknown>;

  // Engines may signal errors via a top-level `error` or `status` field.
  // We use a heuristic: treat the callback as a success unless the payload
  // explicitly contains { error: <truthy> } or { status: "error"|"failed" }.
  const isErrorPayload =
    !!callbackPayload.error ||
    callbackPayload.status === 'error' ||
    callbackPayload.status === 'failed';

  const now = new Date();

  await db
    .update(executions)
    .set({
      status: isErrorPayload ? 'failed' : 'completed',
      outputData: isErrorPayload ? null : (callbackPayload as unknown as Record<string, unknown>),
      errorMessage: isErrorPayload
        ? String(callbackPayload.error ?? callbackPayload.message ?? 'External engine reported an error')
        : null,
      callbackReceivedAt: now,
      callbackPayload: callbackPayload as unknown as Record<string, unknown>,
      completedAt: now,
      durationMs: execution.startedAt
        ? now.getTime() - execution.startedAt.getTime()
        : null,
      updatedAt: now,
    })
    .where(eq(executions.id, executionId));

  // ------------------------------------------------------------------
  // 5. Send completion notification if the user opted in
  // ------------------------------------------------------------------
  if (execution.notifyOnComplete && execution.triggeredByUserId) {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, execution.triggeredByUserId));
      if (user) {
        const processName = (execution.processSnapshot as Record<string, unknown> | null)?.name as string | undefined ?? 'Process';
        await emailService.sendExecutionCompletionEmail(
          user.email,
          processName,
          executionId,
          isErrorPayload ? 'failed' : 'completed'
        );
      }
    } catch {
      /* Email failures don't affect the webhook acknowledgement */
    }
  }

  // ------------------------------------------------------------------
  // 6. Acknowledge immediately so the engine doesn't retry
  // ------------------------------------------------------------------
  res.status(200).json({ received: true, executionId, status: isErrorPayload ? 'failed' : 'completed' });
});

export default router;
