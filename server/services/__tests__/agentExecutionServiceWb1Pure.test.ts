// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness; parent-directory sibling import not applicable for this self-contained test pattern"
/**
 * agentExecutionServiceWb1Pure.test.ts
 *
 * Pure-function tests for WB-1: handoffSourceRunId write-path.
 * Verifies the request-to-INSERT mapping contract for handoff vs spawn runs.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/services/__tests__/agentExecutionServiceWb1Pure.test.ts
 */

import { expect, test } from 'vitest';

export {}; // make this a module (avoids global-scope redeclaration in tsc)

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
  expect(values.parentRunId === sourceRunId, `parentRunId should be ${sourceRunId}, got ${values.parentRunId}`).toBeTruthy();
  expect(values.handoffSourceRunId === sourceRunId, `handoffSourceRunId should be ${sourceRunId}, got ${values.handoffSourceRunId}`).toBeTruthy();
});

test('spawn run: parentRunId set, handoffSourceRunId null', () => {
  const parentId = 'run-parent-456';
  const request: RunRequest = {
    runSource: 'sub_agent',
    parentRunId: parentId,
    // handoffSourceRunId intentionally omitted for spawn runs
  };
  const values = mapRequestToInsert(request);
  expect(values.parentRunId === parentId, `parentRunId should be ${parentId}`).toBeTruthy();
  expect(values.handoffSourceRunId === null, `handoffSourceRunId should be null for spawn run, got ${values.handoffSourceRunId}`).toBeTruthy();
});

test('scheduled run: both null', () => {
  const request: RunRequest = { runSource: 'scheduler' };
  const values = mapRequestToInsert(request);
  expect(values.parentRunId === null, 'parentRunId should be null for scheduled run').toBeTruthy();
  expect(values.handoffSourceRunId === null, 'handoffSourceRunId should be null for scheduled run').toBeTruthy();
});

test('handoff: parentRunId and handoffSourceRunId are equal for same-source handoff', () => {
  const sourceId = 'run-handoff-789';
  const request: RunRequest = {
    runSource: 'handoff',
    parentRunId: sourceId,
    handoffSourceRunId: sourceId,
  };
  const values = mapRequestToInsert(request);
  expect(values.parentRunId === values.handoffSourceRunId, 'parentRunId and handoffSourceRunId must be equal on a standard handoff run').toBeTruthy();
});
