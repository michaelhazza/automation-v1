import { expect, test } from 'vitest';
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
    expect(typeof AGENT_EXECUTION_EVENT_CRITICALITY[t], `missing criticality for ${t}`).toBe('boolean');
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
    expect(crit, `${type}: expected critical=${expected}, got ${crit}`).toBe(expected);
    expect(isCriticalEventType(type as AgentExecutionEventType)).toBe(expected);
  }
});

// ---------------------------------------------------------------------------
// isNonCriticalCapHit
// ---------------------------------------------------------------------------

test('isNonCriticalCapHit: below cap → false', () => {
  expect(isNonCriticalCapHit(0, 10)).toBe(false);
  expect(isNonCriticalCapHit(9, 10)).toBe(false);
});
test('isNonCriticalCapHit: at or above cap → true', () => {
  expect(isNonCriticalCapHit(10, 10)).toBe(true);
  expect(isNonCriticalCapHit(11, 10)).toBe(true);
});
test('isNonCriticalCapHit: invalid cap → false (no cap enforced)', () => {
  expect(isNonCriticalCapHit(100, 0)).toBe(false);
  expect(isNonCriticalCapHit(100, -5)).toBe(false);
});

// ---------------------------------------------------------------------------
// buildEventId
// ---------------------------------------------------------------------------

test('buildEventId: deterministic shape', () => {
  const id = buildEventId('r-1', 7, 'memory.retrieved');
  expect(id).toBe('r-1:7:memory.retrieved');
});

test('buildEventId: components must be part of the unique key', () => {
  const a = buildEventId('r-1', 1, 'run.started');
  const b = buildEventId('r-2', 1, 'run.started');
  const c = buildEventId('r-1', 2, 'run.started');
  const d = buildEventId('r-1', 1, 'run.completed');
  expect(a).not.toBe(b);
  expect(a).not.toBe(c);
  expect(a).not.toBe(d);
});

// ---------------------------------------------------------------------------
// computeDurationSinceRunStartMs — clock-skew-safe
// ---------------------------------------------------------------------------

test('computeDurationSinceRunStartMs: normal case', () => {
  expect(computeDurationSinceRunStartMs(1000, 2500)).toBe(1500);
});
test('computeDurationSinceRunStartMs: negative (clock skew) → 0', () => {
  expect(computeDurationSinceRunStartMs(2000, 1000)).toBe(0);
});
test('computeDurationSinceRunStartMs: NaN → 0', () => {
  expect(computeDurationSinceRunStartMs(NaN, 1000)).toBe(0);
  expect(computeDurationSinceRunStartMs(1000, NaN)).toBe(0);
});
test('computeDurationSinceRunStartMs: always integer', () => {
  expect(computeDurationSinceRunStartMs(0, 1.9)).toBe(1);
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
    expect(isValidLinkedEntityType(t)).toBe(true);
  }
});
test('isValidLinkedEntityType: rejects unknown + falsy', () => {
  expect(isValidLinkedEntityType('rule')).toBe(false);
  expect(isValidLinkedEntityType('')).toBe(false);
  expect(isValidLinkedEntityType(undefined)).toBe(false);
});

test('isValidSourceService: canonical list', () => {
  expect(isValidSourceService('agentExecutionService')).toBe(true);
  expect(isValidSourceService('llmRouter')).toBe(true);
  expect(isValidSourceService('bogusService')).toBe(false);
});

// ---------------------------------------------------------------------------
// validateLinkedEntity — null-together semantics
// ---------------------------------------------------------------------------

test('validateLinkedEntity: undefined → normalised null', () => {
  const res = validateLinkedEntity(undefined);
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.normalised).toBe(null);
});

test('validateLinkedEntity: null → normalised null', () => {
  const res = validateLinkedEntity(null);
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.normalised).toBe(null);
});

test('validateLinkedEntity: both populated', () => {
  const res = validateLinkedEntity({ type: 'memory_entry', id: 'm-1' });
  expect(res.ok).toBe(true);
  if (res.ok && res.normalised) {
    expect(res.normalised.type).toBe('memory_entry');
    expect(res.normalised.id).toBe('m-1');
  }
});

test('validateLinkedEntity: partial (type only) rejected', () => {
  const res = validateLinkedEntity({ type: 'memory_entry', id: '' });
  expect(res.ok).toBe(false);
});

test('validateLinkedEntity: invalid type rejected', () => {
  const res = validateLinkedEntity({ type: 'bogus' as 'memory_entry', id: 'x' });
  expect(res.ok).toBe(false);
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
  expect(validateEventPayload('run.started', ok).ok).toBe(true);
  const bad = make('run.started', { agentId: 'a-1' });
  expect(validateEventPayload('run.started', bad).ok).toBe(false);
});

test('validateEventPayload: run.completed happy + bad', () => {
  const ok = make('run.completed', {
    finalStatus: 'completed',
    totalTokens: 100,
    totalCostCents: 50,
    totalDurationMs: 1234,
    eventCount: 7,
  });
  expect(validateEventPayload('run.completed', ok).ok).toBe(true);
  const bad = make('run.completed', { finalStatus: 'completed' });
  expect(validateEventPayload('run.completed', bad).ok).toBe(false);
});

test('validateEventPayload: prompt.assembled happy + bad layer tokens', () => {
  const ok = make('prompt.assembled', {
    assemblyNumber: 1,
    promptRowId: 'p-1',
    totalTokens: 500,
    layerTokens: { master: 100, orgAdditional: 0, memoryBlocks: 50, skillInstructions: 200, taskContext: 150 },
  });
  expect(validateEventPayload('prompt.assembled', ok).ok).toBe(true);

  const bad = make('prompt.assembled', {
    assemblyNumber: 1,
    promptRowId: 'p-1',
    totalTokens: 500,
    layerTokens: { master: 100 },
  });
  expect(validateEventPayload('prompt.assembled', bad).ok).toBe(false);
});

test('validateEventPayload: memory.retrieved happy + bad top entry', () => {
  const ok = make('memory.retrieved', {
    queryText: 'foo',
    retrievalMs: 42,
    topEntries: [{ id: 'm-1', score: 0.9, excerpt: 'bar' }],
    totalRetrieved: 1,
  });
  expect(validateEventPayload('memory.retrieved', ok).ok).toBe(true);
  const bad = make('memory.retrieved', {
    queryText: 'foo',
    retrievalMs: 42,
    topEntries: [{ id: 'm-1', score: 'high' }],
    totalRetrieved: 1,
  });
  expect(validateEventPayload('memory.retrieved', bad).ok).toBe(false);
});

test('validateEventPayload: rule.evaluated rejects invalid decision', () => {
  const bad = make('rule.evaluated', {
    toolSlug: 'send_email',
    decision: 'yolo',
    guidanceInjected: true,
  });
  expect(validateEventPayload('rule.evaluated', bad).ok).toBe(false);
});

test('validateEventPayload: skill.completed rejects unknown status', () => {
  const bad = make('skill.completed', {
    skillSlug: 'send_email',
    durationMs: 10,
    status: 'perhaps',
    resultSummary: '',
  });
  expect(validateEventPayload('skill.completed', bad).ok).toBe(false);
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
  expect(validateEventPayload('llm.requested', ok).ok).toBe(true);
  const bad = make('llm.requested', {
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    attempt: 1,
    featureTag: 'agent',
    payloadPreviewTokens: 500,
  });
  expect(validateEventPayload('llm.requested', bad).ok).toBe(false);
});

test('validateEventPayload: handoff.decided happy + bad depth', () => {
  const ok = make('handoff.decided', {
    targetAgentId: 'a-2',
    reasonText: 'delegated',
    depth: 1,
    parentRunId: 'r-0',
  });
  expect(validateEventPayload('handoff.decided', ok).ok).toBe(true);
  const bad = make('handoff.decided', {
    targetAgentId: 'a-2',
    reasonText: 'delegated',
    depth: -1,
    parentRunId: 'r-0',
  });
  expect(validateEventPayload('handoff.decided', bad).ok).toBe(false);
});

test('validateEventPayload: run.event_limit_reached critical bit', () => {
  const ok = make('run.event_limit_reached', { eventCountAtLimit: 9999, cap: 10000 });
  const result = validateEventPayload('run.event_limit_reached', ok);
  expect(result.ok).toBe(true);
  // If the critical bit is wrong the validator rejects.
  const bad = { ...ok, critical: false } as AgentExecutionEventPayload;
  expect(validateEventPayload('run.event_limit_reached', bad).ok).toBe(false);
});

test('validateEventPayload: payload_type_mismatch when header differs', () => {
  const p = make('run.started', { agentId: 'a', runType: 'm', triggeredBy: 'u' });
  const result = validateEventPayload('run.completed', p);
  expect(result.ok).toBe(false);
});
