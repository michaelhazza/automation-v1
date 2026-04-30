import crypto from 'node:crypto';
import { eq, and, inArray, isNull, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities.js';
import { workspaceActors } from '../../db/schema/workspaceActors.js';
import { auditEvents } from '../../db/schema/auditEvents.js';
import { connectorConfigService } from '../connectorConfigService.js';
import type { WorkspaceAdapter } from '../../../shared/types/workspaceAdapterContract.js';
import { failure } from '../../../shared/iee/failure.js';
import type { FailureObject } from '../../../shared/iee/failureReason.js';
import { workspaceIdentityService } from './workspaceIdentityService.js';
import { logger } from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrateStartParams {
  organisationId: string;
  subaccountId: string;
  targetBackend: 'synthetos_native' | 'google_workspace';
  targetConnectorConfigId: string;
  migrationRequestId: string;
  initiatedByUserId: string;
}

export interface MigrateIdentityJob {
  organisationId: string;
  subaccountId: string;
  actorId: string;
  currentIdentityId: string;
  targetBackend: 'synthetos_native' | 'google_workspace';
  targetConnectorConfigId: string;
  migrationRequestId: string;
  migrationJobBatchId: string;
  initiatedByUserId: string;
}

// ---------------------------------------------------------------------------
// start — acquire advisory lock, load identities, enqueue per-identity jobs
// ---------------------------------------------------------------------------

/**
 * Begins a subaccount workspace migration by:
 *   1. Acquiring a transaction-scoped advisory lock on the subaccount to
 *      prevent concurrent migrations.
 *   2. Loading all non-archived active/suspended identities for the subaccount.
 *   3. Enqueuing one pg-boss `workspace.migrate-identity` job per identity.
 *
 * Must be called from within an established org-scoped context
 * (i.e. HTTP middleware or a pg-boss worker wrapped by createWorker).
 */
export async function start(
  params: MigrateStartParams,
): Promise<{ migrationJobBatchId: string; total: number } | FailureObject> {
  const db = getOrgScopedDb('workspaceMigrationService.start');

  // (1) Advisory lock — prevents two concurrent migrations for the same subaccount.
  // pg_try_advisory_xact_lock is transaction-scoped: auto-released at tx end.
  const lockKey = hashSubaccountId(params.subaccountId);
  const [lockRow] = await db.execute(
    sql`SELECT pg_try_advisory_xact_lock(${lockKey}::bigint) AS got`,
  );
  if (!(lockRow as Record<string, unknown>)?.got) {
    return failure(
      'workspace_idempotency_collision',
      'migration_already_in_progress',
      { subaccountId: params.subaccountId },
    );
  }

  // (2) Load identities to migrate (active or suspended, not archived), deterministic order
  const identities = await db
    .select()
    .from(workspaceIdentities)
    .where(
      and(
        eq(workspaceIdentities.subaccountId, params.subaccountId),
        inArray(workspaceIdentities.status, ['active', 'suspended']),
        isNull(workspaceIdentities.archivedAt),
      ),
    )
    .orderBy(workspaceIdentities.actorId);

  const batchId = crypto.randomUUID();

  // (3) Enqueue per-identity jobs — lazy import to avoid circular deps
  const { getPgBoss } = await import('../../lib/pgBossInstance.js');
  const boss = await getPgBoss();
  for (const identity of identities) {
    await (boss as any).send(
      'workspace.migrate-identity',
      {
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        actorId: identity.actorId,
        currentIdentityId: identity.id,
        targetBackend: params.targetBackend,
        targetConnectorConfigId: params.targetConnectorConfigId,
        migrationRequestId: params.migrationRequestId,
        migrationJobBatchId: batchId,
        initiatedByUserId: params.initiatedByUserId,
      } satisfies MigrateIdentityJob,
      { retryLimit: 5, retryDelay: 60, retryBackoff: true },
    );
  }

  return { migrationJobBatchId: batchId, total: identities.length };
}

// ---------------------------------------------------------------------------
// processIdentityMigration — pg-boss worker handler, one identity per job
// ---------------------------------------------------------------------------

/**
 * Processes a single identity migration step:
 *   (a) Provision the identity on the target backend.
 *   (b) Activate the target identity.
 *   (c) Archive the source identity (only after target is confirmed active).
 *   (d) Emit a terminal success audit event.
 *
 * Each failure path writes an audit event and re-throws so pg-boss retries.
 * Must be called from within an established org-scoped context — the queueService
 * worker wrapper (createWorker / inline boss.work) is responsible for that.
 */
export async function processIdentityMigration(
  job: MigrateIdentityJob,
  deps: { adapter: WorkspaceAdapter },
): Promise<void> {
  const db = getOrgScopedDb('workspaceMigrationService.processIdentityMigration');

  logger.info('workspace_migration_identity_start', {
    organisationId: job.organisationId,
    operation: 'processIdentityMigration',
    actorId: job.actorId,
    currentIdentityId: job.currentIdentityId,
    batchId: job.migrationJobBatchId,
    migrationRequestId: job.migrationRequestId,
  });

  // Load actor for display name derivation
  const [actor] = await db
    .select()
    .from(workspaceActors)
    .where(eq(workspaceActors.id, job.actorId));
  if (!actor) {
    throw new Error(`actor not found: ${job.actorId}`);
  }

  // Resolve tenant config for the subaccount (signature template etc.)
  const tenantConfig = await connectorConfigService.getWorkspaceTenantConfig(
    job.organisationId,
    job.subaccountId,
  );

  const provisioningRequestId = `${job.migrationRequestId}:${job.actorId}`;

  // (a) Provision on target backend
  let provisioned: { identityId: string };
  try {
    provisioned = await deps.adapter.provisionIdentity({
      actorId: job.actorId,
      subaccountId: job.subaccountId,
      organisationId: job.organisationId,
      connectorConfigId: job.targetConnectorConfigId,
      emailLocalPart: deriveLocalPart(actor.displayName),
      displayName: actor.displayName,
      signature: tenantConfig.defaultSignatureTemplate,
      emailSendingEnabled: true,
      provisioningRequestId,
    });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    await db.insert(auditEvents).values({
      organisationId: job.organisationId,
      actorType: 'system' as const,
      workspaceActorId: job.actorId,
      action: 'identity.migration_failed',
      entityType: 'workspace_identity',
      metadata: {
        from: job.currentIdentityId,
        reason,
        batchId: job.migrationJobBatchId,
      },
    });
    throw err;
  }

  // (b) Activate target identity
  try {
    await workspaceIdentityService.transition(
      provisioned.identityId,
      'activate',
      job.initiatedByUserId,
    );
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    await db.insert(auditEvents).values({
      organisationId: job.organisationId,
      actorType: 'system' as const,
      workspaceActorId: job.actorId,
      action: 'identity.migration_activation_failed',
      entityType: 'workspace_identity',
      metadata: {
        from: job.currentIdentityId,
        target: provisioned.identityId,
        reason,
        batchId: job.migrationJobBatchId,
      },
    });
    throw err;
  }

  // (c) Archive source identity (only after target is confirmed active)
  try {
    await workspaceIdentityService.transition(
      job.currentIdentityId,
      'archive',
      job.initiatedByUserId,
    );
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    await db.insert(auditEvents).values({
      organisationId: job.organisationId,
      actorType: 'system' as const,
      workspaceActorId: job.actorId,
      action: 'identity.migration_archive_failed',
      entityType: 'workspace_identity',
      metadata: {
        from: job.currentIdentityId,
        target: provisioned.identityId,
        reason,
        batchId: job.migrationJobBatchId,
      },
    });
    throw err;
  }

  // (d) Terminal success audit
  await db.insert(auditEvents).values({
    organisationId: job.organisationId,
    actorType: 'system' as const,
    workspaceActorId: job.actorId,
    action: 'identity.migrated',
    entityType: 'workspace_identity',
    metadata: {
      from: job.currentIdentityId,
      to: provisioned.identityId,
      batchId: job.migrationJobBatchId,
    },
  });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function hashSubaccountId(saId: string): bigint {
  const hex = crypto.createHash('sha1').update(saId).digest('hex').slice(0, 12);
  return BigInt(`0x${hex}`);
}

function deriveLocalPart(displayName: string): string {
  return displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'agent';
}
