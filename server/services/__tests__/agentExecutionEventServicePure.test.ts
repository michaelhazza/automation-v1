import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  buildEventId,
  computeDurationSinceRunStartMs,
  isCriticalEventType,
  isNonCriticalCapHit,
  isValidLinkedEntityType,
  isValidSourceService,
  validateEventPayload,
  validateLinkedEntity,
} from '../agentExecutionEventServicePure.js';
import {
  AGENT_EXECUTION_EVENT_CRITICALITY,
  type AgentExecutionEventPayload,
  type AgentExecutionEventType,
} from '../../../shared/types/agentExecutionLog.js';

// ---------------------------------------------------------------------------
// Critical-bit enforcement — pins every event type against the §5.3 table
// via the single-source-of-truth registry.
// ---------------------------------------------------------------------------

test('every AgentExecutionEventType has a criticality entry', () => {
  const allTypes: AgentExecutionEventType[] = [
    'orchestrator.routing_decided',
    'run.started',
    'prompt.assembled',
    'context.source_loaded',
    'memory.retrieved',
    'rule.evaluated',
    'skill.invoked',
    'skill.completed',
    'llm.requested',
    'llm.completed',
    'handoff.decided',
    'clarification.requested',
    'run.event_limit_reached',
    'run.completed',
  ];
  for (const t of allTypes) {
    assert.equal(
      typeof AGENT_EXECUTION_EVENT_CRITICALITY[t],
      'boolean',
      `missing criticality for ${t}`,
    );
  }
});

test('critical event types are exactly the spec §5.3 set', () => {
  const expectedCritical = new Set<AgentExecutionEventType>([
    'run.started',
    'llm.requested',
    'llm.completed',
    'handoff.decided',
    'run.event_limit_reached',
    'run.completed',
  ]);
  for (const [type, crit] of Object.entries(AGENT_EXECUTION_EVENT_CRITICALITY)) {
    const expected = expectedCritical.has(type as AgentExecutionEventType);
    assert.equal(crit, expected, `${type}: expected critical=${expected}, got ${crit}`);
    assert.equal(isCriticalEventType(type as AgentExecutionEventType), expected);
  }
});

// ---------------------------------------------------------------------------
// isNonCriticalCapHit
// ---------------------------------------------------------------------------

test('isNonCriticalCapHit: below cap → false', () => {
  assert.equal(isNonCriticalCapHit(0, 10), false);
  assert.equal(isNonCriticalCapHit(9, 10), false);
});
test('isNonCriticalCapHit: at or above cap → true', () => {
  assert.equal(isNonCriticalCapHit(10, 10), true);
  assert.equal(isNonCriticalCapHit(11, 10), true);
});
test('isNonCriticalCapHit: invalid cap → false (no cap enforced)', () => {
  assert.equal(isNonCriticalCapHit(100, 0), false);
  assert.equal(isNonCriticalCapHit(100, -5), false);
});

// ---------------------------------------------------------------------------
// buildEventId
// ---------------------------------------------------------------------------

test('buildEventId: deterministic shape', () => {
  const id = buildEventId('r-1', 7, 'memory.retrieved');
  assert.equal(id, 'r-1:7:memory.retrieved');
});

test('buildEventId: components must be part of the unique key', () => {
  const a = buildEventId('r-1', 1, 'run.started');
  const b = buildEventId('r-2', 1, 'run.started');
  const c = buildEventId('r-1', 2, 'run.started');
  const d = buildEventId('r-1', 1, 'run.completed');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

// ---------------------------------------------------------------------------
// computeDurationSinceRunStartMs — clock-skew-safe
// ---------------------------------------------------------------------------

test('computeDurationSinceRunStartMs: normal case', () => {
  assert.equal(computeDurationSinceRunStartMs(1000, 2500), 1500);
});
test('computeDurationSinceRunStartMs: negative (clock skew) → 0', () => {
  assert.equal(computeDurationSinceRunStartMs(2000, 1000), 0);
});
test('computeDurationSinceRunStartMs: NaN → 0', () => {
  assert.equal(computeDurationSinceRunStartMs(NaN, 1000), 0);
  assert.equal(computeDurationSinceRunStartMs(1000, NaN), 0);
});
test('computeDurationSinceRunStartMs: always integer', () => {
  assert.equal(computeDurationSinceRunStartMs(0, 1.9), 1);
});

// ---------------------------------------------------------------------------
// isValidLinkedEntityType / isValidSourceService
// ---------------------------------------------------------------------------

test('isValidLinkedEntityType: accepts canonical types', () => {
  for (const t of [
    'memory_entry',
    'memory_block',
    'policy_rule',
    'skill',
    'data_source',
    'prompt',
    'agent',
    'llm_request',
    'action',
  ]) {
    assert.equal(isValidLinkedEntityType(t), true);
  }
});
test('isValidLinkedEntityType: rejects unknown + falsy', () => {
  assert.equal(isValidLinkedEntityType('rule'), false);
  assert.equal(isValidLinkedEntityType(''), false);
  assert.equal(isValidLinkedEntityType(undefined), false);
});

test('isValidSourceService: canonical list', () => {
  assert.equal(isValidSourceService('agentExecutionService'), true);
  assert.equal(isValidSourceService('llmRouter'), true);
  assert.equal(isValidSourceService('bogusService'), false);
});

// ---------------------------------------------------------------------------
// validateLinkedEntity — null-together semantics
// ---------------------------------------------------------------------------

test('validateLinkedEntity: undefined → normalised null', () => {
  const res = validateLinkedEntity(undefined);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.normalised, null);
});

test('validateLinkedEntity: null → normalised null', () => {
  const res = validateLinkedEntity(null);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.normalised, null);
});

test('validateLinkedEntity: both populated', () => {
  const res = validateLinkedEntity({ type: 'memory_entry', id: 'm-1' });
  assert.equal(res.ok, true);
  if (res.ok && res.normalised) {
    assert.equal(res.normalised.type, 'memory_entry');
    assert.equal(res.normalised.id, 'm-1');
  }
});

test('validateLinkedEntity: partial (type only) rejected', () => {
  const res = validateLinkedEntity({ type: 'memory_entry', id: '' });
  assert.equal(res.ok, false);
});

test('validateLinkedEntity: invalid type rejected', () => {
  const res = validateLinkedEntity({ type: 'bogus' as 'memory_entry', id: 'x' });
  assert.equal(res.ok, false);
});

// ---------------------------------------------------------------------------
// validateEventPayload — one passing + one failing fixture per type
// ---------------------------------------------------------------------------

function make<T extends AgentExecutionEventType>(
  type: T,
  extra: Record<string, unknown> = {},
): AgentExecutionEventPayload {
  return {
    eventType: type,
    critical: AGENT_EXECUTION_EVENT_CRITICALITY[type],
    ...extra,
  } as AgentExecutionEventPayload;
}

test('validateEventPayload: run.started happy + bad', () => {
  const ok = make('run.started', { agentId: 'a-1', runType: 'manual', triggeredBy: 'user' });
  assert.equal(validateEventPayload('run.started', ok).ok, true);
  const bad = make('run.started', { agentId: 'a-1' });
  assert.equal(validateEventPayload('run.started', bad).ok, false);
});

test('validateEventPayload: run.completed happy + bad', () => {
  const ok = make('run.completed', {
    finalStatus: 'completed',
    totalTokens: 100,
    totalCostCents: 50,
    totalDurationMs: 1234,
    eventCount: 7,
  });
  assert.equal(validateEventPayload('run.completed', ok).ok, true);
  const bad = make('run.completed', { finalStatus: 'completed' });
  assert.equal(validateEventPayload('run.completed', bad).ok, false);
});

test('validateEventPayload: prompt.assembled happy + bad layer tokens', () => {
  const ok = make('prompt.assembled', {
    assemblyNumber: 1,
    promptRowId: 'p-1',
    totalTokens: 500,
    layerTokens: { master: 100, orgAdditional: 0, memoryBlocks: 50, skillInstructions: 200, taskContext: 150 },
  });
  assert.equal(validateEventPayload('prompt.assembled', ok).ok, true);

  const bad = make('prompt.assembled', {
    assemblyNumber: 1,
    promptRowId: 'p-1',
    totalTokens: 500,
    layerTokens: { master: 100 },
  });
  assert.equal(validateEventPayload('prompt.assembled', bad).ok, false);
});

test('validateEventPayload: memory.retrieved happy + bad top entry', () => {
  const ok = make('memory.retrieved', {
    queryText: 'foo',
    retrievalMs: 42,
    topEntries: [{ id: 'm-1', score: 0.9, excerpt: 'bar' }],
    totalRetrieved: 1,
  });
  assert.equal(validateEventPayload('memory.retrieved', ok).ok, true);
  const bad = make('memory.retrieved', {
    queryText: 'foo',
    retrievalMs: 42,
    topEntries: [{ id: 'm-1', score: 'high' }],
    totalRetrieved: 1,
  });
  assert.equal(validateEventPayload('memory.retrieved', bad).ok, false);
});

test('validateEventPayload: rule.evaluated rejects invalid decision', () => {
  const bad = make('rule.evaluated', {
    toolSlug: 'send_email',
    decision: 'yolo',
    guidanceInjected: true,
  });
  assert.equal(validateEventPayload('rule.evaluated', bad).ok, false);
});

test('validateEventPayload: skill.completed rejects unknown status', () => {
  const bad = make('skill.completed', {
    skillSlug: 'send_email',
    durationMs: 10,
    status: 'perhaps',
    resultSummary: '',
  });
  assert.equal(validateEventPayload('skill.completed', bad).ok, false);
});

test('validateEventPayload: llm.requested happy + bad', () => {
  const ok = make('llm.requested', {
    llmRequestId: 'r-1',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    attempt: 1,
    featureTag: 'agent',
    payloadPreviewTokens: 500,
  });
  assert.equal(validateEventPayload('llm.requested', ok).ok, true);
  const bad = make('llm.requested', {
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    attempt: 1,
    featureTag: 'agent',
    payloadPreviewTokens: 500,
  });
  assert.equal(validateEventPayload('llm.requested', bad).ok, false);
});

test('validateEventPayload: handoff.decided happy + bad depth', () => {
  const ok = make('handoff.decided', {
    targetAgentId: 'a-2',
    reasonText: 'delegated',
    depth: 1,
    parentRunId: 'r-0',
  });
  assert.equal(validateEventPayload('handoff.decided', ok).ok, true);
  const bad = make('handoff.decided', {
    targetAgentId: 'a-2',
    reasonText: 'delegated',
    depth: -1,
    parentRunId: 'r-0',
  });
  assert.equal(validateEventPayload('handoff.decided', bad).ok, false);
});

test('validateEventPayload: run.event_limit_reached critical bit', () => {
  const ok = make('run.event_limit_reached', { eventCountAtLimit: 9999, cap: 10000 });
  const result = validateEventPayload('run.event_limit_reached', ok);
  assert.equal(result.ok, true);
  // If the critical bit is wrong the validator rejects.
  const bad = { ...ok, critical: false } as AgentExecutionEventPayload;
  assert.equal(validateEventPayload('run.event_limit_reached', bad).ok, false);
});

test('validateEventPayload: payload_type_mismatch when header differs', () => {
  const p = make('run.started', { agentId: 'a', runType: 'm', triggeredBy: 'u' });
  const result = validateEventPayload('run.completed', p);
  assert.equal(result.ok, false);
});
