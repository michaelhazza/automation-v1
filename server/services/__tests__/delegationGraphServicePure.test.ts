/**
 * delegationGraphServicePure.test.ts — spec §12.2 test cases.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/delegationGraphServicePure.test.ts
 */

import { assembleGraphPure, MAX_DEPTH_BOUND, type RunRow } from '../delegationGraphServicePure.js';

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

function assertEqual<T>(a: T, b: T, label: string) {
  const aJson = JSON.stringify(a);
  const bJson = JSON.stringify(b);
  if (aJson !== bJson) {
    throw new Error(`${label} — expected ${bJson}, got ${aJson}`);
  }
}

function assertTrue(value: boolean, label: string) {
  if (!value) throw new Error(`${label} — expected truthy, got ${String(value)}`);
}

function assertFalse(value: boolean, label: string) {
  if (value) throw new Error(`${label} — expected falsy, got ${String(value)}`);
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
  assertTrue(result.truncated, 'truncated should be true when truncated: true is passed');
});

test('truncated=false when all rows are below MAX_DEPTH_BOUND', () => {
  const root = makeRow({ runId: 'root', hierarchyDepth: 0 });
  const child = makeRow({ runId: 'child', hierarchyDepth: 1, parentRunId: 'root' });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root, child], truncated: false });
  assertFalse(result.truncated, 'truncated should be false when truncated: false is passed');
});

// ---------------------------------------------------------------------------
// Test: spawn edge
// ---------------------------------------------------------------------------

test('parentRunId pointer produces a spawn edge', () => {
  const root = makeRow({ runId: 'root' });
  const child = makeRow({ runId: 'child', parentRunId: 'root' });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root, child], truncated: false });
  const spawnEdges = result.edges.filter((e) => e.kind === 'spawn');
  assertEqual(spawnEdges.length, 1, 'spawn edge count');
  assertEqual(spawnEdges[0]!.parentRunId, 'root', 'spawn edge parentRunId');
  assertEqual(spawnEdges[0]!.childRunId, 'child', 'spawn edge childRunId');
});

// ---------------------------------------------------------------------------
// Test: handoff edge
// ---------------------------------------------------------------------------

test('handoffSourceRunId pointer produces a handoff edge', () => {
  const root = makeRow({ runId: 'root' });
  const handoffChild = makeRow({ runId: 'handoff-child', handoffSourceRunId: 'root' });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root, handoffChild], truncated: false });
  const handoffEdges = result.edges.filter((e) => e.kind === 'handoff');
  assertEqual(handoffEdges.length, 1, 'handoff edge count');
  assertEqual(handoffEdges[0]!.parentRunId, 'root', 'handoff edge parentRunId');
  assertEqual(handoffEdges[0]!.childRunId, 'handoff-child', 'handoff edge childRunId');
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
  assertEqual(dualNodes.length, 1, 'dual-parent run appears exactly once in nodes');

  const edgesToDual = result.edges.filter((e) => e.childRunId === 'dual');
  assertEqual(edgesToDual.length, 2, 'dual-parent run should have 2 inbound edges');

  const spawnToDual = edgesToDual.find((e) => e.kind === 'spawn');
  const handoffToDual = edgesToDual.find((e) => e.kind === 'handoff');
  assertTrue(!!spawnToDual, 'should have a spawn edge to dual');
  assertTrue(!!handoffToDual, 'should have a handoff edge to dual');
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
  assertEqual(childNode?.delegationDirection, 'down', 'direction should be down');
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
  assertEqual(matchingNodes.length, 1, 'dedup: shared runId appears once in nodes');
  // Last write wins — should be 'Agent B'
  assertEqual(matchingNodes[0]!.agentName, 'Agent B', 'last-write-wins for dedup');
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
  assertEqual(edgesToRoot.length, 0, 'root run has no inbound edges');
  assertEqual(result.rootRunId, 'root', 'rootRunId is correct');
});

// ---------------------------------------------------------------------------
// Test: empty graph (no children)
// ---------------------------------------------------------------------------

test('single root run — no edges, 1 node, truncated=false', () => {
  const root = makeRow({ runId: 'root', hierarchyDepth: 0 });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root], truncated: false });
  assertEqual(result.nodes.length, 1, 'nodes count for single root');
  assertEqual(result.edges.length, 0, 'no edges for single root');
  assertFalse(result.truncated, 'truncated false for single root');
});

// ---------------------------------------------------------------------------
// Test: parentRunId with isSubAgent=false does NOT produce a spawn edge
// ---------------------------------------------------------------------------

test('parentRunId with isSubAgent=false does NOT produce a spawn edge', () => {
  const root = makeRow({ runId: 'root' });
  const nonSubAgentChild = makeRow({ runId: 'child', parentRunId: 'root', isSubAgent: false });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root, nonSubAgentChild], truncated: false });
  const spawnEdges = result.edges.filter((e) => e.kind === 'spawn');
  assertEqual(spawnEdges.length, 0, 'no spawn edge when isSubAgent=false');
  assertEqual(result.nodes.length, 2, 'both nodes still present');
});

// ---------------------------------------------------------------------------
// Test: root with handoffSourceRunId does NOT produce an inbound handoff edge
// ---------------------------------------------------------------------------

test('root with handoffSourceRunId does NOT produce an inbound handoff edge', () => {
  const root = makeRow({ runId: 'root', handoffSourceRunId: 'upstream' });

  const result = assembleGraphPure({ rootRunId: 'root', rows: [root], truncated: false });
  const edgesToRoot = result.edges.filter((e) => e.childRunId === 'root');
  assertEqual(edgesToRoot.length, 0, 'no inbound edge to root');
  assertEqual(result.nodes.length, 1, 'only root node');
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
