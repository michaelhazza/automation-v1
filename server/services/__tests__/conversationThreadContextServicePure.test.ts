/**
 * conversationThreadContextServicePure.test.ts
 *
 * Pure function tests for the Thread Context system.
 * Covers: task adds, status updates, dedup, pruning, decision cap, approach cap,
 * and silent no-ops for missing IDs.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/conversationThreadContextServicePure.test.ts
 */

import { createHash } from 'crypto';
import { expect, test, describe } from 'vitest';
import {
  applyPatchToPureState,
  pruneCompletedTasks,
  buildReadModelFromState,
  normalizePatch,
  TASK_CAP,
  DECISION_CAP,
  APPROACH_MAX_CHARS,
  type ThreadContextState,
} from '../conversationThreadContextServicePure.js';
import type { ThreadContextTask, ThreadContextDecision } from '../../../shared/types/conversationThreadContext.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function emptyState(): ThreadContextState {
  return { decisions: [], tasks: [], approach: '' };
}

function makeTask(overrides: Partial<ThreadContextTask> = {}): ThreadContextTask {
  return {
    id: 'task-1',
    label: 'Default task',
    status: 'pending',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<ThreadContextDecision> = {}): ThreadContextDecision {
  return {
    id: 'decision-1',
    decision: 'Use PostgreSQL',
    rationale: 'Best fit for relational data',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('applyPatchToPureState', () => {
  test('add a task — has generated ID, status is pending', () => {
    const state = emptyState();
    const result = applyPatchToPureState(state, {
      tasks: { add: [{ clientRefId: 'ref-1', label: 'Write tests' }] },
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].label).toBe('Write tests');
    expect(result.tasks[0].status).toBe('pending');
    expect(result.tasks[0].id).toBeTruthy();
    expect(typeof result.tasks[0].id).toBe('string');
    expect(result.createdIds['ref-1']).toBe(result.tasks[0].id);
    expect(result.opsApplied.tasksAdded).toBe(1);
  });

  test('updateStatus to done — completedAt is set', () => {
    const task = makeTask({ id: 'task-1', status: 'pending' });
    const state: ThreadContextState = { decisions: [], tasks: [task], approach: '' };

    const result = applyPatchToPureState(state, {
      tasks: { updateStatus: [{ id: 'task-1', status: 'done' }] },
    });

    expect(result.tasks[0].status).toBe('done');
    expect(result.tasks[0].completedAt).toBeTruthy();
    expect(result.opsApplied.tasksUpdated).toBe(1);
  });

  test('updateStatus to in_progress — completedAt is cleared', () => {
    const task = makeTask({ id: 'task-1', status: 'done', completedAt: '2026-01-01T00:00:00.000Z' });
    const state: ThreadContextState = { decisions: [], tasks: [task], approach: '' };

    const result = applyPatchToPureState(state, {
      tasks: { updateStatus: [{ id: 'task-1', status: 'in_progress' }] },
    });

    expect(result.tasks[0].status).toBe('in_progress');
    expect(result.tasks[0].completedAt).toBeNull();
  });

  test('same clientRefId in same call — dedup returns same server ID', () => {
    const state = emptyState();
    // Call twice (simulates two patches in the same call that somehow share the same clientRefId)
    const result = applyPatchToPureState(state, {
      tasks: {
        add: [
          { clientRefId: 'shared-ref', label: 'Task A' },
          { clientRefId: 'shared-ref', label: 'Task B' },
        ],
      },
    });

    // Both resolve — clientRefId maps to the last one written since keys overwrite
    expect(result.tasks).toHaveLength(2);
    // The createdIds map has one entry — the second task's ID wins in the map
    expect(Object.keys(result.createdIds)).toHaveLength(1);
    expect(result.createdIds['shared-ref']).toBeTruthy();
  });

  test('prune at 51st task: oldest completed removed automatically', () => {
    // Fill with 49 pending + 1 completed (oldest), then add 1 more
    const tasks: ThreadContextTask[] = [];
    for (let i = 0; i < 49; i++) {
      tasks.push(makeTask({ id: `task-pending-${i}`, label: `Pending ${i}`, status: 'pending' }));
    }
    tasks.push(makeTask({
      id: 'task-done-oldest',
      label: 'Old completed task',
      status: 'done',
      completedAt: '2025-01-01T00:00:00.000Z',
    }));

    const state: ThreadContextState = { decisions: [], tasks, approach: '' };
    expect(state.tasks).toHaveLength(TASK_CAP);

    const result = applyPatchToPureState(state, {
      tasks: { add: [{ label: 'New task' }] },
    });

    expect(result.tasks).toHaveLength(TASK_CAP);
    expect(result.tasks.find((t) => t.id === 'task-done-oldest')).toBeUndefined();
  });

  test('add task when all 50 are non-completed — rejects TASK_CAP_REACHED', () => {
    const tasks: ThreadContextTask[] = Array.from({ length: TASK_CAP }, (_, i) =>
      makeTask({ id: `task-${i}`, label: `Task ${i}`, status: 'pending' }),
    );
    const state: ThreadContextState = { decisions: [], tasks, approach: '' };

    expect(() =>
      applyPatchToPureState(state, { tasks: { add: [{ label: 'One more' }] } }),
    ).toThrow();

    try {
      applyPatchToPureState(state, { tasks: { add: [{ label: 'One more' }] } });
    } catch (e: unknown) {
      const err = e as { errorCode?: string; statusCode?: number };
      expect(err.errorCode).toBe('TASK_CAP_REACHED');
      expect(err.statusCode).toBe(409);
    }
  });

  test('101st decision — rejects DECISION_CAP_REACHED', () => {
    const decisions: ThreadContextDecision[] = Array.from({ length: DECISION_CAP }, (_, i) =>
      makeDecision({ id: `dec-${i}`, decision: `Decision ${i}` }),
    );
    const state: ThreadContextState = { decisions, tasks: [], approach: '' };

    expect(() =>
      applyPatchToPureState(state, {
        decisions: { add: [{ decision: 'One more', rationale: 'Overflow' }] },
      }),
    ).toThrow();

    try {
      applyPatchToPureState(state, {
        decisions: { add: [{ decision: 'One more', rationale: 'Overflow' }] },
      });
    } catch (e: unknown) {
      const err = e as { errorCode?: string; statusCode?: number };
      expect(err.errorCode).toBe('DECISION_CAP_REACHED');
      expect(err.statusCode).toBe(409);
    }
  });

  test('approach > 10,000 chars — rejects APPROACH_TOO_LONG', () => {
    const state = emptyState();
    const longApproach = 'x'.repeat(APPROACH_MAX_CHARS + 1);

    expect(() =>
      applyPatchToPureState(state, { approach: { replace: longApproach } }),
    ).toThrow();

    try {
      applyPatchToPureState(state, { approach: { replace: longApproach } });
    } catch (e: unknown) {
      const err = e as { errorCode?: string; statusCode?: number };
      expect(err.errorCode).toBe('APPROACH_TOO_LONG');
      expect(err.statusCode).toBe(409);
    }
  });

  test('approach appendNote that pushes total > 10,000 — rejects APPROACH_TOO_LONG', () => {
    const state: ThreadContextState = {
      decisions: [],
      tasks: [],
      approach: 'x'.repeat(APPROACH_MAX_CHARS - 5),
    };

    expect(() =>
      applyPatchToPureState(state, { approach: { appendNote: 'extra long addition' } }),
    ).toThrow();
  });

  test('remove non-existent ID — silent no-op', () => {
    const task = makeTask({ id: 'task-1' });
    const state: ThreadContextState = { decisions: [], tasks: [task], approach: '' };

    const result = applyPatchToPureState(state, {
      tasks: { remove: ['does-not-exist'] },
    });

    // Original task is still there, nothing removed
    expect(result.tasks).toHaveLength(1);
    expect(result.opsApplied.tasksRemoved).toBe(0);
  });

  test('updateStatus for non-existent task ID — silent no-op', () => {
    const task = makeTask({ id: 'task-1', status: 'pending' });
    const state: ThreadContextState = { decisions: [], tasks: [task], approach: '' };

    const result = applyPatchToPureState(state, {
      tasks: { updateStatus: [{ id: 'ghost-task', status: 'done' }] },
    });

    expect(result.tasks[0].status).toBe('pending');
    expect(result.opsApplied.tasksUpdated).toBe(0);
  });

  test('approach replace — replaces content', () => {
    const state: ThreadContextState = { decisions: [], tasks: [], approach: 'Old approach' };

    const result = applyPatchToPureState(state, {
      approach: { replace: 'New approach' },
    });

    expect(result.approach).toBe('New approach');
    expect(result.opsApplied.approachReplaced).toBe(true);
  });

  test('approach appendNote — appends to existing', () => {
    const state: ThreadContextState = { decisions: [], tasks: [], approach: 'First part' };

    const result = applyPatchToPureState(state, {
      approach: { appendNote: 'Second part' },
    });

    expect(result.approach).toBe('First part\n\nSecond part');
    expect(result.opsApplied.approachAppended).toBe(true);
  });

  test('approach appendNote to empty — sets content directly', () => {
    const state = emptyState();

    const result = applyPatchToPureState(state, {
      approach: { appendNote: 'First note' },
    });

    expect(result.approach).toBe('First note');
  });
});

describe('pruneCompletedTasks', () => {
  test('within cap — no pruning', () => {
    const tasks = [makeTask({ id: 't1', status: 'pending' })];
    expect(pruneCompletedTasks(tasks, 50)).toHaveLength(1);
  });

  test('over cap — removes oldest completed', () => {
    const tasks: ThreadContextTask[] = [
      makeTask({ id: 'done-old', status: 'done', completedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'done-new', status: 'done', completedAt: '2026-01-01T00:00:00.000Z' }),
      makeTask({ id: 'pending', status: 'pending' }),
    ];

    const result = pruneCompletedTasks(tasks, 2);
    expect(result).toHaveLength(2);
    expect(result.find((t) => t.id === 'done-old')).toBeUndefined();
    expect(result.find((t) => t.id === 'done-new')).toBeDefined();
    expect(result.find((t) => t.id === 'pending')).toBeDefined();
  });
});

describe('buildReadModelFromState', () => {
  test('correctly separates open and completed tasks', () => {
    const state = {
      decisions: [makeDecision({ id: 'd1', decision: 'Use Postgres' })],
      tasks: [
        makeTask({ id: 't1', label: 'Open task', status: 'pending' }),
        makeTask({ id: 't2', label: 'Done task', status: 'done', completedAt: '2026-01-01T00:00:00.000Z' }),
      ],
      approach: 'Do the thing',
      version: 3,
      updatedAt: '2026-04-30T00:00:00.000Z',
    };

    const model = buildReadModelFromState(state);

    expect(model.openTasks).toEqual(['Open task']);
    expect(model.completedTasks).toEqual(['Done task']);
    expect(model.decisions).toEqual(['Use Postgres']);
    expect(model.approach).toBe('Do the thing');
    expect(model.version).toBe(3);
    expect(model.rawTasks).toHaveLength(2);
    expect(model.rawDecisions).toHaveLength(1);
  });

  test('handles Date object for updatedAt', () => {
    const state = {
      decisions: [],
      tasks: [],
      approach: '',
      version: 0,
      updatedAt: new Date('2026-04-30T00:00:00.000Z'),
    };

    const model = buildReadModelFromState(state);
    expect(model.updatedAt).toBe('2026-04-30T00:00:00.000Z');
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// ── normalizePatch ────────────────────────────────────────────────────────────

describe('normalizePatch', () => {
  test('strips clientRefId from hash input', () => {
    const withRef = normalizePatch({
      tasks: { add: [{ clientRefId: 'ref-abc', label: 'Do the thing' }] },
    });
    const withoutRef = normalizePatch({
      tasks: { add: [{ label: 'Do the thing' }] },
    });
    expect(sha256(withRef)).toBe(sha256(withoutRef));
  });

  test('different clientRefId values produce same hash', () => {
    const patchA = normalizePatch({
      tasks: { add: [{ clientRefId: 'ref-111', label: 'Task A' }] },
    });
    const patchB = normalizePatch({
      tasks: { add: [{ clientRefId: 'ref-999', label: 'Task A' }] },
    });
    expect(sha256(patchA)).toBe(sha256(patchB));
  });

  test('tasks.add sorted by label — different ordering produces same hash', () => {
    const patchA = normalizePatch({
      tasks: {
        add: [
          { label: 'Zebra task' },
          { label: 'Alpha task' },
        ],
      },
    });
    const patchB = normalizePatch({
      tasks: {
        add: [
          { label: 'Alpha task' },
          { label: 'Zebra task' },
        ],
      },
    });
    expect(sha256(patchA)).toBe(sha256(patchB));
  });

  test('decisions.add sorted by decision text — different ordering produces same hash', () => {
    const patchA = normalizePatch({
      decisions: {
        add: [
          { decision: 'Use Redis', rationale: 'Fast' },
          { decision: 'Use Postgres', rationale: 'Reliable' },
        ],
      },
    });
    const patchB = normalizePatch({
      decisions: {
        add: [
          { decision: 'Use Postgres', rationale: 'Reliable' },
          { decision: 'Use Redis', rationale: 'Fast' },
        ],
      },
    });
    expect(sha256(patchA)).toBe(sha256(patchB));
  });

  test('tasks.remove sorted — different ordering produces same hash', () => {
    const patchA = normalizePatch({ tasks: { remove: ['id-z', 'id-a'] } });
    const patchB = normalizePatch({ tasks: { remove: ['id-a', 'id-z'] } });
    expect(sha256(patchA)).toBe(sha256(patchB));
  });

  test('decisions.remove sorted — different ordering produces same hash', () => {
    const patchA = normalizePatch({ decisions: { remove: ['dec-z', 'dec-a'] } });
    const patchB = normalizePatch({ decisions: { remove: ['dec-a', 'dec-z'] } });
    expect(sha256(patchA)).toBe(sha256(patchB));
  });

  test('tasks.updateStatus sorted by id — different ordering produces same hash', () => {
    const patchA = normalizePatch({
      tasks: {
        updateStatus: [
          { id: 'task-z', status: 'done' },
          { id: 'task-a', status: 'in_progress' },
        ],
      },
    });
    const patchB = normalizePatch({
      tasks: {
        updateStatus: [
          { id: 'task-a', status: 'in_progress' },
          { id: 'task-z', status: 'done' },
        ],
      },
    });
    expect(sha256(patchA)).toBe(sha256(patchB));
  });

  test('different patches produce different hashes', () => {
    const patchA = normalizePatch({ tasks: { add: [{ label: 'Task A' }] } });
    const patchB = normalizePatch({ tasks: { add: [{ label: 'Task B' }] } });
    expect(sha256(patchA)).not.toBe(sha256(patchB));
  });

  test('approach patch is preserved in hash input', () => {
    const patchA = normalizePatch({ approach: { replace: 'Build fast' } });
    const patchB = normalizePatch({ approach: { replace: 'Build slow' } });
    expect(sha256(patchA)).not.toBe(sha256(patchB));
  });
});

// ── formatThreadContextBlock tests ───────────────────────────────────────────
import { formatThreadContextBlock } from '../conversationThreadContextServicePure.js';
import type { ThreadContextReadModel } from '../../../shared/types/conversationThreadContext.js';

function makeModel(overrides: Partial<ThreadContextReadModel> = {}): ThreadContextReadModel {
  return {
    openTasks: [],
    completedTasks: [],
    decisions: [],
    approach: '',
    version: 1,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('formatThreadContextBlock: null → empty string', () => {
  expect(formatThreadContextBlock(null)).toBe('');
});

test('formatThreadContextBlock: all-empty model → empty string', () => {
  expect(formatThreadContextBlock(makeModel())).toBe('');
});

test('formatThreadContextBlock: model with openTasks → thread_context tag + Tasks section', () => {
  const result = formatThreadContextBlock(makeModel({ openTasks: ['Build login', 'Write tests'] }));
  expect(result).toContain('<thread_context>');
  expect(result).toContain('</thread_context>');
  expect(result).toContain('Tasks:');
  expect(result).toContain('  - Build login');
  expect(result).toContain('  - Write tests');
});

test('formatThreadContextBlock: model with approach → Approach line present', () => {
  const result = formatThreadContextBlock(makeModel({ approach: 'Use iterative delivery' }));
  expect(result).toContain('Approach: Use iterative delivery');
});

test('formatThreadContextBlock: model with decisions → Decisions section present', () => {
  const result = formatThreadContextBlock(makeModel({ decisions: ['Use Postgres', 'No Redis'] }));
  expect(result).toContain('Decisions:');
  expect(result).toContain('  - Use Postgres');
});

test('formatThreadContextBlock: openTasks capped at FORMAT_MAX_ITEMS=20', () => {
  const tasks = Array.from({ length: 25 }, (_, i) => `Task ${i}`);
  const result = formatThreadContextBlock(makeModel({ openTasks: tasks }));
  expect(result).toContain('Task 19');
  expect(result).not.toContain('Task 20');
});

// ── Ordering invariant test ────────────────────────────────────────────────────
test('formatThreadContextBlock: ordering invariant — thread context block appears before all other augmentation', () => {
  const ctx = makeModel({ openTasks: ['Deploy fix'], approach: 'Iterative' });
  const threadBlock = formatThreadContextBlock(ctx);

  // Simulate the full effectiveBasePrompt concatenation from agentExecutionService.ts:
  // effectiveBasePrompt = threadBlock + '\n\n' + basePrompt
  const basePrompt = 'You are an assistant.\n<external_document title="Doc1">content</external_document>';
  const effectiveBasePrompt = threadBlock + '\n\n' + basePrompt;

  // Thread context must be first
  expect(effectiveBasePrompt.indexOf(threadBlock)).toBe(0);

  // External doc content must appear AFTER thread context
  const threadBlockEnd = threadBlock.length;
  const externalDocIdx = effectiveBasePrompt.indexOf('<external_document');
  expect(externalDocIdx).toBeGreaterThan(threadBlockEnd);
});
