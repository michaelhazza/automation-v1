import { Router, NextFunction } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { orgAgentConfigService } from '../services/orgAgentConfigService.js';
import { orgSettingsService } from '../services/orgSettingsService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// ── Deprecation middleware — all org agent config routes are deprecated ──
// Data migrated to subaccount_agents via migration 0106.
// These routes will be removed in Phase 2 cleanup.
router.use('/api/org/agent-configs', (_req, res, next) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', '2026-07-01');
  next();
});
router.use('/api/org/settings/execution-enabled', (_req, res, next) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', '2026-07-01');
  next();
});

// ── Org Agent Config CRUD (deprecated — use subaccount agent routes) ──────

router.get('/api/org/agent-configs', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), asyncHandler(async (req, res) => {
  const configs = await orgAgentConfigService.listByOrg(req.orgId!);
  res.json(configs);
}));

router.post('/api/org/agent-configs', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE), asyncHandler(async (req, res, _next: NextFunction) => {
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
  } = req.body; // guard-ignore: input-validation reason="manual validation enforced: agentId required check; deprecated route being removed in Phase 2"

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

// ── Org Execution Kill Switch ─────────────────────────────────────────────

router.get('/api/org/settings/execution-enabled', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), asyncHandler(async (req, res) => {
  const enabled = await orgSettingsService.getExecutionEnabled(req.orgId!);
  res.json({ enabled });
}));

router.patch('/api/org/settings/execution-enabled', authenticate, requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT), asyncHandler(async (req, res, _next: NextFunction) => {
  const { enabled, reason } = req.body as { enabled: boolean; reason?: string };
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ message: 'enabled (boolean) is required' });
  }
  await orgSettingsService.setExecutionEnabled(req.orgId!, enabled, req.user!.id, reason);
  res.json({ enabled });
}));

export default router;
