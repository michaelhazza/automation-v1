// Live Agent Execution Log — HTTP read endpoints.
// Spec: tasks/live-agent-execution-log-spec.md §5.9, §7.1, §7.3.
//
// Routes:
//   GET /api/agent-runs/:runId/events
//   GET /api/agent-runs/:runId/prompts/:assemblyNumber
//   GET /api/agent-runs/:runId/llm-payloads/:llmRequestId
//
// All three authenticate + run the tier-appropriate visibility check via
// requireAgentRunView (below). The payload endpoint adds a stricter
// AGENTS_EDIT check on top of the view gate — see spec §7.3.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, and } from 'drizzle-orm';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { systemAgents } from '../db/schema/systemAgents.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  getLlmPayload,
  getPrompt,
  streamEvents,
} from '../services/agentExecutionEventService.js';
import {
  resolveAgentRunVisibility,
  type AgentRunVisibilityRun,
  type AgentRunVisibilityUser,
} from '../lib/agentRunVisibility.js';
import { buildUserContextForRun } from '../lib/agentRunPermissionContext.js';

const router = Router();

// ---------------------------------------------------------------------------
// Visibility resolver — shared helper
// ---------------------------------------------------------------------------

interface ResolvedRunContext {
  run: {
    id: string;
    organisationId: string;
    subaccountId: string | null;
    agentId: string;
    executionScope: 'subaccount' | 'org';
    isSystemRun: boolean;
  };
  visibilityRun: AgentRunVisibilityRun;
}

async function loadRunForVisibility(runId: string): Promise<ResolvedRunContext | null> {
  const db = getOrgScopedDb('agentExecutionLog.loadRun');
  const [row] = await db
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
  if (!row) return null;

  // System-tier detection — the run's agent is a system agent.
  const [sysAgent] = await db
    .select({ id: systemAgents.id })
    .from(systemAgents)
    .where(eq(systemAgents.id, row.agentId))
    .limit(1);
  const isSystemRun = Boolean(sysAgent);

  return {
    run: {
      id: row.id,
      organisationId: row.organisationId,
      subaccountId: row.subaccountId,
      agentId: row.agentId,
      executionScope: row.executionScope,
      isSystemRun,
    },
    visibilityRun: {
      organisationId: row.organisationId,
      subaccountId: row.subaccountId,
      executionScope: row.executionScope,
      isSystemRun,
    },
  };
}

async function requireVisibility(
  req: Request,
  res: Response,
  next: NextFunction,
  need: 'view' | 'payload',
): Promise<(ResolvedRunContext & { userCtx: Awaited<ReturnType<typeof buildUserContextForRun>> }) | null> {
  const runId = req.params.runId;
  if (!runId) {
    res.status(400).json({ error: 'runId required' });
    return null;
  }

  const ctx = await loadRunForVisibility(runId);
  if (!ctx) {
    res.status(404).json({ error: 'Run not found' });
    return null;
  }

  const userCtx = await buildUserContextForRun(req, ctx.run);
  const visibilityUser: AgentRunVisibilityUser = {
    id: userCtx.id,
    role: userCtx.role,
    organisationId: userCtx.organisationId,
    orgPermissions: userCtx.orgPermissions,
  };
  const visibility = resolveAgentRunVisibility(ctx.visibilityRun, visibilityUser);

  if (!visibility.canView) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  if (need === 'payload' && !visibility.canViewPayload) {
    res
      .status(403)
      .json({ error: 'Payload view requires agent-edit permission at this run\'s tier.' });
    return null;
  }

  return { ...ctx, userCtx };
}

// ---------------------------------------------------------------------------
// GET /api/agent-runs/:runId/events
// ---------------------------------------------------------------------------

router.get(
  '/api/agent-runs/:runId/events',
  authenticate,
  asyncHandler(async (req, res, next) => {
    const ctx = await requireVisibility(req, res, next, 'view');
    if (!ctx) return;

    const fromSeq = Number(req.query.fromSeq ?? 1);
    const limit = Math.min(Number(req.query.limit ?? 1000) || 1000, 1000);

    const page = await streamEvents(ctx.run.id, {
      fromSeq: Number.isFinite(fromSeq) ? fromSeq : 1,
      limit,
      forUser: {
        id: ctx.userCtx.id,
        role: ctx.userCtx.role,
        organisationId: ctx.userCtx.organisationId,
        orgPermissions: ctx.userCtx.orgPermissions,
        canManageWorkspace: ctx.userCtx.canManageWorkspace,
        canManageSkills: ctx.userCtx.canManageSkills,
        canEditAgents: ctx.userCtx.canEditAgents,
      },
    });

    res.json({ data: page });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/agent-runs/:runId/prompts/:assemblyNumber
// ---------------------------------------------------------------------------

router.get(
  '/api/agent-runs/:runId/prompts/:assemblyNumber',
  authenticate,
  asyncHandler(async (req, res, next) => {
    const ctx = await requireVisibility(req, res, next, 'view');
    if (!ctx) return;
    const assemblyNumber = Number(req.params.assemblyNumber);
    if (!Number.isInteger(assemblyNumber) || assemblyNumber < 1) {
      res.status(400).json({ error: 'assemblyNumber must be a positive integer' });
      return;
    }
    const prompt = await getPrompt(ctx.run.id, assemblyNumber);
    if (!prompt) {
      res.status(404).json({ error: 'Prompt assembly not found' });
      return;
    }
    res.json({ data: prompt });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/agent-runs/:runId/llm-payloads/:llmRequestId — stricter gate
// ---------------------------------------------------------------------------

router.get(
  '/api/agent-runs/:runId/llm-payloads/:llmRequestId',
  authenticate,
  asyncHandler(async (req, res, next) => {
    const ctx = await requireVisibility(req, res, next, 'payload');
    if (!ctx) return;
    const llmRequestId = req.params.llmRequestId;
    if (!llmRequestId) {
      res.status(400).json({ error: 'llmRequestId required' });
      return;
    }
    const payload = await getLlmPayload(llmRequestId);
    if (!payload) {
      res.status(404).json({ error: 'LLM payload not found' });
      return;
    }
    // The payload row is keyed by llm_request_id without a run_id FK; enforce
    // the run↔payload relation here by checking the payload's org matches the
    // run we visibility-gated against.
    if (payload.organisationId !== ctx.run.organisationId) {
      res.status(403).json({ error: 'Payload does not belong to this run' });
      return;
    }
    res.json({ data: payload });
  }),
);

export default router;
