/**
 * agentExecutionServicePure.checkpoint.test.ts — Sprint 3 P2.1 Sprint 3A
 *
 * Covers the three checkpoint helpers:
 *   - serialiseMiddlewareContext
 *   - deserialiseMiddlewareContext
 *   - buildResumeContext
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentExecutionServicePure.checkpoint.test.ts
 */

import { expect, test } from 'vitest';
import {
  serialiseMiddlewareContext,
  deserialiseMiddlewareContext,
  buildResumeContext,
} from '../agentExecutionServicePure.js';
import type {
  MiddlewareContext,
  SerialisableMiddlewareContext,
  AgentRunCheckpoint,
  PreToolDecision,
} from '../middleware/types.js';
import { MIDDLEWARE_CONTEXT_VERSION } from '../../config/limits.js';

function assertThrows(fn: () => unknown, label: string): void {
  let thrown = false;
  try { fn(); } catch { thrown = true; }
  if (!thrown) throw new Error(`${label} — expected throw`);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// Build a fake MiddlewareContext. Only the persisted fields are
// exercised by the serialise path; ephemeral fields exist for type
// completeness.
function makeCtx(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  const base: MiddlewareContext = {
    runId: 'run-1',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: {} as any,
    agent: { modelId: 'gpt-4o', temperature: 0.2, maxTokens: 4096 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saLink: {} as any,
    tokensUsed: 0,
    toolCallsCount: 0,
    toolCallHistory: [],
    iteration: 0,
    startTime: 1_700_000_000_000,
    tokenBudget: 100_000,
    maxToolCalls: 50,
    timeoutMs: 300_000,
    preToolDecisions: new Map(),
  };
  return { ...base, ...overrides };
}

console.log('');
console.log('agentExecutionServicePure.checkpoint — Sprint 3 P2.1 Sprint 3A');
console.log('');

// ── serialiseMiddlewareContext ─────────────────────────────────────

test('serialises a fresh context with default counters', () => {
  const ctx = makeCtx();
  const out = serialiseMiddlewareContext(ctx);
  expect(out.middlewareVersion, 'version').toEqual(MIDDLEWARE_CONTEXT_VERSION);
  expect(out.iteration, 'iteration').toBe(0);
  expect(out.tokensUsed, 'tokensUsed').toBe(0);
  expect(out.toolCallsCount, 'toolCallsCount').toBe(0);
  expect(out.toolCallHistory, 'toolCallHistory').toEqual([]);
  expect(out.preToolDecisions, 'empty preToolDecisions').toEqual({});
  expect(out.lastReviewCodeVerdict, 'null verdict').toBe(null);
  expect(out.reviewCodeIterations, 'zero review iters').toBe(0);
});

test('serialises a context with live counters', () => {
  const ctx = makeCtx({
    iteration: 3,
    tokensUsed: 12_345,
    toolCallsCount: 7,
    toolCallHistory: [
      { name: 'search', inputHash: 'abc', iteration: 0 },
      { name: 'write', inputHash: 'def', iteration: 1 },
    ],
    lastReviewCodeVerdict: 'APPROVE',
    reviewCodeIterations: 2,
    lastAssistantText: '<tool_intent>{"tool":"x","confidence":0.9}</tool_intent>',
  });
  const out = serialiseMiddlewareContext(ctx);
  expect(out.iteration, 'iteration').toBe(3);
  expect(out.tokensUsed, 'tokensUsed').toEqual(12_345);
  expect(out.toolCallsCount, 'toolCallsCount').toBe(7);
  expect(out.toolCallHistory.length, 'history length').toBe(2);
  expect(out.lastReviewCodeVerdict, 'verdict').toBe('APPROVE');
  expect(out.reviewCodeIterations, 'review iters').toBe(2);
  expect(out.lastAssistantText, 'assistant text').toBe('<tool_intent>{"tool":"x","confidence":0.9}</tool_intent>');
});

test('flattens preToolDecisions Map into a plain object', () => {
  const ctx = makeCtx();
  ctx.preToolDecisions.set('tc_1', { action: 'continue' });
  ctx.preToolDecisions.set('tc_2', {
    action: 'block',
    reason: 'policy_block',
  });
  const out = serialiseMiddlewareContext(ctx);
  expect(out.preToolDecisions, 'flattened decisions').toEqual({
      tc_1: { action: 'continue' },
      tc_2: { action: 'block', reason: 'policy_block' },
    });
});

test('toolCallHistory is a defensive copy (not the same reference)', () => {
  const ctx = makeCtx({
    toolCallHistory: [{ name: 'search', inputHash: 'abc', iteration: 0 }],
  });
  const out = serialiseMiddlewareContext(ctx);
  // Mutate the source after serialisation — snapshot must not reflect it.
  ctx.toolCallHistory.push({ name: 'mutated', inputHash: 'zzz', iteration: 1 });
  expect(out.toolCallHistory.length, 'snapshot unchanged').toBe(1);
  expect(out.toolCallHistory[0].name, 'original entry preserved').toBe('search');
});

test('round-trips through JSON.stringify without data loss', () => {
  const ctx = makeCtx({
    iteration: 5,
    tokensUsed: 50_000,
    toolCallsCount: 10,
    lastReviewCodeVerdict: 'BLOCKED',
  });
  ctx.preToolDecisions.set('tc_1', { action: 'continue' });
  const out = serialiseMiddlewareContext(ctx);
  const round = JSON.parse(JSON.stringify(out)) as SerialisableMiddlewareContext;
  expect(round.iteration, 'json iteration').toBe(5);
  expect(round.preToolDecisions?.tc_1?.action, 'json decisions').toBe('continue');
  expect(round.lastReviewCodeVerdict, 'json verdict').toBe('BLOCKED');
});

// ── deserialiseMiddlewareContext ───────────────────────────────────

test('rehydrates a minimal serialised context', () => {
  const serialised: SerialisableMiddlewareContext = {
    middlewareVersion: MIDDLEWARE_CONTEXT_VERSION,
    iteration: 2,
    tokensUsed: 1000,
    toolCallsCount: 3,
    toolCallHistory: [],
    preToolDecisions: {},
  };
  const out = deserialiseMiddlewareContext(serialised);
  expect(out.iteration, 'iteration').toBe(2);
  expect(out.tokensUsed, 'tokens').toBe(1000);
  expect(out.preToolDecisions instanceof Map, 'Map restored').toBe(true);
  expect(out.preToolDecisions.size, 'empty map').toBe(0);
});

test('rehydrates preToolDecisions as a Map<string, PreToolDecision>', () => {
  const serialised: SerialisableMiddlewareContext = {
    middlewareVersion: MIDDLEWARE_CONTEXT_VERSION,
    iteration: 0,
    tokensUsed: 0,
    toolCallsCount: 0,
    toolCallHistory: [],
    preToolDecisions: {
      tc_1: { action: 'continue' },
      tc_2: { action: 'skip', reason: 'already_executed' },
    },
  };
  const out = deserialiseMiddlewareContext(serialised);
  expect(out.preToolDecisions instanceof Map, 'Map type').toBe(true);
  expect(out.preToolDecisions.size, 'two decisions').toBe(2);
  const d1 = out.preToolDecisions.get('tc_1') as PreToolDecision | undefined;
  const d2 = out.preToolDecisions.get('tc_2') as PreToolDecision | undefined;
  expect(d1?.action, 'tc_1 action').toBe('continue');
  expect(d2?.action, 'tc_2 action').toBe('skip');
});

test('rejects a checkpoint with a mismatched middlewareVersion', () => {
  const serialised: SerialisableMiddlewareContext = {
    middlewareVersion: MIDDLEWARE_CONTEXT_VERSION + 1,
    iteration: 0,
    tokensUsed: 0,
    toolCallsCount: 0,
    toolCallHistory: [],
  };
  assertThrows(
    () => deserialiseMiddlewareContext(serialised),
    'version mismatch',
  );
});

test('rehydrated toolCallHistory is a defensive copy', () => {
  const history = [{ name: 'search', inputHash: 'a', iteration: 0 }];
  const serialised: SerialisableMiddlewareContext = {
    middlewareVersion: MIDDLEWARE_CONTEXT_VERSION,
    iteration: 0,
    tokensUsed: 0,
    toolCallsCount: 0,
    toolCallHistory: history,
  };
  const out = deserialiseMiddlewareContext(serialised);
  history.push({ name: 'mutated', inputHash: 'b', iteration: 1 });
  expect(out.toolCallHistory.length, 'snapshot unchanged').toBe(1);
});

test('defaults missing reviewCodeIterations to 0', () => {
  const serialised: SerialisableMiddlewareContext = {
    middlewareVersion: MIDDLEWARE_CONTEXT_VERSION,
    iteration: 0,
    tokensUsed: 0,
    toolCallsCount: 0,
    toolCallHistory: [],
  };
  const out = deserialiseMiddlewareContext(serialised);
  expect(out.reviewCodeIterations, 'default review iters').toBe(0);
  expect(out.lastReviewCodeVerdict, 'default verdict').toBe(null);
});

// ── buildResumeContext ─────────────────────────────────────────────

function makeCheckpoint(
  overrides: Partial<AgentRunCheckpoint> = {},
): AgentRunCheckpoint {
  const mc: SerialisableMiddlewareContext = {
    middlewareVersion: MIDDLEWARE_CONTEXT_VERSION,
    iteration: 4,
    tokensUsed: 25_000,
    toolCallsCount: 6,
    toolCallHistory: [{ name: 'search', inputHash: 'abc', iteration: 0 }],
    lastReviewCodeVerdict: 'APPROVE',
    reviewCodeIterations: 1,
    preToolDecisions: { tc_1: { action: 'continue' } },
  };
  return {
    version: 1,
    iteration: 4,
    totalToolCalls: 6,
    totalTokensUsed: 25_000,
    messageCursor: 18,
    middlewareContext: mc,
    resumeToken: 'tok_abc',
    configVersion: 'cfg_xyz',
    ...overrides,
  };
}

test('builds a resume context at iteration + 1', () => {
  const checkpoint = makeCheckpoint();
  const out = buildResumeContext({
    checkpoint,
    runId: 'run-1',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: {} as any,
    agent: { modelId: 'gpt-4o', temperature: 0, maxTokens: 4096 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saLink: {} as any,
    startTime: 1_700_000_999_999,
    tokenBudget: 100_000,
    maxToolCalls: 50,
    timeoutMs: 300_000,
  });
  expect(out.iteration, 'iteration + 1').toBe(5);
  expect(out.tokensUsed, 'tokens carried forward').toEqual(25_000);
  expect(out.toolCallsCount, 'tool calls carried forward').toBe(6);
  expect(out.lastReviewCodeVerdict, 'verdict preserved').toBe('APPROVE');
  expect(out.reviewCodeIterations, 'review iters preserved').toBe(1);
  expect(out.preToolDecisions instanceof Map, 'Map restored').toBe(true);
  expect(out.preToolDecisions.get('tc_1')?.action, 'decision restored').toBe('continue');
  // Live runtime fields are the ones passed in, not the checkpoint.
  expect(out.startTime, 'fresh startTime').toEqual(1_700_000_999_999);
  expect(out.tokenBudget, 'fresh tokenBudget').toEqual(100_000);
  expect(out.runId, 'runId').toBe('run-1');
});

test('rejects a checkpoint with an unsupported version', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checkpoint = makeCheckpoint({ version: 99 as any });
  assertThrows(
    () =>
      buildResumeContext({
        checkpoint,
        runId: 'run-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        request: {} as any,
        agent: { modelId: 'gpt-4o', temperature: 0, maxTokens: 4096 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        saLink: {} as any,
        startTime: 0,
        tokenBudget: 0,
        maxToolCalls: 0,
        timeoutMs: 0,
      }),
    'bad version',
  );
});

test('rejects a checkpoint whose middlewareContext.middlewareVersion is stale', () => {
  const checkpoint = makeCheckpoint({
    middlewareContext: {
      ...makeCheckpoint().middlewareContext,
      middlewareVersion: MIDDLEWARE_CONTEXT_VERSION + 1,
    },
  });
  assertThrows(
    () =>
      buildResumeContext({
        checkpoint,
        runId: 'run-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        request: {} as any,
        agent: { modelId: 'gpt-4o', temperature: 0, maxTokens: 4096 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        saLink: {} as any,
        startTime: 0,
        tokenBudget: 0,
        maxToolCalls: 0,
        timeoutMs: 0,
      }),
    'stale middlewareVersion',
  );
});

// ── serialise → deserialise → build round-trip ─────────────────────

test('round-trip: serialise → JSON → deserialise → build preserves state', () => {
  const ctx = makeCtx({
    iteration: 2,
    tokensUsed: 9999,
    toolCallsCount: 4,
    toolCallHistory: [{ name: 'write', inputHash: 'zz', iteration: 1 }],
    lastReviewCodeVerdict: 'BLOCKED',
    reviewCodeIterations: 2,
    lastAssistantText: 'hello',
  });
  ctx.preToolDecisions.set('tc_a', { action: 'continue' });

  const serialised = serialiseMiddlewareContext(ctx);
  const roundTripped = JSON.parse(JSON.stringify(serialised)) as SerialisableMiddlewareContext;

  const checkpoint: AgentRunCheckpoint = {
    version: 1,
    iteration: 2,
    totalToolCalls: 4,
    totalTokensUsed: 9999,
    messageCursor: 10,
    middlewareContext: roundTripped,
    resumeToken: 'tok',
    configVersion: 'cfg',
  };

  const out = buildResumeContext({
    checkpoint,
    runId: 'run-1',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: {} as any,
    agent: { modelId: 'gpt-4o', temperature: 0, maxTokens: 4096 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saLink: {} as any,
    startTime: 1_700_001_000_000,
    tokenBudget: 100_000,
    maxToolCalls: 50,
    timeoutMs: 300_000,
  });

  expect(out.iteration, 'iteration + 1 after round trip').toBe(3);
  expect(out.tokensUsed, 'tokens preserved').toBe(9999);
  expect(out.lastReviewCodeVerdict, 'verdict preserved').toBe('BLOCKED');
  expect(out.reviewCodeIterations, 'review iters preserved').toBe(2);
  expect(out.preToolDecisions.get('tc_a')?.action, 'decision preserved').toBe('continue');
  expect(out.lastAssistantText, 'assistant text preserved').toBe('hello');
});

console.log('');
console.log('');
