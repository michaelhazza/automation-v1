import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { systemHierarchyTemplates } from './systemHierarchyTemplates';

export const organisations = pgTable(
  'organisations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    plan: text('plan').notNull().$type<'starter' | 'pro' | 'agency'>(),
    status: text('status').notNull().default('active').$type<'active' | 'suspended'>(),
    settings: jsonb('settings'),
    orgExecutionEnabled: boolean('org_execution_enabled').notNull().default(true),
    // ── Branding ──────────────────────────────────────────────────────
    logoUrl: text('logo_url'),
    brandColor: text('brand_color'), // hex colour e.g. '#6366f1'
    // ── Governance ────────────────────────────────────────────────────
    requireAgentApproval: boolean('require_agent_approval').notNull().default(false),
    // ── Pulse — Major-lane thresholds (migration 0160) ──────────────
    pulseMajorThreshold: jsonb('pulse_major_threshold')
      .$type<{ perActionMinor: number; perRunMinor: number }>(),
    defaultCurrencyCode: text('default_currency_code')
      .notNull()
      .default('AUD'),
    // ── Sprint 2 — P1.1 Layer 3 ────────────────────────────────────────
    // Per-org override for tool_call_security_events retention. NULL uses
    // DEFAULT_SECURITY_EVENT_RETENTION_DAYS from server/config/limits.ts.
    securityEventRetentionDays: integer('security_event_retention_days'),
    // ── Sprint 3 — P2.1 Sprint 3A ──────────────────────────────────────
    // Per-org override for agent-run retention (agent_runs +
    // agent_run_snapshots + agent_run_messages CASCADE). NULL uses
    // DEFAULT_RUN_RETENTION_DAYS from server/config/limits.ts (90d).
    // Consumed by the agent-run-cleanup cron in server/jobs/.
    runRetentionDays: integer('run_retention_days'),
    // ── Sprint 4 — P3.2 Portfolio Health ───────────────────────────────────
    // Caps how many bulk-mode playbook children can run in parallel against
    // GHL rate limits. NULL uses MAX_PARALLEL_STEPS_DEFAULT (8).
    ghlConcurrencyCap: integer('ghl_concurrency_cap').notNull().default(5),
    // ── Session 1 (migration 0180) — org-level operational config ─────
    // Single source of truth for runtime operational-config overrides. NULL
    // until the org's first explicit edit; effective config is
    // systemHierarchyTemplates.operationalDefaults deep-merged with this row
    // at read time. Written by configUpdateOrganisationService.
    operationalConfigOverride: jsonb('operational_config_override').$type<Record<string, unknown>>(),
    // Explicit FK to the adopted system template. Nullable — backfilled by
    // migration 0180 from the pre-existing implicit linkage via
    // hierarchy_templates.system_template_id.
    appliedSystemTemplateId: uuid('applied_system_template_id')
      .references(() => systemHierarchyTemplates.id, { onDelete: 'set null' }),
    // ── Session 1 (migration 0182) — onboarding wizard gate ────────────
    // NULL → wizard auto-opens on first sign-in. Set → wizard skipped.
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    // ── Universal Brief (migration 0193) ────────────────────────────────
    // User-facing label for the virtual COO agent. Default 'COO'.
    agentPersonaLabel: text('agent_persona_label').notNull().default('COO'),
    // Per-org toggles for clarifying + sparring skills (Phase 4).
    clarifyingEnabled: boolean('clarifying_enabled').notNull().default(true),
    sparringEnabled: boolean('sparring_enabled').notNull().default(true),
    // ── System org marker (migration 0223) ─────────────────────────────
    // True only for the seeded System Operations org. A partial unique index
    // in the migration enforces at-most-one. Non-sysadmin org-listing endpoints
    // filter rows where isSystemOrg = true so the org is invisible to tenants.
    isSystemOrg: boolean('is_system_org').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    nameUniqueIdx: uniqueIndex('organisations_name_unique_idx')
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    slugUniqueIdx: uniqueIndex('organisations_slug_unique_idx')
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    slugIdx: index('organisations_slug_idx').on(table.slug),
    statusIdx: index('organisations_status_idx').on(table.status),
    appliedSystemTemplateIdIdx: index('organisations_applied_system_template_id_idx')
      .on(table.appliedSystemTemplateId)
      .where(sql`${table.appliedSystemTemplateId} IS NOT NULL`),
  })
);

export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
