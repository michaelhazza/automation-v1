/**
 * Public page view tracking route — no authentication required.
 * Fire-and-forget: always returns 204, never fails the client.
 */

import { Router } from 'express';
import { pageTrackingService } from '../../services/pageTrackingService.js';

const router = Router();

router.post('/api/public/track', async (req, res) => {
  // Always return 204 regardless of outcome
  res.status(204).end();

  try {
    const { pageId, sessionId, referrer, utmSource, utmMedium, utmCampaign } = req.body ?? {};

    if (!pageId || typeof pageId !== 'string') return;

    await pageTrackingService.recordView({
      pageId,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      referrer: typeof referrer === 'string' ? referrer : undefined,
      utmSource: typeof utmSource === 'string' ? utmSource : undefined,
      utmMedium: typeof utmMedium === 'string' ? utmMedium : undefined,
      utmCampaign: typeof utmCampaign === 'string' ? utmCampaign : undefined,
    });
  } catch (err) {
    // Fire-and-forget — log but never fail the client
    console.error('[PageTracking] Failed to record page view:', err instanceof Error ? err.message : String(err));
  }
});

export default router;
