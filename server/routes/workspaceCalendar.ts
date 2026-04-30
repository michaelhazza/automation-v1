import { Router } from 'express';
import { authenticate, hasSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agents } from '../db/schema/index.js';
import { workspaceIdentities } from '../db/schema/workspaceIdentities.js';
import { workspaceActors } from '../db/schema/workspaceActors.js';
import { eq, and, gte, lte, isNull } from 'drizzle-orm';
import { nativeWorkspaceAdapter } from '../adapters/workspace/nativeWorkspaceAdapter.js';
import type { CreateEventParams } from '../adapters/workspace/workspaceAdapterContract.js';
import { workspaceCalendarEvents } from '../db/schema/workspaceCalendarEvents.js';

const router = Router();

// ─── Helper: resolve agent → active identity ──────────────────────────────────

async function resolveIdentityForAgent(agentId: string, organisationId: string) {
  const scopedDb = getOrgScopedDb('workspaceCalendar.resolveIdentityForAgent');
  const [agent] = await scopedDb
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId)));

  if (!agent) throw Object.assign(new Error('Agent not found'), { statusCode: 404 });

  if (!agent.workspaceActorId) {
    throw Object.assign(new Error('Agent has no workspace actor'), { statusCode: 404 });
  }

  const [identity] = await scopedDb
    .select()
    .from(workspaceIdentities)
    .where(and(
      eq(workspaceIdentities.actorId, agent.workspaceActorId),
      isNull(workspaceIdentities.archivedAt),
    ))
    .limit(1);

  if (!identity) {
    throw Object.assign(new Error('No workspace identity for this agent'), { statusCode: 404 });
  }

  return { agent, identity };
}

// ─── Helper: resolve agent → canonical subaccountId via its workspace actor ──
// Calendar permission scope must come from the agent's home actor row, not
// from `subaccount_agents` — see the matching helper in workspaceMail.ts.

async function resolveAgentSubaccountId(agentId: string, organisationId: string): Promise<string> {
  const scopedDb = getOrgScopedDb('workspaceCalendar.resolveAgentSubaccountId');
  const [agent] = await scopedDb
    .select({ workspaceActorId: agents.workspaceActorId })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId)))
    .limit(1);

  if (!agent) throw Object.assign(new Error('Agent not found'), { statusCode: 404 });
  if (!agent.workspaceActorId) {
    throw Object.assign(new Error('Agent has no workspace actor'), { statusCode: 404 });
  }

  const [actor] = await scopedDb
    .select({ subaccountId: workspaceActors.subaccountId })
    .from(workspaceActors)
    .where(eq(workspaceActors.id, agent.workspaceActorId))
    .limit(1);

  if (!actor) throw Object.assign(new Error('Workspace actor not found'), { statusCode: 404 });
  return actor.subaccountId;
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
    const events = await getOrgScopedDb('workspaceCalendar.get')
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
