// Pure helpers for fileDeliveryService — no DB access, no side effects.
// Extracted here so they can be unit-tested without any mocking.

import type { RunArtifact } from '../../shared/types/runArtifact.js';

// ---------------------------------------------------------------------------
// MIME type → file extension mapping
// ---------------------------------------------------------------------------

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/markdown': 'md',
  'application/json': 'json',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'application/zip': 'zip',
  'application/gzip': 'gz',
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export function mimeToExt(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? 'bin';
}

// ---------------------------------------------------------------------------
// Storage key derivation
// Format: orgs/{org_id}/runs/{run_id}/{artifact_kind}/{content_hash}.{ext}
// ---------------------------------------------------------------------------

export function deriveStorageKey(
  organisationId: string,
  agentRunId: string,
  artifactKind: RunArtifact['artifactKind'],
  contentHash: string,
  mimeType: string,
): string {
  const ext = mimeToExt(mimeType);
  return `orgs/${organisationId}/runs/${agentRunId}/${artifactKind}/${contentHash}.${ext}`;
}

// ---------------------------------------------------------------------------
// Signed URL TTL
// report: 7 days (604800s), all others: 24h (86400s)
// ---------------------------------------------------------------------------

export function deriveSignedUrlExpiry(artifactKind: RunArtifact['artifactKind']): number {
  if (artifactKind === 'report') {
    return 604800; // 7 days
  }
  return 86400; // 24 hours
}

// ---------------------------------------------------------------------------
// Retention defaults (days)
// report: 90, transcript: 30, media: 30, attachment: 90, log: 14
// ---------------------------------------------------------------------------

const RETENTION_DAYS: Record<RunArtifact['artifactKind'], number> = {
  report: 90,
  transcript: 30,
  media: 30,
  attachment: 90,
  log: 14,
};

export function deriveRetainUntil(
  artifactKind: RunArtifact['artifactKind'],
  now: Date,
): Date {
  const days = RETENTION_DAYS[artifactKind];
  const result = new Date(now.getTime());
  result.setDate(result.getDate() + days);
  return result;
}
