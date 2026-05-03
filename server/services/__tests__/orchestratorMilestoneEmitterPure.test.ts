/**
 * orchestratorMilestoneEmitterPure.test.ts
 *
 * Pure-logic tests for classifyForMilestone.
 * No database or I/O required.
 *
 * Run via:
 *   npx vitest run server/services/__tests__/orchestratorMilestoneEmitterPure.test.ts
 */

import { expect, test, describe } from 'vitest';
import { classifyForMilestone } from '../orchestratorMilestoneEmitterPure.js';

// ─── file_produced ────────────────────────────────────────────────────────────

describe('file_produced', () => {
  test('file.created → file_produced', () => {
    expect(classifyForMilestone({ eventKind: 'file.created', eventPayload: {} })).toBe('file_produced');
  });

  test('file.edited → file_produced', () => {
    expect(classifyForMilestone({ eventKind: 'file.edited', eventPayload: {} })).toBe('file_produced');
  });
});

// ─── decision_made ────────────────────────────────────────────────────────────

describe('decision_made', () => {
  test('approval.decided → decision_made', () => {
    expect(classifyForMilestone({ eventKind: 'approval.decided', eventPayload: {} })).toBe('decision_made');
  });

  test('step.branch_decided → decision_made', () => {
    expect(classifyForMilestone({ eventKind: 'step.branch_decided', eventPayload: {} })).toBe('decision_made');
  });
});

// ─── handoff_complete ─────────────────────────────────────────────────────────

describe('handoff_complete', () => {
  test('agent.delegation.closed → handoff_complete', () => {
    expect(classifyForMilestone({ eventKind: 'agent.delegation.closed', eventPayload: {} })).toBe('handoff_complete');
  });
});

// ─── plan_changed ─────────────────────────────────────────────────────────────

describe('plan_changed', () => {
  test('task.routed → plan_changed', () => {
    expect(classifyForMilestone({ eventKind: 'task.routed', eventPayload: {} })).toBe('plan_changed');
  });

  test('step.queued → plan_changed', () => {
    expect(classifyForMilestone({ eventKind: 'step.queued', eventPayload: {} })).toBe('plan_changed');
  });
});

// ─── narration (everything else) ─────────────────────────────────────────────

describe('narration', () => {
  test('task.created → narration', () => {
    expect(classifyForMilestone({ eventKind: 'task.created', eventPayload: {} })).toBe('narration');
  });

  test('step.started → narration', () => {
    expect(classifyForMilestone({ eventKind: 'step.started', eventPayload: {} })).toBe('narration');
  });

  test('step.completed → narration', () => {
    expect(classifyForMilestone({ eventKind: 'step.completed', eventPayload: {} })).toBe('narration');
  });

  test('step.failed → narration', () => {
    expect(classifyForMilestone({ eventKind: 'step.failed', eventPayload: {} })).toBe('narration');
  });

  test('approval.queued → narration', () => {
    expect(classifyForMilestone({ eventKind: 'approval.queued', eventPayload: {} })).toBe('narration');
  });

  test('agent.delegation.opened → narration', () => {
    expect(classifyForMilestone({ eventKind: 'agent.delegation.opened', eventPayload: {} })).toBe('narration');
  });

  test('agent.milestone → narration', () => {
    expect(classifyForMilestone({ eventKind: 'agent.milestone', eventPayload: {} })).toBe('narration');
  });

  test('chat.message → narration', () => {
    expect(classifyForMilestone({ eventKind: 'chat.message', eventPayload: {} })).toBe('narration');
  });

  test('thinking.changed → narration', () => {
    expect(classifyForMilestone({ eventKind: 'thinking.changed', eventPayload: {} })).toBe('narration');
  });

  test('unknown event kind → narration', () => {
    expect(classifyForMilestone({ eventKind: 'some.unknown.event', eventPayload: {} })).toBe('narration');
  });

  test('empty string → narration', () => {
    expect(classifyForMilestone({ eventKind: '', eventPayload: null })).toBe('narration');
  });

  test('payload is ignored for classification (forward-compat)', () => {
    // Payload should not affect the category in V1.
    const r1 = classifyForMilestone({ eventKind: 'file.created', eventPayload: null });
    const r2 = classifyForMilestone({ eventKind: 'file.created', eventPayload: { fileId: 'abc' } });
    expect(r1).toBe(r2);
    expect(r1).toBe('file_produced');
  });
});
