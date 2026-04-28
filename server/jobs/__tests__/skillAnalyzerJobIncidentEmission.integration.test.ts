import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/index.js';
import { systemIncidents } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { hashFingerprint } from '../../services/incidentIngestorPure.js';

const SKIP = process.env.NODE_ENV !== 'integration';

test('skill-analyzer terminal failure produces a system_incidents row', { skip: SKIP }, async () => {
  const fingerprint = hashFingerprint('skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  const originalJobId = 'test-job-' + Date.now();
  let propagatedError: unknown = null;

  try {
    const { recordIncident } = await import('../../services/incidentIngestor.js');

    try {
      throw new Error('simulated handler failure');
    } catch (err) {
      recordIncident({
        source: 'job',
        severity: 'high',
        summary: `Skill analyzer terminal failure for job ${originalJobId}: simulated handler failure`,
        errorCode: 'skill_analyzer_failed',
        stack: err instanceof Error ? err.stack : undefined,
        fingerprintOverride: 'skill_analyzer:terminal_failure',
        errorDetail: { jobId: originalJobId },
      });
      throw err;
    }
  } catch (err) {
    propagatedError = err;
  }

  // Wait for the incident write to commit (sync mode).
  await new Promise(r => setTimeout(r, 100));

  const [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  assert.ok(row, 'expected a system_incidents row');
  assert.equal(row.source, 'job');
  assert.equal(row.severity, 'high');
  assert.equal(row.errorCode, 'skill_analyzer_failed');
  assert.ok((row.latestErrorDetail as { jobId?: string }).jobId === originalJobId, 'expected jobId in errorDetail');
  assert.ok(propagatedError instanceof Error, 'expected error to be re-thrown');
  assert.equal((propagatedError as Error).message, 'simulated handler failure');
});

test('skill-analyzer dedup: 5 failures collapse to one row with occurrenceCount=5', { skip: SKIP }, async () => {
  const fingerprint = hashFingerprint('skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  const { recordIncident } = await import('../../services/incidentIngestor.js');

  for (let i = 0; i < 5; i++) {
    recordIncident({
      source: 'job',
      severity: 'high',
      summary: `Skill analyzer terminal failure for job test-${i}: bang`,
      errorCode: 'skill_analyzer_failed',
      fingerprintOverride: 'skill_analyzer:terminal_failure',
      errorDetail: { jobId: `test-${i}` },
    });
    await new Promise(r => setTimeout(r, 50));
  }

  const [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  assert.ok(row, 'expected exactly one row from 5 failures');
  assert.equal(row.occurrenceCount, 5);
});
