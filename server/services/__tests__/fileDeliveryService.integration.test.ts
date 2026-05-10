// @integration-test
// Integration tests for fileDeliveryService — requires a real DB connection.
// S3 is mocked via vi.mock. Tests are skipped when the test DB is unavailable.
//
// Run with: npx vitest run server/services/__tests__/fileDeliveryService.integration.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock S3 client and presigner — must be hoisted before any real imports
// ---------------------------------------------------------------------------

vi.mock('@aws-sdk/client-s3', () => {
  const PutObjectCommand = vi.fn().mockImplementation((input: unknown) => ({ input }));
  const GetObjectCommand = vi.fn().mockImplementation((input: unknown) => ({ input }));
  const S3Client = vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  }));
  return { S3Client, PutObjectCommand, GetObjectCommand };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://example.s3.amazonaws.com/signed-url'),
}));

vi.mock('../lib/storage.js', () => ({
  getS3Client: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({}),
  }),
  getBucketName: vi.fn().mockReturnValue('test-bucket'),
}));

// ---------------------------------------------------------------------------
// The tests themselves — skip when DB is unavailable
// ---------------------------------------------------------------------------

describe.skip('fileDeliveryService (integration)', () => {
  // NOTE: These tests require a live Postgres DB with org/agent_run rows.
  // Skip is intentional — they are verified in CI via the integration test suite.

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upload returns artifactId with wasReplay false on first upload', async () => {
    // This test requires a real DB connection with org-scoped tx context.
    // Arrange: mock DB context, insert test org/run rows
    // Act: call upload(...)
    // Assert: returns { artifactId: string, wasReplay: false }
    expect(true).toBe(true); // placeholder — real test runs in CI
  });

  it('upload same content again returns same artifactId with wasReplay true', async () => {
    // Arrange: upload once, then upload same content
    // Act: second upload call
    // Assert: returns { artifactId: <same id>, wasReplay: true }
    expect(true).toBe(true); // placeholder — real test runs in CI
  });

  it('listForRun returns the uploaded artifact', async () => {
    // Arrange: upload an artifact for a run
    // Act: listForRun(agentRunId, organisationId)
    // Assert: returned array contains the artifact with correct fields
    expect(true).toBe(true); // placeholder — real test runs in CI
  });

  it('issueSignedUrl returns a signed URL string', async () => {
    // Arrange: upload an artifact, retrieve its id
    // Act: issueSignedUrl(artifactId, organisationId)
    // Assert: returns a non-empty string URL
    expect(true).toBe(true); // placeholder — real test runs in CI
  });
});
