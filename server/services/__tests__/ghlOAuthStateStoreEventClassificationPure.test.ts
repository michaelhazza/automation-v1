/**
 * Pure-function tests for classifyOAuthStateConsumeResult.
 */

import { expect, test } from 'vitest';
import { classifyOAuthStateConsumeResult } from '../ghlOAuthStateStore.js';

const now = new Date();
const past = new Date(now.getTime() - 10 * 60 * 1000);

test('rowFromDelete present → consumed', () => {
  const result = classifyOAuthStateConsumeResult({
    rowFromDelete: { issuedAt: past },
    expiredRow:    null,
  });
  expect(result).toBe('consumed');
});

test('rowFromDelete null + expiredRow present → expired', () => {
  const result = classifyOAuthStateConsumeResult({
    rowFromDelete: null,
    expiredRow:    { issuedAt: past, expiresAt: new Date(past.getTime() + 5 * 60 * 1000) },
  });
  expect(result).toBe('expired');
});

test('both null → not_found', () => {
  const result = classifyOAuthStateConsumeResult({
    rowFromDelete: null,
    expiredRow:    null,
  });
  expect(result).toBe('not_found');
});
