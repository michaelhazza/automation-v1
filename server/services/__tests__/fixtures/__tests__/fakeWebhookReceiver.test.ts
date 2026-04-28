/**
 * Self-test for the fake webhook receiver.
 *
 * Spec: docs/superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md §1.1.
 *
 * Exercises the harness's documented surface — multi-port concurrency,
 * body-fully-read invariant, header normalisation (lowercase + multi-value
 * join), status/latency/dropConnection overrides, reset, close.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/fixtures/__tests__/fakeWebhookReceiver.test.ts
 */

import { strict as assert } from 'node:assert';
import { startFakeWebhookReceiver } from '../fakeWebhookReceiver.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.stack ?? err.message : err}`);
  }
}

console.log('');
console.log('FakeWebhookReceiver self-test:');

// ─── Case 1: basic POST records method, path, headers, body ─────────────────
await test('records POST with normalised lowercase headers', async () => {
  const receiver = await startFakeWebhookReceiver();
  try {
    const body = { hello: 'world', n: 42 };
    const res = await fetch(`${receiver.url}/anything`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': 'abc',
      },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 200);
    assert.equal(receiver.callCount, 1);
    const call = receiver.calls[0];
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/anything');
    // Header normalisation invariant — keys are lowercased.
    assert.equal(call.headers['x-signature'], 'abc');
    assert.equal(call.headers['X-Signature' as 'x-signature'], undefined);
    assert.deepStrictEqual(call.body, body);
  } finally {
    await receiver.close();
  }
});

// ─── Case 2: body-fully-read invariant — recorded body matches sent bytes ───
await test('records the fully-read body (no truncation)', async () => {
  const receiver = await startFakeWebhookReceiver();
  try {
    // Use a payload large enough to span multiple chunks on the wire.
    const big = 'x'.repeat(50_000);
    const body = { content: big };
    await fetch(`${receiver.url}/big`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(receiver.callCount, 1);
    assert.deepStrictEqual(receiver.calls[0].body, body);
  } finally {
    await receiver.close();
  }
});

// ─── Case 3: setStatusCode causes subsequent responses to use that status ───
await test('setStatusCode(500) makes the next response 500', async () => {
  const receiver = await startFakeWebhookReceiver();
  try {
    receiver.setStatusCode(500);
    const res = await fetch(`${receiver.url}/err`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 500);
  } finally {
    await receiver.close();
  }
});

// ─── Case 4: setLatencyMs delays responses ──────────────────────────────────
await test('setLatencyMs(150) causes the response to take >= 150ms', async () => {
  const receiver = await startFakeWebhookReceiver();
  try {
    receiver.setLatencyMs(150);
    const start = Date.now();
    await fetch(`${receiver.url}/slow`, { method: 'POST', body: '{}' });
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 140, `expected >= 140ms, got ${elapsed}ms`);
  } finally {
    await receiver.close();
  }
});

// ─── Case 5: setDropConnection records the call but rejects fetch ───────────
await test('setDropConnection(true) records the call AND rejects the client', async () => {
  const receiver = await startFakeWebhookReceiver();
  try {
    receiver.setDropConnection(true);
    const body = { important: 'payload' };
    let threw = false;
    try {
      await fetch(`${receiver.url}/drop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'fetch should reject when the connection is dropped');
    assert.equal(receiver.callCount, 1, 'call should still be recorded');
    assert.deepStrictEqual(
      receiver.calls[0].body,
      body,
      'recorded body must reflect the fully-read request body, even when the response was dropped',
    );

    // Toggle off → next request returns normally.
    receiver.setDropConnection(false);
    const res = await fetch(`${receiver.url}/ok`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 200);
    assert.equal(receiver.callCount, 2);
  } finally {
    await receiver.close();
  }
});

// ─── Case 6: reset() clears calls AND drop flag ─────────────────────────────
await test('reset() clears calls and reverts overrides', async () => {
  const receiver = await startFakeWebhookReceiver();
  try {
    await fetch(`${receiver.url}/a`, { method: 'POST', body: '{}' });
    await fetch(`${receiver.url}/b`, { method: 'POST', body: '{}' });
    assert.equal(receiver.callCount, 2);
    receiver.setStatusCode(418);
    receiver.setLatencyMs(100);
    receiver.setDropConnection(true);
    receiver.reset();
    assert.equal(receiver.callCount, 0, 'calls must be cleared');
    // After reset, response is 200 with default body and no latency, no drop.
    const start = Date.now();
    const res = await fetch(`${receiver.url}/c`, { method: 'POST', body: '{}' });
    const elapsed = Date.now() - start;
    assert.equal(res.status, 200);
    assert.ok(elapsed < 100, `expected fast response after reset, got ${elapsed}ms`);
    assert.equal(receiver.callCount, 1);
  } finally {
    await receiver.close();
  }
});

// ─── Case 7: concurrent receivers each get a different OS-assigned port ────
await test('multiple concurrent receivers get distinct ports', async () => {
  const a = await startFakeWebhookReceiver();
  const b = await startFakeWebhookReceiver();
  try {
    assert.notEqual(a.url, b.url, 'two receivers must bind to different ports');
    await fetch(`${a.url}/x`, { method: 'POST', body: '{}' });
    await fetch(`${b.url}/y`, { method: 'POST', body: '{}' });
    assert.equal(a.callCount, 1);
    assert.equal(b.callCount, 1);
    assert.equal(a.calls[0].path, '/x');
    assert.equal(b.calls[0].path, '/y');
  } finally {
    await a.close();
    await b.close();
  }
});

// ─── Case 8: close() resolves without unhandled-promise warnings ────────────
await test('close() releases the port', async () => {
  const receiver = await startFakeWebhookReceiver();
  await fetch(`${receiver.url}/once`, { method: 'POST', body: '{}' });
  await receiver.close();
  // Subsequent receiver acquisition must succeed (the port is freed).
  const next = await startFakeWebhookReceiver();
  assert.ok(next.url.startsWith('http://127.0.0.1:'));
  await next.close();
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
