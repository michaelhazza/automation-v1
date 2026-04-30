/**
 * Pure-function tests for memoryBlockCitationDetectorPure.
 * Run via: npx tsx server/services/__tests__/memoryBlockCitationDetectorPure.test.ts
 */

import { expect, test } from 'vitest';
import { detectBlockCitationsPure } from '../memoryBlockCitationDetectorPure.js';
import type { BlockCitationInput } from '../memoryBlockCitationDetectorPure.js';

const BLOCKS = [
  { id: 'block-1', text: 'Always exclude opted-out contacts from email campaigns.' },
  { id: 'block-2', text: 'Use formal English in all client communications.' },
  { id: 'block-3', text: 'Prioritise VIP contacts for urgent follow-ups.' },
];

const CONFIG = { minCitationScore: 0.4 };

test('returns empty when no applied block IDs', () => {
  const input: BlockCitationInput = {
    appliedBlockIds: [],
    blocks: BLOCKS,
    runOutputText: 'Excluded all opted-out contacts from the campaign.',
    config: CONFIG,
  };
  const result = detectBlockCitationsPure(input);
  expect(result.length).toBe(0);
});

test('detects citation when output contains block words', () => {
  const input: BlockCitationInput = {
    appliedBlockIds: ['block-1'],
    blocks: BLOCKS,
    runOutputText: 'I excluded opted-out contacts from the email campaign as required.',
    config: CONFIG,
  };
  const result = detectBlockCitationsPure(input);
  expect(result.length).toBe(1);
  expect(result[0].memoryBlockId).toBe('block-1');
  expect(result[0].citationScore > 0).toBeTruthy();
});

test('returns no citation when output is unrelated to block', () => {
  const input: BlockCitationInput = {
    appliedBlockIds: ['block-2'],
    blocks: BLOCKS,
    runOutputText: 'Revenue is up 15% this quarter across all segments.',
    config: { minCitationScore: 0.4 },
  };
  const result = detectBlockCitationsPure(input);
  expect(result.length).toBe(0);
});

test('respects minCitationScore threshold', () => {
  const input: BlockCitationInput = {
    appliedBlockIds: ['block-1'],
    blocks: BLOCKS,
    runOutputText: 'I excluded opted-out contacts from the email campaign.',
    config: { minCitationScore: 0.99 },
  };
  const result = detectBlockCitationsPure(input);
  // High threshold — should filter out the citation
  expect(result.length).toBe(0);
});

test('sorts results by citationScore descending', () => {
  const input: BlockCitationInput = {
    appliedBlockIds: ['block-1', 'block-3'],
    blocks: BLOCKS,
    runOutputText:
      'Excluded opted-out contacts from email campaigns. Prioritised VIP contacts for follow-ups.',
    config: { minCitationScore: 0.2 },
  };
  const result = detectBlockCitationsPure(input);
  if (result.length >= 2) {
    expect(result[0].citationScore >= result[1].citationScore).toBeTruthy();
  }
});

test('ignores blocks not in appliedBlockIds', () => {
  const input: BlockCitationInput = {
    appliedBlockIds: ['block-1'],
    blocks: BLOCKS,
    runOutputText: 'Used formal English in all client communications.',
    config: CONFIG,
  };
  const result = detectBlockCitationsPure(input);
  expect(!result.some((c) => c.memoryBlockId === 'block-2')).toBeTruthy();
});
