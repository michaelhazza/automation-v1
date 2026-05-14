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
 */
export async function listInboxes(
  principalCtx: PrincipalContext,
): Promise<InboxWithSyncHealth[]> {
  const db = getOrgScopedDb('supportInboxService.listInboxes');
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
    .where(
      principalCtx.subaccountId !== null
        ? and(
            eq(canonicalInboxes.organisationId, principalCtx.organisationId),
            eq(canonicalInboxes.subaccountId, principalCtx.subaccountId),
          )
        : eq(canonicalInboxes.organisationId, principalCtx.organisationId),
    )
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

  if (
    principalCtx.subaccountId !== null &&
    existingRow.subaccountId !== principalCtx.subaccountId
  ) {
    throw forbiddenError('support.inbox.scope_mismatch');
  }

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
