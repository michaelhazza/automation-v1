/**
 * sptVaultService
 *
 * Thin facade over connectionTokenService for Stripe SPT (Shared Payment Token)
 * lifecycle management. All SPT reads and revocations flow through this service.
 *
 * Reads `integration_connections` rows where providerType = 'stripe_agent'
 * scoped to a (subaccountId, orgId) tuple. No new persistence — SPT lives in
 * the existing integration_connections.accessToken (AES-256-GCM encrypted).
 *
 * Webhook secret (used by Chunk 12's webhook ingestion route) is stored at
 * integration_connections.configJson.webhookSecret. Chunk 16's SPT onboarding
 * flow populates this field at OAuth completion.
 *
 * Kill-switch semantics (plan §1, invariant 7 / spec §15):
 *   - Per-sub-account: revokeSubaccountConnection sets connectionStatus='revoked'
 *     and nulls both tokens for all stripe_agent connections in the sub-account.
 *   - Callers (chargeRouterService) double-check connectionStatus at execute-time
 *     to honour late-firing kill switch (invariant 7).
 */

import { and, eq } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { integrationConnections } from '../db/schema/index.js';
import { connectionTokenService } from './connectionTokenService.js';
import { integrationConnectionService } from './integrationConnectionService.js';

const PROVIDER_TYPE = 'stripe_agent' as const;

export interface ActiveSpt {
  token: string;
  expiresAt: Date | null;
  connectionId: string;
}

export const sptVaultService = {
  /**
   * Get the active SPT for a (subaccountId, orgId) pair.
   *
   * Reads the stripe_agent integration_connections row for the sub-account,
   * then calls connectionTokenService.getAccessToken which auto-refreshes if
   * the token is within the per-provider refresh buffer window (10 min for
   * stripe_agent — see connectionTokenServicePure.getRefreshBufferMs).
   *
   * Throws:
   *   { statusCode: 404, code: 'spt_unavailable' } — no active connection
   *   { statusCode: 403, code: 'spt_revoked' }     — connection is revoked
   */
  async getActiveSpt(subaccountId: string, orgId: string): Promise<ActiveSpt> {
    const [conn] = await getOrgScopedDb('sptVaultService.getActiveSpt')
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.organisationId, orgId),
        eq(integrationConnections.subaccountId, subaccountId),
        eq(integrationConnections.providerType, PROVIDER_TYPE),
      ))
      .limit(1);

    if (!conn) {
      throw Object.assign(
        new Error(`No stripe_agent connection for subaccount ${subaccountId}`),
        { statusCode: 404, code: 'spt_unavailable' },
      );
    }

    if (conn.connectionStatus === 'revoked') {
      throw Object.assign(
        new Error(`stripe_agent connection ${conn.id} is revoked`),
        { statusCode: 403, code: 'spt_revoked' },
      );
    }

    const token = await connectionTokenService.getAccessToken(conn);

    return {
      token,
      expiresAt: conn.tokenExpiresAt ?? null,
      connectionId: conn.id,
    };
  },

  /**
   * Revoke the stripe_agent connection for a sub-account.
   * Delegates to integrationConnectionService.revokeSubaccountConnection.
   * Idempotent — already-revoked connections return { alreadyRevoked: true }.
   */
  async revokeSubaccountConnection(
    subaccountId: string,
    orgId: string,
  ): Promise<{ alreadyRevoked: boolean }> {
    return integrationConnectionService.revokeSubaccountConnection(
      subaccountId,
      orgId,
      PROVIDER_TYPE,
    );
  },

  /**
   * Refresh the SPT if it is within the refresh buffer window.
   * Delegates to connectionTokenService.refreshIfExpired.
   *
   * @param connectionId - the integration_connections.id for the stripe_agent row
   * @param options      - optional tenant scope for the DB lookup
   */
  async refreshIfExpired(
    connectionId: string,
    options: { orgId: string },
  ): Promise<void> {
    const [conn] = await getOrgScopedDb('sptVaultService.refreshIfExpired')
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.id, connectionId),
        eq(integrationConnections.organisationId, options.orgId),
        eq(integrationConnections.providerType, PROVIDER_TYPE),
      ))
      .limit(1);

    if (!conn) {
      throw Object.assign(
        new Error(`stripe_agent connection ${connectionId} not found`),
        { statusCode: 404, code: 'spt_unavailable' },
      );
    }

    await connectionTokenService.refreshIfExpired(conn);
  },
};
