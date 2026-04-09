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

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertThrows(fn: () => void, label: string) {
  let thrown = false;
  try {
    fn();
  } catch {
    thrown = true;
  }
  if (!thrown) throw new Error(`${label} — expected throw`);
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
  assertEqual(out.middlewareVersion, MIDDLEWARE_CONTEXT_VERSION, 'version');
  assertEqual(out.iteration, 0, 'iteration');
  assertEqual(out.tokensUsed, 0, 'tokensUsed');
  assertEqual(out.toolCallsCount, 0, 'toolCallsCount');
  assertEqual(out.toolCallHistory, [], 'toolCallHistory');
  assertEqual(out.preToolDecisions, {}, 'empty preToolDecisions');
  assertEqual(out.lastReviewCodeVerdict, null, 'null verdict');
  assertEqual(out.reviewCodeIterations, 0, 'zero review iters');
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
  assertEqual(out.iteration, 3, 'iteration');
  assertEqual(out.tokensUsed, 12_345, 'tokensUsed');
  assertEqual(out.toolCallsCount, 7, 'toolCallsCount');
  assertEqual(out.toolCallHistory.length, 2, 'history length');
  assertEqual(out.lastReviewCodeVerdict, 'APPROVE', 'verdict');
  assertEqual(out.reviewCodeIterations, 2, 'review iters');
  assertEqual(
    out.lastAssistantText,
    '<tool_intent>{"tool":"x","confidence":0.9}</tool_intent>',
    'assistant text',
  );
});

test('flattens preToolDecisions Map into a plain object', () => {
  const ctx = makeCtx();
  ctx.preToolDecisions.set('tc_1', { action: 'continue' });
  ctx.preToolDecisions.set('tc_2', {
    action: 'block',
    reason: 'policy_block',
  });
  const out = serialiseMiddlewareContext(ctx);
  assertEqual(
    out.preToolDecisions,
    {
      tc_1: { action: 'continue' },
      tc_2: { action: 'block', reason: 'policy_block' },
    },
    'flattened decisions',
  );
});

test('toolCallHistory is a defensive copy (not the same reference)', () => {
  const ctx = makeCtx({
    toolCallHistory: [{ name: 'search', inputHash: 'abc', iteration: 0 }],
  });
  const out = serialiseMiddlewareContext(ctx);
  // Mutate the source after serialisation — snapshot must not reflect it.
  ctx.toolCallHistory.push({ name: 'mutated', inputHash: 'zzz', iteration: 1 });
  assertEqual(out.toolCallHistory.length, 1, 'snapshot unchanged');
  assertEqual(out.toolCallHistory[0].name, 'search', 'original entry preserved');
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
  assertEqual(round.iteration, 5, 'json iteration');
  assertEqual(round.preToolDecisions?.tc_1?.action, 'continue', 'json decisions');
  assertEqual(round.lastReviewCodeVerdict, 'BLOCKED', 'json verdict');
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
  assertEqual(out.iteration, 2, 'iteration');
  assertEqual(out.tokensUsed, 1000, 'tokens');
  assertEqual(out.preToolDecisions instanceof Map, true, 'Map restored');
  assertEqual(out.preToolDecisions.size, 0, 'empty map');
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
  assertEqual(out.preToolDecisions instanceof Map, true, 'Map type');
  assertEqual(out.preToolDecisions.size, 2, 'two decisions');
  const d1 = out.preToolDecisions.get('tc_1') as PreToolDecision | undefined;
  const d2 = out.preToolDecisions.get('tc_2') as PreToolDecision | undefined;
  assertEqual(d1?.action, 'continue', 'tc_1 action');
  assertEqual(d2?.action, 'skip', 'tc_2 action');
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
  assertEqual(out.toolCallHistory.length, 1, 'snapshot unchanged');
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
  assertEqual(out.reviewCodeIterations, 0, 'default review iters');
  assertEqual(out.lastReviewCodeVerdict, null, 'default verdict');
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
  assertEqual(out.iteration, 5, 'iteration + 1');
  assertEqual(out.tokensUsed, 25_000, 'tokens carried forward');
  assertEqual(out.toolCallsCount, 6, 'tool calls carried forward');
  assertEqual(out.lastReviewCodeVerdict, 'APPROVE', 'verdict preserved');
  assertEqual(out.reviewCodeIterations, 1, 'review iters preserved');
  assertEqual(out.preToolDecisions instanceof Map, true, 'Map restored');
  assertEqual(out.preToolDecisions.get('tc_1')?.action, 'continue', 'decision restored');
  // Live runtime fields are the ones passed in, not the checkpoint.
  assertEqual(out.startTime, 1_700_000_999_999, 'fresh startTime');
  assertEqual(out.tokenBudget, 100_000, 'fresh tokenBudget');
  assertEqual(out.runId, 'run-1', 'runId');
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

  assertEqual(out.iteration, 3, 'iteration + 1 after round trip');
  assertEqual(out.tokensUsed, 9999, 'tokens preserved');
  assertEqual(out.lastReviewCodeVerdict, 'BLOCKED', 'verdict preserved');
  assertEqual(out.reviewCodeIterations, 2, 'review iters preserved');
  assertEqual(out.preToolDecisions.get('tc_a')?.action, 'continue', 'decision preserved');
  assertEqual(out.lastAssistantText, 'hello', 'assistant text preserved');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
