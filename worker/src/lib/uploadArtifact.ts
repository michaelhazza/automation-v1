// Worker-side artifact upload helper (Option B proxy).
// POSTs a base64-encoded file to the main-app finalize endpoint.
// The main app handles S3 upload and run_artifacts insert.

import { logger } from '../logger.js';
import type { UploadResult } from '../../../shared/types/runArtifact.js';
import type { RunArtifact } from '../../../shared/types/runArtifact.js';

export interface WorkerUploadInput {
  organisationId: string;
  agentRunId: string;
  ieeRunId?: string;
  artifactKind: RunArtifact['artifactKind'];
  displayName: string;
  mimeType: string;
  contentBuffer: Buffer;
  retainUntil?: Date;
}

export async function uploadArtifact(input: WorkerUploadInput): Promise<UploadResult> {
  const mainAppUrl = process.env.MAIN_APP_URL;
  const workerSecret = process.env.WORKER_SHARED_SECRET;

  if (!mainAppUrl || !workerSecret) {
    throw new Error(
      'uploadArtifact: MAIN_APP_URL and WORKER_SHARED_SECRET env vars are required',
    );
  }

  const contentBase64 = input.contentBuffer.toString('base64');

  const body = {
    organisationId: input.organisationId,
    agentRunId: input.agentRunId,
    ieeRunId: input.ieeRunId,
    artifactKind: input.artifactKind,
    displayName: input.displayName,
    mimeType: input.mimeType,
    contentBase64,
    retainUntil: input.retainUntil?.toISOString(),
  };

  const response = await fetch(`${mainAppUrl}/api/internal/run-artifacts/finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': workerSecret,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error('worker.upload_artifact.failed', {
      status: response.status,
      organisationId: input.organisationId,
      agentRunId: input.agentRunId,
      artifactKind: input.artifactKind,
      body: text.slice(0, 500),
    });
    throw new Error(
      `uploadArtifact: finalize endpoint returned ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  return response.json() as Promise<UploadResult>;
}
