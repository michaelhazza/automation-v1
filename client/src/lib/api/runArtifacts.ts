// client/src/lib/api/runArtifacts.ts
// Typed fetch wrapper for run artifact endpoints (spec §4.5.2, §4.5.3).

import api from '../api';
import type { RunArtifact } from '../../../../shared/types/runArtifact.js';

export type { RunArtifact };

export type RequestSource =
  | 'run_trace_panel'
  | 'pdf_embed'
  | 'copy_link'
  | 'api_consumer';

export interface SignedUrlResult {
  url: string;
  expiresAt: string;
}

/**
 * GET /api/agent-runs/:runId/artifacts
 * Returns artifact metadata only — no embedded URLs.
 */
export async function listArtifacts(runId: string): Promise<RunArtifact[]> {
  const { data } = await api.get<{ artifacts: RunArtifact[] }>(
    `/api/agent-runs/${encodeURIComponent(runId)}/artifacts`,
  );
  return data.artifacts;
}

/**
 * POST /api/run-artifacts/:artifactId/signed-url
 * Mints a time-limited signed URL for the artifact.
 * Emits phase1.file_delivery.signed_url_issued server-side.
 */
export async function issueSignedUrl(
  artifactId: string,
  requestSource: RequestSource,
): Promise<SignedUrlResult> {
  const { data } = await api.post<SignedUrlResult>(
    `/api/run-artifacts/${encodeURIComponent(artifactId)}/signed-url`,
    { requestSource },
  );
  return data;
}
