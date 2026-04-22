// ---------------------------------------------------------------------------
// Idempotency-key versioning — `tasks/llm-inflight-deferred-items-brief.md` §2.
//
// Both `llmRouter.generateIdempotencyKey` and
// `actionService.buildActionIdempotencyKey` are content-hashes of their
// inputs. If the canonicalisation contract ever changes — a new field added,
// nested-key sort tweaked, null-vs-absent policy adjusted — dedup silently
// breaks across the deploy boundary: old rows hash one way, new calls hash
// another, so a retry that *should* be caught by the existing-row check gets
// treated as a fresh call.
//
// For `llmRouter` that's a provider double-bill. For `actionService` it's a
// duplicate action execution.
//
// Prepending a fixed version prefix makes the contract explicit: bump the
// version in the same commit as any canonicalisation change, and old rows
// (`v1:...`) stay valid for in-flight retries of old calls while new calls
// hash as `v2:...` and don't collide. No runtime "accepts prefixed or
// unprefixed" fallback — that would defeat the whole point.
//
// Deploy-boundary tradeoff is explicitly accepted (see brief §2): a request
// in-flight at the moment of a prefix bump will, on retry, hash to the new
// prefix and not match its prior attempt's row. Narrow window; acceptable
// risk given the rarity.
// ---------------------------------------------------------------------------

/**
 * Current idempotency-key version. Prepended to every hash produced by
 * `llmRouter.generateIdempotencyKey` and
 * `actionService.buildActionIdempotencyKey`. Bump to `'v2'` the next time
 * the canonicalisation contract changes.
 */
export const IDEMPOTENCY_KEY_VERSION = 'v1' as const;
export type IdempotencyKeyVersion = typeof IDEMPOTENCY_KEY_VERSION;

// Load-time guard — reviewer feedback 2026-04-21 round 4:
//
// "Add a runtime assert in dev/test: if (!IDEMPOTENCY_VERSION) throw …"
//
// This catches the narrow case where a refactor accidentally empties or
// nulls the constant (e.g. `export const IDEMPOTENCY_KEY_VERSION = ''`)
// but leaves the import chain intact. TypeScript catches outright
// removal; this runtime probe catches the "still a string, but wrong
// shape" variant that type-level guarantees can't express.
//
// Pattern: `v` followed by one or more decimal digits. Keeps the door
// open for `'v2'`, `'v42'`, etc. A future non-numeric scheme would need
// a deliberate update here — which is exactly the audit hook we want.
if (!/^v\d+$/.test(IDEMPOTENCY_KEY_VERSION)) {
  throw new Error(
    `[idempotencyVersion] IDEMPOTENCY_KEY_VERSION must match /^v\\d+$/ — got ${JSON.stringify(IDEMPOTENCY_KEY_VERSION)}. `
    + 'Bump deliberately via the constant in server/lib/idempotencyVersion.ts; '
    + 'do not leave it empty or set it to an unprefixed string.',
  );
}
