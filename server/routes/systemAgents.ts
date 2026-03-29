import { Router } from 'express';
import { authenticate, requireSystemAdmin, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { systemAgentService } from '../services/systemAgentService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// ─── System Admin: System Agent CRUD ──────────────────────────────────────────

router.get('/api/system/agents', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const agents = await systemAgentService.listAgents();
  res.json(agents);
}));

router.get('/api/system/agents/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const agent = await systemAgentService.getAgent(req.params.id);
  const installCount = await systemAgentService.getInstallCount(req.params.id);
  res.json({ ...agent, installCount });
}));

router.post('/api/system/agents', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, masterPrompt } = req.body;
  if (!name || !masterPrompt) {
    res.status(400).json({ error: 'name and masterPrompt are required' });
    return;
  }
  const agent = await systemAgentService.createAgent(req.body);
  res.status(201).json(agent);
}));

router.patch('/api/system/agents/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const agent = await systemAgentService.updateAgent(req.params.id, req.body);
  res.json(agent);
}));

router.delete('/api/system/agents/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  await systemAgentService.deleteAgent(req.params.id);
  res.json({ message: 'System agent deleted' });
}));

router.post('/api/system/agents/:id/publish', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const agent = await systemAgentService.publishAgent(req.params.id);
  res.json(agent);
}));

router.post('/api/system/agents/:id/unpublish', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const agent = await systemAgentService.unpublishAgent(req.params.id);
  res.json(agent);
}));

// ─── Org Admin: Browse & install system agents ───────────────────────────────

router.get('/api/system-agents', authenticate, asyncHandler(async (req, res) => {
  const agents = await systemAgentService.listAgents({ publishedOnly: true });
  // Redact system-level IP: remove masterPrompt and system skill slugs
  const redacted = agents.map(a => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description,
    icon: a.icon,
    modelProvider: a.modelProvider,
    modelId: a.modelId,
    defaultOrgSkillSlugs: a.defaultOrgSkillSlugs,
    allowModelOverride: a.allowModelOverride,
    status: a.status,
    version: a.version,
  }));
  res.json(redacted);
}));

router.post('/api/system-agents/:id/install', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), asyncHandler(async (req, res) => {
  const agent = await systemAgentService.installToOrg(req.params.id, req.orgId!);
  res.status(201).json(agent);
}));

export default router;
