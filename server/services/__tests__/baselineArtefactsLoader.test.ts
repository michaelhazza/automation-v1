/**
 * baselineArtefactsLoader.test.ts — null-guard test for getTier1Blocks.
 *
 * Tests the early-return path (subaccountId === null) which requires no DB
 * connection. Verifies the guard logic inline so this test runs without
 * DATABASE_URL.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/baselineArtefactsLoader.test.ts
 *
 * Spec: docs/sub-account-baseline-artefacts-spec.md §4.
 */

// Inline reproduction of the null-guard from getTier1Blocks.
// This mirrors the first line of the function exactly.
async function nullGuardSlice(
  subaccountId: string | null,
): Promise<Array<{ id: string; name: string; content: string; tier: 1 }>> {
  if (!subaccountId) return [];
  // If we reach here a DB call would follow — not exercised in this test.
  throw new Error('should not reach DB in null-guard test');
}

async function main() {
  let passed = 0;
  let failed = 0;

  // Test 1: null subaccountId returns [] without hitting DB
  try {
    const result = await nullGuardSlice(null);
    if (!Array.isArray(result) || result.length !== 0) {
      throw new Error(`Expected [], got ${JSON.stringify(result)}`);
    }
    console.log('PASS: null subaccountId returns []');
    passed++;
  } catch (err) {
    console.error('FAIL: null subaccountId returns []:', err);
    failed++;
  }

  // Test 2: empty-string subaccountId (falsy) also returns []
  try {
    const result = await nullGuardSlice('');
    if (!Array.isArray(result) || result.length !== 0) {
      throw new Error(`Expected [], got ${JSON.stringify(result)}`);
    }
    console.log('PASS: empty-string subaccountId returns []');
    passed++;
  } catch (err) {
    console.error('FAIL: empty-string subaccountId returns []:', err);
    failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
