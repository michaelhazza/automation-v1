import { createHash } from 'crypto';
import { eq, and, desc, isNull, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import {
  agents,
  subaccounts,
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
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import type { ProviderTool } from './providers/types.js';
import {
  selectExecutionPhase,
  validateToolCalls,
  buildMiddlewareContext,
  serialiseMiddlewareContext,
  buildResumeContext,
  parsePlan,
  isComplexRun,
  mutateActiveToolsPreservingUniversal,
} from './agentExecutionServicePure.js';
import { reorderToolsByTopicRelevance } from './topicClassifierPure.js';
import { HARD_REMOVAL_CONFIDENCE_THRESHOLD } from '../config/limits.js';
import { UNIVERSAL_SKILL_NAMES } from '../config/universalSkills.js';
import {
  appendMessage as appendAgentRunMessage,
  streamMessages as streamAgentRunMessages,
} from './agentRunMessageService.js';
import { project as projectToolCallsLogFromMessages } from './toolCallsLogProjectionService.js';
import { fingerprint } from './regressionCaptureServicePure.js';
import type { AgentRunCheckpoint } from './middleware/types.js';
import type { SubaccountAgent } from '../db/schema/index.js';
import { skillExecutor } from './skillExecutor.js';
import { workspaceMemoryService, agentRoleToDomain } from './workspaceMemoryService.js';
import * as memoryBlockService from './memoryBlockService.js';
import { agentBriefingService } from './agentBriefingService.js';
import { subaccountStateSummaryService } from './subaccountStateSummaryService.js';
import { triggerService } from './triggerService.js';
import {
  createDefaultPipeline,
  hashToolCall,
  executeWithRetry,
  checkWorkspaceLimits,
  type MiddlewareContext,
  type MiddlewarePipeline,
} from './middleware/index.js';
import { isFailureError } from '../../shared/iee/failure.js';
import { maskObservations, tagIteration } from './middleware/observationMasking.js';
import {
  MAX_LOOP_ITERATIONS,
  WRAP_UP_MAX_TOKENS,
  TOKEN_INPUT_RATIO,
  TOKEN_OUTPUT_RATIO,
  MAX_CROSS_AGENT_TASKS,
  MAX_TOOL_OUTPUT_LOG_LENGTH,
} from '../config/limits.js';
import { emitAgentRunUpdate, emitSubaccountUpdate, emitOrgUpdate, emitAgentRunPlan } from '../websocket/emitters.js';
// orgAgentConfigService import removed — deprecated post-migration 0106
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
  subaccountId?: string | null;
  subaccountAgentId?: string | null;
  organisationId: string;
  /**
   * Execution scope. Always 'subaccount' after the org subaccount refactor.
   * Kept for backward compatibility with historical agent_runs records.
   * @deprecated — all runs are subaccount-scoped post-migration 0106
   */
  executionScope?: 'subaccount';
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
  /**
   * Brain Tree OS adoption P1 — when true, the executor looks up the most
   * recent terminal run with a non-null handoff for the same agent and
   * scope, and injects its handoff into the initial message under a
   * "## Previous Session" block. Default false. Only manual / continue-from
   * UX paths should set this to true; scheduled and triggered runs should
   * leave it false to avoid stale-context poisoning.
   */
  seedFromPreviousRun?: boolean;
  /**
   * Playbook agent_decision steps: rendered decision envelope injected at the
   * end of the system prompt so the agent sees branch options and output schema.
   * Spec: docs/playbook-agent-decision-step-spec.md §17.
   */
  systemPromptAddendum?: string;
  /**
   * Playbook agent_decision steps: when set to an empty array, the agent runs
   * with no tools (pure reasoning only). If omitted, the agent's configured
   * skill set is used.
   */
  allowedToolSlugs?: string[];
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
    // Post-migration 0106: all runs are subaccount-scoped. Both fields are required.
    // Use Error instances (not plain objects) so background callers that check
    // `err instanceof Error` (scheduledTaskService, subtaskWakeupService, etc.)
    // can read err.message. asyncHandler also accepts Error with statusCode/errorCode
    // as extra properties.
    if (!request.subaccountId) {
      const err = Object.assign(new Error('All agent runs require a subaccountId'), { statusCode: 400, errorCode: 'MISSING_SUBACCOUNT_ID' });
      throw err;
    }
    if (!request.subaccountAgentId) {
      const err = Object.assign(new Error('All agent runs require a subaccountAgentId post-migration'), { statusCode: 400, errorCode: 'MISSING_SUBACCOUNT_AGENT_ID' });
      throw err;
    }

    // ── 0b. General org execution kill switch ───────────────────────────
    // Applies to ALL runs (org subaccount and regular subaccounts alike).
    const [orgForKillSwitch] = await db
      .select({ executionEnabled: organisations.orgExecutionEnabled })
      .from(organisations)
      .where(eq(organisations.id, request.organisationId));
    if (orgForKillSwitch && !orgForKillSwitch.executionEnabled) {
      return {
        runId: '',
        status: 'failed',
        summary: null,
        totalToolCalls: 0,
        totalTokens: 0,
        durationMs: Date.now() - startTime,
        tasksCreated: 0,
        tasksUpdated: 0,
        deliverablesCreated: 0,
      };
    }

    // ── 0c. Check if this is an org subaccount run (for cross-subaccount access control) ─
    const [subaccountRow] = await db
      .select({ isOrgSubaccount: subaccounts.isOrgSubaccount })
      .from(subaccounts)
      // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT to check isOrgSubaccount flag; subaccountId comes from authenticated agent run request already validated upstream"
      .where(eq(subaccounts.id, request.subaccountId!));
    const isOrgSubaccountRun = subaccountRow?.isOrgSubaccount ?? false;

    // ── 0d. Idempotency check — return existing run if key already used ───
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
    const [run] = await db
      .insert(agentRuns)
      .values({
        organisationId: request.organisationId,
        subaccountId: request.subaccountId,
        agentId: request.agentId,
        subaccountAgentId: request.subaccountAgentId ?? null,
        idempotencyKey: request.idempotencyKey ?? null,
        runType: request.runType,
        executionMode: request.executionMode ?? 'api',
        executionScope: 'subaccount',
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
    emitSubaccountUpdate(request.subaccountId!, 'live:agent_started', {
      runId: run.id, agentId: request.agentId,
    });

    // Observability: temporary metric for org subaccount runs (remove after 2 weeks stable)
    if (isOrgSubaccountRun) {
      logger.info('org_subaccount_run', {
        orgId: request.organisationId,
        agentId: request.agentId,
        runId: run.id,
        runType: request.runType,
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

      // Single config path — all runs load from subaccountAgents
      let saLink: typeof subaccountAgents.$inferSelect | null = null;

      {
        const [link] = await db
          .select()
          .from(subaccountAgents)
          .where(eq(subaccountAgents.id, request.subaccountAgentId!));

        if (!link) throw Object.assign(new Error('Subaccount agent link not found'), { statusCode: 404, errorCode: 'SUBACCOUNT_AGENT_NOT_FOUND' });
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
        executionScope: 'subaccount' as const,
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
      const limitCheck = await checkWorkspaceLimits(request.subaccountId!, tokenBudget);
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
          if (readDataSourceSkill.instructions) {
            systemSkillInstructions.push(readDataSourceSkill.instructions);
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
      } else {
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

      // Layer 2a: Shared memory blocks (P4.2 — Letta pattern)
      // Queried once at run start and cached for the run duration.
      const memoryBlocksForPrompt = await memoryBlockService.getBlocksForAgent(
        request.agentId,
        request.organisationId,
      );
      const memoryBlocksSection = memoryBlockService.formatBlocksForPrompt(memoryBlocksForPrompt);
      if (memoryBlocksSection) {
        systemPromptParts.push(`\n\n---\n${memoryBlocksSection}`);
      }

      // Layer 2b: Org skill instructions
      if (skillInstructions.length > 0) {
        systemPromptParts.push(`\n\n---\n## Your Capabilities\n${skillInstructions.join('\n\n')}`);
      }

      // Layer 3: Custom instructions (from subaccount link or org config)
      if (configCustomInstructions) {
        systemPromptParts.push(`\n\n---\n## Additional Instructions\n${configCustomInstructions}`);
      }

      // Add team roster (loaded fresh from DB every run)
      // Team roster is placed in the stable prefix (changes only on agent config edit)
      const teamRoster = await buildTeamRoster(request.subaccountId!, request.agentId);
      if (teamRoster) {
        systemPromptParts.push(`\n\n---\n## Your Team\nYou can reassign tasks to or create tasks for any of these agents:\n${teamRoster}`);
      }

      // ── Stable/dynamic split for multi-breakpoint prompt caching (Phase 0C) ──
      // Sections 1-6 + team roster = stablePrefix (cached across runs)
      // Briefing, task instructions, manifest, memory, entities, board, autonomous = dynamicSuffix
      const stablePrefix = systemPromptParts.join('');
      const dynamicParts: string[] = [];

      // Phase 2D: Agent briefing — compact cross-run summary (dynamic — updates after each run)
      try {
        const briefing = await agentBriefingService.get(
          request.organisationId,
          request.subaccountId!,
          request.agentId,
        );
        if (briefing) {
          dynamicParts.push(`\n\n---\n## Your Briefing\n${briefing}`);
        }
      } catch {
        // Non-fatal — agent runs fine without a briefing
      }

      // Layer 3.5: Task Instructions (dynamic — changes per scheduled task)
      if (runContextData.taskInstructions) {
        dynamicParts.push(
          `\n\n---\n## Task Instructions\nYou are executing a recurring task. Follow these instructions precisely:\n\n${runContextData.taskInstructions}`
        );
      }

      // Layer 3.6: Available Context Sources — the lazy manifest (dynamic — varies per run)
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

        dynamicParts.push(
          `\n\n---\n## Available Context Sources\nThe following additional reference materials are available. Use the \`read_data_source\` tool to fetch any of them on demand:\n\n${manifestLines}${elidedNote}`
        );
      }

      // Add workspace memory (with prompt injection boundaries)
      // Pass task context for semantic retrieval when available
      const taskContextForMemory = targetItem
        ? `${targetItem.title ?? ''}${targetItem.description ? ' ' + targetItem.description : ''}`
        : undefined;

      const agentDomain = agentRoleToDomain(agent.agentRole) ?? undefined;
      let memory: string | null = null;
      memory = await workspaceMemoryService.getMemoryForPrompt(
        request.organisationId,
        request.subaccountId!,
        taskContextForMemory,
        agentDomain,
      );
      if (memory) {
        dynamicParts.push(`\n\n---\n## Workspace Memory\n${memory}`);
      }

      const entities = await workspaceMemoryService.getEntitiesForPrompt(
        request.subaccountId!,
        request.organisationId,
      );
      if (entities) {
        dynamicParts.push(`\n\n---\n## Known Workspace Entities\n${entities}`);
      }

      if (workspaceContext) {
        dynamicParts.push(`\n\n---\n## Current Board\n${workspaceContext}`);
      }

      // Phase 3B: Subaccount state summary — operational snapshot (task counts, run stats)
      try {
        const stateSummary = await subaccountStateSummaryService.getOrGenerate(
          request.organisationId,
          request.subaccountId!,
        );
        if (stateSummary) {
          dynamicParts.push(`\n\n---\n${stateSummary}`);
        }
      } catch {
        // Non-fatal — agent runs fine without the state summary
      }

      dynamicParts.push(buildAutonomousInstructions(request, targetItem));

      // agent_decision steps inject a structured decision envelope at the end
      // of the system prompt so the agent sees branch options and output schema.
      if (request.systemPromptAddendum) {
        dynamicParts.push(`\n\n---\n${request.systemPromptAddendum}`);
      }

      const dynamicSuffix = dynamicParts.join('');
      const fullSystemPrompt = stablePrefix + dynamicSuffix;
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
          systemPrompt: fullSystemPrompt, // Claude Code runner uses flat string
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

        // agent_decision steps restrict the tool list to prevent side effects.
        // allowedToolSlugs: [] means no tools (pure reasoning). When undefined,
        // the full enhancedTools list is used (normal agent behavior).
        const effectiveTools =
          request.allowedToolSlugs !== undefined
            ? enhancedTools.filter(t => (request.allowedToolSlugs as string[]).includes(t.name))
            : enhancedTools;

        // Run fingerprint (Section 8.3)
        const skillSlugs = effectiveTools.map(t => t.name);
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
            systemPrompt: { stablePrefix, dynamicSuffix },
            tools: effectiveTools,
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
            isOrgSubaccountRun,
            agentDomain,
            // Sprint 3 P2.1 Sprint 3A — stable fingerprint of the resolved
            // config, stamped onto every checkpoint so the resume path can
            // refuse to resume runs whose config has drifted.
            configVersion: fingerprint(resolvedConfig),
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

          langfuse.flushAsync().catch(() => {}); // guard-ignore: no-silent-failures reason="fire-and-forget telemetry flush"

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

      // Brain Tree OS adoption P1 — build the structured handoff document
      // and persist it. Best-effort: a build failure logs and leaves the
      // column null. The run completion above is the source-of-truth state
      // change; this is a follow-up enrichment.
      try {
        const { buildHandoffForRun } = await import('./agentRunHandoffService.js');
        const handoff = await buildHandoffForRun(run.id, request.organisationId);
        if (handoff !== null) {
          await db.update(agentRuns)
            .set({ handoffJson: handoff })
            .where(eq(agentRuns.id, run.id));
        }
      } catch (err) {
        logger.warn('agent_runs.handoff_build_failed', {
          runId: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // H-5: upsert toolCallsLog into the snapshot table
      await db.insert(agentRunSnapshots)
        .values({ runId: run.id, toolCallsLog: loopResult.toolCallsLog })
        .onConflictDoUpdate({
          target: agentRunSnapshots.runId,
          set: { toolCallsLog: loopResult.toolCallsLog },
        });

      // Sprint 3 P2.1 Sprint 3A — project the legacy toolCallsLog shape
      // from the append-only agent_run_messages log as an observability
      // check. The inline writer above is still the Sprint 3A source of
      // truth; this side call validates that the projection path is
      // consistent so Sprint 3B can drop the inline writer safely.
      //
      // Best-effort: any projection failure is logged and swallowed —
      // it must never block run completion or fail the request.
      try {
        const projected = await projectToolCallsLogFromMessages(run.id, request.organisationId);
        const inlineCount = loopResult.toolCallsLog.length;
        const projectedCount = projected.length;
        if (inlineCount !== projectedCount) {
          logger.warn('agent_run_messages.projection_mismatch', {
            runId: run.id,
            inlineCount,
            projectedCount,
          });
        }
      } catch (err) {
        logger.warn('agent_run_messages.projection_failed', {
          runId: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Update lastRunAt on subaccount_agents
      if (request.subaccountAgentId) {
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
      emitSubaccountUpdate(request.subaccountId!, 'live:agent_completed', {
        runId: run.id, agentId: request.agentId, status: finalStatus,
      });

      // ── 10. Extract insights for workspace memory + entities ─────────────
      if (loopResult.summary) {
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

        // Phase 2D: Enqueue agent briefing update (non-blocking, pg-boss only)
        import('./queueService.js').then(({ queueService }) => {
          if ('send' in queueService) {
            (queueService as { send: (q: string, d: object) => Promise<unknown> }).send('agent-briefing-update', {
              organisationId: request.organisationId,
              subaccountId: request.subaccountId,
              agentId: request.agentId,
              runId: run.id,
              handoffJson: { summary: loopResult.summary, status: finalStatus },
            }).catch((err: unknown) => {
              console.error(`[AgentExecution] Briefing job enqueue failed for run ${run.id}:`, err instanceof Error ? err.message : String(err));
            });
          } else {
            // In-memory mode: run briefing update directly (fire-and-forget)
            agentBriefingService.updateAfterRun(
              request.organisationId,
              request.subaccountId!,
              request.agentId,
              run.id,
              { summary: loopResult.summary, status: finalStatus },
            ).catch((err: unknown) => {
              console.error(`[AgentExecution] Briefing update failed for run ${run.id}:`, err instanceof Error ? err.message : String(err));
            });
          }
        }).catch((err: unknown) => {
          // fire-and-forget: dynamic import failure is non-fatal (in-memory mode fallback)
          console.warn('[AgentExecution] Briefing enqueue import failed:', err instanceof Error ? err.message : String(err));
        });
      }

      // ── 11. Fire agent_completed triggers (non-blocking) ─────────────────
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
      emitSubaccountUpdate(request.subaccountId!, 'live:agent_completed', {
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
// resumeAgentRun — Sprint 3 P2.1 Sprint 3A library entry point
//
// Reads an `agent_runs` row + its checkpoint payload + the persisted
// message log, validates the `configVersion` against the current
// `configSnapshot` (unless `useLatestConfig` is true), and returns the
// structured state that the Sprint 3B async resume path will hand to
// `runAgenticLoop` via its `startingIteration` + pre-seeded context
// parameters.
//
// Sprint 3A exposes this as a callable library function but does NOT
// wire it to an HTTP endpoint or pg-boss job — that is Sprint 3B. The
// function exists in this sprint so:
//
//   * The schema + projection + resume state are provably consistent
//     end-to-end under unit test (Sprint 3B inherits a tested primitive).
//   * Sprint 3B has a small, concrete surface to integrate with.
//   * The `startingIteration` param on `runAgenticLoop` is exercised by
//     at least one caller, catching signature drift at compile time.
//
// MUST be called inside an active `withOrgTx` block — it uses the
// message service read path which depends on the org-scoped tx.
// ---------------------------------------------------------------------------

export interface ResumeAgentRunOptions {
  /**
   * When `true`, skip the `configVersion` equality check and rehydrate
   * against whatever `configSnapshot` the `agent_runs` row currently
   * has. Used by admin "force-resume" tooling for debugging. Default
   * `false` — a config drift is a hard refusal.
   */
  useLatestConfig?: boolean;
}

export interface ResumeAgentRunResult {
  /** The checkpoint payload that was read from `agent_run_snapshots`. */
  checkpoint: AgentRunCheckpoint;
  /** The rehydrated middleware context, ready to hand to `runAgenticLoop`. */
  middlewareContext: MiddlewareContext;
  /** Raw messages streamed from `agent_run_messages`. */
  messages: Array<{
    sequenceNumber: number;
    role: 'assistant' | 'user' | 'system';
    content: unknown;
  }>;
  /**
   * Whether the stored `configVersion` matches the live configSnapshot
   * fingerprint. Always `true` when the function returns — if they
   * disagree and `useLatestConfig` is false the call throws instead.
   */
  configVersionMatches: boolean;
}

export async function resumeAgentRun(
  runId: string,
  options: ResumeAgentRunOptions = {},
): Promise<ResumeAgentRunResult> {
  const { useLatestConfig = false } = options;

  // MUST run inside an active withOrgTx block — we use getOrgScopedDb
  // for every read below so a caller that forgets the surrounding
  // transaction fails closed with `missing_org_context` instead of
  // silently returning zero rows under RLS.
  const tx = getOrgScopedDb('agentExecutionService.resumeAgentRun');

  // ── 1. Load the run row — establishes org context + config ──────
  // Defence-in-depth: the ALS context is the authoritative org scope
  // for RLS, but every other read site in this service layers an
  // explicit `organisationId` predicate on top. We cannot layer one
  // here without the caller knowing the org, so we rely on the
  // surrounding tx's RLS policy to keep cross-org reads from leaking.
  const [runRow] = await tx.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!runRow) {
    throw new Error(`resumeAgentRun: run ${runId} not found`);
  }

  // ── 2. Load the checkpoint ───────────────────────────────────────
  // `agent_run_snapshots` has no direct `organisation_id` column —
  // cross-org isolation is enforced by the FK cascade from
  // `agent_runs` (the parent row we already validated above) plus the
  // RLS policy that joins through that FK. No explicit org filter is
  // possible or needed here.
  const [snapshotRow] = await tx
    .select()
    .from(agentRunSnapshots)
    .where(eq(agentRunSnapshots.runId, runId));
  if (!snapshotRow || !snapshotRow.checkpoint) {
    throw new Error(`resumeAgentRun: no checkpoint recorded for run ${runId}`);
  }
  const checkpoint = snapshotRow.checkpoint as AgentRunCheckpoint;

  if (checkpoint.version !== 1) {
    throw new Error(
      `resumeAgentRun: checkpoint version=${checkpoint.version} is not supported by this runtime (expected 1).`,
    );
  }

  // ── 3. configVersion drift check ─────────────────────────────────
  const liveConfigVersion = runRow.configSnapshot
    ? fingerprint(runRow.configSnapshot)
    : '';
  if (!useLatestConfig && liveConfigVersion !== checkpoint.configVersion) {
    throw new Error(
      `resumeAgentRun: configVersion drift — checkpoint=${checkpoint.configVersion}, live=${liveConfigVersion}. Re-run with useLatestConfig=true to override (admin only).`,
    );
  }

  // ── 4. Stream persisted messages up to the checkpoint cursor ─────
  // `messageCursor < 0` is the "no messages written yet" sentinel
  // (see persistCheckpoint). Skip the stream call in that case — a
  // range read with `toSequence = -1` would match nothing anyway, but
  // we want the intent to be explicit so a future maintainer reading
  // a resume trace doesn't second-guess the empty array.
  const messageRows =
    checkpoint.messageCursor < 0
      ? []
      : await streamAgentRunMessages(runId, runRow.organisationId, {
          fromSequence: 0,
          toSequence: checkpoint.messageCursor,
        });

  // ── 5. Load the agent + saLink so we can build a live MiddlewareContext ──
  const agent = await agentService.getAgent(runRow.agentId, runRow.organisationId);

  // Subaccount runs carry a subaccountAgent link; org runs do not. The
  // Sprint 3B async resume path needs the same saLink shape the original
  // executeRun passed to runAgenticLoop; Sprint 3A leaves a minimal stub
  // for org runs since the library entry point is not called from any
  // production code path yet.
  let saLink: SubaccountAgent;
  if (runRow.subaccountAgentId) {
    const [link] = await tx
      .select()
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.id, runRow.subaccountAgentId),
          eq(subaccountAgents.organisationId, runRow.organisationId),
        ),
      );
    if (!link) {
      throw new Error(
        `resumeAgentRun: subaccount_agent ${runRow.subaccountAgentId} not found for run ${runId}`,
      );
    }
    saLink = link;
  } else {
    // Org-scope runs do not have a subaccountAgents row. Sprint 3B will
    // widen the resume path to accept a union shape; for 3A we cast an
    // empty object because the library entry point is not yet invoked
    // against org-scope runs in production.
    saLink = {} as SubaccountAgent;
  }

  const middlewareContext = buildResumeContext({
    checkpoint,
    runId,
    // Sprint 3B will rebuild a real AgentRunRequest from the triggerContext
    // + run row. For 3A the library caller is the unit test harness, so an
    // empty-ish request is sufficient.
    request: {
      agentId: runRow.agentId,
      organisationId: runRow.organisationId,
      subaccountId: runRow.subaccountId ?? undefined,
      runType: runRow.runType,
      executionScope: 'subaccount' as const,
    } as AgentRunRequest,
    agent: {
      modelId: agent.modelId,
      temperature: agent.temperature ?? 0,
      maxTokens: agent.maxTokens ?? 4096,
    },
    saLink,
    // Wall-clock state is re-initialised on every resume — the original
    // run's startTime is meaningless on a different worker. The budget
    // middleware uses the checkpoint's persisted tokensUsed /
    // toolCallsCount (restored by buildResumeContext) to pick up where
    // the original run left off against the SAME per-iteration limits.
    //
    // Sprint 3A stubs `tokenBudget`, `maxToolCalls`, and `timeoutMs` at
    // neutral values because the library entry point is not yet exposed
    // over HTTP or pg-boss. Sprint 3B re-derives them from
    // `runRow.resolvedLimits` (or re-runs limit resolution with the
    // live agent config) so the resumed iteration sees the same ceilings
    // the original iteration did.
    startTime: Date.now(),
    tokenBudget: runRow.tokenBudget ?? 0,
    maxToolCalls: 0,
    timeoutMs: 0,
  });

  return {
    checkpoint,
    middlewareContext,
    messages: messageRows.map((row) => ({
      sequenceNumber: row.sequenceNumber,
      role: row.role,
      content: row.content,
    })),
    configVersionMatches: liveConfigVersion === checkpoint.configVersion,
  };
}

// ---------------------------------------------------------------------------
// The agentic loop — calls LLM, handles tool calls, repeats until done
// ---------------------------------------------------------------------------

interface LoopParams {
  runId: string;
  agent: { modelId: string; modelProvider: string; temperature: number; maxTokens: number; complexityHint?: string | null };
  routerCtx: Omit<LLMCallContext, 'taskType' | 'provider' | 'model' | 'executionPhase' | 'routingMode'>;
  systemPrompt: string | { stablePrefix: string; dynamicSuffix: string };
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
  /**
   * Sprint 3 P2.1 Sprint 3A — fingerprint of `agent_runs.configSnapshot`.
   * Stamped onto every checkpoint so the Sprint 3B resume path can refuse
   * to resume a run whose configuration has drifted. Computed by
   * executeRun via `fingerprint(resolvedConfig)` so runAgenticLoop does
   * not need to redo the hash per iteration.
   */
  configVersion: string;
  /**
   * Sprint 3 P2.1 Sprint 3A — iteration index to begin the outer loop at.
   * Default 0 for a fresh run. The resume path (Sprint 3B) will pass the
   * checkpoint's `iteration + 1` along with pre-seeded `messages`,
   * `mwCtx`, and running counters; 3A wires the parameter so the loop
   * API is resume-ready even though the resume wiring itself lands in
   * the next sprint.
   */
  startingIteration?: number;
  /** Whether this run is in the org subaccount (affects cross-subaccount access control). */
  isOrgSubaccountRun?: boolean;
  /** Phase 2C: agent's memory domain derived from agentRole. */
  agentDomain?: string;
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

// Tool call validation + phase selection + middleware-context construction
// are pure helpers extracted to agentExecutionServicePure.ts per P0.1 Layer 3
// of docs/improvements-roadmap-spec.md. Imported at the top of this file.

async function runAgenticLoop(params: LoopParams): Promise<LoopResult> {
  const {
    runId, agent, routerCtx, systemPrompt, tools: initialTools, tokenBudget,
    maxToolCalls, timeoutMs, startTime, request, orgProcesses,
    saLink, pipeline, mcpClients, mcpLazyRegistry, runContextData,
    configVersion, agentDomain,
  } = params;
  const startingIteration = params.startingIteration ?? 0;

  // Sprint 5 P4.1 — mutable tool list; topic filter may narrow it on iteration 0
  let tools = initialTools;

  // Sprint 3 P2.1 Sprint 3A — highest persisted sequence_number for this run.
  // Initialised to -1 and updated after every successful appendMessage call
  // so `persistCheckpoint` below can stamp the correct `messageCursor`. The
  // resume path asserts that every sequence_number in the window
  // `[0, messageCursor]` is present before rehydrating.
  let messageCursor = -1;

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
    // Org subaccount agents get full cross-subaccount access; regular agents are scoped
    allowedSubaccountIds: params.isOrgSubaccountRun ? null : (request.subaccountId ? [request.subaccountId] : null),
    agentId: request.agentId,
    agentDomain,
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

  try { // Expanded try/finally scope — guarantees traceThrottle.destroy() even
        // if middleware setup, seed-from-previous, or planning prelude throws.

  const mwCtx: MiddlewareContext = buildMiddlewareContext({
    runId,
    request,
    agent,
    saLink,
    startTime,
    tokenBudget,
    maxToolCalls,
    timeoutMs,
  });

  // Brain Tree OS adoption P1 — optional previous-session seeding.
  // When the caller passes seedFromPreviousRun=true (manual / continue-from
  // UX paths), look up the most recent handoff and prepend it. Best-effort:
  // any failure logs and skips the seeding.
  let previousSessionBlock: string | null = null;
  if (request.seedFromPreviousRun) {
    try {
      const { getLatestHandoffForAgent } = await import('./agentRunHandoffService.js');
      const previous = await getLatestHandoffForAgent({
        agentId: request.agentId,
        organisationId: request.organisationId,
        subaccountId: request.subaccountId ?? null,
        excludeRunId: runId,
      });
      if (previous) {
        previousSessionBlock = formatPreviousSessionBlock(previous.handoff);
      }
    } catch (err) {
      logger.warn('agent_runs.seed_previous_handoff_failed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const initialMessage = buildInitialMessage(request, previousSessionBlock);
  const messages: LLMMessage[] = [{ role: 'user', content: initialMessage }];

  let lastTextContent = '';
  let previousResponseHadToolCalls = false;

  // ── Sprint 5 P4.3: Planning prelude for complex runs ─────────────
  // For runs classified as "complex", emit a planning call before the
  // main loop. The plan is persisted to agent_runs.plan_json and
  // injected as a system reminder so the agent stays anchored.
  if (startingIteration === 0) {
    const shouldPlan = isComplexRun({
      complexityHint: agent.complexityHint ?? null,
      messageWordCount: initialMessage.split(/\s+/).length,
      skillCount: tools.length,
    });

    if (shouldPlan) {
      try {
        const planningPrompt = `You are in PLANNING mode. Output a JSON plan describing the actions you intend to take. Do NOT execute any tools yet. Your response must be a JSON object with an "actions" array where each item has "tool" (the tool name) and "reason" (why you need it).\n\nExample: { "actions": [{ "tool": "read_inbox", "reason": "Check for new emails" }, { "tool": "create_task", "reason": "File a bug for the issue found" }] }`;

        const planMessages: LLMMessage[] = [
          { role: 'user', content: `${initialMessage}\n\n${planningPrompt}` },
        ];

        const planResponse = await routeCall({
          messages: planMessages,
          system: systemPrompt,
          tools: undefined, // No tools during planning
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          estimatedContextTokens: 0,
          context: {
            ...routerCtx,
            taskType: 'general',
            executionPhase: 'planning' as const,
            provider: agent.modelProvider,
            model: agent.modelId,
            routingMode: 'ceiling' as const,
          },
        });

        const planContent = planResponse.content;
        const plan = parsePlan(planContent);
        if (plan) {
          // Persist the plan
          await db
            .update(agentRuns)
            .set({ planJson: plan, updatedAt: new Date() })
            .where(eq(agentRuns.id, runId));

          // Emit WS event
          emitAgentRunPlan(runId, { plan });

          // Inject the plan as a system reminder in the message history
          const planSummary = plan.actions
            .map((a, i) => `${i + 1}. ${a.tool}${a.reason ? ` — ${a.reason}` : ''}`)
            .join('\n');
          messages.push({
            role: 'user',
            content: `<system-reminder>\nYou created this plan. Execute it step by step:\n${planSummary}\n</system-reminder>`,
          });

          // Track token usage from the planning call
          totalTokensUsed += (planResponse.tokensIn ?? 0) + (planResponse.tokensOut ?? 0);
        }
      } catch (planError) {
        // Planning failure is non-fatal — fall through to the normal loop
        console.warn(`[P4.3] Planning prelude failed for run ${runId}:`, planError);
      }
    }
  }

  outerLoop:
  for (let iteration = startingIteration; iteration < MAX_LOOP_ITERATIONS; iteration++) {
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

    // Sprint 5 P4.1 — apply topic-based tool filtering after preCall middleware.
    // If the topic filter stashed matching skills on the context, apply the
    // filter. Only runs on iteration 0 to avoid re-filtering on every turn.
    if (iteration === 0) {
      const topicClassification = (mwCtx as unknown as Record<string, unknown>)._topicClassification as
        { confidence: number } | undefined;
      const topicMatchingSkills = (mwCtx as unknown as Record<string, unknown>)._topicMatchingSkills as
        string[] | undefined;

      if (topicClassification && topicMatchingSkills && topicClassification.confidence >= HARD_REMOVAL_CONFIDENCE_THRESHOLD) {
        const matchSet = new Set(topicMatchingSkills);
        tools = mutateActiveToolsPreservingUniversal(
          tools as unknown as ProviderTool[],
          (t) => t.filter((tool) => matchSet.has(tool.name)),
          tools as unknown as ProviderTool[],
        ) as unknown as typeof tools;
        logger.debug('topic_filter.hard_removal', {
          runId, iteration, kept: tools.length, matchingSkills: topicMatchingSkills.length,
        });
      } else if (topicClassification && topicMatchingSkills && topicClassification.confidence > 0) {
        // Soft reorder — matching tools move to front, nothing removed
        const coreSkills = UNIVERSAL_SKILL_NAMES as unknown as string[];
        tools = reorderToolsByTopicRelevance(
          tools as unknown as ProviderTool[],
          topicMatchingSkills,
          coreSkills,
        ) as unknown as typeof tools;
      }
    }

    // Emit iteration event for live trace (throttled to max 2/sec)
    traceThrottle.emit('agent:run:iteration', {
      iteration, tokensUsed: totalTokensUsed, toolCallsCount: totalToolCalls,
    });

    // Determine execution phase for this iteration via pure helper.
    const phase = selectExecutionPhase(iteration, previousResponseHadToolCalls, totalToolCalls);

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

    // Sprint 3 P2.1 Sprint 3A — mirror the assistant message into the
    // append-only `agent_run_messages` log. Best-effort in 3A: a persistence
    // failure is logged but does not terminate the run. Sprint 3B tightens
    // this into a hard invariant when the async resume path lands.
    try {
      const appended = await appendAgentRunMessage({
        runId,
        organisationId: request.organisationId,
        role: 'assistant',
        content: assistantBlocks,
        toolCallId: null,
      });
      messageCursor = appended.sequenceNumber;
    } catch (err) {
      logger.warn('agent_run_messages.append_failed', {
        runId,
        role: 'assistant',
        iteration,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Sprint 3 P2.3 — stash the latest assistant text on mwCtx so preTool
    // middlewares (notably the decision-time guidance / tool_intent
    // confidence extractor) can read it without widening the middleware
    // contract to include the full message array.
    mwCtx.lastAssistantText = response.content ?? undefined;

    // ── Sprint 5 P4.4: Shadow-mode critique gate (postCall phase) ────
    // Fires after the LLM responds but before tool calls execute.
    // In shadow mode, results are logged but execution is never blocked.
    if (response.toolCalls.length > 0) {
      try {
        const { evaluateCritiqueGate } = await import('./middleware/critiqueGate.js');
        const critiqueResult = await evaluateCritiqueGate(
          response.toolCalls.map((tc) => ({ name: tc.name, input: tc.input })),
          {
            runId,
            organisationId: request.organisationId,
            phase,
            wasDowngraded: response.routing?.wasDowngraded ?? false,
            recentMessages: messages.slice(-3).map((m) => ({
              role: typeof m.role === 'string' ? m.role : 'user',
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            })),
            logCritiqueResult: (result) => {
              logger.info('critique_gate_shadow', { runId, ...result });
            },
          },
        );
        if (critiqueResult.hasSuspect) {
          logger.warn('critique_gate_suspect', { runId, results: critiqueResult.results });
        }
      } catch (err) {
        // Shadow mode: critique failures never block execution
        logger.warn('critique_gate_error', { runId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── Execute tool calls ────────────────────────────────────────────
    const toolResults: Array<{ tool_use_id: string; content: string }> = [];
    // Sprint 2 P1.1 Layer 3 — messages queued by `inject_message` middleware
    // decisions or `skip { injectMessage }` side channels. Flushed to the
    // conversation immediately after the tool_results batch for this iteration.
    const pendingInjectedMessages: string[] = [];

    for (const toolCall of response.toolCalls) {
      // Pre-tool middleware
      let skipTool = false;
      for (const mw of pipeline.preTool) {
        const result = await mw.execute(mwCtx, {
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        });
        if (result.action === 'skip') {
          toolResults.push({
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: false, error: result.reason }),
          });
          if (result.injectMessage) {
            pendingInjectedMessages.push(result.injectMessage);
          }
          createEvent('agent.middleware.decision', {
            middlewareName: mw.name, decision: 'skip', reason: result.reason, iteration,
          });
          skipTool = true;
          break;
        }
        if (result.action === 'block') {
          toolResults.push({
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: false, error: result.reason, blocked: true }),
          });
          createEvent('agent.middleware.decision', {
            middlewareName: mw.name, decision: 'block', reason: result.reason, iteration,
          });
          skipTool = true;
          break;
        }
        if (result.action === 'inject_message') {
          // Emit a neutral skipped-tool result so every tool_use has a matching
          // tool_result in the next LLM request, then queue the injected
          // message to be appended after the tool_results batch for this
          // iteration.
          toolResults.push({
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: false, error: 'middleware_injected_message', skipped: true }),
          });
          pendingInjectedMessages.push(result.message);
          createEvent('agent.middleware.decision', {
            middlewareName: mw.name, decision: 'inject_message', iteration,
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
      let result: unknown;
      let error: { message: string; type: string; category: string } | undefined;
      let retried = false;
      try {
        const outcome = await executeWithRetry(async () => {
          return skillExecutor.execute({
            skillName: toolCall.name,
            input: toolCall.input,
            context: skillExecutionContext,
            // Sprint 2 P1.1 Layer 3: thread the LLM tool call id into the
            // skill executor so the per-case action wrappers build the same
            // deterministic idempotency key as proposeActionMiddleware.
            toolCallId: toolCall.id,
          });
        }, { actionType: toolCall.name });
        result = outcome.result;
        error = outcome.error;
        retried = outcome.retried;
      } catch (err) {
        // P0.2 Slice C — onFailure: 'fail_run' throws a FailureError that
        // propagates through executeWithRetry. Terminate the loop cleanly
        // here rather than letting it unwind out of runAgenticLoop, so that
        // (a) accumulated stats and toolCallsLog are preserved, (b) the
        // executeRun finalization path runs (MCP disconnect, trace finalize,
        // DB persist of totals), and (c) finalStatus is recorded as 'failed'.
        // Only fail_run-sourced FailureErrors reach here (errorHandling.ts
        // scopes its rethrow to the same marker). Any other error rethrows.
        if (!isFailureError(err) || err.failure?.metadata?.source !== 'onFailure:fail_run') {
          throw err;
        }
        const failMsg = err.failure?.failureDetail ?? err.message;
        toolCallsLog.push({
          tool: toolCall.name,
          input: toolCall.input,
          output: JSON.stringify({
            success: false,
            error: failMsg,
            failureReason: err.failure?.failureReason,
            fail_run: true,
          }),
          durationMs: Date.now() - toolStart,
          iteration,
          retried: false,
        });
        finalStatus = 'failed';
        iterationSpan.end({ output: { phase, failRun: true, tool: toolCall.name } });
        emitLoopTermination('error', { iteration, tool: toolCall.name, totalToolCalls, reason: 'fail_run' });
        break outerLoop;
      }

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
      // Sprint 3 P2.2 widens PostToolResult to five variants. The switch is
      // exhaustive — adding a new variant will fail compilation at the
      // `assertNever` line until a handler is added here.
      let postToolBreakOuter = false;
      for (const mw of pipeline.postTool) {
        const postResult = await Promise.resolve(mw.execute(
          mwCtx,
          { name: toolCall.name, input: toolCall.input },
          { content: resultContent, durationMs: toolDurationMs }
        ));
        switch (postResult.action) {
          case 'continue':
            if (postResult.content) {
              resultContent = postResult.content;
            }
            break;
          case 'stop':
            finalStatus = postResult.status;
            iterationSpan.end({ output: { phase, postToolStop: true } });
            emitLoopTermination('middleware_stop', {
              iteration, middlewareName: mw.name, totalToolCalls,
            });
            postToolBreakOuter = true;
            break;
          case 'inject_message':
            // Queue the middleware-authored message for the next LLM turn.
            // Drained alongside the Sprint 2 P1.1 Layer 3 queue after the
            // tool_results batch is pushed, so every tool_use has a matching
            // tool_result before the new user message lands.
            pendingInjectedMessages.push(postResult.message);
            createEvent('agent.middleware.decision', {
              middlewareName: mw.name,
              decision: 'inject_message',
              iteration,
            });
            break;
          case 'escalate_to_review':
            // Sprint 3 P2.2 reflection loop exhausted the self-review
            // allowance. Halt the run with a distinct termination reason so
            // the dashboard can tell reflection-exhausted runs apart from
            // generic failures. The review item creation + `awaiting_review`
            // status transition are deferred to Sprint 3B (see
            // docs/improvements-roadmap-spec.md §P2.1 Verdict). In 3A this
            // terminates the run and surfaces the reason via the
            // loop-termination event.
            finalStatus = 'failed';
            iterationSpan.end({
              output: {
                phase,
                postToolEscalate: true,
                escalateReason: postResult.reason,
              },
            });
            emitLoopTermination('middleware_stop', {
              iteration,
              middlewareName: mw.name,
              totalToolCalls,
              escalateReason: postResult.reason,
            });
            createEvent('agent.middleware.decision', {
              middlewareName: mw.name,
              decision: 'escalate_to_review',
              reason: postResult.reason,
              iteration,
            });
            postToolBreakOuter = true;
            break;
          default: {
            const _exhaustive: never = postResult;
            void _exhaustive;
          }
        }
        if (postToolBreakOuter) break;
      }
      if (postToolBreakOuter) break outerLoop;

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

    const toolResultsContent = toolResults.map(tr => ({
      type: 'tool_result' as const,
      tool_use_id: tr.tool_use_id,
      content: tr.content,
    }));
    messages.push(tagIteration({
      role: 'user',
      content: toolResultsContent,
    }, iteration));

    // Sprint 3 P2.1 Sprint 3A — mirror the tool_results batch into the
    // append-only log. A batch carries multiple tool_use_ids so we do not
    // stamp a single top-level tool_call_id (the partial index in migration
    // 0084 only targets single-block rows). Best-effort writes match the
    // assistant-message path above.
    if (toolResultsContent.length > 0) {
      try {
        const appended = await appendAgentRunMessage({
          runId,
          organisationId: request.organisationId,
          role: 'user',
          content: toolResultsContent,
          toolCallId: toolResultsContent.length === 1 ? toolResultsContent[0].tool_use_id : null,
        });
        messageCursor = appended.sequenceNumber;
      } catch (err) {
        logger.warn('agent_run_messages.append_failed', {
          runId,
          role: 'user',
          iteration,
          batchSize: toolResultsContent.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Sprint 2 P1.1 Layer 3 — drain any messages queued by middleware decisions
    // (`inject_message` action, or `skip { injectMessage }`). Appended as
    // additional user messages after the tool_results batch so they reach the
    // next LLM call.
    for (const injected of pendingInjectedMessages) {
      messages.push({ role: 'user', content: injected });

      // Mirror the injected guidance into the append-only log so a resume
      // picks up the same conversation state the live run would have seen.
      try {
        const appended = await appendAgentRunMessage({
          runId,
          organisationId: request.organisationId,
          role: 'user',
          content: injected,
          toolCallId: null,
        });
        messageCursor = appended.sequenceNumber;
      } catch (err) {
        logger.warn('agent_run_messages.append_failed', {
          runId,
          role: 'user',
          iteration,
          kind: 'injected_message',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    iterationSpan.end({ output: { phase, toolCallsThisIteration: response.toolCalls?.length ?? 0 } });

    // Sprint 3 P2.1 Sprint 3A — persist a structured checkpoint capturing
    // everything needed to resume this run on a different worker. Best-effort:
    // a checkpoint write failure is logged but does not kill the live run.
    await persistCheckpoint({
      runId,
      iteration,
      totalToolCalls,
      totalTokensUsed,
      messageCursor,
      mwCtx,
      configVersion,
    });

    // Check if we've hit the max iteration limit — enforce the exit
    if (iteration >= MAX_LOOP_ITERATIONS - 1) {
      finalStatus = finalStatus ?? 'completed';
      emitLoopTermination('max_iterations', { iteration, totalToolCalls });
      break outerLoop;
    }
  }
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

  } finally {
    // Flush any pending throttled trace events before returning — guaranteed
    // cleanup even on early exit (timeout, budget, loop_detected, error).
    traceThrottle.destroy();
  }
}

// ---------------------------------------------------------------------------
// persistCheckpoint — Sprint 3 P2.1 Sprint 3A
//
// Writes a structured `AgentRunCheckpoint` into
// `agent_run_snapshots.checkpoint` once per iteration of `runAgenticLoop`.
// The payload is a JSON-safe snapshot of just enough state to resume the
// run on a different worker: counters, message cursor, serialised
// middleware context, and the config fingerprint the resumer will check.
//
// The helper is best-effort — failures are logged and swallowed so the
// live run is not affected by a checkpoint persistence hiccup. Sprint 3B
// tightens this into a hard invariant once the async resume path is
// wired end-to-end.
// ---------------------------------------------------------------------------

interface PersistCheckpointParams {
  runId: string;
  iteration: number;
  totalToolCalls: number;
  totalTokensUsed: number;
  messageCursor: number;
  mwCtx: MiddlewareContext;
  configVersion: string;
}

async function persistCheckpoint(params: PersistCheckpointParams): Promise<void> {
  try {
    // Build a cloned snapshot context so the live middleware context is
    // never mutated by the checkpoint path — the resume path reads from
    // the serialised copy, and mutating the live object here would make
    // post-iteration middleware reason about shifted counters. The clone
    // is shallow: MiddlewareContext values are either primitives or
    // Maps/objects that `serialiseMiddlewareContext` already deep-copies
    // into the JSON-safe shape.
    const snapshotCtx: MiddlewareContext = {
      ...params.mwCtx,
      iteration: params.iteration,
      tokensUsed: params.totalTokensUsed,
      toolCallsCount: params.totalToolCalls,
    };

    const serialised = serialiseMiddlewareContext(snapshotCtx);

    const checkpoint: AgentRunCheckpoint = {
      version: 1,
      iteration: params.iteration,
      totalToolCalls: params.totalToolCalls,
      totalTokensUsed: params.totalTokensUsed,
      // A fresh run with no messages has `messageCursor = -1` because we
      // initialise the tracker to -1 and only advance it after a
      // successful append. Preserve the -1 sentinel exactly — the
      // resume path reads `messageCursor < 0` as "skip the stream
      // altogether" (see `resumeAgentRun`). Clamping to 0 would
      // conflate "no rows persisted" with "one row at seq 0" and
      // cause the first persisted message to be replayed on resume.
      messageCursor: params.messageCursor,
      middlewareContext: serialised,
      // Resume token is opaque in 3A — 3B wires the enforcement in the
      // admin resume endpoint. Use a hash of runId + iteration so the
      // token is deterministic per iteration but non-trivial to guess
      // from the runId alone.
      resumeToken: createHash('sha256')
        .update(`${params.runId}:${params.iteration}:${params.configVersion}`)
        .digest('hex')
        .slice(0, 32),
      configVersion: params.configVersion,
    };

    await db
      .insert(agentRunSnapshots)
      .values({ runId: params.runId, checkpoint })
      .onConflictDoUpdate({
        target: agentRunSnapshots.runId,
        set: { checkpoint },
      });
  } catch (err) {
    logger.warn('agent_run_checkpoint.persist_failed', {
      runId: params.runId,
      iteration: params.iteration,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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

// buildOrgTeamRoster removed — org agents now run inside the org subaccount
// and use the standard buildTeamRoster() function. See spec §6d.

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

function buildInitialMessage(request: AgentRunRequest, previousSessionBlock?: string | null): string {
  let base: string;
  if (request.taskId) {
    base = `You have a task assigned to you. Please work on it now. The task details are in your system context above.`;
  } else {
    const messages: Record<string, string> = {
      scheduled: 'This is your scheduled run. Check the board, review any tasks assigned to you, and do your job. Take actions based on your role and current board state.',
      manual: 'You have been manually triggered. Check the board and take appropriate actions based on your role.',
      triggered: 'You have been triggered by an event. Check the trigger context and board, then take appropriate actions.',
    };
    base = messages[request.runType] ?? messages.manual;
  }

  // Brain Tree OS adoption P1 — when seedFromPreviousRun is enabled and the
  // caller fetched a previous handoff, prepend a "Previous Session" block so
  // the agent sees its own last handoff before the new instruction.
  if (previousSessionBlock) {
    return `${previousSessionBlock}\n\n${base}`;
  }
  return base;
}

/**
 * Format an AgentRunHandoffV1 as a "Previous Session" markdown block for
 * injection into the initial user message. Imported by runAgenticLoop when
 * `seedFromPreviousRun` is set on the request.
 */
function formatPreviousSessionBlock(handoff: import('./agentRunHandoffServicePure.js').AgentRunHandoffV1): string {
  const lines: string[] = ['## Previous Session', ''];
  if (handoff.accomplishments.length > 0) {
    lines.push('**Accomplishments:**');
    for (const a of handoff.accomplishments) lines.push(`- ${a}`);
    lines.push('');
  }
  if (handoff.decisions.length > 0) {
    lines.push('**Decisions:**');
    for (const d of handoff.decisions) {
      lines.push(d.rationale ? `- ${d.decision} (because ${d.rationale})` : `- ${d.decision}`);
    }
    lines.push('');
  }
  if (handoff.blockers.length > 0) {
    lines.push('**Blockers:**');
    for (const b of handoff.blockers) lines.push(`- [${b.severity}] ${b.blocker}`);
    lines.push('');
  }
  if (handoff.nextRecommendedAction) {
    lines.push(`**Next recommended action:** ${handoff.nextRecommendedAction}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}
