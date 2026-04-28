import { strict as assert } from 'node:assert';
import { disambiguationQuestion, deduplicateCandidates, rankCandidates } from './scopeResolutionService.js';
import type { ScopeCandidate } from './scopeResolutionService.js';

// disambiguationQuestion
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

// deduplicateCandidates
const dupes: ScopeCandidate[] = [
  { id: '1', name: 'Acme', type: 'org' },
  { id: '1', name: 'Acme', type: 'org' },
  { id: '2', name: 'Sales', type: 'subaccount' },
];
assert.deepStrictEqual(deduplicateCandidates(dupes), [
  { id: '1', name: 'Acme', type: 'org' },
  { id: '2', name: 'Sales', type: 'subaccount' },
]);

// rankCandidates — exact match floats to top; shorter name wins on tie
const unranked: ScopeCandidate[] = [
  { id: '3', name: 'Acme Holdings', type: 'org' },
  { id: '1', name: 'Acme', type: 'org' },
  { id: '2', name: 'Acme Pty Ltd', type: 'org' },
];
const ranked = rankCandidates(unranked, 'acme');
assert.strictEqual(ranked[0]!.name, 'Acme'); // exact match
assert.strictEqual(ranked[1]!.name, 'Acme Holdings'); // prefix, shorter
assert.strictEqual(ranked[2]!.name, 'Acme Pty Ltd'); // prefix, longer

// type bias — org wins over subaccount on equal score
const mixed: ScopeCandidate[] = [
  { id: '10', name: 'Acme', type: 'subaccount', orgName: 'Parent Co' },
  { id: '11', name: 'Acme', type: 'org' },
];
const mixedRanked = rankCandidates(mixed, 'acme');
assert.strictEqual(mixedRanked[0]!.type, 'org'); // org wins on score tie

console.log('All scopeResolutionService tests passed.');
