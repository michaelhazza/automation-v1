import { eq, and, desc, asc, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents, agentConversations, agentMessages } from '../db/schema/index.js';
import { isNull } from 'drizzle-orm';
import { agentService } from './agentService.js';
import {
  buildSystemPrompt,
  buildProcessTools,
  getOrgProcessesForTools,
  executeTriggerredProcess,
  type LLMMessage,
} from './llmService.js';
import { routeCall } from './llmRouter.js';
import { getPricing } from './pricingService.js';
import { env } from '../lib/env.js';
import { emitConversationUpdate } from '../websocket/emitters.js';

// ---------------------------------------------------------------------------
// Cost helpers — convert tokensIn/tokensOut → whole cents using pricingService.
// Falls back to 0 cost rather than throwing so a pricing miss never breaks chat.
// ---------------------------------------------------------------------------

async function computeCostCents(
  provider: string,
  modelId: string,
  tokensIn: number,
  tokensOut: number,
): Promise<number> {
  try {
    const pricing = await getPricing(provider, modelId);
    const costDollars =
      (tokensIn / 1000) * pricing.inputRate +
      (tokensOut / 1000) * pricing.outputRate;
    return Math.round(costDollars * 100);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Conversation CRUD
// ---------------------------------------------------------------------------

export const conversationService = {
  async listConversations(
    agentId: string,
    userId: string,
    organisationId: string,
    subaccountId?: string | null,
    options: {
      updatedAfter?: Date;
      order?: 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc';
      limit?: number;
    } = {},
  ) {
    // Verify agent
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
    if (!agent) throw { statusCode: 404, message: 'Agent not found' };

    const filters = [
      eq(agentConversations.agentId, agentId),
      eq(agentConversations.userId, userId),
    ];
    // M-8: filter by subaccountId when provided (new conversations always have it set)
    if (subaccountId) filters.push(eq(agentConversations.subaccountId, subaccountId));
    // Session 1 / spec §5.10 — optional filter for the Configuration Assistant
    // popup's 15-minute resume window.
    if (options.updatedAfter) filters.push(gte(agentConversations.updatedAt, options.updatedAfter));

    // Session 1 / spec §5.10 — optional ordering + limit. Default matches the
    // pre-Session-1 behaviour (updated_desc, no limit).
    const order = options.order ?? 'updated_desc';
    const orderByExpr =
      order === 'updated_desc' ? desc(agentConversations.updatedAt) :
      order === 'updated_asc' ? asc(agentConversations.updatedAt) :
      order === 'created_desc' ? desc(agentConversations.createdAt) :
      asc(agentConversations.createdAt);
    // Defence-in-depth cap matching spec §5.10 — 50.
    const limit = options.limit ? Math.min(Math.max(1, options.limit), 50) : undefined;

    let q = db.select().from(agentConversations).where(and(...filters)).orderBy(orderByExpr).$dynamic();
    if (limit !== undefined) q = q.limit(limit);

    const rows = await q;
    return rows;
  },

  async getConversation(
    conversationId: string,
    agentId: string,
    userId: string,
    organisationId: string
  ) {
    const [conv] = await db
      .select()
      .from(agentConversations)
      .where(and(
        eq(agentConversations.id, conversationId),
        eq(agentConversations.agentId, agentId),
        eq(agentConversations.userId, userId),
        eq(agentConversations.organisationId, organisationId),
      ));

    if (!conv) throw { statusCode: 404, message: 'Conversation not found' };

    const messages = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.conversationId, conversationId))
      .orderBy(asc(agentMessages.createdAt));

    return { ...conv, messages };
  },

  async createConversation(agentId: string, userId: string, organisationId: string, subaccountId?: string | null) {
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, organisationId), isNull(agents.deletedAt)));
    if (!agent) throw { statusCode: 404, message: 'Agent not found' };
    if (agent.status !== 'active') throw { statusCode: 400, message: 'Agent is not active' };

    const [conv] = await db
      .insert(agentConversations)
      .values({
        agentId,
        organisationId,
        userId,
        // M-8: set subaccountId for tenant isolation on all new conversations
        subaccountId: subaccountId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return conv;
  },

  async deleteConversation(
    conversationId: string,
    agentId: string,
    userId: string,
    organisationId: string
  ) {
    const [conv] = await db
      .select()
      .from(agentConversations)
      .where(and(
        eq(agentConversations.id, conversationId),
        eq(agentConversations.agentId, agentId),
        eq(agentConversations.userId, userId),
        eq(agentConversations.organisationId, organisationId),
      ));
    if (!conv) throw { statusCode: 404, message: 'Conversation not found' };

    // Cascades to messages via FK
    await db.delete(agentConversations).where(eq(agentConversations.id, conversationId));
    return { message: 'Conversation deleted' };
  },

  // ---------------------------------------------------------------------------
  // Core: Send a message and get a response
  // ---------------------------------------------------------------------------

  async sendMessage(params: {
    conversationId: string;
    agentId: string;
    userId: string;
    organisationId: string;
    content: string;
    attachments?: Array<{
      fileId: string;
      fileName: string;
      mimeType: string;
      fileSizeBytes: number;
      storagePath: string;
    }>;
  }) {
    const { conversationId, agentId, userId, organisationId, content, attachments } = params;

    // ── 1. Verify conversation and agent ──────────────────────────────────────
    const [conv] = await db
      .select()
      .from(agentConversations)
      .where(and(
        eq(agentConversations.id, conversationId),
        eq(agentConversations.agentId, agentId),
        eq(agentConversations.userId, userId),
        eq(agentConversations.organisationId, organisationId),
      ));
    if (!conv) throw { statusCode: 404, message: 'Conversation not found' };

    const agent = await agentService.getAgent(agentId, organisationId);
    if (agent.status !== 'active') throw { statusCode: 400, message: 'Agent is not active' };

    // ── 2. Save user message ──────────────────────────────────────────────────
    const [userMsg] = await db
      .insert(agentMessages)
      .values({
        conversationId,
        role: 'user',
        content,
        attachments: attachments ?? null,
        createdAt: new Date(),
      })
      .returning();

    // Auto-generate title from first user message
    if (!conv.title) {
      const title = content.length > 60 ? content.slice(0, 57) + '…' : content;
      await db.update(agentConversations)
        .set({ title, updatedAt: new Date() })
        .where(eq(agentConversations.id, conversationId));
    } else {
      await db.update(agentConversations)
        .set({ updatedAt: new Date() })
        .where(eq(agentConversations.id, conversationId));
    }

    // ── 3. Fetch data sources (with cache) ────────────────────────────────────
    const dataSourceContents = await agentService.fetchAgentDataSources(agentId);

    // ── 4. Get available processes for tool use ────────────────────────────────
    const orgProcesses = await getOrgProcessesForTools(organisationId);

    // ── 5. Build system prompt ────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(
      agent.masterPrompt,
      dataSourceContents,
      orgProcesses,
    );

    // ── 6. Build message history (last N messages) ────────────────────────────
    const maxContextMessages = env.AGENT_CONTEXT_MESSAGES;
    const historyRows = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.conversationId, conversationId))
      .orderBy(asc(agentMessages.createdAt));

    // Build LLM messages from history (exclude tool_result rows from raw history,
    // they will be re-inserted inline after their corresponding tool_use)
    const llmMessages: LLMMessage[] = [];
    const recentRows = historyRows.slice(-maxContextMessages);

    for (const row of recentRows) {
      if (row.role === 'user') {
        let msgContent = row.content ?? '';
        if (row.attachments && Array.isArray(row.attachments) && row.attachments.length > 0) {
          const fileList = (row.attachments as Array<{ fileName: string }>)
            .map((f) => f.fileName)
            .join(', ');
          msgContent = `[Attached files: ${fileList}]\n\n${msgContent}`;
        }
        llmMessages.push({ role: 'user', content: msgContent });
      } else if (row.role === 'assistant') {
        if (row.toolCalls && Array.isArray(row.toolCalls) && row.toolCalls.length > 0) {
          // Assistant message with tool calls
          const blocks: LLMMessage['content'] = [];
          if (row.content) blocks.push({ type: 'text', text: row.content });
          for (const tc of row.toolCalls as Array<{ id: string; name: string; input: Record<string, unknown> }>) {
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
          }
          llmMessages.push({ role: 'assistant', content: blocks });
        } else {
          llmMessages.push({ role: 'assistant', content: row.content ?? '' });
        }
      } else if (row.role === 'tool_result') {
        // Tool result must follow the assistant message that had tool_use
        const toolResult = {
          type: 'tool_result' as const,
          tool_use_id: row.toolCallId ?? '',
          content: typeof row.toolResultContent === 'string'
            ? row.toolResultContent
            : JSON.stringify(row.toolResultContent),
        };
        // Append to a user message wrapping tool results
        llmMessages.push({ role: 'user', content: [toolResult] });
      }
    }

    // ── 7. Build tools ────────────────────────────────────────────────────────
    const tools = buildProcessTools(orgProcesses);

    // ── 8. Call LLM ───────────────────────────────────────────────────────────
    emitConversationUpdate(conversationId, 'conversation:typing', { isTyping: true });

    let llmResponse = await routeCall({
      messages: llmMessages,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      context: {
        organisationId,
        userId,
        sourceType: 'system',
        systemCallerPolicy: 'bypass_routing',
        agentName: agent.name,
        taskType: 'general',
        provider: agent.modelProvider ?? 'anthropic',
        model: agent.modelId,
        routingMode: 'ceiling',
      },
    });

    // ── 9. Handle tool calls (agent-to-process chaining) ──────────────────────
    let triggeredExecutionId: string | undefined;

    if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
      // Save the assistant's tool-use message
      const [assistantToolMsg] = await db
        .insert(agentMessages)
          .values({
            conversationId,
            role: 'assistant',
            content: llmResponse.content || null,
            toolCalls: llmResponse.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: 'tool_use' as const,
              name: toolCall.name,
              input: toolCall.input,
            })),
            createdAt: new Date(),
          })
        .returning();

      emitConversationUpdate(conversationId, 'conversation:tool_use', {
        toolCalls: llmResponse.toolCalls!.map(tc => ({ name: tc.name })),
      });

      // Process each tool call
      const toolResults: Array<{ tool_use_id: string; content: string }> = [];

      for (const toolCall of llmResponse.toolCalls) {
        if (toolCall.name === 'trigger_process') {
          const input = toolCall.input as {
            process_id: string;
            process_name: string;
            input_data: string;
            reason: string;
          };

          let resultContent: string;
          try {
            const execResult = await executeTriggerredProcess(
              organisationId,
              input.process_id,
              userId,
              input.input_data
            );
            triggeredExecutionId = execResult.executionId;
            resultContent = JSON.stringify({
              success: true,
              executionId: execResult.executionId,
              processName: execResult.processName,
              status: execResult.status,
              message: `Process "${execResult.processName}" has been queued. Execution ID: ${execResult.executionId}`,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            resultContent = JSON.stringify({ success: false, error: errMsg });
          }

          toolResults.push({ tool_use_id: toolCall.id, content: resultContent });

          // Persist tool result message
          await db.insert(agentMessages).values({
            conversationId,
            role: 'tool_result',
            toolCallId: toolCall.id,
            toolResultContent: JSON.parse(resultContent),
            triggeredExecutionId: triggeredExecutionId ?? null,
            createdAt: new Date(),
          });
        }
      }

      // Continue conversation with tool results
      const continuationMessages: LLMMessage[] = [
        ...llmMessages,
        {
          role: 'assistant',
          content: [
            ...(llmResponse.content ? [{ type: 'text' as const, text: llmResponse.content }] : []),
            ...llmResponse.toolCalls.map((tc) => ({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })),
          ],
        },
        {
          role: 'user',
          content: toolResults.map((tr) => ({
            type: 'tool_result' as const,
            tool_use_id: tr.tool_use_id,
            content: tr.content,
          })),
        },
      ];

      // Get the final response after tool use
      llmResponse = await routeCall({
        messages: continuationMessages,
        system: systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        context: {
          organisationId,
          userId,
          sourceType: 'system',
          systemCallerPolicy: 'bypass_routing',
          agentName: agent.name,
          taskType: 'process_trigger',
          provider: agent.modelProvider ?? 'anthropic',
          model: agent.modelId,
          routingMode: 'ceiling',
        },
      });

      const finalCostCents = await computeCostCents(
        agent.modelProvider ?? 'anthropic',
        agent.modelId,
        llmResponse.tokensIn,
        llmResponse.tokensOut,
      );

      // Save final assistant response
      const [finalMsg] = await db
        .insert(agentMessages)
        .values({
          conversationId,
          role: 'assistant',
          content: llmResponse.content,
          triggeredExecutionId: triggeredExecutionId ?? null,
          costCents: finalCostCents,
          tokensIn: llmResponse.tokensIn,
          tokensOut: llmResponse.tokensOut,
          modelId: agent.modelId,
          createdAt: new Date(),
        })
        .returning();

      emitConversationUpdate(conversationId, 'conversation:message', {
        message: { id: finalMsg.id, role: 'assistant', content: llmResponse.content, createdAt: finalMsg.createdAt },
        triggeredExecutionId: triggeredExecutionId ?? null,
      });

      return {
        userMessageId: userMsg.id,
        assistantMessageId: finalMsg.id,
        content: llmResponse.content,
        triggeredExecutionId: triggeredExecutionId ?? null,
      };
    }

    // ── 10. Save regular assistant response ───────────────────────────────────
    const regularCostCents = await computeCostCents(
      agent.modelProvider ?? 'anthropic',
      agent.modelId,
      llmResponse.tokensIn,
      llmResponse.tokensOut,
    );

    const [assistantMsg] = await db
      .insert(agentMessages)
      .values({
        conversationId,
        role: 'assistant',
        content: llmResponse.content,
        costCents: regularCostCents,
        tokensIn: llmResponse.tokensIn,
        tokensOut: llmResponse.tokensOut,
        modelId: agent.modelId,
        createdAt: new Date(),
      })
      .returning();

    emitConversationUpdate(conversationId, 'conversation:message', {
      message: { id: assistantMsg.id, role: 'assistant', content: llmResponse.content, createdAt: assistantMsg.createdAt },
      triggeredExecutionId: null,
    });

    return {
      userMessageId: userMsg.id,
      assistantMessageId: assistantMsg.id,
      content: llmResponse.content,
      triggeredExecutionId: null,
    };
  },
};
