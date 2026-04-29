import { db } from '../../db/index.js';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities.js';
import { workspaceActors } from '../../db/schema/workspaceActors.js';
import { workspaceMessages } from '../../db/schema/workspaceMessages.js';
import { auditEvents } from '../../db/schema/auditEvents.js';
import { eq, sql } from 'drizzle-orm';
import { failure } from '../../../shared/iee/failure.js';
import { logger } from '../../lib/logger.js';
import { computeDedupeKey, applySignature, resolveThreadId } from './workspaceEmailPipelinePure.js';
import type { SendEmailParams, InboundMessage, WorkspaceAdapter } from '../../../shared/types/workspaceAdapterContract.js';
import type { SendEmailResult } from '../../../shared/types/workspaceAdapterContract.js';

interface PipelineDeps {
  adapter: WorkspaceAdapter;
  signatureContext: {
    template: string;
    subaccountName: string;
    agencyName?: string;
    discloseAsAgent: boolean;
  };
  rateLimitCheck: (scope: { identityId: string; organisationId: string }) => Promise<
    | { ok: true; nowEpochMs?: number }
    | { ok: false; scope: 'identity' | 'org'; windowResetAt: Date; nowEpochMs?: number; reason: string }
  >;
  policyCheck: (params: SendEmailParams) => Promise<{ ok: boolean; reason?: string }>;
}

export async function send(
  orgId: string,
  params: SendEmailParams,
  deps: PipelineDeps,
): Promise<SendEmailResult | ReturnType<typeof failure>> {
  // Step 1: load identity, check sending-enabled
  const [identity] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, params.fromIdentityId));
  if (!identity) return failure('internal_error', `Identity ${params.fromIdentityId} not found`);
  if (!identity.emailSendingEnabled) {
    return failure('workspace_email_sending_disabled', 'email sending is disabled for this identity', { identityId: params.fromIdentityId });
  }

  // Step 2: policy check
  const policy = await deps.policyCheck(params);
  if (!policy.ok) {
    return failure('workspace_provider_acl_denied', policy.reason ?? 'policy denied', {});
  }

  // Step 3: rate-limit check
  const rl = await deps.rateLimitCheck({ identityId: params.fromIdentityId, organisationId: orgId });
  if (!rl.ok) {
    return failure('workspace_email_rate_limited', rl.reason, { scope: rl.scope, windowResetAt: rl.windowResetAt?.toISOString() });
  }

  // Step 4: apply signature
  const [actorRow] = await db.select().from(workspaceActors).where(eq(workspaceActors.id, identity.actorId));
  const signedBody = applySignature(params.bodyText, {
    template: deps.signatureContext.template,
    agentName: identity.displayName,
    role: actorRow?.agentRole ?? 'Agent',
    subaccountName: deps.signatureContext.subaccountName,
    agencyName: deps.signatureContext.agencyName,
    discloseAsAgent: deps.signatureContext.discloseAsAgent,
  });

  // Step 5: write audit row (TX1 anchor — committed before adapter call)
  const [auditRow] = await db.insert(auditEvents).values({
    organisationId: orgId,
    actorType: 'agent',
    workspaceActorId: identity.actorId,
    action: 'email.sent',
    entityType: 'workspace_message',
    metadata: {
      toAddresses: params.toAddresses,
      subject: params.subject,
      skill: params.policyContext.skill,
      runId: params.policyContext.runId,
    },
  }).returning();

  // Invariant #10 — structured INFO log at operation start
  logger.info('workspace.email.send', {
    organisationId: orgId,
    subaccountId: identity.subaccountId,
    operation: 'send',
    actorId: identity.actorId,
    identityId: identity.id,
    connectorType: identity.backend,
    connectorConfigId: identity.connectorConfigId,
    rateLimitKey: null,
    requestId: params.policyContext.runId ?? null,
    auditEventId: auditRow.id,
    skill: params.policyContext.skill ?? null,
  });

  // Step 6: adapter call — outside any transaction
  const adapterResult = await deps.adapter.sendEmail({
    ...params,
    bodyText: signedBody,
    idempotencyKey: auditRow.id,
  });

  // TX2: canonical mirror write
  try {
    const threadId = params.threadId ?? await resolveThreadId(
      { inReplyToExternalId: params.inReplyToExternalId, referencesExternalIds: [] },
      async (ids) => {
        if (!ids.length) return null;
        const [row] = await db.select({ threadId: workspaceMessages.threadId })
          .from(workspaceMessages)
          .where(eq(workspaceMessages.externalMessageId, ids[0]));
        return row?.threadId ?? null;
      },
    );
    const [inserted] = await db.insert(workspaceMessages).values({
      organisationId: orgId,
      subaccountId: identity.subaccountId,
      identityId: identity.id,
      actorId: identity.actorId,
      threadId,
      externalMessageId: adapterResult.externalMessageId,
      direction: 'outbound',
      fromAddress: identity.emailAddress,
      toAddresses: params.toAddresses,
      ccAddresses: params.ccAddresses ?? null,
      subject: params.subject,
      bodyText: params.bodyText,
      bodyHtml: params.bodyHtml ?? null,
      sentAt: new Date(),
      auditEventId: auditRow.id,
      metadata: adapterResult.metadata ?? {},
    }).returning();
    return { messageId: inserted.id, externalMessageId: adapterResult.externalMessageId };
  } catch (mirrorErr: unknown) {
    const errMsg = mirrorErr instanceof Error ? mirrorErr.message : String(mirrorErr);
    logger.error('workspace.email.mirror_write_failed', {
      auditEventId: auditRow.id,
      externalMessageId: adapterResult.externalMessageId,
      error: errMsg,
    });
    return failure('workspace_mirror_write_failed', 'canonical mirror write failed after successful send', {
      auditEventId: auditRow.id,
      externalMessageId: adapterResult.externalMessageId,
    });
  }
}

export async function ingest(
  orgId: string,
  identityId: string,
  raw: InboundMessage,
  _deps: { adapter: WorkspaceAdapter },
): Promise<{ messageId: string; deduplicated: boolean }> {
  const dedupeKey = computeDedupeKey({
    fromAddress: raw.fromAddress,
    subject: raw.subject ?? '',
    sentAtIso: raw.sentAt.toISOString(),
    providerMessageId: raw.rawProviderId,
  });

  const threadId = await resolveThreadId(
    { inReplyToExternalId: raw.inReplyToExternalId ?? undefined, referencesExternalIds: raw.referencesExternalIds },
    async (ids) => {
      if (!ids.length) return null;
      const [row] = await db.select({ threadId: workspaceMessages.threadId })
        .from(workspaceMessages)
        .where(eq(workspaceMessages.externalMessageId, ids[0]));
      return row?.threadId ?? null;
    },
  );

  const [identity] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, identityId));
  if (!identity) throw new Error(`Identity ${identityId} not found`);

  logger.info('workspace.email.ingest', {
    organisationId: orgId,
    subaccountId: identity.subaccountId,
    operation: 'ingest',
    actorId: identity.actorId,
    identityId: identity.id,
    connectorType: identity.backend,
    connectorConfigId: identity.connectorConfigId,
    rateLimitKey: null,
    requestId: null,
  });

  const [auditRow] = await db.insert(auditEvents).values({
    organisationId: orgId,
    actorType: 'agent',
    workspaceActorId: identity.actorId,
    action: 'email.received',
    entityType: 'workspace_message',
    metadata: { fromAddress: raw.fromAddress, subject: raw.subject },
  }).returning();

  try {
    const [inserted] = await db.insert(workspaceMessages).values({
      organisationId: orgId,
      subaccountId: identity.subaccountId,
      identityId: identity.id,
      actorId: identity.actorId,
      threadId,
      externalMessageId: raw.externalMessageId,
      direction: 'inbound',
      fromAddress: raw.fromAddress,
      toAddresses: raw.toAddresses,
      ccAddresses: raw.ccAddresses,
      subject: raw.subject,
      bodyText: raw.bodyText,
      bodyHtml: raw.bodyHtml,
      sentAt: raw.sentAt,
      receivedAt: raw.receivedAt,
      auditEventId: auditRow.id,
      attachmentsCount: raw.attachmentsCount,
      metadata: { dedupe_key: dedupeKey, provider_id: raw.rawProviderId },
    }).returning();
    return { messageId: inserted.id, deduplicated: false };
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '23505') {
      // Unique constraint violated — deduplicated
      const [existing] = await db.select({ id: workspaceMessages.id })
        .from(workspaceMessages)
        .where(sql`${workspaceMessages.metadata}->>'dedupe_key' = ${dedupeKey}`);
      return { messageId: existing?.id ?? '', deduplicated: true };
    }
    throw err;
  }
}
