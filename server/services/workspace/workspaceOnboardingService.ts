import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { agents } from '../../db/schema/agents.js';
import { workspaceActors } from '../../db/schema/workspaceActors.js';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities.js';
import { auditEvents } from '../../db/schema/auditEvents.js';
import { eq } from 'drizzle-orm';
import { failure } from '../../../shared/iee/failure.js';
import type { FailureObject } from '../../../shared/iee/failureReason.js';
import { logger } from '../../lib/logger.js';
import { workspaceIdentityService } from './workspaceIdentityService.js';
import { workspaceActorService } from './workspaceActorService.js';
import type { WorkspaceAdapter } from '../../../shared/types/workspaceAdapterContract.js';

export interface OnboardParams {
  organisationId: string;
  subaccountId: string;
  agentId: string;
  displayName: string;
  emailLocalPart: string;
  emailSendingEnabled: boolean;
  signatureOverride?: string;
  onboardingRequestId: string;
  initiatedByUserId: string;
}

export interface OnboardResult {
  identityId: string;
  emailAddress: string;
  idempotent: boolean;
}

// Resume invariant: if a prior attempt created the identity row (status='provisioned') but did not
// complete the transition to 'active', a retry skips the adapter call and resumes from step 8.
// If the identity is already 'active', all three audit events are backfilled idempotently.
export async function onboard(
  params: OnboardParams,
  deps: { adapter: WorkspaceAdapter; connectorConfigId: string },
): Promise<OnboardResult | FailureObject> {
  logger.info('workspace.onboard', {
    organisationId: params.organisationId,
    subaccountId: params.subaccountId,
    operation: 'onboard',
    actorId: null,
    identityId: null,
    connectorType: deps.adapter.backend,
    connectorConfigId: deps.connectorConfigId,
    rateLimitKey: null,
    requestId: params.onboardingRequestId,
  });

  const db = getOrgScopedDb('workspaceOnboardingService');

  // (1) Resolve agent → workspace actor
  const [agent] = await db.select().from(agents).where(eq(agents.id, params.agentId));
  if (!agent || !agent.workspaceActorId) {
    return failure('workspace_identity_provisioning_failed', 'agent has no workspace_actor_id — backfill required');
  }

  const [actorRow] = await db.select().from(workspaceActors).where(eq(workspaceActors.id, agent.workspaceActorId));
  if (!actorRow) {
    return failure('workspace_identity_provisioning_failed', 'workspace actor not found');
  }

  // (3) Status-aware idempotency check: has this onboardingRequestId already been used?
  const [existingIdentity] = await db
    .select()
    .from(workspaceIdentities)
    .where(eq(workspaceIdentities.provisioningRequestId, params.onboardingRequestId));

  if (existingIdentity) {
    if (existingIdentity.status === 'active') {
      // Already fully onboarded — backfill any missing audit events idempotently and return
      await db
        .insert(auditEvents)
        .values([
          {
            organisationId: params.organisationId,
            actorType: 'agent' as const,
            workspaceActorId: actorRow.id,
            action: 'identity.provisioned',
            entityType: 'workspace_identity',
            metadata: { identityId: existingIdentity.id },
          },
          {
            organisationId: params.organisationId,
            actorType: 'agent' as const,
            workspaceActorId: actorRow.id,
            action: 'actor.onboarded',
            entityType: 'workspace_identity',
            metadata: { identityId: existingIdentity.id },
          },
          {
            organisationId: params.organisationId,
            actorType: 'agent' as const,
            workspaceActorId: actorRow.id,
            action: 'identity.activated',
            entityType: 'workspace_identity',
            metadata: { identityId: existingIdentity.id },
          },
        ])
        .onConflictDoNothing();
      return { identityId: existingIdentity.id, emailAddress: existingIdentity.emailAddress, idempotent: true };
    }

    if (existingIdentity.status === 'provisioned') {
      // Prior attempt created the identity row but did not complete activation — resume from step 8
      // (8) Transition identity to 'active' (noOpDueToRace is treated as success)
      await workspaceIdentityService.transition(existingIdentity.id, 'activate', params.initiatedByUserId);

      // (9) Write all three audit events idempotently
      await db
        .insert(auditEvents)
        .values([
          {
            organisationId: params.organisationId,
            actorType: 'agent' as const,
            workspaceActorId: actorRow.id,
            action: 'identity.provisioned',
            entityType: 'workspace_identity',
            metadata: { identityId: existingIdentity.id },
          },
          {
            organisationId: params.organisationId,
            actorType: 'agent' as const,
            workspaceActorId: actorRow.id,
            action: 'actor.onboarded',
            entityType: 'workspace_identity',
            metadata: { identityId: existingIdentity.id },
          },
          {
            organisationId: params.organisationId,
            actorType: 'agent' as const,
            workspaceActorId: actorRow.id,
            action: 'identity.activated',
            entityType: 'workspace_identity',
            metadata: { identityId: existingIdentity.id },
          },
        ])
        .onConflictDoNothing();

      return { identityId: existingIdentity.id, emailAddress: existingIdentity.emailAddress, idempotent: true };
    }

    // Identity is in a terminal state (suspended / revoked / archived) — cannot resume
    return failure(
      'workspace_identity_provisioning_failed',
      `identity already in terminal state: ${existingIdentity.status}`,
    );
  }

  // (5) Update actor display name
  await workspaceActorService.updateDisplayName(actorRow.id, params.displayName);

  // (6) Adapter call (outside any transaction — external side-effect)
  let provisionResult: { identityId: string; emailAddress: string; externalUserId: string | null };
  try {
    provisionResult = await deps.adapter.provisionIdentity({
      actorId: actorRow.id,
      subaccountId: params.subaccountId,
      organisationId: params.organisationId,
      connectorConfigId: deps.connectorConfigId,
      emailLocalPart: params.emailLocalPart,
      displayName: params.displayName,
      signature: params.signatureOverride ?? '',
      emailSendingEnabled: params.emailSendingEnabled,
      provisioningRequestId: params.onboardingRequestId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return failure('workspace_identity_provisioning_failed', msg);
  }

  // (7) Write identity.provisioned audit event (before transition so provisioned moment is visible)
  await db
    .insert(auditEvents)
    .values({
      organisationId: params.organisationId,
      actorType: 'agent' as const,
      workspaceActorId: actorRow.id,
      action: 'identity.provisioned',
      entityType: 'workspace_identity',
      metadata: { identityId: provisionResult.identityId },
    })
    .onConflictDoNothing();

  // (8) Transition identity to 'active'
  await workspaceIdentityService.transition(provisionResult.identityId, 'activate', params.initiatedByUserId);

  // (9) Write remaining audit events
  await db
    .insert(auditEvents)
    .values([
      {
        organisationId: params.organisationId,
        actorType: 'agent' as const,
        workspaceActorId: actorRow.id,
        action: 'actor.onboarded',
        entityType: 'workspace_identity',
        metadata: { identityId: provisionResult.identityId },
      },
      {
        organisationId: params.organisationId,
        actorType: 'agent' as const,
        workspaceActorId: actorRow.id,
        action: 'identity.activated',
        entityType: 'workspace_identity',
        metadata: { identityId: provisionResult.identityId },
      },
    ])
    .onConflictDoNothing();

  return { identityId: provisionResult.identityId, emailAddress: provisionResult.emailAddress, idempotent: false };
}
