/**
 * fileDeliveryServicePure.test.ts — Unit tests for pure helpers.
 *
 * Covers: deriveStorageKey, deriveSignedUrlExpiry, deriveRetainUntil, mimeToExt.
 * No DB access, no S3, no mocking required.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveStorageKey,
  deriveSignedUrlExpiry,
  deriveRetainUntil,
  mimeToExt,
} from '../fileDeliveryServicePure.js';

// ---------------------------------------------------------------------------
// mimeToExt
// ---------------------------------------------------------------------------

describe('mimeToExt', () => {
  it('returns pdf for application/pdf', () => {
    expect(mimeToExt('application/pdf')).toBe('pdf');
  });

  it('returns bin for unknown mime type', () => {
    expect(mimeToExt('application/octet-stream')).toBe('bin');
  });

  it('returns mp4 for video/mp4', () => {
    expect(mimeToExt('video/mp4')).toBe('mp4');
  });
});

// ---------------------------------------------------------------------------
// deriveStorageKey
// ---------------------------------------------------------------------------

describe('deriveStorageKey', () => {
  const orgId = 'org-uuid-1234';
  const runId = 'run-uuid-5678';
  const hash = 'abc123def456';

  it('produces the correct path format', () => {
    const key = deriveStorageKey(orgId, runId, 'report', hash, 'application/pdf');
    expect(key).toBe(`orgs/${orgId}/runs/${runId}/report/${hash}.pdf`);
  });

  it('uses artifact_kind in the path', () => {
    const key = deriveStorageKey(orgId, runId, 'transcript', hash, 'text/plain');
    expect(key).toBe(`orgs/${orgId}/runs/${runId}/transcript/${hash}.txt`);
  });

  it('falls back to bin extension for unknown mime type', () => {
    const key = deriveStorageKey(orgId, runId, 'log', hash, 'application/octet-stream');
    expect(key).toBe(`orgs/${orgId}/runs/${runId}/log/${hash}.bin`);
  });

  it('handles all artifact kinds', () => {
    const kinds = ['report', 'transcript', 'media', 'attachment', 'log'] as const;
    for (const kind of kinds) {
      const key = deriveStorageKey(orgId, runId, kind, hash, 'application/pdf');
      expect(key).toMatch(new RegExp(`orgs/${orgId}/runs/${runId}/${kind}/${hash}\\.pdf`));
    }
  });
});

// ---------------------------------------------------------------------------
// deriveSignedUrlExpiry
// ---------------------------------------------------------------------------

describe('deriveSignedUrlExpiry', () => {
  it('returns 604800 (7 days) for report', () => {
    expect(deriveSignedUrlExpiry('report')).toBe(604800);
  });

  it('returns 86400 (24h) for transcript', () => {
    expect(deriveSignedUrlExpiry('transcript')).toBe(86400);
  });

  it('returns 86400 (24h) for media', () => {
    expect(deriveSignedUrlExpiry('media')).toBe(86400);
  });

  it('returns 86400 (24h) for attachment', () => {
    expect(deriveSignedUrlExpiry('attachment')).toBe(86400);
  });

  it('returns 86400 (24h) for log', () => {
    expect(deriveSignedUrlExpiry('log')).toBe(86400);
  });
});

// ---------------------------------------------------------------------------
// deriveRetainUntil
// ---------------------------------------------------------------------------

describe('deriveRetainUntil', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('returns 90 days for report', () => {
    const result = deriveRetainUntil('report', now);
    const expected = new Date('2026-04-01T00:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('returns 30 days for transcript', () => {
    const result = deriveRetainUntil('transcript', now);
    const expected = new Date('2026-01-31T00:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('returns 30 days for media', () => {
    const result = deriveRetainUntil('media', now);
    const expected = new Date('2026-01-31T00:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('returns 90 days for attachment', () => {
    const result = deriveRetainUntil('attachment', now);
    const expected = new Date('2026-04-01T00:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('returns 14 days for log', () => {
    const result = deriveRetainUntil('log', now);
    const expected = new Date('2026-01-15T00:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('does not mutate the input date', () => {
    const input = new Date('2026-01-01T00:00:00Z');
    const inputTime = input.getTime();
    deriveRetainUntil('report', input);
    expect(input.getTime()).toBe(inputTime);
  });
});
