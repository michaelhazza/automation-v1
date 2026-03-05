import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { agentConversations } from './agentConversations';

export const agentMessages = pgTable(
  'agent_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => agentConversations.id, { onDelete: 'cascade' }),
    // 'user' | 'assistant' | 'tool_result'
    role: text('role').notNull().$type<'user' | 'assistant' | 'tool_result'>(),
    // Main text content
    content: text('content'),
    // For assistant messages that made tool calls (trigger_task)
    toolCalls: jsonb('tool_calls').$type<Array<{
      id: string;
      type: 'tool_use';
      name: string;
      input: Record<string, unknown>;
    }>>(),
    // For tool_result messages
    toolCallId: text('tool_call_id'),
    toolResultContent: jsonb('tool_result_content'),
    // Execution created if a task was triggered
    triggeredExecutionId: uuid('triggered_execution_id'),
    // File attachments from user uploads
    attachments: jsonb('attachments').$type<Array<{
      fileId: string;
      fileName: string;
      mimeType: string;
      fileSizeBytes: number;
      storagePath: string;
    }>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    convIdx: index('agent_messages_conv_idx').on(table.conversationId),
    convCreatedIdx: index('agent_messages_conv_created_idx').on(table.conversationId, table.createdAt),
  })
);

export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;
