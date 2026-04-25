import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { connectorConfigs, canonicalAccounts } from '../db/schema/index.js';
import { adapters } from '../adapters/index.js';
import { integrationConnectionService } from './integrationConnectionService.js';
import { connectorConfigService } from './connectorConfigService.js';
import { canonicalDataService } from './canonicalDataService.js';
import { metricRegistryService } from './metricRegistryService.js';
import { getProviderRateLimiter } from '../lib/rateLimiter.js';
import { ingestClientPulseSignalsForSubaccount } from './clientPulseIngestionService.js';
import { recordIncident } from './incidentIngestor.js';

// ---------------------------------------------------------------------------
// Connector Polling Service — scheduled data ingestion from external platforms
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Standalone named export consumed by connectorPollingSync job handler.
// The job handler deals in integration_connections.id (not connector_configs.id)
// and expects a { apiCallsApprox, rowsIngested, durationMs } result shape.
// Adapters will be wired here in P4+; for now returns a no-op result so the
// job infrastructure can be tested end-to-end.
// ---------------------------------------------------------------------------

export interface SyncResult {
  apiCallsApprox: number;
  rowsIngested: number;
  durationMs: number;
}

export async function syncConnector(
  _connectionId: string,
  _organisationId: string,
): Promise<SyncResult> {
  // Stub — adapters will be wired here in P4+
  return { apiCallsApprox: 0, rowsIngested: 0, durationMs: 0 };
}

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
        null, // Org-level connector — no subaccountId
        config.connectorType,
        config.organisationId,
        config.connectionId
      );
    } catch {
      await connectorConfigService.updateSyncStatus(config.id, config.organisationId, {
        lastSyncAt: new Date(),
        lastSyncStatus: 'error',
        lastSyncError: 'Failed to get decrypted connection — credentials may be expired',
      });
      await connectorConfigService.update(config.id, config.organisationId, { status: 'error' });
      recordIncident({
        source: 'connector',
        summary: `Connector connection error: ${config.connectorType}`,
        errorCode: 'connector_connection_error',
        organisationId: config.organisationId,
        fingerprintOverride: `connector:${config.connectorType}:connection_error`,
      });
      return { success: false, accountsSynced: 0, errors: [{ accountId: 'all', error: 'Connection error' }] };
    }

    const connConfig = (config.configJson ?? {}) as Record<string, unknown>;
    const errors: Array<{ accountId: string; error: string }> = [];
    // ── pollRunId contract ────────────────────────────────────────────────
    //
    // pollRunId represents a single LOGICAL sync attempt, not a transport
    // attempt. Combined with migration 0175's partial UNIQUE on
    // (org, subaccount, signal_slug, source_run_id) and onConflictDoNothing
    // on insert, this gives retry idempotency at the sync-boundary level.
    //
    // Invariants for future code paths that read / reuse this id:
    //   - A retry of the SAME logical sync (pg-boss retry, manual re-run
    //     after failure) MUST reuse the same pollRunId so conflicting rows
    //     no-op rather than double-insert.
    //   - A NEW logical sync (next scheduled cycle, or a re-ingest after
    //     the first run is complete) MUST generate a fresh pollRunId so
    //     new observations are not silently dropped by the unique index.
    //   - Partial-retry-with-additional-data within the same logical
    //     window is NOT supported by this design. If the adapter returns
    //     additional rows on retry, they are dropped. The correct response
    //     is to trigger a new sync with a new pollRunId rather than
    //     reusing this one.
    //
    // Do not thread pollRunId into derived-state writes (tier history,
    // churn assessments, health snapshots) — those have their own change-
    // detection / scheduling invariants independent of ingestion retry.
    const { randomUUID } = await import('node:crypto');
    const pollRunId = randomUUID();

    try {
      // 1. Sync accounts list
      await getProviderRateLimiter(config.connectorType).acquire(config.id);
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
        .where(and(
          eq(canonicalAccounts.connectorConfigId, config.id),
          eq(canonicalAccounts.organisationId, config.organisationId),
        ));

      let accountsSynced = 0;

      for (const dbAccount of dbAccounts) {
        try {
          await getProviderRateLimiter(config.connectorType).acquire(config.id);
          const contacts = await adapter.ingestion.fetchContacts(connection as never, dbAccount.externalId);
          for (const c of contacts) {
            await canonicalDataService.upsertContact(config.organisationId, dbAccount.id, c as never);
          }

          await getProviderRateLimiter(config.connectorType).acquire(config.id);
          const opportunities = await adapter.ingestion.fetchOpportunities(connection as never, dbAccount.externalId);
          for (const o of opportunities) {
            await canonicalDataService.upsertOpportunity(config.organisationId, dbAccount.id, o as never);
          }

          await getProviderRateLimiter(config.connectorType).acquire(config.id);
          const conversations = await adapter.ingestion.fetchConversations(connection as never, dbAccount.externalId);
          for (const c of conversations) {
            await canonicalDataService.upsertConversation(config.organisationId, dbAccount.id, c as never);
          }

          await getProviderRateLimiter(config.connectorType).acquire(config.id);
          const revenue = await adapter.ingestion.fetchRevenue(connection as never, dbAccount.externalId);
          for (const r of revenue) {
            await canonicalDataService.upsertRevenue(config.organisationId, dbAccount.id, {
              ...r,
              amount: String(r.amount),
            } as never);
          }

          // 3. Compute derived metrics from raw entity counts
          if (adapter.ingestion.computeMetrics) {
            try {
              const metrics = await adapter.ingestion.computeMetrics(
                connection as never,
                dbAccount.externalId,
                {
                  contacts: contacts.length,
                  opportunities: opportunities.length,
                  conversations: conversations.length,
                  revenue: revenue.length,
                }
              );

              // Preload metric definitions once per account (avoid N+1)
              const allDefs = await metricRegistryService.getByConnectorType(config.connectorType);
              const defMap = new Map(allDefs.map(d => [d.metricSlug, d]));

              const isBackfill = config.syncPhase === 'backfill';
              for (const m of metrics) {
                // Lifecycle enforcement: only write metrics with active status
                const metricDef = defMap.get(m.metricSlug);
                if (metricDef && metricDef.status !== 'active') {
                  console.warn(`[ConnectorPolling] Skipping ${metricDef.status} metric: ${m.metricSlug}`);
                  continue;
                }
                const metricVersion = metricDef?.version ?? 1;

                await canonicalDataService.upsertMetric({
                  organisationId: config.organisationId,
                  accountId: dbAccount.id,
                  metricSlug: m.metricSlug,
                  currentValue: String(m.currentValue),
                  previousValue: m.previousValue != null ? String(m.previousValue) : null,
                  periodStart: m.periodStart ?? null,
                  periodEnd: m.periodEnd ?? null,
                  periodType: m.periodType,
                  aggregationType: m.aggregationType,
                  unit: m.unit ?? null,
                  computedAt: new Date(),
                  computationTrigger: 'poll',
                  connectorType: config.connectorType,
                  metricVersion,
                  metadata: m.metadata ?? null,
                });

                await canonicalDataService.appendMetricHistory({
                  organisationId: config.organisationId,
                  accountId: dbAccount.id,
                  metricSlug: m.metricSlug,
                  periodType: m.periodType,
                  aggregationType: m.aggregationType,
                  value: String(m.currentValue),
                  periodStart: m.periodStart ?? null,
                  periodEnd: m.periodEnd ?? null,
                  computedAt: new Date(),
                  metricVersion,
                  isBackfill,
                });
              }
            } catch (metricErr) {
              // Metric computation failure should not fail the sync
              console.error(`[ConnectorPolling] Metric computation failed for ${dbAccount.externalId}:`,
                metricErr instanceof Error ? metricErr.message : String(metricErr));
            }
          }

          // ClientPulse signal ingestion — §2, §4.3. Writes one row per signal
          // into client_pulse_signal_observations (ship-gate Phase 1). GHL-only
          // for now; a second CRM would need its own fetchers in a parallel path.
          if (config.connectorType === 'ghl' && dbAccount.subaccountId) {
            try {
              await ingestClientPulseSignalsForSubaccount({
                organisationId: config.organisationId,
                subaccountId: dbAccount.subaccountId,
                connectorType: 'ghl',
                connection: connection as never,
                accountExternalId: dbAccount.externalId,
                connectorConfigId: config.id,
                sourceRunId: pollRunId,
                contactCount: contacts.length,
                opportunityCount: opportunities.length,
                conversationCount: conversations.length,
              });
            } catch (cpErr) {
              // ClientPulse ingestion failure should not fail the poll cycle.
              console.error(`[ConnectorPolling] ClientPulse ingestion failed for ${dbAccount.externalId}:`,
                cpErr instanceof Error ? cpErr.message : String(cpErr));
            }
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
      await connectorConfigService.updateSyncStatus(config.id, config.organisationId, {
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
      await connectorConfigService.updateSyncStatus(config.id, config.organisationId, {
        lastSyncAt: new Date(),
        lastSyncStatus: 'error',
        lastSyncError: msg,
      });
      recordIncident({
        source: 'connector',
        summary: `Connector sync failed: ${config.connectorType} — ${msg.slice(0, 200)}`,
        errorCode: 'connector_sync_failed',
        stack: err instanceof Error ? err.stack : undefined,
        organisationId: config.organisationId,
        fingerprintOverride: `connector:${config.connectorType}:sync_failed`,
      });
      return { success: false, accountsSynced: 0, errors: [{ accountId: 'all', error: msg }] };
    }
  },
};
