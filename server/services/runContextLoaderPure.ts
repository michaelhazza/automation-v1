/**
 * PURE post-fetch processing extracted from runContextLoader.ts so it
 * can be imported by unit tests without dragging in the db / env chain.
 *
 * This module has zero runtime imports — only type imports — which means
 * tests can `import { processContextPool } from './runContextLoaderPure.js'`
 * without triggering env validation at module load time.
 */

import type { LoadedDataSource } from './agentService.js';
import {
  MAX_EAGER_BUDGET,
  MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT,
} from '../config/limits.js';

/**
 * Resolve the scheduled task id from a request's triggerContext, if present.
 * Returns null when the run did not originate from a scheduled task.
 *
 * Note: we accept any trigger context carrying a `scheduledTaskId` regardless
 * of the `source` value. The first-attempt source is `'scheduled_task'`,
 * the retry path uses `'scheduled_task_retry'`, and a future event-driven
 * trigger may use yet another source. The presence of `scheduledTaskId` is
 * the canonical signal that this run should pull scheduled-task context —
 * gating on `source === 'scheduled_task'` would silently strip context
 * from retries (pr-reviewer Blocker 1).
 */
export function resolveScheduledTaskId(
  triggerContext: unknown
): string | null {
  const ctx = triggerContext as
    | { source?: string; scheduledTaskId?: string }
    | null
    | undefined;
  if (!ctx?.scheduledTaskId) return null;
  return ctx.scheduledTaskId;
}

export interface ProcessedContextPool {
  eager: LoadedDataSource[];
  manifest: LoadedDataSource[];
  manifestForPrompt: LoadedDataSource[];
  manifestElidedCount: number;
  suppressed: LoadedDataSource[];
}

/**
 * Pure post-fetch processing of a context source pool. Implements steps
 * 4–9 of the spec §7.1 algorithm:
 *
 *   4. Sort by scope precedence then per-scope priority
 *   5. Assign orderIndex on the full sorted pool BEFORE suppression
 *   6. Resolve same-name override (winner-takes-all per normalised name)
 *   7. Split eager vs lazy from the active (post-dedupe) pool
 *   8. Pre-prompt budget walk (mark includedInPrompt true/false)
 *   9. Cap the lazy manifest for prompt rendering
 *
 * The function MUTATES the input pool (assigning orderIndex,
 * includedInPrompt, suppressedByOverride, suppressedBy directly on each
 * source). Callers should treat the returned arrays as the source of
 * truth and not re-read the original pool.
 */
export function processContextPool(
  pool: LoadedDataSource[],
  opts?: { maxEagerBudget?: number; maxLazyManifestItems?: number }
): ProcessedContextPool {
  const maxEagerBudget = opts?.maxEagerBudget ?? MAX_EAGER_BUDGET;
  const maxLazyManifestItems = opts?.maxLazyManifestItems ?? MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT;

  // 4. Sort the full pool by scope precedence then source priority
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
  pool.forEach((source, idx) => {
    source.orderIndex = idx;
  });

  // 6. Same-name override resolution (spec §3.6)
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
  const activePool = pool.filter((s) => !s.suppressedByOverride);

  // 7. Split eager vs lazy
  const eager = activePool.filter((s) => s.loadingMode === 'eager');
  const manifest = activePool.filter((s) => s.loadingMode === 'lazy');

  // 8. Pre-prompt budget walk
  let accumulatedTokens = 0;
  for (const source of eager) {
    if (accumulatedTokens + source.tokenCount <= maxEagerBudget) {
      source.includedInPrompt = true;
      accumulatedTokens += source.tokenCount;
    } else {
      source.includedInPrompt = false;
    }
  }
  for (const source of manifest) {
    source.includedInPrompt = false;
  }

  // 9. Cap the manifest length rendered INTO the prompt
  const manifestForPrompt = manifest.slice(0, maxLazyManifestItems);
  const manifestElidedCount = Math.max(0, manifest.length - manifestForPrompt.length);

  return {
    eager,
    manifest,
    manifestForPrompt,
    manifestElidedCount,
    suppressed,
  };
}
