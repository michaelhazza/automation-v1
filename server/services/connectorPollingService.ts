import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { withOrgTx } from '../instrumentation.js';
import {
  connectorConfigs,
  canonicalAccounts,
  canonicalInboxes,
  canonicalSupportAgents,
  canonicalTickets,
  canonicalTicketMessages,
  canonicalContacts,
} from '../db/schema/index.js';
import { createEvent } from '../lib/tracing.js';
import { adapters } from '../adapters/index.js';
import { integrationConnectionService } from './integrationConnectionService.js';
import { connectorConfigService } from './connectorConfigService.js';
import { canonicalDataService } from './canonicalDataService.js';
import { fromOrgId } from './principal/fromOrgId.js';
import { metricRegistryService } from './metricRegistryService.js';
import { getProviderRateLimiter } from '../lib/rateLimiter.js';
import { ingestClientPulseSignalsForSubaccount } from './clientPulseIngestionService.js';
import { recordIncident } from './incidentIngestor.js';
import { resolveByEmail } from './supportContactResolutionPure.js';
import { SUPPORT_LOG_CODES } from '../../shared/types/supportObservability.js';
import type {
  CanonicalInboxData,
  CanonicalSupportAgentData,
  CanonicalTicketData,
  CanonicalTicketMessageData,
  FetchSupportResult,
} from '../adapters/integrationAdapter.js';

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
    // guard-ignore: with-org-tx-or-scoped-db reason="bootstrap read by connectorConfigId before organisationId is known; org scope enforced on all subsequent writes via config.organisationId"
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

      const orgPrincipal = fromOrgId(config.organisationId);
      for (const account of accounts) {
        await canonicalDataService.upsertAccount(orgPrincipal, config.id, {
          externalId: account.externalId,
          displayName: account.displayName,
          status: account.status,
          externalMetadata: account.externalMetadata,
        });
      }

      // 2. For each account, sync entities
      const accountsDb = getOrgScopedDb('connectorPollingService.syncConnector.fetchAccounts');
      const dbAccounts = await accountsDb
        .select()
        .from(canonicalAccounts)
        .where(and(
          eq(canonicalAccounts.connectorConfigId, config.id),
          eq(canonicalAccounts.organisationId, config.organisationId),
        ));

      let accountsSynced = 0;

      for (const dbAccount of dbAccounts) {
        // Per-account principal — carries the subaccountId so downstream
        // canonicalDataService methods that need it (none in this loop today,
        // but the surface contract requires the principal regardless) get the
        // tenant-scoped context they expect.
        const accountPrincipal = fromOrgId(config.organisationId, dbAccount.subaccountId ?? undefined);
        try {
          await getProviderRateLimiter(config.connectorType).acquire(config.id);
          const contacts = await adapter.ingestion.fetchContacts(connection as never, dbAccount.externalId);
          for (const c of contacts) {
            await canonicalDataService.upsertContact(accountPrincipal, dbAccount.id, c as never);
          }

          await getProviderRateLimiter(config.connectorType).acquire(config.id);
          const opportunities = await adapter.ingestion.fetchOpportunities(connection as never, dbAccount.externalId);
          for (const o of opportunities) {
            await canonicalDataService.upsertOpportunity(accountPrincipal, dbAccount.id, o as never);
          }

          await getProviderRateLimiter(config.connectorType).acquire(config.id);
          const conversations = await adapter.ingestion.fetchConversations(connection as never, dbAccount.externalId);
          for (const c of conversations) {
            await canonicalDataService.upsertConversation(accountPrincipal, dbAccount.id, c as never);
          }

          await getProviderRateLimiter(config.connectorType).acquire(config.id);
          const revenue = await adapter.ingestion.fetchRevenue(connection as never, dbAccount.externalId);
          for (const r of revenue) {
            await canonicalDataService.upsertRevenue(accountPrincipal, dbAccount.id, {
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

                await canonicalDataService.upsertMetric(accountPrincipal, {
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

                await canonicalDataService.appendMetricHistory(accountPrincipal, {
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

      // F3 §4 — bump poll counter and stamp first qualifying poll.
      if (syncStatus === 'success') {
        const orgDb = getOrgScopedDb('connectorPollingService.bumpPollMetrics');
        await orgDb.execute(sql`
          UPDATE connector_configs
          SET successful_poll_count_total = successful_poll_count_total + 1,
              first_qualifying_poll_at = COALESCE(first_qualifying_poll_at, now())
          WHERE id = ${config.id}
            AND organisation_id = ${config.organisationId}
        `);

        createEvent('connector.sync.complete', {
          organisation_id: config.organisationId,
          subaccount_id: config.subaccountId,
          connector_config_id: config.id,
          connector_type: config.connectorType,
        });

        if (config.subaccountId) {
          const { baselineSubscriberService } = await import('./baselineSubscriberService.js');
          await baselineSubscriberService
            .onSyncCompleteEvaluateReadiness(config.subaccountId, config.organisationId);
        }
      }

      // ── Support Desk ingestion — Phases A→D ─────────────────────────────
      // Only executed when the adapter provides support-specific methods.
      // Additive — does not affect the existing CRM sync above.
      if (
        adapter.ingestion.listInboxes &&
        adapter.ingestion.listSupportAgents &&
        adapter.ingestion.fetchTickets &&
        adapter.ingestion.fetchTicketMessages
      ) {
        try {
          await runSupportIngestionCycle(
            config.id,
            config.organisationId,
            connection as never,
            adapter.ingestion as Required<NonNullable<typeof adapter.ingestion>>,
            (config.configJson ?? {}) as Record<string, unknown>,
          );
        } catch (supportErr) {
          // Support ingestion failure should not fail the main CRM sync result.
          console.error(
            `[ConnectorPolling] Support ingestion failed for ${config.id}:`,
            supportErr instanceof Error ? supportErr.message : String(supportErr),
          );
        }
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

// ---------------------------------------------------------------------------
// Support Desk ingestion — internal helpers + full-reconciliation export
// ---------------------------------------------------------------------------

/**
 * Abbreviated adapter shape used by the support ingestion helpers so we don't
 * carry the full IntegrationAdapter type and its many optional fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConnection = any;

interface SupportIngestionAdapter {
  listInboxes(connection: AnyConnection): Promise<CanonicalInboxData[]>;
  listSupportAgents(connection: AnyConnection): Promise<CanonicalSupportAgentData[]>;
  fetchTickets(
    connection: AnyConnection,
    inboxExternalId: string,
    opts?: { since?: Date },
  ): Promise<FetchSupportResult<CanonicalTicketData>>;
  fetchTicketMessages(
    connection: AnyConnection,
    ticketExternalId: string,
    opts?: { since?: Date },
  ): Promise<FetchSupportResult<CanonicalTicketMessageData>>;
}

// ---------------------------------------------------------------------------
// Phase A — listInboxes upsert
// ---------------------------------------------------------------------------

async function phaseA_upsertInboxes(
  orgId: string,
  connectorConfigId: string,
  inboxes: CanonicalInboxData[],
): Promise<Map<string, string>> {
  // Returns externalId → canonical id map for use by Phase C.
  const externalToId = new Map<string, string>();

  await withOrgTx(
    { tx: db, organisationId: orgId, source: 'connectorPollingService.phaseA' },
    async () => {
      const orgDb = getOrgScopedDb('connectorPollingService.phaseA_upsertInboxes');
      for (const inbox of inboxes) {
        const inserted = await orgDb
          .insert(canonicalInboxes)
          .values({
            organisationId: orgId,
            connectorConfigId,
            externalId: inbox.externalId,
            name: inbox.name,
            emailAddress: inbox.emailAddress ?? null,
            isActive: inbox.isActive,
            externalMetadata: inbox.externalMetadata ?? null,
            lastSyncedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [canonicalInboxes.connectorConfigId, canonicalInboxes.externalId],
            set: {
              name: inbox.name,
              emailAddress: inbox.emailAddress ?? null,
              isActive: inbox.isActive,
              externalMetadata: inbox.externalMetadata ?? null,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning({ id: canonicalInboxes.id, externalId: canonicalInboxes.externalId });

        if (inserted[0]) {
          externalToId.set(inserted[0].externalId, inserted[0].id);
        }
      }
    },
  );

  return externalToId;
}

// ---------------------------------------------------------------------------
// Phase B — listSupportAgents upsert
// ---------------------------------------------------------------------------

async function phaseB_upsertSupportAgents(
  orgId: string,
  connectorConfigId: string,
  agents: CanonicalSupportAgentData[],
): Promise<Map<string, string>> {
  // Returns externalId → canonical id map for use by Phase C (assignee resolution).
  const externalToId = new Map<string, string>();

  await withOrgTx(
    { tx: db, organisationId: orgId, source: 'connectorPollingService.phaseB' },
    async () => {
      const orgDb = getOrgScopedDb('connectorPollingService.phaseB_upsertSupportAgents');
      for (const agent of agents) {
        const inserted = await orgDb
          .insert(canonicalSupportAgents)
          .values({
            organisationId: orgId,
            connectorConfigId,
            externalId: agent.externalId,
            displayName: agent.displayName,
            email: agent.email ?? null,
            agentKind: agent.agentKind,
            isActive: agent.isActive,
            externalMetadata: agent.externalMetadata ?? null,
            lastSyncedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [canonicalSupportAgents.connectorConfigId, canonicalSupportAgents.externalId],
            set: {
              displayName: agent.displayName,
              email: agent.email ?? null,
              agentKind: agent.agentKind,
              isActive: agent.isActive,
              externalMetadata: agent.externalMetadata ?? null,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning({ id: canonicalSupportAgents.id, externalId: canonicalSupportAgents.externalId });

        if (inserted[0]) {
          externalToId.set(inserted[0].externalId, inserted[0].id);
        }
      }
    },
  );

  return externalToId;
}

// ---------------------------------------------------------------------------
// Phase C — fetchTickets per active inbox
// ---------------------------------------------------------------------------

async function phaseC_upsertTickets(
  orgId: string,
  connectorConfigId: string,
  connection: AnyConnection,
  adapter: SupportIngestionAdapter,
  inboxExternalToId: Map<string, string>,
  agentExternalToId: Map<string, string>,
  since: Date | undefined,
): Promise<string[]> {
  // Returns list of ticket externalIds touched (for Phase D).
  const touchedExternalIds: string[] = [];

  // Load org contacts once — used for email-based customer identity resolution.
  let orgContacts: Array<{ id: string; email: string }> = [];
  await withOrgTx(
    { tx: db, organisationId: orgId, source: 'connectorPollingService.phaseC_loadContacts' },
    async () => {
      const orgDb = getOrgScopedDb('connectorPollingService.phaseC_loadContacts');
      const rows = await orgDb
        .select({ id: canonicalContacts.id, email: canonicalContacts.email })
        .from(canonicalContacts)
        .where(
          and(
            eq(canonicalContacts.organisationId, orgId),
          ),
        );
      orgContacts = rows
        .filter((r): r is { id: string; email: string } => r.email !== null)
        .map((r) => ({ id: r.id, email: r.email as string }));
    },
  );

  // Iterate active inboxes.
  for (const [inboxExternalId, inboxId] of inboxExternalToId) {
    let fetchResult: FetchSupportResult<CanonicalTicketData>;
    try {
      fetchResult = await adapter.fetchTickets(connection, inboxExternalId, { since });
    } catch (err) {
      console.warn(
        `[ConnectorPolling] ${SUPPORT_LOG_CODES.PROVIDER_POLL_PAGE_FAILED}`,
        JSON.stringify({ code: SUPPORT_LOG_CODES.PROVIDER_POLL_PAGE_FAILED, connectorConfigId, inboxExternalId, error: err instanceof Error ? err.message : String(err) }),
      );
      continue;
    }

    if (fetchResult.rateLimited) {
      console.warn(
        `[ConnectorPolling] ${SUPPORT_LOG_CODES.PROVIDER_RATE_LIMITED}`,
        JSON.stringify({ code: SUPPORT_LOG_CODES.PROVIDER_RATE_LIMITED, connectorConfigId, inboxExternalId }),
      );
    }

    if (fetchResult.partial && fetchResult.error) {
      console.warn(
        `[ConnectorPolling] ${SUPPORT_LOG_CODES.PROVIDER_POLL_PAGE_FAILED}`,
        JSON.stringify({ code: SUPPORT_LOG_CODES.PROVIDER_POLL_PAGE_FAILED, connectorConfigId, inboxExternalId, error: fetchResult.error.message }),
      );
    }

    for (const ticket of fetchResult.rows) {
      await withOrgTx(
        { tx: db, organisationId: orgId, source: 'connectorPollingService.phaseC_upsertTicket' },
        async () => {
          const orgDb = getOrgScopedDb('connectorPollingService.phaseC_upsertTicket');

          // Status mapping — unknown provider statuses are quarantined.
          const status = ticket.status;
          const externalMetadata: Record<string, unknown> = { ...(ticket.externalMetadata ?? {}) };
          if (status === 'unknown_provider_status') {
            externalMetadata['provider_status_raw'] = (ticket.externalMetadata?.['provider_status_raw']) ?? status;
            console.warn(
              `[ConnectorPolling] ${SUPPORT_LOG_CODES.STATUS_UNKNOWN_PROVIDER_STATUS}`,
              JSON.stringify({ code: SUPPORT_LOG_CODES.STATUS_UNKNOWN_PROVIDER_STATUS, connectorConfigId, ticketExternalId: ticket.externalId }),
            );
          }

          // Customer identity resolution.
          const contactResolution = resolveByEmail(ticket.customerEmail, orgContacts);
          if (contactResolution.emailMatchCount === 0 || contactResolution.emailMatchCount === 'multiple') {
            console.info(
              `[ConnectorPolling] ${SUPPORT_LOG_CODES.INGEST_CONTACT_UNMATCHED}`,
              JSON.stringify({
                code: SUPPORT_LOG_CODES.INGEST_CONTACT_UNMATCHED,
                connectorConfigId,
                ticketExternalId: ticket.externalId,
                emailMatchCount: contactResolution.emailMatchCount,
              }),
            );
          }

          // Assignee resolution (externalId → canonical UUID).
          const assigneeAgentId = ticket.assigneeAgentExternalId
            ? (agentExternalToId.get(ticket.assigneeAgentExternalId) ?? null)
            : null;

          const upsertValues = {
            organisationId: orgId,
            connectorConfigId,
            externalId: ticket.externalId,
            inboxId,
            customerEmail: ticket.customerEmail ?? null,
            customerName: ticket.customerName ?? null,
            customerExternalId: ticket.customerExternalId ?? null,
            canonicalContactId: contactResolution.canonicalContactId ?? null,
            status,
            priority: ticket.priority,
            subject: ticket.subject,
            tags: ticket.tags ?? [],
            category: ticket.category ?? null,
            sourceChannel: ticket.sourceChannel,
            openedAt: ticket.openedAt,
            firstResponseAt: ticket.firstResponseAt ?? null,
            lastCustomerMessageAt: ticket.lastCustomerMessageAt ?? null,
            lastAgentMessageAt: ticket.lastAgentMessageAt ?? null,
            closedAt: ticket.closedAt ?? null,
            resolutionAt: ticket.resolutionAt ?? null,
            slaDueAt: ticket.slaDueAt ?? null,
            slaBreached: ticket.slaBreached ?? false,
            slaPolicyExternalId: ticket.slaPolicyExternalId ?? null,
            assigneeAgentId,
            externalMetadata,
            lastSyncedAt: new Date(),
          };

          const result = await orgDb
            .insert(canonicalTickets)
            .values(upsertValues)
            .onConflictDoUpdate({
              target: [canonicalTickets.connectorConfigId, canonicalTickets.externalId],
              set: {
                inboxId,
                customerEmail: upsertValues.customerEmail,
                customerName: upsertValues.customerName,
                customerExternalId: upsertValues.customerExternalId,
                canonicalContactId: upsertValues.canonicalContactId,
                status: upsertValues.status,
                priority: upsertValues.priority,
                subject: upsertValues.subject,
                tags: upsertValues.tags,
                category: upsertValues.category,
                sourceChannel: upsertValues.sourceChannel,
                openedAt: upsertValues.openedAt,
                firstResponseAt: upsertValues.firstResponseAt,
                lastCustomerMessageAt: upsertValues.lastCustomerMessageAt,
                lastAgentMessageAt: upsertValues.lastAgentMessageAt,
                closedAt: upsertValues.closedAt,
                resolutionAt: upsertValues.resolutionAt,
                slaDueAt: upsertValues.slaDueAt,
                slaBreached: upsertValues.slaBreached,
                slaPolicyExternalId: upsertValues.slaPolicyExternalId,
                assigneeAgentId: upsertValues.assigneeAgentId,
                externalMetadata: upsertValues.externalMetadata,
                lastSyncedAt: upsertValues.lastSyncedAt,
                updatedAt: new Date(),
              },
            })
            .returning({ id: canonicalTickets.id, externalId: canonicalTickets.externalId });

          if (result.length === 0) {
            // onConflictDoUpdate always returns rows — this branch is a safety net.
            console.info(
              `[ConnectorPolling] ${SUPPORT_LOG_CODES.INGEST_DUPLICATE_COLLAPSED}`,
              JSON.stringify({ code: SUPPORT_LOG_CODES.INGEST_DUPLICATE_COLLAPSED, connectorConfigId, ticketExternalId: ticket.externalId }),
            );
          }
        },
      );

      touchedExternalIds.push(ticket.externalId);
    }
  }

  return touchedExternalIds;
}

// ---------------------------------------------------------------------------
// Phase D — fetchTicketMessages per ticket touched in Phase C
// ---------------------------------------------------------------------------

async function phaseD_upsertTicketMessages(
  orgId: string,
  connectorConfigId: string,
  connection: AnyConnection,
  adapter: SupportIngestionAdapter,
  touchedTicketExternalIds: string[],
  agentExternalToId: Map<string, string>,
): Promise<void> {
  if (touchedTicketExternalIds.length === 0) return;

  // Load ticket id map (externalId → canonical id + canonical ticket id) for FK resolution.
  const ticketMap: Map<string, { id: string }> = new Map();
  await withOrgTx(
    { tx: db, organisationId: orgId, source: 'connectorPollingService.phaseD_loadTickets' },
    async () => {
      const orgDb = getOrgScopedDb('connectorPollingService.phaseD_loadTickets');
      const rows = await orgDb
        .select({ id: canonicalTickets.id, externalId: canonicalTickets.externalId })
        .from(canonicalTickets)
        .where(
          and(
            eq(canonicalTickets.connectorConfigId, connectorConfigId),
            eq(canonicalTickets.organisationId, orgId),
            inArray(canonicalTickets.externalId, touchedTicketExternalIds),
          ),
        );
      for (const row of rows) {
        ticketMap.set(row.externalId, { id: row.id });
      }
    },
  );

  for (const ticketExternalId of touchedTicketExternalIds) {
    const ticketRow = ticketMap.get(ticketExternalId);
    if (!ticketRow) continue;

    let messagesResult: FetchSupportResult<CanonicalTicketMessageData>;
    try {
      messagesResult = await adapter.fetchTicketMessages(connection, ticketExternalId);
    } catch (err) {
      console.warn(
        `[ConnectorPolling] ${SUPPORT_LOG_CODES.PROVIDER_POLL_PAGE_FAILED}`,
        JSON.stringify({ code: SUPPORT_LOG_CODES.PROVIDER_POLL_PAGE_FAILED, connectorConfigId, ticketExternalId, phase: 'D', error: err instanceof Error ? err.message : String(err) }),
      );
      continue;
    }

    if (messagesResult.rateLimited) {
      console.warn(
        `[ConnectorPolling] ${SUPPORT_LOG_CODES.PROVIDER_RATE_LIMITED}`,
        JSON.stringify({ code: SUPPORT_LOG_CODES.PROVIDER_RATE_LIMITED, connectorConfigId, ticketExternalId, phase: 'D' }),
      );
    }

    if (messagesResult.rows.length === 0) continue;

    await withOrgTx(
      { tx: db, organisationId: orgId, source: 'connectorPollingService.phaseD_upsertMessages' },
      async () => {
        const orgDb = getOrgScopedDb('connectorPollingService.phaseD_upsertMessages');
        for (const msg of messagesResult.rows) {
          // Resolve author FK per polymorphic-FK CHECK constraint on
          // canonical_ticket_messages (migration 0310): agent/bot messages MUST
          // carry author_support_agent_id; customer/system messages must NOT.
          let authorSupportAgentId: string | null = null;
          if (msg.authorType === 'agent' || msg.authorType === 'bot') {
            const externalId = msg.authorExternalId;
            const resolved = externalId ? agentExternalToId.get(externalId) : undefined;
            if (!resolved) {
              console.warn(
                `[ConnectorPolling] ${SUPPORT_LOG_CODES.INGEST_CONTRACT_VIOLATION}`,
                JSON.stringify({
                  code: SUPPORT_LOG_CODES.INGEST_CONTRACT_VIOLATION,
                  connectorConfigId,
                  ticketExternalId,
                  messageExternalId: msg.externalId,
                  authorType: msg.authorType,
                  reason: externalId ? 'unknown_agent_external_id' : 'missing_author_external_id',
                }),
              );
              continue;
            }
            authorSupportAgentId = resolved;
          }

          await orgDb
            .insert(canonicalTicketMessages)
            .values({
              organisationId: orgId,
              connectorConfigId,
              ticketId: ticketRow.id,
              ticketExternalId,
              externalId: msg.externalId,
              direction: msg.direction,
              visibility: msg.visibility,
              authorType: msg.authorType,
              authorSupportAgentId,
              bodyText: msg.bodyText,
              bodyHtml: msg.bodyHtml ?? null,
              attachments: msg.attachments ?? null,
              createdAtExternal: msg.createdAtExternal,
              externalMetadata: msg.externalMetadata ?? null,
            })
            .onConflictDoNothing();
        }
      },
    );
  }
}

// ---------------------------------------------------------------------------
// runSupportIngestionCycle — orchestrates Phases A→D for a single connector
// ---------------------------------------------------------------------------

async function runSupportIngestionCycle(
  connectorConfigId: string,
  orgId: string,
  connection: AnyConnection,
  adapter: SupportIngestionAdapter,
  configJson: Record<string, unknown>,
): Promise<void> {
  // Determine incremental cursor from configJson (same pattern used by other
  // polling paths in this service).
  const since = configJson['supportLastSyncCursor']
    ? new Date(configJson['supportLastSyncCursor'] as string)
    : undefined;

  // Phase A — inboxes
  const rawInboxes = await adapter.listInboxes(connection);
  const inboxExternalToId = await phaseA_upsertInboxes(orgId, connectorConfigId, rawInboxes);

  // Phase B — support agents
  const rawAgents = await adapter.listSupportAgents(connection);
  const agentExternalToId = await phaseB_upsertSupportAgents(orgId, connectorConfigId, rawAgents);

  // Filter to active inboxes only (Phase C spec requirement).
  const activeInboxes = rawInboxes.filter((i) => i.isActive);
  const activeInboxExternalToId = new Map<string, string>();
  for (const inbox of activeInboxes) {
    const id = inboxExternalToId.get(inbox.externalId);
    if (id) activeInboxExternalToId.set(inbox.externalId, id);
  }

  // Phase C — tickets
  const touchedExternalIds = await phaseC_upsertTickets(
    orgId,
    connectorConfigId,
    connection,
    adapter,
    activeInboxExternalToId,
    agentExternalToId,
    since,
  );

  // Phase D — messages
  await phaseD_upsertTicketMessages(
    orgId,
    connectorConfigId,
    connection,
    adapter,
    touchedExternalIds,
    agentExternalToId,
  );

  // Advance the sync cursor to now so the next incremental cycle only fetches
  // what changed since this run completed.
  const cursorDb = getOrgScopedDb('connectorPollingService.runSupportIngestionCycle.advanceCursor');
  await cursorDb
    .update(connectorConfigs)
    .set({
      configJson: {
        ...(configJson as Record<string, unknown>),
        supportLastSyncCursor: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(and(eq(connectorConfigs.id, connectorConfigId), eq(connectorConfigs.organisationId, orgId)));
}

// ---------------------------------------------------------------------------
// pollSupportFullReconciliation — full-page scan + tombstone pass
//
// Exported standalone function. NOT called automatically by the incremental
// cycle — invoke explicitly (e.g. from a maintenance job or operator command).
// ---------------------------------------------------------------------------

export async function pollSupportFullReconciliation(connectorConfigId: string): Promise<void> {
  // guard-ignore: with-org-tx-or-scoped-db reason="bootstrap read by connectorConfigId before organisationId is known; org scope enforced on all subsequent writes via config.organisationId"
  const [config] = await db
    .select()
    .from(connectorConfigs)
    .where(eq(connectorConfigs.id, connectorConfigId));

  if (!config) throw new Error(`Connector config ${connectorConfigId} not found`);

  const adapter = adapters[config.connectorType];
  if (
    !adapter?.ingestion?.listInboxes ||
    !adapter.ingestion.listSupportAgents ||
    !adapter.ingestion.fetchTickets ||
    !adapter.ingestion.fetchTicketMessages
  ) {
    throw new Error(`Adapter ${config.connectorType} does not support support ingestion`);
  }

  if (!config.connectionId) throw new Error('Connector config has no connection linked');

  const connection = await integrationConnectionService.getDecryptedConnection(
    null,
    config.connectorType,
    config.organisationId,
    config.connectionId,
  );

  const orgId = config.organisationId;
  const supportAdapter = adapter.ingestion as SupportIngestionAdapter;

  // Phase A — inboxes (full refresh)
  const rawInboxes = await supportAdapter.listInboxes(connection as never);
  const inboxExternalToId = await phaseA_upsertInboxes(orgId, connectorConfigId, rawInboxes);

  // Phase B — agents (full refresh)
  const rawAgents = await supportAdapter.listSupportAgents(connection as never);
  const agentExternalToId = await phaseB_upsertSupportAgents(orgId, connectorConfigId, rawAgents);

  // Full-reconciliation ticket pass — fetch ALL pages (no `since` cursor).
  const activeInboxes = rawInboxes.filter((i) => i.isActive);
  const returnedExternalIds = new Set<string>();
  let anyPartial = false;
  let anyRateLimited = false;
  let anyPageFailed = false;

  for (const inbox of activeInboxes) {
    const inboxId = inboxExternalToId.get(inbox.externalId);
    if (!inboxId) continue;

    let fetchResult: FetchSupportResult<CanonicalTicketData>;
    try {
      fetchResult = await supportAdapter.fetchTickets(
        connection as never,
        inbox.externalId,
        // No `since` — full reconciliation fetches everything
      );
    } catch (err) {
      anyPageFailed = true;
      console.warn(
        `[ConnectorPolling] ${SUPPORT_LOG_CODES.PROVIDER_POLL_PAGE_FAILED}`,
        JSON.stringify({ code: SUPPORT_LOG_CODES.PROVIDER_POLL_PAGE_FAILED, connectorConfigId, inboxExternalId: inbox.externalId, phase: 'full-reconciliation', error: err instanceof Error ? err.message : String(err) }),
      );
      continue;
    }

    if (fetchResult.partial) anyPartial = true;
    if (fetchResult.rateLimited) {
      anyRateLimited = true;
      console.warn(
        `[ConnectorPolling] ${SUPPORT_LOG_CODES.PROVIDER_RATE_LIMITED}`,
        JSON.stringify({ code: SUPPORT_LOG_CODES.PROVIDER_RATE_LIMITED, connectorConfigId, inboxExternalId: inbox.externalId, phase: 'full-reconciliation' }),
      );
    }
    if (fetchResult.partial && fetchResult.error) {
      anyPageFailed = true;
    }

    // Upsert tickets and track externalIds.
    const touchedExternalIds = await phaseC_upsertTickets(
      orgId,
      connectorConfigId,
      connection as never,
      supportAdapter,
      new Map([[inbox.externalId, inboxId]]),
      agentExternalToId,
      undefined, // no cursor — full scan
    );
    for (const id of touchedExternalIds) returnedExternalIds.add(id);

    // Phase D — messages for tickets touched in this inbox's reconciliation.
    await phaseD_upsertTicketMessages(
      orgId,
      connectorConfigId,
      connection as never,
      supportAdapter,
      touchedExternalIds,
      agentExternalToId,
    );
  }

  // Tombstone pass — only when ALL preconditions hold.
  if (anyPartial || anyRateLimited || anyPageFailed) {
    console.warn(
      '[ConnectorPolling] pollSupportFullReconciliation: skipping tombstone pass — preconditions not met',
      JSON.stringify({ connectorConfigId, anyPartial, anyRateLimited, anyPageFailed }),
    );
    return;
  }

  if (returnedExternalIds.size === 0) return;

  // Find tickets in the DB that were NOT returned by the provider — candidates for deletion.
  let candidateExternalIds: string[] = [];
  await withOrgTx(
    { tx: db, organisationId: orgId, source: 'connectorPollingService.fullReconciliation_tombstone' },
    async () => {
      const orgDb = getOrgScopedDb('connectorPollingService.fullReconciliation_tombstone');
      const dbTickets = await orgDb
        .select({ externalId: canonicalTickets.externalId })
        .from(canonicalTickets)
        .where(
          and(
            eq(canonicalTickets.connectorConfigId, connectorConfigId),
            eq(canonicalTickets.organisationId, orgId),
            eq(canonicalTickets.providerDeleted, false),
          ),
        );
      candidateExternalIds = dbTickets
        .map((r) => r.externalId)
        .filter((eid) => !returnedExternalIds.has(eid));
    },
  );

  if (candidateExternalIds.length === 0) return;

  // Tombstone the candidates.
  await withOrgTx(
    { tx: db, organisationId: orgId, source: 'connectorPollingService.fullReconciliation_applyTombstone' },
    async () => {
      const orgDb = getOrgScopedDb('connectorPollingService.fullReconciliation_applyTombstone');
      await orgDb
        .update(canonicalTickets)
        .set({
          providerDeleted: true,
          deletedAtCanonical: new Date(),
          deletionSource: 'provider_poll_observation',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(canonicalTickets.connectorConfigId, connectorConfigId),
            eq(canonicalTickets.organisationId, orgId),
            inArray(canonicalTickets.externalId, candidateExternalIds),
          ),
        );
    },
  );

  console.info(
    `[ConnectorPolling] ${SUPPORT_LOG_CODES.TICKET_PROVIDER_DELETED}`,
    JSON.stringify({
      code: SUPPORT_LOG_CODES.TICKET_PROVIDER_DELETED,
      connectorConfigId,
      tombstonedCount: candidateExternalIds.length,
    }),
  );
}
