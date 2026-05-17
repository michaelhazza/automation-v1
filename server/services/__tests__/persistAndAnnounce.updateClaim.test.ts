// Unit tests for the UPDATE-claim branch of persistAndAnnounce
// (server/services/agentExecutionService/runLifecycle/persistRun.ts).
//
// Covers the AE2 contract path where the handoff worker forwards a
// pre-created agent_runs row id and persistAndAnnounce takes ownership
// of the pending row instead of inserting a new one.
//
// Closes Wave 4 audit-absorber W4AA-DEBT-16.
//
// Runnable via:
//   npx vitest run server/services/__tests__/persistAndAnnounce.updateClaim.test.ts

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
process.env.JWT_SECRET ??= 'skip-placeholder-jwt';
process.env.EMAIL_FROM ??= 'skip@placeholder.example';

import { describe, it, expect, vi, beforeEach } from 'vitest';
// Type-only sibling import — satisfies pure-helper-convention gate and documents the unit under test.
// The implementation is loaded via dynamic import inside each test so the vi.mock() calls above take effect.
import type { persistAndAnnounce as _persistAndAnnounceType } from '../agentExecutionService/runLifecycle/persistRun.js';

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('../agentExecutionEventEmitter.js', () => ({
  emitAgentEvent: vi.fn().mockResolvedValue(undefined),
  tryEmitAgentEvent: vi.fn(),
}));

vi.mock('../../websocket/emitters.js', () => ({
  emitAgentRunUpdate: vi.fn(),
  emitSubaccountUpdate: vi.fn(),
}));

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUB_ID = '00000000-0000-0000-0000-000000000002';
const AGENT_ID = '00000000-0000-0000-0000-000000000003';
const SA_AGENT_ID = '00000000-0000-0000-0000-000000000004';
const PRE_RUN_ID = '00000000-0000-0000-0000-000000000099';

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    organisationId: ORG_ID,
    subaccountId: SUB_ID,
    agentId: AGENT_ID,
    subaccountAgentId: SA_AGENT_ID,
    runType: 'agent_run',
    preCreatedRunId: PRE_RUN_ID,
    ...overrides,
  } as never;
}

function mockSaGovSelect(db: { select: ReturnType<typeof vi.fn> }) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ controllerStyleAllowed: 'native_only' }]),
  };
  vi.mocked(db.select).mockReturnValue(chain as never);
}

describe('persistAndAnnounce — pre-created run UPDATE-claim branch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('claims the pending row when UPDATE returns it', async () => {
    const { db } = await import('../../db/index.js');
    const { persistAndAnnounce } = await import('../agentExecutionService/runLifecycle/persistRun.js');

    mockSaGovSelect(db as never);

    const claimedRow = { id: PRE_RUN_ID, status: 'running', agentId: AGENT_ID };
    const mockUpdate = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([claimedRow]),
    };
    vi.mocked(db.update).mockReturnValue(mockUpdate as never);

    const result = await persistAndAnnounce(makeRequest(), {} as never);
    expect(db.update).toHaveBeenCalledOnce();
    expect(db.insert).not.toHaveBeenCalled();
    expect(result.run).toEqual(claimedRow);

    // Pin the WHERE-clause shape so a future refactor that loses the
    // id-or-status filter is caught — the UPDATE-claim contract requires
    // BOTH predicates to be present (id match for the pre-created row,
    // status='pending' for one-way concurrency).
    expect(mockUpdate.where).toHaveBeenCalledOnce();
    const whereArg = mockUpdate.where.mock.calls[0][0];
    expect(whereArg).toBeTruthy();
    // Walk the Drizzle expression tree without JSON.stringify (the table
    // objects contain circular refs) and collect column names + literal
    // values seen. Both 'id', 'status', and the literal 'pending' must
    // appear somewhere in the tree.
    const seen = new Set<string>();
    const visit = (node: unknown, depth = 0): void => {
      if (depth > 6 || node == null) return;
      if (typeof node === 'string') {
        seen.add(node);
        return;
      }
      if (typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child, depth + 1);
        return;
      }
      const rec = node as Record<string, unknown>;
      if (typeof rec.name === 'string') seen.add(rec.name);
      if (typeof rec.value === 'string') seen.add(rec.value);
      if (Array.isArray(rec.queryChunks)) visit(rec.queryChunks, depth + 1);
    };
    visit(whereArg);
    expect(seen.has('id'), `expected 'id' column in WHERE; saw: ${[...seen].join(', ')}`).toBe(true);
    expect(seen.has('status'), `expected 'status' column in WHERE; saw: ${[...seen].join(', ')}`).toBe(true);
    expect(seen.has('pending'), `expected 'pending' literal in WHERE; saw: ${[...seen].join(', ')}`).toBe(true);
    // W5K-ADV-2 defence-in-depth: the UPDATE-claim WHERE must also include
    // organisation_id matching the request's organisationId, so the claim
    // is constrained to the caller's tenant even if RLS is mis-applied.
    expect(seen.has('organisation_id'), `expected 'organisation_id' column in WHERE; saw: ${[...seen].join(', ')}`).toBe(true);
    expect(seen.has(ORG_ID), `expected ORG_ID literal in WHERE; saw: ${[...seen].join(', ')}`).toBe(true);
  });

  it('throws fail-loud when no pending row could be claimed (concurrent transition)', async () => {
    const { db } = await import('../../db/index.js');
    const { persistAndAnnounce } = await import('../agentExecutionService/runLifecycle/persistRun.js');

    mockSaGovSelect(db as never);

    const mockUpdate = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.update).mockReturnValue(mockUpdate as never);

    await expect(persistAndAnnounce(makeRequest(), {} as never)).rejects.toThrow(
      new RegExp(`pre-created agent_runs row ${PRE_RUN_ID} could not be claimed`)
    );
    expect(db.insert).not.toHaveBeenCalled();
  });
});
