import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { check as rateLimitCheck } from '../lib/inboundRateLimiter.js';
import { logger } from '../lib/logger.js';

const router = Router();

const ClientErrorBody = z.object({
  message: z.string().max(2000),
  componentStack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
});

router.post(
  '/api/client-errors',
  authenticate,
  asyncHandler(async (req, res) => {
    const rl = await rateLimitCheck(`client-error:${req.user!.id}`, 30, 300);
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
