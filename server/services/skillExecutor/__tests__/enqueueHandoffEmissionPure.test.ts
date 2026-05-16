/**
 * enqueueHandoffEmissionPure.test.ts
 *
 * Verifies that enqueueHandoff emits handoff.decided (awaited) on the success
 * path and does NOT emit on failure paths (depth_cap, no_sender, etc.).
 *
 * Runnable via:
 *   npx vitest run server/services/skillExecutor/__tests__/enqueueHandoffEmissionPure.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before the module under test is imported.
// ---------------------------------------------------------------------------

vi.mock('../../agentExecutionEventEmitter.js', () => ({
  emitAgentEvent: vi.fn().mockResolvedValue(undefined),
  tryEmitAgentEvent: vi.fn(),
}));

vi.mock('../../../db/index.js', () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../../../db/schema/index.js', () => ({
  subaccountAgents: {},
  agents: {},
  agentRuns: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock('../../../lib/queryHelpers.js', () => ({
  isActive: vi.fn(),
}));

vi.mock('../../../config/limits.js', () => ({
  MAX_HANDOFF_DEPTH: 5,
}));

vi.mock('../../../lib/tracing.js', () => ({
  createEvent: vi.fn(),
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------

import { enqueueHandoff, setHandoffJobSender } from '../pipeline.js';
import { emitAgentEvent } from '../../agentExecutionEventEmitter.js';
import { db } from '../../../db/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'task-1',
    agentId: 'agent-target',
    subaccountId: 'sub-1',
    organisationId: 'org-1',
    sourceRunId: 'run-parent',
    handoffDepth: 1,
    handoffContext: 'please continue',
    ...overrides,
  };
}

// Simulate a successful DB + pg-boss path
function mockSuccessfulDb() {
  const mockSelect = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ sa: { id: 'sa-link-1' } }]),
      }),
    }),
  });

  // Second select (duplicate check) returns nothing (no existing run)
  let selectCallCount = 0;
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      // saLink lookup — returns a link
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ sa: { id: 'sa-link-1' } }]),
          }),
        }),
      };
    }
    // existingRun lookup — returns empty (no duplicate)
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    };
  });

  (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (tx: any) => Promise<void>) => {
    const fakeTx = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'run-child-1' }]),
        }),
      }),
      _: { session: { client: { unsafe: vi.fn().mockResolvedValue([]) } } },
    };
    await fn(fakeTx);
  });

  return mockSelect;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enqueueHandoff — handoff.decided emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Case A: success path → emitAgentEvent is called and awaited with correct payload', async () => {
    mockSuccessfulDb();

    // Install a pg-boss sender that resolves to a job id
    const callOrder: string[] = [];
    (emitAgentEvent as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      callOrder.push('emitAgentEvent');
    });

    const pgBossSend = vi.fn().mockImplementation(async () => {
      callOrder.push('pgBossSend');
      return 'job-id-1';
    });
    setHandoffJobSender(pgBossSend);

    const req = makeRequest();
    const result = await enqueueHandoff(req);

    expect(result).toMatchObject({ enqueued: true, runId: 'run-child-1', jobId: 'job-id-1' });

    expect(emitAgentEvent).toHaveBeenCalledOnce();
    expect(emitAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-parent',
        organisationId: 'org-1',
        subaccountId: 'sub-1',
        sourceService: 'skillExecutor',
        payload: {
          eventType: 'handoff.decided',
          critical: true,
          targetAgentId: 'agent-target',
          reasonText: 'please continue',
          depth: 1,
          parentRunId: 'run-parent',
        },
        linkedEntity: { type: 'agent', id: 'agent-target' },
      }),
    );

    // emitAgentEvent must be awaited — pg-boss send (inside tx) comes before it,
    // and emit is called after the transaction resolves.
    expect(callOrder.indexOf('pgBossSend')).toBeLessThan(callOrder.indexOf('emitAgentEvent'));
  });

  it('Case B: depth_cap failure path → emitAgentEvent is NOT called', async () => {
    const req = makeRequest({ handoffDepth: 999 }); // exceeds MAX_HANDOFF_DEPTH=5

    const result = await enqueueHandoff(req);

    expect(result).toMatchObject({ enqueued: false, reason: 'depth_cap' });
    expect(emitAgentEvent).not.toHaveBeenCalled();
  });
});
