import { Router } from 'express';
import { authenticate, requireSubaccountPermission, hasSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js'; // guard-ignore: rls-contract-compliance reason="D2 deferred — route helpers use organisationId-scoped queries; service extraction tracked in tasks/todo.md"
import { agents, subaccountAgents } from '../db/schema/index.js';
import { workspaceIdentities } from '../db/schema/workspaceIdentities.js';
import { workspaceActors } from '../db/schema/workspaceActors.js';
import { eq, and } from 'drizzle-orm';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { connectorConfigService } from '../services/connectorConfigService.js';
import { workspaceIdentityService } from '../services/workspace/workspaceIdentityService.js';
import * as workspaceOnboardingService from '../services/workspace/workspaceOnboardingService.js';
import { nativeWorkspaceAdapter } from '../adapters/workspace/nativeWorkspaceAdapter.js';

const router = Router();

// ─── Helper: resolve agent's active workspace identity ────────────────────────

async function resolveAgentIdentity(agentId: string, organisationId: string) {
  const [agent] = await db
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

// ─── Helper: resolve agent's subaccountId ─────────────────────────────────────

async function resolveAgentSubaccountId(agentId: string, organisationId: string): Promise<string> {
  const [link] = await db
    .select({ subaccountId: subaccountAgents.subaccountId })
    .from(subaccountAgents)
    .where(
      and(
        eq(subaccountAgents.agentId, agentId),
        eq(subaccountAgents.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (!link) {
    throw Object.assign(new Error('Agent is not linked to any subaccount'), { statusCode: 404 });
  }
  return link.subaccountId;
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

    res.json({
      backend: connectorConfig?.connectorType ?? null,
      connectorConfigId: connectorConfig?.id ?? null,
      seatUsage: { active, suspended, total },
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
    await nativeWorkspaceAdapter.suspendIdentity(identity.id);
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
    await nativeWorkspaceAdapter.resumeIdentity(identity.id);
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
    const [actorRow] = await db
      .select()
      .from(workspaceActors)
      .where(eq(workspaceActors.id, identity.actorId));

    const displayName = actorRow?.displayName ?? agent.name;
    if (confirmName !== displayName) {
      res.status(400).json({ error: 'confirmName does not match agent display name', expected: displayName });
      return;
    }

    const result = await workspaceIdentityService.transition(identity.id, 'revoke', req.userId!);
    await nativeWorkspaceAdapter.revokeIdentity(identity.id);
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
    await nativeWorkspaceAdapter.archiveIdentity(identity.id);
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
    await workspaceIdentityService.setEmailSending(identity.id, enabled, req.userId!);
    res.json({ identityId: identity.id, emailSendingEnabled: enabled });
  }),
);

export default router;
