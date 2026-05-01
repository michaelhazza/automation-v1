// guard-ignore-file: pure-helper-convention reason="integration test uses conditional lazy imports for NODE_ENV gating; no static sibling module import is applicable"
import { expect, test } from 'vitest';
const SKIP = process.env.NODE_ENV !== 'integration';

let db: typeof import('../../db/index.js')['db'];
let systemIncidents: typeof import('../../db/schema/index.js')['systemIncidents'];
let eq: typeof import('drizzle-orm')['eq'];
let hashFingerprint: typeof import('../../services/incidentIngestorPure.js')['hashFingerprint'];
let runSkillAnalyzerJobWithIncidentEmission: typeof import('../skillAnalyzerJobWithIncidentEmission.js')['runSkillAnalyzerJobWithIncidentEmission'];
let resetThrottle: typeof import('../../services/incidentIngestorThrottle.js')['__resetForTest'];

if (!SKIP) {
  ({ db } = await import('../../db/index.js'));
  ({ systemIncidents } = await import('../../db/schema/index.js'));
  ({ eq } = await import('drizzle-orm'));
  ({ hashFingerprint } = await import('../../services/incidentIngestorPure.js'));
  ({ runSkillAnalyzerJobWithIncidentEmission } = await import('../skillAnalyzerJobWithIncidentEmission.js'));
  ({ __resetForTest: resetThrottle } = await import('../../services/incidentIngestorThrottle.js'));
}

test.skipIf(SKIP)('skill-analyzer wrapper re-throws + writes incident on TERMINAL attempt', async () => {
  resetThrottle();
  const fingerprint = hashFingerprint('job:skill_analyzer:terminal_failure');
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

  expect(propagatedError instanceof Error, 'expected error to be re-thrown').toBeTruthy();
  expect((propagatedError as Error).message).toBe('simulated handler failure');

  // Wait for the incident write to commit (sync mode).
  await new Promise(r => setTimeout(r, 100));

  const [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  expect(row, 'expected a system_incidents row from wrapper invocation').toBeTruthy();
  expect(row.errorCode).toBe('skill_analyzer_failed');
  expect(row.severity).toBe('high');
  expect((row.latestErrorDetail as { jobId?: string }).jobId, 'expected jobId in errorDetail').toBe(fakeJobId);
});

test.skipIf(SKIP)('skill-analyzer wrapper RE-THROWS but does NOT emit on non-terminal (retryCount < retryLimit)', async () => {
  const fingerprint = hashFingerprint('job:skill_analyzer:terminal_failure');
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

  expect(propagatedError instanceof Error, 'expected error to be re-thrown').toBeTruthy();
  expect((propagatedError as Error).message).toBe('transient failure');

  // Wait the same window the terminal-emit test uses to be sure no async write slipped through.
  await new Promise(r => setTimeout(r, 100));

  const rows = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  expect(rows.length, 'non-terminal attempts must NOT emit a system_incidents row').toBe(0);
});

test.skipIf(SKIP)('skill-analyzer dedup: 5 terminal failures collapse to one row with occurrenceCount=5', async () => {
  const fingerprint = hashFingerprint('job:skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  for (let i = 0; i < 5; i++) {
    // Reset throttle so each iteration's incident write reaches the DB regardless
    // of SYSTEM_INCIDENT_THROTTLE_MS in the CI environment.
    resetThrottle();
    // retryCount=1 → terminal → each call emits
    await runSkillAnalyzerJobWithIncidentEmission(`test-${i}`, 1, {
      processFn: async (_jobId) => {
        throw new Error('bang');
      },
    }).catch(() => {/* expected re-throw, ignore */});
    await new Promise(r => setTimeout(r, 50));
  }

  const [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  expect(row, 'expected exactly one row from 5 failures').toBeTruthy();
  expect(row.occurrenceCount).toBe(5);
});
