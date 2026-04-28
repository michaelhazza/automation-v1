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
    ci_updated_at: string | null;
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
  dataPartial: boolean;
}

export interface HealthResponse {
  ok: boolean;
  repoRoot: string;
  githubRepo: string | null;
  hasGithubToken: boolean;
}

export interface InFlightResponse {
  items: InFlightItem[];
  isPartial: boolean;
}

export async function fetchInFlight(): Promise<InFlightResponse> {
  const res = await fetch('/api/in-flight');
  if (!res.ok) throw new Error(`/api/in-flight ${res.status}`);
  return (await res.json()) as InFlightResponse;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`/api/health ${res.status}`);
  return (await res.json()) as HealthResponse;
}
