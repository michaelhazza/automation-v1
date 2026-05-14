/**
 * regressionCaptureServicePure unit tests — runnable via:
 *   npx tsx server/services/__tests__/regressionCaptureServicePure.test.ts
 *
 * Tests the pure materialisation module introduced by Sprint 2 P1.2 of
 * docs/improvements-roadmap-spec.md. The canonical-hash contract is the
 * core of the regression replay harness: if two semantically-identical
 * captures produce different hashes, the Sunday replay job will flip
 * cases to `stale` and force a human to re-review every active case.
 * Conversely, if two different captures collide, the replay job would
 * miss real regressions. Both failure modes are catastrophic, so these
 * tests guard the invariants explicitly.
 */

import { expect, test } from 'vitest';
import {
  canonicalise,
  fingerprint,
  trimTranscript,
  materialiseCapture,
  type MaterialiseInputs,
} from '../regressionCaptureServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const SUB_X = '11111111-1111-1111-1111-1111111111aa';
const AGENT_ID = '33333333-3333-3333-3333-333333333333';

/** Baseline valid inputs for materialiseCapture. */
function baseInputs(overrides: Partial<MaterialiseInputs> = {}): MaterialiseInputs {
  return {
    systemPromptSnapshot: 'You are an agent. Follow the rules.',
    toolManifest: [
      { name: 'send_email', description: 'Send an email' },
      { name: 'create_deal' },
    ],
    transcript: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ],
    runMetadata: {
      agentId: AGENT_ID,
      organisationId: ORG_A,
      subaccountId: SUB_X,
    },
    rejectedToolName: 'send_email',
    rejectedArgs: { to: 'ceo@example.com', subject: 'please review' },
    ...overrides,
  };
}

console.log('');
console.log('regressionCaptureServicePure — Sprint 2 P1.2 canonical hash contract');
console.log('');

// ── canonicalise ────────────────────────────────────────────────────
test('canonicalise sorts object keys recursively', () => {
  const a = canonicalise({ b: 1, a: 2, nested: { z: 1, a: 2 } });
  const b = canonicalise({ a: 2, b: 1, nested: { a: 2, z: 1 } });
  expect(a, 'key-order independent').toEqual(b);
  expect(a.indexOf('"a"') < a.indexOf('"b"'), 'a appears before b').toBeTruthy();
});

test('canonicalise preserves array order', () => {
  const a = canonicalise([1, 2, 3]);
  const b = canonicalise([3, 2, 1]);
  expect(a !== b, 'arrays are order-sensitive').toBeTruthy();
});

test('canonicalise drops undefined values but preserves null', () => {
  const out = canonicalise({ a: null, b: undefined, c: 1 });
  expect(out.includes('"a":null'), 'null preserved').toBeTruthy();
  expect(!out.includes('"b"'), 'undefined dropped').toBeTruthy();
  expect(out.includes('"c":1'), 'c preserved').toBeTruthy();
});

test('canonicalise handles primitives', () => {
  expect(canonicalise(null), 'null').toBe('null');
  expect(canonicalise(42), 'number').toBe('42');
  expect(canonicalise('hello'), 'string').toBe('"hello"');
  expect(canonicalise(true), 'boolean').toBe('true');
});

test('canonicalise rejects cycles', () => {
  const obj: Record<string, unknown> = { a: 1 };
  obj.self = obj;
  let thrown = false;
  try {
    canonicalise(obj);
  } catch {
    thrown = true;
  }
  expect(thrown, 'cycle detected').toBeTruthy();
});

// ── fingerprint ─────────────────────────────────────────────────────
test('fingerprint is 16 hex chars', () => {
  const fp = fingerprint({ anything: 'goes' });
  expect(fp.length, 'length 16').toBe(16);
  expect(/^[0-9a-f]{16}$/.test(fp), 'hex only').toBeTruthy();
});

test('fingerprint is deterministic for equal inputs', () => {
  const a = fingerprint({ a: 1, b: [1, 2], c: { x: 1, y: 2 } });
  const b = fingerprint({ c: { y: 2, x: 1 }, b: [1, 2], a: 1 });
  expect(a, 'semantically equal → same hash').toEqual(b);
});

test('fingerprint differs for distinct values', () => {
  const a = fingerprint({ a: 1 });
  const b = fingerprint({ a: 2 });
  expect(a !== b, 'different values → different hash').toBeTruthy();
});

// ── trimTranscript ──────────────────────────────────────────────────
test('trimTranscript passes through short transcripts', () => {
  const t = [{ role: 'user' as const, content: 'a' }, { role: 'assistant' as const, content: 'b' }];
  const out = trimTranscript(t, 10);
  expect(out.length, 'length preserved').toBe(2);
  expect(out[0].content, 'first preserved').toBe('a');
});

test('trimTranscript keeps the tail of long transcripts', () => {
  const t = Array.from({ length: 30 }, (_, i) => ({
    role: 'user' as const,
    content: `msg-${i}`,
  }));
  const out = trimTranscript(t, 10);
  expect(out.length, 'trimmed to 10').toBe(10);
  expect(out[0].content, 'keeps last 10').toBe('msg-20');
  expect(out[9].content, 'final message preserved').toBe('msg-29');
});

test('trimTranscript returns a copy (not a reference)', () => {
  const t = [{ role: 'user' as const, content: 'a' }];
  const out = trimTranscript(t, 10);
  expect(out !== t, 'copy not reference').toBeTruthy();
});

// ── materialiseCapture ──────────────────────────────────────────────
test('materialiseCapture builds a version 1 contract', () => {
  const cap = materialiseCapture(baseInputs());
  expect(cap.inputContract.version, 'input contract version').toBe(1);
  expect(cap.rejectedCall.version, 'rejected call version').toBe(1);
});

test('materialiseCapture preserves the tool manifest order', () => {
  const cap = materialiseCapture(baseInputs());
  expect(cap.inputContract.toolManifest.length, 'two tools').toBe(2);
  expect(cap.inputContract.toolManifest[0].name, 'first tool').toBe('send_email');
  expect(cap.inputContract.toolManifest[1].name, 'second tool').toBe('create_deal');
});

test('materialiseCapture drops null descriptions from tool manifest', () => {
  const cap = materialiseCapture(
    baseInputs({
      toolManifest: [
        { name: 'send_email', description: null },
        { name: 'create_deal' },
      ],
    }),
  );
  const first = cap.inputContract.toolManifest[0];
  expect(!('description' in first), 'null description omitted').toBeTruthy();
});

test('materialiseCapture hash is stable across key-order changes', () => {
  const a = materialiseCapture(baseInputs());
  const b = materialiseCapture(
    baseInputs({
      rejectedArgs: { subject: 'please review', to: 'ceo@example.com' },
    }),
  );
  expect(a.rejectedCallHash, 'rejected args key order does not affect hash').toEqual(b.rejectedCallHash);
  expect(a.inputContractHash, 'input contract hash stable').toEqual(b.inputContractHash);
});

test('materialiseCapture hash changes when system prompt drifts', () => {
  const a = materialiseCapture(baseInputs());
  const b = materialiseCapture(
    baseInputs({ systemPromptSnapshot: 'You are an agent. Follow the NEW rules.' }),
  );
  expect(a.inputContractHash !== b.inputContractHash, 'prompt drift changes input contract hash').toBeTruthy();
  expect(a.rejectedCallHash, 'rejected call hash unaffected by prompt drift').toEqual(b.rejectedCallHash);
});

test('materialiseCapture hash changes when tool manifest changes', () => {
  const a = materialiseCapture(baseInputs());
  const b = materialiseCapture(
    baseInputs({
      toolManifest: [{ name: 'send_email' }], // create_deal removed
    }),
  );
  expect(a.inputContractHash !== b.inputContractHash, 'tool manifest drift changes input contract hash').toBeTruthy();
});

test('materialiseCapture hash changes when rejected args change', () => {
  const a = materialiseCapture(baseInputs());
  const b = materialiseCapture(
    baseInputs({ rejectedArgs: { to: 'other@example.com', subject: 'please review' } }),
  );
  expect(a.rejectedCallHash !== b.rejectedCallHash, 'rejected args change → different rejected call hash').toBeTruthy();
});

test('materialiseCapture trims transcripts to maxTranscriptMessages', () => {
  const longTranscript = Array.from({ length: 50 }, (_, i) => ({
    role: 'user' as const,
    content: `msg-${i}`,
  }));
  const cap = materialiseCapture(
    baseInputs({ transcript: longTranscript, maxTranscriptMessages: 5 }),
  );
  expect(cap.inputContract.transcript.length, 'trimmed to 5').toBe(5);
  expect(cap.inputContract.transcript[0].content, 'keeps the tail').toBe('msg-45');
});

test('materialiseCapture default transcript cap is 25', () => {
  const longTranscript = Array.from({ length: 30 }, (_, i) => ({
    role: 'user' as const,
    content: `msg-${i}`,
  }));
  const cap = materialiseCapture(baseInputs({ transcript: longTranscript }));
  expect(cap.inputContract.transcript.length, 'default 25').toBe(25);
});

test('materialiseCapture includes subaccountId: null for org-level runs', () => {
  const cap = materialiseCapture(
    baseInputs({
      runMetadata: {
        agentId: AGENT_ID,
        organisationId: ORG_A,
        subaccountId: null,
      },
    }),
  );
  expect(cap.inputContract.runMetadata.subaccountId === null, 'null subaccountId preserved').toBeTruthy();
});

// ── Replay regression: input contract hash round-trip ──────────────
// This is the exact flow the weekly replay job depends on: capture a
// contract, later rebuild the same shape, and compare fingerprints.
test('replay round-trip: rebuilt contract hashes identically', () => {
  const original = materialiseCapture(baseInputs());

  // Simulate the replay job: rebuild the same input contract shape from
  // the stored fields and compute its fingerprint.
  const rebuilt = {
    version: 1 as const,
    systemPromptSnapshot: original.inputContract.systemPromptSnapshot,
    toolManifest: original.inputContract.toolManifest,
    transcript: original.inputContract.transcript,
    runMetadata: original.inputContract.runMetadata,
  };
  const liveHash = fingerprint(rebuilt);
  expect(liveHash, 'rebuilt contract matches stored hash').toEqual(original.inputContractHash);
});

console.log('');
console.log('');
