import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';

export const subaccountAgents = pgTable(
  'subaccount_agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    isActive: boolean('is_active').notNull().default(true),

    // ── Hierarchy ──────────────────────────────────────────────────────
    parentSubaccountAgentId: uuid('parent_subaccount_agent_id'),
    agentRole: text('agent_role'),
    agentTitle: text('agent_title'),

    // ── Applied template tracking ──────────────────────────────────────
    appliedTemplateId: uuid('applied_template_id'),
    appliedTemplateVersion: integer('applied_template_version'),

    // ── Scheduling ──────────────────────────────────────────────────────
    scheduleCron: text('schedule_cron'), // e.g. "0 */2 * * *"
    scheduleEnabled: boolean('schedule_enabled').notNull().default(false),
    scheduleTimezone: text('schedule_timezone').notNull().default('UTC'),

    // ── Concurrency policies ──────────────────────────────────────────
    concurrencyPolicy: text('concurrency_policy').notNull().default('skip_if_active').$type<'skip_if_active' | 'coalesce_if_active' | 'always_enqueue'>(),
    catchUpPolicy: text('catch_up_policy').notNull().default('skip_missed').$type<'skip_missed' | 'enqueue_missed_with_cap'>(),
    catchUpCap: integer('catch_up_cap').notNull().default(3),
    maxConcurrentRuns: integer('max_concurrent_runs').notNull().default(1),

    // ── Heartbeat (inherited from org agent, overridable per subaccount) ─
    heartbeatEnabled: boolean('heartbeat_enabled').notNull().default(false),
    heartbeatIntervalHours: integer('heartbeat_interval_hours'),
    heartbeatOffsetHours: integer('heartbeat_offset_hours').notNull().default(0),
    heartbeatOffsetMinutes: integer('heartbeat_offset_minutes').notNull().default(0),

    // ── Execution limits ────────────────────────────────────────────────
    tokenBudgetPerRun: integer('token_budget_per_run').notNull().default(30000),
    maxToolCallsPerRun: integer('max_tool_calls_per_run').notNull().default(20),
    timeoutSeconds: integer('timeout_seconds').notNull().default(300),

    // ── Skills configuration ────────────────────────────────────────────
    // Array of skill slugs this agent can use in this subaccount
    skillSlugs: jsonb('skill_slugs').$type<string[]>(),

    // ── Tool restriction ────────────────────────────────────────────────
    // If set, only these tools are allowed. Null = all tools available.
    allowedSkillSlugs: jsonb('allowed_skill_slugs').$type<string[]>(),

    // ── Subaccount-specific prompt additions ─────────────────────────────
    customInstructions: text('custom_instructions'),

    // ── Cost caps ───────────────────────────────────────────────────────
    maxCostPerRunCents: integer('max_cost_per_run_cents'),
    maxLlmCallsPerRun: integer('max_llm_calls_per_run'),

    // ── Safety mode default (F10) ───────────────────────────────────────────
    // Agency-configured default safety posture for portal-initiated runs on
    // this (agent, subaccount) pair. Resolution order: parentRun → request →
    // this column → agents.default_safety_mode → 'explore' literal.
    portalDefaultSafetyMode: text('portal_default_safety_mode').notNull().default('explore').$type<'explore' | 'execute'>(),

    // ── Meaningful-run tracking (F22) ───────────────────────────────────────
    // Updated by the run-completion hook when a run produces meaningful output
    // (status='completed' AND (action proposed OR memory block written)).
    // Used by heartbeat gate Rules 2 + 4.
    lastMeaningfulTickAt: timestamp('last_meaningful_tick_at', { withTimezone: true }),
    ticksSinceLastMeaningfulRun: integer('ticks_since_last_meaningful_run').notNull().default(0),

    // ── Run tracking ────────────────────────────────────────────────────
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),

    // ── Content fingerprint (Reporting Agent dedup, T4/T10) ──────────────
    // Map of intent → fingerprint of last successfully processed content.
    // Shape: { 'download_latest': { sourceUrl, pageTitle, publishedAt?,
    //   contentHash, processedAt, agentRunId } }
    // Persisted ONLY after download + validation + transcribe + report all
    // succeed (T16). Spec v3.4 §6.7.2.
    lastProcessedFingerprintsByIntent: jsonb('last_processed_fingerprints_by_intent')
      .notNull()
      .default({})
      .$type<Record<string, {
        sourceUrl: string;
        pageTitle?: string;
        publishedAt?: string;
        contentHash: string;
        processedAt: string;
        agentRunId: string;
      }>>(),

    // ── Capability map (Orchestrator routing spec §4.3) ──────────────────
    // Derived snapshot of what this linked agent can do, computed from its
    // skill set crossed with the Integration Reference. Consumed by
    // check_capability_gap for Path A matching. NULL = not yet computed;
    // the gap check treats null as zero-capability so Path A cannot fire
    // against uncomputed maps.
    capabilityMap: jsonb('capability_map').$type<{
      computedAt: string;
      referenceLastUpdated?: string;
      integrations: string[];
      read_capabilities: string[];
      write_capabilities: string[];
      skills: string[];
      primitives: string[];
    } | null>(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('subaccount_agents_org_idx').on(table.organisationId),
    subaccountIdx: index('subaccount_agents_subaccount_idx').on(table.subaccountId),
    agentIdx: index('subaccount_agents_agent_idx').on(table.agentId),
    uniqueIdx: uniqueIndex('subaccount_agents_unique_idx').on(table.subaccountId, table.agentId),
    scheduleIdx: index('subaccount_agents_schedule_idx').on(table.scheduleEnabled),
    oneRootPerSubaccount: uniqueIndex('subaccount_agents_one_root_per_subaccount')
      .on(table.subaccountId)
      .where(sql`${table.parentSubaccountAgentId} IS NULL AND ${table.isActive} = true`),
  })
);

export type SubaccountAgent = typeof subaccountAgents.$inferSelect;
export type NewSubaccountAgent = typeof subaccountAgents.$inferInsert;
