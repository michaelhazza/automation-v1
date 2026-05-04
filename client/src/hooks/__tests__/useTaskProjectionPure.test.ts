import { describe, expect, it } from 'vitest';
import { applyTaskEvent, applyAllEvents } from '../useTaskProjectionPure.js';
import { INITIAL_TASK_PROJECTION } from '../../../../shared/types/taskProjection.js';
import type { TaskEventEnvelope } from '../../../../shared/types/taskEvent.js';

function mkEnv(kind: string, payload: unknown, seq = 1, subseq = 0): TaskEventEnvelope {
  return {
    eventId: `test:${seq}:${subseq}:${kind}`,
    type: 'task:execution-event',
    entityId: 'task-1',
    timestamp: new Date().toISOString(),
    eventOrigin: 'engine',
    taskSequence: seq,
    eventSubsequence: subseq,
    eventSchemaVersion: 1,
    payload: { kind, payload } as TaskEventEnvelope['payload'],
  };
}

describe('useTaskProjectionPure', () => {
  it('chat.message event adds to chatMessages', () => {
    const env = mkEnv('chat.message', { authorKind: 'user', authorId: 'u1', body: 'hello' });
    const result = applyTaskEvent({ ...INITIAL_TASK_PROJECTION }, env);
    expect(result.chatMessages).toHaveLength(1);
    expect(result.chatMessages[0].body).toBe('hello');
    expect(result.chatMessages[0].authorKind).toBe('user');
  });

  it('thinking.changed sets thinkingText with latest winning', () => {
    const env1 = mkEnv('thinking.changed', { newText: 'first thought' }, 1);
    const env2 = mkEnv('thinking.changed', { newText: 'second thought' }, 2);
    let state = applyTaskEvent({ ...INITIAL_TASK_PROJECTION }, env1);
    state = applyTaskEvent(state, env2);
    expect(state.thinkingText).toBe('second thought');
  });

  it('approval.queued then approval.decided changes gate status to decided', () => {
    const queuedEnv = mkEnv('approval.queued', {
      gateId: 'gate-1',
      stepId: 'step-1',
      poolSize: 2,
      poolFingerprint: 'fp1',
      seenPayload: {},
      seenConfidence: 0.9,
    }, 1);
    const decidedEnv = mkEnv('approval.decided', {
      gateId: 'gate-1',
      decidedBy: 'user-1',
      decision: 'approved',
      decisionReason: 'looks good',
    }, 2);

    let state = applyTaskEvent({ ...INITIAL_TASK_PROJECTION }, queuedEnv);
    expect(state.approvalGates[0].status).toBe('pending');

    state = applyTaskEvent(state, decidedEnv);
    expect(state.approvalGates[0].status).toBe('decided');
    expect(state.approvalGates[0].decision).toBe('approved');
    expect(state.approvalGates[0].decidedBy).toBe('user-1');
  });

  it('run.paused.by_user sets runStatus to paused, run.resumed sets it to running', () => {
    const pausedEnv = mkEnv('run.paused.by_user', { actorId: 'u1' }, 1);
    const resumedEnv = mkEnv('run.resumed', { actorId: 'u1' }, 2);

    let state = applyTaskEvent({ ...INITIAL_TASK_PROJECTION }, pausedEnv);
    expect(state.runStatus).toBe('paused');

    state = applyTaskEvent(state, resumedEnv);
    expect(state.runStatus).toBe('running');
  });

  it('full-rebuild safety: applyAllEvents from INITIAL produces clean state with no carry-over', () => {
    // Seed a "stale" projection with some data from two events
    const staleEnv1 = mkEnv('chat.message', { authorKind: 'agent', authorId: 'a1', body: 'stale message' }, 1);
    const staleEnv2 = mkEnv('thinking.changed', { newText: 'stale thinking' }, 2);
    const staleProjection = applyAllEvents([staleEnv1, staleEnv2]);
    expect(staleProjection.chatMessages).toHaveLength(1);

    // Now apply only a single clean event from INITIAL — no carry-over from stale
    const cleanEnv = mkEnv('chat.message', { authorKind: 'user', authorId: 'u1', body: 'clean message' }, 3);
    const cleanResult = applyAllEvents([cleanEnv]);

    expect(cleanResult.chatMessages).toHaveLength(1);
    expect(cleanResult.chatMessages[0].body).toBe('clean message');
    expect(cleanResult.thinkingText).toBeNull();
    // Stale data should not be present
    expect(cleanResult.chatMessages.some(m => m.body === 'stale message')).toBe(false);
  });

  it('idempotency: applying the same event twice produces the same state as applying it once', () => {
    const env = mkEnv('chat.message', { authorKind: 'user', authorId: 'u1', body: 'hello' }, 1);
    const onceState = applyTaskEvent({ ...INITIAL_TASK_PROJECTION }, env);
    const twiceState = applyTaskEvent(onceState, env);

    // The reducer is now truly idempotent via cursor short-circuit: the second
    // apply detects (taskSequence, eventSubsequence) <= (lastEventSeq,
    // lastEventSubseq) and returns prev unchanged. This prevents replay /
    // socket-overlap from duplicating UI rows in activityEvents, chatMessages,
    // or milestones (chatgpt-pr-review Round 2 finding R2-1).
    expect(twiceState).toBe(onceState);
    expect(twiceState.chatMessages).toHaveLength(1);
    expect(twiceState.activityEvents).toHaveLength(1);
    expect(twiceState.lastEventSeq).toBe(onceState.lastEventSeq);
  });

  it('out-of-order arrivals: a stale event after a newer one is dropped (recovers on full rebuild)', () => {
    const newer = mkEnv('chat.message', { authorKind: 'user', authorId: 'u1', body: 'newer' }, 5);
    const stale = mkEnv('chat.message', { authorKind: 'user', authorId: 'u1', body: 'stale' }, 3);
    const afterNewer = applyTaskEvent({ ...INITIAL_TASK_PROJECTION }, newer);
    const afterStale = applyTaskEvent(afterNewer, stale);
    expect(afterStale).toBe(afterNewer);
    expect(afterStale.chatMessages).toHaveLength(1);
    expect(afterStale.chatMessages[0].body).toBe('newer');
  });
});
