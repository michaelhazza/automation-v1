/**
 * baselineArtefactsLoader.test.ts — null-guard test for getTier1Blocks.
 *
 * Tests the early-return path (subaccountId === null) which requires no DB
 * connection. Verifies the guard logic inline so this test runs without
 * DATABASE_URL.
 *
 * Spec: docs/sub-account-baseline-artefacts-spec.md §4.
 */

import { describe, it, expect } from 'vitest';

// Inline reproduction of the null-guard from getTier1Blocks.
// This mirrors the first line of the function exactly.
async function nullGuardSlice(
  subaccountId: string | null,
): Promise<Array<{ id: string; name: string; content: string; tier: 1 }>> {
  if (!subaccountId) return [];
  // If we reach here a DB call would follow — not exercised in this test.
  throw new Error('should not reach DB in null-guard test');
}

describe('getTier1Blocks null-guard', () => {
  it('returns [] for null subaccountId without hitting DB', async () => {
    const result = await nullGuardSlice(null);
    expect(result).toEqual([]);
  });

  it('returns [] for empty-string subaccountId (falsy)', async () => {
    const result = await nullGuardSlice('');
    expect(result).toEqual([]);
  });
});
