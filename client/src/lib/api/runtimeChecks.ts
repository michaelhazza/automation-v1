/**
 * client/src/lib/api/runtimeChecks.ts
 *
 * API client for runtime-check endpoints.
 * Spec: tasks/builds/trust-verification-layer/spec.md §11.3.
 *
 * Note: /api/runs/:runId/runtime-checks is wired in a later chunk.
 * The badge renders an empty array gracefully until the endpoint exists.
 */

import api from '../api';
import type { RuntimeCheckResult } from '../../../../shared/types/runtimeCheck';

export async function fetchRunRuntimeChecks(runId: string): Promise<RuntimeCheckResult[]> {
  const { data } = await api.get<RuntimeCheckResult[]>(`/api/runs/${runId}/runtime-checks`);
  return data;
}

export async function suggestRuntimeCheck(
  skillId: string,
  body: { description: string; apiSpec?: string },
): Promise<{
  name: string;
  blastRadius: string;
  reversible: boolean;
  suggestedCheck: { kind: string; parameters: Record<string, unknown> };
  plainEnglish: string;
  cacheHit: boolean;
}> {
  const { data } = await api.post(`/api/skills/${skillId}/suggest-runtime-check`, body);
  return data;
}
