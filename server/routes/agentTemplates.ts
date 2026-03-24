import { Router } from 'express';
import { authenticate, requireSystemAdmin, requireOrgPermission } from '../middleware/auth.js';
import { agentTemplateService } from '../services/agentTemplateService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// ─── System Admin: Agent Template CRUD ────────────────────────────────────────

router.get('/api/system/agent-templates', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const templates = await agentTemplateService.listTemplates();
    res.json(templates);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/system/agent-templates/:id', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const template = await agentTemplateService.getTemplate(req.params.id);
    res.json(template);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/system/agent-templates', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const { name, masterPrompt } = req.body;
    if (!name || !masterPrompt) {
      res.status(400).json({ error: 'name and masterPrompt are required' });
      return;
    }
    const template = await agentTemplateService.createTemplate(req.body);
    res.status(201).json(template);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/system/agent-templates/:id', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const template = await agentTemplateService.updateTemplate(req.params.id, req.body);
    res.json(template);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/system/agent-templates/:id', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    await agentTemplateService.deleteTemplate(req.params.id);
    res.json({ message: 'Template deleted' });
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/system/agent-templates/:id/publish', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const template = await agentTemplateService.publishTemplate(req.params.id);
    res.json(template);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/system/agent-templates/:id/unpublish', authenticate, requireSystemAdmin, async (req, res) => {
  try {
    const template = await agentTemplateService.unpublishTemplate(req.params.id);
    res.json(template);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

// ─── Org Admin: Browse & install templates ───────────────────────────────────

router.get('/api/agent-templates', authenticate, async (req, res) => {
  try {
    const { category } = req.query;
    const templates = await agentTemplateService.listTemplates({
      publishedOnly: true,
      category: category as string | undefined,
    });
    res.json(templates);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/agent-templates/:id/install', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), async (req, res) => {
  try {
    const agent = await agentTemplateService.installToOrg(req.params.id, req.orgId!);
    res.status(201).json(agent);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
