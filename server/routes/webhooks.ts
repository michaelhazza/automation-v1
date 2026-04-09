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
import { z } from 'zod';
import { webhookService } from '../services/webhookService.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../lib/asyncHandler.js';

/** Free-form webhook callback body — external engines send arbitrary JSON. */
const webhookCallbackBody = z.record(z.unknown());

const router = Router();

router.post('/api/webhooks/callback/:executionId', validateBody(webhookCallbackBody, 'warn'), asyncHandler(async (req, res) => {
  const { executionId } = req.params;
  const token = req.query.token as string | undefined;
  const callbackPayload = req.body as Record<string, unknown>;

  const result = await webhookService.processCallback(executionId, token, callbackPayload);
  res.status(result.status).json(result.body);
}));

export default router;
