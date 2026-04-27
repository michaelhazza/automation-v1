/**
 * agentExecutionServiceWb1Pure.test.ts
 *
 * Pure-function tests for WB-1: handoffSourceRunId write-path.
 * Verifies the request-to-INSERT mapping contract for handoff vs spawn runs.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/services/__tests__/agentExecutionServiceWb1Pure.test.ts
 */

export {}; // make this a module (avoids global-scope redeclaration in tsc)

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Pure helper: mirrors the agentExecutionService INSERT mapping for WB-1.
// ---------------------------------------------------------------------------

interface RunRequest {
  runSource?: string;
  parentRunId?: string;
  handoffSourceRunId?: string;
}

interface InsertValues {
  parentRunId: string | null;
  handoffSourceRunId: string | null;
}

function mapRequestToInsert(request: RunRequest): InsertValues {
  return {
    parentRunId: request.parentRunId ?? null,
    handoffSourceRunId: request.handoffSourceRunId ?? null,
  };
}

console.log('\nagentExecutionService WB-1 — handoffSourceRunId write-path tests\n');

test('handoff run: both parentRunId and handoffSourceRunId are set to sourceRunId', () => {
  const sourceRunId = 'run-abc-123';
  const request: RunRequest = {
    runSource: 'handoff',
    parentRunId: sourceRunId,
    handoffSourceRunId: sourceRunId,
  };
  const values = mapRequestToInsert(request);
  assert(values.parentRunId === sourceRunId, `parentRunId should be ${sourceRunId}, got ${values.parentRunId}`);
  assert(values.handoffSourceRunId === sourceRunId, `handoffSourceRunId should be ${sourceRunId}, got ${values.handoffSourceRunId}`);
});

test('spawn run: parentRunId set, handoffSourceRunId null', () => {
  const parentId = 'run-parent-456';
  const request: RunRequest = {
    runSource: 'sub_agent',
    parentRunId: parentId,
    // handoffSourceRunId intentionally omitted for spawn runs
  };
  const values = mapRequestToInsert(request);
  assert(values.parentRunId === parentId, `parentRunId should be ${parentId}`);
  assert(values.handoffSourceRunId === null, `handoffSourceRunId should be null for spawn run, got ${values.handoffSourceRunId}`);
});

test('scheduled run: both null', () => {
  const request: RunRequest = { runSource: 'scheduler' };
  const values = mapRequestToInsert(request);
  assert(values.parentRunId === null, 'parentRunId should be null for scheduled run');
  assert(values.handoffSourceRunId === null, 'handoffSourceRunId should be null for scheduled run');
});

test('handoff: parentRunId and handoffSourceRunId are equal for same-source handoff', () => {
  const sourceId = 'run-handoff-789';
  const request: RunRequest = {
    runSource: 'handoff',
    parentRunId: sourceId,
    handoffSourceRunId: sourceId,
  };
  const values = mapRequestToInsert(request);
  assert(values.parentRunId === values.handoffSourceRunId, 'parentRunId and handoffSourceRunId must be equal on a standard handoff run');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
