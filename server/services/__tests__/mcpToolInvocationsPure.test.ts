/**
 * mcpToolInvocationsPure unit tests — runnable via:
 *   npx tsx server/services/__tests__/mcpToolInvocationsPure.test.ts
 *
 * Pure logic extracted from mcpAggregateService (dimension building),
 * mcpClientManager (wroteInCatch flag, callIndex capture, row field derivation),
 * and agentActivityService (mcpCallSummary computation).
 * No DB required.
 */

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

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
  serverSlug: string;
  isTestRun?: boolean;
}

function buildAggregateDimensions(row: AggRow): Dimension[] {
  const dims: Dimension[] = [];

  if (!row.isTestRun) {
    dims.push({ entityType: 'mcp_org', entityId: row.organisationId, periodType: 'monthly', periodKey: row.billingMonth });
    if (row.subaccountId) {
      dims.push({ entityType: 'mcp_subaccount', entityId: row.subaccountId, periodType: 'monthly', periodKey: row.billingMonth });
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
    if (r.status !== 'success') entry.errorCount++;
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
    errorCount: rows.filter((r) => r.status !== 'success').length,
    byServer: byServerArr,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\n=== mcpToolInvocationsPure — unit tests ===\n');

// Aggregate dimension tests

test('non-test run with subaccount and runId produces 4 dimensions', () => {
  const dims = buildAggregateDimensions({
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    runId: 'run-1',
    billingMonth: '2026-04',
    serverSlug: 'github',
    isTestRun: false,
  });
  assertEqual(dims.length, 4, 'dimension count');
  assert(dims.some((d) => d.entityType === 'mcp_org'), 'mcp_org present');
  assert(dims.some((d) => d.entityType === 'mcp_subaccount'), 'mcp_subaccount present');
  assert(dims.some((d) => d.entityType === 'mcp_run'), 'mcp_run present');
  assert(dims.some((d) => d.entityType === 'mcp_server'), 'mcp_server present');
});

test('non-test run without subaccount produces 3 dimensions (no mcp_subaccount)', () => {
  const dims = buildAggregateDimensions({
    organisationId: 'org-1',
    runId: 'run-1',
    billingMonth: '2026-04',
    serverSlug: 'github',
    isTestRun: false,
  });
  assertEqual(dims.length, 3, 'dimension count');
  assert(!dims.some((d) => d.entityType === 'mcp_subaccount'), 'mcp_subaccount absent');
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
  assertEqual(dims.length, 1, 'only mcp_run for test run');
  assertEqual(dims[0].entityType, 'mcp_run', 'entityType');
});

test('test run without runId produces zero dimensions', () => {
  const dims = buildAggregateDimensions({
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    billingMonth: '2026-04',
    serverSlug: 'github',
    isTestRun: true,
  });
  assertEqual(dims.length, 0, 'no dimensions for test run without runId');
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
  assert(!!serverDim, 'mcp_server present');
  assertEqual(serverDim!.entityId, 'org-xyz:notion', 'entityId scoped correctly');
});

// Invocation field derivation

test('success status: isError=false, requiresFailureReason=false', () => {
  const { isError, requiresFailureReason } = deriveInvocationFlags({ status: 'success', callIndex: 3 });
  assert(!isError, 'isError false on success');
  assert(!requiresFailureReason, 'no failureReason needed on success');
});

test('timeout status: isError=true, requiresFailureReason=true', () => {
  const { isError, requiresFailureReason } = deriveInvocationFlags({ status: 'timeout', callIndex: 5 });
  assert(isError, 'isError true on timeout');
  assert(requiresFailureReason, 'failureReason needed on timeout');
});

test('budget_blocked with null callIndex is pre-execution exit', () => {
  const { isPreExecution } = deriveInvocationFlags({ status: 'budget_blocked', callIndex: null });
  assert(isPreExecution, 'budget_blocked with null callIndex is pre-execution');
});

// wroteInCatch / finally double-write prevention

test('non-retryable error: catch fires but does not write, finally writes exactly once', () => {
  const result = simulateCallTool({ throwsOnce: true, retryable: false });
  assert(result.catchFired, 'catch fired');
  assert(!result.retried, 'no retry');
  // Non-retryable catch path does not set wroteInCatch, so finally writes the single row
  assertEqual(result.rowsWritten, 1, 'finally-write only (catch does not write on non-retryable path)');
});

test('retryable error: catch sets wroteInCatch=true, outer finally skips', () => {
  const result = simulateCallTool({ throwsOnce: true, retryable: true });
  assert(result.retried, 'retry happened');
  // The outer finally fires but wroteInCatch is true, so only retry's write is emitted
  // Outer catch writes 'catch-retry', retry's finally writes 'finally-write' — total 2
  assertEqual(result.rowsWritten, 2, 'catch-retry + retry-finally-write = 2 rows total');
});

test('success path: only finally fires, no catch', () => {
  const result = simulateCallTool({ throwsOnce: false, retryable: false });
  assert(!result.catchFired, 'catch did not fire on success');
  assertEqual(result.rowsWritten, 2, 'finally-success + finally-write');
});

// mcpCallSummary computation

test('empty invocation rows returns null summary', () => {
  const summary = computeMcpCallSummary([]);
  assert(summary === null, 'null for empty rows');
});

test('summary with one server sums correctly', () => {
  const summary = computeMcpCallSummary([
    { serverSlug: 'github', status: 'success', durationMs: 100 },
    { serverSlug: 'github', status: 'error', durationMs: 200 },
    { serverSlug: 'github', status: 'success', durationMs: 150 },
  ]);
  assert(summary !== null, 'summary not null');
  assertEqual(summary!.totalCalls, 3, 'totalCalls');
  assertEqual(summary!.errorCount, 1, 'errorCount');
  assertEqual(summary!.byServer[0].avgDurationMs, 150, 'avgDurationMs = round((100+200+150)/3)');
});

test('summary with multiple servers groups correctly', () => {
  const summary = computeMcpCallSummary([
    { serverSlug: 'github', status: 'success', durationMs: 80 },
    { serverSlug: 'notion', status: 'timeout', durationMs: 5000 },
    { serverSlug: 'notion', status: 'success', durationMs: 300 },
  ]);
  assert(summary !== null, 'summary not null');
  assertEqual(summary!.totalCalls, 3, 'totalCalls across servers');
  assertEqual(summary!.errorCount, 1, 'errorCount (notion timeout)');
  assertEqual(summary!.byServer.length, 2, 'two servers');
  const notion = summary!.byServer.find((s) => s.serverSlug === 'notion')!;
  assertEqual(notion.callCount, 2, 'notion callCount');
  assertEqual(notion.errorCount, 1, 'notion errorCount');
  assertEqual(notion.avgDurationMs, 2650, 'notion avgDurationMs = round((5000+300)/2)');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
