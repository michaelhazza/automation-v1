import { pgTable, uuid, text, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { agentRuns } from './agentRuns';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Agent Run Prompts — fully-assembled system + user prompt per assembly.
// Migration 0192. Spec: tasks/live-agent-execution-log-spec.md §5.6.
//
// `(run_id, assembly_number)` is the natural drilldown key; the surrogate
// UUID `id` exists so `agent_execution_events.linked_entity_id` can target
// this table like every other entity.
// ---------------------------------------------------------------------------

export const agentRunPrompts = pgTable(
  'agent_run_prompts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    assemblyNumber: integer('assembly_number').notNull(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    assembledAt: timestamp('assembled_at', { withTimezone: true }).defaultNow().notNull(),

    systemPrompt: text('system_prompt').notNull(),
    userPrompt: text('user_prompt').notNull(),

    // Array of { name, description, input_schema } — the exact tool
    // definitions handed to the adapter at this assembly.
    toolDefinitions: jsonb('tool_definitions').notNull().$type<unknown[]>(),

    // { master: { startOffset, length }, orgAdditional: {...},
    //   memoryBlocks: [ { blockId, startOffset, length } ], ... }
    // Enables the UI's "click a block of the prompt to see which layer
    // contributed it" click-through. See spec §5.6.
    layerAttributions: jsonb('layer_attributions').notNull().$type<Record<string, unknown>>(),

    totalTokens: integer('total_tokens').notNull(),
  },
  (table) => ({
    runAssemblyUnique: uniqueIndex('agent_run_prompts_run_assembly_idx').on(
      table.runId,
      table.assemblyNumber,
    ),
    orgAssembledIdx: index('agent_run_prompts_org_assembled_idx').on(
      table.organisationId,
      table.assembledAt,
    ),
  }),
);

export type AgentRunPromptRow = typeof agentRunPrompts.$inferSelect;
export type NewAgentRunPromptRow = typeof agentRunPrompts.$inferInsert;
