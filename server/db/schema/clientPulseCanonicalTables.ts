/**
 * Drizzle schemas for ClientPulse Phase 1 canonical + derived tables.
 * Migration: 0172_clientpulse_canonical_tables.sql
 * Spec: tasks/clientpulse-ghl-gap-analysis.md §9.4, §25.1.
 *
 * Six canonical tables (CRM-agnostic, adapter-populated) + two derived tables
 * (skill-written). Every table has RLS enabled keyed on
 * `current_setting('app.organisation_id')`.
 *
 * ── Canonical uniqueness modes ─────────────────────────────────────────────
 *
 * The §25.1 contract declares `UNIQUE(organisation_id, provider_type,
 * external_id)` for canonical tables, but this is a two-mode contract in
 * practice:
 *
 *   GLOBAL mode — `UNIQUE(org, provider_type, external_id)`. The provider's
 *   external id is globally unique within the provider (e.g. GHL contact IDs,
 *   opportunity IDs). Used by: canonical_conversation_providers,
 *   canonical_workflow_definitions, canonical_tag_definitions,
 *   canonical_custom_field_definitions, canonical_contact_sources.
 *
 *   SCOPED mode — `UNIQUE(org, subaccount_id, provider_type, external_id)`.
 *   The provider's external id is location-scoped; the same id can legitimately
 *   appear in two sub-accounts. Used by: canonical_subaccount_mutations.
 *
 * When adding a new canonical table, declare which mode it uses in the
 * `CANONICAL_UNIQUENESS_MODE` map below, and shape its index accordingly.
 * Future fingerprint-scanner code can key off the mode rather than
 * hand-rolling the uniqueness assumption per table.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  doublePrecision,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { subaccounts } from './subaccounts.js';

// ── Uniqueness-mode registry ──────────────────────────────────────────────
//
// Single source of truth for which canonical tables use GLOBAL vs SCOPED
// uniqueness. Future writers / upsert helpers can consume this to shape
// their `.onConflictDoUpdate({ target: [...] })` calls without hand-rolling
// the column list per call site.

export type CanonicalUniquenessMode = 'global' | 'scoped';

export const CANONICAL_UNIQUENESS_MODE: Record<string, CanonicalUniquenessMode> = {
  canonical_subaccount_mutations: 'scoped',
  canonical_conversation_providers: 'global',
  canonical_workflow_definitions: 'global',
  canonical_tag_definitions: 'global',
  canonical_custom_field_definitions: 'global',
  canonical_contact_sources: 'global',
};

// ── Shared helper types ───────────────────────────────────────────────────

export type ExternalUserKind = 'staff' | 'automation' | 'contact' | 'unknown';
export type ObservationAvailability = 'available' | 'unavailable_missing_scope' | 'unavailable_tier_gated' | 'unavailable_other';

// ===========================================================================
// canonical_subaccount_mutations (§2.0b Staff Activity Pulse)
// ===========================================================================

export const canonicalSubaccountMutations = pgTable(
  'canonical_subaccount_mutations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    providerType: text('provider_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    mutationType: text('mutation_type').notNull(),
    sourceEntity: text('source_entity').notNull(),
    externalUserId: text('external_user_id'),
    externalUserKind: text('external_user_kind').notNull().default('unknown').$type<ExternalUserKind>(),
    externalId: text('external_id').notNull(),
    evidence: jsonb('evidence').notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Includes subaccountId — mutation event IDs are location-scoped in
    // GHL (and most CRMs), not globally unique within the provider. See
    // migration 0172 for the full rationale.
    uniq: uniqueIndex('canonical_subaccount_mutations_unique').on(
      table.organisationId,
      table.subaccountId,
      table.providerType,
      table.externalId,
    ),
    subOccurredIdx: index('canonical_subaccount_mutations_sub_occurred_idx').on(
      table.subaccountId,
      table.occurredAt,
    ),
    userIdx: index('canonical_subaccount_mutations_user_idx')
      .on(table.subaccountId, table.externalUserId, table.occurredAt)
      .where(sql`${table.externalUserId} IS NOT NULL`),
  }),
);

export type CanonicalSubaccountMutation = typeof canonicalSubaccountMutations.$inferSelect;
export type NewCanonicalSubaccountMutation = typeof canonicalSubaccountMutations.$inferInsert;

// ===========================================================================
// canonical_conversation_providers (§2.0c fingerprint source)
// ===========================================================================

export const canonicalConversationProviders = pgTable(
  'canonical_conversation_providers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    providerType: text('provider_type').notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name'),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniq: uniqueIndex('canonical_conversation_providers_unique').on(
      table.organisationId,
      table.providerType,
      table.externalId,
    ),
  }),
);

export type CanonicalConversationProvider = typeof canonicalConversationProviders.$inferSelect;
export type NewCanonicalConversationProvider = typeof canonicalConversationProviders.$inferInsert;

// ===========================================================================
// canonical_workflow_definitions (§2.0c)
// ===========================================================================

export const canonicalWorkflowDefinitions = pgTable(
  'canonical_workflow_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    providerType: text('provider_type').notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name'),
    actionTypes: jsonb('action_types').notNull().default([]).$type<string[]>(),
    outboundWebhookTargets: jsonb('outbound_webhook_targets').notNull().default([]).$type<string[]>(),
    updatedAtUpstream: timestamp('updated_at_upstream', { withTimezone: true }),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniq: uniqueIndex('canonical_workflow_definitions_unique').on(
      table.organisationId,
      table.providerType,
      table.externalId,
    ),
  }),
);

export type CanonicalWorkflowDefinition = typeof canonicalWorkflowDefinitions.$inferSelect;
export type NewCanonicalWorkflowDefinition = typeof canonicalWorkflowDefinitions.$inferInsert;

// ===========================================================================
// canonical_tag_definitions (§2.0c)
// ===========================================================================

export const canonicalTagDefinitions = pgTable(
  'canonical_tag_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    providerType: text('provider_type').notNull(),
    externalId: text('external_id').notNull(),
    tagName: text('tag_name').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniq: uniqueIndex('canonical_tag_definitions_unique').on(
      table.organisationId,
      table.providerType,
      table.externalId,
    ),
  }),
);

export type CanonicalTagDefinition = typeof canonicalTagDefinitions.$inferSelect;
export type NewCanonicalTagDefinition = typeof canonicalTagDefinitions.$inferInsert;

// ===========================================================================
// canonical_custom_field_definitions (§2.0c)
// ===========================================================================

export const canonicalCustomFieldDefinitions = pgTable(
  'canonical_custom_field_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    providerType: text('provider_type').notNull(),
    externalId: text('external_id').notNull(),
    fieldKey: text('field_key').notNull(),
    fieldType: text('field_type'),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniq: uniqueIndex('canonical_custom_field_definitions_unique').on(
      table.organisationId,
      table.providerType,
      table.externalId,
    ),
  }),
);

export type CanonicalCustomFieldDefinition = typeof canonicalCustomFieldDefinitions.$inferSelect;
export type NewCanonicalCustomFieldDefinition = typeof canonicalCustomFieldDefinitions.$inferInsert;

// ===========================================================================
// canonical_contact_sources (§2.0c)
// ===========================================================================

export const canonicalContactSources = pgTable(
  'canonical_contact_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    providerType: text('provider_type').notNull(),
    externalId: text('external_id').notNull(),
    sourceValue: text('source_value').notNull(),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniq: uniqueIndex('canonical_contact_sources_unique').on(
      table.organisationId,
      table.providerType,
      table.externalId,
    ),
  }),
);

export type CanonicalContactSource = typeof canonicalContactSources.$inferSelect;
export type NewCanonicalContactSource = typeof canonicalContactSources.$inferInsert;

// ===========================================================================
// client_pulse_signal_observations (derived timeseries — §4.3)
// ===========================================================================

export const clientPulseSignalObservations = pgTable(
  'client_pulse_signal_observations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    connectorConfigId: uuid('connector_config_id'),
    signalSlug: text('signal_slug').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    numericValue: doublePrecision('numeric_value'),
    jsonPayload: jsonb('json_payload').notNull().default({}).$type<Record<string, unknown>>(),
    sourceRunId: uuid('source_run_id'),
    availability: text('availability').notNull().default('available').$type<ObservationAvailability>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subSlugIdx: index('client_pulse_signal_observations_sub_slug_idx').on(
      table.subaccountId,
      table.signalSlug,
      table.observedAt,
    ),
    orgSlugIdx: index('client_pulse_signal_observations_org_slug_idx').on(
      table.organisationId,
      table.signalSlug,
      table.observedAt,
    ),
  }),
);

export type ClientPulseSignalObservation = typeof clientPulseSignalObservations.$inferSelect;
export type NewClientPulseSignalObservation = typeof clientPulseSignalObservations.$inferInsert;

// ===========================================================================
// subaccount_tier_history (§2, signal #6)
// ===========================================================================

export const subaccountTierHistory = pgTable(
  'subaccount_tier_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    tier: text('tier').notNull(),
    tierSource: text('tier_source').notNull().default('api'),
    planId: text('plan_id'),
    active: boolean('active'),
    nextBillingDate: timestamp('next_billing_date', { withTimezone: true }),
    sourceRunId: uuid('source_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subObservedIdx: index('subaccount_tier_history_sub_observed_idx').on(
      table.subaccountId,
      table.observedAt,
    ),
  }),
);

export type SubaccountTierHistory = typeof subaccountTierHistory.$inferSelect;
export type NewSubaccountTierHistory = typeof subaccountTierHistory.$inferInsert;

// ===========================================================================
// client_pulse_health_snapshots — Phase 2 derived scores (migration 0173)
// ===========================================================================

export type HealthTrend = 'improving' | 'stable' | 'declining';

export const clientPulseHealthSnapshots = pgTable(
  'client_pulse_health_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    accountId: uuid('account_id'),
    score: integer('score').notNull(),
    factorBreakdown: jsonb('factor_breakdown').notNull().default([]).$type<Array<{ factor: string; score: number; weight: number }>>(),
    trend: text('trend').notNull().default('stable').$type<HealthTrend>(),
    confidence: doublePrecision('confidence').notNull().default(0),
    configVersion: text('config_version'),
    algorithmVersion: text('algorithm_version'),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subObservedIdx: index('client_pulse_health_snapshots_sub_observed_idx').on(
      table.subaccountId,
      table.observedAt,
    ),
    orgObservedIdx: index('client_pulse_health_snapshots_org_observed_idx').on(
      table.organisationId,
      table.observedAt,
    ),
  }),
);

export type ClientPulseHealthSnapshot = typeof clientPulseHealthSnapshots.$inferSelect;
export type NewClientPulseHealthSnapshot = typeof clientPulseHealthSnapshots.$inferInsert;

// ===========================================================================
// client_pulse_churn_assessments — Phase 3 derived risk scores (migration 0174)
// ===========================================================================

export type ChurnBand = 'healthy' | 'watch' | 'atRisk' | 'critical';

export const clientPulseChurnAssessments = pgTable(
  'client_pulse_churn_assessments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    accountId: uuid('account_id'),
    riskScore: integer('risk_score').notNull(),
    band: text('band').notNull().$type<ChurnBand>(),
    drivers: jsonb('drivers').notNull().default([]).$type<Array<{ signal: string; contribution: number }>>(),
    interventionType: text('intervention_type'),
    configVersion: text('config_version'),
    algorithmVersion: text('algorithm_version'),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subObservedIdx: index('client_pulse_churn_assessments_sub_observed_idx').on(
      table.subaccountId,
      table.observedAt,
    ),
    orgBandIdx: index('client_pulse_churn_assessments_org_band_idx').on(
      table.organisationId,
      table.band,
      table.observedAt,
    ),
  }),
);

export type ClientPulseChurnAssessment = typeof clientPulseChurnAssessments.$inferSelect;
export type NewClientPulseChurnAssessment = typeof clientPulseChurnAssessments.$inferInsert;
