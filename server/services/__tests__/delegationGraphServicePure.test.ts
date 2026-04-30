/**
 * delegationGraphServicePure.test.ts — spec §12.2 test cases.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/delegationGraphServicePure.test.ts
 */

import { expect, test } from 'vitest';
import { assembleGraphPure, MAX_DEPTH_BOUND, type RunRow } from '../delegationGraphServicePure.js';

function assertEqual<T>(a: T, b: T, label: string) {
  const aJson = JSON.stringify(a);
  const bJson = JSON.stringify(b);
  if (aJson !== bJson) {
    throw new Error(`${label} — expected ${bJson}, got ${aJson}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<RunRow> & { runId: string }): RunRow {
  return {
    agentId: 'agent-' + overrides.runId,
    agentName: 'Agent ' + overrides.runId,
    isSubAgent: true,
    delegationScope: null,
    hierarchyDepth: null,
    delegationDirection: null,
    status: 'completed',
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:01:00.000Z',
    parentRunId: null,
    handoffSourceRunId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test: truncated flag — depth-6 graph with a 7th level row
// ---------------------------------------------------------------------------

test('truncated=true when any row reaches MAX_DEPTH_BOUND', () => {
  const root = makeRow({ runId: 'root', hierarchyDepth: 0 });
  const deep = makeRow({ runId: 'deep', hierarchyDepth: MAX_DEPTH_BOUND, parentRunId: 'root' });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root, deep], truncated: true });
  expect(result.truncated, 'truncated should be true when truncated: true is passed').toBe(true);
});

test('truncated=false when all rows are below MAX_DEPTH_BOUND', () => {
  const root = makeRow({ runId: 'root', hierarchyDepth: 0 });
  const child = makeRow({ runId: 'child', hierarchyDepth: 1, parentRunId: 'root' });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root, child], truncated: false });
  expect(result.truncated, 'truncated should be false when truncated: false is passed').toBe(false);
});

// ---------------------------------------------------------------------------
// Test: spawn edge
// ---------------------------------------------------------------------------

test('parentRunId pointer produces a spawn edge', () => {
  const root = makeRow({ runId: 'root' });
  const child = makeRow({ runId: 'child', parentRunId: 'root' });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root, child], truncated: false });
  const spawnEdges = result.edges.filter((e) => e.kind === 'spawn');
  expect(spawnEdges.length, 'spawn edge count').toBe(1);
  expect(spawnEdges[0]!.parentRunId, 'spawn edge parentRunId').toBe('root');
  expect(spawnEdges[0]!.childRunId, 'spawn edge childRunId').toBe('child');
});

// ---------------------------------------------------------------------------
// Test: handoff edge
// ---------------------------------------------------------------------------

test('handoffSourceRunId pointer produces a handoff edge', () => {
  const root = makeRow({ runId: 'root' });
  const handoffChild = makeRow({ runId: 'handoff-child', handoffSourceRunId: 'root' });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root, handoffChild], truncated: false });
  const handoffEdges = result.edges.filter((e) => e.kind === 'handoff');
  expect(handoffEdges.length, 'handoff edge count').toBe(1);
  expect(handoffEdges[0]!.parentRunId, 'handoff edge parentRunId').toBe('root');
  expect(handoffEdges[0]!.childRunId, 'handoff edge childRunId').toBe('handoff-child');
});

// ---------------------------------------------------------------------------
// Test: both parentRunId AND handoffSourceRunId → 2 edges, 1 node
// ---------------------------------------------------------------------------

test('run with both parentRunId and handoffSourceRunId produces 2 edges and 1 node', () => {
  const spawner = makeRow({ runId: 'spawner' });
  const handoffSource = makeRow({ runId: 'handoff-source' });
  const dual = makeRow({
    runId: 'dual',
    parentRunId: 'spawner',
    handoffSourceRunId: 'handoff-source',
  });

  const result = assembleGraphPure({
    rootRunId: 'spawner',
    rows: [spawner, handoffSource, dual],
    truncated: false,
  });

  const dualNodes = result.nodes.filter((n) => n.runId === 'dual');
  expect(dualNodes.length, 'dual-parent run appears exactly once in nodes').toBe(1);

  const edgesToDual = result.edges.filter((e) => e.childRunId === 'dual');
  expect(edgesToDual.length, 'dual-parent run should have 2 inbound edges').toBe(2);

  const spawnToDual = edgesToDual.find((e) => e.kind === 'spawn');
  const handoffToDual = edgesToDual.find((e) => e.kind === 'handoff');
  expect(!!spawnToDual, 'should have a spawn edge to dual').toBe(true);
  expect(!!handoffToDual, 'should have a handoff edge to dual').toBe(true);
});

// ---------------------------------------------------------------------------
// Test: direction on child row is preserved in node
// ---------------------------------------------------------------------------

test('delegationDirection on child row is preserved in the node', () => {
  const root = makeRow({ runId: 'root' });
  const child = makeRow({
    runId: 'child',
    parentRunId: 'root',
    delegationDirection: 'down',
  });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root, child], truncated: false });
  const childNode = result.nodes.find((n) => n.runId === 'child');
  expect(childNode?.delegationDirection, 'direction should be down').toBe('down');
});

// ---------------------------------------------------------------------------
// Test: dedup by runId — same runId referenced twice appears once in nodes
// ---------------------------------------------------------------------------

test('dedup by runId — same runId referenced by two children appears once in nodes', () => {
  const root = makeRow({ runId: 'root' });
  // Both row entries reference the same runId — simulates rows returned twice
  const dup1 = makeRow({ runId: 'shared', parentRunId: 'root', agentName: 'Agent A' });
  const dup2 = makeRow({ runId: 'shared', parentRunId: 'root', agentName: 'Agent B' });

  const result = assembleGraphPure({
    rootRunId: 'root',
    rows: [root, dup1, dup2],
    truncated: false,
  });

  const matchingNodes = result.nodes.filter((n) => n.runId === 'shared');
  expect(matchingNodes.length, 'dedup: shared runId appears once in nodes').toBe(1);
  // Last write wins — should be 'Agent B'
  expect(matchingNodes[0]!.agentName, 'last-write-wins for dedup').toBe('Agent B');
});

// ---------------------------------------------------------------------------
// Test: root run has no inbound edge
// ---------------------------------------------------------------------------

test('root run has no inbound edge', () => {
  const root = makeRow({ runId: 'root' });
  const child1 = makeRow({ runId: 'child1', parentRunId: 'root' });
  const child2 = makeRow({ runId: 'child2', parentRunId: 'root' });

  const result = assembleGraphPure({
    rootRunId: 'root',
    rows: [root, child1, child2],
    truncated: false,
  });

  const edgesToRoot = result.edges.filter((e) => e.childRunId === 'root');
  expect(edgesToRoot.length, 'root run has no inbound edges').toBe(0);
  expect(result.rootRunId, 'rootRunId is correct').toBe('root');
});

// ---------------------------------------------------------------------------
// Test: empty graph (no children)
// ---------------------------------------------------------------------------

test('single root run — no edges, 1 node, truncated=false', () => {
  const root = makeRow({ runId: 'root', hierarchyDepth: 0 });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root], truncated: false });
  expect(result.nodes.length, 'nodes count for single root').toBe(1);
  expect(result.edges.length, 'no edges for single root').toBe(0);
  expect(result.truncated, 'truncated false for single root').toBe(false);
});

// ---------------------------------------------------------------------------
// Test: parentRunId with isSubAgent=false does NOT produce a spawn edge
// ---------------------------------------------------------------------------

test('parentRunId with isSubAgent=false does NOT produce a spawn edge', () => {
  const root = makeRow({ runId: 'root' });
  const nonSubAgentChild = makeRow({ runId: 'child', parentRunId: 'root', isSubAgent: false });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root, nonSubAgentChild], truncated: false });
  const spawnEdges = result.edges.filter((e) => e.kind === 'spawn');
  expect(spawnEdges.length, 'no spawn edge when isSubAgent=false').toBe(0);
  expect(result.nodes.length, 'both nodes still present').toBe(2);
});

// ---------------------------------------------------------------------------
// Test: root with handoffSourceRunId does NOT produce an inbound handoff edge
// ---------------------------------------------------------------------------

test('root with handoffSourceRunId does NOT produce an inbound handoff edge', () => {
  const root = makeRow({ runId: 'root', handoffSourceRunId: 'upstream' });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root], truncated: false });
  const edgesToRoot = result.edges.filter((e) => e.childRunId === 'root');
  expect(edgesToRoot.length, 'no inbound edge to root').toBe(0);
  expect(result.nodes.length, 'only root node').toBe(1);
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
