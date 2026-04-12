import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import * as skillStudioService from '../services/skillStudioService.js';

const router = Router();

// ---------------------------------------------------------------------------
// System-scoped Skill Studio routes
// ---------------------------------------------------------------------------

router.get(
  '/api/system/skill-studio',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const items = await skillStudioService.listSkillsForStudio('system');
    res.json(items);
  }),
);

router.get(
  '/api/system/skill-studio/:skillId',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const context = await skillStudioService.getSkillStudioContext(req.params.skillId, 'system');
    if (!context) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json(context);
  }),
);

router.post(
  '/api/system/skill-studio/:skillId/simulate',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { definition, instructions, regressionCaseIds } = req.body;
    const results = await skillStudioService.simulateSkillVersion(
      definition, instructions ?? null, regressionCaseIds ?? [], req.orgId!,
    );
    res.json(results);
  }),
);

router.post(
  '/api/system/skill-studio/:skillId/save',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const version = await skillStudioService.saveSkillVersion(
      req.params.skillId, 'system', null, req.body, req.user!.id,
    );
    res.json(version);
  }),
);

router.get(
  '/api/system/skill-studio/:skillId/versions',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const versions = await skillStudioService.listSkillVersions(req.params.skillId, 'system');
    res.json(versions);
  }),
);

router.post(
  '/api/system/skill-studio/:skillId/rollback',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    await skillStudioService.rollbackSkillVersion(
      req.params.skillId, 'system', req.body.versionId, req.user!.id,
    );
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Org-scoped Skill Studio routes
// ---------------------------------------------------------------------------

router.get(
  '/api/admin/skill-studio',
  authenticate,
  requireOrgPermission('org.agents.view'),
  asyncHandler(async (req, res) => {
    const items = await skillStudioService.listSkillsForStudio('org', req.orgId!);
    res.json(items);
  }),
);

router.get(
  '/api/admin/skill-studio/:skillId',
  authenticate,
  requireOrgPermission('org.agents.view'),
  asyncHandler(async (req, res) => {
    const context = await skillStudioService.getSkillStudioContext(req.params.skillId, 'org', req.orgId!);
    if (!context) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json(context);
  }),
);

router.post(
  '/api/admin/skill-studio/:skillId/simulate',
  authenticate,
  requireOrgPermission('org.agents.edit'),
  asyncHandler(async (req, res) => {
    const { definition, instructions, regressionCaseIds } = req.body;
    const results = await skillStudioService.simulateSkillVersion(
      definition, instructions ?? null, regressionCaseIds ?? [], req.orgId!,
    );
    res.json(results);
  }),
);

router.post(
  '/api/admin/skill-studio/:skillId/save',
  authenticate,
  requireOrgPermission('org.agents.edit'),
  asyncHandler(async (req, res) => {
    const version = await skillStudioService.saveSkillVersion(
      req.params.skillId, 'org', req.orgId!, req.body, req.user!.id,
    );
    res.json(version);
  }),
);

router.get(
  '/api/admin/skill-studio/:skillId/versions',
  authenticate,
  requireOrgPermission('org.agents.view'),
  asyncHandler(async (req, res) => {
    const versions = await skillStudioService.listSkillVersions(req.params.skillId, 'org');
    res.json(versions);
  }),
);

export default router;
