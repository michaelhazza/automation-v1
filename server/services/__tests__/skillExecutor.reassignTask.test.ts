/**
 * skillExecutorDelegationPure — reassign_task perspective unit tests.
 *
 * Tests computeReassignDirection and validateReassignScope.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/skillExecutor.reassignTask.test.ts
 *
 * Note on special-case ordering: the upward-escalation check (direction === 'up')
 * MUST be evaluated by the caller BEFORE validateReassignScope. The reason is
 * that validateReassignScope is scope-bound — it only passes targets that are
 * in the active scope, and a parentId target is NOT necessarily in children/descendants.
 * computeReassignDirection fires first to detect 'up'; if 'up', the caller skips
 * validateReassignScope entirely and treats the target as valid unconditionally.
 */

import { expect, test } from 'vitest';
import {
  computeReassignDirection,
  validateReassignScope,
  evaluateReassignPreconditions,
} from '../skillExecutorDelegationPure.js';
import type { HierarchyContext } from '../../../shared/types/delegation.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// computeReassignDirection
// ---------------------------------------------------------------------------

console.log('');
console.log('computeReassignDirection');
console.log('');

test('target === parentId → "up"', () => {
  const result = computeReassignDirection({
    targetSubaccountAgentId: 'sa-parent',
    parentId: 'sa-parent',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
  });
  expect(result, 'direction').toBe('up');
});

test('target in childIds → "down"', () => {
  const result = computeReassignDirection({
    targetSubaccountAgentId: 'sa-child-1',
    parentId: 'sa-parent',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
  });
  expect(result, 'direction').toBe('down');
});

test('target in descendantIds but not childIds → "down"', () => {
  const result = computeReassignDirection({
    targetSubaccountAgentId: 'sa-grandchild-1',
    parentId: 'sa-parent',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
  });
  expect(result, 'direction').toBe('down');
});

test('target is neither parent nor descendant → "lateral"', () => {
  const result = computeReassignDirection({
    targetSubaccountAgentId: 'sa-sibling',
    parentId: 'sa-parent',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
  });
  expect(result, 'direction').toBe('lateral');
});

test('parentId is null and target is in childIds → "down" (not "up")', () => {
  const result = computeReassignDirection({
    targetSubaccountAgentId: 'sa-child-1',
    parentId: null,
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2'],
  });
  expect(result, 'direction').toBe('down');
});

test('parentId is null and target is unknown → "lateral"', () => {
  const result = computeReassignDirection({
    targetSubaccountAgentId: 'sa-unknown',
    parentId: null,
    childIds: ['sa-child-1'],
    descendantIds: ['sa-child-1'],
  });
  expect(result, 'direction').toBe('lateral');
});

// ---------------------------------------------------------------------------
// validateReassignScope
// ---------------------------------------------------------------------------

console.log('');
console.log('validateReassignScope');
console.log('');

test('"children" + in childIds → valid', () => {
  const result = validateReassignScope({
    targetSubaccountAgentId: 'sa-child-1',
    effectiveScope: 'children',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
    isCallerRoot: false,
  });
  expect(result, 'result').toEqual({ valid: true });
});

test('"children" + NOT in childIds → delegation_out_of_scope', () => {
  const result = validateReassignScope({
    targetSubaccountAgentId: 'sa-grandchild-1',
    effectiveScope: 'children',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
    isCallerRoot: false,
  });
  expect(result, 'result').toEqual({ valid: false, errorCode: 'delegation_out_of_scope' });
});

test('"subaccount" + caller is root → valid', () => {
  const result = validateReassignScope({
    targetSubaccountAgentId: 'sa-any-target',
    effectiveScope: 'subaccount',
    childIds: [],
    descendantIds: [],
    isCallerRoot: true,
  });
  expect(result, 'result').toEqual({ valid: true });
});

test('"subaccount" + caller is NOT root → cross_subtree_not_permitted', () => {
  const result = validateReassignScope({
    targetSubaccountAgentId: 'sa-any-target',
    effectiveScope: 'subaccount',
    childIds: ['sa-child-1'],
    descendantIds: ['sa-child-1'],
    isCallerRoot: false,
  });
  expect(result, 'result').toEqual({ valid: false, errorCode: 'cross_subtree_not_permitted' });
});

test('"descendants" + in descendantIds → valid', () => {
  const result = validateReassignScope({
    targetSubaccountAgentId: 'sa-grandchild-1',
    effectiveScope: 'descendants',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
    isCallerRoot: false,
  });
  expect(result, 'result').toEqual({ valid: true });
});

test('"descendants" + not in descendantIds → delegation_out_of_scope', () => {
  const result = validateReassignScope({
    targetSubaccountAgentId: 'sa-outsider',
    effectiveScope: 'descendants',
    childIds: ['sa-child-1', 'sa-child-2'],
    descendantIds: ['sa-child-1', 'sa-child-2', 'sa-grandchild-1'],
    isCallerRoot: false,
  });
  expect(result, 'result').toEqual({ valid: false, errorCode: 'delegation_out_of_scope' });
});

test('upward escalation ordering — parentId target fails validateReassignScope "children"', () => {
  // This documents that the parentId target IS NOT in childIds/descendantIds.
  // The caller must check direction === "up" BEFORE calling validateReassignScope.
  // If it skips the direction check and calls validateReassignScope directly,
  // the parent target would be incorrectly rejected.
  const parentId = 'sa-parent';
  const directionResult = computeReassignDirection({
    targetSubaccountAgentId: parentId,
    parentId,
    childIds: ['sa-child-1'],
    descendantIds: ['sa-child-1'],
  });
  expect(directionResult, 'direction must be up').toBe('up');

  // If the caller naively called validateReassignScope without the direction check:
  const scopeResult = validateReassignScope({
    targetSubaccountAgentId: parentId,
    effectiveScope: 'children',
    childIds: ['sa-child-1'],
    descendantIds: ['sa-child-1'],
    isCallerRoot: false,
  });
  // Expected: rejected — confirms that upward escalation MUST be short-circuited
  // by the caller before reaching validateReassignScope.
  expect(scopeResult.valid, 'scope-only check rejects parent → proves the caller must short-circuit on direction=up').toBe(false);
});

// ---------------------------------------------------------------------------
// evaluateReassignPreconditions
// ---------------------------------------------------------------------------

console.log('');
console.log('evaluateReassignPreconditions');
console.log('');

test('hierarchy missing → hierarchy_context_missing', () => {
  const result = evaluateReassignPreconditions({ hierarchy: undefined });
  expect(result, 'result').toEqual({ ok: false, errorCode: 'hierarchy_context_missing' });
});

test('hierarchy present → ok', () => {
  const hierarchy: Readonly<HierarchyContext> = {
    agentId: 'sa-1',
    parentId: null,
    childIds: ['sa-child'],
    rootId: 'sa-1',
    depth: 0,
  };
  const result = evaluateReassignPreconditions({ hierarchy });
  expect(result, 'result').toEqual({ ok: true });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log('');
