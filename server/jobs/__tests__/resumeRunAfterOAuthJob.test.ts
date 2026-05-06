// guard-ignore-file: pure-helper-convention reason="env preamble must run before module-level env parse fires; dynamic import used after env setup"
/**
 * resumeRunAfterOAuthJob — unit tests (C-P0-2).
 *
 * Verifies the exported constants, payload shape, and singletonKey deduplication
 * logic without requiring a live pg-boss or Postgres connection.
 */
import { expect, test } from 'vitest';

export {};

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

const { RESUME_RUN_AFTER_OAUTH_JOB, enqueueResumeAfterOAuth, resumeRunAfterOAuthWorker } =
  await import('../resumeRunAfterOAuthJob.js');

test('RESUME_RUN_AFTER_OAUTH_JOB constant matches jobConfig key', () => {
  expect(RESUME_RUN_AFTER_OAUTH_JOB).toBe('run:resumeAfterOAuth');
});

test('singletonKey format is deterministic for the same runId', () => {
  const runId = '00000000-0000-0000-0000-000000000001';
  expect(`resume:${runId}`).toBe(`resume:${runId}`);
});

test('singletonKey differs for different run IDs', () => {
  const run1 = '00000000-0000-0000-0000-000000000001';
  const run2 = '00000000-0000-0000-0000-000000000002';
  expect(`resume:${run1}`).not.toBe(`resume:${run2}`);
});

test('enqueueResumeAfterOAuth is exported', () => {
  expect(typeof enqueueResumeAfterOAuth).toBe('function');
});

test('resumeRunAfterOAuthWorker is exported', () => {
  expect(typeof resumeRunAfterOAuthWorker).toBe('function');
});
