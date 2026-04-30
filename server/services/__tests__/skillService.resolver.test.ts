/**
 * skillService.resolver.test.ts — Pure function tests for skillServicePure.
 *
 * Covers: computeDerivedSkills (no hierarchy, empty childIds, non-empty
 * childIds, union idempotency) and shouldWarnMissingHierarchy (WARN decision
 * logic for the hierarchy_missing_at_resolver_time invariant).
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/skillService.resolver.test.ts
 */

import { expect, test } from 'vitest';
import { computeDerivedSkills, shouldWarnMissingHierarchy } from '../skillServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('returns [] when hierarchy is undefined', () => {
  const result = computeDerivedSkills({ hierarchy: undefined });
  expect(result, 'result should be empty array').toEqual([]);
});

test('returns [] when hierarchy has no children (empty childIds)', () => {
  const result = computeDerivedSkills({
    hierarchy: {
      agentId: 'sa-root',
      parentId: null,
      childIds: [],
      rootId: 'sa-root',
      depth: 0,
    },
  });
  expect(result, 'result should be empty array for leaf agent').toEqual([]);
});

test('returns delegation slugs when agent has at least one child', () => {
  const result = computeDerivedSkills({
    hierarchy: {
      agentId: 'sa-manager',
      parentId: null,
      childIds: ['sa-1'],
      rootId: 'sa-manager',
      depth: 0,
    },
  });
  expect(result, 'result should contain all three delegation slugs').toEqual(['config_list_agents', 'spawn_sub_agents', 'reassign_task']);
});

test('returns delegation slugs when agent has multiple children', () => {
  const result = computeDerivedSkills({
    hierarchy: {
      agentId: 'sa-manager',
      parentId: null,
      childIds: ['sa-1', 'sa-2', 'sa-3'],
      rootId: 'sa-manager',
      depth: 0,
    },
  });
  expect(result, 'result should contain all three delegation slugs regardless of child count').toEqual(['config_list_agents', 'spawn_sub_agents', 'reassign_task']);
});

test('union idempotency: de-duped Set has no duplicates when attached slugs overlap derived slugs', () => {
  // Simulate an agent that already has spawn_sub_agents attached explicitly
  const attachedSlugs = ['some_skill', 'spawn_sub_agents'];
  const derivedSlugs = computeDerivedSkills({
    hierarchy: {
      agentId: 'sa-manager',
      parentId: null,
      childIds: ['sa-1'],
      rootId: 'sa-manager',
      depth: 0,
    },
  });

  const effectiveSlugs = Array.from(new Set([...attachedSlugs, ...derivedSlugs]));

  // Expected: some_skill + config_list_agents + spawn_sub_agents + reassign_task = 4 unique slugs
  expect(effectiveSlugs.length, 'no duplicates — spawn_sub_agents appears once').toBe(4);
  expect(effectiveSlugs.includes('spawn_sub_agents'), 'spawn_sub_agents present').toBeTruthy();
  expect(effectiveSlugs.includes('config_list_agents'), 'config_list_agents present').toBeTruthy();
  expect(effectiveSlugs.includes('reassign_task'), 'reassign_task present').toBeTruthy();
  expect(effectiveSlugs.includes('some_skill'), 'some_skill still present').toBeTruthy();
});

test('union idempotency: all three derived slugs overlap with attached — result length equals 3', () => {
  const attachedSlugs = ['config_list_agents', 'spawn_sub_agents', 'reassign_task'];
  const derivedSlugs = computeDerivedSkills({
    hierarchy: {
      agentId: 'sa-manager',
      parentId: null,
      childIds: ['sa-1'],
      rootId: 'sa-manager',
      depth: 0,
    },
  });

  const effectiveSlugs = Array.from(new Set([...attachedSlugs, ...derivedSlugs]));

  expect(effectiveSlugs.length, 'all three slugs de-duped to length 3').toBe(3);
});

// ---------------------------------------------------------------------------
// shouldWarnMissingHierarchy — WARN decision logic (INV: hierarchy_missing_at_resolver_time)
// ---------------------------------------------------------------------------

test('hierarchy undefined, subaccountId provided → shouldWarn true', () => {
  const result = shouldWarnMissingHierarchy({
    hierarchy: undefined,
    subaccountId: 'sub-abc',
  });
  expect(result === true, 'expected shouldWarnMissingHierarchy to return true').toBeTruthy();
});

test('hierarchy undefined, subaccountId undefined → shouldWarn false (non-subaccount run)', () => {
  const result = shouldWarnMissingHierarchy({
    hierarchy: undefined,
    subaccountId: undefined,
  });
  expect(result === false, 'expected shouldWarnMissingHierarchy to return false for non-subaccount run').toBeTruthy();
});

test('hierarchy present, subaccountId provided → shouldWarn false (hierarchy built successfully)', () => {
  const result = shouldWarnMissingHierarchy({
    hierarchy: {
      agentId: 'sa-root',
      parentId: null,
      childIds: [],
      rootId: 'sa-root',
      depth: 0,
    },
    subaccountId: 'sub-abc',
  });
  expect(result === false, 'expected shouldWarnMissingHierarchy to return false when hierarchy is present').toBeTruthy();
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log('');
