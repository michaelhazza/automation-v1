import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { scheduledTasks } from '../db/schema/index.js';
import {
  fetchDataSourcesByScope,
  type LoadedDataSource,
} from './agentService.js';
import { loadTaskAttachmentsAsContext } from './taskAttachmentContextService.js';
import {
  processContextPool,
  resolveScheduledTaskId as resolveScheduledTaskIdPure,
  type ProcessedContextPool,
} from './runContextLoaderPure.js';

// Re-export the pure helpers for callers and tests
export { processContextPool };

// ---------------------------------------------------------------------------
// Run Context Loader (spec §7.1)
//
// Single entry point for assembling the context data pool that an agent run
// will see. Merges four scopes — agent / subaccount / scheduled_task /
// task_instance — resolves same-name overrides, enforces the eager budget,
// caps the lazy manifest, and exposes the scheduled task's instructions as
// a dedicated system prompt layer.
//
// Returns a RunContextData blob that:
//   - `eager`              — full list of eager sources (filter by includedInPrompt)
//   - `manifest`           — full list of lazy sources (used by read_data_source)
//   - `manifestForPrompt`  — capped subset rendered into the system prompt
//   - `manifestElidedCount`— count of lazy entries omitted from the prompt
//   - `suppressed`         — override losers (snapshot only)
//   - `taskInstructions`   — scheduled task description, if applicable
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the agent run request that the loader needs.
 * Avoids importing the full AgentRunRequest type (which causes circular
 * imports with agentExecutionService) while staying strictly typed.
 */
export interface RunContextLoadRequest {
  agentId: string;
  organisationId: string;
  subaccountAgentId?: string | null;
  taskId?: string | null;
  triggerContext?: unknown;
}

export interface RunContextData {
  /** Eager sources, full list. Filter by `includedInPrompt` to get the render set. */
  eager: LoadedDataSource[];
  /** Lazy sources, full list. Used by the read_data_source skill handler. */
  manifest: LoadedDataSource[];
  /** Capped subset of the manifest rendered into the system prompt. */
  manifestForPrompt: LoadedDataSource[];
  /** How many manifest entries were omitted from the prompt (for the elision note). */
  manifestElidedCount: number;
  /** Sources suppressed by same-name override — snapshot only. */
  suppressed: LoadedDataSource[];
  /** Scheduled task description, when the run was fired by a scheduled task. */
  taskInstructions: string | null;
}

export async function loadRunContextData(
  request: RunContextLoadRequest
): Promise<RunContextData> {
  const pool: LoadedDataSource[] = [];

  // 1. Load agent_data_sources across all applicable scopes
  const triggerScheduledTaskId = resolveScheduledTaskIdPure(request.triggerContext);
  const scopedSources = await fetchDataSourcesByScope({
    agentId: request.agentId,
    subaccountAgentId: request.subaccountAgentId ?? null,
    scheduledTaskId: triggerScheduledTaskId,
  });
  pool.push(...scopedSources);

  // 2. Load task instance attachments if the run targets a specific task
  if (request.taskId) {
    const taskAtts = await loadTaskAttachmentsAsContext(
      request.taskId,
      request.organisationId,
    );
    pool.push(...taskAtts);
  }

  // 3. Resolve scheduled task instructions (the "Task Instructions" layer)
  let taskInstructions: string | null = null;
  if (triggerScheduledTaskId) {
    const [st] = await db
      .select({ description: scheduledTasks.description })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, triggerScheduledTaskId));
    if (st?.description && st.description.trim().length > 0) {
      taskInstructions = st.description.trim();
    }
  }

  // Steps 4-9 — pure post-fetch processing
  const processed: ProcessedContextPool = processContextPool(pool);

  return {
    ...processed,
    taskInstructions,
  };
}
