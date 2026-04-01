import { Router } from 'express';
import { authenticate, requireSystemAdmin, requireOrgPermission } from '../middleware/auth.js';
import { agentTemplateService } from '../services/agentTemplateService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// ─── System Admin: Agent Template CRUD ────────────────────────────────────────

router.get('/api/system/agent-templates', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const templates = await agentTemplateService.listTemplates();
  res.json(templates);
}));

router.get('/api/system/agent-templates/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const template = await agentTemplateService.getTemplate(req.params.id);
  res.json(template);
}));

router.post('/api/system/agent-templates', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, masterPrompt } = req.body;
  if (!name || !masterPrompt) {
    res.status(400).json({ error: 'name and masterPrompt are required' });
    return;
  }
  const template = await agentTemplateService.createTemplate(req.body);
  res.status(201).json(template);
}));

router.patch('/api/system/agent-templates/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const template = await agentTemplateService.updateTemplate(req.params.id, req.body);
  res.json(template);
}));

router.delete('/api/system/agent-templates/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  await agentTemplateService.deleteTemplate(req.params.id);
  res.json({ message: 'Template deleted' });
}));

router.post('/api/system/agent-templates/:id/publish', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const template = await agentTemplateService.publishTemplate(req.params.id);
  res.json(template);
}));

router.post('/api/system/agent-templates/:id/unpublish', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const template = await agentTemplateService.unpublishTemplate(req.params.id);
  res.json(template);
}));

// ─── Org Admin: Browse & install templates ───────────────────────────────────

router.get('/api/agent-templates', authenticate, asyncHandler(async (req, res) => {
  const { category } = req.query;
  const templates = await agentTemplateService.listTemplates({
    publishedOnly: true,
    category: category as string | undefined,
  });
  res.json(templates);
}));

router.post('/api/agent-templates/:id/install', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), asyncHandler(async (req, res) => {
  const agent = await agentTemplateService.installToOrg(req.params.id, req.orgId!);
  res.status(201).json(agent);
}));

export default router;
