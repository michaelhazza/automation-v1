import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { configHistoryService, CONFIG_HISTORY_ENTITY_TYPES } from '../services/configHistoryService.js';

const router = Router();

// Use the canonical set from configHistoryService
const VALID_ENTITY_TYPES = CONFIG_HISTORY_ENTITY_TYPES;

/**
 * GET /api/org/config-history/session/:sessionId
 * List all history records from a specific config agent session.
 *
 * MUST be declared before /:entityType/:entityId — otherwise Express matches
 * "session" as the entityType param and rejects it as an invalid entity type.
 */
router.get(
  '/api/org/config-history/session/:sessionId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };

    const records = await configHistoryService.listSessionHistory(req.params.sessionId, orgId);
    res.json({ sessionId: req.params.sessionId, records });
  })
);

/**
 * GET /api/org/config-history/:entityType/:entityId
 * List all versions of an entity, ordered by version DESC.
 */
router.get(
  '/api/org/config-history/:entityType/:entityId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };

    const { entityType, entityId } = req.params;
    if (!VALID_ENTITY_TYPES.has(entityType)) {
      throw { statusCode: 400, message: `Invalid entity type: ${entityType}` };
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const versions = await configHistoryService.listHistory(entityType, entityId, orgId, { limit, offset });
    res.json({ entityType, entityId, versions });
  })
);

/**
 * GET /api/org/config-history/:entityType/:entityId/versions/:version
 * Get the full JSONB snapshot for a specific version.
 */
router.get(
  '/api/org/config-history/:entityType/:entityId/versions/:version',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };

    const { entityType, entityId } = req.params;
    const version = parseInt(req.params.version);
    if (!VALID_ENTITY_TYPES.has(entityType)) {
      throw { statusCode: 400, message: `Invalid entity type: ${entityType}` };
    }
    if (isNaN(version) || version < 1) {
      throw { statusCode: 400, message: 'Version must be a positive integer' };
    }

    const record = await configHistoryService.getVersion(entityType, entityId, version, orgId);
    if (!record) {
      throw { statusCode: 404, message: `Version ${version} not found for ${entityType}/${entityId}` };
    }

    res.json(record);
  })
);

// NOTE: Restore is performed exclusively through the config_restore_version skill handler,
// which applies the snapshot to the target entity and records a new history entry.
// There is no REST endpoint for restore — the GET /versions/:version endpoint provides
// snapshot data for inspection, and the skill handler handles the actual mutation.

export default router;
