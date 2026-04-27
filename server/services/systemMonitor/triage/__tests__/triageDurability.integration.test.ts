// guard-ignore-file: pure-helper-convention reason="Integration test requiring real DATABASE_URL — gracefully skips when none available"
/**
 * triageDurability — G1+G2 coordination contract (spec §7.3).
 *
 * Exercises the 5-step scenario against a real Postgres DB to verify:
 * - Idempotent triage attempt increment (G1)
 * - Staleness sweep recovery (G2)
 * - §11.0 single-writer terminal-event invariant
 *
 * Runnable via:
 *   npx tsx server/services/systemMonitor/triage/__tests__/triageDurability.integration.test.ts
 *
 * Requires DATABASE_URL to point to a real Postgres instance.
 * Gracefully skips if DATABASE_URL is unset or is a placeholder.
 *
 * Uses __testHooks.stubSystemOpsContext + throwAfterIncrement to isolate the
 * increment / idempotency predicate without needing a full org/agent context seeded.
 */
export {};

await import('dotenv/config');

// Set before any module imports so module-level consts pick up the overrides.
process.env.NODE_ENV     = 'test'; // required for __testHooks NODE_ENV guard in triageHandler
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM   ??= 'test-placeholder@example.com';
// Raise rate-limit cap so the test can call runTriage multiple times without hitting it.
process.env.SYSTEM_MONITOR_MAX_TRIAGE_PER_FINGERPRINT = '10';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.includes('placeholder')) {
  console.log('\nSKIP: triageDurability.integration.test requires a real DATABASE_URL.');
  console.log('Set DATABASE_URL to a live Postgres connection string to run this test.\n');
  process.exit(0);
}

const { db } = await import('../../../../db/index.js');
const { systemIncidents, systemIncidentEvents } = await import('../../../../db/schema/index.js');
const { eq, sql } = await import('drizzle-orm');
const { runTriage, __testHooks } = await import('../triageHandler.js');
const { runStaleTriageSweep } = await import('../staleTriageSweep.js');

// Verify migration 0238 has been applied before running any test.
try {
  await db.execute(sql`SELECT last_triage_job_id FROM system_incidents LIMIT 0`);
} catch {
  console.log('\nSKIP: migration 0238 not applied (column last_triage_job_id missing).');
  console.log('Apply the migration and re-run.\n');
  process.exit(0);
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

// Seed a test incident and return its ID. The incident has medium severity so
// the admit check passes, and a unique fingerprint so idempotency keys don't
// collide with any pre-existing row.
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

async function countEvents(incidentId: string, eventType: string): Promise<number> {
  const rows = await db
    .select({ id: systemIncidentEvents.id })
    .from(systemIncidentEvents)
    .where(
      sql`${systemIncidentEvents.incidentId} = ${incidentId}::uuid
        AND ${systemIncidentEvents.eventType} = ${eventType}`,
    );
  return rows.length;
}

const STUB_CTX = { organisationId: '00000000-0000-0000-0000-000000000001', agentId: '00000000-0000-0000-0000-000000000002' };

let incidentId = '';

try {
  incidentId = await seedIncident();

  await test('step 1 — first runTriage(id, job-A) increments counter and sets running', async () => {
    __testHooks.stubSystemOpsContext = STUB_CTX;
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
    check(row !== undefined, 'incident row must exist');
    check(row!.triageAttemptCount === 1, `count must be 1, got ${row!.triageAttemptCount}`);
    check(row!.lastTriageJobId === 'job-A', `last_triage_job_id must be 'job-A', got ${row!.lastTriageJobId}`);
    check(row!.triageStatus === 'running', `triage_status must be 'running', got ${row!.triageStatus}`);
  });

  await test('step 2 — advance last_triage_attempt_at 15 minutes into the past', async () => {
    const staleAt = new Date(Date.now() - 15 * 60 * 1000);
    await db
      .update(systemIncidents)
      .set({ lastTriageAttemptAt: staleAt })
      .where(eq(systemIncidents.id, incidentId));

    const row = await readIncident(incidentId);
    check(
      row!.lastTriageAttemptAt !== null && row!.lastTriageAttemptAt!.getTime() <= staleAt.getTime() + 100,
      'last_triage_attempt_at should be ~15 min in the past',
    );
  });

  await test('step 3 — runStaleTriageSweep flips running→failed, counter unchanged, exactly one event', async () => {
    const sweepNow = new Date();
    const { flipped } = await runStaleTriageSweep(sweepNow);

    check(flipped >= 1, `sweep must flip at least 1 row (flipped=${flipped})`);

    const row = await readIncident(incidentId);
    check(row!.triageStatus === 'failed', `triage_status must be 'failed' after sweep, got ${row!.triageStatus}`);
    check(row!.triageAttemptCount === 1, `count must remain 1 after sweep, got ${row!.triageAttemptCount}`);

    const eventCount = await countEvents(incidentId, 'agent_triage_timed_out');
    check(eventCount === 1, `exactly 1 agent_triage_timed_out event expected, got ${eventCount}`);
  });

  await test('step 4 — runTriage(id, job-B) increments counter and sets running', async () => {
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
    check(row!.triageAttemptCount === 2, `count must be 2, got ${row!.triageAttemptCount}`);
    check(row!.lastTriageJobId === 'job-B', `last_triage_job_id must be 'job-B', got ${row!.lastTriageJobId}`);
    check(row!.triageStatus === 'running', `triage_status must be 'running', got ${row!.triageStatus}`);
  });

  await test('step 5 — second runTriage(id, job-B) is idempotent skip, counter unchanged', async () => {
    // throwAfterIncrement NOT set — duplicate-job early-return happens before the hook
    const result = await runTriage(incidentId, 'job-B');

    check(result.status === 'skipped', `status must be 'skipped', got ${result.status}`);
    check(result.reason === 'duplicate_job', `reason must be 'duplicate_job', got ${result.reason}`);

    const row = await readIncident(incidentId);
    check(row!.triageAttemptCount === 2, `count must remain 2 after duplicate skip, got ${row!.triageAttemptCount}`);
  });

} finally {
  // Clean up test data regardless of test outcomes.
  __testHooks.stubSystemOpsContext = undefined;
  __testHooks.throwAfterIncrement = undefined;

  if (incidentId) {
    try {
      await db.delete(systemIncidents).where(eq(systemIncidents.id, incidentId));
    } catch {
      console.warn(`  WARN  Failed to clean up test incident ${incidentId}`);
    }
  }
  // Close the DB connection so the process can exit cleanly.
  try {
    const { client } = await import('../../../../db/index.js');
    await client.end();
  } catch {
    // best-effort
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
