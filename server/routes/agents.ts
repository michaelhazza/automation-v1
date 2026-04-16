import { Router } from 'express';
import { authenticate, requireOrgPermission, hasOrgPermission } from '../middleware/auth.js';
import { agentService } from '../services/agentService.js';
import { conversationService } from '../services/conversationService.js';
import { agentExecutionService } from '../services/agentExecutionService.js';
import { subaccountAgentService } from '../services/subaccountAgentService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { validateMultipart, validateBody } from '../middleware/validate.js';
import { createAgentBody, updateAgentBody, createDataSourceBody, updateDataSourceBody, sendMessageBody } from '../schemas/agents.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { checkTestRunRateLimit } from '../lib/testRunRateLimit.js';

const router = Router();

// ── Agent Hierarchy Tree ──────────────────────────────────────────────────

router.get('/api/agents/tree', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), asyncHandler(async (req, res) => {
  const tree = await agentService.getTree(req.orgId!);
  res.json(tree);
}));

// ── Agent CRUD ─────────────────────────────────────────────────────────────

router.get('/api/agents', authenticate, asyncHandler(async (req, res) => {
  const canManageAgents = await hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_EDIT);
  const result = canManageAgents
    ? await agentService.listAllAgents(req.orgId!)
    : await agentService.listAgents(req.orgId!);
  res.json(result);
}));

router.post('/api/agents', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), validateBody(createAgentBody, 'warn'), asyncHandler(async (req, res) => {
  const { name, description, masterPrompt, modelProvider, modelId, temperature, maxTokens, responseMode, outputSize, allowModelOverride, defaultSkillSlugs, icon } = req.body;
  if (!name || !masterPrompt) {
    res.status(400).json({ error: 'Validation failed', details: 'name and masterPrompt are required' });
    return;
  }
  const result = await agentService.createAgent(req.orgId!, {
    name, description, masterPrompt, modelProvider, modelId, temperature, maxTokens, responseMode, outputSize, allowModelOverride, defaultSkillSlugs, icon,
  });
  res.status(201).json(result);
}));

router.get('/api/agents/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), asyncHandler(async (req, res) => {
  const result = await agentService.getAgent(req.params.id, req.orgId!);
  // For system-managed agents, redact the system-level masterPrompt from org admins
  if (result.isSystemManaged && !(await hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_EDIT))) {
    result.masterPrompt = '';
  }
  res.json(result);
}));

router.patch('/api/agents/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), validateBody(updateAgentBody, 'warn'), asyncHandler(async (req, res) => {
  const result = await agentService.updateAgent(req.params.id, req.orgId!, req.body);
  res.json(result);
}));

router.delete('/api/agents/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_DELETE), asyncHandler(async (req, res) => {
  const result = await agentService.deleteAgent(req.params.id, req.orgId!);
  res.json(result);
}));

router.post('/api/agents/:id/activate', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res) => {
  const result = await agentService.activateAgent(req.params.id, req.orgId!);
  res.json(result);
}));

router.post('/api/agents/:id/deactivate', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res) => {
  const result = await agentService.deactivateAgent(req.params.id, req.orgId!);
  res.json(result);
}));

// ── Data Sources ───────────────────────────────────────────────────────────

router.post('/api/agents/:id/data-sources/upload', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), validateMultipart, asyncHandler(async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No file provided' });
    return;
  }
  const result = await agentService.uploadDataSourceFile(req.params.id, req.orgId!, files[0]);
  res.status(201).json(result);
}));

router.post('/api/agents/:id/data-sources', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), validateBody(createDataSourceBody, 'warn'), asyncHandler(async (req, res) => {
  const { name, description, sourceType, sourcePath, sourceHeaders, contentType, priority, maxTokenBudget, cacheMinutes } = req.body;
  if (!name || !sourceType || !sourcePath) {
    res.status(400).json({ error: 'Validation failed', details: 'name, sourceType, and sourcePath are required' });
    return;
  }
  const result = await agentService.addDataSource(req.params.id, req.orgId!, {
    name, description, sourceType, sourcePath, sourceHeaders, contentType, priority, maxTokenBudget, cacheMinutes,
  });
  res.status(201).json(result);
}));

router.patch('/api/agents/:id/data-sources/:sourceId', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), validateBody(updateDataSourceBody, 'warn'), asyncHandler(async (req, res) => {
  const result = await agentService.updateDataSource(req.params.sourceId, req.params.id, req.orgId!, req.body);
  res.json(result);
}));

router.delete('/api/agents/:id/data-sources/:sourceId', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res) => {
  const result = await agentService.deleteDataSource(req.params.sourceId, req.params.id, req.orgId!);
  res.json(result);
}));

router.post('/api/agents/:id/data-sources/:sourceId/test', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res) => {
  const result = await agentService.testDataSource(req.params.sourceId, req.params.id, req.orgId!);
  res.json(result);
}));

// ── Conversations ──────────────────────────────────────────────────────────

router.get('/api/agents/:id/conversations', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT), asyncHandler(async (req, res) => {
  const result = await conversationService.listConversations(req.params.id, req.user!.id, req.orgId!);
  res.json(result);
}));

router.post('/api/agents/:id/conversations', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT), asyncHandler(async (req, res) => {
  const result = await conversationService.createConversation(req.params.id, req.user!.id, req.orgId!);
  res.status(201).json(result);
}));

router.get('/api/agents/:id/conversations/:convId', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT), asyncHandler(async (req, res) => {
  const result = await conversationService.getConversation(req.params.convId, req.params.id, req.user!.id, req.orgId!);
  res.json(result);
}));

router.delete('/api/agents/:id/conversations/:convId', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT), asyncHandler(async (req, res) => {
  const result = await conversationService.deleteConversation(req.params.convId, req.params.id, req.user!.id, req.orgId!);
  res.json(result);
}));

// ── Feature 2 — org-level agent test run ─────────────────────────────────────
// POST /api/agents/:id/test-run
// Starts a flagged test run for an org-level agent. Rate-limited per user.
// Runs via the org subaccount (isOrgSubaccount=true) to satisfy the
// subaccountId + subaccountAgentId requirement in agentExecutionService.

router.post('/api/agents/:id/test-run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    checkTestRunRateLimit(req.user!.id);
    const { prompt, inputJson, idempotencyKey } = req.body as {
      prompt?: string;
      inputJson?: Record<string, unknown>;
      idempotencyKey?: string;
    };

    // Resolve the org subaccount and the agent link within it.
    const { requireOrgSubaccount } = await import('../services/orgSubaccountService.js');
    const orgSa = await requireOrgSubaccount(req.orgId!);
    const saLink = await subaccountAgentService.getLinkByAgentInSubaccount(req.orgId!, orgSa.id, id);
    if (!saLink) {
      res.status(404).json({ error: 'No agent config found for this agent in the organisation workspace' });
      return;
    }

    const triggerContext: Record<string, unknown> = {
      triggeredBy: req.user!.id,
      source: 'test_panel',
      isTestRun: true,
    };
    if (prompt) triggerContext.prompt = prompt;
    if (inputJson) triggerContext.inputJson = inputJson;
    const result = await agentExecutionService.executeRun({
      agentId: id,
      organisationId: req.orgId!,
      subaccountId: orgSa.id,
      subaccountAgentId: saLink.id,
      executionScope: 'subaccount',
      runType: 'manual',
      executionMode: 'api',
      runSource: 'manual',
      isTestRun: true,
      userId: req.user!.id,
      triggerContext,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    res.status(201).json(result);
  })
);

// ── Messages ───────────────────────────────────────────────────────────────

router.post('/api/agents/:id/conversations/:convId/messages', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT), validateBody(sendMessageBody, 'warn'), asyncHandler(async (req, res) => {
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
}));

export default router;
