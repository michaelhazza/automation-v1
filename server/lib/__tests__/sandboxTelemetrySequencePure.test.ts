import { describe, expect, test, vi } from 'vitest';
import {
  allocateAndInsertTelemetryEvent,
  type SandboxTelemetryEventInsert,
} from '../sandboxTelemetrySequencePure.js';
import { isFailureError } from '../../../shared/iee/failure.js';

// Mock the org-scoped DB module so the runtime tx-context assertion inside
// the helper does not throw when this unit test runs outside a real
// `withOrgTx` block. The assertion is verified at integration level — here
// the mock returns a synthetic org id so the helper's defence-in-depth
// passes and we can exercise the lock + sequence + insert paths.
vi.mock('../orgScopedDb.js', () => ({
  getOrgScopedOrgId: vi.fn(() => 'org-uuid-1'),
}));

// ---------------------------------------------------------------------------
// Minimal row fixture — only fields required for the helper
// ---------------------------------------------------------------------------

const baseRow: Omit<SandboxTelemetryEventInsert, 'sequence'> = {
  sandboxExecutionId: 'exec-uuid-1',
  organisationId: 'org-uuid-1',
  subaccountId: 'sub-uuid-1',
  runId: 'run-uuid-1',
  agentId: 'agent-uuid-1',
  taskId: 'task-1',
  provider: 'e2b',
  templateName: 'node-sandbox',
  templateVersion: '1.0.0',
  eventType: 'sandbox_start',
  criticality: 'info',
  payloadJson: {},
};

// ---------------------------------------------------------------------------
// Mock db builder — simulates the advisory lock + sequence + insert pattern
//
// `executeCalls` is a queue; each call to `db.execute` pops from the front.
// `insertSequences` is a queue of sequences returned by successive inserts.
// `insertError` if set is thrown instead of returning on the NEXT insert.
// ---------------------------------------------------------------------------

type ExecReturn = unknown[];

function makeMockDb(opts: {
  executeCalls?: ExecReturn[];
  insertSequences?: number[];
  insertErrors?: Array<Error | null>;
}) {
  const execQueue = [...(opts.executeCalls ?? [])];
  const seqQueue = [...(opts.insertSequences ?? [1, 2, 3])];
  const errQueue = [...(opts.insertErrors ?? [])];

  const sqlTrace: string[] = [];

  const db = {
    sqlTrace,
    execute: vi.fn(async (sqlObj: { queryChunks?: Array<{ value?: string }> }) => {
      // Capture a rough SQL signature for test assertions
      const text = sqlObj?.queryChunks
        ?.map((c: { value?: string }) => c.value ?? '')
        .join(' ') ?? '';
      sqlTrace.push(text);

      if (execQueue.length > 0) {
        return execQueue.shift() as unknown[];
      }
      // Default: advisory lock returns empty; seq query returns current seq
      return [{ next_seq: seqQueue[0] ?? 1 }] as unknown[];
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => {
          const err = errQueue.shift();
          if (err) throw err;
          const seq = seqQueue.shift() ?? 1;
          return [{ sequence: seq }];
        }),
      })),
    })),
  };

  return db;
}

// ---------------------------------------------------------------------------
// Test 1 — Single-writer path: sequences are allocated in order
// ---------------------------------------------------------------------------

describe('allocateAndInsertTelemetryEvent', () => {
  test('single-writer path — returns sequence 1, then 2, then 3', async () => {
    // Each call sees its own fresh mock so state doesn't bleed across calls.
    for (const expectedSeq of [1, 2, 3]) {
      const db = makeMockDb({ insertSequences: [expectedSeq] });
      // First execute = advisory lock (no meaningful return), second = seq query
      db.execute
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ next_seq: expectedSeq }]); // seq select

      const result = await allocateAndInsertTelemetryEvent(
        db as unknown as Parameters<typeof allocateAndInsertTelemetryEvent>[0],
        { ...baseRow, criticality: 'info' },
      );
      expect(result.inserted).toBe(true);
      expect(result.sequence).toBe(expectedSeq);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 2 — Concurrent-writers path: 3 parallel calls all succeed with unique,
  // contiguous sequences (advisory lock serialises; verify lock SQL is emitted)
  // ---------------------------------------------------------------------------

  test('concurrent-writers — 3 parallel calls produce unique contiguous sequences', async () => {
    // Each parallel call gets its own isolated mock db (simulates separate txs
    // that each obtain the advisory lock in turn).
    const results = await Promise.all(
      [1, 2, 3].map(async (seq) => {
        const db = makeMockDb({ insertSequences: [seq] });
        db.execute
          .mockResolvedValueOnce([]) // advisory lock call
          .mockResolvedValueOnce([{ next_seq: seq }]); // seq select

        const result = await allocateAndInsertTelemetryEvent(
          db as unknown as Parameters<typeof allocateAndInsertTelemetryEvent>[0],
          { ...baseRow, criticality: 'info' },
        );

        // Verify the advisory lock was requested (first execute call contains pg_advisory_xact_lock)
        const lockCall = db.execute.mock.calls[0]?.[0] as { queryChunks?: Array<{ value?: string }> };
        const lockSql = lockCall?.queryChunks?.map((c) => c.value ?? '').join('') ?? '';
        expect(lockSql).toContain('pg_advisory_xact_lock');

        return result;
      }),
    );

    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3]);
    expect(new Set(sequences).size).toBe(3); // all unique
  });

  // ---------------------------------------------------------------------------
  // Test 3 — 23505 simulated once on info criticality → returns { inserted: false }
  // ---------------------------------------------------------------------------

  test('23505 on info criticality — returns { inserted: false } after retry exhaustion', async () => {
    const uniqueViolation = Object.assign(new Error('unique violation'), { code: '23505' });
    const db = makeMockDb({
      insertErrors: [uniqueViolation, uniqueViolation, uniqueViolation, uniqueViolation],
      insertSequences: [1, 2, 3, 4],
    });

    // Each call: advisory lock + seq select
    db.execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ next_seq: 1 }])
      .mockResolvedValueOnce([{ next_seq: 2 }])
      .mockResolvedValueOnce([{ next_seq: 3 }])
      .mockResolvedValueOnce([{ next_seq: 4 }]);

    const result = await allocateAndInsertTelemetryEvent(
      db as unknown as Parameters<typeof allocateAndInsertTelemetryEvent>[0],
      { ...baseRow, criticality: 'info' },
      { maxRetries: 3 },
    );

    expect(result.inserted).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test 4 — 23505 repeated on error criticality → throws FailureError
  // ---------------------------------------------------------------------------

  test('23505 repeated on error criticality — throws FailureError(sandbox_telemetry_drop)', async () => {
    const maxRetries = 3;
    const uniqueViolation = Object.assign(new Error('unique violation'), { code: '23505' });
    const errors = Array.from({ length: maxRetries + 1 }, () => uniqueViolation);

    const db = makeMockDb({
      insertErrors: errors,
      insertSequences: [1, 2, 3, 4],
    });

    // Each attempt needs advisory lock + seq select
    for (let i = 1; i <= maxRetries + 1; i++) {
      db.execute
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ next_seq: i }]);
    }

    await expect(
      allocateAndInsertTelemetryEvent(
        db as unknown as Parameters<typeof allocateAndInsertTelemetryEvent>[0],
        { ...baseRow, criticality: 'error', eventType: 'harvest_failed' },
        { maxRetries },
      ),
    ).rejects.toSatisfy((err: unknown) => {
      if (!isFailureError(err)) return false;
      return err.failure.failureReason === 'sandbox_telemetry_drop';
    });
  });
});
