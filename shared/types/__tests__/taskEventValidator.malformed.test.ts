/**
 * taskEventValidator.malformed.test.ts
 *
 * Exhaustive malformed-payload tests for validateTaskEvent.
 * Every kind in the union gets at least one malformed test here.
 * Valid-payload tests live in taskEventValidator.test.ts.
 *
 * Runs locally (no DB required — pure validator).
 */

import { describe, test, expect } from 'vitest';
import { validateTaskEvent } from '../taskEventValidator.js';

function expectFail(input: unknown, description?: string) {
  const result = validateTaskEvent(input);
  expect(result.ok, description ?? `expected validation failure for: ${JSON.stringify(input)}`).toBe(false);
}

// ─── task.created ─────────────────────────────────────────────────────────────

describe('task.created malformed', () => {
  test('payload is null', () => expectFail({ kind: 'task.created', payload: null }));
  test('requesterId is number', () => expectFail({ kind: 'task.created', payload: { requesterId: 42, initialPrompt: 'x' } }));
  test('initialPrompt is array', () => expectFail({ kind: 'task.created', payload: { requesterId: 'u1', initialPrompt: [] } }));
  test('both fields missing', () => expectFail({ kind: 'task.created', payload: {} }));
});

// ─── task.routed ──────────────────────────────────────────────────────────────

describe('task.routed malformed', () => {
  test('payload is string', () => expectFail({ kind: 'task.routed', payload: 'bad' }));
  test('payload is number', () => expectFail({ kind: 'task.routed', payload: 42 }));
  test('payload is null', () => expectFail({ kind: 'task.routed', payload: null }));
  test('payload is array', () => expectFail({ kind: 'task.routed', payload: [] }));
});

// ─── agent.delegation.opened ──────────────────────────────────────────────────

describe('agent.delegation.opened malformed', () => {
  test('parentAgentId missing', () => expectFail({ kind: 'agent.delegation.opened', payload: { childAgentId: 'a2', scope: 'full' } }));
  test('childAgentId is number', () => expectFail({ kind: 'agent.delegation.opened', payload: { parentAgentId: 'a1', childAgentId: 2, scope: 'full' } }));
  test('scope is null', () => expectFail({ kind: 'agent.delegation.opened', payload: { parentAgentId: 'a1', childAgentId: 'a2', scope: null } }));
  test('payload is null', () => expectFail({ kind: 'agent.delegation.opened', payload: null }));
});

// ─── agent.delegation.closed ──────────────────────────────────────────────────

describe('agent.delegation.closed malformed', () => {
  test('childAgentId missing', () => expectFail({ kind: 'agent.delegation.closed', payload: { summary: 'done' } }));
  test('summary is object', () => expectFail({ kind: 'agent.delegation.closed', payload: { childAgentId: 'a2', summary: {} } }));
  test('payload is array', () => expectFail({ kind: 'agent.delegation.closed', payload: [] }));
});

// ─── step.queued ──────────────────────────────────────────────────────────────

describe('step.queued malformed', () => {
  test('stepId missing', () => expectFail({ kind: 'step.queued', payload: { stepType: 'agent', params: {} } }));
  test('stepType missing', () => expectFail({ kind: 'step.queued', payload: { stepId: 's1', params: {} } }));
  test('params is array', () => expectFail({ kind: 'step.queued', payload: { stepId: 's1', stepType: 'agent', params: [] } }));
  test('params is string', () => expectFail({ kind: 'step.queued', payload: { stepId: 's1', stepType: 'agent', params: 'bad' } }));
  test('payload is null', () => expectFail({ kind: 'step.queued', payload: null }));
});

// ─── step.started ─────────────────────────────────────────────────────────────

describe('step.started malformed', () => {
  test('stepId is number', () => expectFail({ kind: 'step.started', payload: { stepId: 1 } }));
  test('stepId missing', () => expectFail({ kind: 'step.started', payload: {} }));
  test('payload is null', () => expectFail({ kind: 'step.started', payload: null }));
});

// ─── step.completed ───────────────────────────────────────────────────────────

describe('step.completed malformed', () => {
  test('stepId missing', () => expectFail({ kind: 'step.completed', payload: { outputs: {}, fileRefs: [] } }));
  test('fileRefs is string', () => expectFail({ kind: 'step.completed', payload: { stepId: 's1', outputs: {}, fileRefs: 'bad' } }));
  test('fileRefs has non-string elements', () => expectFail({ kind: 'step.completed', payload: { stepId: 's1', outputs: {}, fileRefs: [1] } }));
  test('payload is null', () => expectFail({ kind: 'step.completed', payload: null }));
});

// ─── step.failed ──────────────────────────────────────────────────────────────

describe('step.failed malformed', () => {
  test('errorClass missing', () => expectFail({ kind: 'step.failed', payload: { stepId: 's1', errorMessage: 'oops' } }));
  test('errorMessage is number', () => expectFail({ kind: 'step.failed', payload: { stepId: 's1', errorClass: 'E', errorMessage: 42 } }));
  test('payload is null', () => expectFail({ kind: 'step.failed', payload: null }));
});

// ─── step.branch_decided ──────────────────────────────────────────────────────

describe('step.branch_decided malformed', () => {
  test('field missing', () => expectFail({ kind: 'step.branch_decided', payload: { stepId: 's1', resolvedValue: 'x', targetStep: 's2' } }));
  test('targetStep missing', () => expectFail({ kind: 'step.branch_decided', payload: { stepId: 's1', field: 'f', resolvedValue: 'x' } }));
  test('stepId is number', () => expectFail({ kind: 'step.branch_decided', payload: { stepId: 1, field: 'f', resolvedValue: 'x', targetStep: 's2' } }));
  test('payload is null', () => expectFail({ kind: 'step.branch_decided', payload: null }));
});

// ─── approval.queued ──────────────────────────────────────────────────────────

describe('approval.queued malformed', () => {
  test('gateId missing', () => expectFail({ kind: 'approval.queued', payload: { stepId: 's1', approverPool: [], seenPayload: {}, seenConfidence: {} } }));
  test('approverPool is string', () => expectFail({ kind: 'approval.queued', payload: { gateId: 'g1', stepId: 's1', approverPool: 'u1', seenPayload: {}, seenConfidence: {} } }));
  test('seenPayload missing', () => expectFail({ kind: 'approval.queued', payload: { gateId: 'g1', stepId: 's1', approverPool: [], seenConfidence: {} } }));
  test('payload is null', () => expectFail({ kind: 'approval.queued', payload: null }));
});

// ─── approval.decided ─────────────────────────────────────────────────────────

describe('approval.decided malformed', () => {
  test('decision is invalid enum', () => expectFail({ kind: 'approval.decided', payload: { gateId: 'g1', decidedBy: 'u1', decision: 'maybe' } }));
  test('decidedBy missing', () => expectFail({ kind: 'approval.decided', payload: { gateId: 'g1', decision: 'approved' } }));
  test('gateId is number', () => expectFail({ kind: 'approval.decided', payload: { gateId: 1, decidedBy: 'u1', decision: 'approved' } }));
  test('payload is null', () => expectFail({ kind: 'approval.decided', payload: null }));
});

// ─── approval.pool_refreshed ──────────────────────────────────────────────────

describe('approval.pool_refreshed malformed', () => {
  test('newPoolSize is string', () => expectFail({ kind: 'approval.pool_refreshed', payload: { gateId: 'g1', actorId: 'u1', newPoolSize: '3', stillBelowQuorum: false } }));
  test('stillBelowQuorum is number', () => expectFail({ kind: 'approval.pool_refreshed', payload: { gateId: 'g1', actorId: 'u1', newPoolSize: 3, stillBelowQuorum: 1 } }));
  test('actorId missing', () => expectFail({ kind: 'approval.pool_refreshed', payload: { gateId: 'g1', newPoolSize: 3, stillBelowQuorum: false } }));
  test('payload is null', () => expectFail({ kind: 'approval.pool_refreshed', payload: null }));
});

// ─── ask.queued ───────────────────────────────────────────────────────────────

describe('ask.queued malformed', () => {
  test('schema.fields missing', () => expectFail({ kind: 'ask.queued', payload: { gateId: 'g1', stepId: 's1', submitterPool: [], schema: {}, prompt: 'p' } }));
  test('submitterPool is string', () => expectFail({ kind: 'ask.queued', payload: { gateId: 'g1', stepId: 's1', submitterPool: 'u1', schema: { fields: [] }, prompt: 'p' } }));
  test('prompt missing', () => expectFail({ kind: 'ask.queued', payload: { gateId: 'g1', stepId: 's1', submitterPool: [], schema: { fields: [] } } }));
  test('payload is null', () => expectFail({ kind: 'ask.queued', payload: null }));
});

// ─── ask.submitted ────────────────────────────────────────────────────────────

describe('ask.submitted malformed', () => {
  test('values is array', () => expectFail({ kind: 'ask.submitted', payload: { gateId: 'g1', submittedBy: 'u1', values: [] } }));
  test('submittedBy missing', () => expectFail({ kind: 'ask.submitted', payload: { gateId: 'g1', values: {} } }));
  test('payload is null', () => expectFail({ kind: 'ask.submitted', payload: null }));
});

// ─── ask.skipped ──────────────────────────────────────────────────────────────

describe('ask.skipped malformed', () => {
  test('stepId missing', () => expectFail({ kind: 'ask.skipped', payload: { gateId: 'g1', submittedBy: 'u1' } }));
  test('gateId missing', () => expectFail({ kind: 'ask.skipped', payload: { submittedBy: 'u1', stepId: 's1' } }));
  test('payload is null', () => expectFail({ kind: 'ask.skipped', payload: null }));
});

// ─── file.created ─────────────────────────────────────────────────────────────

describe('file.created malformed', () => {
  test('version is string', () => expectFail({ kind: 'file.created', payload: { fileId: 'f1', version: '1', producerAgentId: 'a1' } }));
  test('fileId missing', () => expectFail({ kind: 'file.created', payload: { version: 1, producerAgentId: 'a1' } }));
  test('payload is null', () => expectFail({ kind: 'file.created', payload: null }));
});

// ─── file.edited ──────────────────────────────────────────────────────────────

describe('file.edited malformed', () => {
  test('priorVersion is string', () => expectFail({ kind: 'file.edited', payload: { fileId: 'f1', priorVersion: '1', newVersion: 2, editRequest: 'fix' } }));
  test('editRequest missing', () => expectFail({ kind: 'file.edited', payload: { fileId: 'f1', priorVersion: 1, newVersion: 2 } }));
  test('payload is null', () => expectFail({ kind: 'file.edited', payload: null }));
});

// ─── chat.message ─────────────────────────────────────────────────────────────

describe('chat.message malformed', () => {
  test('authorKind invalid', () => expectFail({ kind: 'chat.message', payload: { authorKind: 'bot', authorId: 'u1', body: 'hi' } }));
  test('authorId missing', () => expectFail({ kind: 'chat.message', payload: { authorKind: 'user', body: 'hi' } }));
  test('body is number', () => expectFail({ kind: 'chat.message', payload: { authorKind: 'user', authorId: 'u1', body: 42 } }));
  test('payload is null', () => expectFail({ kind: 'chat.message', payload: null }));
});

// ─── agent.milestone ──────────────────────────────────────────────────────────

describe('agent.milestone malformed', () => {
  test('summary missing', () => expectFail({ kind: 'agent.milestone', payload: { agentId: 'a1' } }));
  test('agentId is number', () => expectFail({ kind: 'agent.milestone', payload: { agentId: 1, summary: 'done' } }));
  test('payload is null', () => expectFail({ kind: 'agent.milestone', payload: null }));
});

// ─── thinking.changed ─────────────────────────────────────────────────────────

describe('thinking.changed malformed', () => {
  test('newText is number', () => expectFail({ kind: 'thinking.changed', payload: { newText: 42 } }));
  test('newText missing', () => expectFail({ kind: 'thinking.changed', payload: {} }));
  test('payload is null', () => expectFail({ kind: 'thinking.changed', payload: null }));
});

// ─── run.paused.cost_ceiling ─────────────────────────────────────────────────

describe('run.paused.cost_ceiling malformed', () => {
  test('capValue is string', () => expectFail({ kind: 'run.paused.cost_ceiling', payload: { capValue: '1000', currentCost: 1050 } }));
  test('currentCost missing', () => expectFail({ kind: 'run.paused.cost_ceiling', payload: { capValue: 1000 } }));
  test('payload is null', () => expectFail({ kind: 'run.paused.cost_ceiling', payload: null }));
});

// ─── run.paused.wall_clock ───────────────────────────────────────────────────

describe('run.paused.wall_clock malformed', () => {
  test('currentElapsed missing', () => expectFail({ kind: 'run.paused.wall_clock', payload: { capValue: 3600 } }));
  test('capValue is string', () => expectFail({ kind: 'run.paused.wall_clock', payload: { capValue: '3600', currentElapsed: 3700 } }));
  test('payload is null', () => expectFail({ kind: 'run.paused.wall_clock', payload: null }));
});

// ─── run.paused.by_user ──────────────────────────────────────────────────────

describe('run.paused.by_user malformed', () => {
  test('actorId missing', () => expectFail({ kind: 'run.paused.by_user', payload: {} }));
  test('actorId is number', () => expectFail({ kind: 'run.paused.by_user', payload: { actorId: 123 } }));
  test('payload is null', () => expectFail({ kind: 'run.paused.by_user', payload: null }));
});

// ─── run.resumed ─────────────────────────────────────────────────────────────

describe('run.resumed malformed', () => {
  test('actorId missing', () => expectFail({ kind: 'run.resumed', payload: {} }));
  test('actorId is boolean', () => expectFail({ kind: 'run.resumed', payload: { actorId: true } }));
  test('payload is null', () => expectFail({ kind: 'run.resumed', payload: null }));
});

// ─── run.stopped.by_user ─────────────────────────────────────────────────────

describe('run.stopped.by_user malformed', () => {
  test('actorId missing', () => expectFail({ kind: 'run.stopped.by_user', payload: {} }));
  test('actorId is array', () => expectFail({ kind: 'run.stopped.by_user', payload: { actorId: ['u1'] } }));
  test('payload is null', () => expectFail({ kind: 'run.stopped.by_user', payload: null }));
});

// ─── task.degraded ───────────────────────────────────────────────────────────

describe('task.degraded malformed', () => {
  test('reason is invalid', () => expectFail({ kind: 'task.degraded', payload: { reason: 'unknown_reason', degradationReason: 'x' } }));
  test('degradationReason missing', () => expectFail({ kind: 'task.degraded', payload: { reason: 'consumer_gap_detected' } }));
  test('degradationReason is number', () => expectFail({ kind: 'task.degraded', payload: { reason: 'consumer_gap_detected', degradationReason: 42 } }));
  test('payload is null', () => expectFail({ kind: 'task.degraded', payload: null }));
});

// ─── Unknown kind ─────────────────────────────────────────────────────────────

describe('unknown kind', () => {
  test('completely unknown kind', () => expectFail({ kind: 'widget.exploded', payload: {} }));
  test('partial match is not accepted', () => expectFail({ kind: 'step', payload: {} }));
  test('empty string kind', () => expectFail({ kind: '', payload: {} }));
});
