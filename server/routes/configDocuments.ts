/**
 * Config Documents routes (S21)
 *
 * POST /api/subaccounts/:subaccountId/config-documents/generate
 * POST /api/subaccounts/:subaccountId/config-documents/upload
 * GET  /api/subaccounts/:subaccountId/config-documents/:id/status
 * GET  /api/subaccounts/:subaccountId/config-documents/:id/gaps
 *
 * Phase 3 scope: status + gaps endpoints return the parsed summary inline from
 * memory — persistence of upload history is deferred to Phase 4.
 *
 * Spec: docs/memory-and-briefings-spec.md §9 (S21)
 */

import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import {
  generateConfigurationDocument,
  resolveBundleSchemas,
  getOrgName,
} from '../services/configDocumentGeneratorService.js';
import { parseDocument } from '../services/configDocumentParserService.js';
import type { ConfigDocumentSummary } from '../types/configSchema.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Phase 3 in-memory cache — swapped for a table-backed cache in Phase 4.
// Each entry has a 10-min TTL to bound memory growth.
const CACHE_TTL_MS = 10 * 60 * 1000;
const parsedCache = new Map<string, ConfigDocumentSummary>();

router.post(
  '/api/subaccounts/:subaccountId/config-documents/generate',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { subaccountId } = req.params;
    const { bundleSlugs, format } = req.body ?? {};

    const sa = await resolveSubaccount(subaccountId, orgId);
    const agencyName = await getOrgName(orgId);

    const slugs =
      Array.isArray(bundleSlugs) && bundleSlugs.length > 0
        ? bundleSlugs
        : ['intelligence-briefing', 'weekly-digest'];

    const requestedFormat = format === 'markdown' ? 'markdown' : 'docx';

    const doc = await generateConfigurationDocument({
      agencyName,
      subaccountName: sa.name ?? 'Subaccount',
      bundleSlugs: slugs,
      format: requestedFormat,
      uploadUrl: `${req.protocol}://${req.get('host')}/portal/${subaccountId}/onboarding/upload`,
    });

    return res.json({
      format: doc.format,
      filename: doc.filename,
      contents: doc.contents,
    });
  }),
);

router.post(
  '/api/subaccounts/:subaccountId/config-documents/upload',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { subaccountId } = req.params;

    await resolveSubaccount(subaccountId, orgId);

    if (!req.file) return res.status(400).json({ error: 'file upload is required' });

    const bundleSlugs =
      typeof req.body?.bundleSlugs === 'string'
        ? req.body.bundleSlugs.split(',').map((s: string) => s.trim())
        : ['intelligence-briefing', 'weekly-digest'];

    const schema = resolveBundleSchemas(bundleSlugs);
    const summary = await parseDocument({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      schema,
      organisationId: orgId,
      subaccountId,
      correlationId: req.correlationId ?? randomUUID(),
    });

    const id = randomUUID();
    parsedCache.set(id, summary);
    setTimeout(() => parsedCache.delete(id), CACHE_TTL_MS);

    return res.json({
      id,
      outcome: summary.outcome,
      autoApplyCount: summary.autoApplyFields.length,
      gapCount: summary.gaps.length,
      rejectionReason: summary.rejectionReason,
    });
  }),
);

router.get(
  '/api/subaccounts/:subaccountId/config-documents/:id/status',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const summary = parsedCache.get(req.params.id);
    if (!summary) return res.status(404).json({ error: 'Parsed document not found' });
    return res.json({
      id: req.params.id,
      outcome: summary.outcome,
      autoApplyCount: summary.autoApplyFields.length,
      gapCount: summary.gaps.length,
      rejectionReason: summary.rejectionReason,
    });
  }),
);

router.get(
  '/api/subaccounts/:subaccountId/config-documents/:id/gaps',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const summary = parsedCache.get(req.params.id);
    if (!summary) return res.status(404).json({ error: 'Parsed document not found' });
    return res.json({
      id: req.params.id,
      gaps: summary.gaps,
    });
  }),
);

export default router;
