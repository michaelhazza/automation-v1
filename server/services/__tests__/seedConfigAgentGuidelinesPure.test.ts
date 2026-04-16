/**
 * seedConfigAgentGuidelinesPure unit tests — runnable via:
 *   npx tsx server/services/__tests__/seedConfigAgentGuidelinesPure.test.ts
 *
 * Covers the seeder's decision logic (decideSeederAction):
 *   - No existing block → 'create'
 *   - Block exists, no attachment → 'reattach'
 *   - Block exists, attached, content matches → 'noop'
 *   - Block exists, attached, content differs → 'warn_divergence'
 *   - Block exists, not attached, content differs → 'reattach' (attachment takes priority over divergence)
 *
 * Spec: docs/config-agent-guidelines-spec.md §3.4 / §3.5
 */

import { decideSeederAction } from '../../../scripts/lib/seedConfigAgentGuidelinesPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
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

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── decideSeederAction ───────────────────────────────────────────────────────

test('no existing block → create', () => {
  const result = decideSeederAction({ blockExists: false, attachmentExists: false, contentMatches: false });
  assertEqual(result.kind, 'create', 'decision');
});

test('block exists, no attachment → reattach', () => {
  const result = decideSeederAction({ blockExists: true, attachmentExists: false, contentMatches: true });
  assertEqual(result.kind, 'reattach', 'decision');
});

test('block exists, no attachment, content differs → reattach (attachment has priority over divergence)', () => {
  const result = decideSeederAction({ blockExists: true, attachmentExists: false, contentMatches: false });
  assertEqual(result.kind, 'reattach', 'decision');
});

test('block exists, attached, content matches → noop', () => {
  const result = decideSeederAction({ blockExists: true, attachmentExists: true, contentMatches: true });
  assertEqual(result.kind, 'noop', 'decision');
});

test('block exists, attached, content differs → warn_divergence (runtime edit preserved)', () => {
  const result = decideSeederAction({ blockExists: true, attachmentExists: true, contentMatches: false });
  assertEqual(result.kind, 'warn_divergence', 'decision');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n--- seedConfigAgentGuidelinesPure ---');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
