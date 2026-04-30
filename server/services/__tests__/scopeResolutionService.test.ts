import { expect, test } from 'vitest';
// Seed env vars before the service loads to prevent zod env parse failure.
// Use ??= so we don't override a real DATABASE_URL if present.
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

// Use dynamic import to run after env var seeding.
const { disambiguationQuestion, deduplicateCandidates, rankCandidates, isTopCandidateDecisive } =
  await import('../scopeResolutionService.js');

export {};

test('disambiguationQuestion returns correct prompt', () => {
  expect(disambiguationQuestion([
      { id: '1', name: 'Acme Pty Ltd', type: 'org' },
      { id: '2', name: 'Acme Holdings', type: 'org' },
    ])).toBe('Which organisation did you mean?');
  expect(disambiguationQuestion([
      { id: '1', name: 'Sales Team', type: 'subaccount' },
      { id: '2', name: 'Sales East', type: 'subaccount' },
    ])).toBe('Which subaccount did you mean?');
  expect(disambiguationQuestion([
      { id: '1', name: 'Acme', type: 'org' },
      { id: '2', name: 'Acme Sales', type: 'subaccount' },
    ])).toBe('Which organisation or subaccount did you mean?');
});

test('deduplicateCandidates removes duplicate IDs', () => {
  const dupes = [
    { id: '1', name: 'Acme', type: 'org' as const },
    { id: '1', name: 'Acme', type: 'org' as const },
    { id: '2', name: 'Sales', type: 'subaccount' as const },
  ];
  expect(deduplicateCandidates(dupes)).toEqual([
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
  expect(ranked[0]!.name).toBe('Acme');
  expect(ranked[1]!.name).toBe('Acme Holdings');
  expect(ranked[2]!.name).toBe('Acme Pty Ltd');
});

test('rankCandidates: org wins over subaccount on equal score', () => {
  const mixed = [
    { id: '10', name: 'Acme', type: 'subaccount' as const, orgName: 'Parent Co' },
    { id: '11', name: 'Acme', type: 'org' as const },
  ];
  const mixedRanked = rankCandidates(mixed, 'acme');
  expect(mixedRanked[0]!.type).toBe('org');
});

test('isTopCandidateDecisive: various cases', () => {
  expect(isTopCandidateDecisive([], 'acme')).toBe(false);
  expect(isTopCandidateDecisive([{ id: '1', name: 'Acme', type: 'org' }], 'acme')).toBe(true);

  const strictScoreWin = rankCandidates(
    [
      { id: '1', name: 'Acme Holdings', type: 'org' as const },
      { id: '2', name: 'Acme', type: 'org' as const },
    ],
    'acme',
  );
  expect(isTopCandidateDecisive(strictScoreWin, 'acme')).toBe(true);

  const tiedScoreDifferentType = rankCandidates(
    [
      { id: '1', name: 'Acme', type: 'subaccount' as const, orgName: 'Parent Co' },
      { id: '2', name: 'Acme', type: 'org' as const },
    ],
    'acme',
  );
  expect(isTopCandidateDecisive(tiedScoreDifferentType, 'acme')).toBe(true);

  const lexTied = rankCandidates(
    [
      { id: '1', name: 'Acme Pty Ltd', type: 'org' as const },
      { id: '2', name: 'Acme Holdings', type: 'org' as const },
    ],
    'acme',
  );
  expect(isTopCandidateDecisive(lexTied, 'acme')).toBe(false);
});
