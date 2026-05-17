/**
 * supportInboxService — CRUD for canonical_inboxes with Zod-validated agent_config writes.
 *
 * Spec: tasks/builds/support-desk-canonical/spec.md §5.1.A, §18
 *
 * All DB access goes through getOrgScopedDb() — every caller must run inside an
 * active withOrgTx block.
 */

import { eq, and } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { canonicalInboxes, connectorConfigs } from '../db/schema/index.js';
import type { CanonicalInbox } from '../db/schema/canonicalInboxes.js';
import type { PrincipalContext } from './principal/types.js';
import {
  SupportInboxAgentConfigSchema,
  type SupportInboxAgentConfig,
} from '../../shared/types/supportInboxAgentConfig.js';

// ---------------------------------------------------------------------------
// Sync-health types and classifier
// ---------------------------------------------------------------------------

export type SyncHealth = 'running' | 'degraded' | 'failed';

export interface InboxWithSyncHealth extends CanonicalInbox {
  syncHealth: SyncHealth;
  lastSyncAt: Date | null;
  syncErrorMessage: string | null;
}

function classifyHealth(cc: {
  status: string;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}): SyncHealth {
  if (cc.status === 'error' || cc.status === 'disconnected') return 'failed';
  if (cc.lastSyncStatus === 'error') return 'failed';
  if (cc.lastSyncStatus === 'partial') return 'degraded';
  return 'running';
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function notFoundError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 404, message });
}

function forbiddenError(errorCode: string, message?: string): Error {
  return Object.assign(new Error(message ?? errorCode), { statusCode: 403, errorCode });
}

function agentConfigInvalidError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 422, message });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all inboxes for the org, including sync-health derived from connector_configs.
 *
 * @param options.activeOnly - when true, restricts results to inboxes where isActive = true
 */
export async function listInboxes(
  principalCtx: PrincipalContext,
  options?: { activeOnly?: boolean },
): Promise<InboxWithSyncHealth[]> {
  const db = getOrgScopedDb('supportInboxService.listInboxes');

  const conditions = [eq(canonicalInboxes.organisationId, principalCtx.organisationId)];
  if (principalCtx.subaccountId !== null) {
    conditions.push(eq(canonicalInboxes.subaccountId, principalCtx.subaccountId));
  }
  if (options?.activeOnly === true) {
    conditions.push(eq(canonicalInboxes.isActive, true));
  }

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const rows = await db
    .select({
      inbox: canonicalInboxes,
      connectorStatus: connectorConfigs.status,
      lastSyncAt: connectorConfigs.lastSyncAt,
      lastSyncStatus: connectorConfigs.lastSyncStatus,
      lastSyncError: connectorConfigs.lastSyncError,
    })
    .from(canonicalInboxes)
    .leftJoin(connectorConfigs, eq(canonicalInboxes.connectorConfigId, connectorConfigs.id))
    .where(and(...conditions))
    .orderBy(canonicalInboxes.createdAt);

  return rows.map(r => ({
    ...r.inbox,
    syncHealth: classifyHealth({
      status: r.connectorStatus ?? 'active',
      lastSyncStatus: r.lastSyncStatus ?? null,
      lastSyncError: r.lastSyncError ?? null,
    }),
    lastSyncAt: r.lastSyncAt ?? null,
    syncErrorMessage: r.lastSyncError ?? null,
  }));
}

/**
 * Get a single inbox by id, including sync-health.
 * Throws 404 if not found.
 */
export async function getInbox(
  inboxId: string,
  principalCtx: PrincipalContext,
): Promise<InboxWithSyncHealth> {
  const db = getOrgScopedDb('supportInboxService.getInbox');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [row] = await db
    .select({
      inbox: canonicalInboxes,
      connectorStatus: connectorConfigs.status,
      lastSyncAt: connectorConfigs.lastSyncAt,
      lastSyncStatus: connectorConfigs.lastSyncStatus,
      lastSyncError: connectorConfigs.lastSyncError,
    })
    .from(canonicalInboxes)
    .leftJoin(connectorConfigs, eq(canonicalInboxes.connectorConfigId, connectorConfigs.id))
    .where(
      and(
        eq(canonicalInboxes.id, inboxId),
        eq(canonicalInboxes.organisationId, principalCtx.organisationId),
        ...(principalCtx.subaccountId !== null
          ? [eq(canonicalInboxes.subaccountId, principalCtx.subaccountId)]
          : []),
      ),
    )
    .limit(1);

  if (!row) {
    throw notFoundError('support.inbox.not_found');
  }

  return {
    ...row.inbox,
    syncHealth: classifyHealth({
      status: row.connectorStatus ?? 'active',
      lastSyncStatus: row.lastSyncStatus ?? null,
      lastSyncError: row.lastSyncError ?? null,
    }),
    lastSyncAt: row.lastSyncAt ?? null,
    syncErrorMessage: row.lastSyncError ?? null,
  };
}

/**
 * Get a single inbox by org only (no subaccount filter).
 * Used by the PATCH route to load the existing config for merge, so that the
 * subaccount scope check fires at the write step (updateAgentConfig) rather than
 * silently returning 404 here.
 * Throws 404 if not found within the org.
 */
export async function getInboxForOrg(
  inboxId: string,
  organisationId: string,
): Promise<InboxWithSyncHealth> {
  const db = getOrgScopedDb('supportInboxService.getInboxForOrg');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [row] = await db
    .select({
      inbox: canonicalInboxes,
      connectorStatus: connectorConfigs.status,
      lastSyncAt: connectorConfigs.lastSyncAt,
      lastSyncStatus: connectorConfigs.lastSyncStatus,
      lastSyncError: connectorConfigs.lastSyncError,
    })
    .from(canonicalInboxes)
    .leftJoin(connectorConfigs, eq(canonicalInboxes.connectorConfigId, connectorConfigs.id))
    .where(
      and(
        eq(canonicalInboxes.id, inboxId),
        eq(canonicalInboxes.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (!row) {
    throw notFoundError('support.inbox.not_found');
  }

  return {
    ...row.inbox,
    syncHealth: classifyHealth({
      status: row.connectorStatus ?? 'active',
      lastSyncStatus: row.lastSyncStatus ?? null,
      lastSyncError: row.lastSyncError ?? null,
    }),
    lastSyncAt: row.lastSyncAt ?? null,
    syncErrorMessage: row.lastSyncError ?? null,
  };
}

/**
 * Verify the principal's subaccount scope matches the inbox's. Throws 403
 * support.inbox.scope_mismatch if the inbox belongs to a sibling subaccount.
 * Org-tier principals (principal.subaccountId === null) bypass — they have
 * cross-subaccount authority by definition.
 *
 * SUPPORT-PATCH-SCOPE-ORDER (audit 2026-05-15, operator-approved 2026-05-15):
 * callers MUST invoke this BEFORE any req.body validation so that a sibling-
 * subaccount caller always receives 403, regardless of payload validity.
 * Previously the scope check fired inside updateAgentConfig (line 240) AFTER
 * the Zod parse, which produced 422 for invalid payloads from sibling callers.
 */
export function assertInboxScope(
  inbox: Pick<CanonicalInbox, 'subaccountId'>,
  principalCtx: PrincipalContext,
): void {
  if (
    principalCtx.subaccountId !== null &&
    inbox.subaccountId !== principalCtx.subaccountId
  ) {
    throw forbiddenError('support.inbox.scope_mismatch');
  }
}

/**
 * Update the agent_config for an inbox.
 * Runs SupportInboxAgentConfigSchema.parse(config) before the UPDATE — throws
 * { statusCode: 422, message: 'support.inbox.agent_config_invalid' } on parse failure.
 * Returns the updated inbox row.
 */
export async function updateAgentConfig(
  inboxId: string,
  config: SupportInboxAgentConfig,
  principalCtx: PrincipalContext,
): Promise<CanonicalInbox> {
  // Validate config with Zod before touching the DB
  let parsedConfig: SupportInboxAgentConfig;
  try {
    parsedConfig = SupportInboxAgentConfigSchema.parse(config);
  } catch {
    throw agentConfigInvalidError('support.inbox.agent_config_invalid');
  }

  const db = getOrgScopedDb('supportInboxService.updateAgentConfig');

  // Load the inbox first to assert subaccount ownership
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [existingRow] = await db
    .select()
    .from(canonicalInboxes)
    .where(
      and(
        eq(canonicalInboxes.id, inboxId),
        eq(canonicalInboxes.organisationId, principalCtx.organisationId),
      ),
    )
    .limit(1);

  if (!existingRow) {
    throw notFoundError('support.inbox.not_found');
  }

  assertInboxScope(existingRow, principalCtx);

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [updated] = await db
    .update(canonicalInboxes)
    .set({
      agentConfig: parsedConfig,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(canonicalInboxes.id, inboxId),
        eq(canonicalInboxes.organisationId, principalCtx.organisationId),
      ),
    )
    .returning();

  if (!updated) {
    throw notFoundError('support.inbox.not_found');
  }

  return updated;
}
