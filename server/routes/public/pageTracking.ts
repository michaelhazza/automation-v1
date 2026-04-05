/**
 * Public page view tracking route — no authentication required.
 * Fire-and-forget: always returns 204, never fails the client.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { pageTrackingService } from '../../services/pageTrackingService.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validateBody } from '../../middleware/validate.js';
import { pageTrackingBody } from '../../schemas/public.js';
import type { PageTrackingInput } from '../../schemas/public.js';

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
const trackHits = new Map<string, number[]>();
const TRACK_IP_LIMIT = 60;
const TRACK_WINDOW_MS = 60_000;

function checkTrackRateLimit(key: string): boolean {
  const now = Date.now();
  const cutoff = now - TRACK_WINDOW_MS;
  const hits = (trackHits.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= TRACK_IP_LIMIT) return false;
  hits.push(now);
  trackHits.set(key, hits);
  return true;
}

// Cleanup every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - TRACK_WINDOW_MS;
  for (const [key, hits] of trackHits) {
    const filtered = hits.filter((t) => t > cutoff);
    if (filtered.length === 0) trackHits.delete(key); else trackHits.set(key, filtered);
  }
}, 5 * 60_000).unref();

const router = Router();

router.post('/api/public/track', (req, res, next) => {
  const ip = (typeof req.headers['x-forwarded-for'] === 'string'
    ? req.headers['x-forwarded-for'].split(',')[0].trim()
    : null) ?? req.ip ?? 'unknown';
  if (!checkTrackRateLimit(`ip:${ip}`)) {
    res.status(429).end();
    return;
  }
  next();
}, validateBody(pageTrackingBody), asyncHandler(async (req, res) => {
  res.status(204).end();

  // Fire-and-forget — process after response is sent
  const { pageId, sessionId, referrer, utmSource, utmMedium, utmCampaign } = req.body as PageTrackingInput;

  try {
    await pageTrackingService.recordView({
      pageId,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      referrer: typeof referrer === 'string' ? referrer : undefined,
      utmSource: typeof utmSource === 'string' ? utmSource : undefined,
      utmMedium: typeof utmMedium === 'string' ? utmMedium : undefined,
      utmCampaign: typeof utmCampaign === 'string' ? utmCampaign : undefined,
    });
  } catch (err) {
    console.error('[PageTracking] Failed to record page view:', err instanceof Error ? err.message : String(err));
  }
}));

export default router;
