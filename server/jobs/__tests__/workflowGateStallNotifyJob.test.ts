/**
 * workflowGateStallNotifyJob.test.ts
 *
 * Unit tests for runWorkflowGateStallNotify — guards the B1 RLS-binding fix.
 *
 * Key contract:
 *   - The user lookup uses getOrgScopedDb (org-scoped tx from createWorker),
 *     NOT the global `db` handle (which bypasses RLS).
 *   - EmailService.sendGenericEmail is invoked once when gate is open and
 *     user lookup succeeds.
 *   - No notification is sent when the gate is already resolved (stale-fire).
 *
 * Mocks:
 *   - withAdminConnection — returns a synthetic gate row for Phase 1.
 *   - getOrgScopedDb — returns a mock drizzle handle for Phase 3 user lookup.
 *   - EmailService — spies on sendGenericEmail.
 *
 * Run via:
 *   npx vitest run server/jobs/__tests__/workflowGateStallNotifyJob.test.ts
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
process.env.JWT_SECRET ??= 'skip-placeholder-jwt';
process.env.EMAIL_FROM ??= 'skip@placeholder.example';

import { describe, expect, test, vi, beforeEach } from 'vitest';

// ── Test data ─────────────────────────────────────────────────────────────────

const GATE_ID = '00000000-0000-0000-0000-000000000001';
const ORG_ID = '00000000-0000-0000-0000-000000000002';
const USER_ID = '00000000-0000-0000-0000-000000000003';
const TASK_ID = '00000000-0000-0000-0000-000000000004';
const USER_EMAIL = 'requester@example.com';

const CREATED_AT = new Date('2026-01-01T12:00:00.000Z');
const EXPECTED_CREATED_AT = CREATED_AT.toISOString();

const BASE_PAYLOAD = {
  gateId: GATE_ID,
  organisationId: ORG_ID,
  taskId: TASK_ID,
  requesterUserId: USER_ID,
  cadence: '24h' as const,
  expectedCreatedAt: EXPECTED_CREATED_AT,
};

// ── Mock: withAdminConnection ─────────────────────────────────────────────────

let mockGateRow: Record<string, unknown> | null = {
  id: GATE_ID,
  resolved_at: null,
  created_at: CREATED_AT,
  gate_kind: 'approval',
  workflow_run_id: '00000000-0000-0000-0000-000000000010',
  organisation_id: ORG_ID,
};

vi.mock('../../lib/adminDbConnection.js', () => ({
  withAdminConnection: vi.fn(
    async (
      _opts: unknown,
      fn: (tx: unknown) => Promise<unknown>,
    ) => {
      // Simulate the admin tx callback returning the gate row
      const fakeTx = {
        execute: vi.fn(async () => ({ rows: mockGateRow ? [mockGateRow] : [] })),
      };
      return fn(fakeTx);
    },
  ),
}));

// ── Mock: getOrgScopedDb ──────────────────────────────────────────────────────

const mockOrgScopedSelect = vi.fn();

vi.mock('../../lib/orgScopedDb.js', () => ({
  getOrgScopedDb: vi.fn(() => ({
    select: mockOrgScopedSelect,
  })),
}));

// ── Mock: EmailService ────────────────────────────────────────────────────────

const mockSendGenericEmail = vi.fn(async () => {});

vi.mock('../../services/emailService.js', () => ({
  EmailService: vi.fn().mockImplementation(() => ({
    sendGenericEmail: mockSendGenericEmail,
  })),
}));

// ── Mock: logger ──────────────────────────────────────────────────────────────

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a fluent drizzle-mock chain that resolves to `rows`.
 * Covers: select(...).from(...).where(...) → rows
 */
function buildSelectChain(rows: unknown[]) {
  const terminal = vi.fn(async () => rows);
  const where = vi.fn(() => terminal());
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return select;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runWorkflowGateStallNotify', () => {
  beforeEach(() => {
    mockSendGenericEmail.mockClear();
    mockOrgScopedSelect.mockReset();
    vi.clearAllMocks();

    // Default: gate is open, user found
    mockGateRow = {
      id: GATE_ID,
      resolved_at: null,
      created_at: CREATED_AT,
      gate_kind: 'approval',
      workflow_run_id: '00000000-0000-0000-0000-000000000010',
      organisation_id: ORG_ID,
    };
  });

  test('sends email via EmailService when gate is open and user lookup succeeds', async () => {
    // Wire getOrgScopedDb to return a user row
    mockOrgScopedSelect.mockImplementationOnce(
      () => buildSelectChain([{ email: USER_EMAIL }])(),
    );

    const { runWorkflowGateStallNotify } = await import('../workflowGateStallNotifyJob.js');
    await runWorkflowGateStallNotify(BASE_PAYLOAD);

    expect(mockSendGenericEmail).toHaveBeenCalledOnce();
    const [toArg] = mockSendGenericEmail.mock.calls[0] as [string, ...unknown[]];
    expect(toArg).toBe(USER_EMAIL);
  });

  test('uses getOrgScopedDb for the user lookup (B1 RLS-binding contract)', async () => {
    const { getOrgScopedDb } = await import('../../lib/orgScopedDb.js');
    const getOrgScopedDbMock = vi.mocked(getOrgScopedDb);

    mockOrgScopedSelect.mockImplementationOnce(
      () => buildSelectChain([{ email: USER_EMAIL }])(),
    );

    const { runWorkflowGateStallNotify } = await import('../workflowGateStallNotifyJob.js');
    await runWorkflowGateStallNotify(BASE_PAYLOAD);

    expect(getOrgScopedDbMock).toHaveBeenCalledWith('jobs.workflowGateStallNotify');
  });

  test('does not send email when gate is already resolved (stale-fire guard)', async () => {
    mockGateRow = {
      id: GATE_ID,
      resolved_at: new Date(),
      created_at: CREATED_AT,
      gate_kind: 'approval',
      workflow_run_id: '00000000-0000-0000-0000-000000000010',
      organisation_id: ORG_ID,
    };

    const { runWorkflowGateStallNotify } = await import('../workflowGateStallNotifyJob.js');
    await runWorkflowGateStallNotify(BASE_PAYLOAD);

    expect(mockSendGenericEmail).not.toHaveBeenCalled();
  });

  test('does not send email when gate row is missing', async () => {
    mockGateRow = null;

    const { runWorkflowGateStallNotify } = await import('../workflowGateStallNotifyJob.js');
    await runWorkflowGateStallNotify(BASE_PAYLOAD);

    expect(mockSendGenericEmail).not.toHaveBeenCalled();
  });

  test('does not send email when user lookup returns no rows', async () => {
    // User not found — empty array
    mockOrgScopedSelect.mockImplementationOnce(
      () => buildSelectChain([])(),
    );

    const { runWorkflowGateStallNotify } = await import('../workflowGateStallNotifyJob.js');
    await runWorkflowGateStallNotify(BASE_PAYLOAD);

    expect(mockSendGenericEmail).not.toHaveBeenCalled();
  });
});
