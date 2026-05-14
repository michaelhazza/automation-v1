# Pre-Production Boundary Security + Brief API — Dev Spec

**Spec date:** 2026-04-29
**Slug:** `pre-prod-boundary-and-brief-api`
**Branch:** `pre-prod-boundary-and-brief-api` (created from `origin/main` HEAD `93e855e7`)
**Class:** Major (architect first; full review pipeline)
**Source brief:** [tasks/builds/pre-prod-boundary-and-brief-api/brief.md](../../../tasks/builds/pre-prod-boundary-and-brief-api/brief.md) (narrowed from original brief at commit `b150d759`)
**Migration range reserved:** `0253` (rate-limit table; reserve `0254` if architect splits the cleanup job)
**Sister branches (do not edit their files):** `pre-prod-tenancy`, `pre-prod-workflow-and-delegation`
**Spec-context framing:** [docs/spec-context.md](../../spec-context.md) (pre-production, rapid-evolution, static-gates-primary, no live users)

---

## Table of contents

1. Framing
2. Goals
3. Non-goals
4. Existing primitives search
5. File inventory
6. Phase plan
   - Phase 1 — Multer cap + disk storage
   - Phase 2 — DB-backed rate-limit primitive
   - Phase 3 — Webhook secret boot assertion
   - Phase 4 — Brief-creation envelope harmonisation
   - Phase 5 — Scope-resolution perf guard
   - Phase 6 — Rate limit + tests on `/api/session/message`
   - Phase 7 — Dev-script safety
7. Contracts
8. RLS / access control
9. Execution model
10. Execution-safety contracts
11. Phase sequencing
12. Test matrix
13. Deferred items
14. Acceptance criteria
15. References

---

## 1. Framing

This spec is one of three streams hardening the pre-production codebase before testing lockdown. It owns the **HTTP boundary surface and brief-creation API**. The two sister streams own tenancy / RLS hardening and the workflow engine + delegation telemetry; their files are explicitly out of scope here.

The brief was narrowed via Section 0 verification on 2026-04-29 against `main` HEAD `93e855e7`. Six items previously flagged were verified closed and folded into the brief's *Verified closed* table; this spec works only the seven open phases and does not re-litigate closed items.

**Operational framing** (per `docs/spec-context.md`):

- Pre-production, no live users, no live agencies, rapid-evolution stage.
- Testing posture: static-gates-primary; pure-function unit tests only; **no E2E / API-contract / frontend tests**. The only runtime integration-test deviation is F8 `sessionMessage.test.ts` — see §12 Test matrix for the explicit acknowledgement.
- Rollout model: commit-and-revert. **No feature flags introduced for behaviour gates** in this spec; the only env-driven knob is the existing `WEBHOOK_SECRET` and `NODE_ENV`.
- Per `DEVELOPMENT_GUIDELINES § 8.6`, infrastructure migrations ship with an env-flag rollback shim only when a roll-back to the previous primitive is plausible. The DB-backed rate-limit primitive (Phase 2) is a strict in-place replacement of in-process limiters that have known correctness defects (multi-process bypass, restart loss); rolling back is not a goal — see §10.5 for the rationale and the no-shim decision.

## 2. Goals

| # | Goal | Verification |
|---|---|---|
| G1 | Multer no longer accepts multi-hundred-MB uploads into process memory. | Static: `server/middleware/validate.ts` uses `multer.diskStorage` for all uploads with a 50 MB hard cap. |
| G2 | A single Postgres-backed rate-limit primitive is the only rate-limit code path in `server/`. | Grep: zero remaining `Map<string, number[]>` rate-limit windows in `server/`. `server/lib/testRunRateLimit.ts` deleted. |
| G3 | All existing in-process / `express-rate-limit` call sites consume the new primitive (full enumeration in §6.2.5). | Grep: all sites import `server/lib/rateLimiter.ts`. No `express-rate-limit` imports remain in `server/routes/auth.ts`. |
| G4 | Production boot fails fast when `WEBHOOK_SECRET` is unset. | Static: `server/index.ts` boot-time assertion present. Manual: bring up server with `NODE_ENV=production` and `WEBHOOK_SECRET=` unset; expect process exit. |
| G5 | `/api/briefs` and `/api/session/message` brief-creation path return the same response envelope. | Static: both routes return values that satisfy `BriefCreationEnvelope` (typed at compile time). Client: Layout modal + GlobalAskBar consume the unified shape with no per-route branches. |
| G6 | `findEntitiesMatching` returns `[]` for hint < 2 chars at the service layer (defence-in-depth over the existing route guard). | Unit test on the extracted pure helper `shouldSearchEntityHint(hint: string): boolean` (see §6.5). |
| G7 | `/api/session/message` is rate-limited at the new primitive. | Static: route uses `rateLimiter.check`. Manual: 31 requests/minute → 429 on the 31st. |
| G8 | `sessionMessage.test.ts` covers Path A / B / C, cross-tenant rejection, and stale-subaccount drop, against a real DB. | Test file present; tests pass. |
| G9 | Reseed scripts cannot run outside development; restore is transactional. | Static: `_reseed_drop_create.ts` throws on `NODE_ENV !== 'development'`; `_reseed_restore_users.ts` wraps the restore loop in a raw `pg` `Pool` client transaction (`BEGIN` / `COMMIT` / `ROLLBACK` on the same client). |
| G10 | No regression in the rate-limit / boundary attack surface. | `npx tsc --noEmit` clean for both server and client. The CI gates that already existed on these surfaces (no silent failures, RLS coverage, etc.) continue to pass. |

## 3. Non-goals

- **Tightening Helmet CSP further.** Production CSP is already in place at [server/index.ts:188-213](../../../server/index.ts) with a sensible directive set. Dev-mode `false` is intentional (Vite HMR ergonomics) and stays. Spec does not touch CSP.
- **Adding a `detail` field to the production error envelope.** Optional follow-up; the existing envelope already strips internals in production.
- **`createBrief` triple-split refactor (F5).** Separate PR per the deferred entry at `tasks/todo.md:341`. This spec does not change the `createBrief()` signature beyond what envelope harmonisation strictly requires.
- **`pg_trgm` migration for `findEntitiesMatching`.** Follow-up spec with perf measurement. The min-length guard (Phase 5) is the only change to the search path here.
- **#27 Centralised auth/permission audit trail.** Broader than this stream; out of scope per brief.
- **Token-bucket / leaky-bucket rate limiting.** Phase 2 ships a sliding-window primitive only — see §7.1 for why.
- **Redis-backed rate limiting.** Postgres is the chosen backing store. Redis is not used elsewhere in the stack as a primary store and would introduce a new infrastructure dependency. Postgres-backed rate limiting is sufficient at our scale and reuses our existing primitives.
- **Tenancy / RLS migrations (`pre-prod-tenancy`)** and **workflow engine + delegation (`pre-prod-workflow-and-delegation`)**. Sister-branch ownership; no edits to their listed files. Cross-references only when needed to declare contracts.

## 4. Existing primitives search

Per [docs/spec-authoring-checklist.md § 1](../../spec-authoring-checklist.md), each new primitive carries a "why not reuse / why not extend" justification.

| Proposed | Existing primitives surveyed | Decision | Justification |
|---|---|---|---|
| **`server/lib/rateLimiter.ts`** sliding-window over Postgres | (a) `server/lib/testRunRateLimit.ts` — in-process Map; (b) `express-rate-limit` package (used in `server/routes/auth.ts`); (c) the in-process Map duplicates in `server/routes/public/formSubmission.ts` and `server/routes/public/pageTracking.ts` | **Replace + consolidate.** The new primitive *is* the existing primitive lifted to a durable store. All three in-process implementations carry the identical `TODO(PROD-RATE-LIMIT)` marker calling out the multi-process bypass and restart-loss defects. `express-rate-limit` is in-memory by default and shares the same defect class. The justification for a new file is "the existing thing is structurally broken at scale" — replace, don't extend. |
| **`BriefCreationEnvelope` type in `shared/types/briefFastPath.ts`** unified response shape | (a) `server/services/briefCreationService.ts` `createBrief()` already returns `{ briefId, fastPathDecision, conversationId }`; (b) `shared/types/briefFastPath.ts` carries `BriefUiContext` and `FastPathDecision`; (c) `server/routes/sessionMessage.ts` declares an inline `SessionMessageResponse` discriminated union with a `brief_created` arm | **Extend `briefFastPath.ts`** with a new exported `BriefCreationEnvelope` type. No new file. The discriminated union in `sessionMessage.ts` keeps its `brief_created` arm but the arm's payload becomes `BriefCreationEnvelope & { type: 'brief_created' }`. |
| **Multer disk-storage threshold** | `multer` already in use; switching to `multer.diskStorage` is a configuration change inside the same import. | **Configuration change**, not a new primitive. |
| **Webhook boot assertion** | `server/index.ts` `start()` already runs boot-time validators (e.g. `validateSystemSkillHandlers`). The webhook check is a 3-line addition to the same lane. | **Extend** the existing boot path. No new primitive. |
| **Reseed env guard** | `server/lib/env.ts` already validates `NODE_ENV` via Zod. The reseed script imports `process.env` directly today. | **Direct `process.env.NODE_ENV` check** at script entry. Importing `env` would pull the full server-side validation chain into a standalone CLI script; a single-line guard is the right shape here (see §6.7.1). |

## 5. File inventory

This is the single source of truth for what the spec touches. Every prose reference to a file/column/migration cascades back here.

| File | New / Modified | Phase | Purpose |
|---|---|---|---|
| `server/middleware/validate.ts` | Modified | 1 | Drop Multer cap to 50 MB, switch to `multer.diskStorage` for all uploads. |
| `server/lib/rateLimiter.ts` | **New** | 2 | Sliding-window rate-limit primitive backed by Postgres. |
| `server/lib/rateLimitCleanupJob.ts` | **New** | 2 | TTL cleanup job for `rate_limit_buckets`. (architect may collapse into the primitive if the cleanup is in-line) |
| `migrations/0253_rate_limit_buckets.sql` | **New migration** | 2 | `rate_limit_buckets` table + indexes + RLS-not-applicable annotation. |
| `migrations/0253_rate_limit_buckets.down.sql` | **New migration** | 2 | DROP TABLE. |
| `server/db/schema/rateLimitBuckets.ts` | **New** | 2 | Drizzle schema for `rate_limit_buckets`. |
| `server/db/schema/index.ts` | Modified | 2 | Export the new schema. |
| `scripts/rls-not-applicable-allowlist.txt` | Modified | 2 | Add `rate_limit_buckets` with rationale citing this spec. |
| `server/routes/auth.ts` | Modified | 2 | Replace login `loginAttemptTimestamps` Map + `enforceLoginRateLimit` helper with `rateLimiter.check`. Replace `forgotPasswordRateLimit` / `resetPasswordRateLimit` `express-rate-limit` instances with `rateLimiter.check`. |
| `server/routes/public/formSubmission.ts` | Modified | 2 | Replace `ipHits` / `pageHits` Maps + `checkRateLimit` helper with `rateLimiter.check`. |
| `server/routes/public/pageTracking.ts` | Modified | 2 | Replace `trackHits` Map + `checkTrackRateLimit` helper with `rateLimiter.check`. |
| `server/lib/testRunRateLimit.ts` | **Deleted** | 2 | All callers migrated to `rateLimiter.check` with a test-run-keyed limit. |
| `server/routes/agents.ts`, `server/routes/skills.ts`, `server/routes/subaccountAgents.ts`, `server/routes/subaccountSkills.ts` | Modified | 2 | Replace each `checkTestRunRateLimit(req.user!.id)` call with `await rateLimiter.check('testrun:user:' + req.user!.id, TEST_RUN_RATE_LIMIT_PER_HOUR, 3600)` and reject on `!allowed`. |
| `server/services/__tests__/testRunRateLimitPure.test.ts` | **Deleted** | 2 | Test file targets the about-to-be-deleted `testRunRateLimit.ts`; the equivalent coverage is provided by the `computeEffectiveCount` pure-unit test (§12) plus the static inspection of the four caller routes. |
| `server/index.ts` | Modified | 2 + 3 | Phase 2: register the rate-limit cleanup job alongside the other queue workers in `start()` (pg-boss recommended; if `setInterval` is chosen the registration still lives here). Phase 3: add boot-time assertion `env.NODE_ENV === 'production' && !env.WEBHOOK_SECRET` → throw. Add one-time `logger.warn` on dev-mode fallback when `verifyCallbackToken` first runs without a secret. |
| `server/services/webhookService.ts` | Modified | 3 | One-time `logger.warn` shim invoked from `verifyCallbackToken` when `secret` is absent in non-production. (architect: warn-once-per-process vs warn-once-per-secret-rotation — see §7.3) |
| `shared/types/briefFastPath.ts` | Modified | 4 | Add `BriefCreationEnvelope` type. |
| `server/routes/briefs.ts` | Modified | 4 | Return value typed as `BriefCreationEnvelope`. |
| `server/routes/sessionMessage.ts` | Modified | 4 + 6 | Phase 4: every `brief_created` arm of `SessionMessageResponse` (Path A `pendingRemainder` resolution, Path B decisive command, Path C plain submission) returns `{ type: 'brief_created' } & BriefCreationEnvelope`. Phase 6 adds `rateLimiter.check` middleware applied to all paths (A/B/C). |
| `client/src/components/Layout.tsx` | Modified | 4 | New Brief modal consumes `BriefCreationEnvelope`. |
| `client/src/components/global-ask-bar/GlobalAskBar.tsx` | Modified | 4 | Every `brief_created` response arm (Paths A/B/C) is consumed via `BriefCreationEnvelope`. |
| `client/src/components/global-ask-bar/GlobalAskBarPure.ts` | Modified | 4 | `SessionMessageResponse` `brief_created` arm uses `BriefCreationEnvelope`. |
| `server/services/scopeResolutionService.ts` | Modified | 5 | Add exported pure helper `shouldSearchEntityHint(hint: string): boolean`; call it at the top of `findEntitiesMatching` to short-circuit when the hint is too short. |
| `server/routes/__tests__/sessionMessage.test.ts` | **New** | 6 | Path A/B/C, cross-tenant rejection, stale-subaccount drop integration tests. |
| `scripts/_reseed_drop_create.ts` | Modified | 7 | NODE_ENV guard at top of script. |
| `scripts/_reseed_restore_users.ts` | Modified | 7 | Wrap restore loop in a raw `pg` `Pool` client transaction (`BEGIN` / `COMMIT` / `ROLLBACK`); the script uses raw `pg`, not Drizzle. |
| `package.json` (root) + `package-lock.json` | Modified | 2 | The `import rateLimit from 'express-rate-limit'` in `server/routes/auth.ts` resolves via a transitive dependency (root `package.json` does not list `express-rate-limit` as a direct dep). Phase 2 removes the import. No `dependencies` change to `package.json` is required, but `package-lock.json` is regenerated by the next `npm install` to reflect that the package is no longer reached from any direct importer. If a future direct dep on `express-rate-limit` is added, the cleanup deletes it; today there is none to delete. |
| `server/services/__tests__/rateLimiterPure.test.ts` | **New** | 2 | Pure-unit tests for `computeEffectiveCount(prevCount, currentCount, elapsedFractionOfCurrentWindow)` at boundary, mid-window, and full-window edges. |
| `server/services/__tests__/scopeResolutionPure.test.ts` | **New** | 5 | Pure-unit tests for `shouldSearchEntityHint(hint)` (returns `false` for `''`, `' '`, `'a'`; `true` for `'ab'` and longer). May extend an existing `*Pure.test.ts` file in the same directory if conventions there favour grouping. |
| `tasks/current-focus.md` | Modified | (housekeeping) | Update mission-control block + prose to point at this spec. |

## 6. Phase plan

### Phase 1 — Multer cap + disk storage

**File:** `server/middleware/validate.ts`.

**Change:**

- Replace the single `multer.memoryStorage()` instance with `multer.diskStorage({ destination: os.tmpdir() })` for **all uploads**. The hybrid memory/disk variant (memory below 5 MB, disk above) is recorded in §13 Deferred items as the fallback if measured cost makes pure-disk untenable; for this spec, disk-storage for all uploads is the chosen verdict — simpler, fewer moving parts, no in-memory branch to test, acceptable in a pre-production codebase.
- Drop `limits.fileSize` from `500 * 1024 * 1024` to `50 * 1024 * 1024` (50 MB hard cap). 50 MB is the chosen verdict — existing PDF/screenshot uploads keep working without change.

**Tempfile cleanup:** disk-stored Multer files are not auto-cleaned. Add a request-scoped cleanup hook **inside `validateMultipart`** (middleware-level, not per-route) so abandoned uploads don't accumulate in `tmpdir`. The hook iterates over every file `multer` produced for the request — `upload.any()` populates `req.files` as an array — and unlinks each one:

```ts
res.on('close', () => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  for (const file of files) {
    fs.unlink(file.path, (err) => {
      if (!err || err.code === 'ENOENT') return;
      // Unlink failed for a reason other than "already gone" — surface it.
      // Common shapes: EACCES (perm drift), ENOSPC (tmpdir full), EBUSY (FS lock).
      // Each one indicates a real operational problem that would otherwise hide
      // until the tmpdir bloats; warn so the signal is visible to log aggregation.
      logger.warn('multer.cleanup_failed', { path: file.path, code: err.code, err: err.message });
    });
  }
});
```

Middleware-level keeps the cleanup contract in one place — no route-level audit surface — and §10.6 covers the per-request safety semantics. `ENOENT` is treated as success (the file was already cleaned, e.g. by the consuming route). Every other unlink failure logs at **warn** so a recurring leak surfaces in log aggregation rather than disappearing into debug noise.

**Out of scope:** changing the `validateMultipart` export signature. Existing callers (`upload.any()`) keep working unchanged.

### Phase 2 — DB-backed rate-limit primitive (the linchpin)

This phase introduces the new primitive (§7.1 contract), the new table (§7.2 schema), and migrates every existing in-process / `express-rate-limit` call site in lockstep so no in-process limiter remains in `server/`. The full enumeration is in §6.2.5.

#### 2.1 Migration `0253_rate_limit_buckets.sql`

```sql
-- Sliding-window rate-limit primitive backed by Postgres.
-- Buckets are keyed on a caller-defined `key` plus a `window_start` aligned to
-- the configured window size; counts increment via UPSERT. The TTL cleanup job
-- deletes rows whose window_start is older than (now() - max_window_lookback).
--
-- This table is system-wide (no organisation_id). Keys may include user IDs,
-- IP addresses, or internal cache keys; the bucket itself does not bind to a
-- tenant. Registered in scripts/rls-not-applicable-allowlist.txt with the
-- rationale "system-wide rate-limit infrastructure; key strings opaque".

CREATE TABLE rate_limit_buckets (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Cleanup index: lets the TTL job delete-by-window_start cheaply.
CREATE INDEX rate_limit_buckets_window_start_idx
  ON rate_limit_buckets (window_start);
```

The `down.sql` is `DROP TABLE rate_limit_buckets;`.

#### 2.2 Drizzle schema `server/db/schema/rateLimitBuckets.ts`

Mirrors the SQL. Exported from `server/db/schema/index.ts`. No relations; no `organisationId` column; no soft-delete.

#### 2.3 Primitive `server/lib/rateLimiter.ts`

See §7.1 for the contract. Implementation invariants:

- **Window alignment uses DB time, not application time.** `window_start` is computed inside the SQL CTE from `extract(epoch from now())`, never from `Date.now()`. Multi-instance deployments must agree on bucket boundaries — application-side clock skew across two app servers would fragment the bucket and inflate the effective limit. The DB is the canonical clock for this primitive even when the application is single-instance today, so the multi-instance-safety property is preserved by construction.
- **UPSERT-and-read in a single CTE round-trip.** The primitive issues exactly one statement per `check()` — a CTE that derives the window boundaries from DB time, increments the current window via UPSERT, and reads the previous window's row in the same query:

  ```sql
  -- Positional bind parameters: $1 = key (text), $2 = windowSec (integer).
  WITH bounds AS (
    SELECT
      to_timestamp(floor(extract(epoch from now()) / $2) * $2)            AS curr_start,
      to_timestamp((floor(extract(epoch from now()) / $2) - 1) * $2)      AS prev_start,
      extract(epoch from now())                                            AS now_epoch,
      floor(extract(epoch from now()) / $2) * $2                           AS curr_epoch
  ),
  upserted AS (
    INSERT INTO rate_limit_buckets (key, window_start, count)
    SELECT $1, curr_start, 1 FROM bounds
    ON CONFLICT (key, window_start) DO UPDATE
      SET count = rate_limit_buckets.count + 1
    RETURNING count AS current_count, window_start AS curr_window_start
  ),
  prev AS (
    SELECT count AS prev_count
    FROM rate_limit_buckets, bounds
    WHERE key = $1 AND window_start = bounds.prev_start
  )
  SELECT
    upserted.current_count,
    upserted.curr_window_start,
    COALESCE(prev.prev_count, 0) AS prev_count,
    bounds.now_epoch,
    bounds.curr_epoch
  FROM upserted CROSS JOIN bounds LEFT JOIN prev ON true;
  ```

  The increment and the previous-window read are a single round-trip; PostgreSQL's `INSERT ... ON CONFLICT DO UPDATE` is per-row atomic at any isolation level (no explicit locking required, no SERIALIZABLE needed). The race-claim ordering (§8.10) is satisfied: the count increment is the state claim; if `effectiveCount > limit` the caller is rejected before any side effect. All three calls to `now()` inside a single statement return the same value (PostgreSQL `now()` is `transaction_timestamp()`, fixed for the duration of the statement), so `curr_start`, `prev_start`, and `now_epoch` are mutually consistent.

- **Sliding window math.** After the round-trip returns `current_count`, `prev_count`, `now_epoch`, and `curr_epoch`, the primitive computes `elapsedFractionOfCurrentWindow = Math.min(1, Math.max(0, (now_epoch - curr_epoch) / windowSec))` — the clamp is **mandatory**, not advisory. Leap-second adjustments and float rounding drift between `floor()` and `extract(epoch from now())` can produce values fractionally outside `[0, 1)` (e.g. `-1e-9` or `1.0000001`); without the clamp those propagate into `effectiveCount` as a negative weight or an over-100% weight, breaking both the "remaining ≥ 0" invariant and the limit-comparison semantics. The pure helper `computeEffectiveCount(prevCount, currentCount, elapsedFractionOfCurrentWindow)` performs the clamp internally and is unit-tested at edges (boundary moment, mid-window, full-window) plus the two slightly-out-of-range inputs (`-1e-9`, `1 + 1e-9`). Once clamped, `effectiveCount = prev_count * (1 - elapsedFractionOfCurrentWindow) + current_count` — the standard sliding-log approximation that avoids O(N) timestamp storage. Architect to confirm the approximation is acceptable vs a hard fixed-window (default recommendation: weighted, since fixed-window allows 2x burst at window boundaries).

- **Single logical timestamp per statement (invariant).** All time values consumed by the primitive's CTE — `curr_start`, `prev_start`, `now_epoch`, `curr_epoch` — MUST derive from a single logical instant per statement execution. PostgreSQL's `now()` is `transaction_timestamp()` and is stable across all references inside a single statement; this is the only timestamp source the CTE may read. Introducing `clock_timestamp()` (which advances within the statement) or any application-supplied timestamp parameter is a spec-conformance violation. Future maintainers MUST NOT "optimise" the CTE by hoisting time computation to the application layer — the multi-instance-safety property in the prior bullet depends on this invariant.

- **No in-process caching, no in-process pre-check.** Every `check()` does the single CTE round-trip described above. The earlier in-process Map limiters (§4) were removed because they fragment under multi-process / multi-instance topologies; reintroducing an in-process pre-check (even framed as "DB protection") brings the same fragmentation back. If pre-production testing surfaces DB amplification under spray, the mitigation is upstream — load-balancer / CDN rate limiting, or a measured `statement_timeout` (deferred, §13) — not another in-process layer. The §10.5 *No-shim rationale* binds here as well: the only operationally accessible mitigation is the per-call-site `limit` constant.

#### 2.4 Cleanup job `server/lib/rateLimitCleanupJob.ts`

Cleanup MUST run in **bounded batches** so a long-deferred run (worker crash, deploy gap) cannot lock the table or trigger vacuum pressure under a single large DELETE. The batched pattern:

```sql
-- Cutoff is computed inline from DB time to stay consistent with the
-- bucket-alignment invariant (§6.2.3): the limiter and its janitor read
-- the same clock. No application-supplied cutoff parameter.
WITH victims AS (
  SELECT key, window_start
  FROM rate_limit_buckets
  WHERE window_start < now() - interval '2 hours'
  ORDER BY window_start
  LIMIT 5000
  FOR UPDATE SKIP LOCKED
)
DELETE FROM rate_limit_buckets r
USING victims v
WHERE r.key = v.key AND r.window_start = v.window_start
RETURNING 1;
```

The job loops the batched DELETE until either the returned row count is `< 5000` (caught up) or a hard iteration cap of `20` batches per run is reached (i.e. ≤ 100 000 rows per scheduled run). Reaching the cap emits a `logger.warn('rate_limit.cleanup_capped', { rowsDeleted, iterations })` so an outsized backlog surfaces rather than silently extending. The `FOR UPDATE SKIP LOCKED` lets concurrent worker invocations make progress without serialising on the same victim set.

**Ordering-bias note.** The `ORDER BY window_start` victim selection deletes the oldest expired rows first, so under a backlog scenario the cleanup is biased towards the oldest tail rather than achieving per-key fairness. This is intentional — old rows are equally expired regardless of which key they belong to, and the bias is harmless given the 2-hour TTL is purely a cleanup boundary, not a correctness threshold. Recording the bias here so future maintainers don't read it as an oversight.

Frequency: once every 5 minutes.

**TTL retention rationale.** The sliding-window read in §7.1 needs the *previous* window's row, not just the current one. The longest `windowSec` in the call-site set is `3600` (the test-run hourly limiter, §6.2.5). The cleanup cutoff therefore must be at least `2 * max(windowSec)` = 2 hours so the previous-window row is still present at the moment the current window rolls over. A 1-hour cutoff would race the test-run limiter's window boundary and silently degrade the sliding-window approximation back to a fixed-window. The `2 hours` value is conservative for the current call-site set; if a longer-window call site is ever added, this constant is updated in the same PR.

Architect to call (intentional architect-deferral): pg-boss worker vs `setInterval` in the boot path. Default recommendation: pg-boss worker for parity with other maintenance jobs. If pg-boss, register in `server/index.ts` `start()` alongside the other queue workers (the file inventory in §5 already lists `server/index.ts` as a Phase 2 modification for this purpose).

#### 2.5 Call-site migration

Each of the call sites enumerated below switches in the same PR as Phase 2. No "leave one in-process for now" — the new primitive replaces the entire class.

| Call site | Old | New (key shape) |
|---|---|---|
| `server/routes/auth.ts` login | local `loginAttemptTimestamps` Map + `enforceLoginRateLimit` | `rateLimiter.check('auth:login:' + ip + ':' + emailLower, 10, 900)` (10 / 15 min) |
| `server/routes/auth.ts` signup | `enforceLoginRateLimit('signup:' + ip)` | `rateLimiter.check('auth:signup:' + ip, 10, 900)` |
| `server/routes/auth.ts` forgot/reset password | `express-rate-limit` instances | `rateLimiter.check('auth:forgot:' + ip, 5, 900)` and `rateLimiter.check('auth:reset:' + ip, 5, 900)`. Suggested: 5 / 15 min mirrors current. |
| `server/routes/public/formSubmission.ts` | local Maps `ipHits` + `pageHits` | `rateLimiter.check('public:form:ip:' + ip, 5, 60)` AND `rateLimiter.check('public:form:page:' + pageId, 50, 60)` |
| `server/routes/public/pageTracking.ts` | local Map `trackHits` | `rateLimiter.check('public:track:ip:' + ip, 60, 60)` |
| `server/routes/agents.ts:167`, `server/routes/skills.ts:158`, `server/routes/subaccountAgents.ts:286`, `server/routes/subaccountSkills.ts:125` | `checkTestRunRateLimit(userId)` (sync; throws on limit) | `await rateLimiter.check('testrun:user:' + userId, TEST_RUN_RATE_LIMIT_PER_HOUR, 3600)`; reject on `!allowed`. The four call sites become async (already inside async route handlers). |

After migration, the following are deleted:
- `server/lib/testRunRateLimit.ts` (file).
- `server/routes/auth.ts` lines 11–12 (`forgotPasswordRateLimit`, `resetPasswordRateLimit`) and lines 14–30 (`loginAttemptTimestamps`, `enforceLoginRateLimit`).
- The local Maps + `checkRateLimit` helpers in both public routes.
- `import rateLimit from 'express-rate-limit'` at `server/routes/auth.ts:2`. The package itself is reached via a transitive dependency in root `package-lock.json`, not a direct entry in root `package.json`; removing the import drops the only reference but no manifest line needs to change.

**On-failure behaviour:** when `rateLimiter.check` returns `allowed: false`, the route responds with **429** + a body matching the existing route's response shape (so existing client UX is preserved) AND a `Retry-After: <secondsUntilResetAt>` header derived via the exported `getRetryAfterSeconds(result.resetAt)` helper (§7.1). The `Retry-After` header is mandatory across every 429 path the new primitive emits (auth, public form, public track, test-run, sessionMessage); routes MUST call the helper rather than re-deriving the formula inline.

**No env-flag rollback shim** (per `DEVELOPMENT_GUIDELINES § 8.6`). The new primitive replaces three structurally-broken implementations; rolling back to "in-process Map limiter" is not a credible recovery path. If the new primitive misbehaves under load in pre-production testing, the recovery is to fix forward — a two-line PR that raises the per-call-site `limit` constants (effectively disabling the gate) or reverts the commit. No env-flag knob is introduced.

### Phase 3 — Webhook secret boot assertion

#### 3.1 Boot-time assertion

In `server/index.ts` `start()`, after the existing `validateSystemSkillHandlers()` block:

```ts
if (env.NODE_ENV === 'production' && !env.WEBHOOK_SECRET) {
  throw new Error(
    '[boot] WEBHOOK_SECRET is unset in production. Outbound webhooks would be unsigned and inbound callbacks would accept any token. Set WEBHOOK_SECRET to a long random string before booting in production.'
  );
}
```

The throw is caught by the existing `start().catch()` at the bottom of `server/index.ts:625-628` which logs and `process.exit(1)`s, matching the pattern used by `validateSystemSkillHandlers`. No new error-handling path is required.

#### 3.2 Dev-mode fallback warning

`server/services/webhookService.ts` `verifyCallbackToken` already has a `if (!secret) return true` open-mode branch (lines 75–76). Add a one-time `logger.warn('webhook.open_mode_active', { … })` the first time this branch executes per process. This satisfies `DEVELOPMENT_GUIDELINES § 8.20` — when an enforcement is conditional, the boundary still emits an observable signal.

Implementation: a module-level `let warned = false` flag; warn-once-per-process. Architect to confirm: warn-once-per-process is sufficient (default recommendation) vs warn-once-per-secret-rotation. Per-process is simpler and the operational signal is "this server has webhook open mode active" — a single warning on the first callback verification per process answers that.

**Per-request HMAC verification when a secret IS present** stays unchanged. The boot-time assertion + open-mode warning are the only two changes to webhook auth.

### Phase 4 — Brief-creation envelope harmonisation

#### 4.1 The unified envelope

Define `BriefCreationEnvelope` in `shared/types/briefFastPath.ts` (extending the file that already houses `BriefUiContext` and `FastPathDecision`). See §7.4 for the contract.

The envelope **is** the output of `createBrief()` plus the resolved-context fields (`organisationId`, `subaccountId`, `organisationName`, `subaccountName`). All envelope fields are required at the type level; the name fields and `subaccountId` may be `null` when the route does not have a pre-loaded lookup or the brief is org-scoped (see §7.4 for the per-field nullability matrix). Both routes return a value satisfying this type.

#### 4.2 Route changes

**`server/routes/briefs.ts`** `POST /api/briefs`:

- Returns `BriefCreationEnvelope` directly (currently returns the raw `createBrief()` result, which already includes `briefId`, `conversationId`, `fastPathDecision` — adding `organisationId` and `subaccountId` is a one-line addition).
- `organisationName` / `subaccountName` are returned when known (from the resolved subaccount lookup) and `null` otherwise. The Layout modal already tolerates this.

**`server/routes/sessionMessage.ts`** every `brief_created` arm (Path A `pendingRemainder` resolution, Path B decisive command, Path C plain submission):

- The existing `SessionMessageResponse` discriminated union keeps its shape, but **every** `brief_created` arm's payload becomes a structural superset: `{ type: 'brief_created' } & BriefCreationEnvelope`. The other three arms (`disambiguation`, `context_switch`, `error`) are unchanged — they are not brief-creation results.
- The existing `organisationName: null` / `subaccountName: null` literal returns are kept on the paths where the route does not have a pre-loaded name lookup (Path C currently); F15 deferred entry covers backfilling them.

#### 4.3 Client changes

**`client/src/components/Layout.tsx`** New Brief modal:

- Strongly-type the response to `BriefCreationEnvelope` (currently inline `{ briefId: string; conversationId: string }`). The `fastPathDecision` field is now visible to the modal but the modal does NOT act on it — the modal navigates straight to the brief detail page, where the brief page consumes `fastPathDecision`. The import in `Layout.tsx` is type-only.

**`client/src/components/global-ask-bar/GlobalAskBar.tsx`**:

- Every `brief_created` response (Paths A/B/C) is now typed as `{ type: 'brief_created' } & BriefCreationEnvelope`. The Path C handler already consumes `data.organisationId`, `data.subaccountId`, `data.briefId`; the new envelope adds `fastPathDecision` and `conversationId` — both are forward-compatible (existing handler ignores extra fields). No code change required in `handleResponse` beyond the type change in `GlobalAskBarPure.ts`.

**`client/src/components/global-ask-bar/GlobalAskBarPure.ts`**:

- `SessionMessageResponse` `brief_created` arm uses `BriefCreationEnvelope`. The 4-arm discriminated union is preserved; only the `brief_created` arm's payload type tightens.

**No per-route response-shape branching remains in client code** — both Layout and GlobalAskBar speak `BriefCreationEnvelope` for the brief-creation result, regardless of which endpoint was called. This is the acceptance criterion for G5.

#### 4.4 Backwards compatibility

Both `/api/briefs` and `/api/session/message` are internal-only API routes (authenticated). There are no external integrations consuming them. Adding fields to the response is safe; tightening the type is safe. The change is additive at the wire level.

### Phase 5 — Scope-resolution perf guard

**File:** `server/services/scopeResolutionService.ts` `findEntitiesMatching`, plus a sibling pure helper to make the guard testable.

**Change:** extract the min-length predicate as an exported pure helper, then call it at the very top of `findEntitiesMatching`:

```ts
/** Pure predicate for the entity-search guard. Exported so tests pin the boundary without spinning up the service. */
export function shouldSearchEntityHint(hint: string): boolean {
  return hint.trim().length >= 2;
}

export async function findEntitiesMatching(input: EntitySearchInput): Promise<ScopeCandidate[]> {
  const { hint, entityType, userRole, organisationId } = input;
  if (!shouldSearchEntityHint(hint)) return [];
  // ... existing body
}
```

**Why a pure helper:** the project's testing posture is `runtime_tests: pure_function_only`. The guard's correctness (returns `false` for `''`, `' '`, `'a'`; `true` for `'ab'` and longer) is testable as a pure function without any DB or service setup. The helper also gives any future caller of `findEntitiesMatching` (programmatic, admin tooling, future routes) a single place to consult the same predicate before invoking the async service.

**Why service-level despite the existing route-level guard:** the route guard at `server/routes/sessionMessage.ts:84` only runs in Path B (parsed `command.entityName`). Any future caller of `findEntitiesMatching` hits the unguarded service. Defence-in-depth at the service level closes the class.

**Out of scope:** `pg_trgm` index, prefix-only mode, query-cache memoisation. Those are perf optimisations that warrant measurement first — separate spec.

### Phase 6 — Rate limit + tests on `/api/session/message`

#### 6.1 Rate-limit middleware on `/api/session/message`

`POST /api/session/message` is gated through `requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE)` already; add `rateLimiter.check` immediately after authentication:

- **Key shape:** `'session:message:user:' + req.user.id` — per-user. Architect to confirm: per-user vs per-user+org. Default recommendation: per-user (the limit is on a logged-in user's typing rate, not on a tenant; user IDs are globally unique). A user toggling between orgs in the same minute is still the same human typing — a per-user+org key would let the same human exceed the per-org limit by switching tenants, which is exactly what the limit is meant to bound.
- **Limit:** 30 / minute. Architect to confirm. Default recommendation: 30/minute is generous for human typing and conservative against scripted abuse.
- **Failure mode:** 429 + `{ type: 'error', message: 'Too many requests, please slow down.' }` — keeps the existing `SessionMessageResponse` `error` arm shape so GlobalAskBar's existing error handler renders correctly. `Retry-After` header is set per Phase 2's mandatory standard.

The limit applies to **all paths** (A/B/C). A user hammering the disambiguation Path A is just as abusive as one hammering Path C; one limit covers all.

**Middleware ordering invariant (audit semantics).** The route's middleware chain is `[global express.json() body-parser] → authenticate → rateLimiter.check → requireOrgPermission(BRIEFS_WRITE) → handler`. Body parsing happens at the global Express level (mounted in `server/index.ts` ahead of any route), so the body is already parsed by the time the rate-limit middleware fires; this is intentional — the limiter keys on the authenticated `req.user.id`, which depends on `authenticate`, which itself does not need a parsed body. The limiter therefore charges authenticated users for spammy POSTs even when the body is malformed (the malformed body fails the route handler with a 400 *after* the limiter charge), which is the desired behaviour against scripted abuse. The ordering of the three named middlewares is deliberate so the response code distinguishes the three failure classes:

| Caller state | Failing middleware | HTTP response |
|---|---|---|
| Unauthenticated request | `authenticate` | **401** — no rate-limit charge for the request (the bucket is per-user-id, which the unauthenticated request cannot supply) |
| Authenticated, exceeded limit | `rateLimiter.check` | **429** + `Retry-After` |
| Authenticated, within limit, lacks `BRIEFS_WRITE` | `requireOrgPermission` | **403** |

This ordering applies to **every** rate-limited authenticated route added by this spec (currently `/api/session/message`; Phase 2 auth routes are unauthenticated and so the matrix collapses to "no auth check before the limiter — IP-keyed limiter runs first"). Reviewers MUST confirm new authenticated routes added in follow-up specs preserve `auth → rateLimit → permission` to keep the response-code semantics consistent across the boundary.

#### 6.2 Integration tests `server/routes/__tests__/sessionMessage.test.ts`

**Framing deviation flagged here per `docs/spec-context.md`:** `api_contract_tests: none_for_now`. The brief explicitly requested integration tests for `/api/session/message` because the spec-context default would leave the four cross-tenant + stale-subaccount paths untested. The brief author acknowledged the deviation. This spec inherits that acknowledgement: **F8 ships as integration tests against a real DB**, mirroring the existing `workflowEngineApprovalResumeDispatch.integration.test.ts` pattern (so the existing harness pays the cost, not new tooling).

**Test cases:**

| # | Path | Scenario | Assertion |
|---|---|---|---|
| T1 | A | User clicks a disambiguation candidate (`selectedCandidateType: 'org'`); resolver returns `org` row | Response is `{ type: 'context_switch', organisationId, organisationName }` with no subaccount fields. No `tasks` row created. |
| T2 | A | User clicks a disambiguation candidate (`selectedCandidateType: 'subaccount'`) WITH `pendingRemainder` | Response is `{ type: 'brief_created', ...BriefCreationEnvelope }`. One `tasks` row created with the resolved org + subaccount. |
| T3 | A | Cross-tenant rejection: non-system-admin clicks a candidate with an `id` belonging to a different org | Response is `{ type: 'error', message: 'Invalid selection — …' }`. No `tasks` row. |
| T4 | B | "change to <name>, schedule a follow-up" command resolves decisively to one subaccount | Response is `{ type: 'brief_created', ...BriefCreationEnvelope }`. `tasks.subaccountId` matches the matched candidate. |
| T5 | B | Hint shorter than 2 chars (e.g. "change to A") | Response is `{ type: 'error' }` from the **route-level** guard at `sessionMessage.ts:84`. T5 covers the route-level path; the Phase 5 service-level guard (`shouldSearchEntityHint`) is verified separately by the pure-unit test in §12. |
| T6 | C | Plain brief submission with valid `sessionContext` | Response is `{ type: 'brief_created', ...BriefCreationEnvelope }`. One `tasks` row created. |
| T7 | C | Cross-tenant via `X-Organisation-Id` header rejected for non-system-admin | Authentication-level rejection (existing middleware behaviour); test verifies `tasks` count unchanged. |
| T8 | C | Stale-subaccount drop: `sessionContext.activeSubaccountId` does not belong to the resolved org | Response is `{ type: 'brief_created', ...BriefCreationEnvelope }` with `subaccountId: null`. `logger.warn('session.message.stale_subaccount_dropped', …)` emitted. |

Real DB transactions per the existing integration-test pattern. Tests skip when `process.env.DATABASE_URL` is unset (per the existing convention; centralising the skip helper is deferred — see `tasks/todo.md` PR #226 deferred entry).

### Phase 7 — Dev-script safety

#### 7.1 Reseed env guard

`scripts/_reseed_drop_create.ts`: at the top of the script (this file is currently top-level statements, not a `main()` function — architect may refactor into a `main()` if cleaner):

```ts
if (process.env.NODE_ENV !== 'development') {
  throw new Error(
    `[reseed] Refusing to run: NODE_ENV is "${process.env.NODE_ENV ?? 'undefined'}", expected "development". This script DROPs and recreates the database.`
  );
}
```

The verdict is `NODE_ENV` only. A host-pattern check on `DATABASE_URL` would need to maintain a list of "known production hosts" — the single-source guard is cleaner and the operator-error mode "I forgot to set NODE_ENV=development" is the realistic failure. Production environments hosting the application set `NODE_ENV=production`; a misconfigured production environment is out of scope for this guard.

#### 7.2 Reseed transaction wrap

`scripts/_reseed_restore_users.ts`: lease a single `client` via `pool.connect()` and run all of `BEGIN` / `UPDATE` / `COMMIT` / `ROLLBACK` through `client.query`. Never call `pool.query` for any of these — that returns a different connection per call and would not establish a transaction. The script uses raw `pg` `Pool`, not Drizzle:

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  for (const row of rows) {
    const r = await client.query(/* … existing UPDATE … */);
    // … logging
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  throw err;
} finally {
  client.release();
}
```

All DML uses `client.query`, never the global `pool`. On failure, the DB is unchanged so re-run is idempotent (no half-restored partial state).

**Out of scope:** changing the backup-file location, the file-discovery logic, or the per-row UPDATE shape. Just the transaction wrap.

## 7. Contracts

### 7.1 `RateLimiter` primitive contract

**File:** `server/lib/rateLimiter.ts`.

```ts
export interface RateLimitCheckResult {
  /** True if this call is permitted; false means the caller must reject. */
  allowed: boolean;
  /**
   * Number of remaining calls in the current effective window after this one is counted.
   * Computed as `Math.max(0, Math.floor(limit - effectiveCount))`. Always clamped at 0
   * (so a denied call returns `0`, not a negative number).
   *
   * **Instantaneous estimate, not a monotonic sequence.** `remaining` may *increase* between
   * two successive `check()` calls for the same key — sliding-window weighting deweights the
   * prior window's contribution as time elapses, so a quiet caller can observe the
   * estimate recover. Treat `remaining` as a hint for client UX (e.g. progress bars), never
   * as a counter the client decrements locally. Operational reports of "remaining went up,
   * is this a bug?" are expected behaviour, not regressions.
   */
  remaining: number;
  /**
   * End of the current FIXED window: `new Date(curr_window_start.getTime() + windowSec * 1000)`,
   * where `curr_window_start` is the DB-computed window-start timestamp returned by the CTE
   * (§6.2.3). The application MUST NOT recompute `window_start` from `Date.now()` — window
   * alignment is anchored on DB time so multi-instance deployments cannot fragment buckets
   * via clock skew.
   *
   * **Approximation, not a guaranteed-acceptance moment.** Under the sliding-window math
   * (§6.2.3), residual weight from the prior window may continue to deny up to one full
   * window beyond this instant. Treat `resetAt` as a **minimum** retry time the client
   * MUST wait; a request fired exactly at `resetAt` may still receive `allowed: false`.
   * Clients SHOULD layer exponential backoff on top of `Retry-After` rather than retrying
   * exactly at the header's instant — see §7.1 *Client retry guidance*.
   *
   * The downstream `Retry-After` header is derived from `resetAt` via `getRetryAfterSeconds`
   * (helper exported alongside this interface) and inherits the same approximation.
   */
  resetAt: Date;
}

/**
 * Derives the `Retry-After` header value (whole seconds) from a `resetAt` instant.
 * Centralised so every 429 emission shares the same rounding rule.
 *
 * - `Math.ceil` rounds partial seconds up so the caller never re-fires inside the same window.
 * - `Math.max(1, …)` guarantees the header is never `0` or negative (per RFC 7231).
 */
export function getRetryAfterSeconds(resetAt: Date): number {
  return Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
}

/**
 * Sliding-window rate-limit check. Atomic: every call is counted (UPSERT)
 * regardless of allowed; allowed=false means the count is over the limit
 * for the effective window. The caller MUST reject on allowed=false.
 *
 * **Non-leaky: denied calls still increment the bucket.** Each invocation
 * unconditionally performs the UPSERT before evaluating the limit, so a
 * caller that retries a denied request will deepen the denial — the next
 * call sees a higher `current_count` and produces the same `allowed: false`
 * with one fewer notional slot remaining. This is the intended behaviour
 * (it punishes scripted retry loops) but is the explicit reason §10.1's
 * retry classification is `unsafe`.
 *
 * The primitive does NOT throw for denial outcomes — denial is `allowed: false`,
 * not an exception. Operational failures (DB connection drop, query error,
 * query-pool timeout) propagate as a rejected promise — see §10.1 *Failure mode*
 * for the fail-closed posture and the no-retry contract.
 *
 * **Denial observability:** when this function returns `allowed: false`, it
 * emits `logger.info('rate_limit.denied', { key, limit, windowSec, currentCount,
 * effectiveCount, remaining, resetAt: resetAt.toISOString() })` exactly once per
 * denial. Routes do not need to log denial themselves; one canonical signal lives
 * in the primitive (`DEVELOPMENT_GUIDELINES § 8.20`). `key` is the caller-supplied
 * string verbatim — see §7.2 *Key cardinality* for the bounded-cardinality
 * invariant attacker-controlled keys must satisfy before reaching this function.
 *
 * @param key Caller-defined key. Conventional shape: `{namespace}:{kind}:{value}`
 *            e.g. `auth:login:1.2.3.4:user@example.com`. The primitive treats
 *            keys as opaque strings.
 * @param limit Maximum allowed calls per window.
 * @param windowSec Window size in seconds. Used for window alignment.
 * @returns Decision + remaining-budget metadata for the response.
 * @throws Operational DB errors (connection drop, query failure, pool timeout) only — never throws to signal denial.
 */
export function check(key: string, limit: number, windowSec: number): Promise<RateLimitCheckResult>;
```

**Producer:** every rate-limited route in `server/routes/`.
**Consumer:** the route's response builder; on `!allowed` the route emits `429` with the existing route's response body shape and a `Retry-After: <secondsUntilResetAt>` header.

**Example: login limiter call**

```ts
const result = await rateLimiter.check(`auth:login:${req.ip}:${email.toLowerCase()}`, 10, 900);
if (!result.allowed) {
  res.set('Retry-After', String(getRetryAfterSeconds(result.resetAt)));
  res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  return;
}
```

**Example: stale-bucket cleanup row** (after the 5-min cleanup job):

```
key='auth:login:1.2.3.4:user@example.com'
window_start='2026-04-29T12:30:00.000Z'
count=4
```

After the cleanup interval (window_start older than `now - 2h`, see §6.2.4 for the `2 * max(windowSec)` retention rationale), this row is deleted.

**Source-of-truth precedence:** the `rate_limit_buckets` table is the single representation. There is no in-memory cache; every check is a round-trip. If a future implementation introduces an LRU cache (out of scope), the table remains canonical and the cache is best-effort.

**Client retry guidance.** Because `Retry-After` reflects the *fixed* window boundary while the limiter math is sliding (see `resetAt` doc), a client that retries exactly at the header value can still receive `allowed: false`. Server-side mitigation (e.g. inflating the header by one window) would be cosmetic; the correct posture is a client-side jittered exponential backoff seeded with `Retry-After` as the first interval. Internal client surfaces (Layout New-Brief modal, GlobalAskBar, public form / track pages) inherit their existing `fetch` retry posture; this spec does not introduce new retry logic. If a future client surface DOES retry on 429, the spec author MUST verify it backs off rather than spinning at `Retry-After`.

### 7.2 `rate_limit_buckets` schema contract

| Column | Type | Nullability | Default | Notes |
|---|---|---|---|---|
| `key` | `text` | NOT NULL | — | Opaque caller-defined string. Documented expectation: ≤ 256 chars; callers MUST keep keys within this bound (no DB-side `CHECK` constraint — pathological keys are a caller bug, not a DB-enforced invariant). |
| `window_start` | `timestamptz` | NOT NULL | — | Aligned to `floor(now / windowSec) * windowSec`. UTC. |
| `count` | `integer` | NOT NULL | `0` | Incremented atomically via UPSERT. |
| **PRIMARY KEY** | `(key, window_start)` | — | — | Single index supports both UPSERT conflict target and window-pair reads. |
| **INDEX** `rate_limit_buckets_window_start_idx` | `(window_start)` | — | — | Cleanup-job range delete. |

**No `organisation_id`.** Keys may include user IDs across orgs but the bucket itself is system-wide infrastructure. The `scripts/rls-not-applicable-allowlist.txt` entry carries the rationale "system-wide rate-limit infrastructure; key strings opaque, never tenant-private."

**No separate `(key)` index.** The composite `PRIMARY KEY (key, window_start)` is a B-tree that supports leftmost-prefix lookups (`WHERE key = $1` alone), so the runtime path's query (`WHERE key = $1 AND window_start = $X`) is fully indexed. A standalone `(key)` index would double per-UPSERT index maintenance on the hot write path with zero query benefit. If a future ad-hoc query (debugging, analytics) wanted to scan all rows for a given `key`, the composite PK already serves it.

**Future-trigger condition.** If pre-production (or production) observability surfaces sustained `>50 ms` latencies on key-level lookups (e.g. a debugging query that filters `WHERE key = $1` without a `window_start` predicate), the trigger to add a covering `(key)` index fires despite the write-path cost. Recording the trigger here so the next reviewer doesn't re-litigate the decision in the abstract.

**Key cardinality (hardening invariant).** The bucket table grows linearly with `count(distinct key)`. The TTL cleanup job (§6.2.4) bounds rows to a 2-hour window, but unbounded key cardinality within a single window can still bloat the table — particularly under attack where an adversary may inject randomised tokens (e.g. spoofed emails) that each create a new row. Callers MUST therefore satisfy:

1. **Bounded-shape inputs.** IDs (user, org, page) and IPs are bounded by upstream issuance — accepted as-is. Free-form attacker-controlled tokens (notably the email component of `auth:login:<ip>:<email>`) MUST be normalised (`toLowerCase`, `trim`) and length-capped at the route boundary before being concatenated into the key. The existing login route already lowercases the email; the spec inherits that and adds the explicit invariant.
2. **No raw user input in keys outside this list.** Adding a new call site that includes free-form text (search query, brief title, etc.) requires either (a) hashing the offending component or (b) replacing it with an upstream-bounded ID. New free-form-keyed call sites without one of these treatments are a spec-conformance violation.

   Hashing pattern (when option (a) applies):

   ```ts
   import { createHash } from 'node:crypto';
   const safeComponent = createHash('sha256').update(rawValue).digest('hex').slice(0, 16);
   const key = `mynamespace:mykind:${safeComponent}`;
   ```

   The 16-char hex prefix (64 bits of hash output) keeps the key short while making cardinality bounded by `2^64` worst-case — vastly larger than realistic per-tenant lifetime traffic, but still fixed-width. Use the full 64-char hex digest only when collision resistance under adversarial input is the explicit goal.

The current Phase 2 + Phase 6 call-site set (§6.2.5) is compliant: every key component is either an IP, an integer/UUID ID, or a normalised email. No additional hashing is shipped in this spec; the invariant is recorded so future call sites declare their compliance up front.

**Within-window adversarial cardinality (airtight rule).** TTL cleanup bounds inter-window growth; it does NOT bound the number of unique rows an attacker can create *inside a single active window* (e.g. by rotating the email component on every login attempt). If a call site permits a high-cardinality attacker-controlled component, the caller MUST either (a) hash that component into a fixed-width digest per the snippet above or (b) enforce an upstream cap (e.g. a coarser per-IP rate-limit *outside* this primitive — typically at the LB / edge — that fires before the attacker can rotate the inner component). The current call-site set is judged compliant under (b): the existing IP-based normalisation + per-IP forgot/reset/login limits cap the rotation rate, so the email component cannot be rotated faster than the IP allows. Future call sites that loosen this implicit cap (e.g. by removing the IP component) MUST add explicit hashing or an explicit secondary limiter; otherwise they regress this invariant.

### 7.3 Webhook open-mode warning contract

**Producer:** `server/services/webhookService.ts` `verifyCallbackToken` first-call branch where `secret` is undefined.
**Consumer:** stdout / log aggregation.

**Shape:**

```ts
logger.warn('webhook.open_mode_active', {
  reason: 'WEBHOOK_SECRET unset; verifyCallbackToken accepts any token',
  nodeEnv: env.NODE_ENV,
});
```

Emitted at most once per process. The boot-time assertion in Phase 3.1 prevents this branch from ever firing in production.

### 7.4 `BriefCreationEnvelope` contract

**File:** `shared/types/briefFastPath.ts` (extended; not a new file).

```ts
export interface BriefCreationEnvelope {
  /** Newly-created brief ID. UUID. */
  briefId: string;
  /** Conversation thread for the brief. UUID. */
  conversationId: string;
  /** Fast-path triage decision computed before persistence. */
  fastPathDecision: FastPathDecision;
  /** Resolved organisation; always present (the route only succeeds with a resolved org). */
  organisationId: string;
  /** Resolved subaccount, or null if the brief is org-scoped. */
  subaccountId: string | null;
  /** Display name for the resolved organisation. May be null when the route does not have a name lookup pre-loaded (Path C currently). F15 deferred entry covers backfilling this. */
  organisationName: string | null;
  /** Display name for the resolved subaccount. May be null per the same rule as `organisationName`. */
  subaccountName: string | null;
}
```

**Producer:** `server/routes/briefs.ts` (`POST /api/briefs` returns `BriefCreationEnvelope`); `server/routes/sessionMessage.ts` every `brief_created` arm — Path A (`pendingRemainder` resolution), Path B (decisive command), Path C (plain submission) — all return `{ type: 'brief_created' } & BriefCreationEnvelope`.

**Consumer:** `client/src/components/Layout.tsx` New Brief modal; `client/src/components/global-ask-bar/GlobalAskBar.tsx` every `brief_created` arm handler (Paths A/B/C).

**Example instance:**

```json
{
  "briefId": "8f4b1a2c-3e5d-4f6a-9b8c-7d6e5f4a3b2c",
  "conversationId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "fastPathDecision": { "route": "needs_orchestrator", "scope": "subaccount", "confidence": 0.74, "tier": 1, "secondLookTriggered": false, "keywords": ["follow-up", "schedule"], "reasoning": "multi-step coordination" },
  "organisationId": "fa1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
  "subaccountId": null,
  "organisationName": "Acme Solutions",
  "subaccountName": null
}
```

**Source-of-truth precedence:** the route response is canonical. The client MUST NOT cache an older response shape and merge selectively. Both Layout and GlobalAskBar's existing handlers do whole-object replace, not selective merge — the precedence is satisfied by the existing code.

### 7.5 Reseed transaction contract

The restore loop in `_reseed_restore_users.ts` is **all-or-nothing**: either every UPDATE is applied (commit) or none is (rollback). Mid-loop failure (Ctrl-C, network blip) triggers `ROLLBACK`, leaving the DB unchanged. Re-run is idempotent because the failed run wrote nothing — re-run starts from row 0 of the backup file against a DB in the pre-run state.

**After a successful prior run**, the per-row UPDATE is also idempotent (matches by `email`, sets the same fields), so a second successful run over the same backup file no-ops every row. The two cases are independent:
- Failed run + re-run: rollback leaves DB unchanged; re-run starts clean.
- Successful run + re-run: each UPDATE no-ops because target row already matches the backup.

**Out of contract:** the script does NOT track resume-from-row-N within a single run; only the whole-run all-or-nothing guarantee.

## 8. RLS / access control

The new `rate_limit_buckets` table is **not tenant-scoped**. Per `docs/spec-authoring-checklist.md § 4` opt-out rule, the rationale is recorded inline:

- **No `organisation_id` column.** Rate-limit buckets are infrastructure: a single bucket may be keyed on an IP address, a user ID, or a globally-unique cache key. The bucket does not bind to a tenant.
- **No RLS policy.** The table is registered in `scripts/rls-not-applicable-allowlist.txt` with the rationale: `"rate_limit_buckets — system-wide rate-limit infrastructure. Keys are opaque caller-defined strings; rows are not tenant-private. Per docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md § 8."` (per `DEVELOPMENT_GUIDELINES § 8.16`, the allow-list entry cites the spec section).
- **No registration in `server/config/rlsProtectedTables.ts`.** That manifest is the source of truth for tenant-isolated tables only; non-tenant infrastructure tables stay out.
- **Access path:** the rate-limit primitive uses the raw `db` import (no `getOrgScopedDb`, no `withOrgTx`). It runs from any caller, including those operating outside an org context (e.g. unauthenticated public routes).

**Existing route guards on the rate-limited routes are unchanged:**

| Route | Existing guard | Phase 2 / 6 change |
|---|---|---|
| `POST /api/auth/login` | `validateBody(loginBody)` | Add `rateLimiter.check` before validation. |
| `POST /api/auth/signup` | `validateBody(signupBody)` | Same. |
| `POST /api/auth/forgot-password` | `validateBody(forgotPasswordBody)` | Replace `forgotPasswordRateLimit` middleware with `rateLimiter.check`. |
| `POST /api/auth/reset-password` | `validateBody(resetPasswordBody)` | Replace `resetPasswordRateLimit` middleware with `rateLimiter.check`. |
| `POST /api/public/pages/:pageId/submit` | None (public) | Replace `rateLimitMiddleware` with `rateLimiter.check`. |
| `POST /api/public/track` | None (public) | Replace inline `checkTrackRateLimit` call with `rateLimiter.check`. |
| `POST /api/session/message` | `authenticate` + `requireOrgPermission(BRIEFS_WRITE)` | Add `rateLimiter.check` after auth, before permission check (so unauthenticated noise gets 401, authenticated abuse gets 429 — order matters for the audit signal). |

## 9. Execution model

| Operation | Model | Rationale |
|---|---|---|
| `rateLimiter.check` | **Inline / synchronous.** Caller awaits the result before deciding allowed/rejected. | The result governs response shape; cannot be async. One DB round-trip per check is acceptable. |
| Rate-limit cleanup | **Queued / async (pg-boss recommended)** every 5 minutes. | Decoupled from request lifecycle; matches existing maintenance-job pattern. |
| Multer disk-storage write | **Synchronous as part of the upload middleware.** | Consumer routes process the file after middleware completes. |
| Tempfile cleanup hook | **`res.on('close')` listener fires synchronously; the listener calls `fs.unlink` (async, fire-and-forget — errors logged at debug, not awaited).** | Bound to request lifecycle. The listener does not block the response close. |
| Webhook boot assertion | **Synchronous at boot.** | Failure exits the process before any traffic. |
| Webhook open-mode warning | **Synchronous, fire-and-forget log.** | One-shot warning. |
| Brief envelope harmonisation | **Type-only at compile time + synchronous at the route.** | No new IO. |
| `findEntitiesMatching` min-length guard | **Synchronous** at the top of the function. | Returns immediately when guard fires. |
| `/api/session/message` rate-limit | **Inline / synchronous** (consumes `rateLimiter.check`). | Same as the primitive. |
| Reseed env guard | **Synchronous** at script entry. | Throws before any IO. |
| Reseed transaction | **Synchronous** wraps the existing per-row UPDATE loop. | No async behaviour change. |

**No new prompt-partition / cache-tier behaviour** — none of the in-scope work touches LLM prompt assembly. The only cache-shaped consideration is the absence of an in-memory cache in `rateLimiter.check` (intentional — every check is a DB round-trip; see §7.1).

## 10. Execution-safety contracts

Per [docs/spec-authoring-checklist.md § 10](../../spec-authoring-checklist.md), each new write path declares its idempotency posture, retry classification, and concurrency guard.

### 10.1 `rateLimiter.check` UPSERT

- **Operation:** `INSERT INTO rate_limit_buckets (key, window_start, count) VALUES ($1, $2, 1) ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1 RETURNING count`.
- **Idempotency posture:** `non-idempotent (intentional)`. Every call must increment exactly once. The caller's retry contract is "do not retry" — `rateLimiter.check` MUST be called exactly once per inbound request being checked. Routes that invoke it and then re-invoke after a failure would double-count; the existing call sites do not retry.
- **Retry classification:** `unsafe`. The DB call itself can fail (connection drop), and a transparent retry would double-count if the first call's UPSERT actually committed. The caller should treat a failed `check()` as a 500 — the route's existing error handling already maps `db.transaction` failures to 500.
- **Concurrency guard:** `optimistic — UPSERT atomicity`. Two concurrent `check()` calls for the same `(key, window_start)` race on the row, but PostgreSQL `INSERT ... ON CONFLICT DO UPDATE RETURNING` is atomic per-row. Both calls receive a returned `count`; the larger one wins. The losing caller's count is still incremented (correct — both calls did happen).
- **Unique-constraint-to-HTTP mapping:** N/A. The PRIMARY KEY violation is consumed by `ON CONFLICT DO UPDATE`; no `23505` ever bubbles.
- **Failure mode (fail closed).** A rejected `check()` promise — connection drop, query error, or `pg` pool acquisition timeout — propagates to the route's existing error-handling path and emerges as **HTTP 500**. The request is **not** allowed through; rate-limit unavailability never permits an unchecked write. This is the deliberate posture across every call site in §6.2.5, including unauthenticated public routes (form submission, page tracking) where "fail open" would otherwise be an availability win — pre-production framing prefers correctness over availability, and there are no live users to hold harmless.
- **Per-call timeout.** The primitive does not configure its own statement timeout. The single-CTE round-trip executes against the existing `pg` pool, which inherits the project-wide `statement_timeout`/pool-acquisition timeout. A timeout therefore manifests as a rejected promise and follows the fail-closed path above. A measured cost regression in pre-production testing is the trigger for tightening this further (see §13 *Deferred items* for the per-call timeout follow-up).

### 10.2 Rate-limit cleanup job

- **Operation:** `DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '2 hours'` (see §6.2.4 for the `2 * max(windowSec)` retention rationale).
- **Idempotency posture:** `safe`. Re-running the same DELETE against the now-cleaned table is a no-op.
- **Retry classification:** `safe`. pg-boss's retry policy applies; multiple worker instances racing on the cleanup is harmless (one wins the lock; others find no rows to delete).
- **Concurrency guard:** none needed. Multiple workers running the same DELETE concurrently is correct under MVCC.

### 10.3 Webhook boot assertion

- **Operation:** `throw new Error(...)` if `env.NODE_ENV === 'production' && !env.WEBHOOK_SECRET`.
- **Idempotency posture:** N/A — the assertion runs at boot, before any write.
- **Retry classification:** `safe`. The boot path is single-shot per process; restart-loops are handled by the process supervisor, not by the application.
- **Concurrency guard:** none. Boot is sequential.

### 10.4 Webhook open-mode warning

- **Operation:** `logger.warn('webhook.open_mode_active', ...)` once per process.
- **Idempotency posture:** `state-based`. A module-level `let warned = false` flag guards re-emission.
- **Retry classification:** N/A — log emission, not a transactional write.
- **Concurrency guard:** Node.js single-threaded event loop; no cross-thread race possible. (If we ever introduce worker_threads in this code path, the flag becomes per-thread.)

### 10.5 No-shim rationale (DB-backed rate limiter)

`DEVELOPMENT_GUIDELINES § 8.6` requires "infrastructure migrations ship with an env-flag rollback shim that has identical function signatures to the new path — no caller changes required to revert."

Decision: **no shim shipped** for the rate-limit primitive. Justification:

1. **The thing being rolled back to is broken.** The in-process limiters have known correctness defects (multi-process bypass, restart loss). Rolling back to them is not a recovery; it is a known-defective fallback.
2. **The new primitive's signature is wider than the old.** Every old call site has a slightly different in-process API (`enforceLoginRateLimit(key)`, `checkRateLimit(key, store, limit)`, `checkTrackRateLimit(key)`, `checkTestRunRateLimit(userId)`). There is no single function-signature shim that can transparently route to the old behaviour at every call site without a write-time fork.
3. **Pre-production framing.** Per `docs/spec-context.md`, `rollout_model: commit_and_revert`. Recovery from a misbehaving primitive is "fix forward or revert the commit", not "flip a flag". Live agencies do not exist; there is no production blast-radius to mitigate.
4. **Operationally accessible kill switch.** Each call site's limit is a code constant in the route file. If the primitive itself misbehaves under load (e.g. unexpectedly high DB cost), the operational mitigation is a two-line PR that raises the per-call-site constants (effectively disabling the gate) or reverts the commit. No env-flag knob is introduced — this preserves the framing rule that the only env-driven knobs are `WEBHOOK_SECRET` and `NODE_ENV`.

This decision is recorded inline so future readers do not interpret the missing shim as an oversight.

### 10.6 Multer disk-storage tempfile cleanup

- **Operation:** `fs.unlink(file.path)` on `res.on('close')`.
- **Idempotency posture:** `safe`. A second unlink against an already-deleted file is `ENOENT` and is silently ignored.
- **Retry classification:** `safe`. Failure to clean for any other reason (e.g. tmpdir full, permissions, FS lock) is a degraded-state warn-log (`multer.cleanup_failed` with `err.code`) — not an error response. Tempfiles linger but the request completes; recurring failures surface via the warn signal in log aggregation.
- **Concurrency guard:** none — cleanup is per-request, scoped to the request's own file.
- **Crash-recovery & secondary safety net.** `res.on('close')` fires on both success and client-abort, but **not** when the process itself crashes mid-request — those tempfiles linger until OS tmpdir reaping (Linux `systemd-tmpfiles` defaults to 10 days for `/tmp`). The OS-level reaper is the only safety net in scope; this spec does not add a periodic in-process tmp-sweep job. If pre-production testing surfaces tmpdir bloat from a pathological crash loop, the follow-up is a small `setInterval` sweep keyed on file mtime (deferred, not shipped here).

### 10.7 Reseed transaction

- **Operation:** `BEGIN; UPDATE users ...; COMMIT;` on a leased `pg` client (rollback on throw).
- **Idempotency posture:** `key-based`. Each UPDATE matches by `email` and sets the same fields. Combined with all-or-nothing rollback (§7.5), running the script twice produces the same end state: a failed run leaves the DB untouched, and a successful run's second pass no-ops on already-updated rows.
- **Retry classification:** `safe`. Mid-transaction failure rolls back; restart from row 0 against the pre-run DB state.
- **Concurrency guard:** none required — only one operator runs the reseed at a time, and the transaction holds row-level locks for the duration.

### 10.8 No state machines introduced or modified

The spec does not introduce or modify a state machine. The brief-creation envelope harmonisation does not change `tasks.status` semantics or any other state-machine row's lifecycle. Per `docs/spec-authoring-checklist.md § 10.7`, no State / Lifecycle subsection is needed.

## 11. Phase sequencing

Each phase ships in a single PR-into-the-integration-branch unit. The integration branch (`pre-prod-boundary-and-brief-api`) is the single PR to `main`.

| Phase | Schema changes | New services / modules | Modified routes | Depends on |
|---|---|---|---|---|
| 1 | none | none | none | — |
| 2 | migration `0253` (`rate_limit_buckets`) | `rateLimiter.ts`, `rateLimitCleanupJob.ts`, Drizzle schema, RLS allow-list | `auth.ts` (login, signup, forgot, reset), `formSubmission.ts`, `pageTracking.ts`; `testRunRateLimit.ts` deleted; callers migrated; `index.ts` registers the cleanup job in `start()` | — |
| 3 | none | none | `index.ts` (boot assertion only — cleanup-job registration already landed in Phase 2); `webhookService.ts` (open-mode warning) | — |
| 4 | none | `briefFastPath.ts` extended | `briefs.ts`, `sessionMessage.ts`, `Layout.tsx`, `GlobalAskBar.tsx`, `GlobalAskBarPure.ts` | — |
| 5 | none | none | `scopeResolutionService.ts` | — |
| 6 | none | none | `sessionMessage.ts` (rate-limit middleware); `sessionMessage.test.ts` new | **Phase 2** (consumes the primitive) |
| 7 | none | none | `_reseed_drop_create.ts`, `_reseed_restore_users.ts` | — |

**Dependency graph:** Phase 6 depends on Phase 2 (the primitive must exist before `/api/session/message` can consume it). All other phases are independent and can ship in any order.

**Recommended commit order:** 1 → 2 → 6 (consume primitive) → 3 → 4 → 5 → 7. The two boundary-shape changes (1, 2 + 6) ship first because they have the largest review surface; the smaller phases follow once those are stable.

**No backward dependencies, no orphaned deferrals, no phase-boundary contradictions.**

## 12. Test matrix

Per `docs/spec-context.md`: `testing_posture: static_gates_primary; runtime_tests: pure_function_only`. The acknowledged deviation is the `sessionMessage.test.ts` integration suite (F8) — the brief author explicitly requested it; this spec inherits that decision.

| Surface | Test | Type | Phase |
|---|---|---|---|
| `rateLimiter.check` window-edge math | the sliding-window formula `effectiveCount = prevCount * (1 - elapsedFractionOfCurrentWindow) + currentCount` is exposed as a pure helper (e.g. `computeEffectiveCount(prevCount, currentCount, elapsedFractionOfCurrentWindow)`) and unit-tested at edges (boundary moment, mid-window, full-window) | Pure unit | 2 |
| `shouldSearchEntityHint` | returns `false` for `''`, `' '`, `'a'`; `true` for `'ab'` and longer (the predicate `findEntitiesMatching` consults) | Pure unit | 5 |
| `sessionMessage` | T1–T8 (see § 6.2 table) | Integration (real DB) | 6 |
| Reseed `_reseed_drop_create.ts` | static inspection: the top-of-script `if (process.env.NODE_ENV !== 'development') throw …` block is present and runs before any `pool.connect()` / DDL statement. No runtime test — the guard is a single literal check; introducing a pure helper to test it would add abstraction the script doesn't otherwise need. | Static inspection | 7 |
| Reseed `_reseed_restore_users.ts` | rollback path: static inspection that the `try { BEGIN … COMMIT } catch { ROLLBACK }` shape is present, all DML uses the leased `client`, and the `pool.connect()` is `client.release()`d in `finally`. No runtime test — `pg`'s transaction semantics are not under test. | Static inspection | 7 |

**Out of scope for testing:**

- Frontend unit tests for `Layout.tsx` / `GlobalAskBar.tsx` envelope changes (per spec-context).
- E2E flow tests of the New Brief modal end-to-end (per spec-context).
- Multer upload-flow tests beyond a manual PR smoke that a sizeable upload (e.g. ~20 MB, well under the 50 MB cap) survives a round-trip via the new `multer.diskStorage` configuration without OOM (recorded in the PR description, not as a test file).
- **Route-level 429 path on `/api/session/message` is not integration-tested** — T1–T8 cover the 200/401/error arms but deliberately stop short of "fire 31 requests, expect the 31st to 429". Correctness of the 429 path relies on (a) the primitive's pure-unit test of `computeEffectiveCount` at the over-limit edge and (b) static inspection that `rateLimiter.check` is invoked before the route handler in the middleware chain (§6.1). The same coverage shape applies to every other 429-bearing route in §6.2.5; per-route 429 integration tests are intentionally not added.

**Static gates that must continue to pass:**

- `npx tsc --noEmit` for both server and client (G10).
- Existing `verify-no-silent-failures.sh` (the new primitive's error paths must not silently swallow).
- Existing `verify-rls-coverage.sh` and `verify-rls-protected-tables.sh` (the new table is registered in `rls-not-applicable-allowlist.txt`, not `rlsProtectedTables.ts`; the gate must accept this).

## 13. Deferred items

Items mentioned in spec prose but intentionally deferred to a future PR or sprint. Per `docs/spec-authoring-checklist.md § 7`, listed explicitly so prose mentions are not mistaken for deliverables.

- **`createBrief` triple-split refactor (F5).** Splitting `createBrief()` into `normalizeBriefInput` + `classifyBriefIntent` + `persistBrief`. Reason: pure-refactor scope; deserves its own PR. Tracked at `tasks/todo.md:341`.
- **F15 — populate `organisationName` / `subaccountName` in Path C response.** Currently both are `null` even when the resolved context is known. Layout + GlobalAskBar tolerate `null` via fallback to stored values. Tightening is a small follow-up. Tracked at `tasks/todo.md:345`.
- **`pg_trgm` index on `findEntitiesMatching`.** Phase 5 ships the min-length guard only; the index is a separate spec with perf measurement.
- **Tightening Helmet CSP further.** Production CSP is in place at `server/index.ts:188-213`. Further tightening (e.g. removing `'unsafe-inline'` for styles, restricting WSS origins per-environment) is a separate spec.
- **Adding `detail` field to error envelope.** Optional; current envelope already strips internals.
- **Centralising the integration-test skip helper** (`shouldSkipIntegration()` per `tasks/todo.md` PR #226 deferred entry). The new `sessionMessage.test.ts` uses the existing per-file `process.env.DATABASE_URL` check; centralising is a separate refactor.
- **#27 Centralised auth/permission audit trail.** Out of scope per brief; broader follow-up.
- **Multer disk-storage hybrid (memory below 5 MB, disk above).** Architect-decision section in Phase 1 recommends pure disk-storage for simplicity; the hybrid approach is the deferred fallback if pure-disk turns out to have a measured cost.
- **Per-call `statement_timeout` for `rateLimiter.check`.** Phase 2 inherits the project-wide pool/statement timeouts (§10.1 *Per-call timeout*). A tighter explicit timeout (e.g. 50 ms) is a deferred follow-up — only ship if pre-production testing surfaces a measured tail-latency cost on the rate-limit path.
- **Circuit breaker on rate-limit DB unavailability.** Current posture is fail-closed (§10.1) — a DB hiccup turns into request-wide 500s. A future enhancement is a circuit breaker that selectively relaxes per-route limits (or fails open on lower-criticality public routes only) when DB writes are timing out, accepting a brief amplification window in exchange for availability. Out of scope here: we have no live users to protect, and the kill-switch (raise per-call-site `limit` constants) covers the manual recovery path. Spec entry exists so the next reviewer doesn't propose an in-process backstop as a substitute (see §6.2.3 *No in-process pre-check*).
- **`rate_limit.near_capacity` early-warning emission.** Today the primitive only emits `rate_limit.denied` (§7.1 *Denial observability*) — operators see a saturation only once denial begins. A future enhancement is an additional `logger.info('rate_limit.near_capacity', { key, limit, effectiveCount, threshold })` emitted when `effectiveCount / limit ≥ configured_threshold` (e.g. 0.8). Out of scope here — pre-production has no live traffic to surface a near-saturation signal; recording the hook so the next reviewer doesn't re-propose it as if it were missing.
<!-- Retry-After header standardisation: NOT deferred. Phase 2 / 6 mandate it on every 429 emitted by the new primitive (see §6.2.5 on-failure behaviour and §7.1 contract). -->


## 14. Acceptance criteria

(Mirrors the brief, expanded with the static-gate evidence each criterion produces.)

| # | Criterion | Static evidence |
|---|---|---|
| AC1 | Multer caps at 50 MB and uses `multer.diskStorage` for all uploads; existing file routes accept the new cap unchanged. | `validate.ts` configuration; tempfile-cleanup hook present. |
| AC2 | `server/lib/rateLimiter.ts` shipped with a pure-unit test of the sliding-window math helper (`computeEffectiveCount`). Concurrent-increment correctness is delegated to PostgreSQL's per-row UPSERT atomicity (§7.1, §10.1) — no runtime concurrency test. TTL cleanup correctness is structural (a single `DELETE … WHERE window_start < cutoff`) — static inspection only. | Pure-unit test file present; passes under `bash scripts/run-all-unit-tests.sh`. |
| AC3 | Every rate-limit call site enumerated in §6.2.5 migrated; `testRunRateLimit.ts` deleted; in-line `loginAttemptTimestamps` Map removed; `forgotPasswordRateLimit` / `resetPasswordRateLimit` `express-rate-limit` instances removed. | `git diff` shows the deletions. Grep: zero remaining `Map<string, number[]>` rate-limit windows in `server/`. |
| AC4 | Production boot fails fast with a clear error if `WEBHOOK_SECRET` unset; non-production logs a one-time fallback warning. | Boot path inspection; manual smoke test recorded in PR description. |
| AC5 | `/api/briefs` and `/api/session/message` brief-creation path return the same `BriefCreationEnvelope` shape; client surfaces consume the unified shape. | TypeScript inference: both routes' return types satisfy `BriefCreationEnvelope`; client handlers type-check against it without per-route branches. |
| AC6 | `findEntitiesMatching` returns `[]` for hint < 2 chars (verified by unit test). | Test file present. |
| AC7 | `/api/session/message` rate-limited at the new primitive. | Static route inspection: `rateLimiter.check` is invoked after authentication and before the permission check. The T1–T8 set deliberately does not include a 429 case — the rate-limit edge is covered by the primitive's own tests in Phase 2. |
| AC8 | `sessionMessage.test.ts` covers Path A / B / C, cross-tenant rejection, stale-subaccount drop. | Test file present; tests pass against real DB. |
| AC9 | Reseed scripts: `_reseed_drop_create.ts` throws unless `NODE_ENV=development`; `_reseed_restore_users.ts` wraps the restore loop in transaction. | Static inspection. |
| AC10 | `npx tsc --noEmit` clean for both server and client. | CI gate. |
| AC11 | The CI gates that already existed (RLS coverage, no-silent-failures, RLS-protected-tables registry) continue to pass. | Existing gates green at branch tip. |

## 15. References

- Brief: `tasks/builds/pre-prod-boundary-and-brief-api/brief.md` (narrowed 2026-04-29).
- Source backlog: `tasks/todo.md` lines 41–53 (security findings #19–#27 — see brief's *Verified closed* table for status), line 916 (P3-M1), lines 340–344 (F1, F6, F7, F8 from PR #233 round 1), lines 1337–1346 (reseed scripts).
- Sister-branch briefs: `tasks/builds/pre-prod-tenancy/brief.md`, `tasks/builds/pre-prod-workflow-and-delegation/brief.md`.
- Spec authoring checklist: [`docs/spec-authoring-checklist.md`](../../spec-authoring-checklist.md).
- Spec framing: [`docs/spec-context.md`](../../spec-context.md).
- Development discipline rules referenced: `DEVELOPMENT_GUIDELINES.md § 8.4, 8.6, 8.10, 8.11, 8.12, 8.16, 8.20, 8.21`.
- ChatGPT review log (PR #233): `tasks/review-logs/chatgpt-pr-review-brief-feature-updates-2026-04-29T01-05-59Z.md`.
- Section 0 verification reads against `main` HEAD `93e855e7` (2026-04-29).
- Existing primitives evidenced: `server/lib/testRunRateLimit.ts`, `server/routes/auth.ts`, `server/routes/public/formSubmission.ts`, `server/routes/public/pageTracking.ts`, `server/services/briefCreationService.ts`, `shared/types/briefFastPath.ts`, `server/services/scopeResolutionService.ts`, `server/services/webhookService.ts`, `server/middleware/validate.ts`, `server/index.ts`, `scripts/_reseed_drop_create.ts`, `scripts/_reseed_restore_users.ts`.
