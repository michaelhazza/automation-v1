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
import { canonicalInboxes } from '../db/schema/index.js';
import type { CanonicalInbox } from '../db/schema/canonicalInboxes.js';
import type { PrincipalContext } from './principal/types.js';
import {
  SupportInboxAgentConfigSchema,
  type SupportInboxAgentConfig,
} from '../../shared/types/supportInboxAgentConfig.js';

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function notFoundError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 404, message });
}

function agentConfigInvalidError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 422, message });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all inboxes for the org.
 */
export async function listInboxes(
  principalCtx: PrincipalContext,
): Promise<CanonicalInbox[]> {
  const db = getOrgScopedDb('supportInboxService.listInboxes');
  return db
    .select()
    .from(canonicalInboxes)
    .where(eq(canonicalInboxes.organisationId, principalCtx.organisationId))
    .orderBy(canonicalInboxes.createdAt);
}

/**
 * Get a single inbox by id.
 * Throws 404 if not found.
 */
export async function getInbox(
  inboxId: string,
  principalCtx: PrincipalContext,
): Promise<CanonicalInbox> {
  const db = getOrgScopedDb('supportInboxService.getInbox');
  const [inbox] = await db
    .select()
    .from(canonicalInboxes)
    .where(
      and(
        eq(canonicalInboxes.id, inboxId),
        eq(canonicalInboxes.organisationId, principalCtx.organisationId),
      ),
    )
    .limit(1);

  if (!inbox) {
    throw notFoundError('support.inbox.not_found');
  }

  return inbox;
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
