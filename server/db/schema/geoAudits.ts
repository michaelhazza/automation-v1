import { pgTable, uuid, text, real, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// geo_audits — GEO (Generative Engine Optimisation) audit results
//
// Stores composite and per-dimension GEO scores for a given URL/subaccount.
// One row per audit run. Historical rows enable trend tracking.
//
// See docs/geo-seo-dev-brief.md for the scoring framework.
// ---------------------------------------------------------------------------

export type GeoDimension =
  | 'ai_citability'
  | 'brand_authority'
  | 'content_quality'
  | 'technical_infrastructure'
  | 'structured_data'
  | 'platform_specific';

export interface GeoDimensionScore {
  dimension: GeoDimension;
  score: number;       // 0-100
  weight: number;      // 0-1 (sums to 1.0 across dimensions)
  findings: string[];  // human-readable finding strings
  recommendations: string[];
}

export interface GeoPlatformReadiness {
  platform: string;    // e.g. 'google_aio', 'chatgpt', 'perplexity', 'gemini', 'bing_copilot'
  score: number;       // 0-100
  findings: string[];
  recommendations: string[];
}

export const geoAudits = pgTable(
  'geo_audits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),

    // What was audited
    url: text('url').notNull(),
    pageTitle: text('page_title'),

    // Composite score (weighted sum of dimension scores)
    compositeScore: real('composite_score').notNull(),

    // Per-dimension breakdown (JSONB array of GeoDimensionScore)
    dimensionScores: jsonb('dimension_scores').$type<GeoDimensionScore[]>().notNull(),

    // Platform-specific readiness (JSONB array)
    platformReadiness: jsonb('platform_readiness').$type<GeoPlatformReadiness[]>(),

    // Priority-ranked recommendations (top-level summary)
    recommendations: jsonb('recommendations').$type<string[]>().notNull().default([]),

    // Which agent run produced this audit (nullable for manual/API runs)
    agentRunId: uuid('agent_run_id'),

    // Audit metadata
    auditType: text('audit_type').notNull().default('full').$type<'full' | 'quick' | 'competitive'>(),
    competitorUrls: jsonb('competitor_urls').$type<string[]>(),

    // The dimension weights used for this audit (snapshot so historical scores are reproducible)
    weightsSnapshot: jsonb('weights_snapshot').$type<Record<GeoDimension, number>>().notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('geo_audits_org_idx').on(table.organisationId),
    subaccountIdx: index('geo_audits_subaccount_idx').on(table.subaccountId),
    urlIdx: index('geo_audits_url_idx').on(table.organisationId, table.url),
    createdAtIdx: index('geo_audits_created_at_idx').on(table.organisationId, table.createdAt),
  }),
);

export type GeoAudit = typeof geoAudits.$inferSelect;
export type NewGeoAudit = typeof geoAudits.$inferInsert;
