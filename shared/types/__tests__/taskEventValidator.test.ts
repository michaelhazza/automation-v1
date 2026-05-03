/**
 * taskEventValidator.test.ts — unit tests for validateTaskEvent.
 *
 * Covers every kind in the union: valid + malformed payloads.
 */

import { describe, test, expect } from 'vitest';
import { validateTaskEvent } from '../taskEventValidator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function valid(kind: string, payload: unknown) {
  return { kind, payload };
}

function expectOk(input: unknown) {
  const result = validateTaskEvent(input);
  expect(result.ok, `expected ok but got: ${!result.ok ? (result as { reason: string }).reason : ''}`).toBe(true);
}

function expectFail(input: unknown) {
  const result = validateTaskEvent(input);
  expect(result.ok).toBe(false);
}

// ─── Structural ───────────────────────────────────────────────────────────────

describe('structural', () => {
  test('rejects non-object', () => {
    expectFail('string');
    expectFail(42);
    expectFail(null);
    expectFail(undefined);
    expectFail([]);
  });

  test('rejects missing kind', () => {
    expectFail({ payload: {} });
  });

  test('rejects numeric kind', () => {
    expectFail({ kind: 123, payload: {} });
  });

  test('rejects unknown kind', () => {
    expectFail({ kind: 'not.a.kind', payload: {} });
  });
});

// ─── task.created ─────────────────────────────────────────────────────────────

describe('task.created', () => {
  test('valid', () => {
    expectOk(valid('task.created', { requesterId: 'u1', initialPrompt: 'do something' }));
  });
  test('missing requesterId', () => {
    expectFail(valid('task.created', { initialPrompt: 'x' }));
  });
  test('missing initialPrompt', () => {
    expectFail(valid('task.created', { requesterId: 'u1' }));
  });
});

// ─── task.routed ──────────────────────────────────────────────────────────────

describe('task.routed', () => {
  test('valid with all fields', () => {
    expectOk(valid('task.routed', { targetAgentId: 'a1', targetWorkflowTemplateId: 't1' }));
  });
  test('valid with empty object (both optional)', () => {
    expectOk(valid('task.routed', {}));
  });
  test('rejects non-object payload', () => {
    expectFail(valid('task.routed', 'bad'));
  });
});

// ─── agent.delegation.opened ──────────────────────────────────────────────────

describe('agent.delegation.opened', () => {
  test('valid', () => {
    expectOk(valid('agent.delegation.opened', { parentAgentId: 'a1', childAgentId: 'a2', scope: 'full' }));
  });
  test('missing scope', () => {
    expectFail(valid('agent.delegation.opened', { parentAgentId: 'a1', childAgentId: 'a2' }));
  });
});

// ─── agent.delegation.closed ──────────────────────────────────────────────────

describe('agent.delegation.closed', () => {
  test('valid', () => {
    expectOk(valid('agent.delegation.closed', { childAgentId: 'a2', summary: 'done' }));
  });
  test('missing summary', () => {
    expectFail(valid('agent.delegation.closed', { childAgentId: 'a2' }));
  });
});

// ─── step.queued ──────────────────────────────────────────────────────────────

describe('step.queued', () => {
  test('valid', () => {
    expectOk(valid('step.queued', { stepId: 's1', stepType: 'agent', params: { k: 'v' } }));
  });
  test('missing params', () => {
    expectFail(valid('step.queued', { stepId: 's1', stepType: 'agent' }));
  });
  test('params is array (not object)', () => {
    expectFail(valid('step.queued', { stepId: 's1', stepType: 'agent', params: [] }));
  });
});

// ─── step.started ─────────────────────────────────────────────────────────────

describe('step.started', () => {
  test('valid', () => {
    expectOk(valid('step.started', { stepId: 's1' }));
  });
  test('missing stepId', () => {
    expectFail(valid('step.started', {}));
  });
});

// ─── step.completed ───────────────────────────────────────────────────────────

describe('step.completed', () => {
  test('valid', () => {
    expectOk(valid('step.completed', { stepId: 's1', outputs: { result: 'x' }, fileRefs: [] }));
  });
  test('fileRefs not array', () => {
    expectFail(valid('step.completed', { stepId: 's1', outputs: {}, fileRefs: 'bad' }));
  });
  test('fileRefs with non-string elements', () => {
    expectFail(valid('step.completed', { stepId: 's1', outputs: {}, fileRefs: [1, 2] }));
  });
});

// ─── step.failed ──────────────────────────────────────────────────────────────

describe('step.failed', () => {
  test('valid', () => {
    expectOk(valid('step.failed', { stepId: 's1', errorClass: 'TimeoutError', errorMessage: 'timed out' }));
  });
  test('missing errorMessage', () => {
    expectFail(valid('step.failed', { stepId: 's1', errorClass: 'TimeoutError' }));
  });
});

// ─── step.branch_decided ──────────────────────────────────────────────────────

describe('step.branch_decided', () => {
  test('valid', () => {
    expectOk(valid('step.branch_decided', { stepId: 's1', field: 'f', resolvedValue: true, targetStep: 's2' }));
  });
  test('missing targetStep', () => {
    expectFail(valid('step.branch_decided', { stepId: 's1', field: 'f', resolvedValue: 1 }));
  });
});

// ─── approval.queued ──────────────────────────────────────────────────────────

describe('approval.queued', () => {
  test('valid', () => {
    expectOk(valid('approval.queued', {
      gateId: 'g1', stepId: 's1', approverPool: ['u1'],
      seenPayload: { step_id: 's1', step_type: 'approval', step_name: 'x', rendered_inputs: {}, rendered_preview: null, agent_reasoning: null, branch_decision: null },
      seenConfidence: { value: 'high', reason: 'r', computed_at: '2024-01-01', signals: [] },
    }));
  });
  test('approverPool is string', () => {
    expectFail(valid('approval.queued', {
      gateId: 'g1', stepId: 's1', approverPool: 'u1',
      seenPayload: {}, seenConfidence: {},
    }));
  });
});

// ─── approval.decided ────────────────────────────────────────────────────────

describe('approval.decided', () => {
  test('valid approved', () => {
    expectOk(valid('approval.decided', { gateId: 'g1', decidedBy: 'u1', decision: 'approved' }));
  });
  test('valid rejected with reason', () => {
    expectOk(valid('approval.decided', { gateId: 'g1', decidedBy: 'u1', decision: 'rejected', decisionReason: 'no' }));
  });
  test('invalid decision value', () => {
    expectFail(valid('approval.decided', { gateId: 'g1', decidedBy: 'u1', decision: 'maybe' }));
  });
});

// ─── approval.pool_refreshed ──────────────────────────────────────────────────

describe('approval.pool_refreshed', () => {
  test('valid', () => {
    expectOk(valid('approval.pool_refreshed', { gateId: 'g1', actorId: 'u1', newPoolSize: 3, stillBelowQuorum: true }));
  });
  test('newPoolSize is string', () => {
    expectFail(valid('approval.pool_refreshed', { gateId: 'g1', actorId: 'u1', newPoolSize: '3', stillBelowQuorum: false }));
  });
  test('stillBelowQuorum not boolean', () => {
    expectFail(valid('approval.pool_refreshed', { gateId: 'g1', actorId: 'u1', newPoolSize: 3, stillBelowQuorum: 1 }));
  });
});

// ─── ask.queued ───────────────────────────────────────────────────────────────

describe('ask.queued', () => {
  test('valid', () => {
    expectOk(valid('ask.queued', {
      gateId: 'g1', stepId: 's1', submitterPool: ['u1'],
      schema: { fields: [{ key: 'x', label: 'X', type: 'text' }] },
      prompt: 'what?',
    }));
  });
  test('missing schema.fields', () => {
    expectFail(valid('ask.queued', {
      gateId: 'g1', stepId: 's1', submitterPool: ['u1'],
      schema: {},
      prompt: 'what?',
    }));
  });
});

// ─── ask.submitted ────────────────────────────────────────────────────────────

describe('ask.submitted', () => {
  test('valid', () => {
    expectOk(valid('ask.submitted', { gateId: 'g1', submittedBy: 'u1', values: { x: 'y' } }));
  });
  test('values is array', () => {
    expectFail(valid('ask.submitted', { gateId: 'g1', submittedBy: 'u1', values: [] }));
  });
});

// ─── ask.skipped ──────────────────────────────────────────────────────────────

describe('ask.skipped', () => {
  test('valid', () => {
    expectOk(valid('ask.skipped', { gateId: 'g1', submittedBy: 'u1', stepId: 's1' }));
  });
  test('missing stepId', () => {
    expectFail(valid('ask.skipped', { gateId: 'g1', submittedBy: 'u1' }));
  });
});

// ─── file.created / file.edited ───────────────────────────────────────────────

describe('file.created', () => {
  test('valid', () => {
    expectOk(valid('file.created', { fileId: 'f1', version: 1, producerAgentId: 'a1' }));
  });
  test('version is string', () => {
    expectFail(valid('file.created', { fileId: 'f1', version: '1', producerAgentId: 'a1' }));
  });
});

describe('file.edited', () => {
  test('valid', () => {
    expectOk(valid('file.edited', { fileId: 'f1', priorVersion: 1, newVersion: 2, editRequest: 'fix typo' }));
  });
  test('missing editRequest', () => {
    expectFail(valid('file.edited', { fileId: 'f1', priorVersion: 1, newVersion: 2 }));
  });
});

// ─── chat.message ─────────────────────────────────────────────────────────────

describe('chat.message', () => {
  test('user message', () => {
    expectOk(valid('chat.message', { authorKind: 'user', authorId: 'u1', body: 'hello' }));
  });
  test('agent message with attachments', () => {
    expectOk(valid('chat.message', { authorKind: 'agent', authorId: 'a1', body: 'hi', attachments: [] }));
  });
  test('invalid authorKind', () => {
    expectFail(valid('chat.message', { authorKind: 'bot', authorId: 'a1', body: 'hi' }));
  });
});

// ─── agent.milestone ──────────────────────────────────────────────────────────

describe('agent.milestone', () => {
  test('valid without linkRef', () => {
    expectOk(valid('agent.milestone', { agentId: 'a1', summary: 'done it' }));
  });
  test('valid with linkRef', () => {
    expectOk(valid('agent.milestone', { agentId: 'a1', summary: 'done', linkRef: { kind: 'task', id: 't1', label: 'My task' } }));
  });
  test('missing summary', () => {
    expectFail(valid('agent.milestone', { agentId: 'a1' }));
  });
});

// ─── thinking.changed ────────────────────────────────────────────────────────

describe('thinking.changed', () => {
  test('valid', () => {
    expectOk(valid('thinking.changed', { newText: '...' }));
  });
  test('newText not string', () => {
    expectFail(valid('thinking.changed', { newText: 42 }));
  });
});

// ─── run.paused.* ────────────────────────────────────────────────────────────

describe('run.paused.cost_ceiling', () => {
  test('valid', () => {
    expectOk(valid('run.paused.cost_ceiling', { capValue: 1000, currentCost: 1050 }));
  });
  test('missing currentCost', () => {
    expectFail(valid('run.paused.cost_ceiling', { capValue: 1000 }));
  });
});

describe('run.paused.wall_clock', () => {
  test('valid', () => {
    expectOk(valid('run.paused.wall_clock', { capValue: 3600, currentElapsed: 3700 }));
  });
});

describe('run.paused.by_user', () => {
  test('valid', () => {
    expectOk(valid('run.paused.by_user', { actorId: 'u1' }));
  });
  test('missing actorId', () => {
    expectFail(valid('run.paused.by_user', {}));
  });
});

// ─── run.resumed / run.stopped.by_user ───────────────────────────────────────

describe('run.resumed', () => {
  test('valid minimal', () => {
    expectOk(valid('run.resumed', { actorId: 'u1' }));
  });
  test('valid with extensions', () => {
    expectOk(valid('run.resumed', { actorId: 'u1', extensionCostCents: 500, extensionSeconds: 3600 }));
  });
});

describe('run.stopped.by_user', () => {
  test('valid', () => {
    expectOk(valid('run.stopped.by_user', { actorId: 'u1' }));
  });
});

// ─── task.degraded ───────────────────────────────────────────────────────────

describe('task.degraded', () => {
  test('consumer_gap_detected', () => {
    expectOk(valid('task.degraded', {
      reason: 'consumer_gap_detected',
      degradationReason: 'buffer overflow',
      gapRange: [10, 15],
    }));
  });
  test('replay_cursor_expired', () => {
    expectOk(valid('task.degraded', {
      reason: 'replay_cursor_expired',
      degradationReason: 'cursor too old',
    }));
  });
  test('invalid reason', () => {
    expectFail(valid('task.degraded', { reason: 'unknown', degradationReason: 'x' }));
  });
  test('missing degradationReason', () => {
    expectFail(valid('task.degraded', { reason: 'consumer_gap_detected' }));
  });
});
