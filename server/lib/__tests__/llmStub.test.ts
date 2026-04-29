/**
 * llmStub unit tests — runnable via:
 *   npx tsx server/lib/__tests__/llmStub.test.ts
 *
 * Tests the pure matcher logic in llmStub.ts (scenario evaluation, last-user
 * text extraction, call recording, reset). The stub itself is not exercised
 * through the full routeCall path here — that's covered by the smoke test
 * in server/services/__tests__/agentExecution.smoke.test.ts.
 *
 * The repo doesn't have Jest / Vitest configured, so we follow the same
 * lightweight pattern as server/services/__tests__/runContextLoader.test.ts.
 */

import { expect, test } from 'vitest';
import { createLLMStub, extractLastUserText, type LLMStubScenario } from './llmStub.js';
import type { RouterCallParams } from '../../services/llmRouter.js';
import type { ProviderMessage, ProviderResponse } from '../../services/providers/types.js';

async function asyncTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
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
    // The stub never inspects this — we cast via unknown because the
    // LLMCallContext type has a dozen required fields and we do not
    // exercise any of them here. The stub is context-agnostic.
    context: {} as unknown as RouterCallParams['context'],
  };
}

async function main() {
  console.log('');
  console.log('extractLastUserText — pure text extractor');
  console.log('');

  // ── extractLastUserText ───────────────────────────────────────────
  test('empty messages → null', () => {
    expect(extractLastUserText([]), 'result').toBe(null);
  });

  test('last message is assistant → null', () => {
    expect(extractLastUserText([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]), 'result').toBe(null);
  });

  test('last message is user string → returns string', () => {
    expect(extractLastUserText([
        { role: 'assistant', content: 'previous' },
        { role: 'user', content: 'current message' },
      ]), 'result').toBe('current message');
  });

  test('last message is user with text blocks → concatenates texts', () => {
    expect(extractLastUserText([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'part A' },
            { type: 'text', text: 'part B' },
          ],
        },
      ]), 'result').toBe('part A\npart B');
  });

  test('last message is user with only tool_result blocks → null', () => {
    expect(extractLastUserText([
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tc-1', content: 'result text' }],
        },
      ]), 'result (no text blocks)').toBe(null);
  });

  test('last message is user with mixed text + tool_result → only text blocks returned', () => {
    expect(extractLastUserText([
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tc-1', content: 'ignored' },
            { type: 'text', text: 'kept' },
          ],
        },
      ]), 'result').toBe('kept');
  });

  console.log('');
  console.log('createLLMStub — scenario matching + call recording');
  console.log('');

  // ── Scenario matching ─────────────────────────────────────────────
  await asyncTest('wildcard scenario matches any call', async () => {
    const stub = createLLMStub([
      { response: makeResponse({ content: 'wildcarded' }) },
    ]);
    const result = await stub.routeCall(makeParams([{ role: 'user', content: 'anything' }]));
    expect(result.content, 'content').toBe('wildcarded');
    expect(stub.callCount === 1, 'call recorded').toBeTruthy();
  });

  await asyncTest('matchOnSystem matches when system regex matches', async () => {
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
    expect(result.content, 'content').toBe('matched system');
  });

  await asyncTest('matchOnSystem falls through when system does not match', async () => {
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
    expect(result.content, 'content').toBe('fallback');
  });

  await asyncTest('matchOnLastUser matches when last user message regex matches', async () => {
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
    expect(result.content, 'content').toBe('read_workspace path');
  });

  await asyncTest('both matchers must match when both are present', async () => {
    const stub = createLLMStub([
      {
        matchOnSystem: /dev-agent/,
        matchOnLastUser: /write a patch/,
        response: makeResponse({ content: 'both matched' }),
      },
      { response: makeResponse({ content: 'fallback' }) },
    ]);
    // Only one matches → falls through.
    const r1 = await stub.routeCall(
      makeParams([{ role: 'user', content: 'write a patch' }], 'qa-agent'),
    );
    expect(r1.content, 'system mismatch → fallback').toBe('fallback');
    // Both match → scenario fires.
    const r2 = await stub.routeCall(
      makeParams([{ role: 'user', content: 'write a patch now' }], 'dev-agent system prompt'),
    );
    expect(r2.content, 'both match → scenario').toBe('both matched');
  });

  await asyncTest('scenarios are evaluated in order; first match wins', async () => {
    const stub = createLLMStub([
      { matchOnLastUser: /hello/, response: makeResponse({ content: 'first' }) },
      { matchOnLastUser: /hello/, response: makeResponse({ content: 'second' }) },
    ]);
    const result = await stub.routeCall(makeParams([{ role: 'user', content: 'hello world' }]));
    expect(result.content, 'first scenario wins').toBe('first');
  });

  await asyncTest('no scenario matches → routeCall throws with messages attached', async () => {
    const stub = createLLMStub([
      { matchOnLastUser: /hello/, response: makeResponse({ content: 'never' }) },
    ]);
    let thrown: unknown = null;
    try {
      await stub.routeCall(makeParams([{ role: 'user', content: 'goodbye' }]));
    } catch (err) {
      thrown = err;
    }
    expect(thrown instanceof Error, 'an Error was thrown').toBeTruthy();
    const e = thrown as Error & { messages?: ProviderMessage[] };
    expect(e.message.includes('no scenario matched'), 'error message mentions no match').toBeTruthy();
    expect(Array.isArray(e.messages), 'messages attached').toBeTruthy();
    expect(e.messages!.length === 1, 'messages has the one message').toBeTruthy();
  });

  // ── Call recording ─────────────────────────────────────────────
  await asyncTest('calls[] records each invocation with params + scenarioIndex', async () => {
    const stub = createLLMStub([
      { matchOnLastUser: /alpha/, response: makeResponse({ content: 'A' }) },
      { matchOnLastUser: /beta/, response: makeResponse({ content: 'B' }) },
    ]);
    await stub.routeCall(makeParams([{ role: 'user', content: 'alpha request' }]));
    await stub.routeCall(makeParams([{ role: 'user', content: 'beta request' }]));

    expect(stub.calls.length === 2, 'two calls recorded').toBeTruthy();
    expect(stub.calls[0].scenarioIndex, 'first call scenario index').toBe(0);
    expect(stub.calls[1].scenarioIndex, 'second call scenario index').toBe(1);
    expect(stub.calls[0].timestamp > 0, 'first timestamp > 0').toBeTruthy();
  });

  await asyncTest('response returned is a deep clone, not the scenario reference', async () => {
    const scenarios: LLMStubScenario[] = [
      { response: makeResponse({ content: 'original', toolCalls: [] }) },
    ];
    const stub = createLLMStub(scenarios);
    const r1 = await stub.routeCall(makeParams([{ role: 'user', content: 'x' }]));
    r1.content = 'mutated';
    const r2 = await stub.routeCall(makeParams([{ role: 'user', content: 'y' }]));
    expect(r2.content, 'second call unaffected by mutation of first result').toBe('original');
  });

  // ── Reset ─────────────────────────────────────────────────────
  await asyncTest('reset() clears calls but keeps scenarios active', async () => {
    const stub = createLLMStub([
      { response: makeResponse({ content: 'hi' }) },
    ]);
    await stub.routeCall(makeParams([{ role: 'user', content: 'test' }]));
    expect(stub.callCount === 1, 'one call before reset').toBeTruthy();

    stub.reset();
    expect(stub.callCount === 0, 'zero calls after reset').toBeTruthy();

    const result = await stub.routeCall(makeParams([{ role: 'user', content: 'test2' }]));
    expect(result.content, 'scenario still works after reset').toBe('hi');
    expect(stub.callCount === 1, 'call count increments from 1 again').toBeTruthy();
  });

  console.log('');  console.log('');}

main().catch((err) => {
  console.error('Unhandled error in main():', err);});
