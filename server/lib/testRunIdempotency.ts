// ---------------------------------------------------------------------------
// testRunIdempotency — server-derived idempotency keys for test runs
// ---------------------------------------------------------------------------
//
// Why this exists: a client-generated UUID (see TestPanel) only dedupes
// per-click. Double-fires caused by network retries, fast UI re-triggers, or
// browser back/forward navigation can still produce duplicate runs because
// each produces a fresh UUID.
//
// The server derives its own key from (userId, targetType, targetId, canonical
// JSON of input, time window) so identical retries collapse to the same run
// via agentExecutionService's idempotency check. The client-supplied key is
// accepted only as a salt / hint so deliberately-distinct concurrent clicks
// (e.g. two different tabs, same input) can still produce distinct runs.
//
// Design notes:
//
//   - **Canonical JSON serialisation.** `JSON.stringify(obj)` is NOT stable:
//     `{a:1,b:2}` and `{b:2,a:1}` serialise differently. We walk the value
//     tree and sort object keys lexicographically so logically-equivalent
//     inputs hash identically. `undefined` in objects is omitted (matching
//     JSON semantics) and `undefined` in arrays becomes `null` (ditto).
//
//   - **Dual-bucket acceptance.** With a 10s bucket, two requests that
//     straddle a bucket boundary (e.g. the second retry arrives at t=10.01s
//     when the first hit at t=9.99s) would otherwise produce distinct keys
//     and bypass dedup. `deriveTestRunIdempotencyCandidates()` returns the
//     current and previous bucket keys so the caller can check both for a
//     pre-existing run — eliminating the boundary edge case without needing
//     a larger (and less-precise) window.
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';

const DEFAULT_WINDOW_SECONDS = 10;

type TestRunTargetType = 'agent' | 'subaccount-agent' | 'org-skill' | 'subaccount-skill';

interface DeriveInput {
  userId: string;
  targetType: TestRunTargetType;
  targetId: string;
  /** Full request body minus the client idempotency key — hashed into the bucket. */
  input: unknown;
  /** Optional client-provided key, folded into the hash as a tie-breaker. */
  clientKeyHint?: string;
  /** Override the 10s default if needed. */
  windowSeconds?: number;
}

/**
 * Deterministic stringify with sorted object keys. Matches JSON semantics:
 * `undefined` in objects is dropped, `undefined` in arrays becomes `null`,
 * and non-finite numbers become `null` (same as `JSON.stringify`).
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalStringify(v))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  // functions, symbols, bigints — not serialisable as JSON, drop to null.
  return 'null';
}

function hashForBucket(
  args: DeriveInput,
  bucket: number,
  canonical: string,
  clientHint: string,
): string {
  const digest = createHash('sha256')
    .update(
      `${args.userId}\u0000${args.targetType}\u0000${args.targetId}\u0000${bucket}\u0000${clientHint}\u0000${canonical}`,
    )
    .digest('hex');
  return `test-run:${args.targetType}:${digest.slice(0, 32)}`;
}

/**
 * Derive a deterministic idempotency key for a test run against the CURRENT
 * time bucket. Two requests with the same (userId, targetType, targetId,
 * canonical input, clientKeyHint) arriving inside the same bucket produce the
 * same key — and so collapse to the same agent run in agentExecutionService.
 */
export function deriveTestRunIdempotencyKey(args: DeriveInput): string {
  const windowSec = args.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const canonical = canonicalStringify(args.input ?? null);
  const clientHint = args.clientKeyHint ?? '';
  return hashForBucket(args, bucket, canonical, clientHint);
}

/**
 * Return the set of keys the executor should check for a pre-existing run.
 * Currently `[current, previous]` — this closes the bucket-boundary edge case
 * where back-to-back retries land either side of the rollover and would
 * otherwise bypass dedup.
 *
 * Insert key for a new run is always the first element (current bucket).
 */
export function deriveTestRunIdempotencyCandidates(args: DeriveInput): [string, string] {
  const windowSec = args.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const canonical = canonicalStringify(args.input ?? null);
  const clientHint = args.clientKeyHint ?? '';
  return [
    hashForBucket(args, bucket, canonical, clientHint),
    hashForBucket(args, bucket - 1, canonical, clientHint),
  ];
}
