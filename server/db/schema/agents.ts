import { pgTable, uuid, text, integer, boolean, real, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { systemAgents } from './systemAgents';
import { workspaceActors } from './workspaceActors';

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    // Legacy template fields (columns still in DB, no longer used)
    sourceTemplateId: uuid('source_template_id'),
    sourceTemplateVersion: integer('source_template_version'),
    // Living link to system agent — inherits system prompt + system skills at runtime
    systemAgentId: uuid('system_agent_id')
      .references(() => systemAgents.id),
    // True if created from a system agent (limits what org admin can edit)
    isSystemManaged: boolean('is_system_managed').notNull().default(false),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    // Display icon/emoji for the agent card UI
    icon: text('icon'),

    // ── Hierarchy ──────────────────────────────────────────────────────
    parentAgentId: uuid('parent_agent_id'),
    agentRole: text('agent_role'),
    agentTitle: text('agent_title'),
    // For org-created agents: the full system prompt
    // For system-managed agents: the org's additional prompt layered on top
    masterPrompt: text('master_prompt').notNull().default(''),
    // Org-level additional prompt (appended to system prompt at runtime for system-managed agents)
    additionalPrompt: text('additional_prompt').notNull().default(''),
    // LLM configuration
    modelProvider: text('model_provider').notNull().default('anthropic'),
    modelId: text('model_id').notNull().default('claude-sonnet-4-6'),
    temperature: real('temperature').notNull().default(0.7),
    maxTokens: integer('max_tokens').notNull().default(4096),
    // High-level LLM presets (map to temperature / maxTokens at call time)
    responseMode: text('response_mode').notNull().default('balanced').$type<'balanced' | 'precise' | 'expressive' | 'highly_creative'>(),
    outputSize: text('output_size').notNull().default('standard').$type<'standard' | 'extended' | 'maximum'>(),
    // Whether per-subaccount model overrides are allowed
    allowModelOverride: boolean('allow_model_override').notNull().default(true),
    // Default skills assigned to this agent (copied to subaccountAgents on link)
    defaultSkillSlugs: jsonb('default_skill_slugs').$type<string[]>(),
    // Lifecycle
    // Heartbeat — automatic scheduled runs
    heartbeatEnabled: boolean('heartbeat_enabled').notNull().default(false),
    heartbeatIntervalHours: integer('heartbeat_interval_hours'),
    heartbeatOffsetHours: integer('heartbeat_offset_hours').notNull().default(0),
    heartbeatOffsetMinutes: integer('heartbeat_offset_minutes').notNull().default(0),
    // Concurrency policies (defaults inherited by subaccount agents on link)
    concurrencyPolicy: text('concurrency_policy').notNull().default('skip_if_active').$type<'skip_if_active' | 'coalesce_if_active' | 'always_enqueue'>(),
    catchUpPolicy: text('catch_up_policy').notNull().default('skip_missed').$type<'skip_missed' | 'enqueue_missed_with_cap'>(),
    catchUpCap: integer('catch_up_cap').notNull().default(3),
    maxConcurrentRuns: integer('max_concurrent_runs').notNull().default(1),
    // Lifecycle
    status: text('status').notNull().default('draft').$type<'draft' | 'active' | 'inactive'>(),
    // Sprint 2 P1.2 — per-agent override for the regression suite ring
    // buffer. NULL → use DEFAULT_REGRESSION_CASE_CAP from limits.ts.
    regressionCaseCap: integer('regression_case_cap'),
    // Sprint 5 P4.3 — explicit opt-in for plan-then-execute mode.
    // NULL = auto-detect from heuristics; 'complex' = always plan first;
    // 'simple' = never plan (even if heuristics trigger).
    complexityHint: text('complexity_hint').$type<'simple' | 'complex'>(),
    workspaceActorId: uuid('workspace_actor_id').references(() => workspaceActors.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('agents_org_idx').on(table.organisationId),
    orgStatusIdx: index('agents_org_status_idx').on(table.organisationId, table.status),
    orgSlugUniq: uniqueIndex('agents_org_slug_uniq')
      .on(table.organisationId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
