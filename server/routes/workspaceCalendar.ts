import { Router } from 'express';
import { authenticate, hasSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import { agents, subaccountAgents } from '../db/schema/index.js';
import { workspaceIdentities } from '../db/schema/workspaceIdentities.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { nativeWorkspaceAdapter } from '../adapters/workspace/nativeWorkspaceAdapter.js';
import type { CreateEventParams } from '../adapters/workspace/workspaceAdapterContract.js';
import { workspaceCalendarEvents } from '../db/schema/workspaceCalendarEvents.js';

const router = Router();

// ─── Helper: resolve agent → active identity ──────────────────────────────────

async function resolveIdentityForAgent(agentId: string, organisationId: string) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId)));

  if (!agent) throw Object.assign(new Error('Agent not found'), { statusCode: 404 });

  if (!agent.workspaceActorId) {
    throw Object.assign(new Error('Agent has no workspace actor'), { statusCode: 404 });
  }

  const [identity] = await db
    .select()
    .from(workspaceIdentities)
    .where(eq(workspaceIdentities.actorId, agent.workspaceActorId))
    .limit(1);

  if (!identity) {
    throw Object.assign(new Error('No workspace identity for this agent'), { statusCode: 404 });
  }

  return { agent, identity };
}

// ─── Helper: resolve agent → subaccountId ────────────────────────────────────

async function resolveAgentSubaccountId(agentId: string, organisationId: string): Promise<string> {
  const [link] = await db
    .select({ subaccountId: subaccountAgents.subaccountId })
    .from(subaccountAgents)
    .where(and(eq(subaccountAgents.agentId, agentId), eq(subaccountAgents.organisationId, organisationId)))
    .limit(1);

  if (!link) throw Object.assign(new Error('Agent is not linked to any subaccount'), { statusCode: 404 });
  return link.subaccountId;
}

// ─── GET /api/agents/:agentId/calendar ───────────────────────────────────────

router.get(
  '/api/agents/:agentId/calendar',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const { to } = req.query as { from?: string; to?: string };

    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);
    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.AGENTS_VIEW_CALENDAR);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    const { identity } = await resolveIdentityForAgent(agentId, req.orgId!);

    const untilDate = to ? new Date(to) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const events = await db
      .select()
      .from(workspaceCalendarEvents)
      .where(
        and(
          eq(workspaceCalendarEvents.identityId, identity.id),
          gte(workspaceCalendarEvents.endsAt, new Date()),
          lte(workspaceCalendarEvents.startsAt, untilDate),
        )
      )
      .orderBy(workspaceCalendarEvents.startsAt);

    res.json({ events });
  }),
);

// ─── POST /api/agents/:agentId/calendar/events ───────────────────────────────

router.post(
  '/api/agents/:agentId/calendar/events',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);
    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.AGENTS_VIEW_CALENDAR);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    const { identity } = await resolveIdentityForAgent(agentId, req.orgId!);

    const { title, startsAt, endsAt, attendeeEmails } = req.body as {
      title: string;
      startsAt: string;
      endsAt: string;
      attendeeEmails: string[];
    };

    const params: CreateEventParams = {
      fromIdentityId: identity.id,
      title,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      attendeeEmails: attendeeEmails ?? [],
    };

    const result = await nativeWorkspaceAdapter.createEvent(params);
    res.status(201).json(result);
  }),
);

// ─── POST /api/agents/:agentId/calendar/events/:eventId/respond ──────────────

router.post(
  '/api/agents/:agentId/calendar/events/:eventId/respond',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId, eventId } = req.params;
    const { response } = req.body as { response: 'accepted' | 'declined' | 'tentative' };

    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);
    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.AGENTS_VIEW_CALENDAR);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    await nativeWorkspaceAdapter.respondToEvent(eventId, response);
    res.json({ eventId, response });
  }),
);

export default router;
