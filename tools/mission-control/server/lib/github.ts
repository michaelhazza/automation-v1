/**
 * github.ts
 *
 * Minimal GitHub REST client for Mission Control. In-memory 60s cache so
 * the dashboard doesn't hammer the GitHub API on every poll.
 *
 * Auth is optional (read-only public endpoints work without a token, with a
 * 60-req/hour limit). Pass GITHUB_TOKEN for higher limits.
 */

const CACHE_TTL_MS = 60_000;
const GITHUB_API = 'https://api.github.com';

export type CiStatus = 'passing' | 'failing' | 'pending' | 'unknown';

export interface PRSummary {
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
  ci_status: CiStatus;
}

interface CacheEntry<T> {
  value: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function cacheSet<T>(key: string, value: T): void {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

function authHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Find the most recent PR (open or closed) for a given branch on a repo.
 * Returns null if none found, or if the GitHub API errors.
 */
export async function fetchPRForBranch(
  repo: string,
  branch: string,
  token: string | null,
): Promise<PRSummary | null> {
  const cacheKey = `pr:${repo}:${branch}`;
  const cached = cacheGet<PRSummary | null>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const [owner, name] = repo.split('/');
    if (!owner || !name) return null;
    const headRef = `${owner}:${branch}`;
    const url = `${GITHUB_API}/repos/${repo}/pulls?state=all&head=${encodeURIComponent(headRef)}&sort=created&direction=desc&per_page=1`;
    const res = await fetch(url, { headers: authHeaders(token) });
    if (!res.ok) {
      cacheSet(cacheKey, null);
      return null;
    }
    const list = (await res.json()) as Array<{
      number: number;
      html_url: string;
      state: 'open' | 'closed';
      merged_at: string | null;
    }>;
    if (!Array.isArray(list) || list.length === 0) {
      cacheSet(cacheKey, null);
      return null;
    }
    const top = list[0];
    const state: PRSummary['state'] =
      top.merged_at ? 'merged' : top.state === 'closed' ? 'closed' : 'open';
    const ci = await fetchCiStatusForBranch(repo, branch, token);
    const summary: PRSummary = {
      number: top.number,
      url: top.html_url,
      state,
      ci_status: ci,
    };
    cacheSet(cacheKey, summary);
    return summary;
  } catch {
    cacheSet(cacheKey, null);
    return null;
  }
}

/**
 * Fetch the latest commit's combined check-run status for a branch.
 * Returns 'unknown' if the branch isn't found, the API errors, or no checks exist.
 */
export async function fetchCiStatusForBranch(
  repo: string,
  branch: string,
  token: string | null,
): Promise<CiStatus> {
  const cacheKey = `ci:${repo}:${branch}`;
  const cached = cacheGet<CiStatus>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const url = `${GITHUB_API}/repos/${repo}/commits/${encodeURIComponent(branch)}/check-runs`;
    const res = await fetch(url, { headers: authHeaders(token) });
    if (!res.ok) {
      cacheSet(cacheKey, 'unknown' as CiStatus);
      return 'unknown';
    }
    const body = (await res.json()) as {
      check_runs?: Array<{ status: string; conclusion: string | null }>;
    };
    const runs = body.check_runs ?? [];
    if (runs.length === 0) {
      cacheSet(cacheKey, 'unknown' as CiStatus);
      return 'unknown';
    }
    const status = deriveCiStatus(runs);
    cacheSet(cacheKey, status);
    return status;
  } catch {
    cacheSet(cacheKey, 'unknown' as CiStatus);
    return 'unknown';
  }
}

/**
 * Pure helper — combines individual check-run statuses into a single signal.
 * Exported for testing.
 */
export function deriveCiStatus(
  runs: Array<{ status: string; conclusion: string | null }>,
): CiStatus {
  if (runs.length === 0) return 'unknown';
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  if (runs.some((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out' || r.conclusion === 'cancelled')) {
    return 'failing';
  }
  if (runs.every((r) => r.conclusion === 'success' || r.conclusion === 'neutral' || r.conclusion === 'skipped')) {
    return 'passing';
  }
  return 'unknown';
}
