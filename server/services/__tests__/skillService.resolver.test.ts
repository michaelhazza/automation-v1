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

import { computeDerivedSkills, shouldWarnMissingHierarchy } from '../skillServicePure.js';

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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('returns [] when hierarchy is undefined', () => {
  const result = computeDerivedSkills({ hierarchy: undefined });
  assertEqual(result, [], 'result should be empty array');
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
  assertEqual(result, [], 'result should be empty array for leaf agent');
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
  assertEqual(
    result,
    ['config_list_agents', 'spawn_sub_agents', 'reassign_task'],
    'result should contain all three delegation slugs',
  );
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
  assertEqual(
    result,
    ['config_list_agents', 'spawn_sub_agents', 'reassign_task'],
    'result should contain all three delegation slugs regardless of child count',
  );
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
  assertEqual(effectiveSlugs.length, 4, 'no duplicates — spawn_sub_agents appears once');
  assert(effectiveSlugs.includes('spawn_sub_agents'), 'spawn_sub_agents present');
  assert(effectiveSlugs.includes('config_list_agents'), 'config_list_agents present');
  assert(effectiveSlugs.includes('reassign_task'), 'reassign_task present');
  assert(effectiveSlugs.includes('some_skill'), 'some_skill still present');
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

  assertEqual(effectiveSlugs.length, 3, 'all three slugs de-duped to length 3');
});

// ---------------------------------------------------------------------------
// shouldWarnMissingHierarchy — WARN decision logic (INV: hierarchy_missing_at_resolver_time)
// ---------------------------------------------------------------------------

test('hierarchy undefined, subaccountId provided → shouldWarn true', () => {
  const result = shouldWarnMissingHierarchy({
    hierarchy: undefined,
    subaccountId: 'sub-abc',
  });
  assert(result === true, 'expected shouldWarnMissingHierarchy to return true');
});

test('hierarchy undefined, subaccountId undefined → shouldWarn false (non-subaccount run)', () => {
  const result = shouldWarnMissingHierarchy({
    hierarchy: undefined,
    subaccountId: undefined,
  });
  assert(result === false, 'expected shouldWarnMissingHierarchy to return false for non-subaccount run');
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
  assert(result === false, 'expected shouldWarnMissingHierarchy to return false when hierarchy is present');
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log('');
console.log(`skillService.resolver: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
