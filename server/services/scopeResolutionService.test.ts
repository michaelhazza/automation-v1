import { expect, test } from 'vitest';
import { strict as assert } from 'node:assert';

// Seed env vars before the service loads to prevent zod env parse failure.
// Use ??= so we don't override a real DATABASE_URL if present.
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

// Use dynamic import to run after env var seeding.
const { disambiguationQuestion, deduplicateCandidates, rankCandidates, isTopCandidateDecisive } =
  await import('./scopeResolutionService.js');

export {};

test('disambiguationQuestion returns correct prompt', () => {
  assert.strictEqual(
    disambiguationQuestion([
      { id: '1', name: 'Acme Pty Ltd', type: 'org' },
      { id: '2', name: 'Acme Holdings', type: 'org' },
    ]),
    'Which organisation did you mean?',
  );
  assert.strictEqual(
    disambiguationQuestion([
      { id: '1', name: 'Sales Team', type: 'subaccount' },
      { id: '2', name: 'Sales East', type: 'subaccount' },
    ]),
    'Which subaccount did you mean?',
  );
  assert.strictEqual(
    disambiguationQuestion([
      { id: '1', name: 'Acme', type: 'org' },
      { id: '2', name: 'Acme Sales', type: 'subaccount' },
    ]),
    'Which organisation or subaccount did you mean?',
  );
});

test('deduplicateCandidates removes duplicate IDs', () => {
  const dupes = [
    { id: '1', name: 'Acme', type: 'org' as const },
    { id: '1', name: 'Acme', type: 'org' as const },
    { id: '2', name: 'Sales', type: 'subaccount' as const },
  ];
  assert.deepStrictEqual(deduplicateCandidates(dupes), [
    { id: '1', name: 'Acme', type: 'org' },
    { id: '2', name: 'Sales', type: 'subaccount' },
  ]);
});

test('rankCandidates: exact match floats to top; shorter name wins on tie', () => {
  const unranked = [
    { id: '3', name: 'Acme Holdings', type: 'org' as const },
    { id: '1', name: 'Acme', type: 'org' as const },
    { id: '2', name: 'Acme Pty Ltd', type: 'org' as const },
  ];
  const ranked = rankCandidates(unranked, 'acme');
  assert.strictEqual(ranked[0]!.name, 'Acme');
  assert.strictEqual(ranked[1]!.name, 'Acme Holdings');
  assert.strictEqual(ranked[2]!.name, 'Acme Pty Ltd');
});

test('rankCandidates: org wins over subaccount on equal score', () => {
  const mixed = [
    { id: '10', name: 'Acme', type: 'subaccount' as const, orgName: 'Parent Co' },
    { id: '11', name: 'Acme', type: 'org' as const },
  ];
  const mixedRanked = rankCandidates(mixed, 'acme');
  assert.strictEqual(mixedRanked[0]!.type, 'org');
});

test('isTopCandidateDecisive: various cases', () => {
  assert.strictEqual(isTopCandidateDecisive([], 'acme'), false);
  assert.strictEqual(
    isTopCandidateDecisive([{ id: '1', name: 'Acme', type: 'org' }], 'acme'),
    true,
  );

  const strictScoreWin = rankCandidates(
    [
      { id: '1', name: 'Acme Holdings', type: 'org' as const },
      { id: '2', name: 'Acme', type: 'org' as const },
    ],
    'acme',
  );
  assert.strictEqual(isTopCandidateDecisive(strictScoreWin, 'acme'), true);

  const tiedScoreDifferentType = rankCandidates(
    [
      { id: '1', name: 'Acme', type: 'subaccount' as const, orgName: 'Parent Co' },
      { id: '2', name: 'Acme', type: 'org' as const },
    ],
    'acme',
  );
  assert.strictEqual(isTopCandidateDecisive(tiedScoreDifferentType, 'acme'), true);

  const lexTied = rankCandidates(
    [
      { id: '1', name: 'Acme Pty Ltd', type: 'org' as const },
      { id: '2', name: 'Acme Holdings', type: 'org' as const },
    ],
    'acme',
  );
  assert.strictEqual(isTopCandidateDecisive(lexTied, 'acme'), false);
});
