import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildActionIdempotencyKey, computeValidationDigest, hashActionArgs } from '../actionService.js';
import { IDEMPOTENCY_KEY_VERSION } from '../../lib/idempotencyVersion.js';

// ---------------------------------------------------------------------------
// Pins the canonical-JSON contract for both idempotency key hashes and the
// payload validation digest. Before Session 2 these used
// `JSON.stringify(x, Object.keys(x).sort())` which treats the array as an
// allowlist applied at every depth — silently dropping nested keys. The fix
// is recursive key sorting; these tests catch regressions.
// ---------------------------------------------------------------------------

test('computeValidationDigest — same payload, different top-level key order → same digest', () => {
  const a = computeValidationDigest({ workflowId: 'wf_1', contactId: 'c_1' });
  const b = computeValidationDigest({ contactId: 'c_1', workflowId: 'wf_1' });
  assert.equal(a, b);
});

test('computeValidationDigest — nested keys are retained and order-independent', () => {
  const a = computeValidationDigest({
    recipients: { kind: 'preset', value: 'on_call' },
    title: 'Review',
  });
  const b = computeValidationDigest({
    title: 'Review',
    recipients: { value: 'on_call', kind: 'preset' },
  });
  assert.equal(a, b);
  // Sanity: different nested value → different digest (no silent drop).
  const c = computeValidationDigest({
    recipients: { kind: 'preset', value: 'different_group' },
    title: 'Review',
  });
  assert.notEqual(a, c);
});

test('computeValidationDigest — array order IS preserved (positional semantics)', () => {
  const a = computeValidationDigest({ channels: ['in_app', 'email', 'slack'] });
  const b = computeValidationDigest({ channels: ['slack', 'email', 'in_app'] });
  assert.notEqual(a, b);
});

test('computeValidationDigest — deeply nested structure canonicalises through every level', () => {
  const a = computeValidationDigest({
    outer: { middle: { inner: { z: 1, a: 2 } } },
  });
  const b = computeValidationDigest({
    outer: { middle: { inner: { a: 2, z: 1 } } },
  });
  assert.equal(a, b);
});

test('hashActionArgs — same canonical contract as validation digest', () => {
  const a = hashActionArgs({
    payload: { contactId: 'c_1', body: 'hi' },
    meta: { runId: 'r_1' },
  });
  const b = hashActionArgs({
    meta: { runId: 'r_1' },
    payload: { body: 'hi', contactId: 'c_1' },
  });
  assert.equal(a, b);
});

test('present-vs-absent trap — undefined field and omitted field hash the same', () => {
  // The reviewer-flagged case: caller A builds { contactId: 'c1' }, caller B
  // builds { contactId: 'c1', replyToAddress: undefined }. Same logical intent;
  // same key must emerge so the dedup layer doesn't let both slip through.
  const omitted = computeValidationDigest({ contactId: 'c1' });
  const explicitUndef = computeValidationDigest({ contactId: 'c1', replyToAddress: undefined });
  assert.equal(omitted, explicitUndef);
});

test('present-vs-absent trap — explicit null STAYS DISTINCT from omitted', () => {
  // null is semantically "explicitly unset"; undefined vs absent is a JS
  // surface accident. Keep null meaningful so APIs that distinguish
  // unset-to-null from unset-implicit are respected.
  const omitted = computeValidationDigest({ contactId: 'c1' });
  const explicitNull = computeValidationDigest({ contactId: 'c1', replyToAddress: null });
  assert.notEqual(omitted, explicitNull);
});

test('present-vs-absent trap — applies recursively (nested undefined)', () => {
  const a = computeValidationDigest({ payload: { a: 1 } });
  const b = computeValidationDigest({ payload: { a: 1, b: undefined } });
  assert.equal(a, b);
});

test('hashActionArgs — mirrors present-vs-absent behaviour', () => {
  const h1 = hashActionArgs({ args: { x: 1 } });
  const h2 = hashActionArgs({ args: { x: 1, opt: undefined } });
  const h3 = hashActionArgs({ args: { x: 1, opt: null } });
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

// ── Idempotency-key versioning (deferred-items brief §2) ──────────────────

test('buildActionIdempotencyKey — prefixed with IDEMPOTENCY_KEY_VERSION', () => {
  const key = buildActionIdempotencyKey({
    runId:      'run_1',
    toolCallId: 'tc_1',
    args:       { x: 1 },
  });
  assert.ok(key.startsWith(`${IDEMPOTENCY_KEY_VERSION}:`),
    `idempotency key should start with ${IDEMPOTENCY_KEY_VERSION}: — got ${key}`);
});

test('buildActionIdempotencyKey — current v1 shape pinned', () => {
  // Fixture: same inputs must always produce the same v1-prefixed key.
  // Accidental canonicalisation change (or prefix removal) trips this test.
  const key = buildActionIdempotencyKey({
    runId:      '33333333-3333-3333-3333-333333333333',
    toolCallId: 'tool_call_abc',
    args:       { contactId: 'c_1', body: 'hi' },
  });
  const argsHash = hashActionArgs({ contactId: 'c_1', body: 'hi' });
  assert.equal(key, `v1:33333333-3333-3333-3333-333333333333:tool_call_abc:${argsHash}`);
});

test('buildActionIdempotencyKey — same args different key-order → same key (nested via argsHash)', () => {
  const a = buildActionIdempotencyKey({
    runId:      'r_1',
    toolCallId: 't_1',
    args:       { b: 2, a: 1 },
  });
  const b = buildActionIdempotencyKey({
    runId:      'r_1',
    toolCallId: 't_1',
    args:       { a: 1, b: 2 },
  });
  assert.equal(a, b);
});
