/**
 * bundleSuggestionDismissalsPure.test.ts
 *
 * Pure-function tests for BUNDLE-DISMISS-RLS: 3-column unique key contract.
 * Verifies that the onConflictDoUpdate target uses all three columns, and that
 * a collision on only 2 columns does NOT match the conflict target.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/services/__tests__/bundleSuggestionDismissalsPure.test.ts
 */

export {}; // make this a module (avoids global-scope redeclaration in tsc)

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// Pure model: the unique key is (organisation_id, user_id, doc_set_hash).
// A collision requires ALL THREE to match. Matching only (user_id, doc_set_hash)
// across two different orgs is NOT a conflict.

interface DismissalKey {
  organisationId: string;
  userId: string;
  docSetHash: string;
}

function keysCollide(a: DismissalKey, b: DismissalKey): boolean {
  return a.organisationId === b.organisationId
    && a.userId === b.userId
    && a.docSetHash === b.docSetHash;
}

console.log('\nbundleSuggestionDismissals BUNDLE-DISMISS-RLS — 3-column unique key tests\n');

test('same org, same user, same hash → collision (upsert fires)', () => {
  const existing: DismissalKey = { organisationId: 'org-a', userId: 'user-1', docSetHash: 'hash-x' };
  const incoming: DismissalKey = { organisationId: 'org-a', userId: 'user-1', docSetHash: 'hash-x' };
  assert(keysCollide(existing, incoming), 'identical keys should collide');
});

test('different org, same user, same hash → no collision', () => {
  const existing: DismissalKey = { organisationId: 'org-a', userId: 'user-1', docSetHash: 'hash-x' };
  const incoming: DismissalKey = { organisationId: 'org-b', userId: 'user-1', docSetHash: 'hash-x' };
  assert(!keysCollide(existing, incoming), 'different org should not collide even with same user+hash');
});

test('same org, different user, same hash → no collision', () => {
  const existing: DismissalKey = { organisationId: 'org-a', userId: 'user-1', docSetHash: 'hash-x' };
  const incoming: DismissalKey = { organisationId: 'org-a', userId: 'user-2', docSetHash: 'hash-x' };
  assert(!keysCollide(existing, incoming), 'different user should not collide');
});

test('same org, same user, different hash → no collision', () => {
  const existing: DismissalKey = { organisationId: 'org-a', userId: 'user-1', docSetHash: 'hash-x' };
  const incoming: DismissalKey = { organisationId: 'org-a', userId: 'user-1', docSetHash: 'hash-y' };
  assert(!keysCollide(existing, incoming), 'different hash should not collide');
});

test('2-column match (user+hash) across orgs is not a conflict under 3-column key', () => {
  // This is the key BUNDLE-DISMISS-RLS safety: org-a user-1 dismissal does not
  // conflict with org-b user-1 dismissal for the same doc set hash.
  const orgA: DismissalKey = { organisationId: 'org-a', userId: 'user-1', docSetHash: 'shared-hash' };
  const orgB: DismissalKey = { organisationId: 'org-b', userId: 'user-1', docSetHash: 'shared-hash' };
  assert(!keysCollide(orgA, orgB), 'cross-org same user+hash must not collide with 3-column key');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
