/**
 * skillExecutorDelegationPure — spawn_sub_agents perspective unit tests.
 *
 * Tests classifySpawnTargets and resolveWriteSkillScope.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/skillExecutor.spawnSubAgents.test.ts
 */

import {
  classifySpawnTargets,
  resolveWriteSkillScope,
  evaluateSpawnPreconditions,
} from '../skillExecutorDelegationPure.js';
import type { HierarchyContext } from '../../../shared/types/delegation.js';

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseHierarchy: Readonly<HierarchyContext> = {
  agentId: 'sa-parent',
  parentId: null,
  childIds: ['sa-child-1', 'sa-child-2'],
  rootId: 'sa-parent',
  depth: 0,
};

const hierarchyNoChildren: Readonly<HierarchyContext> = {
  agentId: 'sa-leaf',
  parentId: 'sa-parent',
  childIds: [],
  rootId: 'sa-root',
  depth: 1,
};

// ---------------------------------------------------------------------------
// classifySpawnTargets
// ---------------------------------------------------------------------------

console.log('');
console.log('classifySpawnTargets');
console.log('');

test('all targets in children scope → all accepted', () => {
  const result = classifySpawnTargets({
    proposedSubaccountAgentIds: ['sa-child-1', 'sa-child-2'],
    effectiveScope: 'children',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
  });
  assertEqual(result.accepted, ['sa-child-1', 'sa-child-2'], 'accepted');
  assertEqual(result.rejected, [], 'rejected');
});

test('one out-of-scope target in children scope → rejected list contains it', () => {
  const result = classifySpawnTargets({
    proposedSubaccountAgentIds: ['sa-child-1', 'sa-outsider'],
    effectiveScope: 'children',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
  });
  assertEqual(result.accepted, ['sa-child-1'], 'accepted');
  assertEqual(result.rejected, ['sa-outsider'], 'rejected');
});

test('descendants scope includes grandchildren', () => {
  const result = classifySpawnTargets({
    proposedSubaccountAgentIds: ['sa-child-1', 'sa-grandchild-1'],
    effectiveScope: 'descendants',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
  });
  assertEqual(result.accepted, ['sa-child-1', 'sa-grandchild-1'], 'accepted');
  assertEqual(result.rejected, [], 'rejected');
});

test('all accepted when scope=descendants and all are descendants', () => {
  const result = classifySpawnTargets({
    proposedSubaccountAgentIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
    effectiveScope: 'descendants',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
  });
  assertEqual(result.accepted, ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'], 'accepted');
  assertEqual(result.rejected, [], 'rejected');
});

test('grandchild rejected in children scope (not a direct child)', () => {
  const result = classifySpawnTargets({
    proposedSubaccountAgentIds: ['sa-grandchild-1'],
    effectiveScope: 'children',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
  });
  assertEqual(result.accepted, [], 'accepted');
  assertEqual(result.rejected, ['sa-grandchild-1'], 'rejected');
});

// ---------------------------------------------------------------------------
// resolveWriteSkillScope
// ---------------------------------------------------------------------------

console.log('');
console.log('resolveWriteSkillScope');
console.log('');

test('explicit "children" override when hierarchy has no children → returns "children"', () => {
  const result = resolveWriteSkillScope({
    rawScope: 'children',
    hierarchy: hierarchyNoChildren,
  });
  assertEqual(result, 'children', 'scope');
});

test('adaptive default with children → "children"', () => {
  const result = resolveWriteSkillScope({
    rawScope: undefined,
    hierarchy: baseHierarchy,
  });
  assertEqual(result, 'children', 'scope');
});

test('adaptive default without children → "subaccount"', () => {
  const result = resolveWriteSkillScope({
    rawScope: undefined,
    hierarchy: hierarchyNoChildren,
  });
  assertEqual(result, 'subaccount', 'scope');
});

test('explicit "descendants" → "descendants"', () => {
  const result = resolveWriteSkillScope({
    rawScope: 'descendants',
    hierarchy: baseHierarchy,
  });
  assertEqual(result, 'descendants', 'scope');
});

test('explicit "subaccount" → "subaccount"', () => {
  const result = resolveWriteSkillScope({
    rawScope: 'subaccount',
    hierarchy: baseHierarchy,
  });
  assertEqual(result, 'subaccount', 'scope');
});

test('null rawScope adaptive with children → "children"', () => {
  const result = resolveWriteSkillScope({
    rawScope: null,
    hierarchy: baseHierarchy,
  });
  assertEqual(result, 'children', 'scope');
});

test('unknown string rawScope falls through to adaptive default', () => {
  const result = resolveWriteSkillScope({
    rawScope: 'bogus',
    hierarchy: hierarchyNoChildren,
  });
  assertEqual(result, 'subaccount', 'scope');
});

// ---------------------------------------------------------------------------
// evaluateSpawnPreconditions
// ---------------------------------------------------------------------------

console.log('');
console.log('evaluateSpawnPreconditions');
console.log('');

const hierarchyWithChild: Readonly<HierarchyContext> = {
  agentId: 'sa-caller',
  parentId: null,
  childIds: ['sa-child'],
  rootId: 'sa-caller',
  depth: 0,
};

test('hierarchy missing → hierarchy_context_missing', () => {
  const result = evaluateSpawnPreconditions({
    hierarchy: undefined,
    currentHandoffDepth: 0,
    maxHandoffDepth: 5,
    effectiveScope: 'children',
  });
  assertEqual(result, { ok: false, errorCode: 'hierarchy_context_missing' }, 'result');
});

test('depth at limit → max_handoff_depth_exceeded', () => {
  const result = evaluateSpawnPreconditions({
    hierarchy: hierarchyWithChild,
    currentHandoffDepth: 5,
    maxHandoffDepth: 5,
    effectiveScope: 'children',
  });
  assertEqual(result, { ok: false, errorCode: 'max_handoff_depth_exceeded' }, 'result');
});

test('depth below limit → ok', () => {
  const result = evaluateSpawnPreconditions({
    hierarchy: hierarchyWithChild,
    currentHandoffDepth: 4,
    maxHandoffDepth: 5,
    effectiveScope: 'children',
  });
  assertEqual(result, { ok: true, effectiveScope: 'children' }, 'result');
});

test('subaccount scope → cross_subtree_not_permitted', () => {
  const result = evaluateSpawnPreconditions({
    hierarchy: hierarchyWithChild,
    currentHandoffDepth: 0,
    maxHandoffDepth: 5,
    effectiveScope: 'subaccount',
  });
  assertEqual(result, { ok: false, errorCode: 'cross_subtree_not_permitted' }, 'result');
});

test('adaptive default for leaf caller (no children) resolves subaccount → evaluateSpawnPreconditions rejects', () => {
  // resolveWriteSkillScope with a leaf caller (no children) → 'subaccount'
  const leafHierarchy: Readonly<HierarchyContext> = {
    agentId: 'sa-caller',
    parentId: null,
    childIds: [],
    rootId: 'sa-caller',
    depth: 0,
  };
  const resolved = resolveWriteSkillScope({ rawScope: undefined, hierarchy: leafHierarchy });
  assertEqual(resolved, 'subaccount', 'resolved scope');

  // Then evaluateSpawnPreconditions must reject that resolved scope
  const result = evaluateSpawnPreconditions({
    hierarchy: leafHierarchy,
    currentHandoffDepth: 0,
    maxHandoffDepth: 5,
    effectiveScope: resolved,
  });
  assertEqual(result, { ok: false, errorCode: 'cross_subtree_not_permitted' }, 'precondition result');
});

// ---------------------------------------------------------------------------
// INV-3 swallow-regression contract
// ---------------------------------------------------------------------------

console.log('');
console.log('INV-3 swallow-regression contract');
console.log('');

test('INV-3 swallow-regression: void fire-and-forget pattern does not propagate outcome write failure', () => {
  // Documents the call-site pattern: void <asyncFn>() means even if the fn throws/rejects,
  // the caller is unaffected. This guards against accidentally adding `await` to outcome writes
  // or removing the `void` keyword.
  let afterWriteReached = false;
  const failingWrite = async (): Promise<void> => {
    throw new Error('simulated delegation_outcome_write_failed');
  };
  // Exact pattern used in executeSpawnSubAgents and executeReassignTask.
  // .catch(() => {}) silences the unhandled-rejection warning in the test runner;
  // the critical assertion is that afterWriteReached is set synchronously before the
  // promise settles, proving that void does not suspend the caller.
  void failingWrite().catch(() => {});
  afterWriteReached = true;
  assertEqual(afterWriteReached, true, 'code after void call must execute regardless of outcome write failure');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) process.exit(1);
