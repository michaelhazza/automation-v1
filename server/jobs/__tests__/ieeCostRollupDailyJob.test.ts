// guard-ignore-file: pure-helper-convention reason="env preamble must run before module-level env parse fires; dynamic import used after env setup"
/**
 * ieeCostRollupDailyJob — unit tests (iee-worker-retirement spec §4 Chunk 1).
 *
 * Verifies the exported queue name, cron schedule, and registration flow
 * without requiring a live pg-boss or Postgres connection. The SQL itself
 * is exercised by the manual smoke gate (spec §5) and by CI integration
 * runs.
 */
import { expect, test, vi } from 'vitest';

export {};

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';
process.env.JOB_QUEUE_BACKEND ??= 'pg-boss';

const scheduleCalls: Array<{ name: string; cron: string; opts: unknown }> = [];
const workCalls: Array<{ name: string }> = [];
const executedQueries: string[] = [];

vi.mock('../../lib/pgBossInstance.js', () => ({
  getPgBoss: async () => ({
    work: async (name: string) => { workCalls.push({ name }); },
    schedule: async (name: string, cron: string, _data: unknown, opts: unknown) => {
      scheduleCalls.push({ name, cron, opts });
    },
  }),
}));

vi.mock('../../lib/adminDbConnection.js', () => ({
  withAdminConnection: async (
    _ctx: unknown,
    fn: (tx: { execute: (q: unknown) => Promise<void> }) => Promise<void>,
  ) => {
    await fn({
      execute: async (q: unknown) => {
        // Drizzle sql template — `sql.queryChunks` is the raw string segments.
        const chunks = (q as { queryChunks?: Array<{ value?: string[] }> }).queryChunks ?? [];
        const text = chunks
          .map((c) => (Array.isArray(c.value) ? c.value.join('') : ''))
          .join('');
        executedQueries.push(text);
      },
    });
  },
}));

const mod = await import('../ieeCostRollupDailyJob.js');

test('exports registerIeeCostRollupDailyJob and runIeeCostRollup', () => {
  expect(typeof mod.registerIeeCostRollupDailyJob).toBe('function');
  expect(typeof mod.runIeeCostRollup).toBe('function');
});

test('registerIeeCostRollupDailyJob schedules with idempotent name and 02:10 UTC cron', async () => {
  scheduleCalls.length = 0;
  workCalls.length = 0;

  await mod.registerIeeCostRollupDailyJob();

  expect(workCalls).toEqual([{ name: 'iee-cost-rollup-daily' }]);
  expect(scheduleCalls).toHaveLength(1);
  expect(scheduleCalls[0].name).toBe('iee-cost-rollup-daily');
  expect(scheduleCalls[0].cron).toBe('10 2 * * *');
  expect(scheduleCalls[0].opts).toEqual({ tz: 'UTC' });
});

test('runIeeCostRollup emits two cost_aggregates upserts both supplying organisation_id (migration-0272 regression guard)', async () => {
  executedQueries.length = 0;
  await mod.runIeeCostRollup();

  // Filter out the SET LOCAL ROLE statement.
  const inserts = executedQueries.filter((q) => /INSERT INTO cost_aggregates/.test(q));
  expect(inserts).toHaveLength(2);

  for (const sql of inserts) {
    // organisation_id MUST appear in the INSERT column list — migration 0272
    // made it NOT NULL on cost_aggregates and the original worker SQL
    // pre-dated the migration. Regression guard against the pre-migration
    // shape returning.
    expect(sql).toMatch(/INSERT INTO cost_aggregates\s*\(\s*organisation_id\s*,/);
    expect(sql).toMatch(/FROM iee_runs/);
    expect(sql).toMatch(/GROUP BY organisation_id/);
    expect(sql).toMatch(/ON CONFLICT/);
  }

  // One INSERT for entity_type='iee_run' (LLM cost), one for 'iee_runtime'
  // (compute cost). Confirms both branches still emit.
  expect(inserts.some((q) => /'iee_run'\s+AS entity_type/.test(q))).toBe(true);
  expect(inserts.some((q) => /'iee_runtime'\s+AS entity_type/.test(q))).toBe(true);
});
