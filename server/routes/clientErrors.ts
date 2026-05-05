import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { check as rateLimitCheck } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
import { logger } from '../lib/logger.js';

const router = Router();

const ClientErrorBody = z.object({
  message: z.string().max(2000),
  componentStack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
});

// NOTE: Body size cap of 16KB is enforced by a path-scoped express.json parser
// in server/index.ts (mounted BEFORE the global 10MB parser), so oversized payloads
// return 413 before reaching this handler. ChatGPT-Round-1 Finding 3.

router.post(
  '/api/client-errors',
  authenticate,
  asyncHandler(async (req, res) => {
    const rl = await rateLimitCheck(rateLimitKeys.clientError(req.user!.id), 30, 300);
    if (!rl.allowed) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    const body = ClientErrorBody.parse(req.body);
    logger.warn('client_render_error', {
      organisationId: req.user!.organisationId,
      userId: req.user!.id,
      message: body.message,
      url: body.url,
      userAgent: body.userAgent,
    });
    res.status(204).end();
  })
);

export default router;
