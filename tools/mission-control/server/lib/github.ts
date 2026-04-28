/**
 * github.ts
 *
 * Minimal GitHub REST client for Mission Control. In-memory 60s cache so
 * the dashboard doesn't hammer the GitHub API on every poll.
 *
 * Auth is optional (read-only public endpoints work without a token, with a
 * 60-req/hour limit). Pass GITHUB_TOKEN for higher limits.
 */

// Round-2 review #5: split TTLs by endpoint volatility. CI flips on every push;
// PR state (number / url / open|closed|merged) changes far less often.
const CACHE_TTL_PR_MS = 120_000;
const CACHE_TTL_CI_MS = 30_000;
// Errors get a much shorter TTL so a transient 502 doesn't stick for the full
// success window. Next 30s poll cycle retries.
const CACHE_TTL_ERROR_MS = 5_000;
const GITHUB_API = 'https://api.github.com';

export type CiStatus = 'passing' | 'failing' | 'pending' | 'unknown';

export interface PRSummary {
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
  ci_status: CiStatus;
  ci_updated_at: string | null;
}

/**
 * Wrapper around a fetch result that distinguishes "intentional null" (no PR
 * exists, no checks configured) from "error" (network blip, rate limit, etc.).
 * The composer uses `errored` to set `dataPartial` on InFlightItem so the UI
 * can show a "data incomplete" indicator instead of falsely rendering "all clear."
 */
export interface FetchResult<T> {
  value: T;
  errored: boolean;
}

interface CacheEntry<T> {
  value: T;
  expires: number;
  errored: boolean;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): { value: T; errored: boolean } | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return { value: entry.value as T, errored: entry.errored };
}

function cacheSet<T>(key: string, value: T, ttlMs: number, errored = false): void {
  cache.set(key, { value, expires: Date.now() + ttlMs, errored });
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
): Promise<FetchResult<PRSummary | null>> {
  const cacheKey = `pr:${repo}:${branch}`;
  const cached = cacheGet<PRSummary | null>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const [owner, name] = repo.split('/');
    if (!owner || !name) {
      cacheSet(cacheKey, null, CACHE_TTL_ERROR_MS, true);
      return { value: null, errored: true };
    }
    const headRef = `${owner}:${branch}`;
    const url = `${GITHUB_API}/repos/${repo}/pulls?state=all&head=${encodeURIComponent(headRef)}&sort=created&direction=desc&per_page=1`;
    const res = await fetch(url, { headers: authHeaders(token) });
    if (!res.ok) {
      cacheSet(cacheKey, null, CACHE_TTL_ERROR_MS, true);
      return { value: null, errored: true };
    }
    const list = (await res.json()) as Array<{
      number: number;
      html_url: string;
      state: 'open' | 'closed';
      merged_at: string | null;
    }>;
    if (!Array.isArray(list) || list.length === 0) {
      // Real "no PR" state, not an error — cache for the full PR TTL.
      cacheSet(cacheKey, null, CACHE_TTL_PR_MS);
      return { value: null, errored: false };
    }
    const top = list[0];
    const state: PRSummary['state'] =
      top.merged_at ? 'merged' : top.state === 'closed' ? 'closed' : 'open';
    const ci = await fetchCiStatusForBranch(repo, branch, token);
    const summary: PRSummary = {
      number: top.number,
      url: top.html_url,
      state,
      ci_status: ci.value,
      ci_updated_at: ci.updatedAt,
    };
    // PR fetch errored when its CI sub-fetch errored, even if the outer fetch succeeded.
    cacheSet(cacheKey, summary, CACHE_TTL_PR_MS, ci.errored);
    return { value: summary, errored: ci.errored };
  } catch {
    cacheSet(cacheKey, null, CACHE_TTL_ERROR_MS, true);
    return { value: null, errored: true };
  }
}

interface CiResult {
  value: CiStatus;
  updatedAt: string | null;
  errored: boolean;
}

/**
 * Fetch the latest commit's combined check-run status for a branch.
 * Returns `{ value: 'unknown', updatedAt: null, errored: true }` on API error;
 * `{ value: 'unknown', updatedAt: null, errored: false }` for "no checks configured";
 * otherwise derives the status and `updatedAt` from the most recent check-run.
 */
export async function fetchCiStatusForBranch(
  repo: string,
  branch: string,
  token: string | null,
): Promise<CiResult> {
  const cacheKey = `ci:${repo}:${branch}`;
  const cached = cacheGet<CiResult>(cacheKey);
  if (cached !== undefined) return cached.value;

  try {
    const url = `${GITHUB_API}/repos/${repo}/commits/${encodeURIComponent(branch)}/check-runs`;
    const res = await fetch(url, { headers: authHeaders(token) });
    if (!res.ok) {
      const result: CiResult = { value: 'unknown', updatedAt: null, errored: true };
      cacheSet(cacheKey, result, CACHE_TTL_ERROR_MS, true);
      return result;
    }
    const body = (await res.json()) as {
      check_runs?: Array<{ status: string; conclusion: string | null; completed_at?: string | null }>;
    };
    const runs = body.check_runs ?? [];
    if (runs.length === 0) {
      // Empty list is a real "no checks configured" state, not an error —
      // cache for the full CI TTL so we don't hammer GitHub for nothing.
      const result: CiResult = { value: 'unknown', updatedAt: null, errored: false };
      cacheSet(cacheKey, result, CACHE_TTL_CI_MS);
      return result;
    }
    const status = deriveCiStatus(runs);
    const updatedAt = pickLatestCompletedAt(runs);
    const result: CiResult = { value: status, updatedAt, errored: false };
    cacheSet(cacheKey, result, CACHE_TTL_CI_MS);
    return result;
  } catch {
    const result: CiResult = { value: 'unknown', updatedAt: null, errored: true };
    cacheSet(cacheKey, result, CACHE_TTL_ERROR_MS, true);
    return result;
  }
}

/**
 * Pure helper — picks the latest non-null `completed_at` across check-runs.
 * Exported for testing.
 */
export function pickLatestCompletedAt(
  runs: Array<{ completed_at?: string | null }>,
): string | null {
  let latest: string | null = null;
  for (const r of runs) {
    const ts = r.completed_at;
    if (typeof ts === 'string' && (latest === null || ts > latest)) {
      latest = ts;
    }
  }
  return latest;
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
  // S3: action_required is a CI gate the operator must address (required reviewer,
  // workflow approval, etc.) — surface it as 'failing' so the dot turns red.
  // 'stale' means the run is no longer authoritative; treat as 'pending' so the
  // operator knows a re-run is needed.
  if (
    runs.some(
      (r) =>
        r.conclusion === 'failure' ||
        r.conclusion === 'timed_out' ||
        r.conclusion === 'cancelled' ||
        r.conclusion === 'action_required',
    )
  ) {
    return 'failing';
  }
  if (runs.some((r) => r.conclusion === 'stale')) {
    return 'pending';
  }
  if (runs.every((r) => r.conclusion === 'success' || r.conclusion === 'neutral' || r.conclusion === 'skipped')) {
    return 'passing';
  }
  return 'unknown';
}
