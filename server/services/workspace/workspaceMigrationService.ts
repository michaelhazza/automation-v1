import crypto from 'node:crypto';
import { eq, and, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
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

export type MigrationStep = 'provision' | 'activate' | 'archive';

// S1: Zod schema for the per-identity migration job. `satisfies` only buys
// compile-time confidence; a runtime parse before `boss.send` is the only thing
// that prevents a future caller building the payload from untyped data
// (admin script, replayed dead-letter, manual queue insert) publishing a
// poison-pill that the worker only fails on at first field access.
export const MigrateIdentityJobSchema = z.object({
  organisationId: z.string().uuid(),
  subaccountId: z.string().uuid(),
  actorId: z.string().uuid(),
  currentIdentityId: z.string().uuid(),
  targetBackend: z.enum(['synthetos_native', 'google_workspace']),
  targetConnectorConfigId: z.string().uuid(),
  migrationRequestId: z.string().uuid(),
  migrationJobBatchId: z.string().uuid(),
  migrationJobBatchSize: z.number().int().positive(),
  initiatedByUserId: z.string().uuid(),
});

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

// Type derived from the Zod schema so the schema is the single source of truth.
// `migrationJobBatchSize` carries the start()-time snapshot count; the worker
// uses it to detect the LAST identity and write `subaccount.migration_completed`.
export type MigrateIdentityJob = z.infer<typeof MigrateIdentityJobSchema>;

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
  const batchSize = identities.length;
  for (const identity of identities) {
    // S1: Zod-parse before enqueue. Throws synchronously if any caller's input
    // produces a malformed payload — which is what we want, instead of letting
    // a poison-pill into the queue that fails per-attempt for `retryLimit` rounds.
    const payload = MigrateIdentityJobSchema.parse({
      organisationId: params.organisationId,
      subaccountId: params.subaccountId,
      actorId: identity.actorId,
      currentIdentityId: identity.id,
      targetBackend: params.targetBackend,
      targetConnectorConfigId: params.targetConnectorConfigId,
      migrationRequestId: params.migrationRequestId,
      migrationJobBatchId: batchId,
      migrationJobBatchSize: batchSize,
      initiatedByUserId: params.initiatedByUserId,
    });
    await (boss as any).send(
      'workspace.migrate-identity',
      payload,
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
    await writeIdentityMigrationFailed(db, job, 'provision', err, null);
    await maybeFinaliseBatch(db, job);
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
    await writeIdentityMigrationFailed(db, job, 'activate', err, provisioned.identityId);
    await maybeFinaliseBatch(db, job);
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
    await writeIdentityMigrationFailed(db, job, 'archive', err, provisioned.identityId);
    await maybeFinaliseBatch(db, job);
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

  await maybeFinaliseBatch(db, job);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function hashSubaccountId(saId: string): bigint {
  const hex = crypto.createHash('sha1').update(saId).digest('hex').slice(0, 12);
  return BigInt(`0x${hex}`);
}

// B2: separate advisory-lock keyspace for the per-batch finaliser. Distinct prefix
// from the per-subaccount lock used in `start()` so the two never alias.
function hashBatchId(batchId: string): bigint {
  const hex = crypto.createHash('sha1').update(`migration-batch:${batchId}`).digest('hex').slice(0, 12);
  return BigInt(`0x${hex}`);
}

function deriveLocalPart(displayName: string): string {
  return displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'agent';
}

// DE-CR-5: every per-identity step-failure writes a single `identity.migration_failed`
// terminal event. The failed step is recorded in `metadata.step` so callers can
// show "provision failed" / "activation failed" / "archive failed" without needing
// distinct action names that aren't in the spec §14.4 union.
async function writeIdentityMigrationFailed(
  db: ReturnType<typeof getOrgScopedDb>,
  job: MigrateIdentityJob,
  step: MigrationStep,
  err: unknown,
  targetIdentityId: string | null,
): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  await db.insert(auditEvents).values({
    organisationId: job.organisationId,
    actorType: 'system' as const,
    workspaceActorId: job.actorId,
    action: 'identity.migration_failed',
    entityType: 'workspace_identity',
    metadata: {
      from: job.currentIdentityId,
      target: targetIdentityId,
      step,
      reason,
      batchId: job.migrationJobBatchId,
    },
  });
}

// DE-CR-6 / B2: when the LAST in-flight identity for a batch reaches a terminal
// state (success or failure), write a single `subaccount.migration_completed`
// row. Idempotent on (batchId) via the partial unique index in migration 0261.
//
// B2 race fix: under READ COMMITTED, two concurrent workers could both see N-1
// terminal rows (each missing the other's pending commit), both decide "not yet
// done", and the completion row would never be written — leaving the batch
// stranded as `running` forever. The advisory lock serialises the count→insert
// window across workers; the loser sees the winner's committed terminal rows
// (or its already-written completion row, which the partial unique index handles).
async function maybeFinaliseBatch(
  db: ReturnType<typeof getOrgScopedDb>,
  job: MigrateIdentityJob,
): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(${hashBatchId(job.migrationJobBatchId)}::bigint)`);

  const terminalRows = await db
    .select({
      workspaceActorId: auditEvents.workspaceActorId,
      action: auditEvents.action,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, job.organisationId),
        eq(auditEvents.entityType, 'workspace_identity'),
        sql`${auditEvents.metadata}->>'batchId' = ${job.migrationJobBatchId}`,
        inArray(auditEvents.action, ['identity.migrated', 'identity.migration_failed']),
      ),
    );

  // Collapse to one terminal action per actor — `migrated` wins over `migration_failed`
  // for retry scenarios where an earlier attempt failed and a later one succeeded.
  const actorTerminalAction = new Map<string, string>();
  for (const row of terminalRows) {
    if (!row.workspaceActorId) continue;
    const existing = actorTerminalAction.get(row.workspaceActorId);
    if (existing !== 'identity.migrated') {
      actorTerminalAction.set(row.workspaceActorId, row.action);
    }
  }

  // Only finalise when every enqueued identity has reached a terminal state.
  if (actorTerminalAction.size < job.migrationJobBatchSize) return;

  let migrated = 0;
  let failed = 0;
  for (const action of actorTerminalAction.values()) {
    if (action === 'identity.migrated') migrated++;
    else if (action === 'identity.migration_failed') failed++;
  }
  const total = actorTerminalAction.size;

  let status: 'success' | 'partial' | 'failed';
  if (failed === 0) status = 'success';
  else if (migrated === 0) status = 'failed';
  else status = 'partial';

  // Idempotent on (batchId) via partial unique index in migration 0261. We use
  // raw SQL because drizzle's `.onConflictDoNothing()` doesn't support partial
  // expression indexes — the conflict target has to be `WHERE`-qualified to
  // match the partial index inference.
  await db.execute(sql`
    INSERT INTO audit_events (organisation_id, actor_type, action, entity_type, entity_id, metadata, created_at)
    VALUES (
      ${job.organisationId},
      'system',
      'subaccount.migration_completed',
      'subaccount',
      ${job.subaccountId},
      ${JSON.stringify({ batchId: job.migrationJobBatchId, status, total, migrated, failed })}::jsonb,
      NOW()
    )
    ON CONFLICT ((metadata->>'batchId'))
      WHERE entity_type = 'subaccount' AND action = 'subaccount.migration_completed'
    DO NOTHING
  `);
}
