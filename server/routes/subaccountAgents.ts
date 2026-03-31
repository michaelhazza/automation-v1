import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { subaccountAgentService } from '../services/subaccountAgentService.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';

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
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { agentId } = req.body as { agentId?: string };
    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }
    try {
      const link = await subaccountAgentService.linkAgent(req.orgId!, req.params.subaccountId, agentId);
      res.status(201).json(link);
    } catch (err: unknown) {
      const e = err as { code?: string; statusCode?: number; message?: string };
      if (e.code === '23505') {
        res.status(409).json({ error: 'Agent is already linked to this subaccount' });
        return;
      }
      throw err;
    }
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
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { isActive, parentSubaccountAgentId, agentRole, agentTitle, heartbeatEnabled, heartbeatIntervalHours, heartbeatOffsetHours } = req.body as {
      isActive?: boolean;
      parentSubaccountAgentId?: string | null;
      agentRole?: string | null;
      agentTitle?: string | null;
      heartbeatEnabled?: boolean;
      heartbeatIntervalHours?: number | null;
      heartbeatOffsetHours?: number;
    };
    const updated = await subaccountAgentService.updateLink(req.orgId!, req.params.linkId, {
      isActive,
      parentSubaccountAgentId,
      agentRole,
      agentTitle,
      heartbeatEnabled,
      heartbeatIntervalHours,
      heartbeatOffsetHours,
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
    const sources = await subaccountAgentService.listSubaccountDataSources(req.params.linkId);
    res.json(sources);
  })
);

router.post(
  '/api/subaccounts/:subaccountId/agents/:linkId/data-sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
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

export default router;
