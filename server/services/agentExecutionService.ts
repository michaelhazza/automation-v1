import { createHash } from 'crypto';
import { eq, and, desc, isNull, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
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
import { env } from '../lib/env.js';
import type { ProviderTool } from './providers/types.js';
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
import { maskObservations, tagIteration } from './middleware/observationMasking.js';
import {
  MAX_LOOP_ITERATIONS,
  WRAP_UP_MAX_TOKENS,
  TOKEN_INPUT_RATIO,
  TOKEN_OUTPUT_RATIO,
  MAX_CROSS_AGENT_TASKS,
  MAX_TOOL_OUTPUT_LOG_LENGTH,
} from '../config/limits.js';
import { emitAgentRunUpdate, emitSubaccountUpdate, emitOrgUpdate } from '../websocket/emitters.js';
import { orgAgentConfigService } from './orgAgentConfigService.js';
import { organisations } from '../db/schema/index.js';
import { langfuse, withTrace } from '../instrumentation.js';
import {
  createSpan, createEvent, finalizeTrace, emitLoopTermination,
  generateRunFingerprint,
  type FinalStatus, type ErrorType,
} from '../lib/tracing.js';
import { claudeCodeRunner } from './claudeCodeRunner.js';

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
  /** Null for org-level runs */
  subaccountId?: string | null;
  /** Null for org-level runs */
  subaccountAgentId?: string | null;
  organisationId: string;
  /** Explicit execution scope — never inferred from nullable fields */
  executionScope: 'subaccount' | 'org';
  runType: 'scheduled' | 'manual' | 'triggered';
  executionMode?: 'api' | 'headless' | 'claude-code' | 'iee_browser' | 'iee_dev';
  /**
   * Optional IEE task. Required when executionMode is 'iee_browser' or
   * 'iee_dev'. Spec §9.1.
   */
  ieeTask?: {
    type: 'browser' | 'dev';
    goal: string;
    startUrl?: string;
    sessionKey?: string;
    repoUrl?: string;
    branch?: string;
    commands?: string[];
  };
  taskId?: string;
  triggerContext?: Record<string, unknown>;
  handoffDepth?: number;
  parentRunId?: string;
  isSubAgent?: boolean;
  parentSpawnRunId?: string;
  /** Optional idempotency key — if provided, duplicate runs with same key return existing result */
  idempotencyKey?: string;
  /** For org-level runs, the org agent config ID */
  orgAgentConfigId?: string;
  /** How this run was sourced — for observability */
  runSource?: 'scheduler' | 'manual' | 'trigger' | 'handoff' | 'sub_agent' | 'system';
  /**
   * Playbooks: when this agent run was dispatched by a Playbook step, the
   * step run id is stamped onto agent_runs.playbook_step_run_id so the
   * completion hook can route the result back to the engine.
   * Spec tasks/playbooks-spec.md §5.2 / step 6 wiring.
   */
  playbookStepRunId?: string;
  /**
   * The principal that initiated this run, when known. Plumbed into the
   * SkillExecutionContext so user-scoped tools (e.g. Playbook Studio
   * propose_save) can enforce ownership without making downstream
   * database lookups. Optional because system / scheduled runs have no
   * initiating user. Review finding #3.
   */
  userId?: string;
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

    // ── 0a. Execution scope validation ─────────────────────────────────
    if (request.executionScope === 'org' && request.subaccountId) {
      throw new Error('Org-level run must not have a subaccountId');
    }
    if (request.executionScope === 'subaccount' && !request.subaccountId) {
      throw new Error('Subaccount-level run requires a subaccountId');
    }

    // ── 0b. Org execution kill switch ────────────────────────────────────
    if (request.executionScope === 'org') {
      const [org] = await db
        .select({ orgExecutionEnabled: organisations.orgExecutionEnabled })
        .from(organisations)
        .where(eq(organisations.id, request.organisationId));
      if (org && !org.orgExecutionEnabled) {
        throw new Error('Org-level execution is disabled for this organisation');
      }
    }

    // ── 0c. Idempotency check — return existing run if key already used ───
    if (request.idempotencyKey) {
      const [existing] = await db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.idempotencyKey, request.idempotencyKey))
        .limit(1);

      if (existing) {
        return {
          runId: existing.id,
          status: existing.status as AgentRunResult['status'],
          summary: existing.summary,
          totalToolCalls: existing.totalToolCalls,
          totalTokens: existing.totalTokens,
          durationMs: existing.durationMs ?? (Date.now() - startTime),
          tasksCreated: existing.tasksCreated,
          tasksUpdated: existing.tasksUpdated,
          deliverablesCreated: existing.deliverablesCreated,
        };
      }
    }

    // ── 1. Create the run record ──────────────────────────────────────────
    const isOrgRun = request.executionScope === 'org';
    const [run] = await db
      .insert(agentRuns)
      .values({
        organisationId: request.organisationId,
        subaccountId: request.subaccountId ?? null,
        agentId: request.agentId,
        subaccountAgentId: request.subaccountAgentId ?? null,
        idempotencyKey: request.idempotencyKey ?? null,
        runType: request.runType,
        executionMode: request.executionMode ?? 'api',
        executionScope: request.executionScope,
        runSource: request.runSource ?? null,
        status: 'running',
        triggerContext: request.triggerContext ?? null,
        taskId: request.taskId ?? null,
        handoffDepth: request.handoffDepth ?? 0,
        parentRunId: request.parentRunId ?? null,
        isSubAgent: request.isSubAgent ?? false,
        parentSpawnRunId: request.parentSpawnRunId ?? null,
        playbookStepRunId: request.playbookStepRunId ?? null,
        lastActivityAt: new Date(),
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Emit run started event
    emitAgentRunUpdate(run.id, 'agent:run:started', {
      agentId: request.agentId, subaccountId: request.subaccountId ?? null,
      runType: request.runType, status: 'running',
    });
    if (isOrgRun) {
      emitOrgUpdate(request.organisationId, 'live:agent_started', {
        runId: run.id, agentId: request.agentId,
      });
    } else {
      emitSubaccountUpdate(request.subaccountId!, 'live:agent_started', {
        runId: run.id, agentId: request.agentId,
      });
    }

    try {
      // ── 2. Load agent config ────────────────────────────────────────────
      const agent = await agentService.getAgent(request.agentId, request.organisationId);

      let tokenBudget: number;
      let maxToolCalls: number;
      let timeoutMs: number;
      let configSkillSlugs: string[];
      let configCustomInstructions: string | null = null;

      // Branch config loading by execution scope
      let saLink: typeof subaccountAgents.$inferSelect | null = null;

      if (isOrgRun) {
        // Org-level: load from orgAgentConfigs
        const orgConfig = await orgAgentConfigService.getByAgentId(request.organisationId, request.agentId);
        tokenBudget = orgConfig.tokenBudgetPerRun;
        maxToolCalls = orgConfig.maxToolCallsPerRun;
        timeoutMs = orgConfig.timeoutSeconds * 1000;
        configSkillSlugs = (orgConfig.skillSlugs ?? []) as string[];
        configCustomInstructions = orgConfig.customInstructions;
      } else {
        // Subaccount-level: load from subaccountAgents (existing path)
        const [link] = await db
          .select()
          .from(subaccountAgents)
          .where(eq(subaccountAgents.id, request.subaccountAgentId!));

        if (!link) throw new Error('Subaccount agent link not found');
        saLink = link;

        tokenBudget = link.tokenBudgetPerRun;
        maxToolCalls = link.maxToolCallsPerRun;
        timeoutMs = link.timeoutSeconds * 1000;
        configSkillSlugs = (link.skillSlugs ?? []) as string[];
        configCustomInstructions = link.customInstructions;
      }

      // ── 2a. Snapshot resolved config for reproducibility ──────────────
      const resolvedConfig = {
        tokenBudget,
        maxToolCalls,
        timeoutMs,
        skillSlugs: configSkillSlugs,
        customInstructions: configCustomInstructions,
        executionScope: request.executionScope,
      };
      const configHashValue = createHash('sha256').update(JSON.stringify(resolvedConfig)).digest('hex');

      await db.update(agentRuns).set({
        tokenBudget,
        configSnapshot: resolvedConfig,
        configHash: configHashValue,
        resolvedSkillSlugs: configSkillSlugs,
        resolvedLimits: { tokenBudget, maxToolCalls, timeoutMs },
      }).where(eq(agentRuns.id, run.id));

      // ── 2b. Workspace limit check (pre-run guard) ─────────────────────
      // Skip subaccount limits for org runs; org+global limits still apply via budgetService
      const limitCheck = isOrgRun
        ? { allowed: true as const }
        : await checkWorkspaceLimits(request.subaccountId!, tokenBudget);
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
      // Skip for org-level runs (no subaccount dev context)
      if (!isOrgRun) try {
        const { hash: decHash } = await devContextService.getContext(request.subaccountId!);

        // Count prior runs for this task to determine current iteration
        let iteration = 0;
        if (request.taskId) {
          const [{ total }] = await db
            .select({ total: count() })
            .from(agentRuns)
            .where(and(
              eq(agentRuns.taskId, request.taskId),
              eq(agentRuns.subaccountId, request.subaccountId!),
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

      // ── 3. Load run context data (cascading scopes + task attachments + instructions) ──
      // Spec §7.1/§7.2. Pulls agent-wide, subaccount-scoped, scheduled-task-
      // scoped, and task-instance data across all four scopes; resolves
      // same-name overrides; enforces the eager budget upstream of
      // buildSystemPrompt; caps the lazy manifest; and exposes the scheduled
      // task's description as taskInstructions for the new system-prompt layer.
      const { loadRunContextData } = await import('./runContextLoader.js');
      const runContextData = await loadRunContextData({
        agentId: request.agentId,
        organisationId: request.organisationId,
        subaccountAgentId: request.subaccountAgentId ?? null,
        taskId: request.taskId ?? null,
        triggerContext: request.triggerContext,
      });

      // Only eager sources flagged includedInPrompt: true are rendered into
      // the Knowledge Base block. Sources excluded by the upstream budget
      // walk or by same-name override resolution stay in runContextData
      // (for snapshot persistence) but do not appear in the prompt.
      const dataSourceContents = runContextData.eager
        .filter(s => s.includedInPrompt)
        .map(s => ({
          name: s.name,
          description: s.description,
          content: s.content,
          contentType: s.contentType,
        }));

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

      // Layer 2+3: Org skills + sub-account/org skills
      const skillSlugs = configSkillSlugs;
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

      // ── 5a. Auto-inject read_data_source (spec §8.4) ─────────────────────
      // The skill is default-on for every agent run. It's read-only, cheap,
      // and only useful when data sources are attached. Rather than requiring
      // each system agent to list it in defaultSystemSkillSlugs, we append it
      // to the tool list here so every agent can call it without operator
      // action. The skill is already registered via systemSkillService because
      // the .md file exists at server/skills/read_data_source.md.
      if (!enhancedTools.some(t => t.name === 'read_data_source')) {
        const readDataSourceSkill = await systemSkillService.getSkillBySlug('read_data_source');
        if (readDataSourceSkill && readDataSourceSkill.visibility !== 'none') {
          enhancedTools.push({
            name: readDataSourceSkill.definition.name,
            description: readDataSourceSkill.definition.description,
            input_schema: readDataSourceSkill.definition.input_schema,
          });
          if (readDataSourceSkill.instructions || readDataSourceSkill.methodology) {
            const parts: string[] = [];
            if (readDataSourceSkill.instructions) parts.push(readDataSourceSkill.instructions);
            if (readDataSourceSkill.methodology) parts.push(readDataSourceSkill.methodology);
            systemSkillInstructions.push(parts.join('\n\n'));
          }
        }
      }

      // ── 5b. MCP tool resolution ────────────────────────────────────────
      let mcpClients: Map<string, import('./mcpClientManager.js').McpClientInstance> | null = null;
      let mcpLazyRegistry: Map<string, import('../db/schema/mcpServerConfigs.js').McpServerConfig> | null = null;

      try {
        const { mcpClientManager } = await import('./mcpClientManager.js');
        const mcp = await mcpClientManager.connectForRun({
          runId: run.id,
          organisationId: request.organisationId,
          agentId: request.agentId,
          subaccountId: request.subaccountId ?? null,
        });
        mcpClients = mcp.clients;
        mcpLazyRegistry = mcp.lazyRegistry;
        if (mcp.tools.length > 0) {
          // Defense in depth: cap is also enforced in connectForRun
          const { MAX_MCP_TOOLS_PER_RUN } = await import('../config/limits.js');
          const cappedTools = mcp.tools.slice(0, MAX_MCP_TOOLS_PER_RUN);
          enhancedTools.push(...cappedTools);
          logger.info('mcp.tools_loaded', { runId: run.id, mcpToolCount: cappedTools.length, serverCount: mcp.clients.size });
        }
      } catch (err) {
        logger.warn('mcp.connect_failed', { runId: run.id, error: err instanceof Error ? err.message : String(err) });
        // Non-fatal — agent runs without MCP tools
      }

      // ── 6. Build task context (with smart offloading) ───────────────────
      let workspaceContext = '';
      let targetItem: typeof tasks.$inferSelect | null = null;

      if (request.taskId) {
        const item = await taskService.getTask(request.taskId, request.organisationId);
        targetItem = item;
        workspaceContext = buildTaskContext(item);
      } else if (!isOrgRun) {
        // Only build board context for subaccount runs (org board comes in Phase 5)
        workspaceContext = await buildSmartBoardContext(
          request.organisationId,
          request.subaccountId!,
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

      // Layer 3: Custom instructions (from subaccount link or org config)
      if (configCustomInstructions) {
        systemPromptParts.push(`\n\n---\n## Additional Instructions\n${configCustomInstructions}`);
      }

      // Layer 3.5: Task Instructions — only when run originates from a scheduled task.
      // Spec §7.2. The scheduled task's description is injected as a dedicated
      // layer so operators can treat the scheduled task as the "project" and the
      // agent's master prompt as the generic reporting brain.
      if (runContextData.taskInstructions) {
        systemPromptParts.push(
          `\n\n---\n## Task Instructions\nYou are executing a recurring task. Follow these instructions precisely:\n\n${runContextData.taskInstructions}`
        );
      }

      // Layer 3.6: Available Context Sources — the lazy manifest.
      // Spec §7.3. Shows the agent which reference files exist without
      // loading their content. The agent fetches on demand via the
      // read_data_source skill. Capped at MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT;
      // elided entries remain available via read_data_source op='list'.
      if (runContextData.manifestForPrompt.length > 0) {
        const scopeLabels: Record<string, string> = {
          task_instance: 'task attachment',
          scheduled_task: 'scheduled task',
          subaccount: 'subaccount',
          agent: 'agent',
        };
        const manifestLines = runContextData.manifestForPrompt.map((s) => {
          const scopeLabel = scopeLabels[s.scope] ?? s.scope;
          const sizeHint = s.sizeBytes > 0 ? ` (~${Math.round(s.sizeBytes / 1024)}KB)` : '';
          const unreadable = !s.fetchOk ? ' [binary — not readable]' : '';
          const desc = s.description ? ` — ${s.description}` : '';
          return `- **${s.name}** [${scopeLabel}]${sizeHint}${unreadable}${desc} (id: \`${s.id}\`)`;
        }).join('\n');

        const elidedNote = runContextData.manifestElidedCount > 0
          ? `\n\n_${runContextData.manifestElidedCount} additional source(s) are available but not listed here to keep the prompt compact. Call \`read_data_source\` with \`op: 'list'\` to see the full inventory._`
          : '';

        systemPromptParts.push(
          `\n\n---\n## Available Context Sources\nThe following additional reference materials are available. Use the \`read_data_source\` tool to fetch any of them on demand:\n\n${manifestLines}${elidedNote}`
        );
      }

      // Add team roster (loaded fresh from DB every run)
      const teamRoster = isOrgRun
        ? await buildOrgTeamRoster(request.organisationId, request.agentId)
        : await buildTeamRoster(request.subaccountId!, request.agentId);
      if (teamRoster) {
        systemPromptParts.push(`\n\n---\n## Your Team\nYou can reassign tasks to or create tasks for any of these agents:\n${teamRoster}`);
      }

      // Add workspace memory (with prompt injection boundaries)
      // Pass task context for semantic retrieval when available
      const taskContextForMemory = targetItem
        ? `${targetItem.title ?? ''}${targetItem.description ? ' ' + targetItem.description : ''}`
        : undefined;

      // Skip subaccount memory for org runs (org memory comes in Phase 3)
      let memory: string | null = null;
      if (!isOrgRun) {
        memory = await workspaceMemoryService.getMemoryForPrompt(
          request.organisationId,
          request.subaccountId!,
          taskContextForMemory
        );
        if (memory) {
          systemPromptParts.push(`\n\n---\n## Workspace Memory\n${memory}`);
        }
      }

      // Add workspace entities (subaccount-scoped only)
      const entities = isOrgRun ? null : await workspaceMemoryService.getEntitiesForPrompt(request.subaccountId!);
      if (entities) {
        systemPromptParts.push(`\n\n---\n## Known Workspace Entities\n${entities}`);
      }

      if (workspaceContext) {
        systemPromptParts.push(`\n\n---\n## Current Board\n${workspaceContext}`);
      }

      systemPromptParts.push(buildAutonomousInstructions(request, targetItem));

      const fullSystemPrompt = systemPromptParts.join('');
      const systemPromptTokens = approxTokens(fullSystemPrompt);

      // Persist the context sources snapshot (spec §7.5). Captures every
      // entry considered at run-start time — winners, suppressed losers,
      // lazy manifest, eager-but-budget-excluded. Used by the run detail
      // UI Context Sources panel for debugging.
      const allForSnapshot = [
        ...runContextData.eager,
        ...runContextData.manifest,
        ...runContextData.suppressed,
      ];
      const contextSourcesSnapshot = allForSnapshot.map((s) => ({
        id: s.id,
        scope: s.scope,
        name: s.name,
        description: s.description,
        contentType: s.contentType,
        loadingMode: s.loadingMode,
        sizeBytes: s.sizeBytes,
        tokenCount: s.tokenCount,
        fetchOk: s.fetchOk,
        // orderIndex is always assigned in runContextLoader step 5,
        // BEFORE suppression, so every entry carries a stable index.
        orderIndex: s.orderIndex!,
        includedInPrompt: s.includedInPrompt ?? false,
        truncated: s.truncated ?? false,
        suppressedByOverride: s.suppressedByOverride ?? false,
        suppressedBy: s.suppressedBy,
        exclusionReason: (() => {
          if (s.suppressedByOverride) return 'override_suppressed' as const;
          if (s.loadingMode === 'lazy') return 'lazy_not_rendered' as const;
          if (s.loadingMode === 'eager' && !s.includedInPrompt) return 'budget_exceeded' as const;
          return null;
        })(),
      }));

      await db.update(agentRuns).set({
        memoryStateAtStart: memory ?? null,
        skillsUsed: [
          ...(systemAgentRecord ? ((systemAgentRecord.defaultSystemSkillSlugs ?? []) as string[]).map(s => `system:${s}`) : []),
          ...skillSlugs,
        ],
        systemPromptTokens,
        contextSourcesSnapshot,
      }).where(eq(agentRuns.id, run.id));

      // H-5: store large snapshot in agent_run_snapshots (keep agent_runs lean)
      await db.insert(agentRunSnapshots)
        .values({ runId: run.id, systemPromptSnapshot: fullSystemPrompt })
        .onConflictDoNothing();

      // ── 8. Execute — branch by execution mode ─────────────────────────
      const effectiveMode = request.executionMode ?? 'api';

      let loopResult: LoopResult;

      if (effectiveMode === 'iee_browser' || effectiveMode === 'iee_dev') {
        // ── 8z. IEE — Integrated Execution Environment ──────────────────
        // Spec §9.1. Enqueues a pg-boss job picked up by the worker. The
        // worker writes terminal status to iee_runs and (in a future
        // iteration) the agent run can be resumed when the row completes.
        // For v1 the agent run completes immediately with a synthetic
        // loopResult; the canonical execution state lives on the iee_run.
        if (!request.ieeTask) {
          throw { statusCode: 400, message: 'ieeTask is required when executionMode is iee_browser/iee_dev', errorCode: 'IEE_TASK_REQUIRED' };
        }
        const expectedType = effectiveMode === 'iee_browser' ? 'browser' : 'dev';
        if (request.ieeTask.type !== expectedType) {
          throw { statusCode: 400, message: `executionMode ${effectiveMode} requires ieeTask.type=${expectedType}`, errorCode: 'IEE_TASK_TYPE_MISMATCH' };
        }
        const { enqueueIEETask } = await import('./ieeExecutionService.js');
        const enqueueResult = await enqueueIEETask({
          task: request.ieeTask as Parameters<typeof enqueueIEETask>[0]['task'],
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? null,
          agentId: request.agentId,
          agentRunId: run.id,
          correlationId: run.id,
        });
        loopResult = {
          summary: `IEE ${expectedType} task enqueued (ieeRunId=${enqueueResult.ieeRunId}${enqueueResult.deduplicated ? ', deduplicated' : ''})`,
          toolCallsLog: [{
            type: 'iee_handoff',
            ieeRunId: enqueueResult.ieeRunId,
            deduplicated: enqueueResult.deduplicated,
            mode: effectiveMode,
          }],
          totalToolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          tasksCreated: 0,
          tasksUpdated: 0,
          deliverablesCreated: 0,
          finalStatus: 'completed',
        };
      } else if (effectiveMode === 'claude-code') {
        // ── 8a. Claude Code CLI execution ──────────────────────────────
        // Spawn `claude -p` with the agent's prompt. Uses the host's
        // Claude Max plan — zero API cost. The same prompts & skills
        // will transfer to Docker-based execution later.
        let projectRoot = '.';
        try {
          const { context: dec } = await devContextService.getContext(request.subaccountId!);
          projectRoot = dec.projectRoot;
        } catch {
          // DEC not configured — use current directory
        }

        const taskPrompt = workspaceContext || 'Review the current workspace and report status.';

        emitAgentRunUpdate(run.id, 'agent:run:progress', {
          type: 'execution_mode', mode: 'claude-code',
          message: 'Spawning Claude Code CLI...',
        });

        const ccResult = await claudeCodeRunner.execute({
          systemPrompt: fullSystemPrompt,
          taskPrompt,
          cwd: projectRoot,
          maxTurns: maxToolCalls,
          timeoutMs,
          runId: run.id,
        });

        loopResult = {
          summary: ccResult.result,
          toolCallsLog: [{
            type: 'claude_code_execution',
            sessionId: ccResult.sessionId,
            success: ccResult.success,
            durationMs: ccResult.durationMs,
            numTurns: ccResult.numTurns,
            timedOut: ccResult.timedOut,
          }],
          totalToolCalls: ccResult.numTurns,
          inputTokens: ccResult.inputTokens,
          outputTokens: ccResult.outputTokens,
          totalTokens: ccResult.totalTokens,
          tasksCreated: 0,
          tasksUpdated: 0,
          deliverablesCreated: 0,
          finalStatus: ccResult.timedOut ? 'timeout' : (ccResult.success ? 'completed' : 'failed'),
        };
      } else {
        // ── 8b. Standard API agentic loop ──────────────────────────────
        const pipeline = createDefaultPipeline();

        // Session linking (Section WS2): group related runs
        let traceSessionId: string;
        if (request.runSource === 'handoff' && request.parentRunId) {
          traceSessionId = `handoff-chain-${request.parentRunId}`;
        } else if (request.runType === 'scheduled') {
          const dateStr = new Date().toISOString().slice(0, 10);
          traceSessionId = `schedule-${request.agentId}-${dateStr}`;
        } else if (request.runSource === 'sub_agent' && request.parentSpawnRunId) {
          traceSessionId = `spawn-${request.parentSpawnRunId}`;
        } else {
          traceSessionId = run.id;
        }

        // Run fingerprint (Section 8.3)
        const skillSlugs = enhancedTools.map(t => t.name);
        const runFingerprint = generateRunFingerprint(request.agentId, 'development', skillSlugs);

        const trace = langfuse.trace({
          name:      'agent-run',
          userId:    request.subaccountId,
          sessionId: traceSessionId,
          metadata: {
            agentId:       request.agentId,
            runType:       request.runType,
            orgId:         request.organisationId,
            subaccountId:  request.subaccountId,
            executionMode: 'api',
            traceSchemaVersion: 'v1',
            instrumentationVersion: '1.0',
            startedAt:     new Date().toISOString(),
            runFingerprint,
            handoffDepth:     request.handoffDepth ?? 0,
            parentRunId:      request.parentRunId ?? null,
            isSubAgent:       request.isSubAgent ?? false,
            parentSpawnRunId: request.parentSpawnRunId ?? null,
          },
        });

        loopResult = await withTrace(trace, {
          runId:         run.id,
          orgId:         request.organisationId,
          subaccountId:  request.subaccountId ?? undefined,
          agentId:       request.agentId ?? undefined,
          executionMode: 'api',
        }, async () => {
          const result = await runAgenticLoop({
            runId: run.id,
            agent,
            routerCtx: {
              organisationId:    request.organisationId,
              subaccountId:      request.subaccountId ?? undefined,
              runId:             run.id,
              subaccountAgentId: request.subaccountAgentId ?? undefined,
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
            saLink: saLink!,
            pipeline,
            mcpClients,
            mcpLazyRegistry,
            runContextData,
          });

          // ── Finalize Langfuse trace (inside withTrace so context is available) ──
          const loopDurationMs = Date.now() - startTime;
          const loopFinalStatus = (result.finalStatus ?? 'completed') as string;

          const traceFinalStatus: FinalStatus =
            loopFinalStatus === 'timeout' ? 'timeout'
            : loopFinalStatus === 'budget_exceeded' ? 'budget_exceeded'
            : loopFinalStatus === 'loop_detected' ? 'loop_detected'
            : loopFinalStatus === 'failed' ? 'failed'
            : 'completed';

          const traceErrorType: ErrorType | null =
            loopFinalStatus === 'timeout' ? 'timeout'
            : loopFinalStatus === 'budget_exceeded' ? 'budget_exceeded'
            : loopFinalStatus === 'loop_detected' ? 'loop_detected'
            : loopFinalStatus === 'failed' ? 'internal_error'
            : null;

          const finalizationSpan = createSpan('agent.finalization.run');
          createEvent('run.status.changed', {
            fromStatus: 'running', toStatus: traceFinalStatus,
          });
          finalizationSpan.end();

          finalizeTrace({
            finalStatus: traceFinalStatus,
            totalTokensIn: result.inputTokens,
            totalTokensOut: result.outputTokens,
            iterationCount: result.toolCallsLog.length > 0
              ? Math.max(...result.toolCallsLog.map(t => (t as { iteration: number }).iteration)) + 1
              : 0,
            toolCallCount: result.totalToolCalls,
            durationMs: loopDurationMs,
            errorType: traceErrorType,
            startedAt: new Date(startTime).toISOString(),
          });

          langfuse.flushAsync().catch(() => {});

          return result;
        });
      }

      // ── 9. Finalise the run ─────────────────────────────────────────────
      const durationMs = Date.now() - startTime;
      let finalStatus = (loopResult.finalStatus ?? 'completed') as 'completed' | 'failed' | 'timeout' | 'loop_detected' | 'budget_exceeded';

      // T25 / T16 — Reporting Agent end-of-run hook. Runs the invariant
      // and persists the content fingerprint. No-op for non-Reporting-Agent
      // runs. Spec v3.4 §6.7.2 / §8.4.2.
      if (finalStatus === 'completed') {
        try {
          const [runRow] = await db
            .select({ runMetadata: agentRuns.runMetadata })
            .from(agentRuns)
            .where(eq(agentRuns.id, run.id))
            .limit(1);
          const { finalizeReportingAgentRun } = await import('../lib/reportingAgentRunHook.js');
          await finalizeReportingAgentRun({
            runId: run.id,
            subaccountAgentId: request.subaccountAgentId ?? null,
            organisationId: request.organisationId,
            runMetadata: (runRow?.runMetadata ?? null) as Record<string, unknown> | null,
          });
        } catch (err) {
          // Invariant or persist failed — downgrade to failed so the run
          // does not flip to completed in an inconsistent state.
          logger.error('reportingAgent.finalize_failed', {
            runId: run.id,
            error: err instanceof Error ? err.message : String(err),
          });
          finalStatus = 'failed';
        }
      }

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
        lastActivityAt: new Date(),
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

      // Update lastRunAt on the correct config table
      if (isOrgRun && request.orgAgentConfigId) {
        await orgAgentConfigService.updateLastRunAt(request.orgAgentConfigId, request.organisationId);
      } else if (request.subaccountAgentId) {
        await db.update(subaccountAgents).set({
          lastRunAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(subaccountAgents.id, request.subaccountAgentId));
      }

      // Emit run completed event
      emitAgentRunUpdate(run.id, 'agent:run:completed', {
        status: finalStatus, summary: loopResult.summary,
        totalToolCalls: loopResult.totalToolCalls, totalTokens: loopResult.totalTokens,
        tasksCreated: loopResult.tasksCreated, durationMs,
      });

      // Playbooks: if this agent run was dispatched by a Playbook step, route
      // its result back to the engine so the step run can be marked completed
      // and the next tick fired. Hook is non-blocking — failures are logged
      // and do not affect the agent run completion.
      try {
        const { notifyPlaybookEngineOnAgentRunComplete } = await import('./playbookAgentRunHook.js');
        await notifyPlaybookEngineOnAgentRunComplete(run.id, {
          ok: true,
          output: { summary: loopResult.summary ?? '' },
        });
      } catch (err) {
        console.error('[AgentExecution] playbook hook failed (non-fatal)', err);
      }
      if (isOrgRun) {
        emitOrgUpdate(request.organisationId, 'live:agent_completed', {
          runId: run.id, agentId: request.agentId, status: finalStatus,
        });
      } else {
        emitSubaccountUpdate(request.subaccountId!, 'live:agent_completed', {
          runId: run.id, agentId: request.agentId, status: finalStatus,
        });
      }

      // ── 10. Extract insights for workspace memory + entities ─────────────
      // Skip for org runs — org memory extraction comes in Phase 3
      if (loopResult.summary && !isOrgRun) {
        try {
          await workspaceMemoryService.extractRunInsights(
            run.id,
            request.agentId,
            request.organisationId,
            request.subaccountId!,
            loopResult.summary
          );
        } catch (err) {
          console.error(`[AgentExecution] Memory extraction failed for run ${run.id}:`, err instanceof Error ? err.message : err);
        }

        // Entity extraction (non-blocking)
        workspaceMemoryService.extractEntities(
          run.id,
          request.organisationId,
          request.subaccountId!,
          loopResult.summary
        ).catch(err => {
          console.error(`[AgentExecution] Entity extraction failed for run ${run.id}:`, err instanceof Error ? err.message : err);
        });
      }

      // ── 11. Fire agent_completed triggers (non-blocking) ─────────────────
      // Skip for org runs — org triggers come in Phase 5
      if (!isOrgRun) {
        triggerService.checkAndFire(
          request.subaccountId!,
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
      }

      // ── 12. MCP cleanup (guaranteed) ────────────────────────────────────
      if (mcpClients?.size) {
        const { mcpClientManager } = await import('./mcpClientManager.js');
        await mcpClientManager.disconnectAll(mcpClients).catch((e) => {
          logger.error('mcp.disconnect_failed', { runId: run.id, error: e instanceof Error ? e.message : String(e) });
        });
      }

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

      // Playbooks: route the failure to the engine so the step run is marked
      // failed and downstream failure-policy logic runs.
      try {
        const { notifyPlaybookEngineOnAgentRunComplete } = await import('./playbookAgentRunHook.js');
        await notifyPlaybookEngineOnAgentRunComplete(run.id, {
          ok: false,
          error: errorMessage,
        });
      } catch (hookErr) {
        console.error('[AgentExecution] playbook hook failed (non-fatal)', hookErr);
      }
      if (isOrgRun) {
        emitOrgUpdate(request.organisationId, 'live:agent_completed', {
          runId: run.id, agentId: request.agentId, status: 'failed',
        });
      } else {
        emitSubaccountUpdate(request.subaccountId!, 'live:agent_completed', {
          runId: run.id, agentId: request.agentId, status: 'failed',
        });
      }

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
  routerCtx: Omit<LLMCallContext, 'taskType' | 'provider' | 'model' | 'executionPhase' | 'routingMode'>;
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
  mcpClients?: Map<string, import('./mcpClientManager.js').McpClientInstance> | null;
  mcpLazyRegistry?: Map<string, import('../db/schema/mcpServerConfigs.js').McpServerConfig> | null;
  /**
   * Context data pool for this run — populated upstream by loadRunContextData.
   * Threaded through to the skill execution context so the read_data_source
   * skill handler can answer list/read ops against the same pool used to
   * build the system prompt. See spec §8.2.
   */
  runContextData: import('./runContextLoader.js').RunContextData;
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

// ---------------------------------------------------------------------------
// Tool call validation — lightweight checks before execution.
// Used for cascade escalation: if economy model produces invalid tool calls,
// we retry with the frontier (ceiling) model.
// ---------------------------------------------------------------------------

function validateToolCalls(
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  activeTools: ProviderTool[],
): { valid: boolean; failureReason?: string } {
  const toolNames = new Set(activeTools.map(t => t.name));

  for (const tc of toolCalls) {
    if (!toolNames.has(tc.name)) {
      return { valid: false, failureReason: `unknown_tool:${tc.name}` };
    }

    if (tc.input === null || typeof tc.input !== 'object') {
      return { valid: false, failureReason: `invalid_input:${tc.name}` };
    }

    const toolDef = activeTools.find(t => t.name === tc.name);
    if (toolDef?.input_schema?.required) {
      for (const field of toolDef.input_schema.required) {
        if (!(field in tc.input)) {
          return { valid: false, failureReason: `missing_field:${tc.name}.${field}` };
        }
      }
    }

    // Log-only: unexpected fields (common hallucination, usually harmless)
    if (toolDef?.input_schema?.properties) {
      const knownFields = new Set(Object.keys(toolDef.input_schema.properties));
      const extraFields = Object.keys(tc.input).filter(k => !knownFields.has(k));
      if (extraFields.length > 0) {
        console.warn(`[toolCallValidator] unexpected fields in ${tc.name}: ${extraFields.join(', ')}`);
      }
    }
  }

  return { valid: true };
}

async function runAgenticLoop(params: LoopParams): Promise<LoopResult> {
  const {
    runId, agent, routerCtx, systemPrompt, tools, tokenBudget,
    maxToolCalls, timeoutMs, startTime, request, orgProcesses,
    saLink, pipeline, mcpClients, mcpLazyRegistry, runContextData,
  } = params;

  const toolCallsLog: object[] = [];
  let totalToolCalls = 0;
  let totalTokensUsed = 0;
  let tasksCreated = 0;
  let tasksUpdated = 0;
  let deliverablesCreated = 0;
  let finalStatus: string | undefined;

  // Persistent skill execution context — created ONCE outside the loop so
  // that counters (readDataSourceCallCount, mcpCallCount) survive across
  // iterations. Previously this was rebuilt inline on every tool call,
  // which would have reset the counters every iteration.
  const skillExecutionContext: import('./skillExecutor.js').SkillExecutionContext = {
    runId,
    organisationId: request.organisationId,
    subaccountId: request.subaccountId ?? null,
    agentId: request.agentId,
    userId: request.userId,
    orgProcesses,
    handoffDepth: request.handoffDepth,
    isSubAgent: request.isSubAgent,
    tokenBudget,
    startTime,
    timeoutMs,
    taskId: request.taskId,
    _mcpClients: mcpClients ?? undefined,
    _mcpLazyRegistry: mcpLazyRegistry ?? undefined,
    runContextData,
    readDataSourceCallCount: 0,
  };

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
  let previousResponseHadToolCalls = false;

  outerLoop:
  for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
    mwCtx.iteration = iteration;
    mwCtx.tokensUsed = totalTokensUsed;
    mwCtx.toolCallsCount = totalToolCalls;

    // ── Heartbeat: update lastActivityAt for stale run detection ──────
    // Throttle to every 3rd iteration to avoid DB write pressure
    if (iteration % 3 === 0) {
      db.update(agentRuns)
        .set({ lastActivityAt: new Date() })
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, 'running')))
        .catch((err) => {
          logger.warn('heartbeat_update_failed', { runId, error: err instanceof Error ? err.message : String(err) });
        });
    }

    // ── Pre-call middleware ────────────────────────────────────────────
    for (const mw of pipeline.preCall) {
      const result = mw.execute(mwCtx);
      if (result.action === 'stop') {
        createEvent('agent.middleware.decision', {
          middlewareName: mw.name, decision: 'stop', reason: result.reason, iteration,
        });
        messages.push({ role: 'user', content: result.reason });
        const maskedWrapUp = maskObservations(messages, iteration);
        const wrapUp = await routeCall({
          messages: maskedWrapUp,
          system: systemPrompt,
          temperature: agent.temperature,
          maxTokens: Math.min(agent.maxTokens, WRAP_UP_MAX_TOKENS),
          context: {
            ...routerCtx, taskType: 'general', executionPhase: 'synthesis' as const,
            provider: agent.modelProvider, model: agent.modelId, routingMode: 'ceiling' as const,
          },
        });
        lastTextContent = wrapUp.content;
        totalTokensUsed += (wrapUp.tokensIn ?? 0) + (wrapUp.tokensOut ?? 0);
        finalStatus = result.status;
        emitLoopTermination('middleware_stop', {
          iteration, middlewareName: mw.name, reason: result.reason, totalToolCalls,
        });
        break outerLoop;
      }
      if (result.action === 'inject_message') {
        createEvent('agent.middleware.decision', {
          middlewareName: mw.name, decision: 'inject_message', iteration,
        });
        messages.push({ role: 'user', content: result.message });
        logger.debug('middleware.inject_message', {
          runId, middleware: mw.name, iteration, tokensUsed: totalTokensUsed,
        });
      }
    }

    // Emit iteration event for live trace (throttled to max 2/sec)
    traceThrottle.emit('agent:run:iteration', {
      iteration, tokensUsed: totalTokensUsed, toolCallsCount: totalToolCalls,
    });

    // ── Determine execution phase for this iteration ─────────────────
    let phase: 'planning' | 'execution' | 'synthesis';
    if (iteration === 0) {
      phase = 'planning';
    } else if (previousResponseHadToolCalls) {
      phase = 'execution';
    } else if (totalToolCalls > 0 && !previousResponseHadToolCalls) {
      phase = 'synthesis';
    } else if (iteration > 0 && totalToolCalls === 0) {
      phase = 'synthesis';
    } else {
      phase = 'planning';
    }

    const iterationSpan = createSpan('agent.loop.iteration', {
      iteration, phase, totalToolCalls, tokensUsed: totalTokensUsed,
    });

    // ── Call LLM (with observation masking) ─────────────────────────────
    const maskedMessages = maskObservations(messages, iteration);
    const response = await routeCall({
      messages: maskedMessages,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      estimatedContextTokens: totalTokensUsed,
      context: {
        ...routerCtx, taskType: 'development', executionPhase: phase,
        provider: agent.modelProvider, model: agent.modelId, routingMode: 'ceiling' as const,
      },
    });

    totalTokensUsed += (response.tokensIn ?? 0) + (response.tokensOut ?? 0);

    lastTextContent = response.content;
    previousResponseHadToolCalls = !!(response.toolCalls && response.toolCalls.length > 0);

    // ── Cascade escalation: validate economy model tool calls ────────
    let escalationAttempted = false;
    if (!env.ROUTER_FORCE_FRONTIER && response.routing?.wasDowngraded && response.toolCalls?.length) {
      const validation = validateToolCalls(response.toolCalls, tools as unknown as ProviderTool[]);
      if (!validation.valid && !escalationAttempted) {
        escalationAttempted = true;
        console.warn(`[agentLoop] escalating: ${validation.failureReason} — retrying with frontier model`);
        const escalatedResponse = await routeCall({
          messages: maskedMessages,
          system: systemPrompt,
          tools: tools.length > 0 ? tools : undefined,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          estimatedContextTokens: totalTokensUsed,
          context: {
            ...routerCtx, taskType: 'development', executionPhase: phase,
            provider: agent.modelProvider, model: agent.modelId, routingMode: 'forced' as const,
            wasEscalated: true,
            escalationReason: `economy_invalid_tool_calls: ${validation.failureReason}`,
          },
        });
        // Replace response with escalated version
        Object.assign(response, escalatedResponse);
        totalTokensUsed += (escalatedResponse.tokensIn ?? 0) + (escalatedResponse.tokensOut ?? 0);
        lastTextContent = escalatedResponse.content;
        previousResponseHadToolCalls = !!(escalatedResponse.toolCalls && escalatedResponse.toolCalls.length > 0);
      }
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      iterationSpan.end({ output: { phase, noToolCalls: true } });
      emitLoopTermination('no_tool_calls', { iteration, totalToolCalls });
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
          createEvent('agent.middleware.decision', {
            middlewareName: mw.name, decision: 'stop', reason: result.reason, iteration,
          });
          messages.push({
            role: 'user',
            content: toolResults.map(tr => ({
              type: 'tool_result' as const,
              tool_use_id: tr.tool_use_id,
              content: tr.content,
            })),
          });
          messages.push({ role: 'user', content: result.reason });
          const maskedStopMessages = maskObservations(messages, iteration);
          const wrapUp = await routeCall({
            messages: maskedStopMessages,
            system: systemPrompt,
            temperature: agent.temperature,
            maxTokens: Math.min(agent.maxTokens, WRAP_UP_MAX_TOKENS),
            context: {
              ...routerCtx, taskType: 'general', executionPhase: 'synthesis' as const,
              provider: agent.modelProvider, model: agent.modelId, routingMode: 'ceiling' as const,
            },
          });
          lastTextContent = wrapUp.content;
          finalStatus = result.status;
          iterationSpan.end({ output: { phase, middlewareStop: true } });
          emitLoopTermination('middleware_stop', {
            iteration, middlewareName: mw.name, reason: result.reason, totalToolCalls,
          });
          break outerLoop;
        }
      }

      if (skipTool) continue;

      totalToolCalls++;
      const toolStart = Date.now();

      // Mark tool start for stale run grace period
      db.update(agentRuns)
        .set({ lastToolStartedAt: new Date() })
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, 'running')))
        .catch((err) => {
          logger.warn('tool_start_update_failed', { runId, tool: toolCall.name, error: err instanceof Error ? err.message : String(err) });
        });

      const inputHash = hashToolCall(toolCall.name, toolCall.input);
      mwCtx.toolCallHistory.push({ name: toolCall.name, inputHash, iteration });

      let resultContent: string;
      const { result, error, retried } = await executeWithRetry(async () => {
        return skillExecutor.execute({
          skillName: toolCall.name,
          input: toolCall.input,
          context: skillExecutionContext,
        });
      }, { actionType: toolCall.name });

      if (error) {
        resultContent = JSON.stringify({
          success: false,
          error: error.message,
          error_type: error.type,
          error_category: error.category,
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
          iterationSpan.end({ output: { phase, postToolStop: true } });
          emitLoopTermination('middleware_stop', {
            iteration, middlewareName: mw.name, totalToolCalls,
          });
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

    messages.push(tagIteration({
      role: 'user',
      content: toolResults.map(tr => ({
        type: 'tool_result' as const,
        tool_use_id: tr.tool_use_id,
        content: tr.content,
      })),
    }, iteration));

    iterationSpan.end({ output: { phase, toolCallsThisIteration: response.toolCalls?.length ?? 0 } });

    // Check if we've hit the max iteration limit
    if (iteration >= MAX_LOOP_ITERATIONS - 1) {
      emitLoopTermination('max_iterations', { iteration, totalToolCalls });
    }
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

async function buildOrgTeamRoster(organisationId: string, currentAgentId: string): Promise<string | null> {
  const { orgAgentConfigs } = await import('../db/schema/index.js');
  const roster = await db
    .select({
      agentId: agents.id,
      agentName: agents.name,
      agentDescription: agents.description,
    })
    .from(orgAgentConfigs)
    .innerJoin(agents, eq(agents.id, orgAgentConfigs.agentId))
    .where(
      and(
        eq(orgAgentConfigs.organisationId, organisationId),
        eq(orgAgentConfigs.isActive, true),
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
