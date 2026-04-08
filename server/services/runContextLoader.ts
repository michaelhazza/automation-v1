import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { scheduledTasks } from '../db/schema/index.js';
import {
  fetchDataSourcesByScope,
  type LoadedDataSource,
} from './agentService.js';
import { loadTaskAttachmentsAsContext } from './taskAttachmentContextService.js';
import {
  MAX_EAGER_BUDGET,
  MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT,
} from '../config/limits.js';

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

/**
 * Resolve the scheduled task id from a request's triggerContext, if present.
 * Returns null when the run did not originate from a scheduled task.
 */
function resolveScheduledTaskId(request: RunContextLoadRequest): string | null {
  const ctx = request.triggerContext as
    | { source?: string; scheduledTaskId?: string }
    | null
    | undefined;
  if (!ctx) return null;
  if (ctx.source === 'scheduled_task' && ctx.scheduledTaskId) {
    return ctx.scheduledTaskId;
  }
  return null;
}

export async function loadRunContextData(
  request: RunContextLoadRequest
): Promise<RunContextData> {
  const pool: LoadedDataSource[] = [];

  // 1. Load agent_data_sources across all applicable scopes
  const triggerScheduledTaskId = resolveScheduledTaskId(request);
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

  // 4. Sort the full pool by scope precedence then source priority
  //    (done BEFORE dedupe so the override rule always picks the
  //    highest-precedence winner deterministically).
  //    Precedence: task_instance before scheduled_task before subaccount before agent.
  //    Within each scope, lower priority number wins.
  const scopeOrder: Record<LoadedDataSource['scope'], number> = {
    task_instance: 0,
    scheduled_task: 1,
    subaccount: 2,
    agent: 3,
  };
  const sorter = (a: LoadedDataSource, b: LoadedDataSource) => {
    const scopeDiff = scopeOrder[a.scope] - scopeOrder[b.scope];
    if (scopeDiff !== 0) return scopeDiff;
    return a.priority - b.priority;
  };
  pool.sort(sorter);

  // 5. Assign orderIndex to the full sorted pool — BEFORE suppression
  //    or eager/lazy splitting. This guarantees every source (winners,
  //    losers, eager, lazy, binary) carries a stable, deterministic
  //    orderIndex through to the snapshot. The debug UI sorts by this
  //    field, so determinism here is a user-visible property.
  pool.forEach((source, idx) => {
    source.orderIndex = idx;
  });

  // 6. Same-name override resolution (spec §3.6)
  //    When multiple sources across scopes share the same normalised name,
  //    the first one in sort order (highest precedence) wins. Others are
  //    marked suppressedByOverride: true and included in the snapshot but
  //    excluded from both the prompt and the read_data_source skill.
  //    orderIndex is preserved on both winners and losers from step 5.
  const normaliseName = (n: string) => n.toLowerCase().trim();
  const winnersByName = new Map<string, LoadedDataSource>();
  const suppressed: LoadedDataSource[] = [];
  for (const source of pool) {
    const key = normaliseName(source.name);
    const winner = winnersByName.get(key);
    if (!winner) {
      winnersByName.set(key, source);
      continue;
    }
    source.suppressedByOverride = true;
    source.suppressedBy = winner.id;
    source.includedInPrompt = false;
    suppressed.push(source);
  }
  const activePool = pool.filter(s => !s.suppressedByOverride);

  // 7. Split eager vs lazy from the active (post-dedupe) pool
  const eager = activePool.filter(s => s.loadingMode === 'eager');
  const manifest = activePool.filter(s => s.loadingMode === 'lazy');

  // 8. Pre-prompt budget enforcement — walk the eager list, accumulating
  //    tokenCount against MAX_EAGER_BUDGET. Sources that fit are marked
  //    includedInPrompt: true. Sources that don't fit stay in the list
  //    with includedInPrompt: false (so the snapshot sees them) but are
  //    excluded from the system prompt render in agentExecutionService.
  //
  //    orderIndex is NOT reassigned here — it was set on the full pool
  //    in step 5 and is preserved through all subsequent filtering.
  let accumulatedTokens = 0;
  for (const source of eager) {
    if (accumulatedTokens + source.tokenCount <= MAX_EAGER_BUDGET) {
      source.includedInPrompt = true;
      accumulatedTokens += source.tokenCount;
    } else {
      source.includedInPrompt = false;
    }
  }

  // Manifest entries are never included in the Knowledge Base block (by
  // definition — they're the lazy manifest), but they do appear in the
  // system prompt as the "Available Context Sources" list. Tag them for
  // the snapshot so debugging shows why each entry was there.
  for (const source of manifest) {
    source.includedInPrompt = false; // not in the Knowledge Base block
  }

  // 9. Cap the manifest length rendered INTO the prompt
  //    (the full manifest is still available via read_data_source op='list').
  const manifestForPrompt = manifest.slice(0, MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT);
  const manifestElidedCount = Math.max(0, manifest.length - manifestForPrompt.length);

  return {
    eager,
    manifest,
    manifestForPrompt,
    manifestElidedCount,
    suppressed,
    taskInstructions,
  };
}
