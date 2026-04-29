import test from 'node:test';
import assert from 'node:assert/strict';

const SKIP = process.env.NODE_ENV !== 'integration';

let db: typeof import('../../db/index.js')['db'];
let systemIncidents: typeof import('../../db/schema/index.js')['systemIncidents'];
let eq: typeof import('drizzle-orm')['eq'];
let hashFingerprint: typeof import('../../services/incidentIngestorPure.js')['hashFingerprint'];
let runSkillAnalyzerJobWithIncidentEmission: typeof import('../skillAnalyzerJobWithIncidentEmission.js')['runSkillAnalyzerJobWithIncidentEmission'];

if (!SKIP) {
  ({ db } = await import('../../db/index.js'));
  ({ systemIncidents } = await import('../../db/schema/index.js'));
  ({ eq } = await import('drizzle-orm'));
  ({ hashFingerprint } = await import('../../services/incidentIngestorPure.js'));
  ({ runSkillAnalyzerJobWithIncidentEmission } = await import('../skillAnalyzerJobWithIncidentEmission.js'));
}

test('skill-analyzer wrapper re-throws + writes incident on TERMINAL attempt', { skip: SKIP }, async () => {
  const fingerprint = hashFingerprint('skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  const fakeJobId = 'test-job-' + Date.now();
  let propagatedError: unknown = null;
  try {
    // retryCount=1 with skill-analyzer.retryLimit=1 → terminal attempt → emit
    await runSkillAnalyzerJobWithIncidentEmission(fakeJobId, 1, {
      processFn: async (_jobId) => {
        throw new Error('simulated handler failure');
      },
    });
  } catch (err) {
    propagatedError = err;
  }

  assert.ok(propagatedError instanceof Error, 'expected error to be re-thrown');
  assert.equal((propagatedError as Error).message, 'simulated handler failure');

  // Wait for the incident write to commit (sync mode).
  await new Promise(r => setTimeout(r, 100));

  const [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  assert.ok(row, 'expected a system_incidents row from wrapper invocation');
  assert.equal(row.errorCode, 'skill_analyzer_failed');
  assert.equal(row.severity, 'high');
  assert.ok((row.latestErrorDetail as { jobId?: string }).jobId === fakeJobId, 'expected jobId in errorDetail');
});

test('skill-analyzer wrapper RE-THROWS but does NOT emit on non-terminal (retryCount < retryLimit)', { skip: SKIP }, async () => {
  const fingerprint = hashFingerprint('skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  const fakeJobId = 'test-job-pre-terminal-' + Date.now();
  let propagatedError: unknown = null;
  try {
    // retryCount=0 with skill-analyzer.retryLimit=1 → first attempt → no emit, rethrow only
    await runSkillAnalyzerJobWithIncidentEmission(fakeJobId, 0, {
      processFn: async (_jobId) => {
        throw new Error('transient failure');
      },
    });
  } catch (err) {
    propagatedError = err;
  }

  assert.ok(propagatedError instanceof Error, 'expected error to be re-thrown');
  assert.equal((propagatedError as Error).message, 'transient failure');

  // Wait the same window the terminal-emit test uses to be sure no async write slipped through.
  await new Promise(r => setTimeout(r, 100));

  const rows = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  assert.equal(rows.length, 0, 'non-terminal attempts must NOT emit a system_incidents row');
});

test('skill-analyzer dedup: 5 terminal failures collapse to one row with occurrenceCount=5', { skip: SKIP }, async () => {
  const fingerprint = hashFingerprint('skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  for (let i = 0; i < 5; i++) {
    // retryCount=1 → terminal → each call emits
    await runSkillAnalyzerJobWithIncidentEmission(`test-${i}`, 1, {
      processFn: async (_jobId) => {
        throw new Error('bang');
      },
    }).catch(() => {/* expected re-throw, ignore */});
    await new Promise(r => setTimeout(r, 50));
  }

  const [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  assert.ok(row, 'expected exactly one row from 5 failures');
  assert.equal(row.occurrenceCount, 5);
});
