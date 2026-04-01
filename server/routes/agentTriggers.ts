import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { triggerService } from '../services/triggerService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import { subaccounts, subaccountAgents } from '../db/schema/index.js';
import { and, eq } from 'drizzle-orm';

const router = Router();

const VALID_EVENT_TYPES = ['task_created', 'task_moved', 'agent_completed'] as const;
type EventType = typeof VALID_EVENT_TYPES[number];

// ─── List triggers ───────────────────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/triggers',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const triggers = await triggerService.listTriggers(subaccountId, req.orgId!);
    res.json(triggers);
  })
);

// ─── Create trigger ──────────────────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/triggers',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const { subaccountAgentId, eventType, eventFilter, cooldownSeconds } = req.body;

    if (!subaccountAgentId || typeof subaccountAgentId !== 'string') {
      res.status(400).json({ error: 'subaccountAgentId (string) is required' });
      return;
    }

    if (!eventType || !VALID_EVENT_TYPES.includes(eventType as EventType)) {
      res.status(400).json({ error: `eventType must be one of: ${VALID_EVENT_TYPES.join(', ')}` });
      return;
    }

    // Validate subaccountId belongs to this org
    const [sub] = await db
      .select({ id: subaccounts.id })
      .from(subaccounts)
      .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, req.orgId!)))
      .limit(1);
    if (!sub) {
      res.status(404).json({ error: 'Subaccount not found' });
      return;
    }

    // Validate subaccountAgentId belongs to this subaccount
    const [saLink] = await db
      .select({ id: subaccountAgents.id })
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.id, subaccountAgentId),
          eq(subaccountAgents.subaccountId, subaccountId)
        )
      )
      .limit(1);
    if (!saLink) {
      res.status(404).json({ error: 'Subaccount agent not found in this subaccount' });
      return;
    }

    const trigger = await triggerService.createTrigger({
      organisationId: req.orgId!,
      subaccountId,
      subaccountAgentId,
      eventType: eventType as EventType,
      eventFilter: eventFilter ?? {},
      cooldownSeconds: cooldownSeconds !== undefined ? Number(cooldownSeconds) : 60,
    });

    res.status(201).json(trigger);
  })
);

// ─── Update trigger ──────────────────────────────────────────────────────────

router.patch(
  '/api/subaccounts/:subaccountId/triggers/:triggerId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, triggerId } = req.params;
    const { eventFilter, cooldownSeconds, isActive } = req.body;

    const trigger = await triggerService.updateTrigger(
      triggerId,
      req.orgId!,
      subaccountId,
      {
        eventFilter,
        cooldownSeconds: cooldownSeconds !== undefined ? Number(cooldownSeconds) : undefined,
        isActive,
      }
    );

    res.json(trigger);
  })
);

// ─── Delete trigger (soft) ───────────────────────────────────────────────────

router.delete(
  '/api/subaccounts/:subaccountId/triggers/:triggerId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, triggerId } = req.params;
    await triggerService.deleteTrigger(triggerId, req.orgId!, subaccountId);
    res.json({ success: true });
  })
);

// ─── Dry run ─────────────────────────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/triggers/dry-run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const { eventType, eventData } = req.body;

    if (!eventType || !VALID_EVENT_TYPES.includes(eventType as EventType)) {
      res.status(400).json({ error: `eventType must be one of: ${VALID_EVENT_TYPES.join(', ')}` });
      return;
    }

    const results = await triggerService.dryRun(
      subaccountId,
      req.orgId!,
      eventType as EventType,
      eventData ?? {}
    );

    res.json(results);
  })
);

export default router;
