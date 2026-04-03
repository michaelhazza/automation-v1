import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { connectorConfigs, canonicalAccounts } from '../db/schema/index.js';
import { adapters } from '../adapters/index.js';
import { integrationConnectionService } from './integrationConnectionService.js';
import { connectorConfigService } from './connectorConfigService.js';
import { canonicalDataService } from './canonicalDataService.js';
import { ghlRateLimiter } from '../lib/rateLimiter.js';

// ---------------------------------------------------------------------------
// Connector Polling Service — scheduled data ingestion from external platforms
// ---------------------------------------------------------------------------

export const connectorPollingService = {
  /**
   * Execute a full sync for a connector config.
   * Called by the pg-boss polling job or manually via API.
   */
  async syncConnector(connectorConfigId: string): Promise<{
    success: boolean;
    accountsSynced: number;
    errors: Array<{ accountId: string; error: string }>;
  }> {
    const [config] = await db
      .select()
      .from(connectorConfigs)
      .where(eq(connectorConfigs.id, connectorConfigId));

    if (!config) throw new Error(`Connector config ${connectorConfigId} not found`);

    const adapter = adapters[config.connectorType];
    if (!adapter?.ingestion) {
      throw new Error(`Adapter ${config.connectorType} does not support ingestion`);
    }

    if (!config.connectionId) {
      throw new Error('Connector config has no connection linked');
    }

    // Get decrypted connection
    let connection;
    try {
      connection = await integrationConnectionService.getDecryptedConnection(
        // For org-level connectors, we use the connection directly by ID
        null as unknown as string, // subaccountId not used for direct lookup
        config.connectorType,
        config.organisationId,
        config.connectionId
      );
    } catch {
      await connectorConfigService.updateSyncStatus(config.id, {
        lastSyncAt: new Date(),
        lastSyncStatus: 'error',
        lastSyncError: 'Failed to get decrypted connection — credentials may be expired',
      });
      await connectorConfigService.update(config.id, config.organisationId, { status: 'error' });
      return { success: false, accountsSynced: 0, errors: [{ accountId: 'all', error: 'Connection error' }] };
    }

    const connConfig = (config.configJson ?? {}) as Record<string, unknown>;
    const errors: Array<{ accountId: string; error: string }> = [];

    try {
      // 1. Sync accounts list
      await ghlRateLimiter.acquire(config.id);
      const accounts = await adapter.ingestion.listAccounts(connection as never, connConfig);

      for (const account of accounts) {
        await canonicalDataService.upsertAccount(config.organisationId, config.id, {
          externalId: account.externalId,
          displayName: account.displayName,
          status: account.status,
          externalMetadata: account.externalMetadata,
        });
      }

      // 2. For each account, sync entities
      const dbAccounts = await db
        .select()
        .from(canonicalAccounts)
        .where(and(eq(canonicalAccounts.connectorConfigId, config.id)));

      let accountsSynced = 0;

      for (const dbAccount of dbAccounts) {
        try {
          await ghlRateLimiter.acquire(config.id);
          const contacts = await adapter.ingestion.fetchContacts(connection as never, dbAccount.externalId);
          for (const c of contacts) {
            await canonicalDataService.upsertContact(config.organisationId, dbAccount.id, c as never);
          }

          await ghlRateLimiter.acquire(config.id);
          const opportunities = await adapter.ingestion.fetchOpportunities(connection as never, dbAccount.externalId);
          for (const o of opportunities) {
            await canonicalDataService.upsertOpportunity(config.organisationId, dbAccount.id, o as never);
          }

          await ghlRateLimiter.acquire(config.id);
          const conversations = await adapter.ingestion.fetchConversations(connection as never, dbAccount.externalId);
          for (const c of conversations) {
            await canonicalDataService.upsertConversation(config.organisationId, dbAccount.id, c as never);
          }

          await ghlRateLimiter.acquire(config.id);
          const revenue = await adapter.ingestion.fetchRevenue(connection as never, dbAccount.externalId);
          for (const r of revenue) {
            await canonicalDataService.upsertRevenue(config.organisationId, dbAccount.id, {
              ...r,
              amount: String(r.amount),
            } as never);
          }

          accountsSynced++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ accountId: dbAccount.externalId, error: msg });
          console.error(`[ConnectorPolling] Error syncing account ${dbAccount.externalId}:`, msg);
        }
      }

      // Update sync status
      const syncStatus = errors.length === 0 ? 'success' : (accountsSynced > 0 ? 'partial' : 'error');
      await connectorConfigService.updateSyncStatus(config.id, {
        lastSyncAt: new Date(),
        lastSyncStatus: syncStatus,
        lastSyncError: errors.length > 0 ? JSON.stringify(errors.slice(0, 5)) : null,
      });

      // Transition sync phase if in backfill and first successful sync
      if (config.syncPhase === 'backfill' && syncStatus !== 'error') {
        await connectorConfigService.update(config.id, config.organisationId, { syncPhase: 'live' });
      }

      return { success: errors.length === 0, accountsSynced, errors };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await connectorConfigService.updateSyncStatus(config.id, {
        lastSyncAt: new Date(),
        lastSyncStatus: 'error',
        lastSyncError: msg,
      });
      return { success: false, accountsSynced: 0, errors: [{ accountId: 'all', error: msg }] };
    }
  },
};
