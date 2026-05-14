// Shared types for run_artifacts — the customer-facing file delivery ledger.
// Pure types only — no DB access, no service imports.

export interface RunArtifact {
  id: string;
  organisationId: string;
  agentRunId: string | null;
  ieeRunId: string | null;
  artifactKind: 'report' | 'transcript' | 'media' | 'attachment' | 'log';
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string; // sha256 hex
  storageProvider: 's3' | 'gcs' | 'r2';
  storageKey: string;
  storageRegion: string | null;
  retainUntil: Date | null;
  downloadCount: number;
  createdAt: Date;
}

export interface UploadInput {
  organisationId: string;
  agentRunId: string;
  ieeRunId?: string;
  artifactKind: RunArtifact['artifactKind'];
  displayName: string;
  mimeType: string;
  contentBuffer: Buffer | NodeJS.ReadableStream;
  retainUntil?: Date;
}

export interface UploadResult {
  artifactId: string;
  contentHash: string;
  sizeBytes: number;
  wasReplay: boolean; // true on idempotent hit
}

export interface SignedUrlOptions {
  expiresIn?: number; // seconds; default 7 days for report, 24h for media/others
  inlineDisposition?: boolean;
}
