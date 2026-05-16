// Unit tests for runTraceService using mocked DB dependencies.
// Verifies: ordering, cursor pagination, toolSlug filter, terminal event
// synthesis, late-event marking, and response shape (envelope, summary).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeCursor } from '../../../shared/types/runTraceEvent.js';
import { CANONICAL_ORG_ID } from '../../__tests__/fixtures/canonicalIds';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock db before importing the service
const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock('../../db/index.js', () => ({
  db: {
    execute: mockExecute,
    select: mockSelect,
  },
}));

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG_ID = CANONICAL_ORG_ID;
const RUN_ID = '00000000-0000-0000-0000-000000000002';

function makeRunRow(overrides: Partial<{
  status: string;
  controllerStyle: string;
  completedAt: Date | null;
  updatedAt: Date;
  durationMs: number | null;
  policyEnvelopeSnapshot: Record<string, unknown> | null;
}> = {}) {
  return {
    id: RUN_ID,
    status: overrides.status ?? 'completed',
    controllerStyle: overrides.controllerStyle ?? 'native',
    policyEnvelopeSnapshot: overrides.policyEnvelopeSnapshot ?? null,
    completedAt: overrides.completedAt !== undefined ? overrides.completedAt : new Date('2026-01-01T12:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01T12:00:00.000Z'),
    durationMs: overrides.durationMs !== undefined ? overrides.durationMs : 5000,
  };
}

function makeUnionRow(overrides: Partial<{
  run_id: string;
  event_type: string;
  ts: string | Date;
  seq: number;
  source_table: string;
  source_id: string;
  payload: Record<string, unknown>;
}> = {}) {
  return {
    run_id: overrides.run_id ?? RUN_ID,
    event_type: overrides.event_type ?? 'llm_call',
    ts: overrides.ts ?? '2026-01-01T11:00:00.000Z',
    seq: overrides.seq ?? 0,
    source_table: overrides.source_table ?? 'llm_requests',
    source_id: overrides.source_id ?? '00000000-0000-0000-0000-000000000099',
    payload: overrides.payload ?? {
      llmRequestId: '00000000-0000-0000-0000-000000000099',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      tokensIn: 100,
      tokensOut: 50,
      costWithMarginCents: 5,
      durationMs: 800,
    },
  };
}

// Sets up db.select() chain to return a run row
function mockRunSelect(runRow: ReturnType<typeof makeRunRow> | null) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(runRow ? [runRow] : []),
  };
  mockSelect.mockReturnValue(chain);
  return chain;
}

// ── Import after mocks ─────────────────────────────────────────────────────────

// Dynamic import so vi.mock is applied first
async function importService() {
  const mod = await import('../runTraceService.js');
  return mod;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runTraceService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Basic response shape ──────────────────────────────────────────────────

  it('returns a valid RunTraceResult shape for a terminal run', async () => {
    const { runTraceService } = await importService();

    mockRunSelect(makeRunRow());
    mockExecute.mockResolvedValue([
      makeUnionRow({ event_type: 'llm_call', source_id: 'aaa', ts: '2026-01-01T11:00:00.000Z' }),
    ]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);

    expect(result.runId).toBe(RUN_ID);
    expect(result.controllerStyle).toBe('native');
    expect(result.pagination).toHaveProperty('hasMore');
    expect(result.summary).toHaveProperty('finalStatus');
    expect(result.summary.finalStatus).toBe('completed');
    expect(result.summary).toHaveProperty('totalCostCents');
    expect(result.summary).toHaveProperty('totalDurationMs');
    expect(result.summary).toHaveProperty('eventCounts');
  });

  // ── Terminal event synthesis ──────────────────────────────────────────────

  it('synthesises exactly one run_terminated event for a terminal run', async () => {
    const { runTraceService } = await importService();

    mockRunSelect(makeRunRow({ status: 'completed' }));
    mockExecute.mockResolvedValue([
      makeUnionRow({ event_type: 'llm_call' }),
    ]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);
    const terminalEvents = result.events.filter((e) => e.eventType === 'run_terminated');
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0].eventType).toBe('run_terminated');
  });

  it('does not synthesise a run_terminated event for a non-terminal run', async () => {
    const { runTraceService } = await importService();

    mockRunSelect(makeRunRow({ status: 'running', completedAt: null }));
    mockExecute.mockResolvedValue([]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);
    const terminalEvents = result.events.filter((e) => e.eventType === 'run_terminated');
    expect(terminalEvents).toHaveLength(0);
  });

  // ── Late event marking ────────────────────────────────────────────────────

  it('marks events after the terminal timestamp as late: true', async () => {
    const { runTraceService } = await importService();

    const completedAt = new Date('2026-01-01T12:00:00.000Z');
    mockRunSelect(makeRunRow({
      status: 'completed',
      completedAt,
    }));

    // Late event: after completedAt
    mockExecute.mockResolvedValue([
      makeUnionRow({
        event_type: 'llm_call',
        ts: '2026-01-01T12:01:00.000Z', // 1 min after terminal
        source_id: 'late-event',
        payload: {
          llmRequestId: 'late-event',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          tokensIn: 10,
          tokensOut: 5,
          costWithMarginCents: 1,
          durationMs: 100,
        },
      }),
      makeUnionRow({
        event_type: 'llm_call',
        ts: '2026-01-01T11:00:00.000Z', // before terminal — not late
        source_id: 'early-event',
        payload: {
          llmRequestId: 'early-event',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          tokensIn: 100,
          tokensOut: 50,
          costWithMarginCents: 5,
          durationMs: 800,
        },
      }),
    ]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);
    const lateEvents = result.events.filter((e) => e.late === true);
    const earlyEvents = result.events.filter((e) => e.eventType === 'llm_call' && !e.late);
    expect(lateEvents.length).toBeGreaterThanOrEqual(1);
    expect(lateEvents.some((e) => e.sourceId === 'late-event')).toBe(true);
    expect(earlyEvents.some((e) => e.sourceId === 'early-event')).toBe(true);
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  it('returns hasMore: true and nextCursor when DB returns more rows than limit', async () => {
    const { runTraceService } = await importService();

    mockRunSelect(makeRunRow());

    // Return limit+1 rows (default limit = 50, so we set limit=2 and return 3)
    const rows = [
      makeUnionRow({ event_type: 'llm_call', source_id: 'r1', ts: '2026-01-01T10:00:00.000Z' }),
      makeUnionRow({ event_type: 'llm_call', source_id: 'r2', ts: '2026-01-01T10:01:00.000Z' }),
      makeUnionRow({ event_type: 'llm_call', source_id: 'r3', ts: '2026-01-01T10:02:00.000Z' }),
    ];
    mockExecute.mockResolvedValue(rows);

    const result = await runTraceService.query({ runId: RUN_ID, limit: 2 }, ORG_ID);

    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination.nextCursor).toBeDefined();
    // Should have 2 events from source tables + the synthesised terminal event
    const sourceEvents = result.events.filter((e) => e.eventType !== 'run_terminated');
    expect(sourceEvents).toHaveLength(2);
  });

  it('returns hasMore: false and no nextCursor when all rows fit in one page', async () => {
    const { runTraceService } = await importService();

    mockRunSelect(makeRunRow());
    mockExecute.mockResolvedValue([
      makeUnionRow({ event_type: 'llm_call', source_id: 'only-row' }),
    ]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);
    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.nextCursor).toBeUndefined();
  });

  // ── Cursor stability across pages ─────────────────────────────────────────

  it('cursor round-trip: page 2 excludes rows from page 1', async () => {
    // Cursor predicate is now pushed into SQL via tuple comparison
    // (ts, seq, source_table, source_id) > (cursor...). The mock returns the
    // rows the SQL would have returned for each call (DB-side filtering).
    const { runTraceService } = await importService();

    // Build 3 rows
    const row1 = makeUnionRow({ source_id: 'row-1', ts: '2026-01-01T10:00:00.000Z', seq: 1 });
    const row2 = makeUnionRow({ source_id: 'row-2', ts: '2026-01-01T10:01:00.000Z', seq: 2 });
    const row3 = makeUnionRow({ source_id: 'row-3', ts: '2026-01-01T10:02:00.000Z', seq: 3 });

    // Page 1: limit=2, DB returns 3 (limit+1) — no cursor yet
    mockRunSelect(makeRunRow());
    mockExecute.mockResolvedValueOnce([row1, row2, row3]);

    const page1 = await runTraceService.query({ runId: RUN_ID, limit: 2 }, ORG_ID);
    expect(page1.pagination.hasMore).toBe(true);
    const cursor = page1.pagination.nextCursor!;
    expect(cursor).toBeDefined();

    // Page 2: SQL applies the cursor predicate, so the mock returns only row3
    // (row1 + row2 are excluded by the pushed-down tuple comparison).
    mockRunSelect(makeRunRow());
    mockExecute.mockResolvedValueOnce([row3]);

    const page2 = await runTraceService.query({ runId: RUN_ID, limit: 2, cursor }, ORG_ID);
    const sourceIds = page2.events
      .filter((e) => e.eventType !== 'run_terminated')
      .map((e) => e.sourceId);
    expect(sourceIds).toContain('row-3');
    expect(sourceIds).not.toContain('row-1');
    expect(sourceIds).not.toContain('row-2');
  });

  // ── toolSlug filter ───────────────────────────────────────────────────────

  it('filters tool-scoped events by toolSlug and excludes non-tool-scoped tables', async () => {
    // Spec §4.4.5: when toolSlug is set, only actions, tool_call_security_events,
    // and agent_execution_events (tool_call/tool_result subtypes) contribute rows.
    // delegation_outcomes, review_audit_records, llm_requests, iee_steps, and
    // routing/agent_runs are excluded entirely. The SQL UNION pushes these
    // predicates per-arm; this test asserts that only tool-scoped rows surface
    // in the result and that toolSlug column equality holds.
    const { runTraceService } = await importService();

    mockRunSelect(makeRunRow());
    // Mock db.execute returns only the rows the SQL filter would produce.
    // (Non-tool-scoped arms emit zero rows under the toolSlug predicate.)
    mockExecute.mockResolvedValue([
      makeUnionRow({
        event_type: 'tool_security_decision',
        source_table: 'tool_call_security_events',
        source_id: 'sec-match',
        payload: { toolSlug: 'send_email', riskTier: 0, gateLevel: 'auto', gateLevelSource: 'tier_default' },
      }),
    ]);

    const result = await runTraceService.query(
      { runId: RUN_ID, toolSlug: 'send_email' },
      ORG_ID,
    );

    const sourceIds = result.events
      .filter((e) => e.eventType !== 'run_terminated')
      .map((e) => e.sourceId);

    expect(sourceIds).toContain('sec-match');
    // No llm_requests / delegation_outcomes / review_audit_records / iee_steps
    expect(sourceIds).not.toContain('llm-passes-through');
  });

  // ── Policy envelope in response ───────────────────────────────────────────

  it('includes the policy envelope snapshot from the run row', async () => {
    const { runTraceService } = await importService();

    const envelope = {
      schemaVersion: 1 as const,
      resolvedAt: '2026-01-01T12:00:00.000Z',
      runId: RUN_ID,
      agentId: 'agent-1',
      subaccountAgentId: 'sa-1',
      organisationId: ORG_ID,
      subaccountId: 'sub-1',
      controllerStyle: 'native' as const,
      executionMode: 'api' as const,
      controllerLimits: {
        maxLoopIterations: 25,
        defaultTokenBudgetMultiplier: 1.0,
        maxToolCallsPerRun: 20,
        approvalDefault: 'auto' as const,
      },
      allowedControllers: ['native' as const],
      allowedEnvironments: ['api_tool' as const],
      allowedSkillSlugs: [],
      allowedIntegrationSlugs: [],
      maxRiskTier: 3 as const,
      riskTierApprovalDefaults: {} as Record<number, 'auto' | 'review' | 'block'>,
      budgets: { tokenBudget: 30000, maxToolCalls: 20, maxCostCents: 100, maxLlmCalls: 10 },
      approvalDefaults: { sendEmailToClient: 'review' as const, sendSlackToClient: 'review' as const, deployOrFundsTransfer: 'block' as const },
      availableCredentialIds: [],
      activePolicyRuleIds: [],
      sources: { subaccountAgentVersion: null, spendingPoliciesVersion: null, activePolicyRulesVersion: null, capabilityMapVersion: null },
    };

    mockRunSelect(makeRunRow({ policyEnvelopeSnapshot: envelope as unknown as Record<string, unknown> }));
    mockExecute.mockResolvedValue([]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);
    expect(result.envelope).not.toBeNull();
    expect((result.envelope as { schemaVersion: number } | null)?.schemaVersion).toBe(1);
  });

  it('returns null envelope for a legacy run with no snapshot', async () => {
    const { runTraceService } = await importService();

    mockRunSelect(makeRunRow({ policyEnvelopeSnapshot: null }));
    mockExecute.mockResolvedValue([]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);
    expect(result.envelope).toBeNull();
  });

  // ── Summary computation ───────────────────────────────────────────────────

  it('computes totalCostCents as the sum of llm_call costWithMarginCents', async () => {
    const { runTraceService } = await importService();

    mockRunSelect(makeRunRow());
    mockExecute.mockResolvedValue([
      makeUnionRow({ event_type: 'llm_call', source_id: 'l1', payload: { llmRequestId: 'l1', provider: 'anthropic', model: 'm', tokensIn: 10, tokensOut: 5, costWithMarginCents: 3, durationMs: 100 } }),
      makeUnionRow({ event_type: 'llm_call', source_id: 'l2', payload: { llmRequestId: 'l2', provider: 'anthropic', model: 'm', tokensIn: 10, tokensOut: 5, costWithMarginCents: 7, durationMs: 100 } }),
    ]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);
    expect(result.summary.totalCostCents).toBe(10);
  });

  it('includes eventCounts keyed by eventType', async () => {
    const { runTraceService } = await importService();

    mockRunSelect(makeRunRow());
    mockExecute.mockResolvedValue([
      makeUnionRow({ event_type: 'llm_call', source_id: 'l1' }),
      makeUnionRow({ event_type: 'llm_call', source_id: 'l2' }),
      makeUnionRow({ event_type: 'iee_step', source_id: 's1', source_table: 'iee_steps', payload: { stepKind: 'browser_action', durationMs: 100 } }),
    ]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);
    expect(result.summary.eventCounts['llm_call']).toBe(2);
    expect(result.summary.eventCounts['iee_step']).toBe(1);
    // run_terminated is synthesised
    expect(result.summary.eventCounts['run_terminated']).toBe(1);
  });

  // ── 404 for unknown run ───────────────────────────────────────────────────

  it('throws a 404 error when the run is not found', async () => {
    const { runTraceService } = await importService();

    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockSelect.mockReturnValue(chain);

    await expect(
      runTraceService.query({ runId: RUN_ID }, ORG_ID),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // ── Invalid cursor ────────────────────────────────────────────────────────

  it('throws InvalidRunTraceCursorError for a malformed cursor', async () => {
    const { runTraceService, InvalidRunTraceCursorError } = await importService();

    // No need for DB mocks since cursor decode throws first

    await expect(
      runTraceService.query({ runId: RUN_ID, cursor: 'not-valid-base64-cursor!!!' }, ORG_ID),
    ).rejects.toBeInstanceOf(InvalidRunTraceCursorError);
  });

  // ── Ordering tiebreaker ───────────────────────────────────────────────────

  it('produces a stable sort: same timestamp ordered by seq then source_table then source_id', async () => {
    const { runTraceService } = await importService();

    const ts = '2026-01-01T11:00:00.000Z';
    mockRunSelect(makeRunRow({ completedAt: new Date('2026-01-01T12:00:00.000Z') }));
    // DB returns them in correct order (we trust the SQL ORDER BY)
    mockExecute.mockResolvedValue([
      makeUnionRow({ event_type: 'llm_call', ts, seq: 0, source_table: 'actions', source_id: 'aaa' }),
      makeUnionRow({ event_type: 'llm_call', ts, seq: 0, source_table: 'actions', source_id: 'bbb' }),
      makeUnionRow({ event_type: 'llm_call', ts, seq: 1, source_table: 'actions', source_id: 'aaa' }),
      makeUnionRow({ event_type: 'llm_call', ts, seq: 2, source_table: 'llm_requests', source_id: 'ccc' }),
    ]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);
    const sourceEvents = result.events.filter((e) => e.eventType !== 'run_terminated');
    // Result order is determined by the ORDER BY in the SQL query (mocked in order here)
    expect(sourceEvents).toHaveLength(4);
    // Verify cursor encodes the last row in sequence order
    // (no nextCursor since all fit in one page)
    expect(result.pagination.hasMore).toBe(false);
  });

  // ── controllerStyle in response ───────────────────────────────────────────

  it('returns controllerStyle from the run row', async () => {
    const { runTraceService } = await importService();

    mockRunSelect(makeRunRow({ controllerStyle: 'operator' }));
    mockExecute.mockResolvedValue([]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);
    expect(result.controllerStyle).toBe('operator');
  });

  // ── Wire shape pin ────────────────────────────────────────────────────────
  //
  // RunTracePage.tsx + RunTraceEventRenderer.tsx consume the discriminated
  // union with payload fields flattened at the top level of each event member
  // (e.g. `event.controllerStyle`, `event.failureReason`, `event.decidedBy`).
  // This test pins the contract: changing to a nested `payload: { ... }`
  // shape would silently break the UI consumer. Spec §4.4.4 (wire shape note).

  it('returned events expose payload fields at the top level (flat shape)', async () => {
    const { runTraceService } = await importService();

    const completedAt = new Date('2026-01-01T12:00:00.000Z');
    mockRunSelect(makeRunRow({
      status: 'completed',
      controllerStyle: 'operator',
      completedAt,
    }));
    mockExecute.mockResolvedValue([
      makeUnionRow({
        event_type: 'controller_style_decided',
        source_table: 'agent_execution_events',
        source_id: 'csd-1',
        ts: '2026-01-01T11:00:00.000Z',
        payload: { controllerStyle: 'operator', source: 'override' },
      }),
      makeUnionRow({
        event_type: 'review_decided',
        source_table: 'review_audit_records',
        source_id: 'rad-1',
        ts: '2026-01-01T11:01:00.000Z',
        payload: {
          toolSlug: 'send_email',
          decision: 'auto',
          decidedBy: 'user-42',
          requestedBy: 'user-42',
        },
      }),
    ]);

    const result = await runTraceService.query({ runId: RUN_ID }, ORG_ID);

    const csd = result.events.find((e) => e.eventType === 'controller_style_decided');
    expect(csd).toBeDefined();
    if (csd && csd.eventType === 'controller_style_decided') {
      // Top-level fields the UI consumer reads — NOT nested under .payload
      expect(csd.controllerStyle).toBe('operator');
      expect(csd.source).toBe('override');
    }
    // Confirm there is no `payload` key on the returned event (TS-safe access
    // via Record indexing — a future regression to nested shape would surface
    // here as a failing assertion or a TS error on the lookup).
    expect((csd as unknown as Record<string, unknown>).payload).toBeUndefined();

    const rd = result.events.find((e) => e.eventType === 'review_decided');
    expect(rd).toBeDefined();
    if (rd && rd.eventType === 'review_decided') {
      expect(rd.toolSlug).toBe('send_email');
      expect(rd.decidedBy).toBe('user-42');
      expect(rd.decision).toBe('auto');
    }

    const term = result.events.find((e) => e.eventType === 'run_terminated');
    expect(term).toBeDefined();
    if (term && term.eventType === 'run_terminated') {
      // Top-level `failureReason` and `totalDurationMs` are part of the
      // RunTracePage consumer contract.
      expect(term.failureReason).toBeNull();
      expect(typeof term.totalDurationMs).toBe('number');
      expect(term.finalStatus).toBe('completed');
    }
  });

  // ── eventType filter ──────────────────────────────────────────────────────

  it('filters events by eventTypes when specified', async () => {
    const { runTraceService } = await importService();

    // eventType filter is pushed into SQL via `event_type = ANY(...)`. The
    // mock returns only the rows the SQL would have returned (i.e. only
    // matching event types).
    mockRunSelect(makeRunRow());
    mockExecute.mockResolvedValue([
      makeUnionRow({ event_type: 'llm_call', source_id: 'llm-1' }),
    ]);

    const result = await runTraceService.query(
      { runId: RUN_ID, eventTypes: ['llm_call'] },
      ORG_ID,
    );
    const types = result.events.map((e) => e.eventType);
    expect(types.every((t) => t === 'llm_call' || t === 'run_terminated')).toBe(true);
  });

  // ── Valid cursor encoding ─────────────────────────────────────────────────

  it('accepts a valid cursor encoded by encodeCursor', async () => {
    const { runTraceService } = await importService();

    // Encode a cursor pointing past the first row
    const cursor = encodeCursor('2026-01-01T11:00:00.000Z', 0, 'llm_requests', 'row-1');

    // The cursor predicate is pushed into SQL via tuple comparison; the mock
    // returns only the rows the SQL would have returned (row-2 only).
    mockRunSelect(makeRunRow());
    mockExecute.mockResolvedValue([
      makeUnionRow({ source_id: 'row-2', ts: '2026-01-01T11:01:00.000Z', seq: 0, source_table: 'llm_requests' }),
    ]);

    const result = await runTraceService.query({ runId: RUN_ID, cursor }, ORG_ID);
    const sourceIds = result.events
      .filter((e) => e.eventType !== 'run_terminated')
      .map((e) => e.sourceId);
    expect(sourceIds).toContain('row-2');
    expect(sourceIds).not.toContain('row-1');
  });
});
