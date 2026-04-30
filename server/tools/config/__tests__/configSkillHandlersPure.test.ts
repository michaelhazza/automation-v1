/**
 * Tests for configSkillHandlersPure.ts
 * Run with: npx tsx server/tools/config/__tests__/configSkillHandlersPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  computeDescendantIds,
  mapSubaccountAgentIdsToAgentIds,
  resolveEffectiveScope,
  type RosterEntry,
} from '../configSkillHandlersPure.js';
import type { HierarchyContext } from '../../../../shared/types/delegation.js';

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

function assertDeepEqual<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message}\n  Expected: ${e}\n  Actual:   ${a}`);
  }
}

// ---------------------------------------------------------------------------
// computeDescendantIds tests
// ---------------------------------------------------------------------------

const leaf: RosterEntry = { subaccountAgentId: 'sa-leaf', agentId: 'a-leaf', parentSubaccountAgentId: 'sa-parent' };
const parent: RosterEntry = { subaccountAgentId: 'sa-parent', agentId: 'a-parent', parentSubaccountAgentId: 'sa-root' };
const sibling: RosterEntry = { subaccountAgentId: 'sa-sibling', agentId: 'a-sibling', parentSubaccountAgentId: 'sa-root' };
const root: RosterEntry = { subaccountAgentId: 'sa-root', agentId: 'a-root', parentSubaccountAgentId: null };
const grandchild1: RosterEntry = { subaccountAgentId: 'sa-gc1', agentId: 'a-gc1', parentSubaccountAgentId: 'sa-child1' };
const grandchild2: RosterEntry = { subaccountAgentId: 'sa-gc2', agentId: 'a-gc2', parentSubaccountAgentId: 'sa-child2' };
const child1: RosterEntry = { subaccountAgentId: 'sa-child1', agentId: 'a-child1', parentSubaccountAgentId: 'sa-gp' };
const child2: RosterEntry = { subaccountAgentId: 'sa-child2', agentId: 'a-child2', parentSubaccountAgentId: 'sa-gp' };
const grandparent: RosterEntry = { subaccountAgentId: 'sa-gp', agentId: 'a-gp', parentSubaccountAgentId: null };

await test('computeDescendantIds: caller is leaf → empty result', () => {
  const roster = [leaf, parent, root];
  const result = computeDescendantIds({ callerSubaccountAgentId: 'sa-leaf', roster });
  expect(result, 'leaf has no children').toStrictEqual([]);
});

await test('computeDescendantIds: caller is parent of 2 children → returns 2 children', () => {
  const c1: RosterEntry = { subaccountAgentId: 'sa-c1', agentId: 'a-c1', parentSubaccountAgentId: 'sa-p' };
  const c2: RosterEntry = { subaccountAgentId: 'sa-c2', agentId: 'a-c2', parentSubaccountAgentId: 'sa-p' };
  const p: RosterEntry = { subaccountAgentId: 'sa-p', agentId: 'a-p', parentSubaccountAgentId: null };
  const roster = [p, c1, c2];
  const result = computeDescendantIds({ callerSubaccountAgentId: 'sa-p', roster });
  expect(result.length === 2, 'should have 2 descendants').toBeTruthy();
  expect(result.includes('sa-c1'), 'should include sa-c1').toBeTruthy();
  expect(result.includes('sa-c2'), 'should include sa-c2').toBeTruthy();
});

await test('computeDescendantIds: grandparent → returns children + grandchildren (4 total)', () => {
  const roster = [grandparent, child1, child2, grandchild1, grandchild2];
  const result = computeDescendantIds({ callerSubaccountAgentId: 'sa-gp', roster });
  expect(result.length === 4, `should have 4 descendants, got ${result.length}`).toBeTruthy();
  expect(result.includes('sa-child1'), 'should include sa-child1').toBeTruthy();
  expect(result.includes('sa-child2'), 'should include sa-child2').toBeTruthy();
  expect(result.includes('sa-gc1'), 'should include sa-gc1').toBeTruthy();
  expect(result.includes('sa-gc2'), 'should include sa-gc2').toBeTruthy();
});

await test('computeDescendantIds: cycle-safe (roster has a cycle → terminates without infinite loop)', () => {
  // Introduce a cycle: sa-a → sa-b → sa-c → sa-a
  const cycleRoster: RosterEntry[] = [
    { subaccountAgentId: 'sa-a', agentId: 'a-a', parentSubaccountAgentId: 'sa-c' },
    { subaccountAgentId: 'sa-b', agentId: 'a-b', parentSubaccountAgentId: 'sa-a' },
    { subaccountAgentId: 'sa-c', agentId: 'a-c', parentSubaccountAgentId: 'sa-b' },
  ];
  // Should not throw or loop forever; just return whatever descendants it finds before cycle detection
  const result = computeDescendantIds({ callerSubaccountAgentId: 'sa-a', roster: cycleRoster });
  // sa-b and sa-c are reachable before the cycle is detected
  expect(Array.isArray(result), 'result should be an array').toBeTruthy();
  expect(result.includes('sa-b'), 'should include sa-b').toBeTruthy();
  expect(result.includes('sa-c'), 'should include sa-c').toBeTruthy();
  // caller sa-a must NOT appear in descendants
  expect(!result.includes('sa-a'), 'caller must not appear in descendants').toBeTruthy();
});

await test('computeDescendantIds: caller not found in roster → empty result', () => {
  const roster = [root, leaf];
  const result = computeDescendantIds({ callerSubaccountAgentId: 'sa-nonexistent', roster });
  expect(result, 'nonexistent caller has no children').toStrictEqual([]);
});

// ---------------------------------------------------------------------------
// mapSubaccountAgentIdsToAgentIds tests
// ---------------------------------------------------------------------------

await test('mapSubaccountAgentIdsToAgentIds: maps correctly', () => {
  const roster: RosterEntry[] = [
    { subaccountAgentId: 'sa-1', agentId: 'agent-1', parentSubaccountAgentId: null },
    { subaccountAgentId: 'sa-2', agentId: 'agent-2', parentSubaccountAgentId: 'sa-1' },
    { subaccountAgentId: 'sa-3', agentId: 'agent-3', parentSubaccountAgentId: 'sa-1' },
  ];
  const result = mapSubaccountAgentIdsToAgentIds({ subaccountAgentIds: ['sa-1', 'sa-3'], roster });
  expect(result.length === 2, 'should return 2 agentIds').toBeTruthy();
  expect(result.includes('agent-1'), 'should include agent-1').toBeTruthy();
  expect(result.includes('agent-3'), 'should include agent-3').toBeTruthy();
  expect(!result.includes('agent-2'), 'should not include agent-2').toBeTruthy();
});

await test('mapSubaccountAgentIdsToAgentIds: unmapped ids are dropped', () => {
  const roster: RosterEntry[] = [
    { subaccountAgentId: 'sa-1', agentId: 'agent-1', parentSubaccountAgentId: null },
  ];
  const result = mapSubaccountAgentIdsToAgentIds({
    subaccountAgentIds: ['sa-1', 'sa-unknown'],
    roster,
  });
  expect(result.length === 1, 'should return only 1 agentId (unknown dropped)').toBeTruthy();
  expect(result[0] === 'agent-1', 'should be agent-1').toBeTruthy();
});

await test('mapSubaccountAgentIdsToAgentIds: empty input → empty result', () => {
  const roster: RosterEntry[] = [
    { subaccountAgentId: 'sa-1', agentId: 'agent-1', parentSubaccountAgentId: null },
  ];
  const result = mapSubaccountAgentIdsToAgentIds({ subaccountAgentIds: [], roster });
  expect(result, 'empty subaccountAgentIds → empty result').toStrictEqual([]);
});

// ---------------------------------------------------------------------------
// resolveEffectiveScope tests
// ---------------------------------------------------------------------------

const hierarchyNoChildren: HierarchyContext = {
  agentId: 'sa-caller',
  parentId: 'sa-parent',
  childIds: [],
  rootId: 'sa-root',
  depth: 1,
};

const hierarchyWithChildren: HierarchyContext = {
  agentId: 'sa-caller',
  parentId: 'sa-parent',
  childIds: ['sa-1'],
  rootId: 'sa-root',
  depth: 1,
};

await test('resolveEffectiveScope: explicit override — children scope (beats adaptive)', () => {
  // rawScope = 'children', hierarchy has no children → override wins
  const result = resolveEffectiveScope({ rawScope: 'children', hierarchy: hierarchyNoChildren });
  expect(result === 'children', `expected 'children', got '${result}'`).toBeTruthy();
});

await test('resolveEffectiveScope: explicit override — descendants scope', () => {
  const result = resolveEffectiveScope({ rawScope: 'descendants', hierarchy: hierarchyWithChildren });
  expect(result === 'descendants', `expected 'descendants', got '${result}'`).toBeTruthy();
});

await test('resolveEffectiveScope: explicit override — subaccount scope (beats adaptive with children)', () => {
  // hierarchy has children but explicit override is 'subaccount'
  const result = resolveEffectiveScope({ rawScope: 'subaccount', hierarchy: hierarchyWithChildren });
  expect(result === 'subaccount', `expected 'subaccount', got '${result}'`).toBeTruthy();
});

await test('resolveEffectiveScope: adaptive default — has children → returns children', () => {
  const result = resolveEffectiveScope({ rawScope: undefined, hierarchy: hierarchyWithChildren });
  expect(result === 'children', `expected 'children', got '${result}'`).toBeTruthy();
});

await test('resolveEffectiveScope: adaptive default — no children → returns subaccount', () => {
  const result = resolveEffectiveScope({ rawScope: undefined, hierarchy: hierarchyNoChildren });
  expect(result === 'subaccount', `expected 'subaccount', got '${result}'`).toBeTruthy();
});

await test('resolveEffectiveScope: fallthrough — missing hierarchy → returns subaccount', () => {
  const result = resolveEffectiveScope({ rawScope: undefined, hierarchy: undefined });
  expect(result === 'subaccount', `expected 'subaccount', got '${result}'`).toBeTruthy();
});

await test('resolveEffectiveScope: invalid rawScope treated as no scope → adaptive (children present → children)', () => {
  const result = resolveEffectiveScope({ rawScope: 'invalid-value', hierarchy: hierarchyWithChildren });
  expect(result === 'children', `expected 'children', got '${result}'`).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
