/**
 * integrationBlockService — determines whether a tool call requires a missing
 * integration and generates the block-state payload when it does.
 *
 * v1: the block decision always returns `shouldBlock: false` by default.
 * The interface and token-generation logic are fully wired so the calling
 * path in agentExecutionService is complete and will activate as soon as
 * ACTION_REGISTRY entries declare a `requiredIntegration` field and the
 * connectivity check is enabled.
 *
 * TODO(v2): read ACTION_REGISTRY.requiredIntegration + query integration_connections
 *   to return shouldBlock: true when the required integration is not connected.
 */

import crypto from 'crypto';
import { logger } from '../lib/logger.js';
import type { IntegrationCardContent } from '../../shared/types/integrationCardContent.js';

export type IntegrationBlockDecision =
  | { shouldBlock: false }
  | {
      shouldBlock: true;
      integrationId: string;
      integrationDedupKey: string;
      plaintext: string;        // 32-byte hex plaintext token — caller embeds in message meta
      tokenHash: string;        // sha256(plaintext) — stored in agent_runs column
      expiresAt: Date;          // now + 24h
      card: Omit<IntegrationCardContent, 'actionUrl' | 'resumeToken' | 'schemaVersion'>;
    };

/**
 * Checks whether a tool requires an integration that is not yet connected for
 * this org/subaccount. If so, generates all the block-state fields the caller
 * needs to pause the run and emit an integration_card message.
 *
 * @param toolName - the skill/tool name being dispatched
 * @param _toolArgs - tool input (reserved for future per-arg integration checks)
 * @param ctx - execution context for the current tool call
 */
export async function checkRequiredIntegration(
  toolName: string,
  _toolArgs: Record<string, unknown>,
  ctx: {
    organisationId: string;
    subaccountId: string | null;
    conversationId: string;
    runId: string;
    agentId: string;
    currentBlockSequence: number;
  },
): Promise<IntegrationBlockDecision> {
  // TODO(v2): look up ACTION_REGISTRY entry for toolName.
  // If ACTION_REGISTRY[toolName]?.requiredIntegration is set, query
  // integration_connections WHERE organisation_id = ctx.organisationId
  // AND (subaccount_id = ctx.subaccountId OR subaccount_id IS NULL)
  // AND provider_type = requiredIntegration
  // AND connection_status = 'active'
  // AND oauth_status = 'active'
  // to determine if the integration is already connected.
  //
  // If not connected, call _generateBlockDecision(...) and return it.

  // v1 safe-default: never block.
  logger.debug('integration_block_check.skipped', {
    toolName,
    runId: ctx.runId,
    note: 'v1: ACTION_REGISTRY.requiredIntegration not yet wired',
  });

  return { shouldBlock: false };
}

/**
 * Generates the block-state payload for a tool that requires a missing
 * integration. Exported for testing; callers should use checkRequiredIntegration.
 */
export function generateBlockDecision(params: {
  toolName: string;
  integrationId: string;
  runId: string;
  currentBlockSequence: number;
}): Omit<Extract<IntegrationBlockDecision, { shouldBlock: true }>, 'card'> & {
  card: Omit<IntegrationCardContent, 'actionUrl' | 'resumeToken' | 'schemaVersion'>;
} {
  const { toolName, integrationId, runId, currentBlockSequence } = params;

  const plaintext = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(plaintext).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const dedupKey = crypto
    .createHash('sha256')
    .update(`${toolName}:${runId}:${currentBlockSequence}`)
    .digest('hex');

  const integrationLabel = integrationId.charAt(0).toUpperCase() + integrationId.slice(1);

  return {
    shouldBlock: true,
    integrationId,
    integrationDedupKey: dedupKey,
    plaintext,
    tokenHash,
    expiresAt,
    card: {
      kind: 'integration_card',
      integrationId,
      blockSequence: currentBlockSequence,
      title: `Connect ${integrationLabel} to continue`,
      description: `This step requires access to ${integrationLabel}. Connect your account to let the agent continue automatically.`,
      actionLabel: `Connect ${integrationLabel}`,
      expiresAt: expiresAt.toISOString(),
      dismissed: false,
    },
  };
}
