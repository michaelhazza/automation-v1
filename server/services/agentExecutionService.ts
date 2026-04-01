import { eq, and, desc, isNull, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  agents,
  subaccountAgents,
  agentRuns,
  agentRunSnapshots,
  tasks,
  taskActivities,
  taskDeliverables,
} from '../db/schema/index.js';
import { agentService } from './agentService.js';
import { devContextService } from './devContextService.js';
import { skillService } from './skillService.js';
import { systemSkillService } from './systemSkillService.js';
import { systemAgents } from '../db/schema/index.js';
import { taskService } from './taskService.js';
import {
  buildSystemPrompt,
  getOrgProcessesForTools,
  approxTokens,
  type LLMMessage,
  type AnthropicTool,
} from './llmService.js';
import { routeCall } from './llmRouter.js';
import type { LLMCallContext } from './llmRouter.js';
import { skillExecutor } from './skillExecutor.js';
import { workspaceMemoryService } from './workspaceMemoryService.js';
import { triggerService } from './triggerService.js';
import {
  createDefaultPipeline,
  hashToolCall,
  executeWithRetry,
  checkWorkspaceLimits,
  type MiddlewareContext,
  type MiddlewarePipeline,
} from './middleware/index.js';
import {
  MAX_LOOP_ITERATIONS,
  WRAP_UP_MAX_TOKENS,
  TOKEN_INPUT_RATIO,
  TOKEN_OUTPUT_RATIO,
  MAX_CROSS_AGENT_TASKS,
  MAX_TOOL_OUTPUT_LOG_LENGTH,
} from '../config/limits.js';
import { emitAgentRunUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';
import { langfuse, withTrace } from '../instrumentation.js';

// ---------------------------------------------------------------------------
// Agent trace throttle — batches iteration/tool_call events to max 2/sec
// ---------------------------------------------------------------------------

const TRACE_THROTTLE_MS = 500;

class TraceThrottle {
  private pending: Record<string, unknown> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEmit = 0;

  constructor(private runId: string) {}

  emit(event: string, data: Record<string, unknown>): void {
    this.pending = { event, data };
    const now = Date.now();
    const elapsed = now - this.lastEmit;

    if (elapsed >= TRACE_THROTTLE_MS) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), TRACE_THROTTLE_MS - elapsed);
    }
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending) return;
    const { event, data } = this.pending as { event: string; data: Record<string, unknown> };
    this.pending = null;
    this.lastEmit = Date.now();
    emitAgentRunUpdate(this.runId, event, data);
  }

  destroy(): void {
    this.flush(); // emit any pending event before cleanup
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentRunRequest {
  agentId: string;
  subaccountId: string;
  subaccountAgentId: string;
  organisationId: string;
  runType: 'scheduled' | 'manual' | 'triggered';
  executionMode?: 'api' | 'headless';
  taskId?: string;
  triggerContext?: Record<string, unknown>;
  handoffDepth?: number;
  parentRunId?: string;
  isSubAgent?: boolean;
  parentSpawnRunId?: string;
}

export interface AgentRunResult {
  runId: string;
  status: 'completed' | 'failed' | 'timeout' | 'loop_detected' | 'budget_exceeded';
  summary: string | null;
  totalToolCalls: number;
  totalTokens: number;
  durationMs: number;
  tasksCreated: number;
  tasksUpdated: number;
  deliverablesCreated: number;
}

/** Task with its joined agent relation resolved */
interface TaskWithAgent {
  id: string;
  title: string;
  description: string | null;
  brief: string | null;
  status: string;
  priority: string;
  assignedAgentId: string | null;
  assignedAgent: { id: string; name: string | null; slug: string | null } | null;
  createdAt: Date;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Execution service
// ---------------------------------------------------------------------------

export const agentExecutionService = {
  /**
   * Execute a single agent run. This is the main entry point for autonomous execution.
   */
  async executeRun(request: AgentRunRequest): Promise<AgentRunResult> {
    const startTime = Date.now();

    // ── 1. Create the run record ──────────────────────────────────────────
    const [run] = await db
      .insert(agentRuns)
      .values({
        organisationId: request.organisationId,
        subaccountId: request.subaccountId,
        agentId: request.agentId,
        subaccountAgentId: request.subaccountAgentId,
        runType: request.runType,
        executionMode: request.executionMode ?? 'api',
        status: 'running',
        triggerContext: request.triggerContext ?? null,
        taskId: request.taskId ?? null,
        handoffDepth: request.handoffDepth ?? 0,
        parentRunId: request.parentRunId ?? null,
        isSubAgent: request.isSubAgent ?? false,
        parentSpawnRunId: request.parentSpawnRunId ?? null,
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Emit run started event
    emitAgentRunUpdate(run.id, 'agent:run:started', {
      agentId: request.agentId, subaccountId: request.subaccountId,
      runType: request.runType, status: 'running',
    });
    emitSubaccountUpdate(request.subaccountId, 'live:agent_started', {
      runId: run.id, agentId: request.agentId,
    });

    try {
      // ── 2. Load agent config ────────────────────────────────────────────
      const agent = await agentService.getAgent(request.agentId, request.organisationId);

      const [saLink] = await db
        .select()
        .from(subaccountAgents)
        .where(eq(subaccountAgents.id, request.subaccountAgentId));

      if (!saLink) throw new Error('Subaccount agent link not found');

      const tokenBudget = saLink.tokenBudgetPerRun;
      const maxToolCalls = saLink.maxToolCallsPerRun;
      const timeoutMs = saLink.timeoutSeconds * 1000;

      await db.update(agentRuns).set({ tokenBudget }).where(eq(agentRuns.id, run.id));

      // ── 2b. Workspace limit check (pre-run guard) ─────────────────────
      const limitCheck = await checkWorkspaceLimits(request.subaccountId, tokenBudget);
      if (!limitCheck.allowed) {
        const durationMs = Date.now() - startTime;
        await db.update(agentRuns).set({
          status: 'failed',
          errorMessage: limitCheck.reason ?? 'Workspace limit exceeded',
          errorDetail: {
            type: 'workspace_limit',
            dailyUsed: limitCheck.dailyUsed,
            dailyLimit: limitCheck.dailyLimit,
            requestedBudget: tokenBudget,
          },
          completedAt: new Date(),
          durationMs,
          updatedAt: new Date(),
        }).where(eq(agentRuns.id, run.id));

        return {
          runId: run.id,
          status: 'failed',
          summary: null,
          totalToolCalls: 0,
          totalTokens: 0,
          durationMs,
          tasksCreated: 0,
          tasksUpdated: 0,
          deliverablesCreated: 0,
        };
      }

      // ── 2c. Snapshot DEC hash + iteration count into triggerContext ──
      try {
        const { hash: decHash } = await devContextService.getContext(request.subaccountId);

        // Count prior runs for this task to determine current iteration
        let iteration = 0;
        if (request.taskId) {
          const [{ total }] = await db
            .select({ total: count() })
            .from(agentRuns)
            .where(and(
              eq(agentRuns.taskId, request.taskId),
              eq(agentRuns.subaccountId, request.subaccountId),
            ));
          // Subtract 1 because current run is already inserted
          iteration = Math.max(0, Number(total) - 1);
        }

        const existingCtx = (request.triggerContext ?? {}) as Record<string, unknown>;
        await db.update(agentRuns).set({
          triggerContext: {
            ...existingCtx,
            executionSnapshot: {
              decHash,
              iteration,
              snapshotAt: new Date().toISOString(),
            },
          },
          updatedAt: new Date(),
        }).where(eq(agentRuns.id, run.id));
      } catch {
        // DEC not configured for this subaccount — skip snapshot (non-dev agents)
      }

      // ── 3. Load training data ───────────────────────────────────────────
      const dataSourceContents = await agentService.fetchAgentDataSources(request.agentId);

      // ── 4. Load org processes for trigger_process skill ─────────────────
      const orgProcesses = await getOrgProcessesForTools(request.organisationId);

      // ── 5. Resolve skills → tools + instructions (3-layer) ─────────────
      // Layer 1: System skills (from system agent, if linked)
      let systemSkillTools: AnthropicTool[] = [];
      let systemSkillInstructions: string[] = [];
      let systemAgentRecord: typeof systemAgents.$inferSelect | null = null;

      if (agent.systemAgentId) {
        const [sa] = await db.select().from(systemAgents).where(eq(systemAgents.id, agent.systemAgentId));
        if (sa) {
          systemAgentRecord = sa;
          const systemSlugs = (sa.defaultSystemSkillSlugs ?? []) as string[];
          const resolved = await systemSkillService.resolveSystemSkills(systemSlugs);
          systemSkillTools = resolved.tools;
          systemSkillInstructions = resolved.instructions;
        }
      }

      // Layer 2+3: Org skills + sub-account skills
      const skillSlugs = (saLink.skillSlugs ?? []) as string[];
      const { tools: skillTools, instructions: skillInstructions } = await skillService.resolveSkillsForAgent(
        skillSlugs,
        request.organisationId
      );

      // For trigger_process, inject the process enum dynamically
      const allSkillTools = [...systemSkillTools, ...skillTools];
      const enhancedTools = allSkillTools.map(tool => {
        if (tool.name === 'trigger_process' && orgProcesses.length > 0) {
          return {
            ...tool,
            input_schema: {
              ...tool.input_schema,
              properties: {
                ...tool.input_schema.properties,
                process_id: {
                  ...tool.input_schema.properties.process_id,
                  enum: orgProcesses.map(t => t.id),
                },
              },
            },
          };
        }
        return tool;
      });

      // ── 6. Build task context (with smart offloading) ───────────────────
      let workspaceContext = '';
      let targetItem: typeof tasks.$inferSelect | null = null;

      if (request.taskId) {
        const item = await taskService.getTask(request.taskId, request.organisationId);
        targetItem = item;
        workspaceContext = buildTaskContext(item);
      } else {
        workspaceContext = await buildSmartBoardContext(
          request.organisationId,
          request.subaccountId,
          request.agentId
        );
      }

      // ── 7. Build the full system prompt (3-layer assembly) ─────────────
      // Layer 1: System agent prompt (our IP — invisible to org/sub-account)
      const effectiveMasterPrompt = systemAgentRecord
        ? systemAgentRecord.masterPrompt
        : agent.masterPrompt;

      const basePrompt = buildSystemPrompt(
        effectiveMasterPrompt,
        dataSourceContents,
        orgProcesses,
      );

      const systemPromptParts = [basePrompt];

      // Layer 1b: System skill instructions
      if (systemSkillInstructions.length > 0) {
        systemPromptParts.push(`\n\n---\n## Core Capabilities\n${systemSkillInstructions.join('\n\n')}`);
      }

      // Layer 2: Org additional prompt (invisible to sub-account)
      if (agent.additionalPrompt) {
        systemPromptParts.push(`\n\n---\n## Organisation Instructions\n${agent.additionalPrompt}`);
      }

      // Layer 2b: Org skill instructions
      if (skillInstructions.length > 0) {
        systemPromptParts.push(`\n\n---\n## Your Capabilities\n${skillInstructions.join('\n\n')}`);
      }

      // Layer 3: Sub-account custom instructions
      if (saLink.customInstructions) {
        systemPromptParts.push(`\n\n---\n## Additional Instructions\n${saLink.customInstructions}`);
      }

      // Add team roster (loaded fresh from DB every run)
      const teamRoster = await buildTeamRoster(request.subaccountId, request.agentId);
      if (teamRoster) {
        systemPromptParts.push(`\n\n---\n## Your Team\nYou can reassign tasks to or create tasks for any of these agents:\n${teamRoster}`);
      }

      // Add workspace memory (with prompt injection boundaries)
      // Pass task context for semantic retrieval when available
      const taskContextForMemory = targetItem
        ? `${targetItem.title ?? ''}${targetItem.description ? ' ' + targetItem.description : ''}`
        : undefined;

      const memory = await workspaceMemoryService.getMemoryForPrompt(
        request.organisationId,
        request.subaccountId,
        taskContextForMemory
      );
      if (memory) {
        systemPromptParts.push(`\n\n---\n## Workspace Memory\n${memory}`);
      }

      // Add workspace entities
      const entities = await workspaceMemoryService.getEntitiesForPrompt(request.subaccountId);
      if (entities) {
        systemPromptParts.push(`\n\n---\n## Known Workspace Entities\n${entities}`);
      }

      if (workspaceContext) {
        systemPromptParts.push(`\n\n---\n## Current Board\n${workspaceContext}`);
      }

      systemPromptParts.push(buildAutonomousInstructions(request, targetItem));

      const fullSystemPrompt = systemPromptParts.join('');
      const systemPromptTokens = approxTokens(fullSystemPrompt);

      await db.update(agentRuns).set({
        memoryStateAtStart: memory ?? null,
        skillsUsed: [
          ...(systemAgentRecord ? ((systemAgentRecord.defaultSystemSkillSlugs ?? []) as string[]).map(s => `system:${s}`) : []),
          ...skillSlugs,
        ],
        systemPromptTokens,
      }).where(eq(agentRuns.id, run.id));

      // H-5: store large snapshot in agent_run_snapshots (keep agent_runs lean)
      await db.insert(agentRunSnapshots)
        .values({ runId: run.id, systemPromptSnapshot: fullSystemPrompt })
        .onConflictDoNothing();

      // ── 8. Execute the agentic loop with middleware pipeline ────────────
      const pipeline = createDefaultPipeline();

      const trace = langfuse.trace({
        name:      'agent-run',
        userId:    request.subaccountId,
        sessionId: run.id,
        metadata: {
          agentId:    request.agentId,
          runType:    request.runType,
          orgId:      request.organisationId,
        },
      });

      const loopResult = await withTrace(trace, () => runAgenticLoop({
        runId: run.id,
        agent,
        routerCtx: {
          organisationId:    request.organisationId,
          subaccountId:      request.subaccountId,
          runId:             run.id,
          subaccountAgentId: request.subaccountAgentId,
          agentName:         agent.name,
          sourceType:        'agent_run',
        },
        systemPrompt: fullSystemPrompt,
        tools: enhancedTools,
        tokenBudget,
        maxToolCalls,
        timeoutMs,
        startTime,
        request,
        orgProcesses,
        saLink,
        pipeline,
      }));

      // ── 9. Finalise the run ─────────────────────────────────────────────
      const durationMs = Date.now() - startTime;
      const finalStatus = (loopResult.finalStatus ?? 'completed') as 'completed' | 'failed' | 'timeout' | 'loop_detected' | 'budget_exceeded';

      await db.update(agentRuns).set({
        status: finalStatus,
        totalToolCalls: loopResult.totalToolCalls,
        inputTokens: loopResult.inputTokens,
        outputTokens: loopResult.outputTokens,
        totalTokens: loopResult.totalTokens,
        summary: loopResult.summary,
        tasksCreated: loopResult.tasksCreated,
        tasksUpdated: loopResult.tasksUpdated,
        deliverablesCreated: loopResult.deliverablesCreated,
        completedAt: new Date(),
        durationMs,
        updatedAt: new Date(),
      }).where(eq(agentRuns.id, run.id));

      // H-5: upsert toolCallsLog into the snapshot table
      await db.insert(agentRunSnapshots)
        .values({ runId: run.id, toolCallsLog: loopResult.toolCallsLog })
        .onConflictDoUpdate({
          target: agentRunSnapshots.runId,
          set: { toolCallsLog: loopResult.toolCallsLog },
        });

      await db.update(subaccountAgents).set({
        lastRunAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(subaccountAgents.id, request.subaccountAgentId));

      // Emit run completed event
      emitAgentRunUpdate(run.id, 'agent:run:completed', {
        status: finalStatus, summary: loopResult.summary,
        totalToolCalls: loopResult.totalToolCalls, totalTokens: loopResult.totalTokens,
        tasksCreated: loopResult.tasksCreated, durationMs,
      });
      emitSubaccountUpdate(request.subaccountId, 'live:agent_completed', {
        runId: run.id, agentId: request.agentId, status: finalStatus,
      });

      // ── 10. Extract insights for workspace memory + entities ─────────────
      if (loopResult.summary) {
        try {
          await workspaceMemoryService.extractRunInsights(
            run.id,
            request.agentId,
            request.organisationId,
            request.subaccountId,
            loopResult.summary
          );
        } catch (err) {
          console.error(`[AgentExecution] Memory extraction failed for run ${run.id}:`, err instanceof Error ? err.message : err);
        }

        // Entity extraction (non-blocking)
        workspaceMemoryService.extractEntities(
          run.id,
          request.organisationId,
          request.subaccountId,
          loopResult.summary
        ).catch(err => {
          console.error(`[AgentExecution] Entity extraction failed for run ${run.id}:`, err instanceof Error ? err.message : err);
        });
      }

      // ── 11. Fire agent_completed triggers (non-blocking) ─────────────────
      triggerService.checkAndFire(
        request.subaccountId,
        request.organisationId,
        'agent_completed',
        {
          runId: run.id,
          agentId: request.agentId,
          subaccountAgentId: request.subaccountAgentId,
          status: finalStatus,
        }
      ).catch((err: unknown) => {
        console.error('[AgentExecution] agent_completed trigger failed', {
          subaccountId: request.subaccountId,
          eventType: 'agent_completed',
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return {
        runId: run.id,
        status: finalStatus as AgentRunResult['status'],
        summary: loopResult.summary,
        totalToolCalls: loopResult.totalToolCalls,
        totalTokens: loopResult.totalTokens,
        durationMs,
        tasksCreated: loopResult.tasksCreated,
        tasksUpdated: loopResult.tasksUpdated,
        deliverablesCreated: loopResult.deliverablesCreated,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await db.update(agentRuns).set({
        status: 'failed',
        errorMessage,
        errorDetail: { error: errorMessage, stack: err instanceof Error ? err.stack : undefined },
        completedAt: new Date(),
        durationMs,
        updatedAt: new Date(),
      }).where(eq(agentRuns.id, run.id));

      // Emit run failed event
      emitAgentRunUpdate(run.id, 'agent:run:failed', {
        status: 'failed', errorMessage, durationMs,
      });
      emitSubaccountUpdate(request.subaccountId, 'live:agent_completed', {
        runId: run.id, agentId: request.agentId, status: 'failed',
      });

      return {
        runId: run.id,
        status: 'failed',
        summary: null,
        totalToolCalls: 0,
        totalTokens: 0,
        durationMs,
        tasksCreated: 0,
        tasksUpdated: 0,
        deliverablesCreated: 0,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// The agentic loop — calls LLM, handles tool calls, repeats until done
// ---------------------------------------------------------------------------

interface LoopParams {
  runId: string;
  agent: { modelId: string; modelProvider: string; temperature: number; maxTokens: number };
  routerCtx: Omit<LLMCallContext, 'taskType' | 'provider' | 'model'>;
  systemPrompt: string;
  tools: AnthropicTool[];
  tokenBudget: number;
  maxToolCalls: number;
  timeoutMs: number;
  startTime: number;
  request: AgentRunRequest;
  orgProcesses: Array<{ id: string; name: string; description: string | null; inputSchema: string | null }>;
  saLink: typeof subaccountAgents.$inferSelect;
  pipeline: MiddlewarePipeline;
}

interface LoopResult {
  summary: string | null;
  toolCallsLog: object[];
  totalToolCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tasksCreated: number;
  tasksUpdated: number;
  deliverablesCreated: number;
  finalStatus?: string;
}

async function runAgenticLoop(params: LoopParams): Promise<LoopResult> {
  const {
    runId, agent, routerCtx, systemPrompt, tools, tokenBudget,
    maxToolCalls, timeoutMs, startTime, request, orgProcesses,
    saLink, pipeline,
  } = params;

  const toolCallsLog: object[] = [];
  let totalToolCalls = 0;
  let totalTokensUsed = 0;
  let tasksCreated = 0;
  let tasksUpdated = 0;
  let deliverablesCreated = 0;
  let finalStatus: string | undefined;

  // Throttle trace events to prevent event floods (max 2/sec)
  const traceThrottle = new TraceThrottle(runId);

  const mwCtx: MiddlewareContext = {
    runId,
    request,
    agent,
    saLink,
    tokensUsed: 0,
    toolCallsCount: 0,
    toolCallHistory: [],
    iteration: 0,
    startTime,
    tokenBudget,
    maxToolCalls,
    timeoutMs,
  };

  const initialMessage = buildInitialMessage(request);
  const messages: LLMMessage[] = [{ role: 'user', content: initialMessage }];

  let lastTextContent = '';

  outerLoop:
  for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
    mwCtx.iteration = iteration;
    mwCtx.tokensUsed = totalTokensUsed;
    mwCtx.toolCallsCount = totalToolCalls;

    // ── Pre-call middleware ────────────────────────────────────────────
    for (const mw of pipeline.preCall) {
      const result = mw.execute(mwCtx);
      if (result.action === 'stop') {
        messages.push({ role: 'user', content: result.reason });
        const wrapUp = await routeCall({
          messages,
          system: systemPrompt,
          temperature: agent.temperature,
          maxTokens: Math.min(agent.maxTokens, WRAP_UP_MAX_TOKENS),
          context: { ...routerCtx, taskType: 'general', provider: agent.modelProvider, model: agent.modelId },
        });
        lastTextContent = wrapUp.content;
        totalTokensUsed += (wrapUp.tokensIn ?? 0) + (wrapUp.tokensOut ?? 0);
        finalStatus = result.status;
        break outerLoop;
      }
    }

    // Emit iteration event for live trace (throttled to max 2/sec)
    traceThrottle.emit('agent:run:iteration', {
      iteration, tokensUsed: totalTokensUsed, toolCallsCount: totalToolCalls,
    });

    // ── Call LLM ──────────────────────────────────────────────────────
    const response = await routeCall({
      messages,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      context: { ...routerCtx, taskType: 'development', provider: agent.modelProvider, model: agent.modelId },
    });

    totalTokensUsed += (response.tokensIn ?? 0) + (response.tokensOut ?? 0);

    lastTextContent = response.content;

    if (!response.toolCalls || response.toolCalls.length === 0) {
      break;
    }

    // Build assistant message with tool calls
    const assistantBlocks: LLMMessage['content'] = [];
    if (response.content) assistantBlocks.push({ type: 'text', text: response.content });
    for (const tc of response.toolCalls) {
      assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    messages.push({ role: 'assistant', content: assistantBlocks });

    // ── Execute tool calls ────────────────────────────────────────────
    const toolResults: Array<{ tool_use_id: string; content: string }> = [];

    for (const toolCall of response.toolCalls) {
      // Pre-tool middleware
      let skipTool = false;
      for (const mw of pipeline.preTool) {
        const result = mw.execute(mwCtx, { name: toolCall.name, input: toolCall.input });
        if (result.action === 'skip') {
          toolResults.push({
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: false, error: result.reason }),
          });
          skipTool = true;
          break;
        }
        if (result.action === 'stop') {
          messages.push({
            role: 'user',
            content: toolResults.map(tr => ({
              type: 'tool_result' as const,
              tool_use_id: tr.tool_use_id,
              content: tr.content,
            })),
          });
          messages.push({ role: 'user', content: result.reason });
          const wrapUp = await routeCall({
            messages,
            system: systemPrompt,
            temperature: agent.temperature,
            maxTokens: Math.min(agent.maxTokens, WRAP_UP_MAX_TOKENS),
            context: { ...routerCtx, taskType: 'general', provider: agent.modelProvider, model: agent.modelId },
          });
          lastTextContent = wrapUp.content;
          finalStatus = result.status;
          break outerLoop;
        }
      }

      if (skipTool) continue;

      totalToolCalls++;
      const toolStart = Date.now();

      const inputHash = hashToolCall(toolCall.name, toolCall.input);
      mwCtx.toolCallHistory.push({ name: toolCall.name, inputHash, iteration });

      let resultContent: string;
      const { result, error, retried } = await executeWithRetry(async () => {
        return skillExecutor.execute({
          skillName: toolCall.name,
          input: toolCall.input,
          context: {
            runId,
            organisationId: request.organisationId,
            subaccountId: request.subaccountId,
            agentId: request.agentId,
            orgProcesses,
            handoffDepth: request.handoffDepth,
            isSubAgent: request.isSubAgent,
            tokenBudget,
            startTime,
            timeoutMs,
            taskId: request.taskId,
          },
        });
      });

      if (error) {
        resultContent = JSON.stringify({
          success: false,
          error: error.message,
          error_type: error.type,
          retried,
        });
      } else {
        resultContent = typeof result === 'string' ? result : JSON.stringify(result);

        if (result && typeof result === 'object') {
          const r = result as Record<string, unknown>;
          if (r._created_task) tasksCreated++;
          if (r._updated_task) tasksUpdated++;
          if (r._created_deliverable) deliverablesCreated++;
        }
      }

      const toolDurationMs = Date.now() - toolStart;

      // Post-tool middleware
      for (const mw of pipeline.postTool) {
        const postResult = mw.execute(
          mwCtx,
          { name: toolCall.name, input: toolCall.input },
          { content: resultContent, durationMs: toolDurationMs }
        );
        if (postResult.action === 'stop') {
          finalStatus = postResult.status;
          break outerLoop;
        }
        if (postResult.content) {
          resultContent = postResult.content;
        }
      }

      const logEntry = {
        tool: toolCall.name,
        input: toolCall.input,
        output: resultContent.length > MAX_TOOL_OUTPUT_LOG_LENGTH
          ? resultContent.slice(0, MAX_TOOL_OUTPUT_LOG_LENGTH) + '...[truncated]'
          : resultContent,
        durationMs: toolDurationMs,
        iteration,
        retried,
      };
      toolCallsLog.push(logEntry);

      // Emit tool call event for live trace (throttled to max 2/sec)
      traceThrottle.emit('agent:run:tool_call', {
        tool: toolCall.name, durationMs: toolDurationMs, iteration,
        totalToolCalls, tokensUsed: totalTokensUsed,
      });

      toolResults.push({ tool_use_id: toolCall.id, content: resultContent });
    }

    messages.push({
      role: 'user',
      content: toolResults.map(tr => ({
        type: 'tool_result' as const,
        tool_use_id: tr.tool_use_id,
        content: tr.content,
      })),
    });
  }

  // Flush any pending throttled trace events before returning
  traceThrottle.destroy();

  return {
    summary: lastTextContent || null,
    toolCallsLog,
    totalToolCalls,
    inputTokens: Math.floor(totalTokensUsed * TOKEN_INPUT_RATIO),
    outputTokens: Math.floor(totalTokensUsed * TOKEN_OUTPUT_RATIO),
    totalTokens: totalTokensUsed,
    tasksCreated,
    tasksUpdated,
    deliverablesCreated,
    finalStatus,
  };
}

// ---------------------------------------------------------------------------
// Team Roster — loaded fresh from DB on every run
// ---------------------------------------------------------------------------

async function buildTeamRoster(subaccountId: string, currentAgentId: string): Promise<string | null> {
  const roster = await db
    .select({
      agentId: agents.id,
      agentName: agents.name,
      agentDescription: agents.description,
    })
    .from(subaccountAgents)
    .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
    .where(
      and(
        eq(subaccountAgents.subaccountId, subaccountId),
        eq(subaccountAgents.isActive, true),
        eq(agents.status, 'active'),
        isNull(agents.deletedAt)
      )
    );

  if (roster.length === 0) return null;

  const lines = roster.map(r => {
    const marker = r.agentId === currentAgentId ? ' ← (you)' : '';
    return `- ${r.agentName} (${r.agentId}) — ${r.agentDescription ?? 'No description'}${marker}`;
  });

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Smart Board Context — DB-level filtering instead of loading all tasks
// ---------------------------------------------------------------------------

async function buildSmartBoardContext(
  organisationId: string,
  subaccountId: string,
  agentId: string
): Promise<string> {
  const parts: string[] = [];

  // 1. Board summary from workspace memory (compressed)
  const boardSummary = await workspaceMemoryService.getBoardSummaryForPrompt(
    organisationId,
    subaccountId
  );
  if (boardSummary) {
    parts.push('### Board Summary');
    parts.push(boardSummary);
  }

  // 2. Tasks assigned to THIS agent — full detail (DB-filtered)
  const myTasks = await taskService.listTasks(organisationId, subaccountId, {
    assignedAgentId: agentId,
  }) as TaskWithAgent[];

  if (myTasks.length > 0) {
    parts.push('\n### Your Assigned Tasks');
    for (const task of myTasks) {
      parts.push(`- [${task.id}] **${task.title}** (${task.status}, ${task.priority})`);
      if (task.description) parts.push(`  ${String(task.description).slice(0, 200)}`);
    }
  }

  // 3. In-progress tasks from other agents (DB-filtered)
  const inProgressTasks = await taskService.listTasks(organisationId, subaccountId, {
    status: 'in_progress',
  }) as TaskWithAgent[];

  const othersInProgress = inProgressTasks.filter(t => t.assignedAgentId !== agentId);
  if (othersInProgress.length > 0) {
    parts.push('\n### Other In-Progress Work');
    for (const task of othersInProgress.slice(0, MAX_CROSS_AGENT_TASKS)) {
      const agentName = task.assignedAgent?.name ?? 'unassigned';
      parts.push(`- [${task.id}] ${task.title} → ${agentName}`);
    }
  }

  // 4. Status counts (single query for all tasks)
  const allTasks = await taskService.listTasks(organisationId, subaccountId, {});
  const counts: Record<string, number> = {};
  for (const t of allTasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  if (Object.keys(counts).length > 0) {
    parts.push('\n### Board Totals: ' + Object.entries(counts).map(([s, c]) => `${s}: ${c}`).join(' | '));
  }

  // Fallback if no board summary and we have tasks
  if (!boardSummary && allTasks.length > 0 && parts.length <= 1) {
    return buildTaskOverviewContext(allTasks.slice(0, 30) as TaskWithAgent[]);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

function buildTaskContext(item: Record<string, unknown>): string {
  const parts: string[] = [];
  parts.push(`### Target Task`);
  parts.push(`- **Title**: ${item.title ?? '(untitled)'}`);
  parts.push(`- **ID**: ${item.id}`);
  parts.push(`- **Status**: ${item.status ?? 'unknown'}`);
  parts.push(`- **Priority**: ${item.priority ?? 'normal'}`);
  if (item.description) parts.push(`- **Description**: ${item.description}`);
  if (item.brief) parts.push(`- **Brief**: ${item.brief}`);

  if (item.activities && Array.isArray(item.activities)) {
    parts.push('\n#### Recent Activity');
    for (const act of (item.activities as Array<Record<string, unknown>>).slice(0, 10)) {
      parts.push(`- [${act.activityType}] ${act.message} (${act.createdAt})`);
    }
  }

  if (item.deliverables && Array.isArray(item.deliverables)) {
    parts.push('\n#### Existing Deliverables');
    for (const del of item.deliverables as Array<Record<string, unknown>>) {
      parts.push(`- ${del.title} (${del.deliverableType})`);
    }
  }

  return parts.join('\n');
}

function buildTaskOverviewContext(items: TaskWithAgent[]): string {
  const byStatus: Record<string, TaskWithAgent[]> = {};
  for (const item of items) {
    const status = item.status ?? 'unknown';
    if (!byStatus[status]) byStatus[status] = [];
    byStatus[status].push(item);
  }

  const parts: string[] = ['### Board Overview'];
  for (const [status, statusItems] of Object.entries(byStatus)) {
    parts.push(`\n**${status}** (${statusItems.length} items):`);
    for (const item of statusItems.slice(0, 5)) {
      parts.push(`- [${item.id}] ${item.title}${item.priority !== 'normal' ? ` (${item.priority})` : ''}${item.assignedAgent ? ` → ${item.assignedAgent.name}` : ''}`);
    }
    if (statusItems.length > 5) {
      parts.push(`  ... and ${statusItems.length - 5} more`);
    }
  }

  return parts.join('\n');
}

function buildAutonomousInstructions(request: AgentRunRequest, targetItem: Record<string, unknown> | null): string {
  const parts: string[] = ['\n\n---\n## Execution Mode: Autonomous Run'];

  parts.push('You are running autonomously (not in a conversation with a user).');
  parts.push(`This is a ${request.runType} run.`);

  if (request.triggerContext?.type === 'handoff') {
    const ctx = request.triggerContext;
    parts.push(`\nYou were handed this task by another agent (run: ${ctx.sourceRunId}).`);
    if (ctx.handoffContext) {
      parts.push(`The previous agent provided this context: ${ctx.handoffContext}`);
    }
    parts.push('Continue the work from where they left off.');
  }

  if (targetItem) {
    parts.push(`\nYou have been assigned to work on the task: "${targetItem.title}" (ID: ${targetItem.id}).`);
    parts.push('Your workflow:');
    parts.push('1. Read the task details and any existing activities/deliverables');
    parts.push('2. Move the task to "in_progress" if it is not already');
    parts.push('3. Do the work described in the brief/description');
    parts.push('4. Log your progress as activities on the task');
    parts.push('5. When done, attach your output as a deliverable');
    parts.push('6. Move the task to "review" for human approval');
    parts.push('7. Provide a summary of what you did');
  } else {
    parts.push('\nYou are running a general check. Review the board, do your job based on your role, and take appropriate actions.');
    parts.push('Check for tasks assigned to you, look for things that need attention, and proactively do useful work.');
  }

  parts.push('\nIMPORTANT:');
  parts.push('- Always provide a clear summary at the end of your run');
  parts.push('- Log all significant actions as task activities');
  parts.push('- Attach deliverables for any content you produce');
  parts.push('- Move tasks to "review" when ready for human approval — never to "done"');

  return parts.join('\n');
}

function buildInitialMessage(request: AgentRunRequest): string {
  if (request.taskId) {
    return `You have a task assigned to you. Please work on it now. The task details are in your system context above.`;
  }

  const messages: Record<string, string> = {
    scheduled: 'This is your scheduled run. Check the board, review any tasks assigned to you, and do your job. Take actions based on your role and current board state.',
    manual: 'You have been manually triggered. Check the board and take appropriate actions based on your role.',
    triggered: 'You have been triggered by an event. Check the trigger context and board, then take appropriate actions.',
  };

  return messages[request.runType] ?? messages.manual;
}
