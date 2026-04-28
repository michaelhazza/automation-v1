/**
 * api.ts — Mission Control client API wrapper.
 *
 * Types intentionally duplicate the server-side InFlightItem etc. so this
 * tool stays portable: dropping `tools/mission-control/` into another repo
 * doesn't require shared/ imports across the project boundary.
 */

export type Phase =
  | 'PLANNING'
  | 'BUILDING'
  | 'REVIEWING'
  | 'MERGE_READY'
  | 'MERGED'
  | 'NONE';

export type CiStatus = 'passing' | 'failing' | 'pending' | 'unknown';

export interface InFlightItem {
  build_slug: string;
  branch: string | null;
  phase: Phase;
  pr: {
    number: number;
    url: string;
    state: 'open' | 'closed' | 'merged';
    ci_status: CiStatus;
  } | null;
  latest_review: {
    kind: string;
    verdict: string | null;
    log_path: string;
    timestamp: string;
  } | null;
  progress: {
    last_updated: string | null;
    completed_chunks: number | null;
    total_chunks: number | null;
  } | null;
}

export interface HealthResponse {
  ok: boolean;
  repoRoot: string;
  githubRepo: string | null;
  hasGithubToken: boolean;
}

export async function fetchInFlight(): Promise<InFlightItem[]> {
  const res = await fetch('/api/in-flight');
  if (!res.ok) throw new Error(`/api/in-flight ${res.status}`);
  const body = (await res.json()) as { items: InFlightItem[] };
  return body.items;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`/api/health ${res.status}`);
  return (await res.json()) as HealthResponse;
}
