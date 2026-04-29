/**
 * Public page view tracking route — no authentication required.
 * Fire-and-forget: always returns 204, never fails the client.
 */

import { Router } from 'express';
import { pageTrackingService } from '../../services/pageTrackingService.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validateBody } from '../../middleware/validate.js';
import { pageTrackingBody } from '../../schemas/public.js';
import type { PageTrackingInput } from '../../schemas/public.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../../lib/rateLimitKeys.js';

const router = Router();

router.post('/api/public/track', validateBody(pageTrackingBody), asyncHandler(async (req, res) => {
  const ip = (typeof req.headers['x-forwarded-for'] === 'string'
    ? req.headers['x-forwarded-for'].split(',')[0].trim()
    : null) ?? req.ip ?? 'unknown';

  const limitResult = await rateLimitCheck(rateLimitKeys.publicTrackIp(ip), 60, 60);
  if (!limitResult.allowed) {
    setRateLimitDeniedHeaders(res, limitResult.resetAt);
    res.status(429).end();
    return;
  }

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
