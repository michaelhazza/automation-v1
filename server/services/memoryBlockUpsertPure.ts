/**
 * memoryBlockUpsertPure — pure semantics for the Phase D2 `knowledgeBindings`
 * upsert flow. Isolated from the DB so strategy + safety rules can be tested
 * without a live Postgres.
 *
 * Spec: docs/onboarding-playbooks-spec.md §8.4, §7.5.
 */

export const MEMORY_BLOCK_CONTENT_MAX = 2000;
export const MEMORY_BLOCK_LABEL_MAX = 80;
export const MEMORY_BLOCKS_PER_RUN_MAX = 10;

export type MergeStrategy = 'replace' | 'append' | 'merge';
export type BlockConfidence = 'low' | 'normal';

/**
 * A minimal shape of the target block row — everything the pure decision
 * function needs to reason about. Supplying `null` indicates "no existing
 * block", so the caller should create one.
 */
export interface ExistingBlockView {
  id: string;
  content: string;
  lastEditedByAgentId: string | null;
  lastWrittenByPlaybookSlug: string | null;
  sourceRunId: string | null;
}

export interface UpsertDecisionInput {
  /** Existing block row (null = no block with this label yet). */
  existing: ExistingBlockView | null;
  /** Label of the target block (caller validated length/charset earlier). */
  label: string;
  /** Incoming value to write; the step's resolved output cast to string. */
  incomingContent: string;
  /** Merge strategy declared on the binding. */
  mergeStrategy: MergeStrategy;
  /** Slug of the playbook whose run is firing the binding. */
  playbookSlug: string;
  /**
   * How many blocks this run has already upserted (including any that are
   * about to be applied earlier in the same finaliseRun() loop). Used for
   * the per-run rate limit (§7.5 — 10 blocks per run).
   */
  blocksUpsertedThisRun: number;
}

/** Discriminated outcome emitted by `decideUpsert()`. */
export type UpsertDecision =
  | {
      kind: 'create';
      content: string;
      /** True if the effective content was truncated to the 2k cap. */
      truncated: boolean;
    }
  | {
      kind: 'update';
      content: string;
      truncated: boolean;
      /** True if mergeStrategy was 'merge' but fell back to 'replace'. */
      mergeFallback: boolean;
    }
  | {
      kind: 'skip_hitl_overwrite';
      /** Human-editable preview of the proposed new content (post-merge). */
      previewContent: string;
    }
  | {
      kind: 'skip_rate_limited';
    }
  | {
      kind: 'skip_empty';
    };

/**
 * Core decision function. Given the existing block (or null) and the incoming
 * value + merge strategy, produce an `UpsertDecision`. Side-effect free.
 */
export function decideUpsert(input: UpsertDecisionInput): UpsertDecision {
  const { existing, incomingContent, mergeStrategy, playbookSlug, blocksUpsertedThisRun } =
    input;

  if (incomingContent.trim().length === 0) {
    return { kind: 'skip_empty' };
  }

  // ── Rate limit (§7.5, 10 blocks per run) ────────────────────────────────
  // Only "creates" and genuinely-mutating updates count. A no-op where the
  // incoming value equals the existing content is not counted because it
  // doesn't write a new row version — but for simplicity we count every
  // attempted upsert, which is what the spec describes as "upsert" quota.
  if (blocksUpsertedThisRun >= MEMORY_BLOCKS_PER_RUN_MAX) {
    return { kind: 'skip_rate_limited' };
  }

  // ── HITL overwrite predicate (§7.5) ─────────────────────────────────────
  // Fires when (a) a block with this label already exists, (b) the last
  // edit came from a human (lastEditedByAgentId IS NULL) AND (c) the block
  // was NOT previously written by the same playbook slug. Point (c) is the
  // "same playbook can rewrite its own blocks" carve-out.
  if (existing) {
    const humanLastEdit = existing.lastEditedByAgentId === null;
    const differentOwnerSlug =
      existing.lastWrittenByPlaybookSlug === null ||
      existing.lastWrittenByPlaybookSlug !== playbookSlug;
    if (humanLastEdit && differentOwnerSlug) {
      return {
        kind: 'skip_hitl_overwrite',
        previewContent: computeCombined(existing.content, incomingContent, mergeStrategy).content,
      };
    }
  }

  if (!existing) {
    const { content, truncated } = truncateToCap(incomingContent);
    return { kind: 'create', content, truncated };
  }

  const combined = computeCombined(existing.content, incomingContent, mergeStrategy);
  return {
    kind: 'update',
    content: combined.content,
    truncated: combined.truncated,
    mergeFallback: combined.mergeFallback,
  };
}

interface CombinedResult {
  content: string;
  truncated: boolean;
  mergeFallback: boolean;
}

/**
 * Apply the chosen merge strategy to the existing + incoming content. Pure.
 */
export function computeCombined(
  existing: string,
  incoming: string,
  strategy: MergeStrategy,
): CombinedResult {
  let content: string;
  let mergeFallback = false;

  switch (strategy) {
    case 'replace':
      content = incoming;
      break;
    case 'append':
      content = existing.length > 0 ? `${existing}\n${incoming}` : incoming;
      break;
    case 'merge': {
      // JSON-aware merge requires both sides to parse as objects.
      const existingObj = tryParseObject(existing);
      const incomingObj = tryParseObject(incoming);
      if (existingObj && incomingObj) {
        const merged = { ...existingObj, ...incomingObj };
        content = JSON.stringify(merged, null, 2);
      } else {
        // Fallback per spec §8.4 second bullet — fall back to 'replace' and
        // emit a warning. The caller surfaces the warning as a run event.
        content = incoming;
        mergeFallback = true;
      }
      break;
    }
    default:
      content = incoming;
  }

  const truncated = content.length > MEMORY_BLOCK_CONTENT_MAX;
  if (truncated) {
    // Truncate from the END so newest content wins (spec §8.4 first bullet:
    // "truncated to 2000 chars from the end — newest content is preserved").
    content = content.slice(content.length - MEMORY_BLOCK_CONTENT_MAX);
  }
  return { content, truncated, mergeFallback };
}

function truncateToCap(content: string): { content: string; truncated: boolean } {
  if (content.length <= MEMORY_BLOCK_CONTENT_MAX) return { content, truncated: false };
  return {
    content: content.slice(content.length - MEMORY_BLOCK_CONTENT_MAX),
    truncated: true,
  };
}

function tryParseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Serialise an arbitrary step-output value into a string that can land in a
 * Memory Block. Strings are emitted as-is; everything else is `JSON.stringify`'d
 * with 2-space indentation for readability.
 */
export function serialiseForBlock(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Resolve a dot-path + array-index expression (e.g. `items[0].name`) against
 * an arbitrary value. Returns `undefined` when any segment fails to resolve,
 * matching the `knowledge_binding_missing_output` warning contract in §8.4.
 */
export function getByPath(root: unknown, path: string): unknown {
  if (!path) return undefined;
  const tokens = tokenisePath(path);
  let cur: unknown = root;
  for (const tok of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof tok === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[tok];
    } else {
      if (typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[tok];
    }
  }
  return cur;
}

function tokenisePath(path: string): Array<string | number> {
  const out: Array<string | number> = [];
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) {
    if (match[1] !== undefined) out.push(match[1]);
    else if (match[2] !== undefined) out.push(Number(match[2]));
  }
  return out;
}
