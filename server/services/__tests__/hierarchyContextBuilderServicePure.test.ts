/**
 * hierarchyContextBuilderServicePure.test.ts — Pure unit tests for hierarchy context builder.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/hierarchyContextBuilderServicePure.test.ts
 *
 * Tests cover:
 *   - Root agent: parentId = null, depth = 0, rootId === agentId, childIds populated
 *   - Middle manager: parentId set, childIds populated, depth = 1
 *   - Leaf worker: childIds = [], depth = 2
 *   - Deterministic childIds: two calls with same input produce identical order
 *   - cycle_detected throws when roster has a cycle
 *   - depth_exceeded throws when path is > MAX_HIERARCHY_DEPTH deep
 *   - agent_not_in_subaccount throws when agentId not in roster
 *   - Root's childIds include all agents with parentSubaccountAgentId === rootId
 */

import { expect, test } from 'vitest';
import {
  buildHierarchyContextPure,
  HierarchyContextBuildError,
  MAX_HIERARCHY_DEPTH,
  type RosterRow,
} from '../hierarchyContextBuilderServicePure.js';

// ---------------------------------------------------------------------------
// Minimal test harness (tsx-compatible, no external deps)
// ---------------------------------------------------------------------------

function assertEqual<T>(a: T, b: T, label: string) {
  if (a !== b) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function assertDeepEqual<T>(a: T, b: T, label: string) {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs) {
    throw new Error(`${label} — expected ${bs}, got ${as}`);
  }
}

function assertThrowsWithCode(fn: () => void, expectedCode: string, label: string) {
  try {
    fn();
    throw new Error(`${label} — expected to throw but did not`);
  } catch (err) {
    if (err instanceof Error && err.message === `${label} — expected to throw but did not`) {
      throw err;
    }
    if (!(err instanceof HierarchyContextBuildError)) {
      throw new Error(`${label} — expected HierarchyContextBuildError, got: ${err instanceof Error ? err.constructor.name : String(err)}`);
    }
    if (err.code !== expectedCode) {
      throw new Error(`${label} — expected code "${expectedCode}", got "${err.code}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Three-level hierarchy:
//   root (id: 'sa-root', parent: null)
//     ├── manager (id: 'sa-mgr', parent: 'sa-root')
//     │     ├── worker-a (id: 'sa-wkr-a', parent: 'sa-mgr')
//     │     └── worker-b (id: 'sa-wkr-b', parent: 'sa-mgr')
//     └── sidecar (id: 'sa-side', parent: 'sa-root')

const baseRoster: RosterRow[] = [
  { id: 'sa-root',  parentSubaccountAgentId: null },
  { id: 'sa-mgr',   parentSubaccountAgentId: 'sa-root' },
  { id: 'sa-wkr-a', parentSubaccountAgentId: 'sa-mgr' },
  { id: 'sa-wkr-b', parentSubaccountAgentId: 'sa-mgr' },
  { id: 'sa-side',  parentSubaccountAgentId: 'sa-root' },
];

// ---------------------------------------------------------------------------
// Root agent
// ---------------------------------------------------------------------------

test('root agent: parentId is null', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-root', agents: baseRoster });
  expect(ctx.parentId, 'root.parentId').toBe(null);
});

test('root agent: depth is 0', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-root', agents: baseRoster });
  expect(ctx.depth, 'root.depth').toBe(0);
});

test('root agent: rootId equals agentId', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-root', agents: baseRoster });
  expect(ctx.rootId, 'root.rootId').toBe('sa-root');
});

test('root agent: childIds includes direct children only', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-root', agents: baseRoster });
  // sa-mgr and sa-side are direct children; workers are grandchildren, not included
  expect(ctx.childIds.sort(), 'root.childIds').toStrictEqual(['sa-mgr', 'sa-side']);
});

// ---------------------------------------------------------------------------
// Middle manager
// ---------------------------------------------------------------------------

test('middle manager: parentId is root', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-mgr', agents: baseRoster });
  expect(ctx.parentId, 'manager.parentId').toBe('sa-root');
});

test('middle manager: depth is 1', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-mgr', agents: baseRoster });
  expect(ctx.depth, 'manager.depth').toBe(1);
});

test('middle manager: rootId is root', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-mgr', agents: baseRoster });
  expect(ctx.rootId, 'manager.rootId').toBe('sa-root');
});

test('middle manager: childIds populated with direct children', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-mgr', agents: baseRoster });
  expect(ctx.childIds.sort(), 'manager.childIds').toStrictEqual(['sa-wkr-a', 'sa-wkr-b']);
});

// ---------------------------------------------------------------------------
// Leaf worker
// ---------------------------------------------------------------------------

test('leaf worker: childIds is empty', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-wkr-a', agents: baseRoster });
  expect(ctx.childIds, 'leaf.childIds').toStrictEqual([]);
});

test('leaf worker: depth is 2', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-wkr-a', agents: baseRoster });
  expect(ctx.depth, 'leaf.depth').toBe(2);
});

test('leaf worker: rootId is root', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-wkr-a', agents: baseRoster });
  expect(ctx.rootId, 'leaf.rootId').toBe('sa-root');
});

test('leaf worker: parentId is manager', () => {
  const ctx = buildHierarchyContextPure({ agentId: 'sa-wkr-a', agents: baseRoster });
  expect(ctx.parentId, 'leaf.parentId').toBe('sa-mgr');
});

// ---------------------------------------------------------------------------
// Determinism — childIds order is stable across repeated calls
// ---------------------------------------------------------------------------

test('deterministic childIds: two calls return same order', () => {
  const call1 = buildHierarchyContextPure({ agentId: 'sa-mgr', agents: baseRoster });
  const call2 = buildHierarchyContextPure({ agentId: 'sa-mgr', agents: baseRoster });
  expect(call1.childIds, 'childIds determinism').toStrictEqual(call2.childIds);
});

test('deterministic childIds: order is ascending regardless of roster input order', () => {
  // Reversed roster order should still produce sorted childIds
  const reversed = [...baseRoster].reverse();
  const ctx = buildHierarchyContextPure({ agentId: 'sa-mgr', agents: reversed });
  expect(ctx.childIds, 'childIds sorted asc').toStrictEqual(['sa-wkr-a', 'sa-wkr-b']);
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

test('agent_not_in_subaccount: throws when agentId not in roster', () => {
  assertThrowsWithCode(
    () => buildHierarchyContextPure({ agentId: 'sa-ghost', agents: baseRoster }),
    'agent_not_in_subaccount',
    'ghost-agent',
  );
});

test('agent_not_in_subaccount: throws on empty roster', () => {
  assertThrowsWithCode(
    () => buildHierarchyContextPure({ agentId: 'sa-any', agents: [] }),
    'agent_not_in_subaccount',
    'empty-roster',
  );
});

test('cycle_detected: throws when roster has a two-node cycle', () => {
  const cyclicRoster: RosterRow[] = [
    { id: 'sa-a', parentSubaccountAgentId: 'sa-b' },
    { id: 'sa-b', parentSubaccountAgentId: 'sa-a' },
  ];
  assertThrowsWithCode(
    () => buildHierarchyContextPure({ agentId: 'sa-a', agents: cyclicRoster }),
    'cycle_detected',
    'two-node-cycle',
  );
});

test('cycle_detected: throws when roster has a self-loop', () => {
  const selfLoopRoster: RosterRow[] = [
    { id: 'sa-self', parentSubaccountAgentId: 'sa-self' },
  ];
  assertThrowsWithCode(
    () => buildHierarchyContextPure({ agentId: 'sa-self', agents: selfLoopRoster }),
    'cycle_detected',
    'self-loop',
  );
});

test('depth_exceeded: throws when chain is deeper than MAX_HIERARCHY_DEPTH', () => {
  // Build a chain of MAX_HIERARCHY_DEPTH + 2 nodes (index 0 is root, last is leaf)
  const deepChain: RosterRow[] = [];
  for (let i = 0; i <= MAX_HIERARCHY_DEPTH + 1; i++) {
    deepChain.push({
      id: `sa-node-${i}`,
      parentSubaccountAgentId: i === 0 ? null : `sa-node-${i - 1}`,
    });
  }
  // The deepest node is at depth MAX_HIERARCHY_DEPTH + 1
  const deepestId = `sa-node-${MAX_HIERARCHY_DEPTH + 1}`;
  assertThrowsWithCode(
    () => buildHierarchyContextPure({ agentId: deepestId, agents: deepChain }),
    'depth_exceeded',
    'depth-exceeded',
  );
});

test('depth of exactly MAX_HIERARCHY_DEPTH does not throw', () => {
  // Build chain of MAX_HIERARCHY_DEPTH + 1 nodes (leaf is at depth MAX_HIERARCHY_DEPTH)
  const chain: RosterRow[] = [];
  for (let i = 0; i <= MAX_HIERARCHY_DEPTH; i++) {
    chain.push({
      id: `sa-node-${i}`,
      parentSubaccountAgentId: i === 0 ? null : `sa-node-${i - 1}`,
    });
  }
  const leafId = `sa-node-${MAX_HIERARCHY_DEPTH}`;
  const ctx = buildHierarchyContextPure({ agentId: leafId, agents: chain });
  expect(ctx.depth, 'max-depth boundary').toEqual(MAX_HIERARCHY_DEPTH);
});

// ---------------------------------------------------------------------------
// Orphaned parent — parent id referenced but not present in roster
// ---------------------------------------------------------------------------

test('orphaned parent: walk terminates at caller when parent is not in roster', () => {
  // Policy: when the upward walk encounters a parentSubaccountAgentId that is not
  // present in the roster (e.g. the parent row is inactive and was filtered out),
  // the walk stops and the last successfully resolved node (the caller itself)
  // becomes rootId.  parentId is still preserved from the caller's own row so
  // the reference is not silently lost — callers can see the dangling pointer.
  const orphanedRoster: RosterRow[] = [
    { id: 'sa-caller', parentSubaccountAgentId: 'sa-missing' },
    // 'sa-missing' is intentionally absent (inactive / filtered out)
  ];
  const ctx = buildHierarchyContextPure({ agentId: 'sa-caller', agents: orphanedRoster });
  expect(ctx.rootId, 'orphan.rootId — caller is its own root').toBe('sa-caller');
  expect(ctx.depth, 'orphan.depth — no hops resolved').toBe(0);
  expect(ctx.parentId, 'orphan.parentId — dangling reference preserved').toBe('sa-missing');
  expect(ctx.childIds, 'orphan.childIds — no children').toStrictEqual([]);
});

// ---------------------------------------------------------------------------
// Root childIds completeness
// ---------------------------------------------------------------------------

test('root childIds includes all agents with parentSubaccountAgentId === rootId', () => {
  // Add another direct child to the root to confirm all are captured
  const extendedRoster: RosterRow[] = [
    ...baseRoster,
    { id: 'sa-extra', parentSubaccountAgentId: 'sa-root' },
  ];
  const ctx = buildHierarchyContextPure({ agentId: 'sa-root', agents: extendedRoster });
  expect(ctx.childIds.sort(), 'root.childIds extended').toStrictEqual(['sa-extra', 'sa-mgr', 'sa-side']);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
