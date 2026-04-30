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

import { expect, test } from 'vitest';
import { startFakeWebhookReceiver } from '../fakeWebhookReceiver.js';

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
    expect(res.status).toBe(200);
    expect(receiver.callCount).toBe(1);
    const call = receiver.calls[0];
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/anything');
    // Header normalisation invariant — keys are lowercased.
    expect(call.headers['x-signature']).toBe('abc');
    expect(call.headers['X-Signature' as 'x-signature']).toBe(undefined);
    expect(call.body).toEqual(body);
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
    expect(receiver.callCount).toBe(1);
    expect(receiver.calls[0].body).toEqual(body);
  } finally {
    await receiver.close();
  }
});

// ─── Case 2b: malformed JSON under application/json falls back to raw buffer
await test('malformed JSON body with application/json content-type is recorded as raw bytes (no harness mask)', async () => {
  const receiver = await startFakeWebhookReceiver();
  try {
    // Deliberately malformed JSON. The harness must NOT throw or skip
    // recording — a producer-side bug shipping bad JSON is exactly what an
    // integration test wants to assert on, and masking that as a parse
    // failure here would hide the bug.
    const malformed = '{"hello": "world", n: 42';
    const res = await fetch(`${receiver.url}/bad`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: malformed,
    });
    expect(res.status).toBe(200);
    expect(receiver.callCount).toBe(1);
    const recorded = receiver.calls[0].body;
    expect(Buffer.isBuffer(recorded)).toBeTruthy();
    expect((recorded as Buffer).toString('utf8')).toBe(malformed);
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
    expect(res.status).toBe(500);
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
    expect(elapsed >= 140).toBeTruthy();
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
    expect(threw).toBeTruthy();
    expect(receiver.callCount).toBe(1);
    expect(receiver.calls[0].body).toEqual(body);

    // Toggle off → next request returns normally.
    receiver.setDropConnection(false);
    const res = await fetch(`${receiver.url}/ok`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    expect(receiver.callCount).toBe(2);
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
    expect(receiver.callCount).toBe(2);
    receiver.setStatusCode(418);
    receiver.setLatencyMs(100);
    receiver.setDropConnection(true);
    receiver.reset();
    expect(receiver.callCount).toBe(0);
    // After reset, response is 200 with default body and no latency, no drop.
    const start = Date.now();
    const res = await fetch(`${receiver.url}/c`, { method: 'POST', body: '{}' });
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed < 100).toBeTruthy();
    expect(receiver.callCount).toBe(1);
  } finally {
    await receiver.close();
  }
});

// ─── Case 7: concurrent receivers each get a different OS-assigned port ────
await test('multiple concurrent receivers get distinct ports', async () => {
  const a = await startFakeWebhookReceiver();
  const b = await startFakeWebhookReceiver();
  try {
    expect(a.url).not.toBe(b.url);
    await fetch(`${a.url}/x`, { method: 'POST', body: '{}' });
    await fetch(`${b.url}/y`, { method: 'POST', body: '{}' });
    expect(a.callCount).toBe(1);
    expect(b.callCount).toBe(1);
    expect(a.calls[0].path).toBe('/x');
    expect(b.calls[0].path).toBe('/y');
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
  expect(next.url.startsWith('http://127.0.0.1:')).toBeTruthy();
  await next.close();
});

console.log('');
console.log('');
