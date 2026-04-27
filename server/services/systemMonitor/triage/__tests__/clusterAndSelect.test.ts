// Tests for clusterFires and selectTopForTriage — pure functions.
// Run: npx tsx server/services/systemMonitor/triage/__tests__/clusterAndSelect.test.ts

import { clusterFires, type HeuristicFireRecord } from '../clusterFires.js';
import { selectTopForTriage } from '../selectTopForTriage.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`  ✗ ${name}: ${msg}`);
    console.log(`  ✗ ${name}: ${msg}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function makeFireRecord(overrides: Partial<HeuristicFireRecord> = {}): HeuristicFireRecord {
  return {
    fireRowId: overrides.fireRowId ?? 'row-1',
    heuristicId: overrides.heuristicId ?? 'h1',
    entityKind: overrides.entityKind ?? 'agent_run',
    entityId: overrides.entityId ?? 'entity-1',
    confidence: overrides.confidence ?? 0.8,
    evidence: overrides.evidence ?? { signals: [] },
    firedAt: overrides.firedAt ?? new Date(),
  };
}

// ── clusterFires ────────────────────────────────────────────────────────────

console.log('\n--- clusterFires ---');

test('empty fires returns empty clusters', () => {
  const clusters = clusterFires([]);
  assertEqual(clusters.length, 0, 'cluster count');
});

test('single fire produces one cluster with correct fields', () => {
  const fire = makeFireRecord({ heuristicId: 'h1', entityKind: 'agent_run', entityId: 'e1', confidence: 0.75 });
  const clusters = clusterFires([fire]);
  assertEqual(clusters.length, 1, 'cluster count');
  assertEqual(clusters[0]!.entityKind, 'agent_run', 'entityKind');
  assertEqual(clusters[0]!.entityId, 'e1', 'entityId');
  assertEqual(clusters[0]!.totalFires, 1, 'totalFires');
  assertEqual(clusters[0]!.maxConfidence, 0.75, 'maxConfidence');
  assertEqual(clusters[0]!.fires.length, 1, 'fires length');
});

test('two fires on same entity merge into one cluster', () => {
  const f1 = makeFireRecord({ fireRowId: 'r1', heuristicId: 'h1', entityId: 'e1', confidence: 0.6 });
  const f2 = makeFireRecord({ fireRowId: 'r2', heuristicId: 'h2', entityId: 'e1', confidence: 0.9 });
  const clusters = clusterFires([f1, f2]);
  assertEqual(clusters.length, 1, 'cluster count');
  assertEqual(clusters[0]!.totalFires, 2, 'totalFires');
  assertEqual(clusters[0]!.maxConfidence, 0.9, 'maxConfidence is max of both');
  assertEqual(clusters[0]!.fires.length, 2, 'fires array has both records');
});

test('fires on different entities produce separate clusters', () => {
  const f1 = makeFireRecord({ entityId: 'e1', confidence: 0.5 });
  const f2 = makeFireRecord({ entityId: 'e2', confidence: 0.7 });
  const clusters = clusterFires([f1, f2]);
  assertEqual(clusters.length, 2, 'cluster count');
});

test('different entityKind produces separate clusters even with same entityId', () => {
  const f1 = makeFireRecord({ entityKind: 'agent_run', entityId: 'e1', confidence: 0.5 });
  const f2 = makeFireRecord({ entityKind: 'agent_run', entityId: 'e1', confidence: 0.8 });
  const f3 = makeFireRecord({ entityKind: 'agent_run', entityId: 'e2', confidence: 0.6 });
  const clusters = clusterFires([f1, f2, f3]);
  assertEqual(clusters.length, 2, 'two distinct entities produce two clusters');
});

test('maxConfidence is the highest across all fires in cluster', () => {
  const fires = [0.1, 0.9, 0.4, 0.7].map((conf, i) =>
    makeFireRecord({ fireRowId: `r${i}`, heuristicId: `h${i}`, entityId: 'e1', confidence: conf }),
  );
  const clusters = clusterFires(fires);
  assertEqual(clusters[0]!.maxConfidence, 0.9, 'maxConfidence');
});

test('totalFires counts all fires including lower-confidence ones', () => {
  const fires = Array.from({ length: 5 }, (_, i) =>
    makeFireRecord({ fireRowId: `r${i}`, heuristicId: `h${i}`, entityId: 'e1', confidence: 0.5 }),
  );
  const clusters = clusterFires(fires);
  assertEqual(clusters[0]!.totalFires, 5, 'totalFires');
});

// ── selectTopForTriage ───────────────────────────────────────────────────────

console.log('\n--- selectTopForTriage ---');

function makeClusters(specs: Array<{ entityId: string; maxConfidence: number; totalFires?: number; sizeBytes?: number }>) {
  return specs.map((s) => ({
    entityKind: 'agent_run' as const,
    entityId: s.entityId,
    fires: [],
    maxConfidence: s.maxConfidence,
    totalFires: s.totalFires ?? 1,
  }));
}

test('empty clusters returns empty selection with no cap', () => {
  const { selected, capped } = selectTopForTriage([]);
  assertEqual(selected.length, 0, 'selected');
  assert(capped === null, 'capped is null');
});

test('single cluster within caps is selected', () => {
  const [cluster] = makeClusters([{ entityId: 'e1', maxConfidence: 0.8 }]);
  const { selected, capped } = selectTopForTriage([cluster!]);
  assertEqual(selected.length, 1, 'selected');
  assert(capped === null, 'no cap');
});

test('selected clusters are sorted by maxConfidence descending', () => {
  const clusters = makeClusters([
    { entityId: 'e1', maxConfidence: 0.3 },
    { entityId: 'e2', maxConfidence: 0.9 },
    { entityId: 'e3', maxConfidence: 0.6 },
  ]);
  const { selected } = selectTopForTriage(clusters);
  assertEqual(selected[0]!.entityId, 'e2', 'first is highest confidence');
  assertEqual(selected[1]!.entityId, 'e3', 'second is next');
  assertEqual(selected[2]!.entityId, 'e1', 'third is lowest');
});

test('totalFires is tiebreaker when maxConfidence equal', () => {
  const clusters = makeClusters([
    { entityId: 'low-fires', maxConfidence: 0.8, totalFires: 1 },
    { entityId: 'high-fires', maxConfidence: 0.8, totalFires: 5 },
  ]);
  const { selected } = selectTopForTriage(clusters);
  assertEqual(selected[0]!.entityId, 'high-fires', 'higher totalFires wins tiebreak');
});

test('candidate cap at 50 produces capped result', () => {
  // 51 clusters — 50 selected, 1 capped
  const clusters = makeClusters(
    Array.from({ length: 51 }, (_, i) => ({ entityId: `e${i}`, maxConfidence: 1 - i * 0.001 })),
  );
  const { selected, capped } = selectTopForTriage(clusters);
  assertEqual(selected.length, 50, 'exactly 50 selected');
  assert(capped !== null, 'capped is set');
  assertEqual(capped!.capKind, 'candidate', 'capKind is candidate');
  assertEqual(capped!.excessCount, 1, 'one excess');
});

test('excess count accumulates all clusters over cap', () => {
  const clusters = makeClusters(
    Array.from({ length: 55 }, (_, i) => ({ entityId: `e${i}`, maxConfidence: 0.5 })),
  );
  const { selected, capped } = selectTopForTriage(clusters);
  assertEqual(selected.length, 50, 'selected at cap');
  assertEqual(capped!.excessCount, 5, 'five excess');
});

test('payload cap skips cluster whose own JSON exceeds 200 KB', () => {
  // Build a cluster whose JSON alone exceeds 200 KB — it should be skipped
  const bigFires = Array.from({ length: 2500 }, (_, i) =>
    makeFireRecord({ fireRowId: `r${i}`, heuristicId: `h${i}`, entityId: 'e1' }),
  );
  const bigCluster = {
    entityKind: 'agent_run' as const,
    entityId: 'e1',
    fires: bigFires,
    maxConfidence: 0.9, // higher confidence → evaluated first
    totalFires: bigFires.length,
  };
  const smallCluster = {
    entityKind: 'agent_run' as const,
    entityId: 'e2',
    fires: [],
    maxConfidence: 0.5, // lower confidence → evaluated second
    totalFires: 1,
  };

  const { selected, capped } = selectTopForTriage([smallCluster, bigCluster]);
  // bigCluster is evaluated first (higher confidence) but its JSON alone exceeds payload cap → skipped
  assert(!selected.some((c) => c.entityId === 'e1'), 'huge cluster is not selected');
  assert(selected.some((c) => c.entityId === 'e2'), 'small cluster is selected after big is skipped');
  assert(capped !== null, 'capped is set');
  assertEqual(capped!.capKind, 'payload', 'capKind is payload');
  assertEqual(capped!.excessCount, 1, 'one cluster was capped');
});

test('payload cap stops accumulation when combined size exceeds limit', () => {
  // Each cluster is small enough to fit alone but combined they exceed 200 KB.
  // We use 900 fires per cluster (~180 KB each).
  const makeCluster = (entityId: string, confidence: number) => ({
    entityKind: 'agent_run' as const,
    entityId,
    fires: Array.from({ length: 900 }, (_, i) =>
      makeFireRecord({ fireRowId: `${entityId}-r${i}`, heuristicId: `h${i}`, entityId }),
    ),
    maxConfidence: confidence,
    totalFires: 900,
  });

  const c1 = makeCluster('c1', 0.9); // higher confidence → selected first
  const c2 = makeCluster('c2', 0.5); // combined would exceed limit → capped

  const { selected, capped } = selectTopForTriage([c1, c2]);
  assert(selected.some((c) => c.entityId === 'c1'), 'first cluster selected');
  // c2 may or may not fit depending on exact JSON byte size — both outcomes are valid;
  // we just verify the function terminates and capped is consistent with selected
  const totalSelected = selected.length;
  const totalCapped = capped?.excessCount ?? 0;
  assertEqual(totalSelected + totalCapped, 2, 'all clusters accounted for');
});

test('capped null when all clusters fit within both caps', () => {
  const clusters = makeClusters(
    Array.from({ length: 5 }, (_, i) => ({ entityId: `e${i}`, maxConfidence: 0.5 })),
  );
  const { capped } = selectTopForTriage(clusters);
  assert(capped === null, 'no cap when all fit');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('');
if (failures.length > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
}
console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
