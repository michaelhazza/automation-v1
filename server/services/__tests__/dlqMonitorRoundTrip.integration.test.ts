import { expect, test } from 'vitest';
import { db } from '../../db/index.js';
import { systemIncidents } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { hashFingerprint } from '../incidentIngestorPure.js';

const SKIP = process.env.NODE_ENV !== 'integration';

test.skipIf(SKIP)('DLQ round-trip: poison job → __dlq → system_incidents row', async () => {
  const queue = 'workflow-run-tick';
  const fingerprint = hashFingerprint(`job:${queue}:dlq`);

  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  // Implementer-supplied: enqueue a poison job with retryLimit=0 so it lands
  // directly in workflow-run-tick__dlq. Use the existing pg-boss test seam if
  // present; otherwise inject the DLQ event by sending to the __dlq queue
  // directly.
  // const boss = await getPgBoss();
  // await boss.send('workflow-run-tick__dlq', { jobId: 'fake-test-job', error: 'forced' });

  let row;
  for (let i = 0; i < 30; i++) {
    [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
    if (row) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  expect(row).toBeTruthy();
  expect(row.source).toBe('job');
  expect(row.severity).toBe('high');
  expect(row.errorCode).toBe('job_dlq');
  expect(row.occurrenceCount).toBe(1);
});
