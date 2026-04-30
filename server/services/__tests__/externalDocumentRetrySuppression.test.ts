import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RetrySuppressor } from '../externalDocumentRetrySuppression';

test('first failure record is not suppressed; subsequent within window are', () => {
  const s = new RetrySuppressor(60_000, () => 1_000);
  assert.equal(s.shouldSuppress('ref-1', 'auth_revoked'), false);
  s.recordFailure('ref-1', 'auth_revoked');
  assert.equal(s.shouldSuppress('ref-1', 'auth_revoked'), true);
});

test('suppression expires after the window', () => {
  let now = 1_000;
  const s = new RetrySuppressor(60_000, () => now);
  s.recordFailure('ref-1', 'auth_revoked');
  now = 1_000 + 59_999;
  assert.equal(s.shouldSuppress('ref-1', 'auth_revoked'), true);
  now = 1_000 + 60_001;
  assert.equal(s.shouldSuppress('ref-1', 'auth_revoked'), false);
});

test('different reasons are tracked independently', () => {
  const s = new RetrySuppressor(60_000, () => 1_000);
  s.recordFailure('ref-1', 'auth_revoked');
  assert.equal(s.shouldSuppress('ref-1', 'rate_limited'), false);
});

test('different references are tracked independently', () => {
  const s = new RetrySuppressor(60_000, () => 1_000);
  s.recordFailure('ref-1', 'auth_revoked');
  assert.equal(s.shouldSuppress('ref-2', 'auth_revoked'), false);
});
