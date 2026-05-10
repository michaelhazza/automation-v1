// guard-ignore-file: pure-helper-convention reason="Uses vi.mock to stub db/instrumentation; dynamic import used after mock registration"
/**
 * workingTimeRollupCompactJob.test.ts
 *
 * Verifies the compact step:
 *   - Seeds in-memory rows past the 1-year retention boundary.
 *   - Runs the compact step via a mock DB.
 *   - Asserts rows past retention are deleted and no SQL error is thrown.
 *
 * No real Postgres required — all DB calls are mocked.
 *
 * Run via: npx vitest run server/jobs/__tests__/workingTimeRollupCompactJob.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory row store — simulates agent_working_time_rollups
// ---------------------------------------------------------------------------

type RollupRow = {
  organisation_id: string;
  agent_id: string;
  bucket_date: string; // 'YYYY-MM-DD'
  working_time_seconds: number;
  total_run_count: number;
  successful_runs: number;
  failed_runs: number;
  partial_runs: number;
};

let store: RollupRow[] = [];

// Retention cutoff: rows with bucket_date < (today - 1 year) are compacted.
function retentionCutoff(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d;
}

function isPastRetention(row: RollupRow): boolean {
  return new Date(row.bucket_date) < retentionCutoff();
}

// ---------------------------------------------------------------------------
// Mock SQL execution — captures what the real CTE would do:
//   1. Aggregate daily rows older than 1 year per (org, agent, month).
//   2. Delete those daily rows.
//   3. Upsert monthly summary rows.
// ---------------------------------------------------------------------------

function simulateCompact(orgId: string): void {
  const toDelete = store.filter(
    (r) => r.organisation_id === orgId && isPastRetention(r),
  );

  // Build monthly aggregates
  const monthlyMap = new Map<string, RollupRow>();
  for (const row of toDelete) {
    const month = row.bucket_date.substring(0, 7); // 'YYYY-MM'
    const key = `${orgId}|${row.agent_id}|${month}`;
    const existing = monthlyMap.get(key);
    if (existing) {
      existing.working_time_seconds += row.working_time_seconds;
      existing.total_run_count += row.total_run_count;
      existing.successful_runs += row.successful_runs;
      existing.failed_runs += row.failed_runs;
      existing.partial_runs += row.partial_runs;
    } else {
      monthlyMap.set(key, {
        organisation_id: orgId,
        agent_id: row.agent_id,
        bucket_date: `${month}-01`,
        working_time_seconds: row.working_time_seconds,
        total_run_count: row.total_run_count,
        successful_runs: row.successful_runs,
        failed_runs: row.failed_runs,
        partial_runs: row.partial_runs,
      });
    }
  }

  // Delete daily rows (mirrors the CTE DELETE — no RETURNING needed)
  store = store.filter(
    (r) => !(r.organisation_id === orgId && isPastRetention(r)),
  );

  // Upsert monthly rows (ON CONFLICT DO UPDATE — additive)
  for (const monthly of monthlyMap.values()) {
    const existing = store.find(
      (r) =>
        r.organisation_id === monthly.organisation_id &&
        r.agent_id === monthly.agent_id &&
        r.bucket_date === monthly.bucket_date,
    );
    if (existing) {
      existing.working_time_seconds += monthly.working_time_seconds;
      existing.total_run_count += monthly.total_run_count;
      existing.successful_runs += monthly.successful_runs;
      existing.failed_runs += monthly.failed_runs;
      existing.partial_runs += monthly.partial_runs;
    } else {
      store.push(monthly);
    }
  }
}

// ---------------------------------------------------------------------------
// Mocks — must be registered before the module under test is imported
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const AGENT_ID = '00000000-0000-0000-0000-000000000002';

vi.mock('../../db/index.js', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        execute: vi.fn(async () => {
          simulateCompact(ORG_ID);
        }),
      };
      return fn(tx);
    }),
  },
}));

vi.mock('../../lib/adminDbConnection.js', () => ({
  withAdminConnection: vi.fn(async (_opts: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn(async () => [{ id: ORG_ID }]),
    };
    return fn(tx);
  }),
}));

vi.mock('../../instrumentation.js', () => ({
  withOrgTx: vi.fn(async (_ctx: unknown, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Dynamic import after mocks are registered
const { runWorkingTimeRollupCompact } = await import('../workingTimeRollupCompactJob.js');

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

// Hoisted so test assertions can derive the expected month from the seeded date
let pastDate1: Date;

describe('workingTimeRollupCompactJob — compact step', () => {
  beforeEach(() => {
    // Seed rows: 2 daily rows past retention (>1 year old), 1 recent row
    pastDate1 = new Date();
    pastDate1.setFullYear(pastDate1.getFullYear() - 2);
    const pastDate2 = new Date(pastDate1);
    pastDate2.setDate(pastDate2.getDate() + 1);
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 30);

    const formatDate = (d: Date) => d.toISOString().substring(0, 10);

    store = [
      {
        organisation_id: ORG_ID,
        agent_id: AGENT_ID,
        bucket_date: formatDate(pastDate1),
        working_time_seconds: 3600,
        total_run_count: 10,
        successful_runs: 8,
        failed_runs: 1,
        partial_runs: 1,
      },
      {
        organisation_id: ORG_ID,
        agent_id: AGENT_ID,
        bucket_date: formatDate(pastDate2),
        working_time_seconds: 1800,
        total_run_count: 5,
        successful_runs: 4,
        failed_runs: 1,
        partial_runs: 0,
      },
      {
        organisation_id: ORG_ID,
        agent_id: AGENT_ID,
        bucket_date: formatDate(recentDate),
        working_time_seconds: 900,
        total_run_count: 3,
        successful_runs: 3,
        failed_runs: 0,
        partial_runs: 0,
      },
    ];
  });

  it('compact step deletes daily rows past retention and leaves recent rows intact; no SQL error thrown', async () => {
    // Confirm initial state: 2 past-retention rows, 1 recent row
    const initialPastCount = store.filter(isPastRetention).length;
    expect(initialPastCount).toBe(2);
    expect(store.length).toBe(3);

    // Run compact — should not throw
    const result = await runWorkingTimeRollupCompact();
    expect(result.status).toBe('success');
    expect(result.orgsAttempted).toBe(1);
    expect(result.orgsSucceeded).toBe(1);
    expect(result.orgsFailed).toBe(0);

    // After compact: past-retention daily rows are gone
    const remainingPastDailyRows = store.filter(
      (r) => isPastRetention(r) && r.bucket_date !== `${r.bucket_date.substring(0, 7)}-01`,
    );
    expect(remainingPastDailyRows.length).toBe(0);

    // Recent row is preserved
    const recentRows = store.filter((r) => !isPastRetention(r));
    expect(recentRows.length).toBe(1);
    expect(recentRows[0].working_time_seconds).toBe(900);

    // Monthly rollup row was inserted/upserted for the past period
    // The monthly summary (bucket_date ends in -01) should exist and aggregate the two daily rows
    const expectedMonth = pastDate1.toISOString().substring(0, 7); // 'YYYY-MM'
    const monthlyRollup = store.find((r) => r.bucket_date.endsWith('-01'));
    expect(monthlyRollup).toBeDefined();
    expect(monthlyRollup!.bucket_date).toBe(`${expectedMonth}-01`);
    expect(monthlyRollup!.working_time_seconds).toBe(5400); // 3600 + 1800
    expect(monthlyRollup!.total_run_count).toBe(15); // 10 + 5
  });
});
