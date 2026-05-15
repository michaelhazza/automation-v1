// agentRunSoftDeleteServicePure.test.ts — mock-driven unit tests for softDeleteAgentRun.
// Spec: tasks/builds/sandbox-safety-batch/plan.md Chunk 2 (§7.6 REQ #35).
//
// Tests cover: happy path, already-deleted, not-found, enqueue failure.
// All DB + pg-boss calls are mocked; no real DB or network access.

import { describe, it, expect, vi, beforeEach } from 'vitest';
// Type-only import to satisfy `verify-pure-helper-convention.sh` — the
// production module is otherwise loaded via dynamic import after mocks are
// registered so its dependencies hoist correctly.
import type { softDeleteAgentRun as _SoftDeleteAgentRun } from '../agentRunSoftDeleteService.js';
type _Unused = typeof _SoftDeleteAgentRun;

export {};

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before dynamic imports of the tested module.
// ---------------------------------------------------------------------------

const mockScopedDb = {
  update: vi.fn(),
  select: vi.fn(),
};

vi.mock('../../lib/orgScopedDb.js', () => ({
  getOrgScopedDb: vi.fn(() => mockScopedDb),
}));

vi.mock('../../db/schema/agentRuns.js', () => ({
  agentRuns: new Proxy(
    { _tableName: 'agent_runs' },
    {
      get: (target, prop) =>
        prop in target
          ? (target as Record<string, unknown>)[prop as string]
          : { _table: 'agent_runs', _col: String(prop) },
    },
  ),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _eq: { col, val } })),
  isNull: vi.fn((col: unknown) => ({ _isNull: col })),
  isNotNull: vi.fn((col: unknown) => ({ _isNotNull: col })),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../lib/pgBossInstance.js', () => ({
  getPgBoss: vi.fn(),
}));

vi.mock('../../config/jobConfig.js', () => ({
  getJobConfig: vi.fn().mockReturnValue({ retryLimit: 3, retryDelay: 30, retryBackoff: true }),
}));

vi.mock('../../lib/sandboxJobNames.js', () => ({
  SANDBOX_ARTEFACT_PURGE_JOB: 'sandbox-artefact-purge',
}));

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks are hoisted)
// ---------------------------------------------------------------------------

const { getPgBoss } = await import('../../lib/pgBossInstance.js');
const { logger } = await import('../../lib/logger.js');
const { softDeleteAgentRun } = await import('../agentRunSoftDeleteService.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_ID = '00000000-0000-0000-0000-000000000001';
const ORG_ID = '00000000-0000-0000-0000-000000000002';
const SUBACCOUNT_ID = '00000000-0000-0000-0000-000000000003';

const INPUT = { runId: RUN_ID, organisationId: ORG_ID, subaccountId: SUBACCOUNT_ID };

// ---------------------------------------------------------------------------
// Helpers to build db mock chains
// ---------------------------------------------------------------------------

function makeUpdateChain(returningResult: unknown[]) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returningResult),
      }),
    }),
  };
}

function makeSelectChain(resolveWith: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolveWith),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('softDeleteAgentRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: happy path — UPDATE rowCount=1; sendJob called; returns { deleted: true }', async () => {
    const mockSend = vi.fn().mockResolvedValue(null);
    vi.mocked(getPgBoss).mockResolvedValue({ send: mockSend } as unknown as Awaited<ReturnType<typeof getPgBoss>>);
    mockScopedDb.update.mockReturnValue(makeUpdateChain([{ id: RUN_ID }]) as unknown as ReturnType<typeof mockScopedDb.update>);

    const result = await softDeleteAgentRun(INPUT);

    expect(result).toEqual({ deleted: true });
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith(
      'sandbox-artefact-purge',
      { runId: RUN_ID, organisationId: ORG_ID, subaccountId: SUBACCOUNT_ID },
      expect.objectContaining({ singletonKey: RUN_ID }),
    );
  });

  it('Test 2: already-deleted — UPDATE rowCount=0; SELECT returns row with deletedAt set; returns { deleted: false, reason: already_deleted }; sendJob NOT called', async () => {
    const mockSend = vi.fn();
    vi.mocked(getPgBoss).mockResolvedValue({ send: mockSend } as unknown as Awaited<ReturnType<typeof getPgBoss>>);
    mockScopedDb.update.mockReturnValue(makeUpdateChain([]) as unknown as ReturnType<typeof mockScopedDb.update>);
    mockScopedDb.select.mockReturnValue(
      makeSelectChain([{ id: RUN_ID, deletedAt: new Date('2026-01-01T00:00:00.000Z') }]) as unknown as ReturnType<typeof mockScopedDb.select>,
    );

    const result = await softDeleteAgentRun(INPUT);

    expect(result).toEqual({ deleted: false, reason: 'already_deleted' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('Test 3: not-found — UPDATE rowCount=0; SELECT returns empty; returns { deleted: false, reason: not_found }', async () => {
    const mockSend = vi.fn();
    vi.mocked(getPgBoss).mockResolvedValue({ send: mockSend } as unknown as Awaited<ReturnType<typeof getPgBoss>>);
    mockScopedDb.update.mockReturnValue(makeUpdateChain([]) as unknown as ReturnType<typeof mockScopedDb.update>);
    mockScopedDb.select.mockReturnValue(makeSelectChain([]) as unknown as ReturnType<typeof mockScopedDb.select>);

    const result = await softDeleteAgentRun(INPUT);

    expect(result).toEqual({ deleted: false, reason: 'not_found' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('Test 4: enqueue failure — UPDATE rowCount=1; sendJob throws; returns { deleted: true }; logger.error called', async () => {
    const mockSend = vi.fn().mockRejectedValue(new Error('pg-boss unavailable'));
    vi.mocked(getPgBoss).mockResolvedValue({ send: mockSend } as unknown as Awaited<ReturnType<typeof getPgBoss>>);
    mockScopedDb.update.mockReturnValue(makeUpdateChain([{ id: RUN_ID }]) as unknown as ReturnType<typeof mockScopedDb.update>);

    const result = await softDeleteAgentRun(INPUT);

    expect(result).toEqual({ deleted: true });
    expect(vi.mocked(logger.error)).toHaveBeenCalledOnce();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'agent_run.soft_delete.purge_enqueue_failed',
      expect.objectContaining({ runId: RUN_ID }),
    );
  });
});
