import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission, requireSubaccountPermission, requireSystemAdmin, hasOrgPermission } from '../middleware/auth.js';
import { agentExecutionService } from '../services/agentExecutionService.js';
import { agentActivityService } from '../services/agentActivityService.js';
import { agentScheduleService } from '../services/agentScheduleService.js';
import { subaccountAgentService } from '../services/subaccountAgentService.js';
import { agentRunCancelService } from '../services/agentRunCancelService.js';
import { resumeFromIntegrationConnect } from '../services/agentResumeService.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import { agentRuns, agentRunSnapshots, agentExecutionEvents, agents } from '../db/schema/index.js';
import { eq, and, gte, sql, inArray, count, asc, or } from 'drizzle-orm';
import { asyncHandler } from '../lib/asyncHandler.js';
import { IN_FLIGHT_RUN_STATUSES } from '../../shared/runStatus.js';
import { mapAgentRunToTestResult } from '../services/agentTestRunMapperPure.js';
import { ControllerStyleNotAllowedForAgentError } from '../services/controllerStyleResolver.js';
import { logger } from '../lib/logger.js';
import { runTraceService, InvalidRunTraceCursorError } from '../services/runTraceService.js';
import type { RunTraceEventType } from '../../shared/types/runTraceEvent.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  resolveAgentRunVisibility,
  type AgentRunVisibilityRun,
  type AgentRunVisibilityUser,
} from '../lib/agentRunVisibility.js';
import { buildUserContextForRun } from '../lib/agentRunPermissionContext.js';

const router = Router();

// ─── Manual trigger: Run an agent in a subaccount ─────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/agents/:agentId/run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, agentId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    // guard-ignore-next-line: input-validation reason="body fields are all optional; execution service validates agentId/subaccountId via DB lookup before running"
    const { taskId, idempotencyKey, executionMode, controllerStyle } = req.body as {
      taskId?: string;
      idempotencyKey?: string;
      executionMode?: 'api' | 'claude-code';
      controllerStyle?: string;
    };

    // Find the subaccount agent link
    const saLink = await subaccountAgentService.getLinkByAgentInSubaccount(req.orgId!, subaccountId, agentId);

    if (!saLink) {
      res.status(404).json({ error: 'Agent is not linked to this subaccount' });
      return;
    }

    // Generate idempotency key if not provided — prevents duplicate runs on retry
    const effectiveIdempotencyKey = idempotencyKey ??
      `manual:${agentId}:${subaccountId}:${req.user!.id}:${taskId ?? 'heartbeat'}:${Math.floor(Date.now() / 10000)}`;

    try {
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
        // Plumb the initiating user through to SkillExecutionContext.userId
        // so user-scoped tools (Workflow Studio propose_save) can enforce
        // ownership. Review finding #3.
        userId: req.user!.id,
        controllerStyle,
      });

      res.json(result);
    } catch (err) {
      if (err instanceof ControllerStyleNotAllowedForAgentError) {
        logger.warn('foundation.controller_style.rejected', {
          agentId,
          subaccountId,
          organisationId: req.orgId!,
          requestedControllerStyle: controllerStyle,
        });
        res.status(422).json({
          errorCode: err.errorCode,
          message: err.message,
        });
        return;
      }
      throw err;
    }
  })
);

// ─── Manual trigger: Run an org-level agent (via org subaccount) ─────────────

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

    // Resolve the org subaccount
    const { requireOrgSubaccount } = await import('../services/orgSubaccountService.js');
    const orgSa = await requireOrgSubaccount(req.orgId!);

    // Find the subaccount agent link in the org subaccount
    const saLink = await subaccountAgentService.getLinkByAgentInSubaccount(req.orgId!, orgSa.id, agentId);

    if (!saLink) {
      res.status(404).json({ error: 'No agent config found for this agent in the organisation workspace' });
      return;
    }

    const effectiveIdempotencyKey = idempotencyKey ??
      `manual:org:${agentId}:${req.user!.id}:${taskId ?? 'heartbeat'}:${Math.floor(Date.now() / 10000)}`;

    const result = await agentExecutionService.executeRun({
      agentId,
      organisationId: req.orgId!,
      subaccountId: orgSa.id,
      subaccountAgentId: saLink.id,
      executionScope: 'subaccount',
      runType: 'manual',
      executionMode: 'api',
      runSource: 'manual',
      taskId,
      idempotencyKey: effectiveIdempotencyKey,
      triggerContext: { triggeredBy: req.user!.id, source: 'manual-org' },
      userId: req.user!.id,
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
    const { limit, offset, status, includeTestRuns } = req.query;

    const runs = await agentActivityService.listRuns({
      organisationId: req.orgId!,
      agentId,
      status: typeof status === 'string' && status.length > 0 ? status : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      includeTestRuns: includeTestRuns === 'true',
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
    const { limit, offset, status, includeTestRuns } = req.query;

    const runs = await agentActivityService.listRuns({
      organisationId: req.orgId!,
      subaccountId,
      agentId,
      status: typeof status === 'string' && status.length > 0 ? status : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      includeTestRuns: includeTestRuns === 'true',
    });

    res.json(runs);
  })
);

// ─── List agent runs by agentId ───────────────────────────────────────────────

router.get(
  '/api/agent-runs',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT),
  asyncHandler(async (req, res) => {
    const agentId = req.query.agentId as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 20), 50);
    if (!agentId) {
      res.status(400).json({ error: 'agentId query parameter is required' });
      return;
    }
    const runs = await db
      .select({
        id: agentRuns.id,
        agentId: agentRuns.agentId,
        status: agentRuns.status,
        startedAt: agentRuns.startedAt,
        completedAt: agentRuns.completedAt,
        triggerContext: agentRuns.triggerContext,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.agentId, agentId),
          eq(agentRuns.organisationId, req.orgId!),
        ),
      )
      .orderBy(sql`${agentRuns.startedAt} DESC`)
      .limit(limit);
    res.json({ runs });
  }),
);

// ─── Get single run detail ────────────────────────────────────────────────────

router.get(
  '/api/agent-runs/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    if (req.query.shape === 'test') {
      const hasPermission = await hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_VIEW);
      if (!hasPermission) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
        return;
      }
      const [run] = await db
        .select({
          id: agentRuns.id,
          status: agentRuns.status,
          startedAt: agentRuns.startedAt,
          completedAt: agentRuns.completedAt,
          summary: agentRuns.summary,
        })
        .from(agentRuns)
        .where(and(eq(agentRuns.id, req.params.id), eq(agentRuns.organisationId, req.orgId!)))
        .limit(1);
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json(mapAgentRunToTestResult(run));
      return;
    }
    const run = await agentActivityService.getRunDetail(req.params.id, req.orgId!);
    res.json(run);
  })
);

// ─── Run-trace events: role-aware masking projection (spec §4.8) ──────────────
//
// Returns the toolCallsLog for a run with masking applied per the caller's role.
// Cache-Control: private, no-store — role-aware masking projection — must not
// be shared-cacheable across roles or users; prevents future infra (CDN, edge
// cache) from leaking masked/unmasked content across role boundaries.

router.get(
  '/api/agent-runs/:id/trace-events',
  authenticate,
  asyncHandler(async (req, res) => {
    // Verify run exists and belongs to this org before serving trace data.
    const runId = req.params.id;
    const [runRow] = await db
      .select({ id: agentRuns.id, organisationId: agentRuns.organisationId })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, req.orgId!)))
      .limit(1);
    if (!runRow) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    // Read toolCallsLog from the snapshot table (H-5 blob extraction).
    // RLS on agent_run_snapshots forbids cross-org reads (backed by run_id FK → agent_runs).
    const [snap] = await db
      .select({ toolCallsLog: agentRunSnapshots.toolCallsLog })
      .from(agentRunSnapshots)
      .where(eq(agentRunSnapshots.runId, runId))
      .limit(1);

    const toolCallsLog = (Array.isArray(snap?.toolCallsLog) ? snap.toolCallsLog : []) as Array<{
      tool?: string;
      name?: string;
      input?: Record<string, unknown>;
      output?: unknown;
      durationMs?: number;
      iteration?: number;
    }>;

    // Trust & Verification Layer §9 cross-entity guard — look up canonical
    // agent_execution_events.id per tool-call so the Run-trace UI can pass a
    // real eventId to the corrections route. The toolCallsLog blob in the
    // snapshot does not carry event UUIDs; we match by (skillSlug, ordinal-
    // within-slug). The agent loop does NOT emit skill.invoked / skill.completed
    // for every tool call — those are emitted by special paths only — so
    // tool calls that don't have matching events resolve to eventId: null
    // and the UI hides the Correct affordance.
    const eventRows = await db
      .select({
        id: agentExecutionEvents.id,
        eventType: agentExecutionEvents.eventType,
        payload: agentExecutionEvents.payload,
      })
      .from(agentExecutionEvents)
      .where(
        and(
          eq(agentExecutionEvents.runId, runId),
          or(
            eq(agentExecutionEvents.eventType, 'skill.invoked'),
            eq(agentExecutionEvents.eventType, 'skill.completed'),
          ),
        ),
      )
      .orderBy(asc(agentExecutionEvents.sequenceNumber));

    // Narrow payload's runtime shape to the field linkToolCallsToEventIds reads.
    const eventRowsForLink = eventRows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      payload:
        typeof r.payload === 'object' && r.payload !== null && 'skillSlug' in r.payload
          ? { skillSlug: String((r.payload as { skillSlug: unknown }).skillSlug) }
          : null,
    }));

    const role: string = req.user?.role ?? 'user';
    const { projectForRole, linkToolCallsToEventIds } = await import('../services/agentRunMessageServicePure.js');
    const eventIdsByPosition = linkToolCallsToEventIds(toolCallsLog, eventRowsForLink);
    const projected = projectForRole(toolCallsLog, role, eventIdsByPosition);

    // Cache-Control: private, no-store — role-aware masking projection — must not
    // be shared-cacheable across roles or users; prevents future infra (CDN, edge
    // cache) from leaking masked/unmasked content across role boundaries.
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: projected });
  })
);

// ─── Delegation graph for a run (paperclip-hierarchy §7.2) ──────────────────

router.get(
  '/api/agent-runs/:id/delegation-graph',
  authenticate,
  asyncHandler(async (req, res) => {
    const { buildForRun } = await import('../services/delegationGraphService.js');
    const graph = await buildForRun(req.params.id, req.orgId!);
    res.json(graph);
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

// ─── Brain Tree OS adoption P1 — latest handoff for an agent ─────────────────

router.get(
  '/api/org/agents/:agentId/latest-handoff',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { getLatestHandoffForAgent } = await import('../services/agentRunHandoffService.js');
    const result = await getLatestHandoffForAgent({
      agentId: req.params.agentId,
      organisationId: req.orgId!,
      subaccountId: null,
    });
    res.json(result);
  })
);

router.get(
  '/api/subaccounts/:subaccountId/agents/:agentId/latest-handoff',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, agentId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { getLatestHandoffForAgent } = await import('../services/agentRunHandoffService.js');
    const result = await getLatestHandoffForAgent({
      agentId,
      organisationId: req.orgId!,
      subaccountId,
    });
    res.json(result);
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

    const saLink = await subaccountAgentService.getLinkByAgentInSubaccount(req.orgId!, subaccountId, agentId);

    if (!saLink) {
      res.status(404).json({ error: 'Agent is not linked to this subaccount' });
      return;
    }

    const {
      scheduleCron, scheduleEnabled, scheduleTimezone,
      tokenBudgetPerRun, maxToolCallsPerRun, timeoutSeconds,
      skillSlugs, customInstructions,
    } = req.body;

    const hasConfigUpdate = tokenBudgetPerRun !== undefined || maxToolCallsPerRun !== undefined ||
      timeoutSeconds !== undefined || skillSlugs !== undefined || customInstructions !== undefined;

    if (hasConfigUpdate) {
      await subaccountAgentService.updateLink(req.orgId!, saLink.id, {
        ...(tokenBudgetPerRun !== undefined && { tokenBudgetPerRun }),
        ...(maxToolCallsPerRun !== undefined && { maxToolCallsPerRun }),
        ...(timeoutSeconds !== undefined && { timeoutSeconds }),
        ...(skillSlugs !== undefined && { skillSlugs }),
        ...(customInstructions !== undefined && { customInstructions }),
      });
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
    const updated = await subaccountAgentService.getLinkByAgentInSubaccount(req.orgId!, subaccountId, agentId);
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

    const saLink = await subaccountAgentService.getLinkByAgentInSubaccount(req.orgId!, subaccountId, agentId);

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

// ─── Activity: Org-scoped live-run count ──────────────────────────────────────
//
// Codex dual-review iteration 2 finding: AdminAgentsPage used to derive the
// live-run badge from `/api/agent-activity?status=running,delegated&limit=100`
// and count the array length. That capped the badge at 100 for orgs with more
// in-flight runs and could desync with the WebSocket counter on refresh.
// This endpoint returns a proper SQL count over IN_FLIGHT_RUN_STATUSES, org-
// scoped, and excluding sub-agent runs (matching the subaccount /live-status
// endpoint in routes/projects.ts).
router.get(
  '/api/agent-activity/live-count',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const [result] = await db
      .select({ count: count() })
      .from(agentRuns)
      .where(and(
        eq(agentRuns.organisationId, req.orgId!),
        inArray(agentRuns.status, [...IN_FLIGHT_RUN_STATUSES]),
        eq(agentRuns.isSubAgent, false),
        eq(agentRuns.isTestRun, false),
      ));

    res.json({ runningAgents: Number(result?.count ?? 0) });
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

    res.json({ data: stats, serverTimestamp: new Date().toISOString() });
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

// ─── Sprint 5 P4.1: User clarification response ─────────────────────────────
// When an agent run is in 'awaiting_clarification', the user submits their
// answer here. The endpoint appends a user-role message and transitions the
// run back to 'running' so the agentic loop can resume.

router.post(
  '/api/agent-runs/:id/clarify',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const runId = req.params.id;
    const { message } = req.body as { message?: string };

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const result = await agentActivityService.receiveClarification(runId, req.orgId!, message);
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

// ─── User-triggered cancel ────────────────────────────────────────────────────
//
// Best-effort stop. Sets agent_runs.status='cancelling'. The in-process loop
// (non-IEE) reads status at the top of each iteration and exits cleanly; the
// IEE worker observes the cancelled iee_runs row via its per-step ownership
// check and exits via the existing 'ownership_lost' path. Idempotent — calling
// on an already-terminal run is a no-op.

router.post(
  '/api/agent-runs/:runId/cancel',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const result = await agentRunCancelService.cancelRun(
      req.orgId!,
      req.params.runId,
      req.user!.id,
    );
    res.json({ ok: true, ...result });
  }),
);

router.get('/api/system/agent-activity/stats', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { sinceDays } = req.query;
  const stats = await agentActivityService.getStats({
    sinceDays: sinceDays ? Number(sinceDays) : undefined,
  });
  res.json(stats);
}));

// ─── Resume a blocked agent run after OAuth integration connect ───────────────
// The client calls this after receiving oauth_success from the popup, OR it is
// called server-side by the OAuth callback when state.resumeToken is present.

router.post(
  '/api/agent-runs/resume-from-integration',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT),
  asyncHandler(async (req, res) => {
    const { resumeToken, conversationId } = req.body as { resumeToken?: string; conversationId?: string };
    if (!resumeToken || typeof resumeToken !== 'string' || !/^[a-f0-9]{64}$/.test(resumeToken)) {
      // Mirror the validation applied at the OAuth callback path: tokens are
      // 32-byte hex (64 chars). Anything else is a forged or malformed token —
      // reject with 400 before hashing so we never store partial state.
      throw Object.assign(new Error('resumeToken required'), { statusCode: 400, errorCode: 'INVALID_TOKEN' });
    }
    const result = await resumeFromIntegrationConnect({
      resumeToken,
      organisationId: req.orgId!,
      conversationId,
    });
    res.json({ ...result, conversationId: conversationId ?? '' });
  }),
);

// ─── Phase 1 — Run artifacts: list metadata (spec §4.5.2, §6.1.5) ───────────
//
// Visibility parity with /api/run-artifacts/:id/download and /signed-url:
// listing artifact metadata (display names, IDs, hashes, sizes) leaks the same
// surface as those routes, so it must clear the same gate. Org `AGENTS_VIEW`
// alone is insufficient for system-managed runs and runs the user otherwise
// cannot see in the run trace.
router.get(
  '/api/agent-runs/:runId/artifacts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const orgId = req.orgId!;

    const scopedDb = getOrgScopedDb('agentRuns.artifactsList');
    const [runRow] = await scopedDb
      .select({
        id: agentRuns.id,
        organisationId: agentRuns.organisationId,
        subaccountId: agentRuns.subaccountId,
        agentId: agentRuns.agentId,
        executionScope: agentRuns.executionScope,
      })
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .limit(1);

    if (!runRow) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    // System-managed agents have a non-null `agents.system_agent_id` FK to
    // `system_agents` — same pattern as runArtifacts.ts:106-114.
    const [agentRow] = await scopedDb
      .select({ systemAgentId: agents.systemAgentId })
      .from(agents)
      .where(eq(agents.id, runRow.agentId))
      .limit(1);

    const visibilityRun: AgentRunVisibilityRun = {
      organisationId: runRow.organisationId,
      subaccountId: runRow.subaccountId,
      executionScope: runRow.executionScope,
      isSystemRun: Boolean(agentRow?.systemAgentId),
    };

    const userCtx = await buildUserContextForRun(req, {
      id: runRow.id,
      organisationId: runRow.organisationId,
      subaccountId: runRow.subaccountId,
      executionScope: runRow.executionScope,
    });

    const visibilityUser: AgentRunVisibilityUser = {
      id: userCtx.id,
      role: userCtx.role,
      organisationId: userCtx.organisationId,
      orgPermissions: userCtx.orgPermissions,
    };

    const visibility = resolveAgentRunVisibility(visibilityRun, visibilityUser);
    if (!visibility.canView) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { listForRun } = await import('../services/fileDeliveryService.js');
    const raw = await listForRun(runId, orgId);
    // Strip internal S3 fields before sending to client.
    const artifacts = raw.map(({ storageKey: _sk, storageRegion: _sr, ...pub }) => pub);
    res.json({ artifacts });
  }),
);

// ─── Run Trace: unified event stream (spec §4.4.3) ────────────────────────────
//
// GET /api/agent-runs/:runId/trace
// Read-only (INV-10). Returns unified events across eight source ledger tables
// with cursor pagination, late-event marking, and policy envelope embedding.

const runTraceQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  eventTypes: z
    .string()
    .optional()
    .transform((val) =>
      val
        ? val.split(',').map((s) => s.trim()).filter(Boolean) as RunTraceEventType[]
        : undefined,
    ),
  sinceTimestamp: z.string().datetime().optional(),
  untilTimestamp: z.string().datetime().optional(),
  toolSlug: z.string().optional(),
});

router.get(
  '/api/agent-runs/:runId/trace',
  authenticate,
  // The run trace exposes per-run LLM metadata, tool decisions, review
  // decisions, and the policy envelope snapshot — strictly more sensitive
  // than delegation-graph/chain. Require AGENTS_VIEW so it sits at the same
  // permission bar as /api/agent-activity (run listings).
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const parsed = runTraceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'INVALID_QUERY_PARAMS', message: 'Invalid query parameters' },
        details: parsed.error.flatten(),
      });
      return;
    }

    const { cursor, limit, eventTypes, sinceTimestamp, untilTimestamp, toolSlug } = parsed.data;

    try {
      const result = await runTraceService.query(
        {
          runId: req.params.runId,
          cursor,
          limit,
          eventTypes,
          sinceTimestamp,
          untilTimestamp,
          toolSlug,
        },
        req.orgId!,
      );
      res.json(result);
    } catch (err) {
      if (err instanceof InvalidRunTraceCursorError) {
        res.status(400).json({
          errorCode: err.errorCode,
          message: err.message,
        });
        return;
      }
      throw err;
    }
  }),
);

export default router;
