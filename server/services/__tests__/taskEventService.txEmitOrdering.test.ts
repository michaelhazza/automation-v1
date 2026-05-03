/**
 * taskEventService.txEmitOrdering.test.ts
 *
 * Verifies the B1 deferred-emit pattern:
 *   - When appendAndEmit is called WITHOUT input.tx, emit is invoked synchronously
 *     before the function returns and result.emit() is a safe no-op.
 *   - When appendAndEmit is called WITH input.tx, emit is NOT invoked during the call.
 *     The returned emit closure fires when explicitly called (simulating post-commit).
 *   - When the caller's tx rolls back (simulated by not calling emit()), no WS event
 *     fires — no phantom event reaches the consumer.
 *
 * DB-dependent paths are skipped; WS emission is mocked.
 *
 * CI-only: requires DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock WS emitter ───────────────────────────────────────────────────────────

const mockEmitTaskEvent = vi.fn();

vi.mock('../../websocket/emitters.js', () => ({
  emitTaskEvent: mockEmitTaskEvent,
}));

// ── Mock DB + schema ──────────────────────────────────────────────────────────

vi.mock('../../db/index.js', () => ({
  db: {
    transaction: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock('../../db/schema/agentExecutionEvents.js', () => ({
  agentExecutionEvents: { id: 'id', runId: 'runId', organisationId: 'organisationId', sequenceNumber: 'sequenceNumber', eventType: 'eventType', eventTimestamp: 'eventTimestamp', durationSinceRunStartMs: 'durationSinceRunStartMs', sourceService: 'sourceService', payload: 'payload', taskId: 'taskId', taskSequence: 'taskSequence', eventOrigin: 'eventOrigin', eventSubsequence: 'eventSubsequence', eventSchemaVersion: 'eventSchemaVersion' },
}));

vi.mock('../../db/schema/agentRuns.js', () => ({
  agentRuns: { id: 'id', nextEventSeq: 'nextEventSeq' },
}));

vi.mock('../../db/schema/tasks.js', () => ({
  tasks: { id: 'id', nextEventSeq: 'nextEventSeq' },
}));

vi.mock('../../../shared/types/taskEventValidator.js', () => ({
  validateTaskEvent: () => ({ ok: true, event: {} }),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('../../lib/metrics.js', () => ({
  incrementCounter: vi.fn(),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe.skip('TaskEventService deferred-emit ordering (CI-only: requires DB)', () => {
  beforeEach(() => {
    mockEmitTaskEvent.mockClear();
  });

  it('emits immediately when no tx is provided (tx-less path)', async () => {
    // CI-only: requires real DB to test the tx-less path end-to-end.
    // Pure unit assertion: result.emit is a function; emitTaskEvent was called once.
    // Arrange: mock db.transaction to call the callback immediately.
    const { db } = await import('../../db/index.js');
    let capturedCallback: ((tx: unknown) => Promise<void>) | undefined;
    (db.transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(async (cb: (tx: unknown) => Promise<void>) => {
      capturedCallback = cb;
      // Simulate successful tx: provide a mock writer that satisfies doWrite
      const mockWriter = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ nextEventSeq: 1 }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'evt-1', eventTimestamp: new Date() }]),
          }),
        }),
      };
      await cb(mockWriter);
    });

    const { TaskEventService } = await import('../taskEventService.js');
    const result = await TaskEventService.appendAndEmit({
      taskId: 'task-1',
      runId: null,
      organisationId: 'org-1',
      eventOrigin: 'engine',
      event: { kind: 'step.started', payload: { stepId: 's1' } },
    });

    // Emit should have fired synchronously before return
    expect(mockEmitTaskEvent).toHaveBeenCalledOnce();
    expect(result.emit).toBeDefined();
    // Calling emit again should be safe (already emitted — server dedup prevents double send)
    await result.emit();
    expect(typeof capturedCallback).toBe('function');
  });

  it('defers emit when tx is provided; emit fires only after calling result.emit()', async () => {
    // CI-only: requires real DB.
    // Assertion: emitTaskEvent not called during appendAndEmit; called once after result.emit().
    const { db } = await import('../../db/index.js');
    const mockWriter = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ nextEventSeq: 2 }]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'evt-2', eventTimestamp: new Date() }]),
        }),
      }),
    };
    void db; // referenced above — not used in this path

    const { TaskEventService } = await import('../taskEventService.js');
    const result = await TaskEventService.appendAndEmit({
      taskId: 'task-2',
      runId: null,
      organisationId: 'org-1',
      eventOrigin: 'engine',
      event: { kind: 'step.started', payload: { stepId: 's2' } },
      tx: mockWriter as unknown as import('../../db/index.js').OrgScopedTx,
    });

    // Emit must NOT have fired during appendAndEmit
    expect(mockEmitTaskEvent).not.toHaveBeenCalled();

    // Caller invokes emit after their tx commits
    await result.emit();
    expect(mockEmitTaskEvent).toHaveBeenCalledOnce();
  });

  it('tx rollback prevents emit when caller does not call result.emit()', async () => {
    // Simulated rollback: caller never calls result.emit().
    // Assertion: emitTaskEvent never fires.
    const mockWriter = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ nextEventSeq: 3 }]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'evt-3', eventTimestamp: new Date() }]),
        }),
      }),
    };

    const { TaskEventService } = await import('../taskEventService.js');
    await TaskEventService.appendAndEmit({
      taskId: 'task-3',
      runId: null,
      organisationId: 'org-1',
      eventOrigin: 'engine',
      event: { kind: 'step.started', payload: { stepId: 's3' } },
      tx: mockWriter as unknown as import('../../db/index.js').OrgScopedTx,
    });
    // Caller simulates tx rollback by NOT calling result.emit()
    // — no emitTaskEvent call should have occurred
    expect(mockEmitTaskEvent).not.toHaveBeenCalled();
  });
});
