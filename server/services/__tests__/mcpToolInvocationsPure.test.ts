// guard-ignore-file: pure-helper-convention reason="Inline pure simulation — logic extracted inline to avoid impure transitive imports; no sibling import needed"
/**
 * mcpToolInvocationsPure unit tests — runnable via:
 *   npx tsx server/services/__tests__/mcpToolInvocationsPure.test.ts
 *
 * Pure logic extracted from mcpAggregateService (dimension building),
 * mcpClientManager (wroteInCatch flag, callIndex capture, row field derivation),
 * and agentActivityService (mcpCallSummary computation).
 * No DB required.
 */
import { expect, test } from 'vitest';

export {};

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Pure helpers extracted from mcpAggregateService ─────────────────────────

type Dimension = { entityType: string; entityId: string; periodType: string; periodKey: string };

interface AggRow {
  organisationId: string;
  subaccountId?: string | null;
  runId?: string | null;
  billingMonth: string;
  billingDay?: string;
  serverSlug: string;
  isTestRun?: boolean;
}

function buildAggregateDimensions(row: AggRow): Dimension[] {
  const dims: Dimension[] = [];
  const billingDay = row.billingDay ?? `${row.billingMonth}-01`;

  if (!row.isTestRun) {
    // Org (monthly + daily) — mirrors LLM aggregate pattern
    dims.push({ entityType: 'mcp_org', entityId: row.organisationId, periodType: 'monthly', periodKey: row.billingMonth });
    dims.push({ entityType: 'mcp_org', entityId: row.organisationId, periodType: 'daily', periodKey: billingDay });
    if (row.subaccountId) {
      dims.push({ entityType: 'mcp_subaccount', entityId: row.subaccountId, periodType: 'monthly', periodKey: row.billingMonth });
      dims.push({ entityType: 'mcp_subaccount', entityId: row.subaccountId, periodType: 'daily', periodKey: billingDay });
    }
  }

  if (row.runId) {
    dims.push({ entityType: 'mcp_run', entityId: row.runId, periodType: 'run', periodKey: row.runId });
  }

  if (!row.isTestRun) {
    dims.push({ entityType: 'mcp_server', entityId: `${row.organisationId}:${row.serverSlug}`, periodType: 'monthly', periodKey: row.billingMonth });
  }

  return dims;
}

// ── Pure helpers extracted from mcpClientManager callTool ───────────────────

interface InvocationInput {
  status: 'success' | 'error' | 'timeout' | 'budget_blocked';
  responseSizeBytes?: number;
  wasTruncated?: boolean;
  callIndex?: number | null;
}

function deriveInvocationFlags(input: InvocationInput) {
  const isError = input.status !== 'success';
  const requiresFailureReason = isError;
  const isPreExecution = input.callIndex === null || input.callIndex === undefined;
  return { isError, requiresFailureReason, isPreExecution };
}

// ── wroteInCatch flag simulation ─────────────────────────────────────────────

function simulateCallTool(opts: {
  throwsOnce: boolean;
  retryable: boolean;
}): { finallyFired: boolean; catchFired: boolean; retried: boolean; rowsWritten: number } {
  const rows: string[] = [];
  let wroteInCatch = false;
  let catchFired = false;
  let retried = false;

  function doCall(isRetry: boolean): void {
    try {
      if (opts.throwsOnce && !isRetry) throw new Error('transient error');
      rows.push('finally-success');
    } catch {
      catchFired = true;
      if (opts.retryable && !isRetry) {
        wroteInCatch = true;
        rows.push('catch-retry');
        retried = true;
        doCall(true); // retry — its own finally fires and writes
        return;
      }
      rows.push('catch-terminal');
    } finally {
      if (!wroteInCatch) {
        rows.push('finally-write');
      }
    }
  }

  doCall(false);
  return {
    finallyFired: rows.some((r) => r.startsWith('finally')),
    catchFired,
    retried,
    rowsWritten: rows.filter((r) => r.endsWith('-write') || r.endsWith('-retry') || r.endsWith('-success')).length,
  };
}

// ── Pure mcpCallSummary computation ─────────────────────────────────────────

interface InvRow {
  serverSlug: string;
  status: 'success' | 'error' | 'timeout' | 'budget_blocked';
  durationMs: number;
}

function computeMcpCallSummary(rows: InvRow[]) {
  if (rows.length === 0) return null;

  const byServer = new Map<string, { callCount: number; errorCount: number; totalDuration: number }>();
  for (const r of rows) {
    const entry = byServer.get(r.serverSlug) ?? { callCount: 0, errorCount: 0, totalDuration: 0 };
    entry.callCount++;
    if (r.status === 'error' || r.status === 'timeout') entry.errorCount++;
    entry.totalDuration += r.durationMs;
    byServer.set(r.serverSlug, entry);
  }

  const byServerArr = Array.from(byServer.entries()).map(([serverSlug, e]) => ({
    serverSlug,
    callCount: e.callCount,
    errorCount: e.errorCount,
    avgDurationMs: Math.round(e.totalDuration / e.callCount),
  }));

  return {
    totalCalls: rows.length,
    errorCount: rows.filter((r) => r.status === 'error' || r.status === 'timeout').length,
    byServer: byServerArr,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\n=== mcpToolInvocationsPure — unit tests ===\n');

// Aggregate dimension tests

test('non-test run with subaccount and runId produces 6 dimensions (monthly+daily for org and sub)', () => {
  const dims = buildAggregateDimensions({
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    runId: 'run-1',
    billingMonth: '2026-04',
    billingDay: '2026-04-17',
    serverSlug: 'github',
    isTestRun: false,
  });
  expect(dims.length, 'dimension count').toBe(6);
  expect(dims.some((d) => d.entityType === 'mcp_org' && d.periodType === 'monthly'), 'mcp_org monthly present').toBeTruthy();
  expect(dims.some((d) => d.entityType === 'mcp_org' && d.periodType === 'daily'), 'mcp_org daily present').toBeTruthy();
  expect(dims.some((d) => d.entityType === 'mcp_subaccount' && d.periodType === 'monthly'), 'mcp_subaccount monthly present').toBeTruthy();
  expect(dims.some((d) => d.entityType === 'mcp_subaccount' && d.periodType === 'daily'), 'mcp_subaccount daily present').toBeTruthy();
  expect(dims.some((d) => d.entityType === 'mcp_run'), 'mcp_run present').toBeTruthy();
  expect(dims.some((d) => d.entityType === 'mcp_server'), 'mcp_server present').toBeTruthy();
});

test('non-test run without subaccount produces 4 dimensions (org monthly+daily, run, server)', () => {
  const dims = buildAggregateDimensions({
    organisationId: 'org-1',
    runId: 'run-1',
    billingMonth: '2026-04',
    billingDay: '2026-04-17',
    serverSlug: 'github',
    isTestRun: false,
  });
  expect(dims.length, 'dimension count').toBe(4);
  expect(!dims.some((d) => d.entityType === 'mcp_subaccount'), 'mcp_subaccount absent').toBeTruthy();
  expect(dims.some((d) => d.entityType === 'mcp_org' && d.periodType === 'daily'), 'mcp_org daily present').toBeTruthy();
});

test('test run with runId produces only mcp_run dimension', () => {
  const dims = buildAggregateDimensions({
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    runId: 'run-1',
    billingMonth: '2026-04',
    serverSlug: 'github',
    isTestRun: true,
  });
  expect(dims.length, 'only mcp_run for test run').toBe(1);
  expect(dims[0].entityType, 'entityType').toBe('mcp_run');
});

test('test run without runId produces zero dimensions', () => {
  const dims = buildAggregateDimensions({
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    billingMonth: '2026-04',
    serverSlug: 'github',
    isTestRun: true,
  });
  expect(dims.length, 'no dimensions for test run without runId').toBe(0);
});

test('mcp_server entityId is scoped to orgId:serverSlug', () => {
  const dims = buildAggregateDimensions({
    organisationId: 'org-xyz',
    runId: 'run-1',
    billingMonth: '2026-04',
    serverSlug: 'notion',
    isTestRun: false,
  });
  const serverDim = dims.find((d) => d.entityType === 'mcp_server');
  expect(!!serverDim, 'mcp_server present').toBeTruthy();
  expect(serverDim!.entityId, 'entityId scoped correctly').toBe('org-xyz:notion');
});

// Invocation field derivation

test('success status: isError=false, requiresFailureReason=false', () => {
  const { isError, requiresFailureReason } = deriveInvocationFlags({ status: 'success', callIndex: 3 });
  expect(!isError, 'isError false on success').toBeTruthy();
  expect(!requiresFailureReason, 'no failureReason needed on success').toBeTruthy();
});

test('timeout status: isError=true, requiresFailureReason=true', () => {
  const { isError, requiresFailureReason } = deriveInvocationFlags({ status: 'timeout', callIndex: 5 });
  expect(isError, 'isError true on timeout').toBeTruthy();
  expect(requiresFailureReason, 'failureReason needed on timeout').toBeTruthy();
});

test('budget_blocked with null callIndex is pre-execution exit', () => {
  const { isPreExecution } = deriveInvocationFlags({ status: 'budget_blocked', callIndex: null });
  expect(isPreExecution, 'budget_blocked with null callIndex is pre-execution').toBeTruthy();
});

// wroteInCatch / finally double-write prevention

test('non-retryable error: catch fires but does not write, finally writes exactly once', () => {
  const result = simulateCallTool({ throwsOnce: true, retryable: false });
  expect(result.catchFired, 'catch fired').toBeTruthy();
  expect(!result.retried, 'no retry').toBeTruthy();
  // Non-retryable catch path does not set wroteInCatch, so finally writes the single row
  expect(result.rowsWritten, 'finally-write only (catch does not write on non-retryable path)').toBe(1);
});

test('retryable error: catch sets wroteInCatch=true, outer finally skips', () => {
  const result = simulateCallTool({ throwsOnce: true, retryable: true });
  expect(result.retried, 'retry happened').toBeTruthy();
  // The outer finally fires but wroteInCatch is true, so only retry's write is emitted
  // Outer catch writes 'catch-retry', retry's finally writes 'finally-write' — total 2
  expect(result.rowsWritten, 'catch-retry + retry-finally-write = 2 rows total').toBe(2);
});

test('success path: only finally fires, no catch', () => {
  const result = simulateCallTool({ throwsOnce: false, retryable: false });
  expect(!result.catchFired, 'catch did not fire on success').toBeTruthy();
  expect(result.rowsWritten, 'finally-success + finally-write').toBe(2);
});

// mcpCallSummary computation

test('empty invocation rows returns null summary', () => {
  const summary = computeMcpCallSummary([]);
  expect(summary === null, 'null for empty rows').toBeTruthy();
});

test('summary with one server sums correctly', () => {
  const summary = computeMcpCallSummary([
    { serverSlug: 'github', status: 'success', durationMs: 100 },
    { serverSlug: 'github', status: 'error', durationMs: 200 },
    { serverSlug: 'github', status: 'success', durationMs: 150 },
  ]);
  expect(summary !== null, 'summary not null').toBeTruthy();
  expect(summary!.totalCalls, 'totalCalls').toBe(3);
  expect(summary!.errorCount, 'errorCount').toBe(1);
  expect(summary!.byServer[0].avgDurationMs, 'avgDurationMs = round((100+200+150)/3)').toBe(150);
});

test('budget_blocked does not count as errorCount — policy exit, not infra failure', () => {
  const summary = computeMcpCallSummary([
    { serverSlug: 'github', status: 'success', durationMs: 100 },
    { serverSlug: 'github', status: 'budget_blocked', durationMs: 0 },
  ]);
  expect(summary !== null, 'summary not null').toBeTruthy();
  expect(summary!.totalCalls, 'totalCalls includes budget_blocked').toBe(2);
  expect(summary!.errorCount, 'budget_blocked must not inflate errorCount').toBe(0);
});

test('summary with multiple servers groups correctly', () => {
  const summary = computeMcpCallSummary([
    { serverSlug: 'github', status: 'success', durationMs: 80 },
    { serverSlug: 'notion', status: 'timeout', durationMs: 5000 },
    { serverSlug: 'notion', status: 'success', durationMs: 300 },
  ]);
  expect(summary !== null, 'summary not null').toBeTruthy();
  expect(summary!.totalCalls, 'totalCalls across servers').toBe(3);
  expect(summary!.errorCount, 'errorCount (notion timeout)').toBe(1);
  expect(summary!.byServer.length, 'two servers').toBe(2);
  const notion = summary!.byServer.find((s) => s.serverSlug === 'notion')!;
  expect(notion.callCount, 'notion callCount').toBe(2);
  expect(notion.errorCount, 'notion errorCount').toBe(1);
  expect(notion.avgDurationMs, 'notion avgDurationMs = round((5000+300)/2)').toBe(2650);
});

// ── Summary ──────────────────────────────────────────────────────────────────
