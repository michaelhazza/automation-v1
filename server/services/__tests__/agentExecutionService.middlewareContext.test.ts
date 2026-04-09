/**
 * buildMiddlewareContext unit tests — runnable via:
 *   npx tsx server/services/__tests__/agentExecutionService.middlewareContext.test.ts
 *
 * Tests the pure constructor for MiddlewareContext, extracted from
 * runAgenticLoop in P0.1 Layer 3 of docs/improvements-roadmap-spec.md.
 *
 * The repo doesn't have Jest / Vitest configured, so we follow the same
 * lightweight pattern as server/services/__tests__/runContextLoader.test.ts.
 */

import {
  buildMiddlewareContext,
  type BuildMiddlewareContextParams,
} from '../agentExecutionServicePure.js';
import type { AgentRunRequest } from '../agentExecutionService.js';
import type { SubaccountAgent } from '../../db/schema/index.js';

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
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

// ── Fixture helpers ────────────────────────────────────────────────
function makeRequest(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    organisationId: 'org-abc',
    subaccountId: 'sa-xyz',
    agentId: 'agent-1',
    executionScope: 'subaccount',
    runType: 'manual',
    triggerContext: {},
    handoffDepth: 0,
    isSubAgent: false,
    ...overrides,
  } as AgentRunRequest;
}

function makeSaLink(): SubaccountAgent {
  // Cast via unknown — tests do not exercise every column on SubaccountAgent,
  // they just need a concrete object to pass through the constructor.
  return {
    id: 'link-1',
    subaccountId: 'sa-xyz',
    agentId: 'agent-1',
  } as unknown as SubaccountAgent;
}

function makeParams(overrides: Partial<BuildMiddlewareContextParams> = {}): BuildMiddlewareContextParams {
  return {
    runId: 'run-123',
    request: makeRequest(),
    agent: { modelId: 'claude-opus-4', temperature: 0.7, maxTokens: 4096 },
    saLink: makeSaLink(),
    startTime: 1_700_000_000_000,
    tokenBudget: 30000,
    maxToolCalls: 25,
    timeoutMs: 300000,
    ...overrides,
  };
}

console.log('');
console.log('buildMiddlewareContext — initial state constructor');
console.log('');

// ── Initial counter state ──────────────────────────────────────────
test('builds context with tokensUsed=0', () => {
  const ctx = buildMiddlewareContext(makeParams());
  assertEqual(ctx.tokensUsed, 0, 'tokensUsed');
});

test('builds context with toolCallsCount=0', () => {
  const ctx = buildMiddlewareContext(makeParams());
  assertEqual(ctx.toolCallsCount, 0, 'toolCallsCount');
});

test('builds context with empty toolCallHistory', () => {
  const ctx = buildMiddlewareContext(makeParams());
  assertEqual(ctx.toolCallHistory, [], 'toolCallHistory');
});

test('builds context with iteration=0', () => {
  const ctx = buildMiddlewareContext(makeParams());
  assertEqual(ctx.iteration, 0, 'iteration');
});

// ── Pass-through params ────────────────────────────────────────────
test('forwards runId through unchanged', () => {
  const ctx = buildMiddlewareContext(makeParams({ runId: 'my-specific-run' }));
  assertEqual(ctx.runId, 'my-specific-run', 'runId');
});

test('forwards startTime through unchanged', () => {
  const ctx = buildMiddlewareContext(makeParams({ startTime: 9999 }));
  assertEqual(ctx.startTime, 9999, 'startTime');
});

test('forwards tokenBudget through unchanged', () => {
  const ctx = buildMiddlewareContext(makeParams({ tokenBudget: 50000 }));
  assertEqual(ctx.tokenBudget, 50000, 'tokenBudget');
});

test('forwards maxToolCalls through unchanged', () => {
  const ctx = buildMiddlewareContext(makeParams({ maxToolCalls: 10 }));
  assertEqual(ctx.maxToolCalls, 10, 'maxToolCalls');
});

test('forwards timeoutMs through unchanged', () => {
  const ctx = buildMiddlewareContext(makeParams({ timeoutMs: 60000 }));
  assertEqual(ctx.timeoutMs, 60000, 'timeoutMs');
});

test('forwards agent modelId / temperature / maxTokens', () => {
  const agent = { modelId: 'claude-sonnet-4', temperature: 0.3, maxTokens: 8192 };
  const ctx = buildMiddlewareContext(makeParams({ agent }));
  assertEqual(ctx.agent, agent, 'agent');
});

test('forwards request through unchanged', () => {
  const request = makeRequest({ agentId: 'a-456', organisationId: 'org-other' });
  const ctx = buildMiddlewareContext(makeParams({ request }));
  assertEqual(ctx.request, request, 'request');
});

test('forwards saLink through unchanged', () => {
  const saLink = makeSaLink();
  const ctx = buildMiddlewareContext(makeParams({ saLink }));
  assertEqual(ctx.saLink, saLink, 'saLink');
});

// ── Warning-state flags default to absent ──────────────────────────
test('soft warning flag not set initially', () => {
  const ctx = buildMiddlewareContext(makeParams());
  assert(ctx._softWarningIssued === undefined, '_softWarningIssued should be undefined');
});

test('critical warning flag not set initially', () => {
  const ctx = buildMiddlewareContext(makeParams());
  assert(ctx._criticalWarningIssued === undefined, '_criticalWarningIssued should be undefined');
});

test('cycle warning flag not set initially', () => {
  const ctx = buildMiddlewareContext(makeParams());
  assert(ctx._cycleWarningIssued === undefined, '_cycleWarningIssued should be undefined');
});

// ── Purity check ───────────────────────────────────────────────────
test('two calls with the same params produce structurally equal contexts', () => {
  const params = makeParams();
  const ctx1 = buildMiddlewareContext(params);
  const ctx2 = buildMiddlewareContext(params);
  assertEqual(
    JSON.parse(JSON.stringify(ctx1)),
    JSON.parse(JSON.stringify(ctx2)),
    'structural equality',
  );
});

test('successive calls produce distinct object references (no aliasing)', () => {
  const params = makeParams();
  const ctx1 = buildMiddlewareContext(params);
  const ctx2 = buildMiddlewareContext(params);
  assert(ctx1 !== ctx2, 'references should differ');
  assert(ctx1.toolCallHistory !== ctx2.toolCallHistory, 'toolCallHistory arrays should be fresh per call');
});

test('mutating the returned toolCallHistory does not affect later calls', () => {
  const params = makeParams();
  const ctx1 = buildMiddlewareContext(params);
  ctx1.toolCallHistory.push({ name: 'evil', inputHash: 'hash', iteration: 99 });
  const ctx2 = buildMiddlewareContext(params);
  assertEqual(ctx2.toolCallHistory, [], 'ctx2 toolCallHistory still empty');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
