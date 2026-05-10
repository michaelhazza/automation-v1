// guard-ignore-file: pure-helper-convention reason="env preamble must run before module-level env parse fires; dynamic import used after env setup"
// supportDraftDispatchService.approveDraft.test.ts — Integration tests for approveDraft S1+S2 checks.
// Spec: tasks/builds/pre-test-hardening/spec.md §4.1 (S1) and §4.2 (S2)
//
// Tests the S2 guard (agent principal + overrideCollision=true → 403; ZERO DB writes)
// and the S1 check wiring (check 4 fails first; clean draft enters Phase 2).

import { describe, it, expect, vi, beforeEach } from 'vitest';

export {};

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';
process.env.TOKEN_ENCRYPTION_KEY ??= 'a'.repeat(64);

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before dynamic imports of the tested module.
// ---------------------------------------------------------------------------

// Only the third path resolves to the actual server/lib/orgScopedDb.js
// from this test's location (server/services/__tests__/). The first two
// were leftover speculative mocks that did not match production imports.
// PTH-CGT-F2 (Round 2): chatgpt-pr-review flagged the mock-path mismatch.
vi.mock('../../lib/orgScopedDb.js', () => ({
  getOrgScopedDb: vi.fn(),
  getOrgScopedOrgId: vi.fn(),
  peekOrgTxContext: vi.fn(() => null),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../auditService.js', () => ({
  auditService: {
    log: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../lib/pgBossInstance.js', () => ({
  getPgBoss: vi.fn().mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('../../config/jobConfig.js', () => ({
  getJobConfig: vi.fn().mockReturnValue({}),
}));

// PTH-CGT-F2 (Round 2): fixed path — production imports from server/adapters/ not server/services/adapters/.
// From this test's location (server/services/__tests__/) the correct relative path is '../../adapters/...'.
vi.mock('../../adapters/index.js', () => ({
  adapters: {},
}));

vi.mock('../../adapters/integrationAdapter.js', () => ({
  classifyAdapterError: vi.fn().mockReturnValue({ retryable: false, code: 'test_error' }),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ _eq: { col, val } })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ _inArray: { col, vals } })),
  or: vi.fn((...args: unknown[]) => ({ _or: args })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ _sql: { strings: Array.from(strings), values } })),
    { raw: vi.fn((s: string) => ({ _sqlRaw: s })) },
  ),
  notInArray: vi.fn((col: unknown, vals: unknown) => ({ _notInArray: { col, vals } })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _gt: { col, val } })),
}));

vi.mock('../../db/schema/index.js', () => {
  const makeTable = (name: string) =>
    new Proxy(
      { _tableName: name },
      {
        get: (target, prop) => (prop in target ? (target as Record<string, unknown>)[prop as string] : { _table: name, _col: String(prop) }),
      },
    );
  return {
    canonicalTickets: makeTable('canonical_tickets'),
    canonicalTicketDrafts: makeTable('canonical_ticket_drafts'),
    canonicalSupportAgents: makeTable('canonical_support_agents'),
    connectorConfigs: makeTable('connector_configs'),
    integrationConnections: makeTable('integration_connections'),
    canonicalInboxes: makeTable('canonical_inboxes'),
    actionAttempts: makeTable('action_attempts'),
  };
});

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks are hoisted)
// ---------------------------------------------------------------------------

const { getOrgScopedDb } = await import('../../lib/orgScopedDb.js');
const { auditService } = await import('../auditService.js');
const { approveDraft } = await import('../supportDraftDispatchService.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const DRAFT_ID = '00000000-0000-0000-0000-000000000002';
const TICKET_ID = '00000000-0000-0000-0000-000000000003';
const INBOX_ID = '00000000-0000-0000-0000-000000000004';
const USER_ID = '00000000-0000-0000-0000-000000000005';
const CONNECTOR_CONFIG_ID = '00000000-0000-0000-0000-000000000006';

type UserPrincipal = { type: 'user'; id: string; organisationId: string; subaccountId: null; teamIds: string[] };
type ServicePrincipal = { type: 'service'; id: string; organisationId: string; subaccountId: null; serviceId: string; teamIds: string[] };
type SystemPrincipal = { type: 'system'; id: string; organisationId: string; subaccountId: null; teamIds: string[]; isSystemPrincipal: true };

function makeHumanPrincipal(): UserPrincipal {
  return { type: 'user', id: USER_ID, organisationId: ORG_ID, subaccountId: null, teamIds: [] };
}

function makeServicePrincipal(): ServicePrincipal {
  return { type: 'service', id: 'service-run-id', organisationId: ORG_ID, subaccountId: null, serviceId: 'agent-runner', teamIds: [] };
}

const MOCK_DRAFT = {
  id: DRAFT_ID,
  organisationId: ORG_ID,
  ticketId: TICKET_ID,
  connectorConfigId: CONNECTOR_CONFIG_ID,
  status: 'awaiting_review',
  proposedVisibility: 'public',
  proposedBodyText: 'Hello!',
  createdAt: new Date('2026-05-10T10:00:00.000Z'),
};

const MOCK_TICKET = {
  id: TICKET_ID,
  organisationId: ORG_ID,
  inboxId: INBOX_ID,
  status: 'open',
  subaccountId: null,
  assigneeAgentId: null,
  lastHumanActivityAt: null,
  canonicalContactId: 'contact-uuid',
  externalId: 'ext-123',
  connectorConfigId: CONNECTOR_CONFIG_ID,
};

const MOCK_INBOX_ROW = {
  agentConfig: {
    version: 1,
    mode: 'assisted',
    collisionWindow: { minMinutesSinceHumanActivity: 30, respectHumanAssignee: true },
    draftExpiry: { awaitingReviewHours: 24, draftHours: 24 },
    optIns: { autonomousReplyOnWaitingOnCustomer: false, postResolutionFollowUp: false },
  },
};

/**
 * Build a DB mock that sequences through the queries `approveDraft` makes.
 * Each select() call returns the next configured row set in order.
 */
function makeDbMock(options: {
  draftRows?: unknown[];
  ticketRows?: unknown[];
  inboxRows?: unknown[];
  assigneeRows?: unknown[];
  newerDraftRows?: unknown[];
} = {}) {
  const {
    draftRows = [MOCK_DRAFT],
    ticketRows = [MOCK_TICKET],
    inboxRows = [MOCK_INBOX_ROW],
    assigneeRows = [],
    newerDraftRows = [],
  } = options;

  // Determine if assignee query will run: it only runs when ticket.assigneeAgentId is non-null.
  // MOCK_TICKET has assigneeAgentId: null, so the assignee query is skipped by default.
  const ticketRow = ticketRows[0] as { assigneeAgentId?: string | null } | undefined;
  const assigneeQueryWillRun = ticketRow?.assigneeAgentId != null;

  let selectCallCount = 0;

  const makeSelectChain = (resolveWith: unknown[]) => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolveWith),
      }),
    }),
  });

  const db = {
    select: vi.fn().mockImplementation(() => {
      selectCallCount++;
      // Call 1: load draft
      if (selectCallCount === 1) return makeSelectChain(draftRows);
      // Call 2: load ticket
      if (selectCallCount === 2) return makeSelectChain(ticketRows);
      // Call 3: load inbox
      if (selectCallCount === 3) return makeSelectChain(inboxRows);
      // Call 4: load assignee (only when ticket.assigneeAgentId is non-null)
      if (assigneeQueryWillRun && selectCallCount === 4) return makeSelectChain(assigneeRows);
      // Call 4 or 5 (depending on whether assignee query ran): newer draft supersession
      const newerDraftCallNum = assigneeQueryWillRun ? 5 : 4;
      if (selectCallCount === newerDraftCallNum) return makeSelectChain(newerDraftRows);
      return makeSelectChain([]);
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
  };

  return { db, getSelectCallCount: () => selectCallCount };
}

// ---------------------------------------------------------------------------
// S2 guard tests
// ---------------------------------------------------------------------------

describe('approveDraft — S2 guard (agent-run principal + overrideCollision)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('S2: agent-run principal + overrideCollision=true → 403 override_collision_human_only; ZERO DB writes', async () => {
    const { db } = makeDbMock();
    vi.mocked(getOrgScopedDb).mockReturnValue(db as unknown as ReturnType<typeof getOrgScopedDb>);

    let thrown: unknown;
    try {
      await approveDraft(DRAFT_ID, makeServicePrincipal(), { overrideCollision: true });
    } catch (err) {
      thrown = err;
    }

    // S2 guard fires with 403
    expect(thrown).toBeDefined();
    const error = thrown as { statusCode: number; errorCode: string };
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe('support.draft.override_collision_human_only');

    // ZERO DB writes — no select, no update, no insert was called
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();

    // ZERO audit rows
    expect(vi.mocked(auditService.log)).not.toHaveBeenCalled();
  });

  it('S2: system principal + overrideCollision=true → 403 (system is not a human user)', async () => {
    const { db } = makeDbMock();
    vi.mocked(getOrgScopedDb).mockReturnValue(db as unknown as ReturnType<typeof getOrgScopedDb>);

    const systemPrincipal: SystemPrincipal = {
      type: 'system',
      id: 'system-id',
      organisationId: ORG_ID,
      subaccountId: null,
      teamIds: [],
      isSystemPrincipal: true,
    };

    let thrown: unknown;
    try {
      await approveDraft(DRAFT_ID, systemPrincipal, { overrideCollision: true });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    const error = thrown as { statusCode: number; errorCode: string };
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe('support.draft.override_collision_human_only');
    // ZERO DB reads
    expect(db.select).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// S2 human override path: check 5 skipped, audit row written
// ---------------------------------------------------------------------------

describe('approveDraft — S2 human override (check 5 bypassed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('human + overrideCollision=true + recent human activity → S2 passes; audit row for collision_override written', async () => {
    // Ticket has recent human activity that would normally block (check 5)
    const recentActivity = new Date(Date.now() - 10 * 60_000); // 10 min ago, within 30-min window
    const ticketWithRecentActivity = { ...MOCK_TICKET, lastHumanActivityAt: recentActivity };

    const { db } = makeDbMock({ ticketRows: [ticketWithRecentActivity] });
    vi.mocked(getOrgScopedDb).mockReturnValue(db as unknown as ReturnType<typeof getOrgScopedDb>);

    let thrown: unknown;
    try {
      await approveDraft(DRAFT_ID, makeHumanPrincipal(), { overrideCollision: true });
    } catch (err) {
      thrown = err;
    }

    // The audit row for collision_override MUST be written before Phase 2
    expect(vi.mocked(auditService.log)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support.draft.collision_override',
        organisationId: ORG_ID,
        entityId: DRAFT_ID,
      }),
    );

    // If thrown, it must NOT be an S2 guard error or a check 5 preflight error
    if (thrown) {
      const err = thrown as { statusCode?: number; errorCode?: string };
      expect(err.errorCode).not.toBe('support.draft.override_collision_human_only');
      expect(err.errorCode).not.toBe('support.draft.preflight.human_collision_blocked');
    }
  });
});

// ---------------------------------------------------------------------------
// S1 wiring — check ordering
// ---------------------------------------------------------------------------

describe('approveDraft — S1 wiring (check 4 short-circuits)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('check 4 fails (pending_internal + propose_reply) → 403 ticket_status_ineligible; newer-draft query NOT run', async () => {
    const pendingTicket = { ...MOCK_TICKET, status: 'pending_internal' };
    const publicDraft = { ...MOCK_DRAFT, proposedVisibility: 'public' };

    const { db, getSelectCallCount } = makeDbMock({
      draftRows: [publicDraft],
      ticketRows: [pendingTicket],
    });
    vi.mocked(getOrgScopedDb).mockReturnValue(db as unknown as ReturnType<typeof getOrgScopedDb>);

    let thrown: unknown;
    try {
      await approveDraft(DRAFT_ID, makeHumanPrincipal());
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    const error = thrown as { statusCode: number; errorCode: string };
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe('support.draft.preflight.ticket_status_ineligible');

    // Newer-draft query should NOT have been made since check 4 failed first.
    // With assigneeAgentId=null, the newer-draft query would be select call 4.
    // Check 4 fires after inbox (call 3) and before the newer-draft query (call 4),
    // so the select call count must be 3 or fewer.
    const callCount = getSelectCallCount();
    expect(callCount).toBeLessThanOrEqual(3);
  });

  it('clean draft passes all seven checks → enters Phase 2 (update draft called)', async () => {
    const { db } = makeDbMock();
    vi.mocked(getOrgScopedDb).mockReturnValue(db as unknown as ReturnType<typeof getOrgScopedDb>);

    try {
      await approveDraft(DRAFT_ID, makeHumanPrincipal());
    } catch {
      // Phase 2/3 will fail without adapter — ignore
    }

    // Phase 2 update to 'dispatching' was attempted — all seven preflight checks passed
    expect(db.update).toHaveBeenCalled();
    // No preflight guard fired
    expect(vi.mocked(auditService.log)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Supersession — check 7 fires when newerDraftRow exists
// ---------------------------------------------------------------------------

describe('approveDraft — Supersession (check 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('check 7: newerDraft exists → 403 superseded_by_newer_draft', async () => {
    const newerDraftStub = [{ id: '00000000-0000-0000-0000-000000000099' }];
    const { db } = makeDbMock({ newerDraftRows: newerDraftStub });
    vi.mocked(getOrgScopedDb).mockReturnValue(db as unknown as ReturnType<typeof getOrgScopedDb>);

    let thrown: unknown;
    try {
      await approveDraft(DRAFT_ID, makeHumanPrincipal());
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    const error = thrown as { statusCode: number; errorCode: string };
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe('support.draft.preflight.superseded_by_newer_draft');
  });

  it('Supersession tuple SQL: same-tick scenario — the sql tag is used for the tuple comparison', async () => {
    // This test verifies the implementation uses sql`` for the tuple comparison,
    // which enables the (created_at, id) > ($2, $3) form that handles same-millisecond ties.
    const { sql: drizzleSql } = await import('drizzle-orm');
    const sqlMock = vi.mocked(drizzleSql);

    const { db } = makeDbMock({ newerDraftRows: [] });
    vi.mocked(getOrgScopedDb).mockReturnValue(db as unknown as ReturnType<typeof getOrgScopedDb>);

    try {
      await approveDraft(DRAFT_ID, makeHumanPrincipal());
    } catch {
      // ignore Phase 2/3 errors
    }

    // The supersession query uses sql`` for the tuple comparison (not a simple gt() call)
    expect(sqlMock).toHaveBeenCalled();
    const sqlCalls = sqlMock.mock.calls;
    // At least one call should contain a fragment relating to the tuple-comparison pattern
    const hasTupleFragment = sqlCalls.some((callArgs) => {
      const template = callArgs[0];
      if (Array.isArray(template)) {
        return template.some(
          (fragment: unknown) =>
            typeof fragment === 'string' && fragment.includes('> ('),
        );
      }
      return false;
    });
    expect(hasTupleFragment).toBe(true);
  });
});
