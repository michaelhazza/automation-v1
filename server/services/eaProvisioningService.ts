import { eq, and, isNull, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { agents } from '../db/schema/agents.js';
import { systemAgents } from '../db/schema/systemAgents.js';
import { memoryBlocks } from '../db/schema/memoryBlocks.js';
import { voiceProfiles } from '../db/schema/voiceProfiles.js';
import { deriveProfile } from './voiceProfile/voiceProfileService.js';

export interface EAProvisionInput {
  displayName?: string;
  voiceProfileOptIn: boolean;
  briefingDeliveryTarget: 'slack_dm' | 'email';
  briefingTimeUtc: string;
}

export interface EAProvisionContext {
  userId: string;
  organisationId: string;
}

export interface EAProvisionResult {
  agentId: string;
}

export function buildVoiceProfileInsertValues(ctx: EAProvisionContext) {
  return {
    organisationId: ctx.organisationId,
    ownerUserId: ctx.userId,
    sources: ['gmail_sent_sampler'] as string[],
    sourceConfig: { gmail_sent_sampler: { lastN: 50, sinceDays: 90 } },
    state: 'pending' as const,
    refreshPolicy: 'periodic' as const,
    refreshConfig: { days: 30 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function provisionEA(
  input: EAProvisionInput,
  ctx: EAProvisionContext,
): Promise<EAProvisionResult> {
  // system_agents is a cross-tenant system table — resolve the EA template
  // outside the tenant transaction using withAdminConnection (Tier 2 lookup).
  const [systemAgent] = await withAdminConnection(
    { source: 'eaProvisioningService.provisionEA', reason: 'system_agents is cross-tenant; resolve EA template before tenant transaction' },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      return tx.select({ id: systemAgents.id }).from(systemAgents).where(eq(systemAgents.slug, 'executive-assistant')).limit(1);
    },
  );

  if (!systemAgent) {
    throw Object.assign(new Error('EA system agent template not found'), { statusCode: 500, errorCode: 'template_missing' });
  }

  const scopedDb = getOrgScopedDb('eaProvisioningService.provisionEA');
  return scopedDb.transaction(async (tx) => {
    // Advisory lock — prevent concurrent provisioning for same user
    const [lockRow] = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext('ea_provision:' || ${ctx.userId})) AS acquired`,
    );
    const lockAcquired = (lockRow as { acquired: boolean }).acquired;
    if (!lockAcquired) {
      throw Object.assign(new Error('Already provisioning'), { statusCode: 409, errorCode: 'already_provisioning' });
    }

    // Idempotency — return existing EA agent if already created
    const [existing] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.ownerUserId, ctx.userId),
          eq(agents.slug, 'executive-assistant'),
          isNull(agents.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      return { agentId: existing.id };
    }

    // Insert new agent row
    const agentName = input.displayName ?? 'Personal Assistant';
    const [newAgent] = await tx
      .insert(agents)
      .values({
        organisationId: ctx.organisationId,
        ownerUserId: ctx.userId,
        systemAgentId: systemAgent.id,
        isSystemManaged: true,
        slug: 'executive-assistant',
        name: agentName,
        masterPrompt: '',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: agents.id });

    const agentId = newAgent.id;

    // Insert memory blocks for EA configuration — no subaccount scope (org-level)
    await tx.insert(memoryBlocks).values([
      {
        organisationId: ctx.organisationId,
        name: 'ea.briefing_delivery_target',
        content: input.briefingDeliveryTarget,
        ownerAgentId: agentId,
        isReadOnly: false,
        status: 'active',
        source: 'manual',
        capturedVia: 'manual_edit',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        organisationId: ctx.organisationId,
        name: 'ea.briefing_time',
        content: input.briefingTimeUtc,
        ownerAgentId: agentId,
        isReadOnly: false,
        status: 'active',
        source: 'manual',
        capturedVia: 'manual_edit',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        organisationId: ctx.organisationId,
        name: 'ea.voice_profile_id',
        content: '',
        ownerAgentId: agentId,
        isReadOnly: false,
        status: 'active',
        source: 'manual',
        capturedVia: 'manual_edit',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Voice profile opt-in
    if (input.voiceProfileOptIn) {
      const [profile] = await tx
        .insert(voiceProfiles)
        .values(buildVoiceProfileInsertValues(ctx))
        .returning({ id: voiceProfiles.id });

      // Enqueue derivation asynchronously — do not await
      void deriveProfile(
        { profileId: profile.id },
        { organisationId: ctx.organisationId },
      ).catch(() => { /* derivation errors are non-fatal; state machine handles retries */ });
    }

    return { agentId };
  });
}
