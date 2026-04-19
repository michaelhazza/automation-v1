/**
 * scanIntegrationFingerprintsPure.test.ts — fingerprint matcher for §2.0c.
 * DB I/O lives in the service wrapper; this file exercises only the matching
 * math.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/scanIntegrationFingerprintsPure.test.ts
 */

import {
  scanFingerprintsPure,
  matchesFingerprint,
  type FingerprintLibraryEntry,
  type Observation,
} from '../scanIntegrationFingerprintsPure.js';

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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function entry(overrides: Partial<FingerprintLibraryEntry> & Pick<FingerprintLibraryEntry, 'id' | 'fingerprintType'>): FingerprintLibraryEntry {
  return {
    integrationSlug: 'closebot',
    displayName: 'CloseBot',
    fingerprintValue: null,
    fingerprintPattern: null,
    confidence: 0.9,
    ...overrides,
  };
}

// ── matchesFingerprint unit ─────────────────────────────────────────────

test('matchesFingerprint — exact value match', () => {
  const e = entry({ id: 'a', fingerprintType: 'outbound_webhook_domain', fingerprintValue: 'api.closebot.ai' });
  assert(matchesFingerprint(e, 'api.closebot.ai'), 'exact should match');
  assert(!matchesFingerprint(e, 'api.closebot.io'), 'non-match should fail');
});

test('matchesFingerprint — regex pattern match', () => {
  const e = entry({ id: 'b', fingerprintType: 'workflow_action_type', fingerprintPattern: '^closebot\\.' });
  assert(matchesFingerprint(e, 'closebot.send_sms'), 'prefix matches');
  assert(!matchesFingerprint(e, 'uphex.send_sms'), 'different prefix does not match');
});

test('matchesFingerprint — malformed regex does not throw', () => {
  const e = entry({ id: 'c', fingerprintType: 'tag_prefix', fingerprintPattern: '[broken' });
  // Should return false, not throw
  assert(!matchesFingerprint(e, 'anything'), 'malformed regex returns false');
});

test('matchesFingerprint — no value and no pattern returns false', () => {
  const e = entry({ id: 'd', fingerprintType: 'tag_prefix' });
  assert(!matchesFingerprint(e, 'anything'), 'no criteria → no match');
});

// ── scanFingerprintsPure integration-ish ───────────────────────────────

test('scan collapses multiple pattern matches per integration into one detection', () => {
  const library: FingerprintLibraryEntry[] = [
    entry({ id: 'f1', fingerprintType: 'conversation_provider_id', fingerprintPattern: '^closebot:' }),
    entry({ id: 'f2', fingerprintType: 'workflow_action_type', fingerprintPattern: '^closebot\\.' }),
  ];
  const observations: Observation[] = [
    { signalType: 'conversation_provider_id', signalValue: 'closebot:abc' },
    { signalType: 'workflow_action_type', signalValue: 'closebot.send_sms' },
  ];
  const result = scanFingerprintsPure(observations, library);
  assert(result.detections.length === 1, `expected 1 detection, got ${result.detections.length}`);
  assert(result.detections[0].integrationSlug === 'closebot', 'closebot detected');
  assert(result.unclassified.length === 0, 'no unclassified');
});

test('scan emits unclassified for non-matching observations', () => {
  const library: FingerprintLibraryEntry[] = [
    entry({ id: 'f1', fingerprintType: 'conversation_provider_id', fingerprintPattern: '^closebot:' }),
  ];
  const observations: Observation[] = [
    { signalType: 'conversation_provider_id', signalValue: 'mystery-tool:xyz' },
  ];
  const result = scanFingerprintsPure(observations, library);
  assert(result.detections.length === 0, 'no matches');
  assert(result.unclassified.length === 1, 'one unclassified');
  assert(result.unclassified[0].signalValue === 'mystery-tool:xyz', 'value preserved');
});

test('scan picks highest-confidence pattern when multiple library rows match', () => {
  const library: FingerprintLibraryEntry[] = [
    entry({ id: 'low',  integrationSlug: 'closebot', fingerprintType: 'tag_prefix', fingerprintPattern: '^closebot:', confidence: 0.6 }),
    entry({ id: 'high', integrationSlug: 'closebot', fingerprintType: 'tag_prefix', fingerprintPattern: '^closebot:',  confidence: 0.95 }),
  ];
  const observations: Observation[] = [{ signalType: 'tag_prefix', signalValue: 'closebot:ft-test' }];
  const result = scanFingerprintsPure(observations, library);
  assert(result.detections.length === 1, 'one detection');
  assert(result.detections[0].matchedFingerprintId === 'high', 'higher-confidence row wins');
  assert(result.detections[0].confidence === 0.95, 'confidence carried through');
});

test('scan handles multiple integrations matched independently', () => {
  const library: FingerprintLibraryEntry[] = [
    entry({ id: 'cb', integrationSlug: 'closebot', fingerprintType: 'conversation_provider_id', fingerprintPattern: '^closebot:', confidence: 0.95 }),
    entry({ id: 'up', integrationSlug: 'uphex',    fingerprintType: 'outbound_webhook_domain', fingerprintValue: 'api.uphex.com', confidence: 0.95 }),
  ];
  const observations: Observation[] = [
    { signalType: 'conversation_provider_id', signalValue: 'closebot:x' },
    { signalType: 'outbound_webhook_domain', signalValue: 'api.uphex.com' },
  ];
  const result = scanFingerprintsPure(observations, library);
  assert(result.detections.length === 2, 'two integrations detected');
  const slugs = result.detections.map((d) => d.integrationSlug).sort();
  assert(slugs[0] === 'closebot' && slugs[1] === 'uphex', `got ${slugs.join(',')}`);
});

test('scan — empty library returns everything as unclassified', () => {
  const observations: Observation[] = [
    { signalType: 'conversation_provider_id', signalValue: 'foo:bar' },
    { signalType: 'tag_prefix', signalValue: 'baz' },
  ];
  const result = scanFingerprintsPure(observations, []);
  assert(result.detections.length === 0, 'no detections');
  assert(result.unclassified.length === 2, 'both unclassified');
});

test('scan — observations of a type absent from library fall through as unclassified', () => {
  const library: FingerprintLibraryEntry[] = [
    entry({ id: 'f1', fingerprintType: 'conversation_provider_id', fingerprintPattern: '^closebot:' }),
  ];
  const observations: Observation[] = [{ signalType: 'contact_source', signalValue: 'google-ads' }];
  const result = scanFingerprintsPure(observations, library);
  assert(result.unclassified.length === 1, 'type mismatch → unclassified');
});

console.log('');
console.log(`scanIntegrationFingerprintsPure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
