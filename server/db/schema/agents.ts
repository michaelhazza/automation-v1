import { pgTable, uuid, text, integer, real, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { agentTemplates } from './agentTemplates';

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    // Optional link to the template this agent was created from
    sourceTemplateId: uuid('source_template_id')
      .references(() => agentTemplates.id),
    sourceTemplateVersion: integer('source_template_version'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    // The system instruction / persona that defines this AI employee
    masterPrompt: text('master_prompt').notNull().default(''),
    // LLM configuration
    modelProvider: text('model_provider').notNull().default('anthropic'),
    modelId: text('model_id').notNull().default('claude-sonnet-4-6'),
    temperature: real('temperature').notNull().default(0.7),
    maxTokens: integer('max_tokens').notNull().default(4096),
    // Lifecycle
    status: text('status').notNull().default('draft').$type<'draft' | 'active' | 'inactive'>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgIdx: index('agents_org_idx').on(table.organisationId),
    orgStatusIdx: index('agents_org_status_idx').on(table.organisationId, table.status),
    orgSlugUniq: uniqueIndex('agents_org_slug_uniq').on(table.organisationId, table.slug).where(table.deletedAt === null),
  })
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
