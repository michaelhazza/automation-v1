import { eq, and, gte, lte, sql, count, desc, lt, asc, avg, sum } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  canonicalAccounts,
  canonicalContacts,
  canonicalOpportunities,
  canonicalConversations,
  canonicalRevenue,
  healthSnapshots,
  anomalyEvents,
  canonicalMetrics,
  canonicalMetricHistory,
} from '../db/schema/index.js';
import type { NewCanonicalMetric, NewCanonicalMetricHistoryEntry } from '../db/schema/canonicalMetrics.js';
import type { PrincipalContext } from './principal/types.js';

// ---------------------------------------------------------------------------
// Canonical Data Service — unified read interface for normalised entities
// Agents and skills call this service, never the connector directly.
//
// A1a (2026-04-26): Every method accepts `principal: PrincipalContext` as the
// first positional parameter. The `organisationId` (and `subaccountId` where
// relevant) is derived from `principal` instead of being passed separately.
// In A1a the method bodies still use the module-top `db` directly — the
// `withPrincipalContext` wrap and gate hardening land in A1b together so the
// gate flips from file-level to call-site granularity at the same moment
// every caller is verified to run inside an active `withOrgTx` block.
// ---------------------------------------------------------------------------

/**
 * Validates the principal argument before any DB work. Throws a clear error
 * when callers pass null/undefined — the gate-hardening contract for A1b
 * relies on this guard firing BEFORE any SQL is issued.
 */
function requirePrincipal(principal: PrincipalContext, methodName: string): void {
  if (!principal || typeof principal !== 'object' || !principal.organisationId) {
    throw new Error(`canonicalDataService.${methodName}: principal is required`);
  }
}

export const canonicalDataService = {
  // ── Account queries ──────────────────────────────────────────────────────

  async getAccountsByOrg(principal: PrincipalContext) {
    requirePrincipal(principal, 'getAccountsByOrg');
    return db
      .select()
      .from(canonicalAccounts)
      .where(eq(canonicalAccounts.organisationId, principal.organisationId));
  },

  async findAccountBySubaccountId(principal: PrincipalContext, subaccountId: string) {
    requirePrincipal(principal, 'findAccountBySubaccountId');
    const result = await db
      .select()
      .from(canonicalAccounts)
      .where(and(
        eq(canonicalAccounts.organisationId, principal.organisationId),
        eq(canonicalAccounts.subaccountId, subaccountId),
      ))
      .limit(1);
    return result[0] ?? null;
  },

  async getAccountById(principal: PrincipalContext, accountId: string) {
    requirePrincipal(principal, 'getAccountById');
    const [account] = await db
      .select()
      .from(canonicalAccounts)
      .where(and(
        eq(canonicalAccounts.id, accountId),
        eq(canonicalAccounts.organisationId, principal.organisationId),
      ));
    return account ?? null;
  },

  // ── Contact metrics ──────────────────────────────────────────────────────

  async getContactMetrics(principal: PrincipalContext, accountId: string, dateRange?: { since: Date }) {
    requirePrincipal(principal, 'getContactMetrics');
    const conditions = [
      eq(canonicalContacts.accountId, accountId),
      eq(canonicalContacts.organisationId, principal.organisationId),
    ];
    if (dateRange?.since) conditions.push(gte(canonicalContacts.createdAt, dateRange.since));

    const [totalResult] = await db
      .select({ count: count() })
      .from(canonicalContacts)
      .where(and(...conditions));

    // Growth: contacts created in the last 30 days vs previous 30 days
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const recentConditions = [
      eq(canonicalContacts.accountId, accountId),
      eq(canonicalContacts.organisationId, principal.organisationId),
      gte(canonicalContacts.externalCreatedAt, thirtyDaysAgo),
    ];

    const previousConditions = [
      eq(canonicalContacts.accountId, accountId),
      eq(canonicalContacts.organisationId, principal.organisationId),
      gte(canonicalContacts.externalCreatedAt, sixtyDaysAgo),
      sql`${canonicalContacts.externalCreatedAt} < ${thirtyDaysAgo}`,
    ];

    const [recentResult] = await db
      .select({ count: count() })
      .from(canonicalContacts)
      .where(and(...recentConditions));

    const [previousResult] = await db
      .select({ count: count() })
      .from(canonicalContacts)
      .where(and(...previousConditions));

    const recent = Number(recentResult?.count ?? 0);
    const previous = Number(previousResult?.count ?? 0);
    const growthRate = previous > 0 ? ((recent - previous) / previous) * 100 : recent > 0 ? 100 : 0;

    return {
      total: Number(totalResult?.count ?? 0),
      recentCount: recent,
      previousCount: previous,
      growthRate: Math.round(growthRate * 10) / 10,
      dataStatus: 'fresh' as const,
    };
  },

  // ── Opportunity metrics ──────────────────────────────────────────────────

  async getOpportunityMetrics(principal: PrincipalContext, accountId: string) {
    requirePrincipal(principal, 'getOpportunityMetrics');
    const conditions = [
      eq(canonicalOpportunities.accountId, accountId),
      eq(canonicalOpportunities.organisationId, principal.organisationId),
    ];

    const opps = await db
      .select()
      .from(canonicalOpportunities)
      .where(and(...conditions));

    const open = opps.filter(o => o.status === 'open');
    const won = opps.filter(o => o.status === 'won');
    const lost = opps.filter(o => o.status === 'lost');

    const pipelineValue = open.reduce((sum, o) => sum + Number(o.value ?? 0), 0);
    const wonValue = won.reduce((sum, o) => sum + Number(o.value ?? 0), 0);

    // Stale deals: open deals with stageEnteredAt > 14 days ago
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const staleDeals = open.filter(o => o.stageEnteredAt && o.stageEnteredAt < fourteenDaysAgo).length;

    return {
      total: opps.length,
      open: open.length,
      won: won.length,
      lost: lost.length,
      pipelineValue,
      wonValue,
      staleDeals,
      dataStatus: 'fresh' as const,
    };
  },

  // ── Conversation metrics ─────────────────────────────────────────────────

  async getConversationMetrics(principal: PrincipalContext, accountId: string) {
    requirePrincipal(principal, 'getConversationMetrics');
    const conditions = [
      eq(canonicalConversations.accountId, accountId),
      eq(canonicalConversations.organisationId, principal.organisationId),
    ];

    const convos = await db
      .select()
      .from(canonicalConversations)
      .where(and(...conditions));

    const active = convos.filter(c => c.status === 'active');
    const totalMessages = convos.reduce((sum, c) => sum + c.messageCount, 0);
    const avgResponseTime = convos.reduce((sum, c) => sum + (c.lastResponseTimeSeconds ?? 0), 0) / (convos.length || 1);

    return {
      total: convos.length,
      active: active.length,
      totalMessages,
      avgResponseTimeSeconds: Math.round(avgResponseTime),
      dataStatus: 'fresh' as const,
    };
  },

  // ── Revenue metrics ──────────────────────────────────────────────────────

  async getRevenueMetrics(principal: PrincipalContext, accountId: string, dateRange?: { since: Date }) {
    requirePrincipal(principal, 'getRevenueMetrics');
    const conditions = [
      eq(canonicalRevenue.accountId, accountId),
      eq(canonicalRevenue.organisationId, principal.organisationId),
    ];
    if (dateRange?.since) conditions.push(gte(canonicalRevenue.transactionDate, dateRange.since));

    const records = await db
      .select()
      .from(canonicalRevenue)
      .where(and(...conditions));

    const completed = records.filter(r => r.status === 'completed');
    const totalRevenue = completed.reduce((sum, r) => sum + Number(r.amount), 0);
    const recurring = completed.filter(r => r.type === 'recurring');
    const recurringRevenue = recurring.reduce((sum, r) => sum + Number(r.amount), 0);

    return {
      totalRevenue,
      recurringRevenue,
      transactionCount: completed.length,
      dataStatus: 'fresh' as const,
    };
  },

  // ── Health snapshots ─────────────────────────────────────────────────────

  async getLatestHealthSnapshot(principal: PrincipalContext, accountId: string) {
    requirePrincipal(principal, 'getLatestHealthSnapshot');
    const conditions = [
      eq(healthSnapshots.accountId, accountId),
      eq(healthSnapshots.organisationId, principal.organisationId),
    ];

    const [snapshot] = await db
      .select()
      .from(healthSnapshots)
      .where(and(...conditions))
      .orderBy(desc(healthSnapshots.createdAt))
      .limit(1);
    return snapshot ?? null;
  },

  async getHealthHistory(principal: PrincipalContext, accountId: string, limit = 30) {
    requirePrincipal(principal, 'getHealthHistory');
    const conditions = [
      eq(healthSnapshots.accountId, accountId),
      eq(healthSnapshots.organisationId, principal.organisationId),
    ];

    return db
      .select()
      .from(healthSnapshots)
      .where(and(...conditions))
      .orderBy(desc(healthSnapshots.createdAt))
      .limit(limit);
  },

  async writeHealthSnapshot(principal: PrincipalContext, data: {
    accountId: string;
    score: number;
    factorBreakdown: Array<{ factor: string; score: number; weight: number }>;
    trend: 'improving' | 'stable' | 'declining';
    confidence: number;
    configVersion?: string;
    algorithmVersion?: string;
  }) {
    requirePrincipal(principal, 'writeHealthSnapshot');
    const [snapshot] = await db
      .insert(healthSnapshots)
      .values({ organisationId: principal.organisationId, ...data })
      .returning();
    return snapshot;
  },

  // ── Anomaly events ───────────────────────────────────────────────────────

  async getRecentAnomalies(principal: PrincipalContext, limit = 50) {
    requirePrincipal(principal, 'getRecentAnomalies');
    return db
      .select()
      .from(anomalyEvents)
      .where(eq(anomalyEvents.organisationId, principal.organisationId))
      .orderBy(desc(anomalyEvents.createdAt))
      .limit(limit);
  },

  async writeAnomalyEvent(principal: PrincipalContext, data: {
    accountId: string;
    metricName: string;
    currentValue: number;
    baselineValue: number;
    deviationPercent: number;
    direction: 'above' | 'below';
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
  }) {
    requirePrincipal(principal, 'writeAnomalyEvent');
    const [event] = await db
      .insert(anomalyEvents)
      .values({
        organisationId: principal.organisationId,
        ...data,
        currentValue: String(data.currentValue),
        baselineValue: String(data.baselineValue),
      } as typeof anomalyEvents.$inferInsert)
      .returning();
    return event;
  },

  async acknowledgeAnomaly(principal: PrincipalContext, anomalyId: string) {
    requirePrincipal(principal, 'acknowledgeAnomaly');
    await db
      .update(anomalyEvents)
      .set({ acknowledged: true })
      .where(and(
        eq(anomalyEvents.id, anomalyId),
        eq(anomalyEvents.organisationId, principal.organisationId),
      ));
  },

  // ── Upsert helpers (used by polling/webhook ingestion) ───────────────────

  async upsertAccount(principal: PrincipalContext, connectorConfigId: string, data: {
    externalId: string;
    displayName?: string;
    status?: string;
    externalMetadata?: Record<string, unknown>;
    subaccountId?: string;
  }) {
    requirePrincipal(principal, 'upsertAccount');
    const [result] = await db
      .insert(canonicalAccounts)
      .values({
        organisationId: principal.organisationId,
        connectorConfigId,
        externalId: data.externalId,
        displayName: data.displayName,
        status: (data.status as 'active' | 'inactive' | 'suspended') ?? 'active',
        externalMetadata: data.externalMetadata,
        subaccountId: data.subaccountId,
        lastSyncAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [canonicalAccounts.connectorConfigId, canonicalAccounts.externalId],
        set: {
          displayName: data.displayName,
          status: (data.status as 'active' | 'inactive' | 'suspended') ?? 'active',
          externalMetadata: data.externalMetadata,
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        } as typeof canonicalAccounts.$inferInsert,
      })
      .returning();
    return result;
  },

  async upsertContact(principal: PrincipalContext, accountId: string, data: {
    externalId: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    tags?: string[];
    source?: string;
    externalCreatedAt?: Date;
  }) {
    requirePrincipal(principal, 'upsertContact');
    await db
      .insert(canonicalContacts)
      .values({ organisationId: principal.organisationId, accountId, ...data } as typeof canonicalContacts.$inferInsert)
      .onConflictDoUpdate({
        target: [canonicalContacts.accountId, canonicalContacts.externalId],
        set: { ...data, updatedAt: new Date() } as typeof canonicalContacts.$inferInsert,
      });
  },

  async upsertOpportunity(principal: PrincipalContext, accountId: string, data: {
    externalId: string;
    name?: string;
    stage?: string;
    value?: string;
    currency?: string;
    status?: string;
    stageEnteredAt?: Date;
    stageHistory?: Array<{ stage: string; enteredAt: string; exitedAt?: string }>;
    externalCreatedAt?: Date;
  }) {
    requirePrincipal(principal, 'upsertOpportunity');
    await db
      .insert(canonicalOpportunities)
      .values({ organisationId: principal.organisationId, accountId, ...data } as typeof canonicalOpportunities.$inferInsert)
      .onConflictDoUpdate({
        target: [canonicalOpportunities.accountId, canonicalOpportunities.externalId],
        set: { ...data, updatedAt: new Date() } as typeof canonicalOpportunities.$inferInsert,
      });
  },

  async upsertConversation(principal: PrincipalContext, accountId: string, data: {
    externalId: string;
    channel?: string;
    status?: string;
    messageCount?: number;
    lastMessageAt?: Date;
    lastResponseTimeSeconds?: number;
    externalCreatedAt?: Date;
  }) {
    requirePrincipal(principal, 'upsertConversation');
    await db
      .insert(canonicalConversations)
      .values({ organisationId: principal.organisationId, accountId, ...data } as typeof canonicalConversations.$inferInsert)
      .onConflictDoUpdate({
        target: [canonicalConversations.accountId, canonicalConversations.externalId],
        set: { ...data, updatedAt: new Date() } as typeof canonicalConversations.$inferInsert,
      });
  },

  async upsertRevenue(principal: PrincipalContext, accountId: string, data: {
    externalId: string;
    amount: string;
    currency?: string;
    type?: string;
    status?: string;
    transactionDate?: Date;
  }) {
    requirePrincipal(principal, 'upsertRevenue');
    await db
      .insert(canonicalRevenue)
      .values({ organisationId: principal.organisationId, accountId, ...data } as typeof canonicalRevenue.$inferInsert)
      .onConflictDoUpdate({
        target: [canonicalRevenue.accountId, canonicalRevenue.externalId],
        set: { ...data, updatedAt: new Date() } as typeof canonicalRevenue.$inferInsert,
      });
  },

  // ── Canonical Metrics ───────────────────────────────────────────────────
  // INVARIANT: canonical_metrics is a "latest snapshot" table.
  // It always represents the most recently computed window for each metric.
  // period_start/period_end are NOT part of the uniqueness constraint —
  // they shift as the rolling window moves. Full history with fixed
  // windows is in canonical_metric_history (append-only).

  async upsertMetric(principal: PrincipalContext, data: Omit<NewCanonicalMetric, 'organisationId'>) {
    requirePrincipal(principal, 'upsertMetric');
    const insertValues = { organisationId: principal.organisationId, ...data } as NewCanonicalMetric;
    const [result] = await db
      .insert(canonicalMetrics)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [
          canonicalMetrics.accountId,
          canonicalMetrics.metricSlug,
          canonicalMetrics.periodType,
          canonicalMetrics.aggregationType,
        ],
        set: {
          currentValue: data.currentValue,
          previousValue: data.previousValue,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          computedAt: new Date(),
          computationTrigger: data.computationTrigger,
          metricVersion: data.metricVersion,
          metadata: data.metadata,
        },
      })
      .returning();
    return result;
  },

  async appendMetricHistory(
    principal: PrincipalContext,
    data: Omit<NewCanonicalMetricHistoryEntry, 'organisationId'>,
  ) {
    requirePrincipal(principal, 'appendMetricHistory');
    // Idempotent: skip duplicate entries (same account+metric+period window)
    const insertValues = {
      organisationId: principal.organisationId,
      ...data,
    } as NewCanonicalMetricHistoryEntry;
    const [result] = await db
      .insert(canonicalMetricHistory)
      .values(insertValues)
      .onConflictDoNothing()
      .returning();
    return result ?? null;
  },

  async getMetricValue(
    principal: PrincipalContext,
    accountId: string,
    metricSlug: string,
    periodType: string,
  ) {
    requirePrincipal(principal, 'getMetricValue');
    const conditions = [
      eq(canonicalMetrics.accountId, accountId),
      eq(canonicalMetrics.metricSlug, metricSlug),
      eq(canonicalMetrics.periodType, periodType),
      eq(canonicalMetrics.organisationId, principal.organisationId),
    ];

    const [result] = await db
      .select()
      .from(canonicalMetrics)
      .where(and(...conditions))
      .limit(1);
    return result ?? null;
  },

  async getMetricsByAccount(principal: PrincipalContext, accountId: string) {
    requirePrincipal(principal, 'getMetricsByAccount');
    const conditions = [
      eq(canonicalMetrics.accountId, accountId),
      eq(canonicalMetrics.organisationId, principal.organisationId),
    ];

    return db
      .select()
      .from(canonicalMetrics)
      .where(and(...conditions));
  },

  async getMetricHistoryBySlug(
    principal: PrincipalContext,
    accountId: string,
    metricSlug: string,
    periodType: string,
    limit = 30,
    excludeBackfill = true,
  ) {
    requirePrincipal(principal, 'getMetricHistoryBySlug');
    const conditions = [
      eq(canonicalMetricHistory.accountId, accountId),
      eq(canonicalMetricHistory.metricSlug, metricSlug),
      eq(canonicalMetricHistory.periodType, periodType),
      eq(canonicalMetricHistory.organisationId, principal.organisationId),
    ];
    if (excludeBackfill) {
      conditions.push(eq(canonicalMetricHistory.isBackfill, false));
    }

    return db
      .select()
      .from(canonicalMetricHistory)
      .where(and(...conditions))
      .orderBy(desc(canonicalMetricHistory.computedAt))
      .limit(limit);
  },

  async getMetricHistoryCount(
    principal: PrincipalContext,
    accountId: string,
    metricSlug: string,
    periodType: string,
    excludeBackfill = true,
  ): Promise<number> {
    requirePrincipal(principal, 'getMetricHistoryCount');
    const conditions = [
      eq(canonicalMetricHistory.accountId, accountId),
      eq(canonicalMetricHistory.metricSlug, metricSlug),
      eq(canonicalMetricHistory.periodType, periodType),
      eq(canonicalMetricHistory.organisationId, principal.organisationId),
    ];
    if (excludeBackfill) {
      conditions.push(eq(canonicalMetricHistory.isBackfill, false));
    }

    const [result] = await db
      .select({ count: count() })
      .from(canonicalMetricHistory)
      .where(and(...conditions));
    return Number(result?.count ?? 0);
  },

  // ── CRM Query Planner extensions (spec §12.3) ────────────────────────────

  // Contacts with no recorded update since N days ago, scoped to a subaccount.
  // Uses `updatedAt` as the activity proxy — TODO(spec-open-1): confirm column
  // once a dedicated lastActivityAt is added to the schema.
  async listInactiveContacts(principal: PrincipalContext, args: {
    sinceDaysAgo: number;
    limit: number;
  }): Promise<{ rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }> {
    requirePrincipal(principal, 'listInactiveContacts');
    if (!principal.subaccountId) {
      throw new Error('canonicalDataService.listInactiveContacts: principal.subaccountId is required');
    }
    const cutoff = new Date(Date.now() - args.sinceDaysAgo * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        id:        canonicalContacts.id,
        firstName: canonicalContacts.firstName,
        lastName:  canonicalContacts.lastName,
        email:     canonicalContacts.email,
        phone:     canonicalContacts.phone,
        tags:      canonicalContacts.tags,
        updatedAt: canonicalContacts.updatedAt,
      })
      .from(canonicalContacts)
      .innerJoin(canonicalAccounts, eq(canonicalContacts.accountId, canonicalAccounts.id))
      .where(
        and(
          eq(canonicalContacts.organisationId, principal.organisationId),
          eq(canonicalAccounts.subaccountId, principal.subaccountId),
          lt(canonicalContacts.updatedAt, cutoff),
        ),
      )
      .orderBy(asc(canonicalContacts.updatedAt))
      .limit(args.limit + 1);

    const truncated = rows.length > args.limit;
    return {
      rows: (truncated ? rows.slice(0, args.limit) : rows) as Record<string, unknown>[],
      rowCount: truncated ? args.limit : rows.length,
      truncated,
    };
  },

  async listStaleOpportunities(principal: PrincipalContext, args: {
    stageKey?: string;
    staleSince: Date;
    limit: number;
  }): Promise<{ rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }> {
    requirePrincipal(principal, 'listStaleOpportunities');
    if (!principal.subaccountId) {
      throw new Error('canonicalDataService.listStaleOpportunities: principal.subaccountId is required');
    }
    const conditions = [
      eq(canonicalOpportunities.organisationId, principal.organisationId),
      eq(canonicalAccounts.subaccountId, principal.subaccountId),
      lt(canonicalOpportunities.updatedAt, args.staleSince),
    ];
    if (args.stageKey) conditions.push(eq(canonicalOpportunities.stage, args.stageKey));

    const rows = await db
      .select({
        id:             canonicalOpportunities.id,
        name:           canonicalOpportunities.name,
        stage:          canonicalOpportunities.stage,
        value:          canonicalOpportunities.value,
        status:         canonicalOpportunities.status,
        stageEnteredAt: canonicalOpportunities.stageEnteredAt,
        updatedAt:      canonicalOpportunities.updatedAt,
      })
      .from(canonicalOpportunities)
      .innerJoin(canonicalAccounts, eq(canonicalOpportunities.accountId, canonicalAccounts.id))
      .where(and(...conditions))
      .orderBy(asc(canonicalOpportunities.updatedAt))
      .limit(args.limit + 1);

    const truncated = rows.length > args.limit;
    return {
      rows: (truncated ? rows.slice(0, args.limit) : rows) as Record<string, unknown>[],
      rowCount: truncated ? args.limit : rows.length,
      truncated,
    };
  },

  async listUpcomingAppointments(principal: PrincipalContext, args: {
    from: Date;
    to: Date;
    limit: number;
  }): Promise<{ rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }> {
    requirePrincipal(principal, 'listUpcomingAppointments');
    // Appointments are sourced from GHL live in v1; canonical table may not exist.
    // This stub ensures the handler compiles. The live executor handles real data.
    void args;
    return { rows: [], rowCount: 0, truncated: false };
  },

  async countContactsByTag(principal: PrincipalContext): Promise<{ rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }> {
    requirePrincipal(principal, 'countContactsByTag');
    if (!principal.subaccountId) {
      throw new Error('canonicalDataService.countContactsByTag: principal.subaccountId is required');
    }
    // Tag-partitioned counts — needs unnest(tags). Simplified v1 implementation.
    const rows = await db
      .select({
        id:   canonicalContacts.id,
        tags: canonicalContacts.tags,
      })
      .from(canonicalContacts)
      .innerJoin(canonicalAccounts, eq(canonicalContacts.accountId, canonicalAccounts.id))
      .where(
        and(
          eq(canonicalContacts.organisationId, principal.organisationId),
          eq(canonicalAccounts.subaccountId, principal.subaccountId),
        ),
      )
      .limit(1000);

    // Tally tags in-process (acceptable for v1 low-traffic; SQL unnest in v2)
    const tally: Record<string, number> = {};
    for (const r of rows) {
      for (const tag of (r.tags ?? [])) {
        tally[tag] = (tally[tag] ?? 0) + 1;
      }
    }
    const tagRows = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, contactCount]) => ({ tag, contactCount })) as Record<string, unknown>[];

    return { rows: tagRows, rowCount: tagRows.length, truncated: false };
  },

  async countOpportunitiesByStage(principal: PrincipalContext): Promise<{ rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }> {
    requirePrincipal(principal, 'countOpportunitiesByStage');
    if (!principal.subaccountId) {
      throw new Error('canonicalDataService.countOpportunitiesByStage: principal.subaccountId is required');
    }
    const rows = await db
      .select({
        stage: canonicalOpportunities.stage,
        count: count(),
      })
      .from(canonicalOpportunities)
      .innerJoin(canonicalAccounts, eq(canonicalOpportunities.accountId, canonicalAccounts.id))
      .where(
        and(
          eq(canonicalOpportunities.organisationId, principal.organisationId),
          eq(canonicalAccounts.subaccountId, principal.subaccountId),
          eq(canonicalOpportunities.status, 'open'),
        ),
      )
      .groupBy(canonicalOpportunities.stage)
      .orderBy(desc(count()));

    return {
      rows: rows as Record<string, unknown>[],
      rowCount: rows.length,
      truncated: false,
    };
  },

  async getRevenueTrend(principal: PrincipalContext, args: {
    from: Date;
    to: Date;
    limit: number;
  }): Promise<{ rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }> {
    requirePrincipal(principal, 'getRevenueTrend');
    if (!principal.subaccountId) {
      throw new Error('canonicalDataService.getRevenueTrend: principal.subaccountId is required');
    }
    const rows = await db
      .select({
        transactionDate: canonicalRevenue.transactionDate,
        amount:          canonicalRevenue.amount,
        currency:        canonicalRevenue.currency,
        type:            canonicalRevenue.type,
      })
      .from(canonicalRevenue)
      .innerJoin(canonicalAccounts, eq(canonicalRevenue.accountId, canonicalAccounts.id))
      .where(
        and(
          eq(canonicalRevenue.organisationId, principal.organisationId),
          eq(canonicalAccounts.subaccountId, principal.subaccountId),
          eq(canonicalRevenue.status, 'completed'),
          gte(canonicalRevenue.transactionDate, args.from),
          lte(canonicalRevenue.transactionDate, args.to),
        ),
      )
      .orderBy(asc(canonicalRevenue.transactionDate))
      .limit(args.limit + 1);

    const truncated = rows.length > args.limit;
    return {
      rows: (truncated ? rows.slice(0, args.limit) : rows) as Record<string, unknown>[],
      rowCount: truncated ? args.limit : rows.length,
      truncated,
    };
  },

  async getAccountsAtRiskBand(principal: PrincipalContext, args: {
    band: 'red' | 'yellow' | 'green';
    limit: number;
  }): Promise<{ rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }> {
    requirePrincipal(principal, 'getAccountsAtRiskBand');
    if (!principal.subaccountId) {
      throw new Error('canonicalDataService.getAccountsAtRiskBand: principal.subaccountId is required');
    }
    const bandRanges: Record<string, [number, number]> = {
      red:    [0, 40],
      yellow: [41, 70],
      green:  [71, 100],
    };
    const [minScore, maxScore] = bandRanges[args.band]!;

    const rows = await db
      .select({
        accountId:  healthSnapshots.accountId,
        score:      healthSnapshots.score,
        trend:      healthSnapshots.trend,
      })
      .from(healthSnapshots)
      .innerJoin(canonicalAccounts, eq(healthSnapshots.accountId, canonicalAccounts.id))
      .where(
        and(
          eq(healthSnapshots.organisationId, principal.organisationId),
          eq(canonicalAccounts.subaccountId, principal.subaccountId),
          gte(healthSnapshots.score, minScore),
          lte(healthSnapshots.score, maxScore),
        ),
      )
      .orderBy(asc(healthSnapshots.score))
      .limit(args.limit + 1);

    const truncated = rows.length > args.limit;
    return {
      rows: (truncated ? rows.slice(0, args.limit) : rows) as Record<string, unknown>[],
      rowCount: truncated ? args.limit : rows.length,
      truncated,
    };
  },

  async getPipelineVelocity(principal: PrincipalContext, args: {
    from: Date;
    to: Date;
  }): Promise<{ rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }> {
    requirePrincipal(principal, 'getPipelineVelocity');
    if (!principal.subaccountId) {
      throw new Error('canonicalDataService.getPipelineVelocity: principal.subaccountId is required');
    }
    // Stage velocity: count opportunities that entered each stage in the window
    const rows = await db
      .select({
        stage: canonicalOpportunities.stage,
        count: count(),
      })
      .from(canonicalOpportunities)
      .innerJoin(canonicalAccounts, eq(canonicalOpportunities.accountId, canonicalAccounts.id))
      .where(
        and(
          eq(canonicalOpportunities.organisationId, principal.organisationId),
          eq(canonicalAccounts.subaccountId, principal.subaccountId),
          gte(canonicalOpportunities.stageEnteredAt, args.from),
          lte(canonicalOpportunities.stageEnteredAt, args.to),
        ),
      )
      .groupBy(canonicalOpportunities.stage)
      .orderBy(desc(count()));

    return {
      rows: rows as Record<string, unknown>[],
      rowCount: rows.length,
      truncated: false,
    };
  },
};

// ---------------------------------------------------------------------------
// Unused-import suppression — `avg` and `sum` from drizzle-orm are imported
// against future aggregation use-cases. Keeping the imports preserves
// surface continuity and avoids churn in A1b.
// ---------------------------------------------------------------------------
void avg;
void sum;
