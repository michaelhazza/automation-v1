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
import { EXTERNAL_DOC_FRAGMENTATION_THRESHOLD } from '../lib/constants.js';
import type { FetchFailureReason } from '../db/schema/documentFetchEvents.js';

// ---------------------------------------------------------------------------
// Phase 1D: Two-pass context reranking — score data sources by relevance
// ---------------------------------------------------------------------------

/**
 * Cosine similarity between two vectors. Returns 0 if either is empty.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Score each eager source by relevance to the task embedding. Sets a
 * `relevanceScore` property on each source. processContextPool's budget
 * walk will re-sort by this score before truncation.
 *
 * Pure function — embeddings must be pre-computed by the caller.
 */
export function rankContextPoolByRelevance(
  pool: LoadedDataSource[],
  taskEmbedding: number[] | undefined,
): void {
  if (!taskEmbedding || taskEmbedding.length === 0) return;

  for (const source of pool) {
    const sourceEmb = (source as LoadedDataSource & { embedding?: number[] }).embedding;
    if (sourceEmb && sourceEmb.length > 0) {
      (source as LoadedDataSource & { relevanceScore?: number }).relevanceScore =
        cosineSimilarity(taskEmbedding, sourceEmb);
    }
  }
}

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

  // 7b. Phase 1D: If relevance scores are present, re-sort eager sources
  // by relevance descending so the most relevant survive budget truncation.
  const hasRelevance = eager.some(s => (s as LoadedDataSource & { relevanceScore?: number }).relevanceScore != null);
  if (hasRelevance) {
    eager.sort((a, b) => {
      const ra = (a as LoadedDataSource & { relevanceScore?: number }).relevanceScore ?? 0;
      const rb = (b as LoadedDataSource & { relevanceScore?: number }).relevanceScore ?? 0;
      return rb - ra;
    });
  }

  // 8. Pre-prompt budget walk (respects relevance ordering from 7b)
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

// ---------------------------------------------------------------------------
// External document reference helpers (live external doc references feature)
// ---------------------------------------------------------------------------

export interface MergedReference {
  kind: 'reference_document' | 'agent_data_source';
  id: string;
  attachmentOrder: number;
  createdAt: string;
}

export interface ResolvedDocumentLite {
  id: string;
  tokensUsed: number;
  failureReason: FetchFailureReason | null;
}

/**
 * Sort a mixed list of reference_document and agent_data_source entries by
 * attachment_order ascending, with created_at ascending as a tiebreaker.
 */
export function mergeAndOrderReferences(refs: MergedReference[]): MergedReference[] {
  return [...refs].sort((a, b) => {
    if (a.attachmentOrder !== b.attachmentOrder) return a.attachmentOrder - b.attachmentOrder;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export interface BudgetResult {
  included: ResolvedDocumentLite[];
  skipped: { id: string; reason: 'budget_exceeded' }[];
}

/**
 * Walk the ordered resolved documents and enforce the per-run token budget.
 * Documents that have a failureReason are skipped entirely (they do not
 * consume budget and are not included in the output).
 * Once the budget is breached, all subsequent documents are marked skipped.
 */
export function enforceRunBudget(resolved: ResolvedDocumentLite[], runTokenBudget: number): BudgetResult {
  let cumulative = 0;
  const included: ResolvedDocumentLite[] = [];
  const skipped: { id: string; reason: 'budget_exceeded' }[] = [];
  let breached = false;
  for (const doc of resolved) {
    if (doc.failureReason) continue;
    if (breached) {
      skipped.push({ id: doc.id, reason: 'budget_exceeded' });
      continue;
    }
    if (cumulative + doc.tokensUsed > runTokenBudget) {
      breached = true;
      skipped.push({ id: doc.id, reason: 'budget_exceeded' });
      continue;
    }
    cumulative += doc.tokensUsed;
    included.push(doc);
  }
  return { included, skipped };
}

export type FailurePolicyAction =
  | { action: 'inject_active' }
  | { action: 'serve_stale_with_warning' }
  | { action: 'serve_stale_silent' }
  | { action: 'skip_reference' }
  | { action: 'block_run' };

/**
 * Determine what to do with a reference given the configured failure policy
 * and the current fetch state of the document.
 *
 * | state    | strict              | tolerant                 | best_effort        |
 * |----------|---------------------|--------------------------|--------------------|
 * | active   | inject_active       | inject_active            | inject_active      |
 * | degraded | block_run           | serve_stale_with_warning | serve_stale_silent |
 * | broken   | block_run           | block_run                | skip_reference     |
 */
export function applyFailurePolicy(
  policy: 'tolerant' | 'strict' | 'best_effort',
  ctx: { state: 'active' | 'degraded' | 'broken' }
): FailurePolicyAction {
  if (ctx.state === 'active') return { action: 'inject_active' };
  if (ctx.state === 'degraded') {
    if (policy === 'strict')   return { action: 'block_run' };
    if (policy === 'tolerant') return { action: 'serve_stale_with_warning' };
    return                       { action: 'serve_stale_silent' };
  }
  if (policy === 'best_effort') return { action: 'skip_reference' };
  return                          { action: 'block_run' };
}

export interface FragmentationWarning {
  fragmentedCount: number;
  totalCount: number;
  message: string;
}

/**
 * Return a warning when more than half of the successfully resolved documents
 * are below the fragmentation threshold, indicating the context may be noisy.
 * Returns null when the condition is not met.
 */
export function smallDocumentFragmentationWarning(resolved: ResolvedDocumentLite[]): FragmentationWarning | null {
  const successful = resolved.filter(r => r.failureReason === null);
  if (successful.length === 0) return null;
  const small = successful.filter(r => r.tokensUsed < EXTERNAL_DOC_FRAGMENTATION_THRESHOLD).length;
  if (small <= successful.length / 2) return null;
  return {
    fragmentedCount: small,
    totalCount: successful.length,
    message: `${small} of ${successful.length} references contained fewer than ${EXTERNAL_DOC_FRAGMENTATION_THRESHOLD} tokens; context may be fragmented`,
  };
}
