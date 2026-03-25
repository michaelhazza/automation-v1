import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
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

    // ── Scheduling ──────────────────────────────────────────────────────
    scheduleCron: text('schedule_cron'), // e.g. "0 */2 * * *"
    scheduleEnabled: boolean('schedule_enabled').notNull().default(false),
    scheduleTimezone: text('schedule_timezone').notNull().default('UTC'),

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

    // ── Run tracking ────────────────────────────────────────────────────
    lastRunAt: timestamp('last_run_at'),
    nextRunAt: timestamp('next_run_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('subaccount_agents_org_idx').on(table.organisationId),
    subaccountIdx: index('subaccount_agents_subaccount_idx').on(table.subaccountId),
    agentIdx: index('subaccount_agents_agent_idx').on(table.agentId),
    uniqueIdx: uniqueIndex('subaccount_agents_unique_idx').on(table.subaccountId, table.agentId),
    scheduleIdx: index('subaccount_agents_schedule_idx').on(table.scheduleEnabled),
  })
);

export type SubaccountAgent = typeof subaccountAgents.$inferSelect;
export type NewSubaccountAgent = typeof subaccountAgents.$inferInsert;
