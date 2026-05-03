/**
 * Tests for openTaskViewPure — classify task type, latest thinking text,
 * chat visibility, and auto-scroll decision.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  classifyTaskType,
  classifyChatVisibility,
  getLatestThinkingText,
  shouldAutoScroll,
} from '../openTaskViewPure.js';
import type { PlanStep } from '../../../hooks/useTaskProjectionPure.js';
import type { TaskEvent, SeenConfidence } from '../../../../../shared/types/taskEvent.js';

const HIGH_CONFIDENCE: SeenConfidence = {
  value: 'high',
  reason: 'all signals green',
  computed_at: new Date().toISOString(),
  signals: [],
};

// ── classifyTaskType ──────────────────────────────────────────────────────────

function step(id: string, overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    stepId: id,
    stepType: 'skill',
    status: 'pending',
    isCritical: false,
    ...overrides,
  };
}

describe('classifyTaskType', () => {
  it('returns trivial when there are 0 steps', () => {
    expect(classifyTaskType([])).toBe('trivial');
  });

  it('returns trivial for a single step', () => {
    expect(classifyTaskType([step('s1')])).toBe('trivial');
  });

  it('returns multi-step for 2+ steps without branch labels', () => {
    expect(classifyTaskType([step('s1'), step('s2')])).toBe('multi-step');
  });

  it('returns multi-step for many steps without branch labels', () => {
    const steps = Array.from({ length: 5 }, (_, i) => step(`s${i}`));
    expect(classifyTaskType(steps)).toBe('multi-step');
  });

  it('returns workflow-fired when any step has a branchLabel', () => {
    expect(
      classifyTaskType([
        step('s1'),
        step('s2', { branchLabel: 'hot' }),
        step('s3'),
      ]),
    ).toBe('workflow-fired');
  });

  it('returns workflow-fired even for 2 steps if one has a branchLabel', () => {
    expect(
      classifyTaskType([
        step('s1', { branchLabel: 'yes' }),
        step('s2'),
      ]),
    ).toBe('workflow-fired');
  });
});

// ── classifyChatVisibility ────────────────────────────────────────────────────

describe('classifyChatVisibility', () => {
  it('chat.message returns narration', () => {
    const e: TaskEvent = { kind: 'chat.message', payload: { authorKind: 'user', authorId: 'u1', body: 'hi' } };
    expect(classifyChatVisibility(e)).toBe('narration');
  });

  it('agent.milestone returns milestone', () => {
    const e: TaskEvent = { kind: 'agent.milestone', payload: { agentId: 'a1', summary: 'done' } };
    expect(classifyChatVisibility(e)).toBe('milestone');
  });

  it('approval.queued returns narration', () => {
    const e: TaskEvent = {
      kind: 'approval.queued',
      payload: { gateId: 'g1', stepId: 's1', approverPool: [], seenPayload: {} as never, seenConfidence: HIGH_CONFIDENCE },
    };
    expect(classifyChatVisibility(e)).toBe('narration');
  });

  it('ask.queued returns narration', () => {
    const e: TaskEvent = {
      kind: 'ask.queued',
      payload: { gateId: 'g1', stepId: 's1', submitterPool: [], schema: { fields: [] }, prompt: '' },
    };
    expect(classifyChatVisibility(e)).toBe('narration');
  });

  it('run.paused.cost_ceiling returns narration', () => {
    const e: TaskEvent = { kind: 'run.paused.cost_ceiling', payload: { capValue: 500, currentCost: 510 } };
    expect(classifyChatVisibility(e)).toBe('narration');
  });

  it('run.paused.wall_clock returns narration', () => {
    const e: TaskEvent = { kind: 'run.paused.wall_clock', payload: { capValue: 3600, currentElapsed: 3610 } };
    expect(classifyChatVisibility(e)).toBe('narration');
  });

  it('run.paused.by_user returns narration', () => {
    const e: TaskEvent = { kind: 'run.paused.by_user', payload: { actorId: 'u1' } };
    expect(classifyChatVisibility(e)).toBe('narration');
  });

  it('step.started returns hidden', () => {
    const e: TaskEvent = { kind: 'step.started', payload: { stepId: 's1' } };
    expect(classifyChatVisibility(e)).toBe('hidden');
  });

  it('step.completed returns hidden', () => {
    const e: TaskEvent = { kind: 'step.completed', payload: { stepId: 's1', outputs: {}, fileRefs: [] } };
    expect(classifyChatVisibility(e)).toBe('hidden');
  });

  it('thinking.changed returns hidden', () => {
    const e: TaskEvent = { kind: 'thinking.changed', payload: { newText: 'x' } };
    expect(classifyChatVisibility(e)).toBe('hidden');
  });
});

// ── getLatestThinkingText ─────────────────────────────────────────────────────

describe('getLatestThinkingText', () => {
  it('returns null when no thinking events', () => {
    const events: TaskEvent[] = [
      { kind: 'task.created', payload: { requesterId: 'u1', initialPrompt: '' } },
    ];
    expect(getLatestThinkingText(events)).toBeNull();
  });

  it('returns the text from the latest thinking.changed event', () => {
    const events: TaskEvent[] = [
      { kind: 'thinking.changed', payload: { newText: 'first' } },
      { kind: 'step.started', payload: { stepId: 's1' } },
      { kind: 'thinking.changed', payload: { newText: 'second' } },
    ];
    expect(getLatestThinkingText(events)).toBe('second');
  });

  it('returns null for empty event array', () => {
    expect(getLatestThinkingText([])).toBeNull();
  });

  it('returns the only thinking text when there is one', () => {
    const events: TaskEvent[] = [
      { kind: 'thinking.changed', payload: { newText: 'thinking about it' } },
    ];
    expect(getLatestThinkingText(events)).toBe('thinking about it');
  });
});

// ── shouldAutoScroll ──────────────────────────────────────────────────────────

describe('shouldAutoScroll', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when no manual scroll has occurred', () => {
    expect(shouldAutoScroll({ atBottom: true }, null)).toBe(true);
  });

  it('returns true when last manual scroll was more than 2 seconds ago', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    expect(shouldAutoScroll({ atBottom: false }, 7_000)).toBe(true);
  });

  it('returns false when last manual scroll was within the last 2 seconds', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    expect(shouldAutoScroll({ atBottom: false }, 9_500)).toBe(false);
  });

  it('returns false at the exact 2-second boundary (< 2000ms elapsed)', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    expect(shouldAutoScroll({ atBottom: false }, 8_001)).toBe(false);
  });

  it('returns true at just over 2 seconds', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    expect(shouldAutoScroll({ atBottom: false }, 7_999)).toBe(true);
  });
});
