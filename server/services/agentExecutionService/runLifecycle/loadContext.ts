import { eq } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { agentRuns } from '../../../db/schema/index.js';
import { getOrgProcessesForTools } from '../../llmService.js';
import { buildForRun as buildHierarchyForRun, HierarchyContextBuildError } from '../../hierarchyContextBuilderService.js';
import { logger } from '../../../lib/logger.js';
import type { AgentRunRequest, RunExecutionContext } from '../types.js';

export async function loadRunContextAndHierarchy(
  request: AgentRunRequest,
  ctx: RunExecutionContext,
): Promise<void> {
  const run = ctx.run!;

  // ── 3. Load run context data (cascading scopes + task attachments + instructions) ──
  const { loadRunContextData } = await import('../../runContextLoader.js');
  const runContextData = await loadRunContextData({
    agentId: request.agentId,
    organisationId: request.organisationId,
    subaccountAgentId: request.subaccountAgentId ?? null,
    taskId: request.taskId ?? null,
    triggerContext: request.triggerContext,
    subaccountId: request.subaccountId ?? null,
    runId: run.id,
    tokenBudget: ctx.tokenBudget!,
  });

  ctx.runContextData = runContextData;

  // ── 3.5. Auto-knowledge retrieval ──────────────────────────────────────
  const { assembleKnowledgeForRun } = await import('../../retrievalService.js');
  let knowledgeLoaded: Awaited<ReturnType<typeof assembleKnowledgeForRun>>['loaded'] = [];
  try {
    const retrievalResult = await assembleKnowledgeForRun(run.id);
    knowledgeLoaded = retrievalResult.loaded;
    ctx.retrievalResult = retrievalResult;
  } catch (err) {
    logger.warn('[agentExecutionService] knowledge_retrieval_failed', {
      runId: run.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  ctx.knowledgeLoaded = knowledgeLoaded;

  // ── 4. Load org processes for trigger_process skill ──────────────────
  const orgProcesses = await getOrgProcessesForTools(request.organisationId);
  ctx.orgProcesses = orgProcesses;

  // ── 4.5. Build immutable hierarchy snapshot (INV-4) ────────────────────
  if (request.subaccountId && request.subaccountAgentId) {
    try {
      const hierarchyContext = await buildHierarchyForRun({
        agentId: request.subaccountAgentId,
        subaccountId: request.subaccountId,
        organisationId: request.organisationId,
      });
      ctx.hierarchyContext = hierarchyContext;
      // Persist hierarchy_depth on the run row (non-critical: catch and log)
      db.update(agentRuns)
        .set({ hierarchyDepth: hierarchyContext.depth, updatedAt: new Date() })
        .where(eq(agentRuns.id, run.id))
        .catch((err: unknown) => {
          logger.warn('[agentExecutionService] Failed to persist hierarchy_depth', {
            runId: run.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    } catch (err) {
      if (err instanceof HierarchyContextBuildError) {
        logger.warn('[agentExecutionService] hierarchy_not_built_for_run', {
          runId: run.id,
          code: err.code,
          agentId: request.agentId,
          subaccountAgentId: request.subaccountAgentId,
        });
        // Leave hierarchyContext undefined — read skills fall through (Chunk 3b),
        // write skills fail closed (Chunk 4a). Do not abort the run for a build failure.
      } else {
        throw err;
      }
    }
  }
}
