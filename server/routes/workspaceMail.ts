import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { hasSubaccountPermission } from '../middleware/auth.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agents, subaccountAgents } from '../db/schema/index.js';
import { workspaceMessages } from '../db/schema/workspaceMessages.js';
import { workspaceIdentities } from '../db/schema/workspaceIdentities.js';
import { eq, and, desc, lt, isNull } from 'drizzle-orm';
import * as workspaceEmailPipeline from '../services/workspace/workspaceEmailPipeline.js';
import { defaultRateLimitCheck } from '../services/workspace/workspaceEmailRateLimit.js';
import { nativeWorkspaceAdapter } from '../adapters/workspace/nativeWorkspaceAdapter.js';
import type { SendEmailParams } from '../../shared/types/workspaceAdapterContract.js';

const router = Router();

const PAGE_SIZE = 50;

// ─── Helper: resolve agent → active identity ──────────────────────────────────

async function resolveIdentityForAgent(agentId: string, organisationId: string) {
  const scopedDb = getOrgScopedDb('workspaceMail.resolveIdentityForAgent');
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

// ─── Helper: resolve agent → subaccountId ────────────────────────────────────

async function resolveAgentSubaccountId(agentId: string, organisationId: string): Promise<string> {
  const [link] = await getOrgScopedDb('workspaceMail.resolveAgentSubaccountId')
    .select({ subaccountId: subaccountAgents.subaccountId })
    .from(subaccountAgents)
    .where(and(eq(subaccountAgents.agentId, agentId), eq(subaccountAgents.organisationId, organisationId)))
    .limit(1);

  if (!link) throw Object.assign(new Error('Agent is not linked to any subaccount'), { statusCode: 404 });
  return link.subaccountId;
}

// ─── GET /api/agents/:agentId/mailbox ────────────────────────────────────────

router.get(
  '/api/agents/:agentId/mailbox',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const cursor = req.query.cursor as string | undefined;

    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);
    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.AGENTS_VIEW_MAILBOX);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    const { identity } = await resolveIdentityForAgent(agentId, req.orgId!);

    const query = getOrgScopedDb('workspaceMail.mailbox')
      .select()
      .from(workspaceMessages)
      .where(
        cursor
          ? and(
              eq(workspaceMessages.identityId, identity.id),
              lt(workspaceMessages.createdAt, new Date(cursor)),
            )
          : eq(workspaceMessages.identityId, identity.id),
      )
      .orderBy(desc(workspaceMessages.createdAt))
      .limit(PAGE_SIZE + 1);

    const rows = await query;
    const hasMore = rows.length > PAGE_SIZE;
    const messages = rows.slice(0, PAGE_SIZE);
    const nextCursor = hasMore ? messages[messages.length - 1].createdAt.toISOString() : null;

    res.json({ messages, nextCursor });
  }),
);

// ─── POST /api/agents/:agentId/mailbox/send ──────────────────────────────────

router.post(
  '/api/agents/:agentId/mailbox/send',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);
    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.AGENTS_VIEW_MAILBOX);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    const { identity } = await resolveIdentityForAgent(agentId, req.orgId!);

    // Body matches the spec contract `SendEmailParams` (minus `fromIdentityId`,
    // which we resolve from the agentId param). `policyContext` is required by
    // the contract but the mailbox UI does not author skill/runId metadata, so
    // we default it here when the caller omits it.
    const params = req.body as Omit<SendEmailParams, 'fromIdentityId'> & {
      policyContext?: SendEmailParams['policyContext'];
    };
    const sendParams: SendEmailParams = {
      ...params,
      fromIdentityId: identity.id,
      policyContext: params.policyContext ?? { skill: 'mailbox-ui', runId: undefined },
    };

    const signatureMetadata = identity.metadata as Record<string, unknown> | null;
    const signatureTemplate =
      typeof signatureMetadata?.signature === 'string'
        ? signatureMetadata.signature
        : '';

    const result = await workspaceEmailPipeline.send(req.orgId!, sendParams, {
      adapter: nativeWorkspaceAdapter,
      signatureContext: {
        template: signatureTemplate,
        subaccountName: subaccountId,
        discloseAsAgent: false,
      },
      rateLimitCheck: defaultRateLimitCheck,
      policyCheck: async () => ({ ok: true }),
    });

    if ('failureReason' in result) {
      if (result.failureReason === 'workspace_mirror_write_failed') {
        res.status(200).json({ sent: true, reconciling: true, ...result });
        return;
      }
      if (result.failureReason === 'workspace_email_rate_limited') {
        res.status(429).json(result);
        return;
      }
      if (result.failureReason === 'workspace_email_sending_disabled') {
        res.status(403).json(result);
        return;
      }
      res.status(500).json(result);
      return;
    }

    res.json(result);
  }),
);

// ─── GET /api/agents/:agentId/mailbox/threads/:threadId ──────────────────────

router.get(
  '/api/agents/:agentId/mailbox/threads/:threadId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { agentId, threadId } = req.params;

    const subaccountId = await resolveAgentSubaccountId(agentId, req.orgId!);
    const allowed = await hasSubaccountPermission(req, subaccountId, SUBACCOUNT_PERMISSIONS.AGENTS_VIEW_MAILBOX);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    const { identity } = await resolveIdentityForAgent(agentId, req.orgId!);

    const messages = await getOrgScopedDb('workspaceMail.thread')
      .select()
      .from(workspaceMessages)
      .where(
        and(
          eq(workspaceMessages.identityId, identity.id),
          eq(workspaceMessages.threadId, threadId),
        ),
      )
      .orderBy(desc(workspaceMessages.createdAt));

    res.json({ messages });
  }),
);

export default router;
