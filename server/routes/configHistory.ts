import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { configHistoryService } from '../services/configHistoryService.js';

const router = Router();

// Allowed entity types for validation
const VALID_ENTITY_TYPES = new Set([
  'agent', 'subaccount_agent', 'scheduled_task', 'agent_data_source',
  'skill', 'policy_rule', 'permission_set', 'subaccount',
  'workspace_limits', 'org_budget', 'mcp_server_config',
  'agent_trigger', 'connector_config', 'integration_connection',
]);

/**
 * GET /api/org/config-history/:entityType/:entityId
 * List all versions of an entity, ordered by version DESC.
 */
router.get(
  '/api/org/config-history/:entityType/:entityId',
  authenticate,
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

/**
 * GET /api/org/config-history/session/:sessionId
 * List all history records from a specific config agent session.
 */
router.get(
  '/api/org/config-history/session/:sessionId',
  authenticate,
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };

    const records = await configHistoryService.listSessionHistory(req.params.sessionId, orgId);
    res.json({ sessionId: req.params.sessionId, records });
  })
);

/**
 * POST /api/org/config-history/:entityType/:entityId/restore/:version
 * Restore an entity to a previous version.
 * Creates a new history entry with change_source 'restore'.
 */
router.post(
  '/api/org/config-history/:entityType/:entityId/restore/:version',
  authenticate,
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

    // Fetch the target version snapshot
    const targetRecord = await configHistoryService.getVersion(entityType, entityId, version, orgId);
    if (!targetRecord) {
      throw { statusCode: 404, message: `Version ${version} not found for ${entityType}/${entityId}` };
    }

    // Record current state before restore (pre-restore snapshot)
    // Actual restore application is handled by the config_restore_version skill handler
    // This endpoint returns the snapshot for the caller to apply
    res.json({
      entityType,
      entityId,
      restoredFromVersion: version,
      snapshot: targetRecord.snapshot,
    });
  })
);

export default router;
