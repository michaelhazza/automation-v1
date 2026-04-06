import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSystemAdmin } from '../middleware/auth.js';
import { agentExecutionService } from '../services/agentExecutionService.js';
import { agentActivityService } from '../services/agentActivityService.js';
import { agentScheduleService } from '../services/agentScheduleService.js';
import { subaccountAgentService } from '../services/subaccountAgentService.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import { subaccountAgents, agentRuns } from '../db/schema/index.js';
import { eq, and, gte, sql } from 'drizzle-orm';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// ─── Manual trigger: Run an agent in a subaccount ─────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/agents/:agentId/run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, agentId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { taskId, idempotencyKey, executionMode } = req.body as {
      taskId?: string;
      idempotencyKey?: string;
      executionMode?: 'api' | 'claude-code';
    };

    // Find the subaccount agent link
    const [saLink] = await db
      .select()
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.agentId, agentId),
          eq(subaccountAgents.organisationId, req.orgId!)
        )
      );

    if (!saLink) {
      res.status(404).json({ error: 'Agent is not linked to this subaccount' });
      return;
    }

    // Generate idempotency key if not provided — prevents duplicate runs on retry
    const effectiveIdempotencyKey = idempotencyKey ??
      `manual:${agentId}:${subaccountId}:${req.user!.id}:${taskId ?? 'heartbeat'}:${Math.floor(Date.now() / 10000)}`;

    const result = await agentExecutionService.executeRun({
      agentId,
      subaccountId,
      subaccountAgentId: saLink.id,
      organisationId: req.orgId!,
      executionScope: 'subaccount',
      runType: 'manual',
      executionMode: executionMode ?? 'api',
      runSource: 'manual',
      taskId,
      idempotencyKey: effectiveIdempotencyKey,
      triggerContext: { triggeredBy: req.user!.id, source: 'manual', executionMode: executionMode ?? 'api' },
    });

    res.json(result);
  })
);

// ─── Manual trigger: Run an org-level agent ─────────────────────────────────

router.post(
  '/api/org/agents/:agentId/run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const { taskId, idempotencyKey } = req.body as {
      taskId?: string;
      idempotencyKey?: string;
    };

    // Find the org agent config
    const { orgAgentConfigs } = await import('../db/schema/index.js');
    const [orgConfig] = await db
      .select()
      .from(orgAgentConfigs)
      .where(
        and(
          eq(orgAgentConfigs.agentId, agentId),
          eq(orgAgentConfigs.organisationId, req.orgId!)
        )
      );

    if (!orgConfig) {
      res.status(404).json({ error: 'No org-level config found for this agent' });
      return;
    }

    const effectiveIdempotencyKey = idempotencyKey ??
      `manual:org:${agentId}:${req.user!.id}:${taskId ?? 'heartbeat'}:${Math.floor(Date.now() / 10000)}`;

    const result = await agentExecutionService.executeRun({
      agentId,
      organisationId: req.orgId!,
      executionScope: 'org',
      orgAgentConfigId: orgConfig.id,
      runType: 'manual',
      executionMode: 'api',
      runSource: 'manual',
      taskId,
      idempotencyKey: effectiveIdempotencyKey,
      triggerContext: { triggeredBy: req.user!.id, source: 'manual-org' },
    });

    res.json(result);
  })
);

// ─── Get org-level agent run history ─────────────────────────────────────────

router.get(
  '/api/org/agents/:agentId/runs',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const { limit, offset } = req.query;

    const runs = await agentActivityService.listRuns({
      organisationId: req.orgId!,
      agentId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    res.json(runs);
  })
);

// ─── Get agent run history for a subaccount ───────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/agents/:agentId/runs',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, agentId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { limit, offset } = req.query;

    const runs = await agentActivityService.listRuns({
      organisationId: req.orgId!,
      subaccountId,
      agentId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    res.json(runs);
  })
);

// ─── Get single run detail ────────────────────────────────────────────────────

router.get(
  '/api/agent-runs/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const run = await agentActivityService.getRunDetail(req.params.id, req.orgId!);
    res.json(run);
  })
);

// ─── Get trace chain for a run (A1) ──────────────────────────────────────────

router.get(
  '/api/agent-runs/:id/chain',
  authenticate,
  asyncHandler(async (req, res) => {
    const chain = await agentActivityService.getRunChain(req.params.id, req.orgId!);
    res.json(chain);
  })
);

// ─── Configure subaccount agent (schedule, skills, limits) ───────────────────

router.patch(
  '/api/subaccounts/:subaccountId/agents/:agentId/config',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, agentId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const [saLink] = await db
      .select()
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.agentId, agentId),
          eq(subaccountAgents.organisationId, req.orgId!)
        )
      );

    if (!saLink) {
      res.status(404).json({ error: 'Agent is not linked to this subaccount' });
      return;
    }

    const {
      scheduleCron, scheduleEnabled, scheduleTimezone,
      tokenBudgetPerRun, maxToolCallsPerRun, timeoutSeconds,
      skillSlugs, customInstructions,
    } = req.body;

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (tokenBudgetPerRun !== undefined) update.tokenBudgetPerRun = tokenBudgetPerRun;
    if (maxToolCallsPerRun !== undefined) update.maxToolCallsPerRun = maxToolCallsPerRun;
    if (timeoutSeconds !== undefined) update.timeoutSeconds = timeoutSeconds;
    if (skillSlugs !== undefined) update.skillSlugs = skillSlugs;
    if (customInstructions !== undefined) update.customInstructions = customInstructions;

    // Update non-schedule fields
    if (Object.keys(update).length > 1) {
      await db.update(subaccountAgents).set(update).where(eq(subaccountAgents.id, saLink.id));
    }

    // Handle schedule changes through the schedule service
    if (scheduleCron !== undefined || scheduleEnabled !== undefined || scheduleTimezone !== undefined) {
      await agentScheduleService.updateSchedule(saLink.id, {
        scheduleCron,
        scheduleEnabled,
        scheduleTimezone,
      });
    }

    // Return updated record
    const [updated] = await db.select().from(subaccountAgents).where(eq(subaccountAgents.id, saLink.id));
    res.json(updated);
  })
);

// ─── Get subaccount agent config ──────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/agents/:agentId/config',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, agentId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const [saLink] = await db
      .select()
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.agentId, agentId),
          eq(subaccountAgents.organisationId, req.orgId!)
        )
      );

    if (!saLink) {
      res.status(404).json({ error: 'Agent is not linked to this subaccount' });
      return;
    }

    res.json(saLink);
  })
);

// ─── Activity: Org-scoped agent activity ──────────────────────────────────────

router.get(
  '/api/agent-activity',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, agentId, status, limit, offset } = req.query;

    const runs = await agentActivityService.listRuns({
      organisationId: req.orgId!,
      subaccountId: subaccountId as string | undefined,
      agentId: agentId as string | undefined,
      status: status as string | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    res.json(runs);
  })
);

// ─── Activity stats ───────────────────────────────────────────────────────────

router.get(
  '/api/agent-activity/stats',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, sinceDays } = req.query;

    const stats = await agentActivityService.getStats({
      organisationId: req.orgId!,
      subaccountId: subaccountId as string | undefined,
      sinceDays: sinceDays ? Number(sinceDays) : undefined,
    });

    res.json(stats);
  })
);

// ─── Daily run activity breakdown (for activity charts) ─────────────────────

router.get(
  '/api/agent-activity/daily',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, sinceDays } = req.query;
    const days = Math.min(Number(sinceDays ?? 14), 90);

    const since = new Date();
    since.setDate(since.getDate() - days);

    const conditions = [
      gte(agentRuns.createdAt, since),
      eq(agentRuns.organisationId, req.orgId!),
    ] as ReturnType<typeof eq>[];
    if (subaccountId) conditions.push(eq(agentRuns.subaccountId, subaccountId as string));

    const rows = await db
      .select({
        date: sql<string>`to_char(${agentRuns.createdAt}, 'YYYY-MM-DD')`,
        completed: sql<number>`count(*) filter (where ${agentRuns.status} = 'completed')::int`,
        failed: sql<number>`count(*) filter (where ${agentRuns.status} = 'failed')::int`,
        timeout: sql<number>`count(*) filter (where ${agentRuns.status} = 'timeout' or ${agentRuns.status} = 'budget_exceeded')::int`,
        other: sql<number>`count(*) filter (where ${agentRuns.status} not in ('completed','failed','timeout','budget_exceeded'))::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(agentRuns)
      .where(and(...conditions))
      .groupBy(sql`to_char(${agentRuns.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${agentRuns.createdAt}, 'YYYY-MM-DD')`);

    // Fill in missing days with zeros
    const result: Array<{ date: string; completed: number; failed: number; timeout: number; other: number; total: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const found = rows.find(r => r.date === dateStr);
      result.push(found ?? { date: dateStr, completed: 0, failed: 0, timeout: 0, other: 0, total: 0 });
    }

    res.json(result);
  })
);

// ─── System admin: All activity across all orgs ───────────────────────────────

router.get('/api/system/agent-activity', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { organisationId, subaccountId, status, limit, offset } = req.query;

  const runs = await agentActivityService.listRuns({
    organisationId: organisationId as string | undefined,
    subaccountId: subaccountId as string | undefined,
    status: status as string | undefined,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  });

  res.json(runs);
}));

router.get('/api/system/agent-activity/stats', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { sinceDays } = req.query;
  const stats = await agentActivityService.getStats({
    sinceDays: sinceDays ? Number(sinceDays) : undefined,
  });
  res.json(stats);
}));

export default router;
