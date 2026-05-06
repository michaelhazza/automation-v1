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

import { expect, test } from 'vitest';
import { decideSeederAction } from '../../../scripts/lib/seedConfigAgentGuidelinesPure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── decideSeederAction ───────────────────────────────────────────────────────

test('no existing block → create', () => {
  const result = decideSeederAction({ blockExists: false, attachmentExists: false, contentMatches: false });
  expect(result.kind, 'decision').toBe('create');
});

test('block exists, no attachment → reattach', () => {
  const result = decideSeederAction({ blockExists: true, attachmentExists: false, contentMatches: true });
  expect(result.kind, 'decision').toBe('reattach');
});

test('block exists, no attachment, content differs → reattach (attachment has priority over divergence)', () => {
  const result = decideSeederAction({ blockExists: true, attachmentExists: false, contentMatches: false });
  expect(result.kind, 'decision').toBe('reattach');
});

test('block exists, attached, content matches → noop', () => {
  const result = decideSeederAction({ blockExists: true, attachmentExists: true, contentMatches: true });
  expect(result.kind, 'decision').toBe('noop');
});

test('block exists, attached, content differs → warn_divergence (runtime edit preserved)', () => {
  const result = decideSeederAction({ blockExists: true, attachmentExists: true, contentMatches: false });
  expect(result.kind, 'decision').toBe('warn_divergence');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n--- seedConfigAgentGuidelinesPure ---');
