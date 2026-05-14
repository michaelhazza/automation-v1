import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { fromOrgId } from '../services/principal/fromOrgId.js';
import {
  buildOverviewPayload,
  getObservations,
  getFilesSnapshot,
  getToolsUsage,
  getActivityFeed,
  getConnectionHealth,
  getWorkingTimeForRange,
  getKnowledgeInUseProvenance,
} from '../services/agentOverviewAggregator.js';

const router = Router();

router.get(
  '/api/agents/:id/overview',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const ctx = fromOrgId(req.orgId!);
    const payload = await buildOverviewPayload(req.params.id, ctx);
    res.json(payload);
  }),
);

router.get(
  '/api/agents/:id/observations',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const ctx = fromOrgId(req.orgId!);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const pinnedOnly = req.query.pinned_only === 'true';
    const result = await getObservations(req.params.id, ctx, { limit, cursor, pinnedOnly });
    res.json(result);
  }),
);

router.get(
  '/api/agents/:id/files-snapshot',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const ctx = fromOrgId(req.orgId!);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = await getFilesSnapshot(req.params.id, ctx, { limit, cursor });
    res.json(result);
  }),
);

router.get(
  '/api/agents/:id/tools-usage',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const ctx = fromOrgId(req.orgId!);
    const result = await getToolsUsage(req.params.id, ctx);
    res.json(result);
  }),
);

router.get(
  '/api/agents/:id/activity-feed',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const ctx = fromOrgId(req.orgId!);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = await getActivityFeed(req.params.id, ctx, { limit, cursor });
    res.json(result);
  }),
);

router.get(
  '/api/agents/:id/connections-health/:connectionId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const ctx = fromOrgId(req.orgId!);
    const result = await getConnectionHealth(req.params.id, req.params.connectionId, ctx);
    if (result === null) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Connection not found' } });
      return;
    }
    res.json(result);
  }),
);

router.get(
  '/api/agents/:id/working-time',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const ctx = fromOrgId(req.orgId!);
    const rawRange = req.query.range as string | undefined;
    const range = (rawRange === 'week' || rawRange === 'month' || rawRange === 'quarter')
      ? rawRange
      : 'week';
    const result = await getWorkingTimeForRange(req.params.id, range, ctx);
    res.json(result);
  }),
);

router.get(
  '/api/agents/:id/knowledge-in-use/:entryId/provenance',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const ctx = fromOrgId(req.orgId!);
    const result = await getKnowledgeInUseProvenance(req.params.id, req.params.entryId, ctx);
    if (result === null) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Entry not found' } });
      return;
    }
    res.json(result);
  }),
);

export default router;
