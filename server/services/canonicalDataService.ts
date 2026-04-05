import { eq, and, gte, sql, count, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  canonicalAccounts,
  canonicalContacts,
  canonicalOpportunities,
  canonicalConversations,
  canonicalRevenue,
  healthSnapshots,
  anomalyEvents,
} from '../db/schema/index.js';

// ---------------------------------------------------------------------------
// Canonical Data Service — unified read interface for normalised entities
// Agents and skills call this service, never the connector directly.
// ---------------------------------------------------------------------------

export const canonicalDataService = {
  // ── Account queries ──────────────────────────────────────────────────────

  async getAccountsByOrg(organisationId: string) {
    return db
      .select()
      .from(canonicalAccounts)
      .where(eq(canonicalAccounts.organisationId, organisationId));
  },

  async getAccountById(accountId: string, organisationId: string) {
    const [account] = await db
      .select()
      .from(canonicalAccounts)
      .where(and(eq(canonicalAccounts.id, accountId), eq(canonicalAccounts.organisationId, organisationId)));
    return account ?? null;
  },

  // ── Contact metrics ──────────────────────────────────────────────────────

  async getContactMetrics(accountId: string, dateRange?: { since: Date }, organisationId?: string) {
    const conditions = [eq(canonicalContacts.accountId, accountId)];
    if (organisationId) conditions.push(eq(canonicalContacts.organisationId, organisationId));
    if (dateRange?.since) conditions.push(gte(canonicalContacts.createdAt, dateRange.since));

    const [totalResult] = await db
      .select({ count: count() })
      .from(canonicalContacts)
      .where(and(...conditions));

    // Growth: contacts created in the last 30 days vs previous 30 days
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [recentResult] = await db
      .select({ count: count() })
      .from(canonicalContacts)
      .where(and(eq(canonicalContacts.accountId, accountId), gte(canonicalContacts.externalCreatedAt, thirtyDaysAgo)));

    const [previousResult] = await db
      .select({ count: count() })
      .from(canonicalContacts)
      .where(and(
        eq(canonicalContacts.accountId, accountId),
        gte(canonicalContacts.externalCreatedAt, sixtyDaysAgo),
        sql`${canonicalContacts.externalCreatedAt} < ${thirtyDaysAgo}`
      ));

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

  async getOpportunityMetrics(accountId: string, organisationId?: string) {
    const conditions = [eq(canonicalOpportunities.accountId, accountId)];
    if (organisationId) conditions.push(eq(canonicalOpportunities.organisationId, organisationId));

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

  async getConversationMetrics(accountId: string, organisationId?: string) {
    const conditions = [eq(canonicalConversations.accountId, accountId)];
    if (organisationId) conditions.push(eq(canonicalConversations.organisationId, organisationId));

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

  async getRevenueMetrics(accountId: string, dateRange?: { since: Date }, organisationId?: string) {
    const conditions = [eq(canonicalRevenue.accountId, accountId)];
    if (organisationId) conditions.push(eq(canonicalRevenue.organisationId, organisationId));
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

  async getLatestHealthSnapshot(accountId: string, organisationId?: string) {
    const conditions = [eq(healthSnapshots.accountId, accountId)];
    if (organisationId) conditions.push(eq(healthSnapshots.organisationId, organisationId));

    const [snapshot] = await db
      .select()
      .from(healthSnapshots)
      .where(and(...conditions))
      .orderBy(desc(healthSnapshots.createdAt))
      .limit(1);
    return snapshot ?? null;
  },

  async getHealthHistory(accountId: string, limit = 30, organisationId?: string) {
    const conditions = [eq(healthSnapshots.accountId, accountId)];
    if (organisationId) conditions.push(eq(healthSnapshots.organisationId, organisationId));

    return db
      .select()
      .from(healthSnapshots)
      .where(and(...conditions))
      .orderBy(desc(healthSnapshots.createdAt))
      .limit(limit);
  },

  async writeHealthSnapshot(data: {
    organisationId: string;
    accountId: string;
    score: number;
    factorBreakdown: Array<{ factor: string; score: number; weight: number }>;
    trend: 'improving' | 'stable' | 'declining';
    confidence: number;
    configVersion?: string;
  }) {
    const [snapshot] = await db
      .insert(healthSnapshots)
      .values(data)
      .returning();
    return snapshot;
  },

  // ── Anomaly events ───────────────────────────────────────────────────────

  async getRecentAnomalies(organisationId: string, limit = 50) {
    return db
      .select()
      .from(anomalyEvents)
      .where(eq(anomalyEvents.organisationId, organisationId))
      .orderBy(desc(anomalyEvents.createdAt))
      .limit(limit);
  },

  async writeAnomalyEvent(data: {
    organisationId: string;
    accountId: string;
    metricName: string;
    currentValue: number;
    baselineValue: number;
    deviationPercent: number;
    direction: 'above' | 'below';
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
  }) {
    const [event] = await db
      .insert(anomalyEvents)
      .values({
        ...data,
        currentValue: String(data.currentValue),
        baselineValue: String(data.baselineValue),
      } as typeof anomalyEvents.$inferInsert)
      .returning();
    return event;
  },

  async acknowledgeAnomaly(anomalyId: string, organisationId: string) {
    await db
      .update(anomalyEvents)
      .set({ acknowledged: true })
      .where(and(eq(anomalyEvents.id, anomalyId), eq(anomalyEvents.organisationId, organisationId)));
  },

  // ── Upsert helpers (used by polling/webhook ingestion) ───────────────────

  async upsertAccount(organisationId: string, connectorConfigId: string, data: {
    externalId: string;
    displayName?: string;
    status?: string;
    externalMetadata?: Record<string, unknown>;
    subaccountId?: string;
  }) {
    const [result] = await db
      .insert(canonicalAccounts)
      .values({
        organisationId,
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

  async upsertContact(organisationId: string, accountId: string, data: {
    externalId: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    tags?: string[];
    source?: string;
    externalCreatedAt?: Date;
  }) {
    await db
      .insert(canonicalContacts)
      .values({ organisationId, accountId, ...data } as typeof canonicalContacts.$inferInsert)
      .onConflictDoUpdate({
        target: [canonicalContacts.accountId, canonicalContacts.externalId],
        set: { ...data, updatedAt: new Date() } as typeof canonicalContacts.$inferInsert,
      });
  },

  async upsertOpportunity(organisationId: string, accountId: string, data: {
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
    await db
      .insert(canonicalOpportunities)
      .values({ organisationId, accountId, ...data } as typeof canonicalOpportunities.$inferInsert)
      .onConflictDoUpdate({
        target: [canonicalOpportunities.accountId, canonicalOpportunities.externalId],
        set: { ...data, updatedAt: new Date() } as typeof canonicalOpportunities.$inferInsert,
      });
  },

  async upsertConversation(organisationId: string, accountId: string, data: {
    externalId: string;
    channel?: string;
    status?: string;
    messageCount?: number;
    lastMessageAt?: Date;
    lastResponseTimeSeconds?: number;
    externalCreatedAt?: Date;
  }) {
    await db
      .insert(canonicalConversations)
      .values({ organisationId, accountId, ...data } as typeof canonicalConversations.$inferInsert)
      .onConflictDoUpdate({
        target: [canonicalConversations.accountId, canonicalConversations.externalId],
        set: { ...data, updatedAt: new Date() } as typeof canonicalConversations.$inferInsert,
      });
  },

  async upsertRevenue(organisationId: string, accountId: string, data: {
    externalId: string;
    amount: string;
    currency?: string;
    type?: string;
    status?: string;
    transactionDate?: Date;
  }) {
    await db
      .insert(canonicalRevenue)
      .values({ organisationId, accountId, ...data } as typeof canonicalRevenue.$inferInsert)
      .onConflictDoUpdate({
        target: [canonicalRevenue.accountId, canonicalRevenue.externalId],
        set: { ...data, updatedAt: new Date() } as typeof canonicalRevenue.$inferInsert,
      });
  },
};
