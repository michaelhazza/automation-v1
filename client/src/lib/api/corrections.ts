// client/src/lib/api/corrections.ts
// Client-side API client for the correction capture endpoint.
// Trust & Verification Layer spec §13.2.

import type {
  CorrectionDialogPayload,
  CorrectionResult,
} from '../../../../shared/types/correction.js';

export type { CorrectionDialogPayload, CorrectionResult };

export async function submitCorrection(
  runId: string,
  eventId: string,
  body: Omit<CorrectionDialogPayload, 'runId' | 'eventId'>,
): Promise<CorrectionResult> {
  const res = await fetch(`/api/runs/${runId}/steps/${eventId}/correct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: string; code?: string };
    const err = new Error(json.error ?? `Request failed: ${res.status}`);
    (err as Error & { code?: string; status?: number }).code = json.code;
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }

  return res.json() as Promise<CorrectionResult>;
}
