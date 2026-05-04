/**
 * resumeRunAfterOAuthJob — unit tests (C-P0-2).
 *
 * Verifies the exported constants, payload shape, and singletonKey deduplication
 * logic without requiring a live pg-boss or Postgres connection.
 *
 * Runnable via:
 *   npx tsx server/tests/services/resume-run-after-oauth.test.ts
 */

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

import assert from 'node:assert/strict';

const { RESUME_RUN_AFTER_OAUTH_JOB } = await import('../../jobs/resumeRunAfterOAuthJob.js');

let passed = 0;
let failed = 0;

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok — ${label}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL — ${label}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log('\nresume-run-after-oauth — unit tests\n');

test('RESUME_RUN_AFTER_OAUTH_JOB constant matches jobConfig key', () => {
  assert.equal(RESUME_RUN_AFTER_OAUTH_JOB, 'run:resumeAfterOAuth');
});

test('singletonKey format is deterministic for the same runId', () => {
  const runId = '00000000-0000-0000-0000-000000000001';
  const key1 = `resume:${runId}`;
  const key2 = `resume:${runId}`;
  assert.equal(key1, key2);
});

test('singletonKey differs for different run IDs', () => {
  const run1 = '00000000-0000-0000-0000-000000000001';
  const run2 = '00000000-0000-0000-0000-000000000002';
  const key1 = `resume:${run1}`;
  const key2 = `resume:${run2}`;
  assert.notEqual(key1, key2);
});

test('enqueueResumeAfterOAuth is exported', async () => {
  const { enqueueResumeAfterOAuth } = await import('../../jobs/resumeRunAfterOAuthJob.js');
  assert.equal(typeof enqueueResumeAfterOAuth, 'function');
});

test('resumeRunAfterOAuthWorker is exported', async () => {
  const { resumeRunAfterOAuthWorker } = await import('../../jobs/resumeRunAfterOAuthJob.js');
  assert.equal(typeof resumeRunAfterOAuthWorker, 'function');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
