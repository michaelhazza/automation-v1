import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { agentService } from '../services/agentService.js';
import { conversationService } from '../services/conversationService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { validateMultipart } from '../middleware/validate.js';

const router = Router();

// ── Agent CRUD ─────────────────────────────────────────────────────────────

router.get('/api/agents', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user!.role === 'system_admin' || req.user!.role === 'org_admin';
    const result = isAdmin
      ? await agentService.listAllAgents(req.orgId!)
      : await agentService.listAgents(req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/agents', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), async (req, res) => {
  try {
    const { name, description, masterPrompt, modelProvider, modelId, temperature, maxTokens, responseMode, outputSize, allowModelOverride, defaultSkillSlugs, icon } = req.body;
    if (!name || !masterPrompt) {
      res.status(400).json({ error: 'Validation failed', details: 'name and masterPrompt are required' });
      return;
    }
    const result = await agentService.createAgent(req.orgId!, {
      name, description, masterPrompt, modelProvider, modelId, temperature, maxTokens, responseMode, outputSize, allowModelOverride, defaultSkillSlugs, icon,
    });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/agents/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), async (req, res) => {
  try {
    const result = await agentService.getAgent(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/agents/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), async (req, res) => {
  try {
    const result = await agentService.updateAgent(req.params.id, req.orgId!, req.body);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/agents/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_DELETE), async (req, res) => {
  try {
    const result = await agentService.deleteAgent(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/agents/:id/activate', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), async (req, res) => {
  try {
    const result = await agentService.activateAgent(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/agents/:id/deactivate', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), async (req, res) => {
  try {
    const result = await agentService.deactivateAgent(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

// ── Data Sources ───────────────────────────────────────────────────────────

router.post('/api/agents/:id/data-sources/upload', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), validateMultipart, async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }
    const result = await agentService.uploadDataSourceFile(req.params.id, req.orgId!, files[0]);
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/agents/:id/data-sources', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), async (req, res) => {
  try {
    const { name, description, sourceType, sourcePath, sourceHeaders, contentType, priority, maxTokenBudget, cacheMinutes } = req.body;
    if (!name || !sourceType || !sourcePath) {
      res.status(400).json({ error: 'Validation failed', details: 'name, sourceType, and sourcePath are required' });
      return;
    }
    const result = await agentService.addDataSource(req.params.id, req.orgId!, {
      name, description, sourceType, sourcePath, sourceHeaders, contentType, priority, maxTokenBudget, cacheMinutes,
    });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/agents/:id/data-sources/:sourceId', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), async (req, res) => {
  try {
    const result = await agentService.updateDataSource(req.params.sourceId, req.params.id, req.orgId!, req.body);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/agents/:id/data-sources/:sourceId', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), async (req, res) => {
  try {
    const result = await agentService.deleteDataSource(req.params.sourceId, req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/agents/:id/data-sources/:sourceId/test', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), async (req, res) => {
  try {
    const result = await agentService.testDataSource(req.params.sourceId, req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

// ── Conversations ──────────────────────────────────────────────────────────

router.get('/api/agents/:id/conversations', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT), async (req, res) => {
  try {
    const result = await conversationService.listConversations(req.params.id, req.user!.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/agents/:id/conversations', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT), async (req, res) => {
  try {
    const result = await conversationService.createConversation(req.params.id, req.user!.id, req.orgId!);
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/agents/:id/conversations/:convId', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT), async (req, res) => {
  try {
    const result = await conversationService.getConversation(req.params.convId, req.params.id, req.user!.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/agents/:id/conversations/:convId', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT), async (req, res) => {
  try {
    const result = await conversationService.deleteConversation(req.params.convId, req.params.id, req.user!.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

// ── Messages ───────────────────────────────────────────────────────────────

router.post('/api/agents/:id/conversations/:convId/messages', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT), async (req, res) => {
  try {
    const { content, attachments } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Message content is required' });
      return;
    }
    const result = await conversationService.sendMessage({
      conversationId: req.params.convId,
      agentId: req.params.id,
      userId: req.user!.id,
      organisationId: req.orgId!,
      content: content.trim(),
      attachments,
    });
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
