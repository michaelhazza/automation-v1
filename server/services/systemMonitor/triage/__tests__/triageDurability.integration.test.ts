// guard-ignore-file: pure-helper-convention reason="Integration test — gated on a real DATABASE_URL probe before dynamically importing the IO modules; static sibling imports would force module-load before the skip check."
/**
 * triageDurability — G1+G2 coordination contract (spec §7.3).
 *
 * Exercises the 5-step scenario against a real Postgres DB to verify:
 * - Idempotent triage attempt increment (G1)
 * - Staleness sweep recovery (G2)
 * - §11.0 single-writer terminal-event invariant
 *
 * Requires DATABASE_URL to point to a real Postgres instance and
 * NODE_ENV=integration.
 *
 * Uses __testHooks.stubSystemOpsContext + throwAfterIncrement to isolate the
 * increment / idempotency predicate without needing a full org/agent context
 * seeded — but the canonical org+agent (00000000-0000-0000-0000-000000000001
 * / 00000000-0000-0000-0000-000000000002) must exist via
 * scripts/seed-integration-fixtures.ts so any FK on systemIncidentEvents
 * resolves.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import 'dotenv/config';

process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';
// Raise rate-limit cap so the test can call runTriage multiple times without hitting it.
process.env.SYSTEM_MONITOR_MAX_TRIAGE_PER_FINGERPRINT ??= '10';

const SKIP_TRIAGE_DUR =
  !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes('placeholder') ||
  process.env.NODE_ENV !== 'integration';

const STUB_CTX = {
  organisationId: '00000000-0000-0000-0000-000000000001',
  agentId: '00000000-0000-0000-0000-000000000002',
};

describe.skipIf(SKIP_TRIAGE_DUR)('triageDurability — G1+G2 coordination contract', () => {
  let db: Awaited<typeof import('../../../../db/index.js')>['db'];
  let client: Awaited<typeof import('../../../../db/index.js')>['client'];
  let systemIncidents: Awaited<typeof import('../../../../db/schema/index.js')>['systemIncidents'];
  let systemIncidentEvents: Awaited<typeof import('../../../../db/schema/index.js')>['systemIncidentEvents'];
  let eq: Awaited<typeof import('drizzle-orm')>['eq'];
  let sql: Awaited<typeof import('drizzle-orm')>['sql'];
  let runTriage: Awaited<typeof import('../triageHandler.js')>['runTriage'];
  let __testHooks: Awaited<typeof import('../triageHandler.js')>['__testHooks'];
  let runStaleTriageSweep: Awaited<typeof import('../staleTriageSweep.js')>['runStaleTriageSweep'];

  let migrationOk = true;
  let incidentId = '';

  beforeAll(async () => {
    ({ db, client } = await import('../../../../db/index.js'));
    ({ systemIncidents, systemIncidentEvents } = await import('../../../../db/schema/index.js'));
    ({ eq, sql } = await import('drizzle-orm'));
    ({ runTriage, __testHooks } = await import('../triageHandler.js'));
    ({ runStaleTriageSweep } = await import('../staleTriageSweep.js'));

    try {
      await db.execute(sql`SELECT last_triage_job_id FROM system_incidents LIMIT 0`);
    } catch {
      migrationOk = false;
      return;
    }

    incidentId = await seedIncident();
    __testHooks.stubSystemOpsContext = STUB_CTX;
  });

  afterAll(async () => {
    __testHooks.stubSystemOpsContext = undefined;
    __testHooks.throwAfterIncrement = undefined;

    if (incidentId) {
      try {
        await db.delete(systemIncidents).where(eq(systemIncidents.id, incidentId));
      } catch {
        // best-effort cleanup
      }
    }
    if (client) {
      try {
        await client.end();
      } catch {
        // best-effort cleanup
      }
    }
  });

  async function seedIncident(): Promise<string> {
    const fingerprint = `test:triage-durability:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const [row] = await db
      .insert(systemIncidents)
      .values({
        fingerprint,
        source: 'synthetic',
        severity: 'medium',
        summary: 'Integration test: triage durability (auto-cleanup on test exit)',
      })
      .returning({ id: systemIncidents.id });
    if (!row) throw new Error('Failed to seed test incident');
    return row.id;
  }

  async function readIncident(id: string) {
    const [row] = await db
      .select({
        triageAttemptCount: systemIncidents.triageAttemptCount,
        lastTriageJobId: systemIncidents.lastTriageJobId,
        triageStatus: systemIncidents.triageStatus,
        lastTriageAttemptAt: systemIncidents.lastTriageAttemptAt,
      })
      .from(systemIncidents)
      .where(eq(systemIncidents.id, id))
      .limit(1);
    return row;
  }

  async function countEvents(id: string, eventType: string): Promise<number> {
    const rows = await db
      .select({ id: systemIncidentEvents.id })
      .from(systemIncidentEvents)
      .where(
        sql`${systemIncidentEvents.incidentId} = ${id}::uuid
          AND ${systemIncidentEvents.eventType} = ${eventType}`,
      );
    return rows.length;
  }

  test('step 1 — first runTriage(id, job-A) increments counter and sets running', async () => {
    if (!migrationOk) return;
    __testHooks.throwAfterIncrement = true;
    try {
      await runTriage(incidentId, 'job-A');
      throw new Error('Expected throwAfterIncrement to fire, but runTriage returned normally');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('__testHooks.throwAfterIncrement')) throw err;
    } finally {
      __testHooks.throwAfterIncrement = undefined;
    }

    const row = await readIncident(incidentId);
    expect(row).toBeDefined();
    expect(row!.triageAttemptCount).toBe(1);
    expect(row!.lastTriageJobId).toBe('job-A');
    expect(row!.triageStatus).toBe('running');
  });

  test('step 2 — advance last_triage_attempt_at 15 minutes into the past', async () => {
    if (!migrationOk) return;
    const staleAt = new Date(Date.now() - 15 * 60 * 1000);
    await db
      .update(systemIncidents)
      .set({ lastTriageAttemptAt: staleAt })
      .where(eq(systemIncidents.id, incidentId));

    const row = await readIncident(incidentId);
    expect(row!.lastTriageAttemptAt).not.toBeNull();
    expect(row!.lastTriageAttemptAt!.getTime() <= staleAt.getTime() + 100).toBeTruthy();
  });

  test('step 3 — runStaleTriageSweep flips running→failed, counter unchanged, exactly one event', async () => {
    if (!migrationOk) return;
    const sweepNow = new Date();
    const { flipped } = await runStaleTriageSweep(sweepNow);
    expect(flipped).toBeGreaterThanOrEqual(1);

    const row = await readIncident(incidentId);
    expect(row!.triageStatus).toBe('failed');
    expect(row!.triageAttemptCount).toBe(1);

    const eventCount = await countEvents(incidentId, 'agent_triage_timed_out');
    expect(eventCount).toBe(1);
  });

  test('step 4 — runTriage(id, job-B) increments counter and sets running', async () => {
    if (!migrationOk) return;
    __testHooks.throwAfterIncrement = true;
    try {
      await runTriage(incidentId, 'job-B');
      throw new Error('Expected throwAfterIncrement to fire, but runTriage returned normally');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('__testHooks.throwAfterIncrement')) throw err;
    } finally {
      __testHooks.throwAfterIncrement = undefined;
    }

    const row = await readIncident(incidentId);
    expect(row!.triageAttemptCount).toBe(2);
    expect(row!.lastTriageJobId).toBe('job-B');
    expect(row!.triageStatus).toBe('running');
  });

  test('step 5 — second runTriage(id, job-B) is idempotent skip, counter unchanged', async () => {
    if (!migrationOk) return;
    const result = await runTriage(incidentId, 'job-B');
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('duplicate_job');

    const row = await readIncident(incidentId);
    expect(row!.triageAttemptCount).toBe(2);
  });
});
