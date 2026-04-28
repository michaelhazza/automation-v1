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

test('skill-analyzer wrapper re-throws + writes incident', { skip: SKIP }, async () => {
  const fingerprint = hashFingerprint('skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  const fakeJobId = 'test-job-' + Date.now();
  let propagatedError: unknown = null;
  try {
    await runSkillAnalyzerJobWithIncidentEmission(fakeJobId, {
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

test('skill-analyzer dedup: 5 failures collapse to one row with occurrenceCount=5', { skip: SKIP }, async () => {
  const fingerprint = hashFingerprint('skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  for (let i = 0; i < 5; i++) {
    await runSkillAnalyzerJobWithIncidentEmission(`test-${i}`, {
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
