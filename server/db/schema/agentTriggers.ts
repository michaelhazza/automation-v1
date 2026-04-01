import { pgTable, uuid, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { subaccountAgents } from './subaccountAgents';

// ---------------------------------------------------------------------------
// Agent Triggers — fire agent runs in response to workspace events
// ---------------------------------------------------------------------------

export const agentTriggers = pgTable(
  'agent_triggers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    subaccountAgentId: uuid('subaccount_agent_id')
      .notNull()
      .references(() => subaccountAgents.id),

    eventType: text('event_type').notNull()
      .$type<'task_created' | 'task_moved' | 'agent_completed'>(),

    // Filter criteria — all keys must match event data for trigger to fire
    eventFilter: jsonb('event_filter').default('{}'),

    // Seconds between successive fires of this trigger
    cooldownSeconds: integer('cooldown_seconds').notNull().default(60),

    isActive: boolean('is_active').default(true),

    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
    triggerCount: integer('trigger_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    subaccountIdx: index('agent_triggers_subaccount_idx').on(table.subaccountId),
    orgIdx: index('agent_triggers_org_idx').on(table.organisationId),
    // M-20: partial index — active triggers only (excludes soft-deleted)
    eventTypeIdx: index('agent_triggers_event_type_idx').on(table.subaccountId, table.eventType).where(sql`${table.deletedAt} IS NULL`),
  })
);

export type AgentTrigger = typeof agentTriggers.$inferSelect;
export type NewAgentTrigger = typeof agentTriggers.$inferInsert;
