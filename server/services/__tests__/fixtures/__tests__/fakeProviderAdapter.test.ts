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

import { strict as assert } from 'node:assert';
import { createFakeProviderAdapter } from '../fakeProviderAdapter.js';
// NOTE: registry is NOT imported here. It is imported lazily (see below, between
// Case 6 and Case 7) so that Cases 1–6 — which test only the adapter itself —
// can run in environments without the production env vars that registry.ts
// transitively requires (registry → anthropicAdapter → env.ts → envSchema.parse).

// Skip registry-dependent cases (7–13) when DATABASE_URL is absent. The
// adapter self-tests (Cases 1–6) run unconditionally because they have no
// env or DB dependency. The SKIP flag only gates the registry import and the
// cases that follow it.
const SKIP = !process.env.DATABASE_URL;

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
console.log('FakeProviderAdapter self-test:');

// ─── Case 1: default response is returned and call is recorded ──────────────
await test('default response path records the invocation and returns the default', async () => {
  const adapter = createFakeProviderAdapter();
  const out = await adapter.call({
    model: 'fake-model',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(out.content, 'fake response');
  assert.equal(out.tokensIn, 100);
  assert.equal(out.tokensOut, 50);
  assert.equal(adapter.callCount, 1);
});

// ─── Case 2: setResponse override ───────────────────────────────────────────
await test('setResponse override is returned on subsequent calls', async () => {
  const adapter = createFakeProviderAdapter();
  adapter.setResponse({
    content: 'custom',
    stopReason: 'end_turn',
    tokensIn: 1,
    tokensOut: 2,
    providerRequestId: 'custom',
  });
  const out = await adapter.call({ model: 'fake-model', messages: [] });
  assert.equal(out.content, 'custom');
});

// ─── Case 3: setError rejects the next call (one-shot), then default returns
await test('setError rejects exactly one call, then defaults again', async () => {
  const adapter = createFakeProviderAdapter();
  adapter.setError(new Error('boom'));
  let threw = false;
  try {
    await adapter.call({ model: 'fake-model', messages: [] });
  } catch (err) {
    threw = true;
    assert.match((err as Error).message, /boom/);
  }
  assert.ok(threw);
  // Second call returns default — error is one-shot.
  const out = await adapter.call({ model: 'fake-model', messages: [] });
  assert.equal(out.content, 'fake response');
});

// ─── Case 4: setLatencyMs delays the success path ──────────────────────────
await test('setLatencyMs(60) delays the success path by >= 60ms', async () => {
  const adapter = createFakeProviderAdapter();
  adapter.setLatencyMs(60);
  const start = Date.now();
  await adapter.call({ model: 'fake-model', messages: [] });
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 55, `expected >= 55ms, got ${elapsed}ms`);
});

// ─── Case 5: setError + setLatencyMs — latency applies to error path too ───
await test('setError + setLatencyMs delays the rejection AND records on entry', async () => {
  const adapter = createFakeProviderAdapter();
  adapter.setError(new Error('delayed-boom'));
  adapter.setLatencyMs(60);
  const start = Date.now();
  let threw = false;
  try {
    await adapter.call({ model: 'fake-model', messages: [] });
  } catch (err) {
    assert.match((err as Error).message, /delayed-boom/);
    threw = true;
  }
  const elapsed = Date.now() - start;
  assert.ok(threw, 'must reject');
  assert.ok(elapsed >= 55, `latency must apply to error path; got ${elapsed}ms`);
  // Crucially: the call was recorded immediately on entry, BEFORE the
  // latency-then-rejection settlement. Asserting recording is independent
  // of settlement is the whole point of the latency-on-error contract.
  assert.equal(adapter.callCount, 1);
});

// ─── Case 5b: setResponse + setLatencyMs — latency applies on success path ─
await test('setResponse + setLatencyMs delays the override response AND records on entry', async () => {
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
  assert.equal(out.content, 'overridden-with-latency');
  assert.equal(out.tokensIn, 7);
  assert.ok(elapsed >= 55, `latency must apply on the override-resolve path; got ${elapsed}ms`);
  assert.equal(adapter.callCount, 1);
});

// ─── Case 6: reset() clears calls and overrides ─────────────────────────────
await test('reset() clears calls + cancels pending error/latency/response overrides', async () => {
  const adapter = createFakeProviderAdapter();
  await adapter.call({ model: 'fake-model', messages: [] });
  await adapter.call({ model: 'fake-model', messages: [] });
  assert.equal(adapter.callCount, 2);
  adapter.setError(new Error('queued'));
  adapter.setLatencyMs(150);
  adapter.setResponse({
    content: 'overridden', stopReason: 'end_turn', tokensIn: 0, tokensOut: 0,
    providerRequestId: 'x',
  });
  adapter.reset();
  assert.equal(adapter.callCount, 0);
  const start = Date.now();
  const out = await adapter.call({ model: 'fake-model', messages: [] });
  const elapsed = Date.now() - start;
  assert.equal(out.content, 'fake response', 'response override cleared by reset');
  assert.ok(elapsed < 100, 'latency override cleared by reset');
});

// ─── Registry-dependent tests (Cases 7–13) ────────────────────────────────────
// Import the registry NOW rather than at module load. This guarantees Cases 1–6
// above always run (they test only the adapter — no env deps). If the environment
// lacks the required vars (DATABASE_URL etc.) the import below throws and only
// the registry suite fails, not the core suite.
if (SKIP) {
  const REGISTRY_CASES = [
    'register + restore restores the EXACT prior state at the key',
    'calling restore() twice is a no-op the second time',
    'registering B over A and restoring B brings A back',
    'same-key SEQUENTIAL: B sees only its own calls',
    'same-key PARALLEL: each adapter sees only its own calls',
    'non-LIFO restore: outer registration restored BEFORE inner returns to original state',
    'non-LIFO restore preserves pre-existing prior across out-of-order finalisers',
  ];
  for (const name of REGISTRY_CASES) {
    console.log(`  SKIP  ${name}`);
  }
  console.log('');
  console.log(`${passed} passed, ${failed} failed, ${REGISTRY_CASES.length} skipped`);
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

const { registerProviderAdapter, getProviderAdapter } =
  await import('../../../providers/registry.js');

// ─── Case 7: register + restore preserves prior state ───────────────────────
await test('register + restore restores the EXACT prior state at the key', async () => {
  // Verify pre-state: no entry at fake-test-provider
  let priorThrew = false;
  try { getProviderAdapter('fake-test-provider'); } catch { priorThrew = true; }
  assert.ok(priorThrew, 'pre-condition: fake-test-provider must be absent');

  const a = createFakeProviderAdapter({ provider: 'fake-test-provider' });
  const restoreA = registerProviderAdapter('fake-test-provider', a);
  try {
    assert.strictEqual(getProviderAdapter('fake-test-provider'), a);
  } finally {
    restoreA();
  }

  // After restore: the key is absent again (was unbound before register).
  let postThrew = false;
  try { getProviderAdapter('fake-test-provider'); } catch { postThrew = true; }
  assert.ok(postThrew, 'restore must put the registry back to ABSENT (not undefined)');
});

// ─── Case 8: restore is idempotent ──────────────────────────────────────────
await test('calling restore() twice is a no-op the second time', async () => {
  const a = createFakeProviderAdapter();
  const restore = registerProviderAdapter('fake-test-provider', a);
  restore();
  // Second call must not throw.
  restore();
  let threw = false;
  try { getProviderAdapter('fake-test-provider'); } catch { threw = true; }
  assert.ok(threw, 'key must remain absent after both restores');
});

// ─── Case 9: register over a prior adapter, restore brings prior back ───────
await test('registering B over A and restoring B brings A back', async () => {
  const a = createFakeProviderAdapter();
  const restoreA = registerProviderAdapter('fake-test-provider', a);
  try {
    const b = createFakeProviderAdapter();
    const restoreB = registerProviderAdapter('fake-test-provider', b);
    try {
      assert.strictEqual(getProviderAdapter('fake-test-provider'), b);
    } finally {
      restoreB();
    }
    assert.strictEqual(getProviderAdapter('fake-test-provider'), a, 'A must be callable again');
  } finally {
    restoreA();
  }
});

// ─── Case 10: SAME-KEY SEQUENTIAL non-interference (mandatory variant 1) ────
await test('same-key SEQUENTIAL: B sees only its own calls', async () => {
  const a = createFakeProviderAdapter();
  const restoreA = registerProviderAdapter('fake-test-provider', a);
  try {
    const adapterA = getProviderAdapter('fake-test-provider');
    await adapterA.call({ model: 'fake-model', messages: [{ role: 'user', content: 'a1' }] });
    await adapterA.call({ model: 'fake-model', messages: [{ role: 'user', content: 'a2' }] });
    await adapterA.call({ model: 'fake-model', messages: [{ role: 'user', content: 'a3' }] });
    assert.equal(a.callCount, 3);
  } finally {
    restoreA();
  }
  const b = createFakeProviderAdapter();
  const restoreB = registerProviderAdapter('fake-test-provider', b);
  try {
    const adapterB = getProviderAdapter('fake-test-provider');
    await adapterB.call({ model: 'fake-model', messages: [{ role: 'user', content: 'b1' }] });
    assert.equal(b.callCount, 1, 'B must NOT see A\'s calls');
    assert.equal(a.callCount, 3, 'A\'s calls array is independent of B\'s');
  } finally {
    restoreB();
  }
});

// ─── Case 11: SAME-KEY PARALLEL non-interference (mandatory variant 2) ─────
await test('same-key PARALLEL: each adapter sees only its own calls', async () => {
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
  assert.equal(a.callCount, 2);
  assert.equal(b.callCount, 2);
  for (const call of a.calls) {
    const msg = call.args.messages[0];
    assert.ok(
      typeof msg.content === 'string' && msg.content.startsWith('A-'),
      `A.calls must contain only A-* messages; got ${JSON.stringify(msg.content)}`,
    );
  }
  for (const call of b.calls) {
    const msg = call.args.messages[0];
    assert.ok(
      typeof msg.content === 'string' && msg.content.startsWith('B-'),
      `B.calls must contain only B-* messages; got ${JSON.stringify(msg.content)}`,
    );
  }

  // Registry returns to its pre-test state after BOTH restores have run.
  let postThrew = false;
  try { getProviderAdapter('fake-test-provider'); } catch { postThrew = true; }
  assert.ok(postThrew, 'registry must return to ABSENT state after both restores');
});

// ─── Case 12: NON-LIFO restore — the load-bearing parallel-safety case ──────
await test('non-LIFO restore: outer registration restored BEFORE inner returns to original state', async () => {
  // Pre-state: key absent.
  let priorThrew = false;
  try { getProviderAdapter('fake-test-provider'); } catch { priorThrew = true; }
  assert.ok(priorThrew, 'pre-condition: fake-test-provider must be absent');

  const a = createFakeProviderAdapter();
  const b = createFakeProviderAdapter();

  // Register A (outer), then B (inner) on top.
  const restoreA = registerProviderAdapter('fake-test-provider', a);
  const restoreB = registerProviderAdapter('fake-test-provider', b);
  // Currently active: B (top of stack).
  assert.strictEqual(getProviderAdapter('fake-test-provider'), b);

  // NON-LIFO restore: outer (A) restores FIRST while inner (B) is still
  // logically active. With the old closure-capture-prior-state implementation,
  // this would either (a) re-install B's prior (which was A) and leave the
  // registry pointing at A even though A has logically restored, OR (b)
  // a later restoreB would re-install the wrong prior. Stack semantics make
  // this case correct: A's restore removes A's entry from the stack, sees
  // B is still on top, leaves registry pointing at B.
  restoreA();
  assert.strictEqual(
    getProviderAdapter('fake-test-provider'),
    b,
    'after outer restore, registry must still reflect inner registration (B remains active)',
  );

  // Now restore B — last active registration → original state (absent).
  restoreB();
  let postThrew = false;
  try { getProviderAdapter('fake-test-provider'); } catch { postThrew = true; }
  assert.ok(
    postThrew,
    'after both restores, registry must return to ABSENT regardless of restore order',
  );
});

// ─── Case 13: NON-LIFO restore over a pre-existing adapter ──────────────────
await test('non-LIFO restore preserves pre-existing prior across out-of-order finalisers', async () => {
  // Same as Case 12 but with a real pre-existing adapter under the key.
  // Use 'anthropic' which is bound to the real anthropic adapter at
  // module load — register fakes over it, restore non-LIFO, verify the
  // real anthropic adapter is restored.
  const realAnthropic = getProviderAdapter('anthropic');

  const fakeA = createFakeProviderAdapter();
  const fakeB = createFakeProviderAdapter();

  const restoreA = registerProviderAdapter('anthropic', fakeA);
  const restoreB = registerProviderAdapter('anthropic', fakeB);
  assert.strictEqual(getProviderAdapter('anthropic'), fakeB);

  // Out-of-order: A first, then B.
  restoreA();
  assert.strictEqual(
    getProviderAdapter('anthropic'),
    fakeB,
    'B remains active until its own restore — A leaving the stack does not re-install A',
  );

  restoreB();
  assert.strictEqual(
    getProviderAdapter('anthropic'),
    realAnthropic,
    'after both restores, the real anthropic adapter (captured on first register) is restored',
  );
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
