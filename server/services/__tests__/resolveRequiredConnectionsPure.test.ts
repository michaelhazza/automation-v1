/**
 * resolveRequiredConnectionsPure.test.ts — §1.2 REQ W1-44 pure helper tests.
 *
 * Runnable via:
 *   npx tsx --test server/services/__tests__/resolveRequiredConnectionsPure.test.ts
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveRequiredConnections } from '../resolveRequiredConnectionsPure.js';

const SUB = 'sub-001';
const MAPPINGS = [
  { connectionKey: 'ghl', connectionId: 'conn-ghl' },
  { connectionKey: 'slack', connectionId: 'conn-slack' },
];

// ── 1. null requiredConnections ───────────────────────────────────────────────

test('null requiredConnections + any mappings → ok: true, resolved: {}', () => {
  const result = resolveRequiredConnections({
    automation: { requiredConnections: null },
    subaccountId: SUB,
    mappings: MAPPINGS,
  });
  assert.deepEqual(result, { ok: true, resolved: {} });
});

// ── 2. empty requiredConnections ──────────────────────────────────────────────

test('empty requiredConnections + any mappings → ok: true, resolved: {}', () => {
  const result = resolveRequiredConnections({
    automation: { requiredConnections: [] },
    subaccountId: SUB,
    mappings: MAPPINGS,
  });
  assert.deepEqual(result, { ok: true, resolved: {} });
});

// ── 3. one required, matching mapping present ─────────────────────────────────

test('one required key with matching mapping → ok: true with resolved entry', () => {
  const result = resolveRequiredConnections({
    automation: { requiredConnections: ['ghl'] },
    subaccountId: SUB,
    mappings: [{ connectionKey: 'ghl', connectionId: 'conn-ghl' }],
  });
  assert.deepEqual(result, { ok: true, resolved: { ghl: 'conn-ghl' } });
});

// ── 4. one required, no matching mapping ──────────────────────────────────────

test('one required key with no matching mapping → ok: false, missing: [key]', () => {
  const result = resolveRequiredConnections({
    automation: { requiredConnections: ['slack'] },
    subaccountId: SUB,
    mappings: [{ connectionKey: 'ghl', connectionId: 'conn-ghl' }],
  });
  assert.deepEqual(result, { ok: false, missing: ['slack'] });
});

// ── 5. multiple required, partial overlap — order preserved ───────────────────

test('multiple required with partial overlap → ok: false, missing in input order', () => {
  // requiredConnections: ['alpha', 'beta', 'gamma'] — only 'beta' is mapped
  const result = resolveRequiredConnections({
    automation: { requiredConnections: ['alpha', 'beta', 'gamma'] },
    subaccountId: SUB,
    mappings: [{ connectionKey: 'beta', connectionId: 'conn-beta' }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    // Order must match input order: alpha first, gamma second
    assert.deepEqual(result.missing, ['alpha', 'gamma']);
  }
});

test('multiple required, all missing — order matches input order', () => {
  const result = resolveRequiredConnections({
    automation: { requiredConnections: ['z', 'a', 'm'] },
    subaccountId: SUB,
    mappings: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.missing, ['z', 'a', 'm']);
  }
});

// ── 6. empty connectionId treated as missing ──────────────────────────────────

test('mapping with empty connectionId for a required key → treated as missing', () => {
  const result = resolveRequiredConnections({
    automation: { requiredConnections: ['ghl'] },
    subaccountId: SUB,
    mappings: [{ connectionKey: 'ghl', connectionId: '' }],
  });
  assert.deepEqual(result, { ok: false, missing: ['ghl'] });
});

test('mapping with whitespace-only connectionId for a required key → treated as missing', () => {
  const result = resolveRequiredConnections({
    automation: { requiredConnections: ['ghl'] },
    subaccountId: SUB,
    mappings: [{ connectionKey: 'ghl', connectionId: '   ' }],
  });
  assert.deepEqual(result, { ok: false, missing: ['ghl'] });
});

// ── 7. extra unrelated mapping keys → ignored ─────────────────────────────────

test('extra unrelated mapping keys → ignored, required keys resolved normally', () => {
  const result = resolveRequiredConnections({
    automation: { requiredConnections: ['ghl'] },
    subaccountId: SUB,
    mappings: [
      { connectionKey: 'ghl', connectionId: 'conn-ghl' },
      { connectionKey: 'extra-key-1', connectionId: 'conn-extra-1' },
      { connectionKey: 'extra-key-2', connectionId: 'conn-extra-2' },
    ],
  });
  assert.deepEqual(result, { ok: true, resolved: { ghl: 'conn-ghl' } });
});

test('all required present with extra unrelated keys → ok: true, resolved only required', () => {
  const result = resolveRequiredConnections({
    automation: { requiredConnections: ['ghl', 'slack'] },
    subaccountId: SUB,
    mappings: [
      { connectionKey: 'ghl', connectionId: 'conn-ghl' },
      { connectionKey: 'slack', connectionId: 'conn-slack' },
      { connectionKey: 'unrelated', connectionId: 'conn-unrelated' },
    ],
  });
  assert.deepEqual(result, { ok: true, resolved: { ghl: 'conn-ghl', slack: 'conn-slack' } });
});

// ── 8. input-permutation determinism (§8.21) ──────────────────────────────────

test('mappings input order does not affect resolved output', () => {
  const auto = { requiredConnections: ['ghl', 'slack', 'stripe'] };
  const base = [
    { connectionKey: 'ghl',    connectionId: 'conn-ghl'    },
    { connectionKey: 'slack',  connectionId: 'conn-slack'  },
    { connectionKey: 'stripe', connectionId: 'conn-stripe' },
  ];
  const permutations = [
    [base[0], base[1], base[2]],
    [base[1], base[2], base[0]],
    [base[2], base[0], base[1]],
  ];
  const expected = { ghl: 'conn-ghl', slack: 'conn-slack', stripe: 'conn-stripe' };
  for (const mappings of permutations) {
    const r = resolveRequiredConnections({ automation: auto, subaccountId: 'sub-1', mappings });
    assert.ok(r.ok);
    if (r.ok) assert.deepStrictEqual(r.resolved, expected);
  }
});
