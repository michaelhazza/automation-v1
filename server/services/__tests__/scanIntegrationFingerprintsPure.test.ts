/**
 * scanIntegrationFingerprintsPure.test.ts — fingerprint matcher for §2.0c.
 * DB I/O lives in the service wrapper; this file exercises only the matching
 * math.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/scanIntegrationFingerprintsPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  scanFingerprintsPure,
  matchesFingerprint,
  type FingerprintLibraryEntry,
  type Observation,
} from '../scanIntegrationFingerprintsPure.js';

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
  expect(matchesFingerprint(e, 'api.closebot.ai'), 'exact should match').toBeTruthy();
  expect(!matchesFingerprint(e, 'api.closebot.io'), 'non-match should fail').toBeTruthy();
});

test('matchesFingerprint — regex pattern match', () => {
  const e = entry({ id: 'b', fingerprintType: 'workflow_action_type', fingerprintPattern: '^closebot\\.' });
  expect(matchesFingerprint(e, 'closebot.send_sms'), 'prefix matches').toBeTruthy();
  expect(!matchesFingerprint(e, 'uphex.send_sms'), 'different prefix does not match').toBeTruthy();
});

test('matchesFingerprint — malformed regex does not throw', () => {
  const e = entry({ id: 'c', fingerprintType: 'tag_prefix', fingerprintPattern: '[broken' });
  // Should return false, not throw
  expect(!matchesFingerprint(e, 'anything'), 'malformed regex returns false').toBeTruthy();
});

test('matchesFingerprint — no value and no pattern returns false', () => {
  const e = entry({ id: 'd', fingerprintType: 'tag_prefix' });
  expect(!matchesFingerprint(e, 'anything'), 'no criteria → no match').toBeTruthy();
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
  expect(result.detections.length === 1, `expected 1 detection, got ${result.detections.length}`).toBeTruthy();
  expect(result.detections[0].integrationSlug === 'closebot', 'closebot detected').toBeTruthy();
  expect(result.unclassified.length === 0, 'no unclassified').toBeTruthy();
});

test('scan emits unclassified for non-matching observations', () => {
  const library: FingerprintLibraryEntry[] = [
    entry({ id: 'f1', fingerprintType: 'conversation_provider_id', fingerprintPattern: '^closebot:' }),
  ];
  const observations: Observation[] = [
    { signalType: 'conversation_provider_id', signalValue: 'mystery-tool:xyz' },
  ];
  const result = scanFingerprintsPure(observations, library);
  expect(result.detections.length === 0, 'no matches').toBeTruthy();
  expect(result.unclassified.length === 1, 'one unclassified').toBeTruthy();
  expect(result.unclassified[0].signalValue === 'mystery-tool:xyz', 'value preserved').toBeTruthy();
});

test('scan picks highest-confidence pattern when multiple library rows match', () => {
  const library: FingerprintLibraryEntry[] = [
    entry({ id: 'low',  integrationSlug: 'closebot', fingerprintType: 'tag_prefix', fingerprintPattern: '^closebot:', confidence: 0.6 }),
    entry({ id: 'high', integrationSlug: 'closebot', fingerprintType: 'tag_prefix', fingerprintPattern: '^closebot:',  confidence: 0.95 }),
  ];
  const observations: Observation[] = [{ signalType: 'tag_prefix', signalValue: 'closebot:ft-test' }];
  const result = scanFingerprintsPure(observations, library);
  expect(result.detections.length === 1, 'one detection').toBeTruthy();
  expect(result.detections[0].matchedFingerprintId === 'high', 'higher-confidence row wins').toBeTruthy();
  expect(result.detections[0].confidence === 0.95, 'confidence carried through').toBeTruthy();
});

test('scan tie-breaks on equal confidence by smallest fingerprint id (deterministic)', () => {
  const library: FingerprintLibraryEntry[] = [
    // Same slug + type + confidence — reverse-sorted ids so library order
    // alone would pick 'zeta'; tie-breaker must pick 'alpha'.
    entry({ id: 'zeta',  integrationSlug: 'closebot', fingerprintType: 'tag_prefix', fingerprintPattern: '^closebot:', confidence: 0.9 }),
    entry({ id: 'alpha', integrationSlug: 'closebot', fingerprintType: 'tag_prefix', fingerprintPattern: '^closebot:', confidence: 0.9 }),
  ];
  const observations: Observation[] = [{ signalType: 'tag_prefix', signalValue: 'closebot:ft-test' }];
  const result = scanFingerprintsPure(observations, library);
  expect(result.detections.length === 1, 'one detection').toBeTruthy();
  expect(result.detections[0].matchedFingerprintId === 'alpha', `deterministic tie-breaker should pick 'alpha', got ${result.detections[0].matchedFingerprintId}`).toBeTruthy();
});

test('scan cross-observation tie-break preserves smallest-id winner', () => {
  const library: FingerprintLibraryEntry[] = [
    entry({ id: 'alpha', integrationSlug: 'closebot', fingerprintType: 'conversation_provider_id', fingerprintPattern: '^closebot:', confidence: 0.9 }),
    entry({ id: 'zeta',  integrationSlug: 'closebot', fingerprintType: 'tag_prefix',               fingerprintPattern: '^closebot:', confidence: 0.9 }),
  ];
  // Both observations match different patterns at the same confidence. The
  // first write ('zeta' on first obs) must not overwrite with the second
  // ('alpha' on second obs) unless alpha < zeta lexically — which it does.
  const observations: Observation[] = [
    { signalType: 'tag_prefix', signalValue: 'closebot:x' },
    { signalType: 'conversation_provider_id', signalValue: 'closebot:y' },
  ];
  const result = scanFingerprintsPure(observations, library);
  expect(result.detections.length === 1, 'one detection per slug').toBeTruthy();
  expect(result.detections[0].matchedFingerprintId === 'alpha', `alpha wins the per-slug tie, got ${result.detections[0].matchedFingerprintId}`).toBeTruthy();
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
  expect(result.detections.length === 2, 'two integrations detected').toBeTruthy();
  const slugs = result.detections.map((d) => d.integrationSlug).sort();
  expect(slugs[0] === 'closebot' && slugs[1] === 'uphex', `got ${slugs.join(',')}`).toBeTruthy();
});

test('scan — empty library returns everything as unclassified', () => {
  const observations: Observation[] = [
    { signalType: 'conversation_provider_id', signalValue: 'foo:bar' },
    { signalType: 'tag_prefix', signalValue: 'baz' },
  ];
  const result = scanFingerprintsPure(observations, []);
  expect(result.detections.length === 0, 'no detections').toBeTruthy();
  expect(result.unclassified.length === 2, 'both unclassified').toBeTruthy();
});

test('scan — observations of a type absent from library fall through as unclassified', () => {
  const library: FingerprintLibraryEntry[] = [
    entry({ id: 'f1', fingerprintType: 'conversation_provider_id', fingerprintPattern: '^closebot:' }),
  ];
  const observations: Observation[] = [{ signalType: 'contact_source', signalValue: 'google-ads' }];
  const result = scanFingerprintsPure(observations, library);
  expect(result.unclassified.length === 1, 'type mismatch → unclassified').toBeTruthy();
});

console.log('');
