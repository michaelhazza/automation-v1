/**
 * Public form submission route — no authentication required.
 * Rate-limited per IP (5 submissions/min) and per page (50 submissions/min).
 */

import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { formSubmissionService } from '../../services/formSubmissionService.js';
import { validateBody } from '../../middleware/validate.js';
import { formSubmissionBody } from '../../schemas/public.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../../lib/rateLimitKeys.js';

const router = Router();

router.post(
  '/api/public/pages/:pageId/submit',
  validateBody(formSubmissionBody),
  asyncHandler(async (req, res) => {
    const ip = (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : null) ?? req.ip ?? 'unknown';
    const { pageId } = req.params;

    const ipResult = await rateLimitCheck(rateLimitKeys.publicFormIp(ip), 5, 60);
    if (!ipResult.allowed) {
      setRateLimitDeniedHeaders(res, ipResult.resetAt);
      res.status(429).json({ error: 'Too many submissions. Please try again later.' });
      return;
    }
    const pageResult = await rateLimitCheck(rateLimitKeys.publicFormPage(pageId ?? 'unknown'), 50, 60);
    if (!pageResult.allowed) {
      setRateLimitDeniedHeaders(res, pageResult.resetAt);
      res.status(429).json({ error: 'This form is receiving too many submissions. Please try again later.' });
      return;
    }

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
