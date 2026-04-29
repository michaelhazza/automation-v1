import { Router } from 'express';
import { authenticate, requireSubaccountPermission, hasSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agents, subaccountAgents, users } from '../db/schema/index.js';
import { workspaceIdentities } from '../db/schema/workspaceIdentities.js';
import { workspaceActors } from '../db/schema/workspaceActors.js';
import { eq, and, isNull } from 'drizzle-orm';
import { orgSubscriptions } from '../db/schema/orgSubscriptions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { connectorConfigService } from '../services/connectorConfigService.js';
import { workspaceIdentityService } from '../services/workspace/workspaceIdentityService.js';
import * as workspaceOnboardingService from '../services/workspace/workspaceOnboardingService.js';
import { nativeWorkspaceAdapter } from '../adapters/workspace/nativeWorkspaceAdapter.js';
import { googleWorkspaceAdapter } from '../adapters/workspace/googleWorkspaceAdapter.js';
import { auditEvents } from '../db/schema/auditEvents.js';
import { env } from '../lib/env.js';

function resolveAdapter(backend: string) {
  return backend === 'google_workspace' ? googleWorkspaceAdapter : nativeWorkspaceAdapter;
}

const router = Router();

// ─── Helper: resolve agent's active workspace identity ────────────────────────

async function resolveAgentIdentity(agentId: string, organisationId: string) {
  const [agent] = await getOrgScopedDb('workspace.resolveAgentIdentity')
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId)));

  if (!agent) {
    throw Object.assign(new Error('Agent not found'), { statusCode: 404 });
  }

  const identities = await workspaceIdentityService.getIdentitiesForActor(agent.workspaceActorId ?? '');
  // Find the most actionable identity (active/provisioned first, then suspended)
  const identity =
    identities.find((i) => i.status === 'active' || i.status === 'provisioned') ??
    identities.find((i) => i.status === 'suspended') ??
    identities.find((i) => i.status === 'revoked');
  if (!identity) {
    throw Object.assign(new Error('No workspace identity for this agent'), { statusCode: 404 });
  }
  return { agent, identity };
}

// ─── Helper: resolve agent's canonical subaccountId ───────────────────────────
// The agent's home subaccount is the one that owns its workspace_actor row
// (agents.workspace_actor_id → workspace_actors.subaccount_id). The legacy
// `subaccount_agents` link table can map an agent to multiple subaccounts —
// resolving permission scope from there with LIMIT 1 was non-deterministic
// and could let a caller authenticate via the "wrong" subaccount link.

async function resolveAgentSubaccountId(agentId: string, organisationId: string): Promise<string> {
  const scopedDb = getOrgScopedDb('workspace.resolveAgentSubaccountId');
  const [agent] = await scopedDb
    .select({ workspaceActorId: agents.workspaceActorId })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId)))
    .limit(1);

  if (!agent) {
    throw Object.assign(new Error('Agent not found'), { statusCode: 404 });
  }
  if (!agent.workspaceActorId) {
    throw Object.assign(new Error('Agent has no workspace actor'), { statusCode: 404 });
  }

  const [actor] = await scopedDb
    .select({ subaccountId: workspaceActors.subaccountId })
    .from(workspaceActors)
    .where(eq(workspaceActors.id, agent.workspaceActorId))
    .limit(1);

  if (!actor) {
    throw Object.assign(new Error('Workspace actor not found'), { statusCode: 404 });
  }
  return actor.subaccountId;
}

// ─── POST /api/subaccounts/:subaccountId/workspace/configure ─────────────────

router.post(
  '/api/subaccounts/:subaccountId/workspace/configure',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_CONNECTOR_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const { backend, domain } = req.body as {
      backend: 'synthetos_native' | 'google_workspace';
      domain?: string;
    };

    await resolveSubaccount(subaccountId, req.orgId!);

    const configJson: Record<string, unknown> = {};
    if (domain) configJson.domain = domain;

    const existing = await connectorConfigService.getBySubaccountAndType(req.orgId!, subaccountId, backend);

    if (!existing) {
      const created = await connectorConfigService.createForSubaccount(req.orgId!, subaccountId, {
        connectorType: backend,
        configJson,
      });
      res.json({ configured: true, connectorConfigId: created.id });
    } else {
      await connectorConfigService.update(existing.id, req.orgId!, {
        configJson: { ...(existing.configJson as Record<string, unknown> ?? {}), ...configJson },
      });
      res.json({ configured: true, connectorConfigId: existing.id });
    }
  }),
);

// ─── POST /api/subaccounts/:subaccountId/workspace/onboard ───────────────────

router.post(
  '/api/subaccounts/:subaccountId/workspace/onboard',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.AGENTS_ONBOARD),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const {
      agentId,
      displayName,
      emailLocalPart,
      emailSendingEnabled,
      signatureOverride,
      onboardingRequestId,
    } = req.body as {
      agentId: string;
      displayName: string;
      emailLocalPart: string;
      emailSendingEnabled: boolean;
      signatureOverride?: string;
      onboardingRequestId: string;
    };

    await resolveSubaccount(subaccountId, req.orgId!);

    // Determine backend from the agent's identity if already onboarded, else default native
    const connectorConfig = await connectorConfigService.getBySubaccountAndType(
      req.orgId!,
      subaccountId,
      'synthetos_native',
    );

    const connectorConfigId = connectorConfig?.id ?? 'pending';

    const result = await workspaceOnboardingService.onboard(
      {
        organisationId: req.orgId!,
        subaccountId,
        agentId,
        displayName,
        emailLocalPart,
        emailSendingEnabled,
        signatureOverride,
        onboardingRequestId,
        initiatedByUserId: req.userId!,
      },
      {
        adapter: nativeWorkspaceAdapter,
        connectorConfigId,
      },
    );

    if ('failureReason' in result) {
      const statusCode = result.failureReason === 'workspace_idempotency_collision' ? 409 : 400;
      res.status(statusCode).json(result);
      return;
    }

    res.json(result);
  }),
);

// ─── POST /api/subaccounts/:subaccountId/workspace/migrate ───────────────────

router.post(
  '/api/subaccounts/:subaccountId/workspace/migrate',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_CONNECTOR_MANAGE),
  asyncHandler(async (_req, res) => {
    res.status(501).json({ status: 'not_implemented' });
  }),
);

// ─── GET /api/subaccounts/:subaccountId/workspace ────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/workspace',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_CONNECTOR_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const connectorConfig = await connectorConfigService.getBySubaccountAndType(
      req.orgId!,
      subaccountId,
      'synthetos_native',
    );

    const identities = await workspaceIdentityService.getActiveIdentitiesForSubaccount(subaccountId);
    const active = identities.filter((i) => i.status === 'active' || i.status === 'provisioned').length;
    const suspended = identities.filter((i) => i.status === 'suspended').length;
    const total = identities.length;

    // Fetch billing snapshot from org_subscriptions for this org
    const scopedDb = getOrgScopedDb('workspace.getConfig');
    const [orgSub] = await scopedDb
      .select({
        consumedSeats: orgSubscriptions.consumedSeats,
        updatedAt: orgSubscriptions.updatedAt,
      })
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.organisationId, req.orgId!))
      .limit(1);

    const billingSnapshot = orgSub?.consumedSeats ?? null;
    const lastSnapshotAt = orgSub?.updatedAt?.toISOString() ?? null;

    // Surface the effective email domain so the UI can render
    // `<localPart>@<domain>` previews without hardcoding a literal.
    const configDomain = (connectorConfig?.configJson as Record<string, unknown> | undefined)?.domain;
    const emailDomain = typeof configDomain === 'string' && configDomain.length > 0
      ? configDomain
      : (env.NATIVE_EMAIL_DOMAIN || 'workspace.local');

    res.json({
      backend: connectorConfig?.connectorType ?? null,
      connectorConfigId: connectorConfig?.id ?? null,
      emailDomain,
      seatUsage: { active, suspended, total, billingSnapshot, lastSnapshotAt },
    });
  }),
);

// ─── Agent lifecycle routes ──────────────────────────────────────────────────
// For agent-scoped routes, we manually resolve subaccount and check permissions
// (requireSubaccountPermission needs :subaccountId in params which isn't available here).

// GET /api/agents/:agentId/identity
router.get(
  '/api/agents/:agentId/identity',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);
    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW);
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { identity } = await resolveAgentIdentity(agentId, req.orgId!);
    res.json({
      identityId: identity.id,
      emailAddress: identity.emailAddress,
      emailSendingEnabled: identity.emailSendingEnabled,
      status: identity.status,
      displayName: identity.displayName,
    });
  }),
);

// POST /api/agents/:agentId/identity/suspend
router.post(
  '/api/agents/:agentId/identity/suspend',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);

    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.AGENTS_MANAGE_LIFECYCLE);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    const { identity } = await resolveAgentIdentity(agentId, req.orgId!);
    const result = await workspaceIdentityService.transition(identity.id, 'suspend', req.userId!);
    if (!result.noOpDueToRace) {
      await resolveAdapter(identity.backend).suspendIdentity(identity.id);
      await getOrgScopedDb('workspace.suspend').insert(auditEvents).values({
        organisationId: req.orgId!,
        actorType: 'agent',
        workspaceActorId: identity.actorId,
        action: 'identity.suspended',
        entityType: 'workspace_identity',
        metadata: { identityId: identity.id },
      });
    }
    res.json(result);
  }),
);

// POST /api/agents/:agentId/identity/resume
router.post(
  '/api/agents/:agentId/identity/resume',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);

    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.AGENTS_MANAGE_LIFECYCLE);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    const { identity } = await resolveAgentIdentity(agentId, req.orgId!);
    const result = await workspaceIdentityService.transition(identity.id, 'resume', req.userId!);
    if (!result.noOpDueToRace) {
      await resolveAdapter(identity.backend).resumeIdentity(identity.id);
      await getOrgScopedDb('workspace.resume').insert(auditEvents).values({
        organisationId: req.orgId!,
        actorType: 'agent',
        workspaceActorId: identity.actorId,
        action: 'identity.resumed',
        entityType: 'workspace_identity',
        metadata: { identityId: identity.id },
      });
    }
    res.json(result);
  }),
);

// POST /api/agents/:agentId/identity/revoke
router.post(
  '/api/agents/:agentId/identity/revoke',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const { confirmName } = req.body as { confirmName: string };
    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);

    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.AGENTS_MANAGE_LIFECYCLE);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    const { agent, identity } = await resolveAgentIdentity(agentId, req.orgId!);

    // Resolve the workspace actor's display name for confirmation
    const [actorRow] = await getOrgScopedDb('workspace.revokeIdentity')
      .select()
      .from(workspaceActors)
      .where(eq(workspaceActors.id, identity.actorId));

    const displayName = actorRow?.displayName ?? agent.name;
    if (confirmName !== displayName && confirmName !== agent.name) {
      res.status(400).json({ error: 'confirmName does not match agent display name', expected: displayName });
      return;
    }

    const result = await workspaceIdentityService.transition(identity.id, 'revoke', req.userId!);
    if (!result.noOpDueToRace) {
      await resolveAdapter(identity.backend).revokeIdentity(identity.id);
      await getOrgScopedDb('workspace.revoke').insert(auditEvents).values({
        organisationId: req.orgId!,
        actorType: 'agent',
        workspaceActorId: identity.actorId,
        action: 'identity.revoked',
        entityType: 'workspace_identity',
        metadata: { identityId: identity.id },
      });
    }
    res.json(result);
  }),
);

// POST /api/agents/:agentId/identity/archive
router.post(
  '/api/agents/:agentId/identity/archive',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);

    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.AGENTS_MANAGE_LIFECYCLE);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    const { identity } = await resolveAgentIdentity(agentId, req.orgId!);
    const result = await workspaceIdentityService.transition(identity.id, 'archive', req.userId!);
    if (!result.noOpDueToRace) {
      await resolveAdapter(identity.backend).archiveIdentity(identity.id);
      await getOrgScopedDb('workspace.archive').insert(auditEvents).values({
        organisationId: req.orgId!,
        actorType: 'agent',
        workspaceActorId: identity.actorId,
        action: 'identity.archived',
        entityType: 'workspace_identity',
        metadata: { identityId: identity.id },
      });
    }
    res.json(result);
  }),
);

// PATCH /api/agents/:agentId/identity/email-sending
router.patch(
  '/api/agents/:agentId/identity/email-sending',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const { enabled } = req.body as { enabled: boolean };
    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);

    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.AGENTS_TOGGLE_EMAIL);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    const { identity } = await resolveAgentIdentity(agentId, req.orgId!);

    // State guard: email sending can only be toggled on identities that are
    // actually capable of sending. Revoked/archived identities are terminal
    // and toggling on them is meaningless — return 409 so the UI can refresh.
    const TOGGLE_ALLOWED: ReadonlyArray<string> = ['active', 'suspended', 'provisioned'];
    if (!TOGGLE_ALLOWED.includes(identity.status)) {
      res.status(409).json({
        error: {
          code: 'invalid_identity_state',
          message: `Cannot toggle email sending on identity in status '${identity.status}'.`,
        },
      });
      return;
    }

    await workspaceIdentityService.setEmailSending(identity.id, enabled, req.userId!);
    await getOrgScopedDb('workspace.emailSending').insert(auditEvents).values({
      organisationId: req.orgId!,
      actorType: 'agent',
      workspaceActorId: identity.actorId,
      action: enabled ? 'identity.email_sending_enabled' : 'identity.email_sending_disabled',
      entityType: 'workspace_identity',
      metadata: { identityId: identity.id, enabled },
    });
    res.json({ identityId: identity.id, emailSendingEnabled: enabled });
  }),
);

// ─── GET /api/subaccounts/:subaccountId/workspace/org-chart ──────────────────

interface OrgChartNode {
  actorId: string;
  actorKind: 'agent' | 'human';
  displayName: string;
  parentActorId: string | null;
  parentValidationError?: 'cross_subaccount_parent' | 'cycle_detected';
  agentRole: string | null;
  agentTitle: string | null;
  identity?: { id: string; emailAddress: string; status: string; photoUrl: string | null };
  user?: { id: string; email: string };
}

router.get(
  '/api/subaccounts/:subaccountId/workspace/org-chart',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_CONNECTOR_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;

    const db = getOrgScopedDb('workspace.orgChart');

    // Fetch all workspace actors for this subaccount
    const actorRows = await db
      .select({
        actorId: workspaceActors.id,
        actorKind: workspaceActors.actorKind,
        displayName: workspaceActors.displayName,
        parentActorId: workspaceActors.parentActorId,
        agentRole: workspaceActors.agentRole,
        agentTitle: workspaceActors.agentTitle,
        // Agent join
        agentId: agents.id,
        // User join
        userId: users.id,
        userEmail: users.email,
        // Identity join (active, non-archived)
        identityId: workspaceIdentities.id,
        identityEmail: workspaceIdentities.emailAddress,
        identityStatus: workspaceIdentities.status,
        identityPhotoUrl: workspaceIdentities.photoUrl,
      })
      .from(workspaceActors)
      .leftJoin(agents, eq(agents.workspaceActorId, workspaceActors.id))
      .leftJoin(users, eq(users.workspaceActorId, workspaceActors.id))
      .leftJoin(
        workspaceIdentities,
        and(
          eq(workspaceIdentities.actorId, workspaceActors.id),
          isNull(workspaceIdentities.archivedAt),
        ),
      )
      .where(eq(workspaceActors.subaccountId, subaccountId));

    // Build a set of all actor IDs in this subaccount for cross-subaccount parent validation
    const actorIdSet = new Set(actorRows.map((r) => r.actorId));

    // Cycle detection via max-depth check (≤10 hops from any node to root)
    const parentMap = new Map<string, string | null>();
    for (const r of actorRows) {
      parentMap.set(r.actorId, r.parentActorId);
    }

    function isInCycle(startId: string): boolean {
      const visited = new Set<string>();
      let current: string | null = startId;
      let hops = 0;
      while (current !== null && hops <= 10) {
        if (visited.has(current)) return true;
        visited.add(current);
        current = parentMap.get(current) ?? null;
        hops++;
      }
      return hops > 10;
    }

    const nodes: OrgChartNode[] = actorRows.map((r) => {
      let parentActorId: string | null = r.parentActorId;
      let parentValidationError: OrgChartNode['parentValidationError'] = undefined;

      if (parentActorId !== null) {
        if (!actorIdSet.has(parentActorId)) {
          // D-Inv-3: parent points outside this subaccount
          parentActorId = null;
          parentValidationError = 'cross_subaccount_parent';
        } else if (isInCycle(r.actorId)) {
          parentActorId = null;
          parentValidationError = 'cycle_detected';
        }
      }

      const node: OrgChartNode = {
        actorId: r.actorId,
        actorKind: r.actorKind as 'agent' | 'human',
        displayName: r.displayName,
        parentActorId,
        agentRole: r.agentRole,
        agentTitle: r.agentTitle,
      };

      if (parentValidationError) {
        node.parentValidationError = parentValidationError;
      }

      if (r.identityId) {
        node.identity = {
          id: r.identityId,
          emailAddress: r.identityEmail!,
          status: r.identityStatus!,
          photoUrl: r.identityPhotoUrl ?? null,
        };
      }

      if (r.userId) {
        node.user = {
          id: r.userId,
          email: r.userEmail!,
        };
      }

      return node;
    });

    res.json(nodes);
  }),
);

// ─── GET /api/subaccounts/:subaccountId/workspace/actors ─────────────────────

router.get(
  '/api/subaccounts/:subaccountId/workspace/actors',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_CONNECTOR_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;

    const db = getOrgScopedDb('workspace.actors');

    const rows = await db
      .select({
        actorId: workspaceActors.id,
        displayName: workspaceActors.displayName,
        actorKind: workspaceActors.actorKind,
      })
      .from(workspaceActors)
      .where(eq(workspaceActors.subaccountId, subaccountId));

    res.json(
      rows.map((r) => ({
        actorId: r.actorId,
        displayName: r.displayName,
        actorKind: r.actorKind as 'agent' | 'human',
      })),
    );
  }),
);

export default router;
