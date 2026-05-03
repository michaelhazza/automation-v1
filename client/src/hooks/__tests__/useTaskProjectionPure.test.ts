/**
 * Tests for useTaskProjectionPure — pure reducer and initial state.
 *
 * Covers: every event kind applied; idempotency; empty initial state.
 */

import { describe, it, expect } from 'vitest';
import {
  emptyProjection,
  applyEvent,
} from '../useTaskProjectionPure.js';
import type { TaskEvent, TaskEventEnvelope, SeenConfidence } from '../../../../shared/types/taskEvent.js';

const HIGH_CONFIDENCE: SeenConfidence = {
  value: 'high',
  reason: 'all signals green',
  computed_at: new Date().toISOString(),
  signals: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function makeEnvelope(taskId: string, event: TaskEvent, seq?: number): TaskEventEnvelope {
  const s = seq ?? ++_seq;
  return {
    eventId: `${taskId}:${event.kind}:${s}:0`,
    type: 'task:execution-event',
    entityId: taskId,
    timestamp: new Date(Date.now() + s * 1000).toISOString(),
    eventOrigin: 'engine',
    taskSequence: s,
    eventSubsequence: 0,
    eventSchemaVersion: 1,
    payload: event,
  };
}

function apply(taskId: string, events: TaskEvent[]) {
  let proj = emptyProjection(taskId);
  for (const evt of events) {
    proj = applyEvent(proj, evt, makeEnvelope(taskId, evt));
  }
  return proj;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('emptyProjection', () => {
  it('returns an empty projection with correct taskId', () => {
    const proj = emptyProjection('task-123');
    expect(proj.taskId).toBe('task-123');
    expect(proj.status).toBe('pending');
    expect(proj.chatMessages).toHaveLength(0);
    expect(proj.activityFeed).toHaveLength(0);
    expect(proj.planSteps).toHaveLength(0);
    expect(proj.openCards).toHaveLength(0);
    expect(proj.thinking).toBeNull();
    expect(proj.pauseReason).toBeNull();
    expect(proj.degradationReason).toBeNull();
    expect(proj.agentTree.nodes).toHaveLength(0);
    expect(proj.agentTree.rootAgentId).toBeNull();
  });
});

describe('applyEvent', () => {
  it('task.created sets requesterUserId and status pending', () => {
    const proj = apply('t1', [
      { kind: 'task.created', payload: { requesterId: 'user-abc', initialPrompt: 'Hello' } },
    ]);
    expect(proj.requesterUserId).toBe('user-abc');
    expect(proj.status).toBe('pending');
    expect(proj.activityFeed).toHaveLength(1);
  });

  it('task.routed sets status running', () => {
    const proj = apply('t1', [
      { kind: 'task.created', payload: { requesterId: 'u1', initialPrompt: '' } },
      { kind: 'task.routed', payload: {} },
    ]);
    expect(proj.status).toBe('running');
  });

  it('agent.delegation.opened builds the agent tree', () => {
    const proj = apply('t1', [
      {
        kind: 'agent.delegation.opened',
        payload: { parentAgentId: 'parent-1', childAgentId: 'child-1', scope: 'full' },
      },
    ]);
    expect(proj.agentTree.nodes).toHaveLength(2);
    const child = proj.agentTree.nodes.find((n) => n.agentId === 'child-1');
    expect(child?.parentAgentId).toBe('parent-1');
    expect(child?.status).toBe('working');
    expect(proj.agentTree.rootAgentId).toBe('parent-1');
  });

  it('agent.delegation.closed marks agent as done', () => {
    const proj = apply('t1', [
      {
        kind: 'agent.delegation.opened',
        payload: { parentAgentId: 'p1', childAgentId: 'c1', scope: 'full' },
      },
      {
        kind: 'agent.delegation.closed',
        payload: { childAgentId: 'c1', summary: 'done' },
      },
    ]);
    const child = proj.agentTree.nodes.find((n) => n.agentId === 'c1');
    expect(child?.status).toBe('done');
  });

  it('step.queued adds a queued plan step', () => {
    const proj = apply('t1', [
      { kind: 'step.queued', payload: { stepId: 's1', stepType: 'skill', params: {} } },
    ]);
    expect(proj.planSteps).toHaveLength(1);
    expect(proj.planSteps[0].status).toBe('queued');
    expect(proj.planSteps[0].stepId).toBe('s1');
  });

  it('step.started marks step running', () => {
    const proj = apply('t1', [
      { kind: 'step.queued', payload: { stepId: 's1', stepType: 'skill', params: {} } },
      { kind: 'step.started', payload: { stepId: 's1' } },
    ]);
    expect(proj.planSteps[0].status).toBe('running');
    expect(proj.status).toBe('running');
  });

  it('step.completed marks step completed', () => {
    const proj = apply('t1', [
      { kind: 'step.queued', payload: { stepId: 's1', stepType: 'skill', params: {} } },
      { kind: 'step.started', payload: { stepId: 's1' } },
      { kind: 'step.completed', payload: { stepId: 's1', outputs: {}, fileRefs: [] } },
    ]);
    expect(proj.planSteps[0].status).toBe('completed');
  });

  it('step.failed marks step failed', () => {
    const proj = apply('t1', [
      { kind: 'step.queued', payload: { stepId: 's1', stepType: 'skill', params: {} } },
      { kind: 'step.failed', payload: { stepId: 's1', errorClass: 'RuntimeError', errorMessage: 'oops' } },
    ]);
    expect(proj.planSteps[0].status).toBe('failed');
  });

  it('step.branch_decided sets branchLabel on the step', () => {
    const proj = apply('t1', [
      { kind: 'step.queued', payload: { stepId: 's1', stepType: 'branch', params: {} } },
      {
        kind: 'step.branch_decided',
        payload: { stepId: 's1', field: 'tier', resolvedValue: 'hot', targetStep: 's2' },
      },
    ]);
    expect(proj.planSteps[0].branchLabel).toBe('hot');
  });

  it('approval.queued adds approval card and sets awaiting_approval', () => {
    const proj = apply('t1', [
      { kind: 'step.queued', payload: { stepId: 's1', stepType: 'approval', params: {} } },
      {
        kind: 'approval.queued',
        payload: {
          gateId: 'g1',
          stepId: 's1',
          approverPool: ['user-1'],
          seenPayload: {} as never,
          seenConfidence: HIGH_CONFIDENCE,
        },
      },
    ]);
    expect(proj.status).toBe('awaiting_approval');
    expect(proj.openCards).toHaveLength(1);
    expect(proj.openCards[0].kind).toBe('approval');
    expect(proj.openCards[0].gateId).toBe('g1');
    expect(proj.planSteps[0].status).toBe('awaiting_approval');
  });

  it('approval.decided removes the card and restores running status', () => {
    const proj = apply('t1', [
      { kind: 'step.queued', payload: { stepId: 's1', stepType: 'approval', params: {} } },
      {
        kind: 'approval.queued',
        payload: {
          gateId: 'g1',
          stepId: 's1',
          approverPool: ['user-1'],
          seenPayload: {} as never,
          seenConfidence: HIGH_CONFIDENCE,
        },
      },
      {
        kind: 'approval.decided',
        payload: { gateId: 'g1', decidedBy: 'user-1', decision: 'approved' },
      },
    ]);
    expect(proj.openCards).toHaveLength(0);
    expect(proj.status).toBe('running');
  });

  it('ask.queued adds ask card and sets awaiting_input', () => {
    const proj = apply('t1', [
      { kind: 'step.queued', payload: { stepId: 's1', stepType: 'ask', params: {} } },
      {
        kind: 'ask.queued',
        payload: {
          gateId: 'g2',
          stepId: 's1',
          submitterPool: ['u1'],
          schema: { fields: [] },
          prompt: 'What is the budget?',
        },
      },
    ]);
    expect(proj.status).toBe('awaiting_input');
    expect(proj.openCards[0].kind).toBe('ask');
  });

  it('ask.submitted removes card and restores running', () => {
    const proj = apply('t1', [
      { kind: 'step.queued', payload: { stepId: 's1', stepType: 'ask', params: {} } },
      {
        kind: 'ask.queued',
        payload: {
          gateId: 'g2',
          stepId: 's1',
          submitterPool: ['u1'],
          schema: { fields: [] },
          prompt: 'Budget?',
        },
      },
      {
        kind: 'ask.submitted',
        payload: { gateId: 'g2', submittedBy: 'u1', values: { budget: 100 } },
      },
    ]);
    expect(proj.openCards).toHaveLength(0);
    expect(proj.status).toBe('running');
  });

  it('chat.message adds to chatMessages', () => {
    const proj = apply('t1', [
      {
        kind: 'chat.message',
        payload: { authorKind: 'user', authorId: 'u1', body: 'Hello agent' },
      },
    ]);
    expect(proj.chatMessages).toHaveLength(1);
    expect(proj.chatMessages[0].body).toBe('Hello agent');
  });

  it('thinking.changed updates thinking text', () => {
    const proj = apply('t1', [
      { kind: 'thinking.changed', payload: { newText: 'Analyzing data...' } },
    ]);
    expect(proj.thinking?.text).toBe('Analyzing data...');
  });

  it('run.paused.cost_ceiling sets paused status and reason', () => {
    const proj = apply('t1', [
      { kind: 'run.paused.cost_ceiling', payload: { capValue: 500, currentCost: 510 } },
    ]);
    expect(proj.status).toBe('paused');
    expect(proj.pauseReason).toBe('cost_ceiling');
    expect(proj.openCards.some((c) => c.kind === 'pause')).toBe(true);
  });

  it('run.paused.wall_clock sets paused status and wall_clock reason', () => {
    const proj = apply('t1', [
      { kind: 'run.paused.wall_clock', payload: { capValue: 3600, currentElapsed: 3610 } },
    ]);
    expect(proj.status).toBe('paused');
    expect(proj.pauseReason).toBe('wall_clock');
  });

  it('run.paused.by_user sets paused status and by_user reason', () => {
    const proj = apply('t1', [
      { kind: 'run.paused.by_user', payload: { actorId: 'u1' } },
    ]);
    expect(proj.status).toBe('paused');
    expect(proj.pauseReason).toBe('by_user');
  });

  it('run.resumed removes pause card and restores running', () => {
    const proj = apply('t1', [
      { kind: 'run.paused.by_user', payload: { actorId: 'u1' } },
      { kind: 'run.resumed', payload: { actorId: 'u1' } },
    ]);
    expect(proj.status).toBe('running');
    expect(proj.pauseReason).toBeNull();
    expect(proj.openCards.some((c) => c.kind === 'pause')).toBe(false);
  });

  it('run.stopped.by_user sets cancelled', () => {
    const proj = apply('t1', [
      { kind: 'run.stopped.by_user', payload: { actorId: 'u1' } },
    ]);
    expect(proj.status).toBe('cancelled');
  });

  it('task.degraded sets partial status and reason', () => {
    const proj = apply('t1', [
      {
        kind: 'task.degraded',
        payload: {
          reason: 'consumer_gap_detected',
          degradationReason: 'Gap in sequence 5..10',
        },
      },
    ]);
    expect(proj.status).toBe('partial');
    expect(proj.degradationReason).toBe('Gap in sequence 5..10');
  });

  it('all events accumulate in activityFeed', () => {
    const proj = apply('t1', [
      { kind: 'task.created', payload: { requesterId: 'u1', initialPrompt: '' } },
      { kind: 'task.routed', payload: {} },
      { kind: 'step.queued', payload: { stepId: 's1', stepType: 'skill', params: {} } },
    ]);
    expect(proj.activityFeed).toHaveLength(3);
  });
});

describe('applyEvent — idempotency', () => {
  it('applying the same event twice yields the same state', () => {
    const taskId = 'idem-test';
    const event: TaskEvent = {
      kind: 'chat.message',
      payload: { authorKind: 'user', authorId: 'u1', body: 'Hi' },
    };
    const envelope = makeEnvelope(taskId, event, 999);

    const base = emptyProjection(taskId);
    const once = applyEvent(base, event, envelope);
    const twice = applyEvent(once, event, envelope);

    expect(twice.chatMessages).toHaveLength(1);
    expect(twice.activityFeed).toHaveLength(1);
  });

  it('applying same step.queued twice does not duplicate planSteps', () => {
    const taskId = 'idem-2';
    const event: TaskEvent = {
      kind: 'step.queued',
      payload: { stepId: 'sx', stepType: 'skill', params: {} },
    };
    const envelope = makeEnvelope(taskId, event, 100);

    const base = emptyProjection(taskId);
    const once = applyEvent(base, event, envelope);
    const twice = applyEvent(once, event, envelope);

    // planSteps: first apply creates the step; second is a no-op because of dedup
    expect(twice.planSteps).toHaveLength(1);
  });
});
