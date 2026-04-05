/**
 * Public form submission route — no authentication required.
 * Rate-limited per IP (5 submissions/min) and per page (50 submissions/min).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { formSubmissionService } from '../../services/formSubmissionService.js';
import { validateBody } from '../../middleware/validate.js';
import { formSubmissionBody } from '../../schemas/public.js';

// ---------------------------------------------------------------------------
// TODO(PROD-RATE-LIMIT): Replace with Redis-backed sliding window counters
// MVP rate limiting — in-memory, per-process.
//
// Limitations:
// - Not shared across server instances (each process has its own window)
// - Effective limit multiplied by instance count behind a load balancer
// - Resets on process restart
//
// For production: replace with Redis-backed counters (e.g. ioredis + sliding
// window) or Postgres-backed rate limiting.
// ---------------------------------------------------------------------------
const ipHits = new Map<string, number[]>();
const pageHits = new Map<string, number[]>();

const IP_LIMIT = 5;       // max 5 submissions per IP per minute
const PAGE_LIMIT = 50;    // max 50 submissions per page per minute
const WINDOW_MS = 60_000; // 1 minute

function checkRateLimit(key: string, store: Map<string, number[]>, limit: number): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const hits = (store.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) return false;
  hits.push(now);
  store.set(key, hits);
  return true;
}

// Periodic cleanup to prevent memory leak (every 5 minutes)
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, hits] of ipHits) {
    const filtered = hits.filter((t) => t > cutoff);
    if (filtered.length === 0) ipHits.delete(key); else ipHits.set(key, filtered);
  }
  for (const [key, hits] of pageHits) {
    const filtered = hits.filter((t) => t > cutoff);
    if (filtered.length === 0) pageHits.delete(key); else pageHits.set(key, filtered);
  }
}, 5 * 60_000).unref();

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = (typeof req.headers['x-forwarded-for'] === 'string'
    ? req.headers['x-forwarded-for'].split(',')[0].trim()
    : null) ?? req.ip ?? 'unknown';
  const pageId = req.params.pageId ?? 'unknown';

  if (!checkRateLimit(`ip:${ip}`, ipHits, IP_LIMIT)) {
    res.status(429).json({ error: 'Too many submissions. Please try again later.' });
    return;
  }
  if (!checkRateLimit(`page:${pageId}`, pageHits, PAGE_LIMIT)) {
    res.status(429).json({ error: 'This form is receiving too many submissions. Please try again later.' });
    return;
  }
  next();
}

const router = Router();

router.post(
  '/api/public/pages/:pageId/submit',
  rateLimitMiddleware,
  validateBody(formSubmissionBody),
  asyncHandler(async (req, res) => {
    const { pageId } = req.params;
    const data = req.body as Record<string, unknown>;

    const ipAddress =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : null) ?? req.ip ?? null;

    const userAgent =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : null;

    const result = await formSubmissionService.submit(pageId, data, ipAddress, userAgent);
    res.status(200).json(result);
  }),
);

export default router;
