// ---------------------------------------------------------------------------
// conversationThreadContextServicePure.ts — Pure functions for the Thread
// Context system. No db, env, or service imports — only types and pure logic.
// Spec: Chunk A — Thread Context doc + plan checklist
// ---------------------------------------------------------------------------

import { randomUUID } from 'crypto';
import type {
  ThreadContextDecision,
  ThreadContextTask,
  ThreadContextPatch,
  ThreadContextReadModel,
  TaskStatus,
} from '../../shared/types/conversationThreadContext.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const TASK_CAP = 50;
export const DECISION_CAP = 100;
export const APPROACH_MAX_CHARS = 10_000;

// ── Error codes ──────────────────────────────────────────────────────────────

export type ThreadContextErrorCode =
  | 'TASK_CAP_REACHED'
  | 'DECISION_CAP_REACHED'
  | 'APPROACH_TOO_LONG';

export interface ThreadContextCapError {
  statusCode: 409;
  message: string;
  errorCode: ThreadContextErrorCode;
}

function capError(code: ThreadContextErrorCode): ThreadContextCapError {
  const messages: Record<ThreadContextErrorCode, string> = {
    TASK_CAP_REACHED: `Task cap of ${TASK_CAP} reached and no completed tasks available to prune.`,
    DECISION_CAP_REACHED: `Decision cap of ${DECISION_CAP} reached.`,
    APPROACH_TOO_LONG: `Approach exceeds the maximum of ${APPROACH_MAX_CHARS} characters.`,
  };
  return { statusCode: 409, message: messages[code], errorCode: code };
}

// ── State shape for pure functions ───────────────────────────────────────────

export interface ThreadContextState {
  decisions: ThreadContextDecision[];
  tasks: ThreadContextTask[];
  approach: string;
}

export interface OpsApplied {
  decisionsAdded: number;
  decisionsRemoved: number;
  tasksAdded: number;
  tasksUpdated: number;
  tasksRemoved: number;
  approachReplaced: boolean;
  approachAppended: boolean;
}

export interface PatchResult {
  decisions: ThreadContextDecision[];
  tasks: ThreadContextTask[];
  approach: string;
  createdIds: Record<string, string>;
  opsApplied: OpsApplied;
  /** IDs that were in a remove list but did not match any existing item. */
  noOpRemovedIds: string[];
}

// ── pruneCompletedTasks ───────────────────────────────────────────────────────

/**
 * If tasks.length > maxCount, remove oldest completed tasks until within cap
 * or until there are no more completed tasks to prune.
 * Returns the pruned array (immutable — original not mutated).
 */
export function pruneCompletedTasks(
  tasks: ThreadContextTask[],
  maxCount: number,
): ThreadContextTask[] {
  if (tasks.length <= maxCount) return tasks;

  // Sort completed tasks by completedAt ascending (oldest first = prune first)
  const completed = tasks
    .filter((t) => t.status === 'done' && t.completedAt !== null)
    .sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return aTime - bTime;
    });

  let result = [...tasks];
  let toPrune = result.length - maxCount;
  for (const candidate of completed) {
    if (toPrune <= 0) break;
    result = result.filter((t) => t.id !== candidate.id);
    toPrune--;
  }
  return result;
}

// ── buildReadModelFromState ───────────────────────────────────────────────────

export function buildReadModelFromState(state: {
  decisions: ThreadContextDecision[];
  tasks: ThreadContextTask[];
  approach: string;
  version: number;
  updatedAt: string | Date;
}): ThreadContextReadModel {
  const updatedAt =
    state.updatedAt instanceof Date
      ? state.updatedAt.toISOString()
      : state.updatedAt;

  const openTasks = state.tasks
    .filter((t) => t.status !== 'done')
    .map((t) => t.label);

  const completedTasks = state.tasks
    .filter((t) => t.status === 'done')
    .map((t) => t.label);

  return {
    decisions: state.decisions.map((d) => d.decision),
    approach: state.approach,
    openTasks,
    completedTasks,
    version: state.version,
    updatedAt,
    rawTasks: state.tasks,
    rawDecisions: state.decisions,
  };
}

// ── applyPatchToPureState ─────────────────────────────────────────────────────

/**
 * Apply a ThreadContextPatch to the current state.
 * Throws a ThreadContextCapError if a cap would be exceeded.
 * Returns a new state + audit info (does NOT mutate inputs).
 */
export function applyPatchToPureState(
  current: ThreadContextState,
  patch: ThreadContextPatch,
): PatchResult {
  let decisions = [...current.decisions];
  let tasks = [...current.tasks];
  let approach = current.approach;
  const createdIds: Record<string, string> = {};
  const opsApplied: OpsApplied = {
    decisionsAdded: 0,
    decisionsRemoved: 0,
    tasksAdded: 0,
    tasksUpdated: 0,
    tasksRemoved: 0,
    approachReplaced: false,
    approachAppended: false,
  };

  const now = new Date().toISOString();
  const noOpRemovedIds: string[] = [];

  // ── Decisions ──────────────────────────────────────────────────────────────

  if (patch.decisions?.remove?.length) {
    const existingIds = new Set(decisions.map((d) => d.id));
    for (const id of patch.decisions.remove) {
      if (!existingIds.has(id)) {
        noOpRemovedIds.push(id);
      }
    }
    const removeSet = new Set(patch.decisions.remove);
    const before = decisions.length;
    decisions = decisions.filter((d) => !removeSet.has(d.id));
    opsApplied.decisionsRemoved = before - decisions.length;
  }

  if (patch.decisions?.add?.length) {
    if (decisions.length + patch.decisions.add.length > DECISION_CAP) {
      throw capError('DECISION_CAP_REACHED');
    }
    for (const item of patch.decisions.add) {
      const id = randomUUID();
      if (item.clientRefId) {
        createdIds[item.clientRefId] = id;
      }
      decisions.push({
        id,
        decision: item.decision,
        rationale: item.rationale,
        addedAt: now,
      });
      opsApplied.decisionsAdded++;
    }
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  if (patch.tasks?.remove?.length) {
    const existingTaskIds = new Set(tasks.map((t) => t.id));
    for (const id of patch.tasks.remove) {
      if (!existingTaskIds.has(id)) {
        noOpRemovedIds.push(id);
      }
    }
    const removeSet = new Set(patch.tasks.remove);
    const before = tasks.length;
    tasks = tasks.filter((t) => !removeSet.has(t.id));
    opsApplied.tasksRemoved = before - tasks.length;
  }

  if (patch.tasks?.updateStatus?.length) {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    for (const update of patch.tasks.updateStatus) {
      const task = taskMap.get(update.id);
      if (!task) continue; // silent no-op for non-existent IDs
      const updatedTask: ThreadContextTask = {
        ...task,
        status: update.status,
        updatedAt: now,
        completedAt:
          update.status === 'done'
            ? now
            : update.status === 'pending' || update.status === 'in_progress'
            ? null
            : task.completedAt,
      };
      tasks = tasks.map((t) => (t.id === update.id ? updatedTask : t));
      opsApplied.tasksUpdated++;
    }
  }

  if (patch.tasks?.add?.length) {
    const newTasks: ThreadContextTask[] = patch.tasks.add.map((item) => {
      const id = randomUUID();
      if (item.clientRefId) {
        createdIds[item.clientRefId] = id;
      }
      return {
        id,
        label: item.label,
        status: 'pending' as TaskStatus,
        addedAt: now,
        updatedAt: now,
        completedAt: null,
      };
    });

    const combined = [...tasks, ...newTasks];

    // Prune if over cap
    if (combined.length > TASK_CAP) {
      const pruned = pruneCompletedTasks(combined, TASK_CAP);
      if (pruned.length > TASK_CAP) {
        throw capError('TASK_CAP_REACHED');
      }
      tasks = pruned;
    } else {
      tasks = combined;
    }

    opsApplied.tasksAdded += newTasks.length;
  }

  // ── Approach ────────────────────────────────────────────────────────────────

  if (patch.approach?.replace !== undefined) {
    if (patch.approach.replace.length > APPROACH_MAX_CHARS) {
      throw capError('APPROACH_TOO_LONG');
    }
    approach = patch.approach.replace;
    opsApplied.approachReplaced = true;
  }

  if (patch.approach?.appendNote !== undefined) {
    const appended = approach
      ? `${approach}\n\n${patch.approach.appendNote}`
      : patch.approach.appendNote;
    if (appended.length > APPROACH_MAX_CHARS) {
      throw capError('APPROACH_TOO_LONG');
    }
    approach = appended;
    opsApplied.approachAppended = true;
  }

  return { decisions, tasks, approach, createdIds, opsApplied, noOpRemovedIds };
}

// ── formatThreadContextBlock ──────────────────────────────────────────────────
// MAX_ITEMS caps each list to prevent prompt bloat as tasks/decisions grow.
const FORMAT_MAX_ITEMS = 20;

/**
 * Formats the thread context read model as a <thread_context> XML block for
 * injection into the system prompt. Returns '' when ctx is null or all fields
 * are empty — callers skip injection when this returns ''.
 *
 * Ordering invariant: this block must be prepended before all other system
 * prompt augmentation (external doc blocks, memory blocks, skill instructions).
 * Callers are responsible for honouring this position.
 */
export function formatThreadContextBlock(ctx: ThreadContextReadModel | null): string {
  if (!ctx) return '';

  const lines: string[] = [];

  if (ctx.openTasks?.length) {
    lines.push('Tasks:');
    ctx.openTasks.slice(0, FORMAT_MAX_ITEMS).forEach((t) => lines.push(`  - ${t}`));
  }

  if (ctx.approach) {
    lines.push(`Approach: ${ctx.approach}`);
  }

  if (ctx.decisions?.length) {
    lines.push('Decisions:');
    ctx.decisions.slice(0, FORMAT_MAX_ITEMS).forEach((d) => lines.push(`  - ${d}`));
  }

  if (!lines.length) return '';

  return `<thread_context>\n${lines.join('\n')}\n</thread_context>`;
}

// ── normalizePatch ────────────────────────────────────────────────────────────

/**
 * Produce a stable, canonical representation of a ThreadContextPatch for
 * idempotency hashing. Strips clientRefId (caller-side token), sorts all
 * arrays by a stable key so ordering differences do not produce different hashes.
 *
 * Spec §6.5: keyed_write idempotency key = `${runId}:${sha256(normalizePatch(patch))}`
 */
export function normalizePatch(patch: ThreadContextPatch): unknown {
  return {
    decisions: patch.decisions
      ? {
          add: patch.decisions.add
            ? [...patch.decisions.add]
                .map(({ clientRefId: _strip, ...rest }) => rest)
                .sort((a, b) => a.decision.localeCompare(b.decision))
            : undefined,
          remove: patch.decisions.remove
            ? [...patch.decisions.remove].sort()
            : undefined,
        }
      : undefined,
    tasks: patch.tasks
      ? {
          add: patch.tasks.add
            ? [...patch.tasks.add]
                .map(({ clientRefId: _strip, ...rest }) => rest)
                .sort((a, b) => a.label.localeCompare(b.label))
            : undefined,
          updateStatus: patch.tasks.updateStatus
            ? [...patch.tasks.updateStatus].sort((a, b) => a.id.localeCompare(b.id))
            : undefined,
          remove: patch.tasks.remove
            ? [...patch.tasks.remove].sort()
            : undefined,
        }
      : undefined,
    approach: patch.approach,
  };
}
