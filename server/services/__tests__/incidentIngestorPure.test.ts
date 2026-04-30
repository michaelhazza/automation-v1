/**
 * incidentIngestorPure.test.ts — Pure function tests for the incident ingestor.
 *
 * Covers: fingerprint determinism, normalisation, topFrameSignature stability,
 * classification matrix, severity inference, override validation, shouldNotify.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/incidentIngestorPure.test.ts
 */

import { expect, test } from 'vitest';
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
  expect(!result.includes('123e4567'), 'UUID not stripped').toBeTruthy();
  expect(result.includes('<uuid>'), 'UUID placeholder missing').toBeTruthy();
});

test('normaliseMessage — strips large numbers', () => {
  const msg = 'Row count 98765 exceeded limit';
  const result = normaliseMessage(msg);
  expect(!result.includes('98765'), 'number not stripped').toBeTruthy();
  expect(result.includes('<num>'), 'number placeholder missing').toBeTruthy();
});

test('normaliseMessage — strips ISO timestamps', () => {
  const msg = 'Failed at 2024-01-15T10:30:00.000Z';
  const result = normaliseMessage(msg);
  expect(!result.includes('2024-01-15T'), 'timestamp not stripped').toBeTruthy();
  expect(result.includes('<timestamp>'), 'timestamp placeholder missing').toBeTruthy();
});

test('normaliseMessage — timestamps stripped before large numbers (ordering)', () => {
  // If numbers were stripped before timestamps, "2024" would become "<num>"
  // and the ISO timestamp regex would never match.
  const msg = 'Error at 2024-03-10T08:15:30Z count 99999';
  const result = normaliseMessage(msg);
  // The whole ISO timestamp should be one <timestamp>, not <num>-03-10T...
  expect(result.includes('<timestamp>'), 'ISO timestamp replaced as <timestamp>').toBeTruthy();
  expect(!result.includes('2024'), 'year not left in place by early number-strip').toBeTruthy();
  // The trailing large number should also be gone
  expect(result.includes('<num>'), 'standalone large number replaced as <num>').toBeTruthy();
});

test('normaliseMessage — preserves meaningful words', () => {
  const result = normaliseMessage('Connection refused by database');
  expect(result.includes('Connection refused'), 'meaningful text stripped').toBeTruthy();
});

test('normaliseMessage — truncates at 200 chars', () => {
  const longMsg = 'x'.repeat(300);
  expect(normaliseMessage(longMsg).length, 'truncation length').toBe(200);
});

// ---------------------------------------------------------------------------
// topFrameSignature
// ---------------------------------------------------------------------------

test('topFrameSignature — strips line:col from parenthesised form', () => {
  const stack = 'Error: fail\n    at myFn (/app/server/services/foo.ts:42:18)\n    at next (/app/server/index.ts:10:5)';
  const sig = topFrameSignature(stack);
  expect(!sig.includes(':42:'), 'line number not stripped').toBeTruthy();
  expect(sig.includes('myFn'), 'function name preserved').toBeTruthy();
  expect(sig.includes('foo.ts'), 'file name preserved').toBeTruthy();
});

test('topFrameSignature — strips line number only (no col)', () => {
  const stack = 'Error\n    at doThing (/app/server/bar.ts:99)';
  const sig = topFrameSignature(stack);
  expect(!sig.includes(':99'), 'line number not stripped').toBeTruthy();
  expect(sig.includes('doThing'), 'function preserved').toBeTruthy();
});

test('topFrameSignature — skips ingestor frames', () => {
  const stack = 'Error\n    at recordIncident (/app/server/services/incidentIngestor.ts:50:5)\n    at realCaller (/app/server/routes/thing.ts:20:10)';
  const sig = topFrameSignature(stack);
  expect(!sig.includes('incidentIngestor'), 'ingestor frame should be skipped').toBeTruthy();
  expect(sig.includes('realCaller'), 'real caller should appear').toBeTruthy();
});

test('topFrameSignature — returns no_stack for empty stack', () => {
  expect(topFrameSignature(undefined), 'undefined stack').toBe('no_stack');
  expect(topFrameSignature(''), 'empty string stack').toBe('no_stack');
});

test('topFrameSignature — stable across line number change', () => {
  const stack1 = 'Error\n    at processItem (/app/service.ts:100:5)';
  const stack2 = 'Error\n    at processItem (/app/service.ts:200:5)';
  expect(topFrameSignature(stack1), 'same function same file, different line').toEqual(topFrameSignature(stack2));
});

// ---------------------------------------------------------------------------
// computeFingerprint — determinism
// ---------------------------------------------------------------------------

test('computeFingerprint — same input produces same fingerprint', () => {
  const input = { source: 'route' as const, summary: 'DB timeout', errorCode: 'TIMEOUT', stack: 'Error\n    at fn (/app/server.ts:5:1)', affectedResourceKind: 'api', fingerprintOverride: undefined };
  expect(computeFingerprint(input), 'not deterministic').toEqual(computeFingerprint(input));
});

test('computeFingerprint — different sources produce different fingerprints', () => {
  const base = { summary: 'same error', errorCode: 'ERR', stack: undefined, affectedResourceKind: undefined, fingerprintOverride: undefined };
  const a = computeFingerprint({ ...base, source: 'route' as const });
  const b = computeFingerprint({ ...base, source: 'job' as const });
  expect(a !== b, 'source should differentiate fingerprints').toBeTruthy();
});

test('computeFingerprint — UUID in summary does not affect fingerprint', () => {
  const base = { source: 'route' as const, errorCode: 'ERR', stack: undefined, affectedResourceKind: undefined, fingerprintOverride: undefined };
  const a = computeFingerprint({ ...base, summary: 'Error for org 123e4567-e89b-12d3-a456-426614174000' });
  const b = computeFingerprint({ ...base, summary: 'Error for org aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  expect(a, 'UUIDs in summary should be normalised to same fingerprint').toEqual(b);
});

test('computeFingerprint — fingerprintOverride wins over stack derivation', () => {
  const base = { source: 'agent' as const, summary: 'fail', stack: 'Error\n    at fn (/app.ts:1:1)', affectedResourceKind: undefined, errorCode: undefined };
  const withOverride = computeFingerprint({ ...base, fingerprintOverride: 'agent:orchestrator:CLASSIFICATION_PARSE_FAILURE' });
  const withoutOverride = computeFingerprint({ ...base, fingerprintOverride: undefined });
  expect(withOverride !== withoutOverride, 'override should produce different fingerprint').toBeTruthy();
  // Override produces deterministic result
  expect(withOverride, 'override fingerprint hash').toEqual(hashFingerprint('agent:orchestrator:CLASSIFICATION_PARSE_FAILURE'));
});

// ---------------------------------------------------------------------------
// validateFingerprintOverride
// ---------------------------------------------------------------------------

test('validateFingerprintOverride — accepts valid 3-part override', () => {
  expect(validateFingerprintOverride('agent:orchestrator:CLASSIFICATION_PARSE_FAILURE'), 'valid override rejected').toBeTruthy();
});

test('validateFingerprintOverride — accepts valid 2-part override', () => {
  expect(validateFingerprintOverride('connector:gohighlevel:rate_limit'), 'valid 3-part rejected').toBeTruthy();
});

test('validateFingerprintOverride — rejects single-component', () => {
  expect(!validateFingerprintOverride('agent'), 'single component should be rejected').toBeTruthy();
});

test('validateFingerprintOverride — rejects domain:error only (needs 2+ colons)', () => {
  // Per spec the regex requires domain + error identifier; "agent:orchestrator" is
  // actually TWO components which DOES match since 2 is minimum.
  // Let's verify the spec regex requires at least 2 colons (3 parts)
  // The regex: ^[a-z_]+:[a-z0-9_.-]+(:[a-z0-9_.-]+)+$
  // "agent:orchestrator:generic" has 2 colons = valid
  // "agent:orchestrator" has 1 colon — the (+) requires at least one more group
  expect(!validateFingerprintOverride('agent:orchestrator'), 'two-part should be rejected (needs ≥3 parts)').toBeTruthy();
});

test('validateFingerprintOverride — rejects uppercase domain prefix', () => {
  // Domain (first segment) must be lowercase; error-id segments may be uppercase.
  expect(!validateFingerprintOverride('Agent:orchestrator:FAIL'), 'uppercase domain should be rejected').toBeTruthy();
});

test('validateFingerprintOverride — accepts uppercase in error-id segments', () => {
  // e.g. test:manual:sysadmin:trigger, agent:llm:CLASSIFICATION_PARSE_FAILURE
  expect(validateFingerprintOverride('agent:llm:CLASSIFICATION_PARSE_FAILURE'), 'uppercase error-id should be accepted').toBeTruthy();
  expect(validateFingerprintOverride('test:manual:sysadmin:trigger'), 'test override should be accepted').toBeTruthy();
});

test('validateFingerprintOverride — rejects spaces', () => {
  expect(!validateFingerprintOverride('agent:orchestrator:parse fail'), 'spaces should be rejected').toBeTruthy();
});

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

test('classify — explicit classification passes through', () => {
  expect(classify({ classification: 'user_fault' }), 'explicit override').toBe('user_fault');
});

test('classify — validation_error category → user_fault', () => {
  expect(classify({ errorCategory: 'validation_error' }), 'validation_error').toBe('user_fault');
});

test('classify — auth_error category → user_fault', () => {
  expect(classify({ errorCategory: 'auth_error' }), 'auth_error').toBe('user_fault');
});

test('classify — 404 status code → user_fault', () => {
  expect(classify({ statusCode: 404 }), '404 → user_fault').toBe('user_fault');
});

test('classify — 500 status code → system_fault', () => {
  expect(classify({ statusCode: 500 }), '500 → system_fault').toBe('system_fault');
});

test('classify — timeout category → system_fault', () => {
  expect(classify({ errorCategory: 'timeout' }), 'timeout').toBe('system_fault');
});

test('classify — no hints → system_fault (default)', () => {
  expect(classify({}), 'default system_fault').toBe('system_fault');
});

// ---------------------------------------------------------------------------
// inferDefaultSeverity
// ---------------------------------------------------------------------------

test('inferDefaultSeverity — route 500 → medium', () => {
  expect(inferDefaultSeverity({ source: 'route', statusCode: 500 }), 'route 500').toBe('medium');
});

test('inferDefaultSeverity — route 429 → low', () => {
  expect(inferDefaultSeverity({ source: 'route', statusCode: 429 }), 'route 429').toBe('low');
});

test('inferDefaultSeverity — job → high', () => {
  expect(inferDefaultSeverity({ source: 'job' }), 'job source').toBe('high');
});

test('inferDefaultSeverity — agent non-system-managed → medium', () => {
  expect(inferDefaultSeverity({ source: 'agent', isSystemManagedAgent: false }), 'non-system agent').toBe('medium');
});

test('inferDefaultSeverity — agent system-managed → high', () => {
  expect(inferDefaultSeverity({ source: 'agent', isSystemManagedAgent: true }), 'system-managed agent').toBe('high');
});

test('inferDefaultSeverity — connector → low', () => {
  expect(inferDefaultSeverity({ source: 'connector' }), 'connector').toBe('low');
});

test('inferDefaultSeverity — skill → medium', () => {
  expect(inferDefaultSeverity({ source: 'skill' }), 'skill').toBe('medium');
});

test('inferDefaultSeverity — llm parse failure → high', () => {
  expect(inferDefaultSeverity({ source: 'llm', errorCode: 'CLASSIFICATION_PARSE_FAILURE' }), 'llm parse failure').toBe('high');
});

test('inferDefaultSeverity — llm reconciliation required → high', () => {
  expect(inferDefaultSeverity({ source: 'llm', errorCode: 'RECONCILIATION_REQUIRED' }), 'llm reconciliation').toBe('high');
});

test('inferDefaultSeverity — self → high', () => {
  expect(inferDefaultSeverity({ source: 'self' }), 'self source').toBe('high');
});

// ---------------------------------------------------------------------------
// maxSeverity
// ---------------------------------------------------------------------------

test('maxSeverity — picks higher severity', () => {
  expect(maxSeverity('low', 'high'), 'low vs high').toBe('high');
  expect(maxSeverity('critical', 'medium'), 'critical vs medium').toBe('critical');
  expect(maxSeverity('medium', 'medium'), 'equal').toBe('medium');
});

// ---------------------------------------------------------------------------
// shouldNotify
// ---------------------------------------------------------------------------

test('shouldNotify — first occurrence of high → true', () => {
  expect(shouldNotify(1, true, 'high', undefined), 'first high should notify').toBeTruthy();
});

test('shouldNotify — first occurrence of critical → true', () => {
  expect(shouldNotify(1, true, 'critical', undefined), 'first critical should notify').toBeTruthy();
});

test('shouldNotify — first occurrence of low → true (wasInserted)', () => {
  expect(shouldNotify(1, true, 'low', undefined), 'first low wasInserted should notify').toBeTruthy();
});

test('shouldNotify — second occurrence of low → false', () => {
  expect(!shouldNotify(2, false, 'low', undefined), 'second low should not notify').toBeTruthy();
});

test('shouldNotify — 10th occurrence of high → true (milestone)', () => {
  expect(shouldNotify(10, false, 'high', undefined), 'milestone 10 should notify').toBeTruthy();
});

test('shouldNotify — 100th occurrence → true (milestone)', () => {
  expect(shouldNotify(100, false, 'medium', undefined), 'milestone 100').toBeTruthy();
});

test('shouldNotify — 15th occurrence → false (not a milestone)', () => {
  expect(!shouldNotify(15, false, 'high', undefined), '15 is not a milestone').toBeTruthy();
});

test('shouldNotify — custom milestones from env', () => {
  expect(shouldNotify(5, false, 'high', '5,50,500'), 'custom milestone 5').toBeTruthy();
  expect(!shouldNotify(10, false, 'high', '5,50,500'), '10 not in custom milestones').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
