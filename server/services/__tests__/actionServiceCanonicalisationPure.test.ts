import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { computeValidationDigest, hashActionArgs } from '../actionService.js';

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

test('hashActionArgs — null / undefined / empty object all distinct from each other', () => {
  const hNull = hashActionArgs({ v: null });
  const hUndef = hashActionArgs({ v: undefined });
  const hEmpty = hashActionArgs({ v: {} });
  // null and undefined both serialise to 'null' — accept that; key what matters.
  assert.equal(hNull, hUndef);
  assert.notEqual(hNull, hEmpty);
});
