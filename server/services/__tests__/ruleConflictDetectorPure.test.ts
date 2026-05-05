/**
 * Pure-function tests for ruleConflictDetectorServicePure.
 * Run via: npx tsx server/services/__tests__/ruleConflictDetectorPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  parseConflictReportPure,
} from '../ruleConflictDetectorServicePure.js';
import type { RuleConflictInput } from '../ruleConflictDetectorServicePure.js';

const INPUT: RuleConflictInput = {
  newRule: { text: 'Never email opted-out contacts', scope: { kind: 'org' } },
  candidatePool: [
    {
      id: 'rule-1',
      text: 'Always email all contacts for campaigns',
      scope: { kind: 'org' },
      isAuthoritative: false,
      priority: 'medium',
    },
    {
      id: 'rule-2',
      text: 'Skip contacts with unsubscribed status',
      scope: { kind: 'org' },
      isAuthoritative: false,
      priority: 'low',
    },
  ],
};

test('fails open on null input', () => {
  const result = parseConflictReportPure(null, INPUT);
  expect(result.conflicts).toEqual([]);
  expect(result.checkedAt).toBeTruthy();
});

test('fails open on non-object input', () => {
  const result = parseConflictReportPure('invalid', INPUT);
  expect(result.conflicts).toEqual([]);
});

test('fails open when conflicts field is missing', () => {
  const result = parseConflictReportPure({ other: 'stuff' }, INPUT);
  expect(result.conflicts).toEqual([]);
});

test('parses a valid conflict', () => {
  const raw = {
    conflicts: [
      {
        existingRuleId: 'rule-1',
        existingText: 'Always email all contacts for campaigns',
        conflictKind: 'direct_contradiction',
        confidence: 0.9,
        suggestedResolution: 'keep_new',
      },
    ],
  };
  const result = parseConflictReportPure(raw, INPUT);
  expect(result.conflicts.length).toBe(1);
  expect(result.conflicts[0].existingRuleId).toBe('rule-1');
  expect(result.conflicts[0].conflictKind).toBe('direct_contradiction');
  expect(result.conflicts[0].confidence).toBe(0.9);
});

test('rejects conflict with unknown existingRuleId', () => {
  const raw = {
    conflicts: [
      {
        existingRuleId: 'rule-999',
        conflictKind: 'direct_contradiction',
        confidence: 0.9,
        suggestedResolution: 'keep_new',
      },
    ],
  };
  const result = parseConflictReportPure(raw, INPUT);
  expect(result.conflicts).toEqual([]);
});

test('rejects conflict with invalid conflictKind', () => {
  const raw = {
    conflicts: [
      {
        existingRuleId: 'rule-1',
        conflictKind: 'not_a_real_kind',
        confidence: 0.8,
        suggestedResolution: 'keep_new',
      },
    ],
  };
  const result = parseConflictReportPure(raw, INPUT);
  expect(result.conflicts).toEqual([]);
});

test('rejects conflict with out-of-range confidence', () => {
  const raw = {
    conflicts: [
      {
        existingRuleId: 'rule-1',
        conflictKind: 'scope_overlap',
        confidence: 1.5,
        suggestedResolution: 'user_decides',
      },
    ],
  };
  const result = parseConflictReportPure(raw, INPUT);
  expect(result.conflicts).toEqual([]);
});

test('accepts multiple valid conflicts', () => {
  const raw = {
    conflicts: [
      {
        existingRuleId: 'rule-1',
        conflictKind: 'direct_contradiction',
        confidence: 0.9,
        suggestedResolution: 'keep_new',
      },
      {
        existingRuleId: 'rule-2',
        conflictKind: 'subset',
        confidence: 0.6,
        suggestedResolution: 'keep_both_with_priorities',
      },
    ],
  };
  const result = parseConflictReportPure(raw, INPUT);
  expect(result.conflicts.length).toBe(2);
});

test('scope is derived from candidatePool when existingText absent', () => {
  const raw = {
    conflicts: [
      {
        existingRuleId: 'rule-2',
        conflictKind: 'subset',
        confidence: 0.7,
        suggestedResolution: 'user_decides',
      },
    ],
  };
  const result = parseConflictReportPure(raw, INPUT);
  expect(result.conflicts[0].existingScope.kind).toBe('org');
});
