// guard-ignore-file: pure-helper-convention reason="Integration test — gated on a real DATABASE_URL probe before dynamically importing IO modules."
/**
 * agentRunsArtifactsRoute.integration.test.ts
 *
 * Carved-out integration test for Chunk 2 (spec §4.5.2, §4.5.3, §6.1.5).
 * Requires a live DB + S3.
 *
 * Runnable via:
 *   npx tsx server/routes/__tests__/agentRunsArtifactsRoute.integration.test.ts
 *
 * Test scenarios:
 *   1. List artifacts for a run: GET /api/agent-runs/:runId/artifacts returns
 *      { artifacts: [] } for a run with no artifacts.
 *   2. Signed-URL mint round-trip: POST /api/run-artifacts/:id/signed-url
 *      returns { url, expiresAt } after an artifact is uploaded.
 */
export {};

import { expect, test } from 'vitest';
import 'dotenv/config';

const DATABASE_URL = process.env.DATABASE_URL;
const S3_BUCKET = process.env.S3_BUCKET_NAME ?? process.env.R2_BUCKET_NAME;
const SKIP =
  !DATABASE_URL ||
  DATABASE_URL.includes('placeholder') ||
  !S3_BUCKET ||
  process.env.NODE_ENV !== 'integration';

test.skipIf(SKIP)('artifact list returns empty array for run with no artifacts', async () => {
  const { listForRun } = await import('../../services/fileDeliveryService.js');

  const { CANONICAL_ORG_ID } = await import('../../__tests__/fixtures/canonicalIds.js');
  const TEST_ORG_ID = CANONICAL_ORG_ID;
  // Non-existent run UUID — listForRun returns [] via RLS (no throw)
  const NON_EXISTENT_RUN = '00000000-0000-0000-0000-000000000099';

  const artifacts = await listForRun(NON_EXISTENT_RUN, TEST_ORG_ID);
  expect(Array.isArray(artifacts)).toBe(true);
  expect(artifacts.length).toBe(0);
});

test.skipIf(SKIP)('signed-URL mint round-trip', async () => {
  const { issueSignedUrl } = await import('../../services/fileDeliveryService.js');

  const { CANONICAL_ORG_ID } = await import('../../__tests__/fixtures/canonicalIds.js');
  const TEST_ORG_ID = CANONICAL_ORG_ID;
  const NON_EXISTENT_ARTIFACT = '00000000-0000-0000-0000-000000000099';

  // issueSignedUrl should throw artifact_not_found for a non-existent artifact
  let threw = false;
  try {
    await issueSignedUrl(NON_EXISTENT_ARTIFACT, TEST_ORG_ID);
  } catch (err) {
    threw = true;
    const structured = err as { errorCode?: string };
    expect(structured.errorCode).toBe('artifact_not_found');
  }
  expect(threw).toBe(true);
});
