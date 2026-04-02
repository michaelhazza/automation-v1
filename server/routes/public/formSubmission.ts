/**
 * Public form submission route — no authentication required.
 */

import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { formSubmissionService } from '../../services/formSubmissionService.js';

const router = Router();

router.post(
  '/api/public/pages/:pageId/submit',
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
