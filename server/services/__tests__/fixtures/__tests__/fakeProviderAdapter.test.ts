/**
 * Self-test for the fake provider adapter + register/restore registry API.
 *
 * Spec: docs/superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md §1.2.
 *
 * Exercises the harness's documented surface — default response, override,
 * one-shot error, latency on success path, latency on error path,
 * setError + setLatencyMs combination, reset, registry add/remove
 * preserves prior state, and the **mandatory** sequential AND parallel
 * same-key non-interference variants. The parallel variant is required
 * because parallel execution is the primary justification for the
 * prior-state-capture contract.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/fixtures/__tests__/fakeProviderAdapter.test.ts
 */

import { expect, test } from 'vitest';
import { createFakeProviderAdapter } from '../fakeProviderAdapter.js';
// NOTE: registry is NOT imported here. It is imported lazily (see below, between
// Case 6 and Case 7) so that Cases 1–6 — which test only the adapter itself —
// can run in environments without the production env vars that registry.ts
// transitively requires (registry → anthropicAdapter → env.ts → envSchema.parse).

// Skip registry-dependent cases (7–13) when DATABASE_URL is absent. The
// adapter self-tests (Cases 1–6) run unconditionally because they have no
// env or DB dependency. The SKIP flag only gates the registry import and the
// cases that follow it.
const SKIP = !process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration';

console.log('');
console.log('FakeProviderAdapter self-test:');

// ─── Case 1: default response is returned and call is recorded ──────────────
test('default response path records the invocation and returns the default', async () => {
  const adapter = createFakeProviderAdapter();
  const out = await adapter.call({
    model: 'fake-model',
    messages: [{ role: 'user', content: 'hi' }],
  });
  expect(out.content).toBe('fake response');
  expect(out.tokensIn).toBe(100);
  expect(out.tokensOut).toBe(50);
  expect(adapter.callCount).toBe(1);
});

// ─── Case 2: setResponse override ───────────────────────────────────────────
test('setResponse override is returned on subsequent calls', async () => {
  const adapter = createFakeProviderAdapter();
  adapter.setResponse({
    content: 'custom',
    stopReason: 'end_turn',
    tokensIn: 1,
    tokensOut: 2,
    providerRequestId: 'custom',
  });
  const out = await adapter.call({ model: 'fake-model', messages: [] });
  expect(out.content).toBe('custom');
});

// ─── Case 3: setError rejects the next call (one-shot), then default returns
test('setError rejects exactly one call, then defaults again', async () => {
  const adapter = createFakeProviderAdapter();
  adapter.setError(new Error('boom'));
  let threw = false;
  try {
    await adapter.call({ model: 'fake-model', messages: [] });
  } catch (err) {
    threw = true;
    expect((err as Error).message).toMatch(/boom/);
  }
  expect(threw).toBeTruthy();
  // Second call returns default — error is one-shot.
  const out = await adapter.call({ model: 'fake-model', messages: [] });
  expect(out.content).toBe('fake response');
});

// ─── Case 4: setLatencyMs delays the success path ──────────────────────────
test('setLatencyMs(60) delays the success path by >= 60ms', async () => {
  const adapter = createFakeProviderAdapter();
  adapter.setLatencyMs(60);
  const start = Date.now();
  await adapter.call({ model: 'fake-model', messages: [] });
  const elapsed = Date.now() - start;
  expect(elapsed >= 55).toBeTruthy();
});

// ─── Case 5: setError + setLatencyMs — latency applies to error path too ───
test('setError + setLatencyMs delays the rejection AND records on entry', async () => {
  const adapter = createFakeProviderAdapter();
  adapter.setError(new Error('delayed-boom'));
  adapter.setLatencyMs(60);
  const start = Date.now();
  let threw = false;
  try {
    await adapter.call({ model: 'fake-model', messages: [] });
  } catch (err) {
    expect((err as Error).message).toMatch(/delayed-boom/);
    threw = true;
  }
  const elapsed = Date.now() - start;
  expect(threw).toBeTruthy();
  expect(elapsed >= 55).toBeTruthy();
  // Crucially: the call was recorded immediately on entry, BEFORE the
  // latency-then-rejection settlement. Asserting recording is independent
  // of settlement is the whole point of the latency-on-error contract.
  expect(adapter.callCount).toBe(1);
});

// ─── Case 5b: setResponse + setLatencyMs — latency applies on success path ─
test('setResponse + setLatencyMs delays the override response AND records on entry', async () => {
  const adapter = createFakeProviderAdapter();
  adapter.setResponse({
    content: 'overridden-with-latency',
    stopReason: 'end_turn',
    tokensIn: 7,
    tokensOut: 3,
    providerRequestId: 'override-latency',
  });
  adapter.setLatencyMs(60);
  const start = Date.now();
  const out = await adapter.call({ model: 'fake-model', messages: [] });
  const elapsed = Date.now() - start;
  // Both overrides land: the override is what resolves, AND the latency is
  // applied before the resolve. Symmetric with Case 5 (error + latency) —
  // a future regression that special-cased the success path could break
  // this without breaking either single-knob test.
  expect(out.content).toBe('overridden-with-latency');
  expect(out.tokensIn).toBe(7);
  expect(elapsed >= 55).toBeTruthy();
  expect(adapter.callCount).toBe(1);
});

// ─── Case 6: reset() clears calls and overrides ─────────────────────────────
test('reset() clears calls + cancels pending error/latency/response overrides', async () => {
  const adapter = createFakeProviderAdapter();
  await adapter.call({ model: 'fake-model', messages: [] });
  await adapter.call({ model: 'fake-model', messages: [] });
  expect(adapter.callCount).toBe(2);
  adapter.setError(new Error('queued'));
  adapter.setLatencyMs(150);
  adapter.setResponse({
    content: 'overridden', stopReason: 'end_turn', tokensIn: 0, tokensOut: 0,
    providerRequestId: 'x',
  });
  adapter.reset();
  expect(adapter.callCount).toBe(0);
  const start = Date.now();
  const out = await adapter.call({ model: 'fake-model', messages: [] });
  const elapsed = Date.now() - start;
  expect(out.content).toBe('fake response');
  expect(elapsed < 100).toBeTruthy();
});

// ─── Registry-dependent tests (Cases 7–13) ────────────────────────────────────
// These tests require DATABASE_URL + integration env to load providers/registry.js.
// Skipped when SKIP=true to avoid env-var validation errors on import.
let registerProviderAdapter: ((key: string, a: unknown) => () => void) | undefined;
let getProviderAdapter: ((key: string) => unknown) | undefined;

if (!SKIP) {
  const registry = await import('../../../providers/registry.js');
  registerProviderAdapter = registry.registerProviderAdapter as typeof registerProviderAdapter;
  getProviderAdapter = registry.getProviderAdapter as typeof getProviderAdapter;
}

// ─── Case 7: register + restore preserves prior state ───────────────────────
test.skipIf(SKIP)('register + restore restores the EXACT prior state at the key', async () => {
  // Verify pre-state: no entry at fake-test-provider
  let priorThrew = false;
  try { getProviderAdapter('fake-test-provider'); } catch { priorThrew = true; }
  expect(priorThrew).toBeTruthy();

  const a = createFakeProviderAdapter({ provider: 'fake-test-provider' });
  const restoreA = registerProviderAdapter('fake-test-provider', a);
  try {
    expect(getProviderAdapter('fake-test-provider')).toBe(a);
  } finally {
    restoreA();
  }

  // After restore: the key is absent again (was unbound before register).
  let postThrew = false;
  try { getProviderAdapter('fake-test-provider'); } catch { postThrew = true; }
  expect(postThrew).toBeTruthy();
});

// ─── Case 8: restore is idempotent ──────────────────────────────────────────
test.skipIf(SKIP)('calling restore() twice is a no-op the second time', async () => {
  const a = createFakeProviderAdapter();
  const restore = registerProviderAdapter('fake-test-provider', a);
  restore();
  // Second call must not throw.
  restore();
  let threw = false;
  try { getProviderAdapter('fake-test-provider'); } catch { threw = true; }
  expect(threw).toBeTruthy();
});

// ─── Case 9: register over a prior adapter, restore brings prior back ───────
test.skipIf(SKIP)('registering B over A and restoring B brings A back', async () => {
  const a = createFakeProviderAdapter();
  const restoreA = registerProviderAdapter('fake-test-provider', a);
  try {
    const b = createFakeProviderAdapter();
    const restoreB = registerProviderAdapter('fake-test-provider', b);
    try {
      expect(getProviderAdapter('fake-test-provider')).toBe(b);
    } finally {
      restoreB();
    }
    expect(getProviderAdapter('fake-test-provider')).toBe(a);
  } finally {
    restoreA();
  }
});

// ─── Case 10: SAME-KEY SEQUENTIAL non-interference (mandatory variant 1) ────
test.skipIf(SKIP)('same-key SEQUENTIAL: B sees only its own calls', async () => {
  const a = createFakeProviderAdapter();
  const restoreA = registerProviderAdapter('fake-test-provider', a);
  try {
    const adapterA = getProviderAdapter('fake-test-provider');
    await adapterA.call({ model: 'fake-model', messages: [{ role: 'user', content: 'a1' }] });
    await adapterA.call({ model: 'fake-model', messages: [{ role: 'user', content: 'a2' }] });
    await adapterA.call({ model: 'fake-model', messages: [{ role: 'user', content: 'a3' }] });
    expect(a.callCount).toBe(3);
  } finally {
    restoreA();
  }
  const b = createFakeProviderAdapter();
  const restoreB = registerProviderAdapter('fake-test-provider', b);
  try {
    const adapterB = getProviderAdapter('fake-test-provider');
    await adapterB.call({ model: 'fake-model', messages: [{ role: 'user', content: 'b1' }] });
    expect(b.callCount).toBe(1);
    expect(a.callCount).toBe(3);
  } finally {
    restoreB();
  }
});

// ─── Case 11: SAME-KEY PARALLEL non-interference (mandatory variant 2) ─────
test.skipIf(SKIP)('same-key PARALLEL: each adapter sees only its own calls', async () => {
  // Two parallel tasks both register at the SAME key, exercise their own
  // adapter, then restore in finally. The registry's prior-state capture
  // is what makes this safe — without it, the second register would
  // permanently lose the first adapter's reference and the first restore
  // could stomp on the second's state.
  const a = createFakeProviderAdapter();
  const b = createFakeProviderAdapter();

  async function task(adapter: typeof a, label: string) {
    const restore = registerProviderAdapter('fake-test-provider', adapter);
    try {
      // Drive calls through the local adapter reference (NOT through
      // getProviderAdapter, which would race with the other task's
      // registration). The registry-mediated path is exercised by Case 10.
      // Here we are asserting that each task's `calls` array carries only
      // its own invocations regardless of registry-state interleaving.
      await adapter.call({
        model: 'fake-model',
        messages: [{ role: 'user', content: `${label}-1` }],
      });
      await adapter.call({
        model: 'fake-model',
        messages: [{ role: 'user', content: `${label}-2` }],
      });
    } finally {
      restore();
    }
  }

  await Promise.all([task(a, 'A'), task(b, 'B')]);

  // Each adapter's calls array contains only its own invocations.
  expect(a.callCount).toBe(2);
  expect(b.callCount).toBe(2);
  for (const call of a.calls) {
    const msg = call.args.messages[0];
    expect(typeof msg.content === 'string' && msg.content.startsWith('A-')).toBeTruthy();
  }
  for (const call of b.calls) {
    const msg = call.args.messages[0];
    expect(typeof msg.content === 'string' && msg.content.startsWith('B-')).toBeTruthy();
  }

  // Registry returns to its pre-test state after BOTH restores have run.
  let postThrew = false;
  try { getProviderAdapter('fake-test-provider'); } catch { postThrew = true; }
  expect(postThrew).toBeTruthy();
});

// ─── Case 12: NON-LIFO restore — the load-bearing parallel-safety case ──────
test.skipIf(SKIP)('non-LIFO restore: outer registration restored BEFORE inner returns to original state', async () => {
  // Pre-state: key absent.
  let priorThrew = false;
  try { getProviderAdapter('fake-test-provider'); } catch { priorThrew = true; }
  expect(priorThrew).toBeTruthy();

  const a = createFakeProviderAdapter();
  const b = createFakeProviderAdapter();

  // Register A (outer), then B (inner) on top.
  const restoreA = registerProviderAdapter('fake-test-provider', a);
  const restoreB = registerProviderAdapter('fake-test-provider', b);
  // Currently active: B (top of stack).
  expect(getProviderAdapter('fake-test-provider')).toBe(b);

  // NON-LIFO restore: outer (A) restores FIRST while inner (B) is still
  // logically active. With the old closure-capture-prior-state implementation,
  // this would either (a) re-install B's prior (which was A) and leave the
  // registry pointing at A even though A has logically restored, OR (b)
  // a later restoreB would re-install the wrong prior. Stack semantics make
  // this case correct: A's restore removes A's entry from the stack, sees
  // B is still on top, leaves registry pointing at B.
  restoreA();
  expect(getProviderAdapter('fake-test-provider')).toBe(b);

  // Now restore B — last active registration → original state (absent).
  restoreB();
  let postThrew = false;
  try { getProviderAdapter('fake-test-provider'); } catch { postThrew = true; }
  expect(postThrew).toBeTruthy();
});

// ─── Case 13: NON-LIFO restore over a pre-existing adapter ──────────────────
test.skipIf(SKIP)('non-LIFO restore preserves pre-existing prior across out-of-order finalisers', async () => {
  // Same as Case 12 but with a real pre-existing adapter under the key.
  // Use 'anthropic' which is bound to the real anthropic adapter at
  // module load — register fakes over it, restore non-LIFO, verify the
  // real anthropic adapter is restored.
  const realAnthropic = getProviderAdapter('anthropic');

  const fakeA = createFakeProviderAdapter();
  const fakeB = createFakeProviderAdapter();

  const restoreA = registerProviderAdapter('anthropic', fakeA);
  const restoreB = registerProviderAdapter('anthropic', fakeB);
  expect(getProviderAdapter('anthropic')).toBe(fakeB);

  // Out-of-order: A first, then B.
  restoreA();
  expect(getProviderAdapter('anthropic')).toBe(fakeB);

  restoreB();
  expect(getProviderAdapter('anthropic')).toBe(realAnthropic);
});

console.log('');
console.log('');
