// client/src/lib/api/runTrace.ts
// Typed fetch wrapper for GET /api/agent-runs/:runId/trace (spec §4.4.7).

import api from '../api';
import type { RunTraceEvent, RunTraceSummary } from '../../../../shared/types/runTraceEvent.js';
import type { PolicyEnvelopeSnapshot } from '../../../../shared/types/policyEnvelope.js';
import type { ControllerStyle } from '../../../../shared/types/controllerStyle.js';

// Client-side mirror of RunTraceResult (server/services/runTraceService.ts).
// Declared here so client code does not import from server services.
export interface RunTraceResult {
  runId: string;
  events: RunTraceEvent[];
  pagination: {
    nextCursor?: string;
    hasMore: boolean;
  };
  envelope: PolicyEnvelopeSnapshot | null;
  controllerStyle: ControllerStyle;
  summary: RunTraceSummary;
}

export interface FetchRunTraceParams {
  cursor?: string;
  limit?: number;
  eventTypes?: string[];
  toolSlug?: string;
}

export async function fetchRunTrace(
  runId: string,
  params?: FetchRunTraceParams,
): Promise<RunTraceResult> {
  const searchParams = new URLSearchParams();
  if (params?.cursor) searchParams.set('cursor', params.cursor);
  if (params?.limit != null) searchParams.set('limit', String(params.limit));
  if (params?.eventTypes?.length) searchParams.set('eventTypes', params.eventTypes.join(','));
  if (params?.toolSlug) searchParams.set('toolSlug', params.toolSlug);

  const qs = searchParams.toString();
  const url = `/api/agent-runs/${encodeURIComponent(runId)}/trace${qs ? `?${qs}` : ''}`;
  const { data } = await api.get<RunTraceResult>(url);
  return data;
}
