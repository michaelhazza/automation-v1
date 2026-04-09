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

import { createLLMStub, extractLastUserText, type LLMStubScenario } from './llmStub.js';
import type { RouterCallParams } from '../../services/llmRouter.js';
import type { ProviderMessage, ProviderResponse } from '../../services/providers/types.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(
        () => {
          passed++;
          console.log(`  PASS  ${name}`);
        },
        (err) => {
          failed++;
          console.log(`  FAIL  ${name}`);
          console.log(`        ${err instanceof Error ? err.message : err}`);
        },
      );
    } else {
      passed++;
      console.log(`  PASS  ${name}`);
    }
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

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

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
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
    assertEqual(extractLastUserText([]), null, 'result');
  });

  test('last message is assistant → null', () => {
    assertEqual(
      extractLastUserText([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]),
      null,
      'result',
    );
  });

  test('last message is user string → returns string', () => {
    assertEqual(
      extractLastUserText([
        { role: 'assistant', content: 'previous' },
        { role: 'user', content: 'current message' },
      ]),
      'current message',
      'result',
    );
  });

  test('last message is user with text blocks → concatenates texts', () => {
    assertEqual(
      extractLastUserText([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'part A' },
            { type: 'text', text: 'part B' },
          ],
        },
      ]),
      'part A\npart B',
      'result',
    );
  });

  test('last message is user with only tool_result blocks → null', () => {
    assertEqual(
      extractLastUserText([
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tc-1', content: 'result text' }],
        },
      ]),
      null,
      'result (no text blocks)',
    );
  });

  test('last message is user with mixed text + tool_result → only text blocks returned', () => {
    assertEqual(
      extractLastUserText([
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tc-1', content: 'ignored' },
            { type: 'text', text: 'kept' },
          ],
        },
      ]),
      'kept',
      'result',
    );
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
    assertEqual(result.content, 'wildcarded', 'content');
    assert(stub.callCount === 1, 'call recorded');
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
    assertEqual(result.content, 'matched system', 'content');
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
    assertEqual(result.content, 'fallback', 'content');
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
    assertEqual(result.content, 'read_workspace path', 'content');
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
    assertEqual(r1.content, 'fallback', 'system mismatch → fallback');
    // Both match → scenario fires.
    const r2 = await stub.routeCall(
      makeParams([{ role: 'user', content: 'write a patch now' }], 'dev-agent system prompt'),
    );
    assertEqual(r2.content, 'both matched', 'both match → scenario');
  });

  await asyncTest('scenarios are evaluated in order; first match wins', async () => {
    const stub = createLLMStub([
      { matchOnLastUser: /hello/, response: makeResponse({ content: 'first' }) },
      { matchOnLastUser: /hello/, response: makeResponse({ content: 'second' }) },
    ]);
    const result = await stub.routeCall(makeParams([{ role: 'user', content: 'hello world' }]));
    assertEqual(result.content, 'first', 'first scenario wins');
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
    assert(thrown instanceof Error, 'an Error was thrown');
    const e = thrown as Error & { messages?: ProviderMessage[] };
    assert(e.message.includes('no scenario matched'), 'error message mentions no match');
    assert(Array.isArray(e.messages), 'messages attached');
    assert(e.messages!.length === 1, 'messages has the one message');
  });

  // ── Call recording ─────────────────────────────────────────────
  await asyncTest('calls[] records each invocation with params + scenarioIndex', async () => {
    const stub = createLLMStub([
      { matchOnLastUser: /alpha/, response: makeResponse({ content: 'A' }) },
      { matchOnLastUser: /beta/, response: makeResponse({ content: 'B' }) },
    ]);
    await stub.routeCall(makeParams([{ role: 'user', content: 'alpha request' }]));
    await stub.routeCall(makeParams([{ role: 'user', content: 'beta request' }]));

    assert(stub.calls.length === 2, 'two calls recorded');
    assertEqual(stub.calls[0].scenarioIndex, 0, 'first call scenario index');
    assertEqual(stub.calls[1].scenarioIndex, 1, 'second call scenario index');
    assert(stub.calls[0].timestamp > 0, 'first timestamp > 0');
  });

  await asyncTest('response returned is a deep clone, not the scenario reference', async () => {
    const scenarios: LLMStubScenario[] = [
      { response: makeResponse({ content: 'original', toolCalls: [] }) },
    ];
    const stub = createLLMStub(scenarios);
    const r1 = await stub.routeCall(makeParams([{ role: 'user', content: 'x' }]));
    r1.content = 'mutated';
    const r2 = await stub.routeCall(makeParams([{ role: 'user', content: 'y' }]));
    assertEqual(r2.content, 'original', 'second call unaffected by mutation of first result');
  });

  // ── Reset ─────────────────────────────────────────────────────
  await asyncTest('reset() clears calls but keeps scenarios active', async () => {
    const stub = createLLMStub([
      { response: makeResponse({ content: 'hi' }) },
    ]);
    await stub.routeCall(makeParams([{ role: 'user', content: 'test' }]));
    assert(stub.callCount === 1, 'one call before reset');

    stub.reset();
    assert(stub.callCount === 0, 'zero calls after reset');

    const result = await stub.routeCall(makeParams([{ role: 'user', content: 'test2' }]));
    assertEqual(result.content, 'hi', 'scenario still works after reset');
    assert(stub.callCount === 1, 'call count increments from 1 again');
  });

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  console.log('');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Unhandled error in main():', err);
  process.exit(1);
});
