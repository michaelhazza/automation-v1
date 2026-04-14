import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { subaccountAgentService } from '../services/subaccountAgentService.js';
import { agentBeliefService } from '../services/agentBeliefService.js';
import { agentScheduleService } from '../services/agentScheduleService.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { validateBody } from '../middleware/validate.js';
import { linkAgentBody, updateLinkBody, createSubaccountDataSourceBody } from '../schemas/subaccountAgents.js';
import { db } from '../db/index.js';
import { agents, subaccounts, systemAgents } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

const router = Router();

// ─── Agent linking ───────────────────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/agents',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const agentLinks = await subaccountAgentService.listSubaccountAgents(req.orgId!, req.params.subaccountId);
    res.json(agentLinks);
  })
);

router.post(
  '/api/subaccounts/:subaccountId/agents',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  validateBody(linkAgentBody, 'warn'),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { agentId } = req.body as { agentId?: string };
    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    // Configuration Assistant org subaccount restriction guard
    const [targetAgent] = await db
      .select({ systemAgentSlug: systemAgents.slug })
      .from(agents)
      .leftJoin(systemAgents, eq(agents.systemAgentId, systemAgents.id))
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, req.orgId!)));
    if (targetAgent?.systemAgentSlug === 'configuration-assistant') {
      const [sa] = await db.select({ isOrgSubaccount: subaccounts.isOrgSubaccount }).from(subaccounts)
        .where(eq(subaccounts.id, req.params.subaccountId));
      if (!sa?.isOrgSubaccount) {
        throw { statusCode: 400, message: 'Configuration Assistant can only be linked to the org subaccount' };
      }
    }

    const link = await subaccountAgentService.linkAgent(req.orgId!, req.params.subaccountId, agentId);
    res.status(201).json(link);
  })
);

// Single link detail — /detail suffix prevents shadowing the /tree route below
router.get(
  '/api/subaccounts/:subaccountId/agents/:linkId/detail',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const link = await subaccountAgentService.getLinkById(req.orgId!, req.params.subaccountId, req.params.linkId);
    res.json(link);
  })
);

// Tree must be before :agentId param routes to avoid matching "tree" as an ID
router.get(
  '/api/subaccounts/:subaccountId/agents/tree',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const tree = await subaccountAgentService.getTree(req.orgId!, req.params.subaccountId);
    res.json(tree);
  })
);

router.delete(
  '/api/subaccounts/:subaccountId/agents/:agentId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    await subaccountAgentService.unlinkAgent(req.orgId!, req.params.subaccountId, req.params.agentId);
    res.json({ message: 'Agent unlinked' });
  })
);

router.patch(
  '/api/subaccounts/:subaccountId/agents/:linkId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  validateBody(updateLinkBody, 'warn'),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const {
      isActive, parentSubaccountAgentId, agentRole, agentTitle,
      heartbeatEnabled, heartbeatIntervalHours, heartbeatOffsetHours, heartbeatOffsetMinutes,
      concurrencyPolicy, catchUpPolicy, catchUpCap, maxConcurrentRuns,
      scheduleCron, scheduleEnabled, scheduleTimezone,
      skillSlugs, customInstructions,
      tokenBudgetPerRun, maxToolCallsPerRun, timeoutSeconds, maxCostPerRunCents, maxLlmCallsPerRun,
    } = req.body as {
      isActive?: boolean;
      parentSubaccountAgentId?: string | null;
      agentRole?: string | null;
      agentTitle?: string | null;
      heartbeatEnabled?: boolean;
      heartbeatIntervalHours?: number | null;
      heartbeatOffsetHours?: number;
      heartbeatOffsetMinutes?: number;
      concurrencyPolicy?: 'skip_if_active' | 'coalesce_if_active' | 'always_enqueue';
      catchUpPolicy?: 'skip_missed' | 'enqueue_missed_with_cap';
      catchUpCap?: number;
      maxConcurrentRuns?: number;
      scheduleCron?: string | null;
      scheduleEnabled?: boolean;
      scheduleTimezone?: string;
      skillSlugs?: string[] | null;
      customInstructions?: string | null;
      tokenBudgetPerRun?: number;
      maxToolCallsPerRun?: number;
      timeoutSeconds?: number;
      maxCostPerRunCents?: number | null;
      maxLlmCallsPerRun?: number | null;
    };

    // Verify linkId ownership BEFORE touching the scheduler. Without this
    // check, a caller with access to one subaccount could supply a foreign
    // linkId and mutate another tenant's schedule via updateSchedule() which
    // keys by id only.
    await subaccountAgentService.getLinkById(req.orgId!, req.params.subaccountId, req.params.linkId);

    // Schedule fields go through agentScheduleService to keep BullMQ registrations in sync
    if (scheduleCron !== undefined || scheduleEnabled !== undefined || scheduleTimezone !== undefined) {
      await agentScheduleService.updateSchedule(req.params.linkId, {
        ...(scheduleCron !== undefined ? { scheduleCron } : {}),
        ...(scheduleEnabled !== undefined ? { scheduleEnabled } : {}),
        ...(scheduleTimezone !== undefined ? { scheduleTimezone } : {}),
      });
    }

    const updated = await subaccountAgentService.updateLink(req.orgId!, req.params.linkId, {
      isActive,
      parentSubaccountAgentId,
      agentRole,
      agentTitle,
      heartbeatEnabled,
      heartbeatIntervalHours,
      heartbeatOffsetHours,
      heartbeatOffsetMinutes,
      concurrencyPolicy,
      catchUpPolicy,
      catchUpCap,
      maxConcurrentRuns,
      ...('skillSlugs' in req.body ? { skillSlugs } : {}),
      ...('customInstructions' in req.body ? { customInstructions } : {}),
      tokenBudgetPerRun,
      maxToolCallsPerRun,
      timeoutSeconds,
      ...('maxCostPerRunCents' in req.body ? { maxCostPerRunCents } : {}),
      ...('maxLlmCallsPerRun' in req.body ? { maxLlmCallsPerRun } : {}),
    });
    res.json(updated);
  })
);

// ─── Data sources ────────────────────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/agents/:linkId/data-sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    // Verify linkId belongs to this org/subaccount before reading its data sources
    await subaccountAgentService.getLinkById(req.orgId!, req.params.subaccountId, req.params.linkId);
    const sources = await subaccountAgentService.listSubaccountDataSources(req.params.linkId);
    res.json(sources);
  })
);

router.post(
  '/api/subaccounts/:subaccountId/agents/:linkId/data-sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  validateBody(createSubaccountDataSourceBody, 'warn'),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { name, description, sourceType, sourcePath, sourceHeaders, contentType, priority, maxTokenBudget, cacheMinutes, syncMode } =
      req.body as Record<string, unknown>;

    if (!name || !sourceType || !sourcePath) {
      res.status(400).json({ error: 'name, sourceType and sourcePath are required' });
      return;
    }

    const links = await subaccountAgentService.listSubaccountAgents(req.orgId!, req.params.subaccountId);
    const link = links.find(l => l.id === req.params.linkId);
    if (!link) {
      res.status(404).json({ error: 'Agent link not found' });
      return;
    }

    const source = await subaccountAgentService.addSubaccountDataSource(req.params.linkId, link.agentId, {
      name: name as string, description: description as string | undefined,
      sourceType: sourceType as any, sourcePath: sourcePath as string,
      sourceHeaders: sourceHeaders as Record<string, string> | undefined,
      contentType: contentType as any, priority: priority as number | undefined,
      maxTokenBudget: maxTokenBudget as number | undefined,
      cacheMinutes: cacheMinutes as number | undefined, syncMode: syncMode as any,
    });
    res.status(201).json(source);
  })
);

router.delete(
  '/api/subaccounts/:subaccountId/agents/:linkId/data-sources/:sourceId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    await subaccountAgentService.removeSubaccountDataSource(req.params.sourceId, req.params.linkId);
    res.json({ message: 'Data source removed' });
  })
);

// ─── Beliefs ─────────────────────────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/agents/:linkId/beliefs',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const link = await subaccountAgentService.getLinkById(req.orgId!, req.params.subaccountId, req.params.linkId);
    const beliefs = await agentBeliefService.listAllActiveBeliefs(
      req.orgId!,
      req.params.subaccountId,
      link.agentId,
    );
    res.json(beliefs);
  })
);

router.put(
  '/api/subaccounts/:subaccountId/agents/:linkId/beliefs/:beliefKey',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const link = await subaccountAgentService.getLinkById(req.orgId!, req.params.subaccountId, req.params.linkId);
    const { value, category, subject } = req.body as { value?: string; category?: string; subject?: string };
    if (!value || typeof value !== 'string') { res.status(400).json({ error: 'value is required' }); return; }
    const belief = await agentBeliefService.upsertUserOverride(
      req.orgId!,
      req.params.subaccountId,
      link.agentId,
      req.params.beliefKey,
      { value, category, subject },
    );
    res.json(belief);
  })
);

router.delete(
  '/api/subaccounts/:subaccountId/agents/:linkId/beliefs/:beliefKey',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const link = await subaccountAgentService.getLinkById(req.orgId!, req.params.subaccountId, req.params.linkId);
    // Direct DB lookup — not budget-truncated like getActiveBeliefs
    const target = await agentBeliefService.findBeliefByKey(
      req.orgId!, req.params.subaccountId, link.agentId, req.params.beliefKey,
    );
    if (!target) { res.status(404).json({ error: 'Belief not found' }); return; }
    await agentBeliefService.softDelete(req.orgId!, req.params.subaccountId, link.agentId, target.id);
    res.json({ deleted: true, beliefKey: req.params.beliefKey });
  })
);

export default router;
