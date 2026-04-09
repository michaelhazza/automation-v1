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

import {
  canonicalise,
  fingerprint,
  trimTranscript,
  materialiseCapture,
  type MaterialiseInputs,
} from '../regressionCaptureServicePure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

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
  assertEqual(a, b, 'key-order independent');
  assert(a.indexOf('"a"') < a.indexOf('"b"'), 'a appears before b');
});

test('canonicalise preserves array order', () => {
  const a = canonicalise([1, 2, 3]);
  const b = canonicalise([3, 2, 1]);
  assert(a !== b, 'arrays are order-sensitive');
});

test('canonicalise drops undefined values but preserves null', () => {
  const out = canonicalise({ a: null, b: undefined, c: 1 });
  assert(out.includes('"a":null'), 'null preserved');
  assert(!out.includes('"b"'), 'undefined dropped');
  assert(out.includes('"c":1'), 'c preserved');
});

test('canonicalise handles primitives', () => {
  assertEqual(canonicalise(null), 'null', 'null');
  assertEqual(canonicalise(42), '42', 'number');
  assertEqual(canonicalise('hello'), '"hello"', 'string');
  assertEqual(canonicalise(true), 'true', 'boolean');
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
  assert(thrown, 'cycle detected');
});

// ── fingerprint ─────────────────────────────────────────────────────
test('fingerprint is 16 hex chars', () => {
  const fp = fingerprint({ anything: 'goes' });
  assertEqual(fp.length, 16, 'length 16');
  assert(/^[0-9a-f]{16}$/.test(fp), 'hex only');
});

test('fingerprint is deterministic for equal inputs', () => {
  const a = fingerprint({ a: 1, b: [1, 2], c: { x: 1, y: 2 } });
  const b = fingerprint({ c: { y: 2, x: 1 }, b: [1, 2], a: 1 });
  assertEqual(a, b, 'semantically equal → same hash');
});

test('fingerprint differs for distinct values', () => {
  const a = fingerprint({ a: 1 });
  const b = fingerprint({ a: 2 });
  assert(a !== b, 'different values → different hash');
});

// ── trimTranscript ──────────────────────────────────────────────────
test('trimTranscript passes through short transcripts', () => {
  const t = [{ role: 'user' as const, content: 'a' }, { role: 'assistant' as const, content: 'b' }];
  const out = trimTranscript(t, 10);
  assertEqual(out.length, 2, 'length preserved');
  assertEqual(out[0].content, 'a', 'first preserved');
});

test('trimTranscript keeps the tail of long transcripts', () => {
  const t = Array.from({ length: 30 }, (_, i) => ({
    role: 'user' as const,
    content: `msg-${i}`,
  }));
  const out = trimTranscript(t, 10);
  assertEqual(out.length, 10, 'trimmed to 10');
  assertEqual(out[0].content, 'msg-20', 'keeps last 10');
  assertEqual(out[9].content, 'msg-29', 'final message preserved');
});

test('trimTranscript returns a copy (not a reference)', () => {
  const t = [{ role: 'user' as const, content: 'a' }];
  const out = trimTranscript(t, 10);
  assert(out !== t, 'copy not reference');
});

// ── materialiseCapture ──────────────────────────────────────────────
test('materialiseCapture builds a version 1 contract', () => {
  const cap = materialiseCapture(baseInputs());
  assertEqual(cap.inputContract.version, 1, 'input contract version');
  assertEqual(cap.rejectedCall.version, 1, 'rejected call version');
});

test('materialiseCapture preserves the tool manifest order', () => {
  const cap = materialiseCapture(baseInputs());
  assertEqual(cap.inputContract.toolManifest.length, 2, 'two tools');
  assertEqual(cap.inputContract.toolManifest[0].name, 'send_email', 'first tool');
  assertEqual(cap.inputContract.toolManifest[1].name, 'create_deal', 'second tool');
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
  assert(!('description' in first), 'null description omitted');
});

test('materialiseCapture hash is stable across key-order changes', () => {
  const a = materialiseCapture(baseInputs());
  const b = materialiseCapture(
    baseInputs({
      rejectedArgs: { subject: 'please review', to: 'ceo@example.com' },
    }),
  );
  assertEqual(
    a.rejectedCallHash,
    b.rejectedCallHash,
    'rejected args key order does not affect hash',
  );
  assertEqual(a.inputContractHash, b.inputContractHash, 'input contract hash stable');
});

test('materialiseCapture hash changes when system prompt drifts', () => {
  const a = materialiseCapture(baseInputs());
  const b = materialiseCapture(
    baseInputs({ systemPromptSnapshot: 'You are an agent. Follow the NEW rules.' }),
  );
  assert(
    a.inputContractHash !== b.inputContractHash,
    'prompt drift changes input contract hash',
  );
  assertEqual(
    a.rejectedCallHash,
    b.rejectedCallHash,
    'rejected call hash unaffected by prompt drift',
  );
});

test('materialiseCapture hash changes when tool manifest changes', () => {
  const a = materialiseCapture(baseInputs());
  const b = materialiseCapture(
    baseInputs({
      toolManifest: [{ name: 'send_email' }], // create_deal removed
    }),
  );
  assert(
    a.inputContractHash !== b.inputContractHash,
    'tool manifest drift changes input contract hash',
  );
});

test('materialiseCapture hash changes when rejected args change', () => {
  const a = materialiseCapture(baseInputs());
  const b = materialiseCapture(
    baseInputs({ rejectedArgs: { to: 'other@example.com', subject: 'please review' } }),
  );
  assert(
    a.rejectedCallHash !== b.rejectedCallHash,
    'rejected args change → different rejected call hash',
  );
});

test('materialiseCapture trims transcripts to maxTranscriptMessages', () => {
  const longTranscript = Array.from({ length: 50 }, (_, i) => ({
    role: 'user' as const,
    content: `msg-${i}`,
  }));
  const cap = materialiseCapture(
    baseInputs({ transcript: longTranscript, maxTranscriptMessages: 5 }),
  );
  assertEqual(cap.inputContract.transcript.length, 5, 'trimmed to 5');
  assertEqual(
    cap.inputContract.transcript[0].content,
    'msg-45',
    'keeps the tail',
  );
});

test('materialiseCapture default transcript cap is 25', () => {
  const longTranscript = Array.from({ length: 30 }, (_, i) => ({
    role: 'user' as const,
    content: `msg-${i}`,
  }));
  const cap = materialiseCapture(baseInputs({ transcript: longTranscript }));
  assertEqual(cap.inputContract.transcript.length, 25, 'default 25');
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
  assert(
    cap.inputContract.runMetadata.subaccountId === null,
    'null subaccountId preserved',
  );
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
  assertEqual(
    liveHash,
    original.inputContractHash,
    'rebuilt contract matches stored hash',
  );
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
