/**
 * ghlOAuthStateStoreEventClassificationPure.test.ts
 *
 * Pure-function tests for classifyOAuthStateConsumeResult.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/ghlOAuthStateStoreEventClassificationPure.test.ts
 */

import assert from 'node:assert/strict';
import { classifyOAuthStateConsumeResult } from '../ghlOAuthStateStore.js';

const now = new Date();
const past = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes ago

// ─── Test 1: rowFromDelete present → consumed ─────────────────────────────────

{
  const result = classifyOAuthStateConsumeResult({
    rowFromDelete: { issuedAt: past },
    expiredRow:    null,
  });
  assert.equal(result, 'consumed', 'rowFromDelete present → consumed');
  console.log('PASS: rowFromDelete present → consumed');
}

// ─── Test 2: rowFromDelete null, expiredRow present → expired ─────────────────

{
  const result = classifyOAuthStateConsumeResult({
    rowFromDelete: null,
    expiredRow:    { issuedAt: past, expiresAt: new Date(past.getTime() + 5 * 60 * 1000) },
  });
  assert.equal(result, 'expired', 'rowFromDelete null + expiredRow present → expired');
  console.log('PASS: rowFromDelete null + expiredRow present → expired');
}

// ─── Test 3: both null → not_found ────────────────────────────────────────────

{
  const result = classifyOAuthStateConsumeResult({
    rowFromDelete: null,
    expiredRow:    null,
  });
  assert.equal(result, 'not_found', 'both null → not_found');
  console.log('PASS: both null → not_found');
}

console.log('\nAll classifyOAuthStateConsumeResult pure tests passed.');
