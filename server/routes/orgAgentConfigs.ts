import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { orgAgentConfigService } from '../services/orgAgentConfigService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// ── Org Agent Config CRUD ─────────────────────────────────────────────────

router.get('/api/org/agent-configs', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), asyncHandler(async (req, res) => {
  const configs = await orgAgentConfigService.listByOrg(req.orgId!);
  res.json(configs);
}));

router.post('/api/org/agent-configs', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), asyncHandler(async (req, res) => {
  const {
    agentId,
    isActive,
    tokenBudgetPerRun,
    maxToolCallsPerRun,
    timeoutSeconds,
    maxCostPerRunCents,
    maxLlmCallsPerRun,
    skillSlugs,
    allowedSkillSlugs,
    customInstructions,
    heartbeatEnabled,
    heartbeatIntervalHours,
    heartbeatOffsetMinutes,
    scheduleCron,
    scheduleEnabled,
    scheduleTimezone,
    allowedSubaccountIds,
  } = req.body;

  if (!agentId) {
    return res.status(400).json({ message: 'agentId is required' });
  }

  const config = await orgAgentConfigService.create(req.orgId!, {
    agentId,
    isActive,
    tokenBudgetPerRun,
    maxToolCallsPerRun,
    timeoutSeconds,
    maxCostPerRunCents,
    maxLlmCallsPerRun,
    skillSlugs,
    allowedSkillSlugs,
    customInstructions,
    heartbeatEnabled,
    heartbeatIntervalHours,
    heartbeatOffsetMinutes,
    scheduleCron,
    scheduleEnabled,
    scheduleTimezone,
    allowedSubaccountIds,
  });

  res.status(201).json(config);
}));

router.get('/api/org/agent-configs/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), asyncHandler(async (req, res) => {
  const config = await orgAgentConfigService.get(req.params.id, req.orgId!);
  res.json(config);
}));

router.patch('/api/org/agent-configs/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res) => {
  const {
    isActive,
    tokenBudgetPerRun,
    maxToolCallsPerRun,
    timeoutSeconds,
    maxCostPerRunCents,
    maxLlmCallsPerRun,
    skillSlugs,
    allowedSkillSlugs,
    customInstructions,
    heartbeatEnabled,
    heartbeatIntervalHours,
    heartbeatOffsetMinutes,
    scheduleCron,
    scheduleEnabled,
    scheduleTimezone,
    allowedSubaccountIds,
  } = req.body;

  const config = await orgAgentConfigService.update(req.params.id, req.orgId!, {
    isActive,
    tokenBudgetPerRun,
    maxToolCallsPerRun,
    timeoutSeconds,
    maxCostPerRunCents,
    maxLlmCallsPerRun,
    skillSlugs,
    allowedSkillSlugs,
    customInstructions,
    heartbeatEnabled,
    heartbeatIntervalHours,
    heartbeatOffsetMinutes,
    scheduleCron,
    scheduleEnabled,
    scheduleTimezone,
    allowedSubaccountIds,
  });

  res.json(config);
}));

router.delete('/api/org/agent-configs/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_DELETE), asyncHandler(async (req, res) => {
  await orgAgentConfigService.delete(req.params.id, req.orgId!);
  res.json({ success: true });
}));

export default router;
