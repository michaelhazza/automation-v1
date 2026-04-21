import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IDEMPOTENCY_KEY_VERSION } from '../idempotencyVersion.js';

// ---------------------------------------------------------------------------
// Pins the load-time guard on IDEMPOTENCY_KEY_VERSION.
//
// Reviewer feedback 2026-04-21 round 4: a runtime assert catches the
// "still a string, but empty/null/unprefixed" failure mode that
// TypeScript's type-level `as const` guarantees can't express.
//
// Module load itself throws if the constant is malformed, so if you see
// this test file in the failed list with a thrown-at-import error, the
// guard tripped — read the throw message, fix the constant shape, move on.
// ---------------------------------------------------------------------------

test('IDEMPOTENCY_KEY_VERSION matches /^v\\d+$/', () => {
  assert.match(IDEMPOTENCY_KEY_VERSION, /^v\d+$/);
});

test('IDEMPOTENCY_KEY_VERSION is non-empty', () => {
  assert.notEqual(IDEMPOTENCY_KEY_VERSION, '');
});

test('IDEMPOTENCY_KEY_VERSION current value pinned at v1', () => {
  // Fixture pin — the version must change deliberately via the constant,
  // not via a copy-paste of hash output anywhere else. Bumping this line
  // in the same commit as a canonicalisation change is the whole point.
  assert.equal(IDEMPOTENCY_KEY_VERSION, 'v1');
});
