// ---------------------------------------------------------------------------
// testRunIdempotency — server-derived idempotency keys for test runs
// ---------------------------------------------------------------------------
//
// Why this exists: a client-generated UUID (see TestPanel) only dedupes
// per-click. Double-fires caused by network retries, fast UI re-triggers, or
// browser back/forward navigation can still produce duplicate runs because
// each produces a fresh UUID.
//
// The server derives its own key from (userId, targetType, targetId, hash of
// input, time window) so identical retries collapse to the same run via
// agentExecutionService's idempotency check. The client-supplied key is
// accepted only as a salt / hint so deliberately-distinct concurrent clicks
// (e.g. two different tabs, same input) can still produce distinct runs.
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
 * Derive a deterministic idempotency key for a test run. Two requests with
 * the same (userId, targetType, targetId, serialised input, clientKeyHint)
 * arriving inside the same window bucket produce the same key — and so
 * collapse to the same agent run in agentExecutionService.
 */
export function deriveTestRunIdempotencyKey(args: DeriveInput): string {
  const windowSec = args.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const canonical = JSON.stringify(args.input ?? null);
  const clientHint = args.clientKeyHint ?? '';
  const digest = createHash('sha256')
    .update(`${args.userId}\u0000${args.targetType}\u0000${args.targetId}\u0000${bucket}\u0000${clientHint}\u0000${canonical}`)
    .digest('hex');
  return `test-run:${args.targetType}:${digest.slice(0, 32)}`;
}
