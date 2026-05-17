import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission, requireSystemAdmin, hasOrgPermission } from '../middleware/auth.js';
import { agentExecutionService } from '../services/agentExecutionService.js';
import { agentActivityService } from '../services/agentActivityService.js';
import { agentScheduleService } from '../services/agentScheduleService.js';
import { subaccountAgentService } from '../services/subaccountAgentService.js';
import { agentRunCancelService } from '../services/agentRunCancelService.js';
import { resumeFromIntegrationConnect } from '../services/agentResumeService.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { mapAgentRunToTestResult } from '../services/agentTestRunMapperPure.js';
import { ControllerStyleNotAllowedForAgentError } from '../services/controllerStyleResolver.js';
import { logger } from '../lib/logger.js';
import { runTraceService, InvalidRunTraceCursorError } from '../services/runTraceService.js';
import type { RunTraceEventType } from '../../shared/types/runTraceEvent.js';
import {
  resolveAgentRunVisibility,
  type AgentRunVisibilityRun,
  type AgentRunVisibilityUser,
} from '../lib/agentRunVisibility.js';
import { buildUserContextForRun } from '../lib/agentRunPermissionContext.js';
import { runTraceProjectionForViewer } from '../services/runTracePure.js';

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

    // Generate idempotency key if not provided — prevents duplicate runs on retry.
    //
    // F8 trade-off (audit 2026-05-14, operator decision 2026-05-15): the default
    // key time-buckets to 10s. Two intentional triggers within the same 10s
    // window with identical defaults (same agent + subaccount + user + taskId
    // OR same agent + subaccount + user + 'heartbeat') collide and the second
    // is dropped. Callers that need to issue back-to-back manual runs MUST
    // supply an explicit `idempotencyKey` (e.g. a request-scoped UUID). The
    // 10s bucket is the safer default for the common case of accidental
    // double-click on the "Run" button. See KNOWLEDGE.md §Idempotency keys.
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
//
// User-owned-run visibility (spec §3.6 + lib/agentRunVisibility.ts):
//   - Owner sees the row metadata.
//   - Admin sees the row metadata.
//   - Non-owner non-admin: row excluded entirely.
//
// triggerContext is INTENTIONALLY OMITTED from this list response
// (chatgpt-pr-review R2 F3). It may carry external-source payload / PII —
// callers that need full per-run content go through the existing Run Trace
// detail endpoint (`GET /api/agent-runs/:id/trace`), which owns content
// visibility for both user-owned and subaccount-owned runs.

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
    const rows = await agentActivityService.listRunsByAgentId({
      agentId,
      orgId: req.orgId!,
      limit,
    });

    const role = req.user?.role ?? 'user';
    const isAdmin = role === 'system_admin' || role === 'org_admin';
    const requesterId = req.user!.id;

    // Filter per-row using the user-owned-run privacy contract. All rows
    // returned are metadata-only — `triggerContextRedacted: true` signals
    // to clients that full content is available via the Run Trace detail
    // endpoint, gated by its own visibility rules.
    const runs = rows.flatMap((row) => {
      if (!row.ownerUserId) {
        // Subaccount-owned (legacy) run — visible to anyone with AGENTS_CHAT.
        const { ownerUserId: _ownerUserId, ...publicRow } = row;
        void _ownerUserId;
        return [{ ...publicRow, triggerContextRedacted: true as const }];
      }
      if (row.ownerUserId === requesterId) {
        const { ownerUserId: _ownerUserId, ...publicRow } = row;
        void _ownerUserId;
        return [{ ...publicRow, triggerContextRedacted: true as const }];
      }
      if (isAdmin) {
        const { ownerUserId: _ownerUserId, ...publicRow } = row;
        void _ownerUserId;
        return [{ ...publicRow, triggerContextRedacted: true as const }];
      }
      // Non-owner, non-admin — exclude entirely.
      return [];
    });

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
      const run = await agentActivityService.getRunForTestShape(req.params.id, req.orgId!);
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
    const { run: runRow, toolCallsLog: rawToolCallsLog, skillEvents } =
      await agentActivityService.getTraceEventsData(runId, req.orgId!);
    if (!runRow) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const toolCallsLog = (Array.isArray(rawToolCallsLog) ? rawToolCallsLog : []) as Array<{
      tool?: string;
      name?: string;
      input?: Record<string, unknown>;
      output?: unknown;
      durationMs?: number;
      iteration?: number;
    }>;

    // Narrow payload's runtime shape to the field linkToolCallsToEventIds reads.
    const eventRowsForLink = skillEvents.map((r) => ({
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
    const liveCount = await agentActivityService.getLiveRunCount(req.orgId!);
    res.json({ runningAgents: liveCount });
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

    const result = await agentActivityService.getDailyActivity(
      req.orgId!,
      days,
      subaccountId as string | undefined,
    );
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

    const runRow = await agentActivityService.getRunWithAgentInfo(runId);

    if (!runRow) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const visibilityRun: AgentRunVisibilityRun = {
      organisationId: runRow.organisationId,
      subaccountId: runRow.subaccountId,
      executionScope: runRow.executionScope,
      isSystemRun: Boolean(runRow.systemAgentId),
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

      // Route-layer viewer projection (spec §5.4 — second of two layers).
      //
      // getRunOwnerUserId returns three states:
      //   - string  — run is owned by a specific user
      //   - null    — run is subaccount-owned (no per-user owner)
      //   - undefined — run does not exist or belongs to a different org
      // The undefined case MUST NOT collapse to null — the projection treats
      // ownerUserId===null as "no privacy boundary, return all events". A
      // failed owner lookup is failed closed (404) instead.
      const ownerLookup = await agentActivityService.getRunOwnerUserId(
        req.params.runId,
        req.orgId!,
      );
      if (ownerLookup === undefined) {
        res.status(404).json({
          errorCode: 'RUN_NOT_FOUND',
          message: 'Run not found in this organisation.',
        });
        return;
      }
      const projected = runTraceProjectionForViewer(req.user!.id, {
        ownerUserId: ownerLookup,
        events: result.events as unknown as import('../services/runTracePure.js').ProjectableEvent[],
      });

      res.json({ ...result, events: projected.events });
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
