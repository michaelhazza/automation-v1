/**
 * llmStub unit tests.
 *
 * Tests the pure matcher logic in llmStub.ts (scenario evaluation, last-user
 * text extraction, call recording, reset). The stub itself is not exercised
 * through the full routeCall path here — that's covered by the smoke test
 * in server/services/__tests__/agentExecution.smoke.test.ts.
 */

import { expect, test } from 'vitest';
import { createLLMStub, extractLastUserText, type LLMStubScenario } from './llmStub.js';
import type { RouterCallParams } from '../../services/llmRouter.js';
import type { ProviderMessage, ProviderResponse } from '../../services/providers/types.js';

// ── Fixture helpers ────────────────────────────────────────────────
function makeResponse(overrides: Partial<ProviderResponse> = {}): ProviderResponse {
  return {
    content: 'hello',
    stopReason: 'end_turn',
    tokensIn: 10,
    tokensOut: 5,
    providerRequestId: 'stub-req',
    ...overrides,
  };
}

function makeParams(
  messages: ProviderMessage[],
  system?: string,
): RouterCallParams {
  return {
    messages,
    system,
    context: {} as unknown as RouterCallParams['context'],
  };
}

// ── extractLastUserText ───────────────────────────────────────────

test('extractLastUserText: empty messages → null', () => {
  expect(extractLastUserText([])).toBe(null);
});

test('extractLastUserText: last message is assistant → null', () => {
  expect(extractLastUserText([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ])).toBe(null);
});

test('extractLastUserText: last message is user string → returns string', () => {
  expect(extractLastUserText([
    { role: 'assistant', content: 'previous' },
    { role: 'user', content: 'current message' },
  ])).toBe('current message');
});

test('extractLastUserText: last message is user with text blocks → concatenates texts', () => {
  expect(extractLastUserText([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'part A' },
        { type: 'text', text: 'part B' },
      ],
    },
  ])).toBe('part A\npart B');
});

test('extractLastUserText: last message is user with only tool_result blocks → null', () => {
  expect(extractLastUserText([
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tc-1', content: 'result text' }],
    },
  ])).toBe(null);
});

test('extractLastUserText: last message is user with mixed text + tool_result → only text blocks returned', () => {
  expect(extractLastUserText([
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tc-1', content: 'ignored' },
        { type: 'text', text: 'kept' },
      ],
    },
  ])).toBe('kept');
});

// ── Scenario matching ─────────────────────────────────────────────

test('createLLMStub: wildcard scenario matches any call', async () => {
  const stub = createLLMStub([
    { response: makeResponse({ content: 'wildcarded' }) },
  ]);
  const result = await stub.routeCall(makeParams([{ role: 'user', content: 'anything' }]));
  expect(result.content).toBe('wildcarded');
  expect(stub.callCount).toBe(1);
});

test('createLLMStub: matchOnSystem matches when system regex matches', async () => {
  const stub = createLLMStub([
    {
      matchOnSystem: /^You are a helpful/,
      response: makeResponse({ content: 'matched system' }),
    },
    { response: makeResponse({ content: 'fallback' }) },
  ]);
  const result = await stub.routeCall(
    makeParams([{ role: 'user', content: 'hi' }], 'You are a helpful assistant'),
  );
  expect(result.content).toBe('matched system');
});

test('createLLMStub: matchOnSystem falls through when system does not match', async () => {
  const stub = createLLMStub([
    {
      matchOnSystem: /^You are a helpful/,
      response: makeResponse({ content: 'matched' }),
    },
    { response: makeResponse({ content: 'fallback' }) },
  ]);
  const result = await stub.routeCall(
    makeParams([{ role: 'user', content: 'hi' }], 'Some other system'),
  );
  expect(result.content).toBe('fallback');
});

test('createLLMStub: matchOnLastUser matches when last user message regex matches', async () => {
  const stub = createLLMStub([
    {
      matchOnLastUser: /read the workspace/i,
      response: makeResponse({ content: 'read_workspace path' }),
    },
    { response: makeResponse({ content: 'fallback' }) },
  ]);
  const result = await stub.routeCall(
    makeParams([{ role: 'user', content: 'please read the workspace' }]),
  );
  expect(result.content).toBe('read_workspace path');
});

test('createLLMStub: both matchers must match when both are present', async () => {
  const stub = createLLMStub([
    {
      matchOnSystem: /dev-agent/,
      matchOnLastUser: /write a patch/,
      response: makeResponse({ content: 'both matched' }),
    },
    { response: makeResponse({ content: 'fallback' }) },
  ]);
  const r1 = await stub.routeCall(
    makeParams([{ role: 'user', content: 'write a patch' }], 'qa-agent'),
  );
  expect(r1.content).toBe('fallback');
  const r2 = await stub.routeCall(
    makeParams([{ role: 'user', content: 'write a patch now' }], 'dev-agent system prompt'),
  );
  expect(r2.content).toBe('both matched');
});

test('createLLMStub: scenarios are evaluated in order; first match wins', async () => {
  const stub = createLLMStub([
    { matchOnLastUser: /hello/, response: makeResponse({ content: 'first' }) },
    { matchOnLastUser: /hello/, response: makeResponse({ content: 'second' }) },
  ]);
  const result = await stub.routeCall(makeParams([{ role: 'user', content: 'hello world' }]));
  expect(result.content).toBe('first');
});

test('createLLMStub: no scenario matches → routeCall throws with messages attached', async () => {
  const stub = createLLMStub([
    { matchOnLastUser: /hello/, response: makeResponse({ content: 'never' }) },
  ]);
  let thrown: unknown = null;
  try {
    await stub.routeCall(makeParams([{ role: 'user', content: 'goodbye' }]));
  } catch (err) {
    thrown = err;
  }
  expect(thrown instanceof Error).toBe(true);
  const e = thrown as Error & { messages?: ProviderMessage[] };
  expect(e.message.includes('no scenario matched')).toBe(true);
  expect(Array.isArray(e.messages)).toBe(true);
  expect(e.messages!.length).toBe(1);
});

// ── Call recording ─────────────────────────────────────────────

test('createLLMStub: calls[] records each invocation with params + scenarioIndex', async () => {
  const stub = createLLMStub([
    { matchOnLastUser: /alpha/, response: makeResponse({ content: 'A' }) },
    { matchOnLastUser: /beta/, response: makeResponse({ content: 'B' }) },
  ]);
  await stub.routeCall(makeParams([{ role: 'user', content: 'alpha request' }]));
  await stub.routeCall(makeParams([{ role: 'user', content: 'beta request' }]));

  expect(stub.calls.length).toBe(2);
  expect(stub.calls[0].scenarioIndex).toBe(0);
  expect(stub.calls[1].scenarioIndex).toBe(1);
  expect(stub.calls[0].timestamp > 0).toBe(true);
});

test('createLLMStub: response returned is a deep clone, not the scenario reference', async () => {
  const scenarios: LLMStubScenario[] = [
    { response: makeResponse({ content: 'original', toolCalls: [] }) },
  ];
  const stub = createLLMStub(scenarios);
  const r1 = await stub.routeCall(makeParams([{ role: 'user', content: 'x' }]));
  r1.content = 'mutated';
  const r2 = await stub.routeCall(makeParams([{ role: 'user', content: 'y' }]));
  expect(r2.content).toBe('original');
});

// ── Reset ─────────────────────────────────────────────────────

test('createLLMStub: reset() clears calls but keeps scenarios active', async () => {
  const stub = createLLMStub([
    { response: makeResponse({ content: 'hi' }) },
  ]);
  await stub.routeCall(makeParams([{ role: 'user', content: 'test' }]));
  expect(stub.callCount).toBe(1);

  stub.reset();
  expect(stub.callCount).toBe(0);

  const result = await stub.routeCall(makeParams([{ role: 'user', content: 'test2' }]));
  expect(result.content).toBe('hi');
  expect(stub.callCount).toBe(1);
});
