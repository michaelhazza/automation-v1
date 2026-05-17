import { eq, sql } from 'drizzle-orm';
import { agentRuns, agentRunSnapshots, systemAgents, tasks } from '../../../db/schema/index.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { withAdminConnection } from '../../../lib/adminDbConnection.js';
import { buildSystemPrompt, approxTokens, type AnthropicTool } from '../../llmService.js';
import { assembleVoiceBlock } from '../../agentExecutionServicePure.js';
import { buildTeamRoster, buildSmartBoardContext, buildTaskContext, buildAutonomousInstructions } from '../promptBuilders.js';
import { buildThreadContextReadModel } from '../../conversationThreadContextService.js';
import { formatThreadContextBlock, prependThreadContextToBasePrompt } from '../../conversationThreadContextServicePure.js';
import { persistAssembly as persistPromptAssembly } from '../../agentRunPromptService.js';
import { workspaceMemoryService, agentRoleToDomain } from '../../workspaceMemoryService.js';
import * as memoryBlockService from '../../memoryBlockService.js';
import { agentBriefingService } from '../../agentBriefingService.js';
import { agentBeliefService } from '../../agentBeliefService.js';
import { subaccountStateSummaryService } from '../../subaccountStateSummaryService.js';
import * as voiceProfileService from '../../voiceProfile/voiceProfileService.js';
import { skillService } from '../../skillService.js';
import { systemSkillService } from '../../systemSkillService.js';
import { taskService } from '../../taskService.js';
import { tryEmitAgentEvent } from '../../agentExecutionEventEmitter.js';
import { createDefaultPipeline } from '../../middleware/index.js';
import { logger } from '../../../lib/logger.js';
import { createEvent } from '../../../lib/tracing.js';
import type { ThreadContextReadModel } from '../../../../shared/types/conversationThreadContext.js';
import type { AgentRunRequest, RunExecutionContext } from '../types.js';

export async function prepareRun(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<void> {
  const run = ctx.run!;
  const runContextData = ctx.runContextData!;
  const orgProcesses = ctx.orgProcesses!;
  const scopedDb = getOrgScopedDb('prepare.prepareRun');

  // ── 5. Resolve skills → tools + instructions (3-layer) ─────────────
  // Layer 1: System skills (from system agent, if linked)
  let systemSkillTools: AnthropicTool[] = [];
  let systemSkillInstructions: string[] = [];
  let systemAgentRecord: typeof systemAgents.$inferSelect | null = null;

  if (ctx.agent!.systemAgentId) {
    const [sa] = await withAdminConnection(
      { source: 'prepare.prepareRun', reason: 'system_agents is a cross-tenant system table; reads all agents for per-run config lookup' },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return tx.select().from(systemAgents).where(eq(systemAgents.id, ctx.agent!.systemAgentId!));
      },
    );
    if (sa) {
      systemAgentRecord = sa;
      const systemSlugs = (sa.defaultSystemSkillSlugs ?? []) as string[];
      const resolved = await systemSkillService.resolveSystemSkills(systemSlugs);
      systemSkillTools = resolved.tools;
      systemSkillInstructions = resolved.instructions;
    }
  }

  // Layer 2+3: Org skills + sub-account/org skills
  const skillSlugs = ctx.configSkillSlugs!;
  const { tools: skillTools, instructions: skillInstructions, truncated: skillInstructionsTruncated } = await skillService.resolveSkillsForAgent(
    skillSlugs,
    request.organisationId,
    request.subaccountId ?? undefined,
    request.subaccountAgentId ? ctx.hierarchyContext : undefined,  // Pass hierarchy only in subaccount context
  );
  if (skillInstructionsTruncated) {
    logger.warn('[agentExecutionService] Skill instructions were truncated — agent may have reduced capability', {
      organisationId: request.organisationId,
      subaccountId: request.subaccountId,
      skillSlugs,
    });
  }

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
  let mcpClients: Map<string, import('../../mcpClientManager.js').McpClientInstance> | null = null;
  let mcpLazyRegistry: Map<string, import('../../../db/schema/mcpServerConfigs.js').McpServerConfig> | null = null;

  try {
    const { mcpClientManager } = await import('../../mcpClientManager.js');
    const mcp = await mcpClientManager.connectForRun({
      runId: run.id,
      organisationId: request.organisationId,
      agentId: request.agentId,
      subaccountId: request.subaccountId ?? null,
      isTestRun: run.isTestRun ?? false,
    });
    mcpClients = mcp.clients;
    mcpLazyRegistry = mcp.lazyRegistry;
    if (mcp.tools.length > 0) {
      // Defense in depth: cap is also enforced in connectForRun
      const { MAX_MCP_TOOLS_PER_RUN } = await import('../../../config/limits.js');
      const cappedTools = mcp.tools.slice(0, MAX_MCP_TOOLS_PER_RUN);
      enhancedTools.push(...cappedTools);
      logger.info('mcp.tools_loaded', { runId: run.id, mcpToolCount: cappedTools.length, serverCount: mcp.clients.size });
    }
  } catch (err) {
    logger.warn('mcp.connect_failed', { runId: run.id, error: err instanceof Error ? err.message : String(err) });
    // Non-fatal — agent runs without MCP tools
  }

  ctx.mcpClients = mcpClients;
  ctx.mcpLazyRegistry = mcpLazyRegistry;

  // agent_decision steps restrict the tool list to prevent side effects.
  // allowedToolSlugs: [] means no tools (pure reasoning). When undefined,
  // the full enhancedTools list is used (normal agent behavior).
  // Built unconditionally — the api/headless adapters consume it via
  // `loopContext.tools`; other adapters ignore it.
  ctx.effectiveTools =
    request.allowedToolSlugs !== undefined
      ? enhancedTools.filter(t => (request.allowedToolSlugs as string[]).includes(t.name))
      : enhancedTools;

  // Middleware pipeline — used by the in-process agentic loop. Built
  // here (not inside the adapter) because `runAgenticLoop` requires
  // a single instance threaded through every iteration.
  ctx.pipeline = createDefaultPipeline();

  // ── 6. Build task context (with smart offloading) ───────────────────
  let workspaceContext: string;
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

  ctx.workspaceContext = workspaceContext;
  ctx.targetItem = targetItem;

  // ── 7. Build the full system prompt (3-layer assembly) ─────────────
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

  // Append loaded knowledge chunks (auto + always_available modes) to knowledge base.
  for (const item of ctx.knowledgeLoaded ?? []) {
    dataSourceContents.push({
      name: item.documentId ?? item.id,
      description: null,
      content: item.content,
      contentType: 'text',
    });
  }

  // Layer 1: System agent prompt (our IP — invisible to org/sub-account)
  const effectiveMasterPrompt = systemAgentRecord
    ? systemAgentRecord.masterPrompt
    : ctx.agent!.masterPrompt;

  const basePrompt = buildSystemPrompt(
    effectiveMasterPrompt,
    dataSourceContents,
    orgProcesses,
    undefined,
    runContextData.externalDocumentBlocks,
  );

  // ── Thread context injection (A-D1) ─────────────────────────────────────
  // Prepended first — before external docs, memory blocks, and all other
  // augmentation. Spec §2.2 ordering invariant. Fail-open: a build error
  // skips injection rather than aborting the run.
  let effectiveBasePrompt = basePrompt;
  const THREAD_CTX_TIMEOUT = Symbol('timeout');
  const runConvId =
    request.conversationId ??
    (request.triggerContext?.conversationId as string | undefined) ??
    undefined;
  if (runConvId) {
    const _threadCtxStart = Date.now();
    let threadCtx: ThreadContextReadModel | null = null;
    try {
      let _threadCtxTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const ctxResult = await Promise.race<ThreadContextReadModel | typeof THREAD_CTX_TIMEOUT>([
        buildThreadContextReadModel(runConvId, request.organisationId),
        new Promise<typeof THREAD_CTX_TIMEOUT>((resolve) => {
          _threadCtxTimeoutHandle = setTimeout(() => resolve(THREAD_CTX_TIMEOUT), 500);
        }),
      ]);
      if (_threadCtxTimeoutHandle !== undefined) clearTimeout(_threadCtxTimeoutHandle);
      if (ctxResult === THREAD_CTX_TIMEOUT) {
        logger.warn('thread_ctx.timeout', { runId: run.id });
      } else {
        threadCtx = ctxResult;
      }
    } catch (err) {
      logger.warn('thread_ctx.build_failed', {
        runId: run.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    logger.debug('thread_ctx.build_ms', { ms: Date.now() - _threadCtxStart, runId: run.id });
    if (threadCtx && typeof threadCtx.version === 'number') {
      const threadBlock = formatThreadContextBlock(threadCtx);
      if (threadBlock) {
        effectiveBasePrompt = prependThreadContextToBasePrompt(threadBlock, basePrompt);
        // Persist version for drift detection — fire-and-forget, best-effort
        void scopedDb
          .update(agentRuns)
          .set({
            runMetadata: {
              ...(run.runMetadata ?? {}),
              threadContextVersionAtStart: threadCtx.version,
            },
          })
          .where(eq(agentRuns.id, run.id))
          .catch(() => {});
      }
    }
  }

  const systemPromptParts = [effectiveBasePrompt];

  // Layer 1b: System skill instructions
  if (systemSkillInstructions.length > 0) {
    systemPromptParts.push(`\n\n---\n## Core Capabilities\n${systemSkillInstructions.join('\n\n')}`);
  }

  // Layer 2: Org additional prompt (invisible to sub-account)
  if (ctx.agent!.additionalPrompt) {
    systemPromptParts.push(`\n\n---\n## Organisation Instructions\n${ctx.agent!.additionalPrompt}`);
  }

  // Layer 2a: Shared memory blocks — composes explicit attachments +
  // relevance-ranked active blocks (spec §5.2, S6). The block-status
  // invariant (`status='active'` only) is enforced inside the service.
  //
  // Relevance retrieval requires a task context. When no task is in flight
  // (e.g., smart-board runs), the workspace-context string derived above
  // acts as the query text. Explicit attachments always pass through and
  // ensure zero regression for agents configured with pinned blocks.

  // Derive agent domain early — needed for tier-2 block filtering (F1 §4)
  // and for workspace memory retrieval below.
  const agentDomain = agentRoleToDomain(ctx.agent!.agentRole) ?? undefined;
  ctx.agentDomain = agentDomain;

  // Tier-1 baseline artefacts: pinned, hash-stable, always present when captured.
  // Spec: docs/sub-account-baseline-artefacts-spec.md §4.
  const tier1Blocks = await memoryBlockService.getTier1Blocks(
    request.organisationId,
    request.subaccountId ?? null,
  );

  const memoryBlocksForPrompt = await memoryBlockService.getBlocksForInjection({
    agentId: request.agentId,
    subaccountId: request.subaccountId ?? null,
    organisationId: request.organisationId,
    taskContext: workspaceContext,
    agentDomain,
    runId: run.id,
  });

  // Prepend tier-1 ahead of the relevance/explicit set.
  // Dedupe: if a tier-1 block also appears via explicit attachment, tier-1 entry wins.
  const tier1BlockIds = new Set(tier1Blocks.map((b) => b.id));
  const composedBlocks = [
    ...tier1Blocks.map((b) => ({ ...b, permission: 'read' as const })),
    ...memoryBlocksForPrompt.filter((b) => !tier1BlockIds.has(b.id)),
  ];

  // F1 §4 — emit one telemetry event per tier-1 and tier-2 baseline block injected.
  for (const block of composedBlocks) {
    const blockTier: 1 | 2 | null = tier1BlockIds.has(block.id)
      ? 1
      : (block as { tier?: 1 | 2 | null }).tier === 2
      ? 2
      : null;
    if (blockTier === 1 || blockTier === 2) {
      createEvent('baseline_artefact.tier_loaded', {
        organisation_id: request.organisationId,
        subaccount_id: request.subaccountId ?? null,
        agent_role: ctx.agent!.agentRole,
        tier: blockTier,
        block_slug: block.name,
        token_count: approxTokens(block.content),
      });
    }
  }

  const memoryBlocksSection = memoryBlockService.formatBlocksForPrompt(composedBlocks);
  if (memoryBlocksSection) {
    systemPromptParts.push(`\n\n---\n${memoryBlocksSection}`);
  }
  // Phase 8 / W3c — log injected block IDs for provenance trail. Fire-and-forget.
  const injectedBlockIds = composedBlocks.map((b) => b.id);
  if (injectedBlockIds.length > 0) {
    void scopedDb
      .update(agentRuns)
      .set({ appliedMemoryBlockIds: injectedBlockIds })
      .where(eq(agentRuns.id, run.id))
      .catch(() => {});
  }

  // Layer 2b: Org skill instructions
  if (skillInstructions.length > 0) {
    systemPromptParts.push(`\n\n---\n## Your Capabilities\n${skillInstructions.join('\n\n')}`);
  }

  // Layer 3: Custom instructions (from subaccount link or org config)
  if (ctx.configCustomInstructions) {
    systemPromptParts.push(`\n\n---\n## Additional Instructions\n${ctx.configCustomInstructions}`);
  }

  // Add team roster (loaded fresh from DB every run)
  // Team roster is placed in the stable prefix (changes only on agent config edit)
  const teamRoster = await buildTeamRoster(request.subaccountId!, request.agentId);
  if (teamRoster) {
    systemPromptParts.push(`\n\n---\n## Your Team\nYou can reassign tasks to or create tasks for any of these agents:\n${teamRoster}`);
  }

  // Personal Assistant V1 §12.4, §22.3 — voice block injection.
  // SOT: memory_block named 'ea.voice_profile_id' carries the profile UUID.
  try {
    const voiceProfileIdBlock = composedBlocks.find((b) => b.name === 'ea.voice_profile_id');
    if (voiceProfileIdBlock?.content) {
      const voiceProfile = await voiceProfileService.getProfile(
        { profileId: voiceProfileIdBlock.content.trim() },
        { organisationId: request.organisationId },
      );
      const voiceBlock = assembleVoiceBlock(voiceProfile);
      if (voiceBlock) {
        systemPromptParts.push(`\n\n---\n${voiceBlock}`);
      }
    }
  } catch {
    // Non-fatal — agent runs without voice block if profile is unavailable
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

  // Phase 1: Agent beliefs — discrete facts (dynamic — updated after each run)
  try {
    const beliefs = await agentBeliefService.getActiveBeliefs(
      request.organisationId,
      request.subaccountId!,
      request.agentId,
    );
    if (beliefs.length > 0) {
      dynamicParts.push(`\n\n---\n## Your Beliefs\n${agentBeliefService.formatBeliefsForPrompt(beliefs)}`);
    }
  } catch {
    // Non-fatal — agent runs fine without beliefs
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

  // Phase 2 S12: track injected memory entries for the citation detector
  // hook at run completion.
  const memoryWithTracking = await workspaceMemoryService.getMemoryForPromptWithTracking(
    request.organisationId,
    request.subaccountId!,
    taskContextForMemory,
    agentDomain,
    run.id,
  );
  const memory: string | null = memoryWithTracking.promptText;
  const injectedMemoryEntries = memoryWithTracking.injectedEntries;
  // B1 / spec §3.6 §8.31 — persist injected-entry IDs for utility MV. Fire-and-forget.
  void scopedDb
    .update(agentRuns)
    .set({ injectedEntryIds: injectedMemoryEntries.map((e) => e.id) })
    .where(eq(agentRuns.id, run.id))
    .catch(() => {});
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

  ctx.injectedMemoryEntries = injectedMemoryEntries;
  ctx.appliedMemoryBlockIds = injectedBlockIds;
  ctx.stablePrefix = stablePrefix;
  ctx.dynamicSuffix = dynamicSuffix;
  ctx.systemPrompt = fullSystemPrompt;
  ctx.systemPromptTokens = systemPromptTokens;

  // Live Agent Execution Log — persist the fully-assembled prompt + emit
  // prompt.assembled event. Best-effort layer attributions (spec §5.6):
  // we record offsets for the top-level layers we know about but do not
  // drill into memory-block-level attribution in P1 — that's a follow-up
  // when buildSystemPrompt learns to return per-layer offsets natively.
  try {
    const layerAttributions = {
      master: { startOffset: 0, length: Buffer.byteLength(stablePrefix, 'utf8') },
      orgAdditional: { startOffset: 0, length: 0 },
      memoryBlocks: [] as Array<{ blockId: string; startOffset: number; length: number }>,
      skillInstructions: [] as Array<{ skillSlug: string; startOffset: number; length: number }>,
      taskContext: {
        startOffset: Buffer.byteLength(stablePrefix, 'utf8'),
        length: Buffer.byteLength(dynamicSuffix, 'utf8'),
      },
    };
    const { promptRowId, assemblyNumber } = await persistPromptAssembly({
      runId: run.id,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      systemPrompt: fullSystemPrompt,
      userPrompt: targetItem?.description ?? targetItem?.title ?? '',
      toolDefinitions: [],
      layerAttributions,
      totalTokens: systemPromptTokens,
    });
    tryEmitAgentEvent({
      runId: run.id,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      sourceService: 'agentExecutionService',
      payload: {
        eventType: 'prompt.assembled',
        critical: false,
        assemblyNumber,
        promptRowId,
        totalTokens: systemPromptTokens,
        layerTokens: {
          master: approxTokens(stablePrefix),
          orgAdditional: 0,
          memoryBlocks: 0,
          skillInstructions: 0,
          taskContext: approxTokens(dynamicSuffix),
        },
      },
      linkedEntity: { type: 'prompt', id: promptRowId },
    });
  } catch (err) {
    logger.warn('agentExecutionService.prompt_assembled_persist_failed', {
      runId: run.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

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
      if (!s.includedInPrompt) return 'budget_exceeded' as const;
      return null;
    })(),
  }));

  await scopedDb.update(agentRuns).set({
    memoryStateAtStart: memory ?? null,
    skillsUsed: [
      ...(systemAgentRecord ? ((systemAgentRecord.defaultSystemSkillSlugs ?? []) as string[]).map(s => `system:${s}`) : []),
      ...skillSlugs,
    ],
    systemPromptTokens,
    contextSourcesSnapshot,
  }).where(eq(agentRuns.id, run.id));

  // Live Agent Execution Log — emit one context.source_loaded per
  // source. Payload is a slice of the existing contextSourcesSnapshot
  // struct; reused directly. Fire-and-forget per §4.1.
  for (const s of allForSnapshot) {
    tryEmitAgentEvent({
      runId: run.id,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      sourceService: 'runContextLoader',
      payload: {
        eventType: 'context.source_loaded',
        critical: false,
        sourceId: s.id,
        sourceName: s.name ?? 'unknown',
        scope: s.scope ?? 'unknown',
        contentType: s.contentType ?? 'text',
        tokenCount: s.tokenCount ?? 0,
        includedInPrompt: s.includedInPrompt ?? false,
        exclusionReason: (() => {
          if (s.suppressedByOverride) return 'override_suppressed';
          if (!s.includedInPrompt) return 'budget_exceeded';
          return undefined;
        })(),
      },
      linkedEntity: { type: 'data_source', id: s.id },
    });
  }

  // H-5: store large snapshot in agent_run_snapshots (keep agent_runs lean)
  await scopedDb.insert(agentRunSnapshots)
    .values({ runId: run.id, systemPromptSnapshot: fullSystemPrompt })
    .onConflictDoNothing();
}
