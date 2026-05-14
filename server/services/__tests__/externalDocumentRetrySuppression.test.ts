import { test, expect } from 'vitest';
import { RetrySuppressor } from '../externalDocumentRetrySuppression.js';

test('first failure record is not suppressed; subsequent within window are', () => {
  const s = new RetrySuppressor(60_000, () => 1_000);
  expect(s.shouldSuppress('ref-1', 'auth_revoked')).toBe(false);
  s.recordFailure('ref-1', 'auth_revoked');
  expect(s.shouldSuppress('ref-1', 'auth_revoked')).toBe(true);
});

test('suppression expires after the window', () => {
  let now = 1_000;
  const s = new RetrySuppressor(60_000, () => now);
  s.recordFailure('ref-1', 'auth_revoked');
  now = 1_000 + 59_999;
  expect(s.shouldSuppress('ref-1', 'auth_revoked')).toBe(true);
  now = 1_000 + 60_001;
  expect(s.shouldSuppress('ref-1', 'auth_revoked')).toBe(false);
});

test('different reasons are tracked independently', () => {
  const s = new RetrySuppressor(60_000, () => 1_000);
  s.recordFailure('ref-1', 'auth_revoked');
  expect(s.shouldSuppress('ref-1', 'rate_limited')).toBe(false);
});

test('different references are tracked independently', () => {
  const s = new RetrySuppressor(60_000, () => 1_000);
  s.recordFailure('ref-1', 'auth_revoked');
  expect(s.shouldSuppress('ref-2', 'auth_revoked')).toBe(false);
});
