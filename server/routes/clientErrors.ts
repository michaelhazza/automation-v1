import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { check as rateLimitCheck } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
import { logger } from '../lib/logger.js';
import { decideDedupe } from './clientErrorsLruPure.js';

export { decideDedupe };

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

// LRU dedupe — process-bound, best-effort. Prevents the same error flooding logs
// during a bad deploy. Full SHA-256 hash ensures collision resistance.
const LRU_WINDOW_MS = 60_000;
const LRU_MAX_SIZE = 1000;
const errorLru = new Map<string, number>(); // hash → last-seen timestamp (ms)

router.post(
  '/api/client-errors',
  authenticate,
  asyncHandler(async (req, res) => {
    const body = ClientErrorBody.parse(req.body);

    // LRU dedupe — runs BEFORE rate-limit check. Duplicates within the window
    // get a silent 204 and do NOT count toward the rate limit or trigger logging.
    const hash = crypto
      .createHash('sha256')
      .update(`${body.message}\n${body.componentStack ?? ''}`)
      .digest('hex');

    const now = Date.now();

    // Time-based eviction sweep — remove entries older than the window.
    for (const [k, ts] of errorLru) {
      if (now - ts > LRU_WINDOW_MS) errorLru.delete(k);
    }
    // Size cap — evict oldest entry if over capacity after sweep.
    if (errorLru.size >= LRU_MAX_SIZE) {
      const oldest = errorLru.entries().next().value;
      if (oldest) errorLru.delete(oldest[0]);
    }

    if (decideDedupe({ hash, lru: errorLru, now, windowMs: LRU_WINDOW_MS }) === 'duplicate') {
      res.status(204).end();
      return;
    }

    // Miss — update LRU, then fall through to rate-limit + handler logic.
    errorLru.set(hash, now);

    const rl = await rateLimitCheck(rateLimitKeys.clientError(req.user!.id), 30, 300);
    if (!rl.allowed) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }

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
