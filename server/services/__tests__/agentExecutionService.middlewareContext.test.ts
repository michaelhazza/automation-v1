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

import { expect, test } from 'vitest';
import {
  buildMiddlewareContext,
  type BuildMiddlewareContextParams,
} from '../agentExecutionServicePure.js';
import type { AgentRunRequest } from '../agentExecutionService.js';
import type { SubaccountAgent } from '../../db/schema/index.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
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
  expect(ctx.tokensUsed, 'tokensUsed').toBe(0);
});

test('builds context with toolCallsCount=0', () => {
  const ctx = buildMiddlewareContext(makeParams());
  expect(ctx.toolCallsCount, 'toolCallsCount').toBe(0);
});

test('builds context with empty toolCallHistory', () => {
  const ctx = buildMiddlewareContext(makeParams());
  expect(ctx.toolCallHistory, 'toolCallHistory').toEqual([]);
});

test('builds context with iteration=0', () => {
  const ctx = buildMiddlewareContext(makeParams());
  expect(ctx.iteration, 'iteration').toBe(0);
});

// ── Pass-through params ────────────────────────────────────────────
test('forwards runId through unchanged', () => {
  const ctx = buildMiddlewareContext(makeParams({ runId: 'my-specific-run' }));
  expect(ctx.runId, 'runId').toBe('my-specific-run');
});

test('forwards startTime through unchanged', () => {
  const ctx = buildMiddlewareContext(makeParams({ startTime: 9999 }));
  expect(ctx.startTime, 'startTime').toBe(9999);
});

test('forwards tokenBudget through unchanged', () => {
  const ctx = buildMiddlewareContext(makeParams({ tokenBudget: 50000 }));
  expect(ctx.tokenBudget, 'tokenBudget').toBe(50000);
});

test('forwards maxToolCalls through unchanged', () => {
  const ctx = buildMiddlewareContext(makeParams({ maxToolCalls: 10 }));
  expect(ctx.maxToolCalls, 'maxToolCalls').toBe(10);
});

test('forwards timeoutMs through unchanged', () => {
  const ctx = buildMiddlewareContext(makeParams({ timeoutMs: 60000 }));
  expect(ctx.timeoutMs, 'timeoutMs').toBe(60000);
});

test('forwards agent modelId / temperature / maxTokens', () => {
  const agent = { modelId: 'claude-sonnet-4', temperature: 0.3, maxTokens: 8192 };
  const ctx = buildMiddlewareContext(makeParams({ agent }));
  expect(ctx.agent, 'agent').toEqual(agent);
});

test('forwards request through unchanged', () => {
  const request = makeRequest({ agentId: 'a-456', organisationId: 'org-other' });
  const ctx = buildMiddlewareContext(makeParams({ request }));
  expect(ctx.request, 'request').toEqual(request);
});

test('forwards saLink through unchanged', () => {
  const saLink = makeSaLink();
  const ctx = buildMiddlewareContext(makeParams({ saLink }));
  expect(ctx.saLink, 'saLink').toEqual(saLink);
});

// ── Warning-state flags default to absent ──────────────────────────
test('soft warning flag not set initially', () => {
  const ctx = buildMiddlewareContext(makeParams());
  expect(ctx._softWarningIssued === undefined, '_softWarningIssued should be undefined').toBeTruthy();
});

test('critical warning flag not set initially', () => {
  const ctx = buildMiddlewareContext(makeParams());
  expect(ctx._criticalWarningIssued === undefined, '_criticalWarningIssued should be undefined').toBeTruthy();
});

test('cycle warning flag not set initially', () => {
  const ctx = buildMiddlewareContext(makeParams());
  expect(ctx._cycleWarningIssued === undefined, '_cycleWarningIssued should be undefined').toBeTruthy();
});

// ── Sprint 2 P1.1 Layer 3 — preToolDecisions cache ─────────────────
test('preToolDecisions initialised as empty Map', () => {
  const ctx = buildMiddlewareContext(makeParams());
  expect(ctx.preToolDecisions instanceof Map, 'preToolDecisions should be a Map').toBeTruthy();
  expect(ctx.preToolDecisions.size === 0, 'preToolDecisions should be empty').toBeTruthy();
});

test('mutating preToolDecisions does not affect later calls', () => {
  const params = makeParams();
  const ctx1 = buildMiddlewareContext(params);
  ctx1.preToolDecisions.set('tc1', { action: 'continue' });
  const ctx2 = buildMiddlewareContext(params);
  expect(ctx2.preToolDecisions.size === 0, 'ctx2 preToolDecisions still empty').toBeTruthy();
});

// ── Purity check ───────────────────────────────────────────────────
test('two calls with the same params produce structurally equal contexts', () => {
  const params = makeParams();
  const ctx1 = buildMiddlewareContext(params);
  const ctx2 = buildMiddlewareContext(params);
  expect(JSON.parse(JSON.stringify(ctx1)), 'structural equality').toEqual(JSON.parse(JSON.stringify(ctx2)));
});

test('successive calls produce distinct object references (no aliasing)', () => {
  const params = makeParams();
  const ctx1 = buildMiddlewareContext(params);
  const ctx2 = buildMiddlewareContext(params);
  expect(ctx1 !== ctx2, 'references should differ').toBeTruthy();
  expect(ctx1.toolCallHistory !== ctx2.toolCallHistory, 'toolCallHistory arrays should be fresh per call').toBeTruthy();
});

test('mutating the returned toolCallHistory does not affect later calls', () => {
  const params = makeParams();
  const ctx1 = buildMiddlewareContext(params);
  ctx1.toolCallHistory.push({ name: 'evil', inputHash: 'hash', iteration: 99 });
  const ctx2 = buildMiddlewareContext(params);
  expect(ctx2.toolCallHistory, 'ctx2 toolCallHistory still empty').toEqual([]);
});

console.log('');
console.log('');
