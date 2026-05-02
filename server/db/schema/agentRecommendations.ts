/**
 * server/db/schema/agentRecommendations.ts
 *
 * Drizzle schema for agent_recommendations table.
 * Migration: 0267_agent_recommendations.sql
 * Spec: docs/sub-account-optimiser-spec.md §6.1
 */

import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { RecommendationEvidence } from '../../../shared/types/agentRecommendations.js';

export const agentRecommendations = pgTable(
  'agent_recommendations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    scopeType: text('scope_type').notNull().$type<'org' | 'subaccount'>(),
    scopeId: uuid('scope_id').notNull(),
    producingAgentId: uuid('producing_agent_id').notNull(),
    category: text('category').notNull(),
    severity: text('severity').notNull().$type<'info' | 'warn' | 'critical'>(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    evidence: jsonb('evidence').notNull().default({}).$type<Record<string, unknown>>(),
    evidenceHash: text('evidence_hash').notNull().default(''),
    actionHint: text('action_hint'),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedReason: text('dismissed_reason'),
    dismissedUntil: timestamp('dismissed_until', { withTimezone: true }),
  },
  (table) => ({
    // Partial unique index for open recs: prevents duplicate (scope, category, dedupe_key)
    // while still allowing re-open via a new row after dismiss.
    dedupeIdx: uniqueIndex('agent_recommendations_dedupe')
      .on(table.scopeType, table.scopeId, table.category, table.dedupeKey)
      .where(sql`${table.dismissedAt} IS NULL`),

    // Index for fetching open (non-dismissed, non-acknowledged) recs by scope sorted by recency.
    openByScopeIdx: index('agent_recommendations_open_by_scope')
      .on(table.scopeType, table.scopeId, table.updatedAt)
      .where(sql`${table.dismissedAt} IS NULL AND ${table.acknowledgedAt} IS NULL`),

    // Index for cooldown lookup on dismissed recs.
    dismissedActiveCooldownIdx: index('agent_recommendations_dismissed_active_cooldown')
      .on(table.scopeType, table.scopeId, table.category, table.dedupeKey, table.dismissedUntil)
      .where(sql`${table.dismissedAt} IS NOT NULL`),

    // Org-level rollup index.
    orgIdx: index('agent_recommendations_org').on(table.organisationId, table.createdAt),
  }),
);

export type AgentRecommendation = typeof agentRecommendations.$inferSelect;
export type NewAgentRecommendation = typeof agentRecommendations.$inferInsert;

// Row shape returned from the read endpoint (§6.5)
export interface AgentRecommendationRow {
  id: string;
  scope_type: 'org' | 'subaccount';
  scope_id: string;
  subaccount_display_name?: string;
  category: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  body: string;
  action_hint: string | null;
  evidence: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  acknowledged_at: string | null;
  dismissed_at: string | null;
}

// Type-only import to ensure the discriminated union is referenced (schema file
// imports only from drizzle-orm and shared/types per DEVELOPMENT_GUIDELINES §3).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _EvidenceRef = RecommendationEvidence;
