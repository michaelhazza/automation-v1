/**
 * integrationBlockService — determines whether a tool call requires a missing
 * integration and generates the block-state payload when it does.
 *
 * E-D3: reads ACTION_REGISTRY.requiredIntegration and queries integration_connections
 *   to return shouldBlock: true when the required integration is not connected.
 */

import crypto from 'crypto';
import { logger } from '../lib/logger.js';
import type { IntegrationCardContent } from '../../shared/types/integrationCardContent.js';
import { getActionDefinition } from '../config/actionRegistry.js';
import { integrationConnectionService } from './integrationConnectionService.js';

// Closed list of known OAuth provider slugs. Any value outside this set is a
// misconfigured registry entry — log and fail-open rather than silently blocking.
const VALID_INTEGRATION_PROVIDERS = ['google_drive', 'gmail', 'slack', 'notion', 'ghl'] as const;

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
  // TODO(E-D4): if the action's strategy is 'unsafe', throw TOOL_NOT_RESUMABLE
  // before evaluating the integration requirement — allows hard-blocking tools
  // that must never execute mid-run regardless of connection state.
  const action = getActionDefinition(toolName);
  if (!action?.requiredIntegration) {
    logger.debug('integration_block_check.no_requirement', { toolName, runId: ctx.runId });
    return { shouldBlock: false };
  }

  const provider = action.requiredIntegration;

  if (!VALID_INTEGRATION_PROVIDERS.includes(provider as typeof VALID_INTEGRATION_PROVIDERS[number])) {
    logger.error('integration_block_check.invalid_provider', { toolName, provider, runId: ctx.runId });
    return { shouldBlock: false }; // fail-open — bad registry slug must not break runs
  }

  const conn = await integrationConnectionService.findActiveConnection({
    organisationId: ctx.organisationId,
    subaccountId: ctx.subaccountId,
    providerType: provider,
  });

  if (conn) {
    logger.debug('integration_block_check.connected', { toolName, provider, runId: ctx.runId });
    return { shouldBlock: false };
  }

  logger.info('integration_block_check.blocking', { toolName, provider, runId: ctx.runId });
  logger.info('metric.integration_blocked', { provider: String(provider) });

  return generateBlockDecision({
    toolName,
    integrationId: provider,
    runId: ctx.runId,
    currentBlockSequence: ctx.currentBlockSequence,
  });
}

/**
 * Thrown (not returned) when a tool cannot be safely paused mid-execution
 * because its idempotencyStrategy is 'unsafe'.
 *
 * Callers catch this error code and cancel the run with cancelReason:
 * 'tool_not_resumable'.
 */
export interface ToolNotResumableError {
  statusCode: 409;
  message: string;
  errorCode: 'TOOL_NOT_RESUMABLE';
  toolName: string;
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
