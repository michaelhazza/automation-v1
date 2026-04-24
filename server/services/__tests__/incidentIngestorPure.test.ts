/**
 * incidentIngestorPure.test.ts — Pure function tests for the incident ingestor.
 *
 * Covers: fingerprint determinism, normalisation, topFrameSignature stability,
 * classification matrix, severity inference, override validation, shouldNotify.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/incidentIngestorPure.test.ts
 */

import {
  classify,
  inferDefaultSeverity,
  computeFingerprint,
  normaliseMessage,
  topFrameSignature,
  validateFingerprintOverride,
  hashFingerprint,
  maxSeverity,
  shouldNotify,
  FINGERPRINT_OVERRIDE_RE,
} from '../incidentIngestorPure.js';

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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// normaliseMessage
// ---------------------------------------------------------------------------

test('normaliseMessage — strips UUIDs', () => {
  const msg = 'Error for org 123e4567-e89b-12d3-a456-426614174000 failed';
  const result = normaliseMessage(msg);
  assert(!result.includes('123e4567'), 'UUID not stripped');
  assert(result.includes('<uuid>'), 'UUID placeholder missing');
});

test('normaliseMessage — strips large numbers', () => {
  const msg = 'Row count 98765 exceeded limit';
  const result = normaliseMessage(msg);
  assert(!result.includes('98765'), 'number not stripped');
  assert(result.includes('<num>'), 'number placeholder missing');
});

test('normaliseMessage — strips ISO timestamps', () => {
  const msg = 'Failed at 2024-01-15T10:30:00.000Z';
  const result = normaliseMessage(msg);
  assert(!result.includes('2024-01-15T'), 'timestamp not stripped');
  assert(result.includes('<timestamp>'), 'timestamp placeholder missing');
});

test('normaliseMessage — preserves meaningful words', () => {
  const result = normaliseMessage('Connection refused by database');
  assert(result.includes('Connection refused'), 'meaningful text stripped');
});

test('normaliseMessage — truncates at 200 chars', () => {
  const longMsg = 'x'.repeat(300);
  assertEqual(normaliseMessage(longMsg).length, 200, 'truncation length');
});

// ---------------------------------------------------------------------------
// topFrameSignature
// ---------------------------------------------------------------------------

test('topFrameSignature — strips line:col from parenthesised form', () => {
  const stack = 'Error: fail\n    at myFn (/app/server/services/foo.ts:42:18)\n    at next (/app/server/index.ts:10:5)';
  const sig = topFrameSignature(stack);
  assert(!sig.includes(':42:'), 'line number not stripped');
  assert(sig.includes('myFn'), 'function name preserved');
  assert(sig.includes('foo.ts'), 'file name preserved');
});

test('topFrameSignature — strips line number only (no col)', () => {
  const stack = 'Error\n    at doThing (/app/server/bar.ts:99)';
  const sig = topFrameSignature(stack);
  assert(!sig.includes(':99'), 'line number not stripped');
  assert(sig.includes('doThing'), 'function preserved');
});

test('topFrameSignature — skips ingestor frames', () => {
  const stack = 'Error\n    at recordIncident (/app/server/services/incidentIngestor.ts:50:5)\n    at realCaller (/app/server/routes/thing.ts:20:10)';
  const sig = topFrameSignature(stack);
  assert(!sig.includes('incidentIngestor'), 'ingestor frame should be skipped');
  assert(sig.includes('realCaller'), 'real caller should appear');
});

test('topFrameSignature — returns no_stack for empty stack', () => {
  assertEqual(topFrameSignature(undefined), 'no_stack', 'undefined stack');
  assertEqual(topFrameSignature(''), 'no_stack', 'empty string stack');
});

test('topFrameSignature — stable across line number change', () => {
  const stack1 = 'Error\n    at processItem (/app/service.ts:100:5)';
  const stack2 = 'Error\n    at processItem (/app/service.ts:200:5)';
  assertEqual(topFrameSignature(stack1), topFrameSignature(stack2), 'same function same file, different line');
});

// ---------------------------------------------------------------------------
// computeFingerprint — determinism
// ---------------------------------------------------------------------------

test('computeFingerprint — same input produces same fingerprint', () => {
  const input = { source: 'route' as const, summary: 'DB timeout', errorCode: 'TIMEOUT', stack: 'Error\n    at fn (/app/server.ts:5:1)', affectedResourceKind: 'api', fingerprintOverride: undefined };
  assertEqual(computeFingerprint(input), computeFingerprint(input), 'not deterministic');
});

test('computeFingerprint — different sources produce different fingerprints', () => {
  const base = { summary: 'same error', errorCode: 'ERR', stack: undefined, affectedResourceKind: undefined, fingerprintOverride: undefined };
  const a = computeFingerprint({ ...base, source: 'route' as const });
  const b = computeFingerprint({ ...base, source: 'job' as const });
  assert(a !== b, 'source should differentiate fingerprints');
});

test('computeFingerprint — UUID in summary does not affect fingerprint', () => {
  const base = { source: 'route' as const, errorCode: 'ERR', stack: undefined, affectedResourceKind: undefined, fingerprintOverride: undefined };
  const a = computeFingerprint({ ...base, summary: 'Error for org 123e4567-e89b-12d3-a456-426614174000' });
  const b = computeFingerprint({ ...base, summary: 'Error for org aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  assertEqual(a, b, 'UUIDs in summary should be normalised to same fingerprint');
});

test('computeFingerprint — fingerprintOverride wins over stack derivation', () => {
  const base = { source: 'agent' as const, summary: 'fail', stack: 'Error\n    at fn (/app.ts:1:1)', affectedResourceKind: undefined, errorCode: undefined };
  const withOverride = computeFingerprint({ ...base, fingerprintOverride: 'agent:orchestrator:CLASSIFICATION_PARSE_FAILURE' });
  const withoutOverride = computeFingerprint({ ...base, fingerprintOverride: undefined });
  assert(withOverride !== withoutOverride, 'override should produce different fingerprint');
  // Override produces deterministic result
  assertEqual(withOverride, hashFingerprint('agent:orchestrator:CLASSIFICATION_PARSE_FAILURE'), 'override fingerprint hash');
});

// ---------------------------------------------------------------------------
// validateFingerprintOverride
// ---------------------------------------------------------------------------

test('validateFingerprintOverride — accepts valid 3-part override', () => {
  assert(validateFingerprintOverride('agent:orchestrator:CLASSIFICATION_PARSE_FAILURE'), 'valid override rejected');
});

test('validateFingerprintOverride — accepts valid 2-part override', () => {
  assert(validateFingerprintOverride('connector:gohighlevel:rate_limit'), 'valid 3-part rejected');
});

test('validateFingerprintOverride — rejects single-component', () => {
  assert(!validateFingerprintOverride('agent'), 'single component should be rejected');
});

test('validateFingerprintOverride — rejects domain:error only (needs 2+ colons)', () => {
  // Per spec the regex requires domain + error identifier; "agent:orchestrator" is
  // actually TWO components which DOES match since 2 is minimum.
  // Let's verify the spec regex requires at least 2 colons (3 parts)
  // The regex: ^[a-z_]+:[a-z0-9_.-]+(:[a-z0-9_.-]+)+$
  // "agent:orchestrator:generic" has 2 colons = valid
  // "agent:orchestrator" has 1 colon — the (+) requires at least one more group
  assert(!validateFingerprintOverride('agent:orchestrator'), 'two-part should be rejected (needs ≥3 parts)');
});

test('validateFingerprintOverride — rejects uppercase', () => {
  assert(!validateFingerprintOverride('Agent:Orchestrator:FAIL'), 'uppercase should be rejected');
});

test('validateFingerprintOverride — rejects spaces', () => {
  assert(!validateFingerprintOverride('agent:orchestrator:parse fail'), 'spaces should be rejected');
});

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

test('classify — explicit classification passes through', () => {
  assertEqual(classify({ classification: 'user_fault' }), 'user_fault', 'explicit override');
});

test('classify — validation_error category → user_fault', () => {
  assertEqual(classify({ errorCategory: 'validation_error' }), 'user_fault', 'validation_error');
});

test('classify — auth_error category → user_fault', () => {
  assertEqual(classify({ errorCategory: 'auth_error' }), 'user_fault', 'auth_error');
});

test('classify — 404 status code → user_fault', () => {
  assertEqual(classify({ statusCode: 404 }), 'user_fault', '404 → user_fault');
});

test('classify — 500 status code → system_fault', () => {
  assertEqual(classify({ statusCode: 500 }), 'system_fault', '500 → system_fault');
});

test('classify — timeout category → system_fault', () => {
  assertEqual(classify({ errorCategory: 'timeout' }), 'system_fault', 'timeout');
});

test('classify — no hints → system_fault (default)', () => {
  assertEqual(classify({}), 'system_fault', 'default system_fault');
});

// ---------------------------------------------------------------------------
// inferDefaultSeverity
// ---------------------------------------------------------------------------

test('inferDefaultSeverity — route 500 → medium', () => {
  assertEqual(inferDefaultSeverity({ source: 'route', statusCode: 500 }), 'medium', 'route 500');
});

test('inferDefaultSeverity — route 429 → low', () => {
  assertEqual(inferDefaultSeverity({ source: 'route', statusCode: 429 }), 'low', 'route 429');
});

test('inferDefaultSeverity — job → high', () => {
  assertEqual(inferDefaultSeverity({ source: 'job' }), 'high', 'job source');
});

test('inferDefaultSeverity — agent non-system-managed → medium', () => {
  assertEqual(inferDefaultSeverity({ source: 'agent', isSystemManagedAgent: false }), 'medium', 'non-system agent');
});

test('inferDefaultSeverity — agent system-managed → high', () => {
  assertEqual(inferDefaultSeverity({ source: 'agent', isSystemManagedAgent: true }), 'high', 'system-managed agent');
});

test('inferDefaultSeverity — connector → low', () => {
  assertEqual(inferDefaultSeverity({ source: 'connector' }), 'low', 'connector');
});

test('inferDefaultSeverity — skill → medium', () => {
  assertEqual(inferDefaultSeverity({ source: 'skill' }), 'medium', 'skill');
});

test('inferDefaultSeverity — llm parse failure → high', () => {
  assertEqual(inferDefaultSeverity({ source: 'llm', errorCode: 'CLASSIFICATION_PARSE_FAILURE' }), 'high', 'llm parse failure');
});

test('inferDefaultSeverity — llm reconciliation required → high', () => {
  assertEqual(inferDefaultSeverity({ source: 'llm', errorCode: 'RECONCILIATION_REQUIRED' }), 'high', 'llm reconciliation');
});

test('inferDefaultSeverity — self → high', () => {
  assertEqual(inferDefaultSeverity({ source: 'self' }), 'high', 'self source');
});

// ---------------------------------------------------------------------------
// maxSeverity
// ---------------------------------------------------------------------------

test('maxSeverity — picks higher severity', () => {
  assertEqual(maxSeverity('low', 'high'), 'high', 'low vs high');
  assertEqual(maxSeverity('critical', 'medium'), 'critical', 'critical vs medium');
  assertEqual(maxSeverity('medium', 'medium'), 'medium', 'equal');
});

// ---------------------------------------------------------------------------
// shouldNotify
// ---------------------------------------------------------------------------

test('shouldNotify — first occurrence of high → true', () => {
  assert(shouldNotify(1, true, 'high', undefined), 'first high should notify');
});

test('shouldNotify — first occurrence of critical → true', () => {
  assert(shouldNotify(1, true, 'critical', undefined), 'first critical should notify');
});

test('shouldNotify — first occurrence of low → true (wasInserted)', () => {
  assert(shouldNotify(1, true, 'low', undefined), 'first low wasInserted should notify');
});

test('shouldNotify — second occurrence of low → false', () => {
  assert(!shouldNotify(2, false, 'low', undefined), 'second low should not notify');
});

test('shouldNotify — 10th occurrence of high → true (milestone)', () => {
  assert(shouldNotify(10, false, 'high', undefined), 'milestone 10 should notify');
});

test('shouldNotify — 100th occurrence → true (milestone)', () => {
  assert(shouldNotify(100, false, 'medium', undefined), 'milestone 100');
});

test('shouldNotify — 15th occurrence → false (not a milestone)', () => {
  assert(!shouldNotify(15, false, 'high', undefined), '15 is not a milestone');
});

test('shouldNotify — custom milestones from env', () => {
  assert(shouldNotify(5, false, 'high', '5,50,500'), 'custom milestone 5');
  assert(!shouldNotify(10, false, 'high', '5,50,500'), '10 not in custom milestones');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
