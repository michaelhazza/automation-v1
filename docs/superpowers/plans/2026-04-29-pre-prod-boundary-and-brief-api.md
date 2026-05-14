# Pre-Production Boundary Security + Brief API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Per project CLAUDE.md §2:** After this plan is finalised, the main session proceeds directly with `superpowers:subagent-driven-development` — no per-execution-mode prompt is presented.

**Spec:** [`docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`](../specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md)
**Slug:** `pre-prod-boundary-and-brief-api`
**Branch:** `pre-prod-boundary-and-brief-api` (created from `origin/main` HEAD `93e855e7`)
**Class:** Major (review pipeline: `spec-conformance` → `pr-reviewer` → optional `dual-reviewer`)
**Migration reserved:** `0253` (rate-limit table)

**Goal:** Harden the HTTP boundary surface and brief-creation API for pre-production lockdown — Multer cap + disk storage, a single Postgres-backed rate-limit primitive replacing every in-process limiter, webhook-secret boot assertion, unified `BriefCreationEnvelope`, scope-resolution min-length guard, rate-limited `/api/session/message` with integration tests, and reseed-script safety.

**Architecture:** Spec defines seven phases with file-level inventory. The plan executes them in the order **1 → 2 → 4 → 6 → 3 → 5 → 7** (mandatory). This swaps Phase 4 ahead of Phase 6 relative to the spec's §11 recommendation because Phase 6's integration tests (T6, T8) assert against `BriefCreationEnvelope` fields that Phase 4 introduces — landing 6 first would either force loose assertions (weakening F8 coverage) or cause false test failures during build. Phase 6 still depends on the Phase 2 primitive, and the two largest review surfaces (boundary upload + rate-limit) still ship first while context is fresh. Each phase produces a single committable unit; each task within a phase is a 2–5 minute step with explicit file paths, code, verification commands, and expected output. The spec-drift catch-up entry is filed at §13.6 item 2.

**Tech stack:** TypeScript (strict), Express, Drizzle ORM, raw `pg` `Pool` (reseed scripts), PostgreSQL, Multer, pg-boss (background workers), React 18 (client surfaces). Tests are pure-function `npx tsx` scripts using `node:assert`; the F8 sessionMessage suite is the single integration-test deviation per `docs/spec-context.md`.

**Testing posture:** `static_gates_primary; runtime_tests: pure_function_only`. Pure-unit tests apply to `computeEffectiveCount` (Phase 2) and `shouldSearchEntityHint` (Phase 5). Integration tests apply to `sessionMessage.test.ts` (Phase 6, F8 deviation). All other phases verify via static inspection + `npx tsc --noEmit`. Per project CLAUDE.md the full gate suite (`npm run test:gates`, `bash scripts/run-all-unit-tests.sh`, `npm run test:qa`) is **CI-only — never run locally**; mid-build verification is `npx tsc --noEmit` plus targeted `npx tsx <test-file>` for the new tests this plan authors.

**No-shim invariant (§10.5):** the new rate-limit primitive replaces three structurally-broken in-process implementations. No env-flag rollback shim is shipped; recovery is "raise per-call-site `limit` constants" or "revert the commit". The only env-driven knobs introduced anywhere in this plan are the existing `WEBHOOK_SECRET` and `NODE_ENV`.

---

## Table of contents

> **Execution order is 1 → 2 → 4 → 6 → 3 → 5 → 7.** Sections below appear in execution order, NOT in spec order.

1. Overview, file structure, conventions
2. Phase 1 — Multer cap + disk storage
3. Phase 2A — Rate-limit migration + Drizzle schema
4. Phase 2B — Pure helper + `rateLimiter.check()` + `rateLimitKeys` helper + isolation test
5. Phase 2C — Rate-limit cleanup job
6. Phase 2D — Call-site migration (auth + public routes)
7. Phase 2E — Test-run call-site migration + file deletions
8. Phase 4 — Brief-creation envelope harmonisation
9. Phase 6 — `/api/session/message` rate-limit + integration tests
10. Phase 3 — Webhook secret boot assertion + open-mode warning
11. Phase 5 — Scope-resolution perf guard
12. Phase 7 — Dev-script safety
13. Final acceptance checklist + housekeeping

---

## 1. Overview, file structure, conventions

### 1.1 Files created or modified (single source of truth — mirrors spec § 5)

**New files:**
- `server/lib/rateLimiter.ts` — sliding-window primitive (Phase 2B)
- `server/lib/rateLimitKeys.ts` — centralised key-builder (Phase 2B; consumed by every call site in 2D / 2E / 6)
- `server/lib/rateLimitCleanupJob.ts` — TTL cleanup job (Phase 2C)
- `migrations/0253_rate_limit_buckets.sql` — table + indexes (Phase 2A)
- `migrations/0253_rate_limit_buckets.down.sql` — `DROP TABLE` (Phase 2A)
- `server/db/schema/rateLimitBuckets.ts` — Drizzle schema (Phase 2A)
- `server/services/__tests__/rateLimiterPure.test.ts` — pure-unit test for `computeEffectiveCount` (Phase 2B)
- `server/services/__tests__/rateLimitKeysPure.test.ts` — pure-unit test for cross-namespace + cross-user key isolation (Phase 2B)
- `server/services/__tests__/scopeResolutionPure.test.ts` — pure-unit test for `shouldSearchEntityHint` (Phase 5)
- `server/routes/__tests__/sessionMessage.test.ts` — integration test for Paths A/B/C + cross-tenant + stale-subaccount (Phase 6)

**Deleted files:**
- `server/lib/testRunRateLimit.ts` (Phase 2E)
- `server/services/__tests__/testRunRateLimitPure.test.ts` (Phase 2E)

**Modified files:**
- `server/middleware/validate.ts` (Phase 1)
- `server/db/schema/index.ts` (Phase 2A — exports `rateLimitBuckets`)
- `scripts/rls-not-applicable-allowlist.txt` (Phase 2A)
- `server/routes/auth.ts` (Phase 2D — login/signup/forgot/reset migrate)
- `server/routes/public/formSubmission.ts` (Phase 2D)
- `server/routes/public/pageTracking.ts` (Phase 2D)
- `server/routes/agents.ts`, `server/routes/skills.ts`, `server/routes/subaccountAgents.ts`, `server/routes/subaccountSkills.ts` (Phase 2E — testRun call sites)
- `server/index.ts` (Phase 2C — register cleanup job; Phase 3 — boot assertion)
- `server/services/webhookService.ts` (Phase 3 — open-mode warn-once)
- `shared/types/briefFastPath.ts` (Phase 4 — `BriefCreationEnvelope`)
- `server/routes/briefs.ts` (Phase 4)
- `server/routes/sessionMessage.ts` (Phase 4 + Phase 6)
- `client/src/components/Layout.tsx` (Phase 4)
- `client/src/components/global-ask-bar/GlobalAskBar.tsx` (Phase 4)
- `client/src/components/global-ask-bar/GlobalAskBarPure.ts` (Phase 4)
- `server/services/scopeResolutionService.ts` (Phase 5)
- `scripts/_reseed_drop_create.ts` (Phase 7)
- `scripts/_reseed_restore_users.ts` (Phase 7)
- `tasks/current-focus.md` (housekeeping — final commit)

### 1.2 Naming conventions used in this plan

- **Pure helpers:** end in `Pure` (file name) or are exported alongside the impure function in the same file (per `shouldSearchEntityHint` in `scopeResolutionService.ts`).
- **Test files for pure helpers:** `*Pure.test.ts`, runnable via `npx tsx <path>`.
- **Test files for integration:** `*.integration.test.ts` OR (in this spec's case) `<route>.test.ts` per the existing `briefsArtefactsPagination.integration.test.ts` precedent. Phase 6 uses `sessionMessage.test.ts` to match the spec's literal filename in §5; the file probes `process.env.DATABASE_URL` at the top and exits cleanly when absent (matching `conversationsRouteFollowUp.integration.test.ts`).
- **Rate-limit keys:** shape `rl:{KEY_VERSION}:{namespace}:{kind}:{value}` where `KEY_VERSION` starts at `v1`. Centralised in `server/lib/rateLimitKeys.ts` (Phase 2B Task 2B.3) — every call site in Phases 2D / 2E / 6 imports a typed builder (e.g. `rateLimitKeys.authLogin(ip, email)`) rather than constructing the string inline. This prevents silent fragmentation of buckets from inconsistent casing / delimiters / dimension order. Bumping `KEY_VERSION` to `v2` is the documented mechanism for invalidating buckets (incident response, structural change, A/B); old `v1` rows age out via the TTL cleanup job. Adding a new rate-limited route requires adding a new builder; raw key strings at call sites are a code-review red flag.

### 1.3 Verification commands referenced throughout

| Command | When |
|---|---|
| `npx tsc --noEmit` | After every TypeScript change. Zero errors before commit. |
| `npm run db:generate` | After authoring SQL migration files (Phase 2A). Verify Drizzle's generated migration file matches the hand-written SQL. |
| `npm run build:client` | After client-side edits (Phase 4). |
| `npx tsx <path-to-test>` | Targeted execution of the new pure-unit / integration test authored in THIS chunk. |
| `git grep -n '<pattern>' server/` | Used as a static-gate proxy to prove deletions landed. Patterns enumerated per task. |

The full repo gate scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `bash scripts/run-all-unit-tests.sh`, individual `scripts/verify-*.sh` files) are **CI-only** and MUST NOT be invoked during this build. CI runs them at PR time.

> **On grep gates.** Throughout this plan, `git grep` is used as a static-gate proxy ("zero matches expected"). These gates are **heuristic guards, not formal guarantees** — they catch the obvious regressions (someone re-introducing `express-rate-limit`, an inline `res.set('Retry-After', …)` slipping back in, an inline rate-limit key string at a new call site) but they can be evaded by a contributor who formats the offending code differently or wraps it in a helper. Treat a clean grep as "no obvious regression detected", not "the invariant is provably held". Code review is the formal layer; greps are the cheap-to-run cross-check.

### 1.4 Commit cadence

One commit per task labeled with the spec's phase number, e.g. `feat(phase-2b): add rateLimiter.check sliding-window primitive`. Conventional-commit prefix (`feat`, `fix`, `refactor`, `test`, `chore`, `docs`) per repo convention. After all phases land, the final integration commit updates `tasks/current-focus.md`.

### 1.5 Scope check (per writing-plans skill)

The spec covers seven phases scoped to a single subsystem (HTTP boundary + brief API). Sister-branch concerns (tenancy/RLS, workflow engine, delegation telemetry) are explicitly out of scope per spec §1 and §3. The plan ships as a single integration-branch unit, not multiple sub-project plans. No further breakdown needed.

---

## 2. Phase 1 — Multer cap + disk storage

**Spec reference:** § 6.1, § 10.6.
**Goal:** Drop Multer cap to 50 MB, switch to `multer.diskStorage` for all uploads, add request-scoped tempfile cleanup at the middleware level.

### Task 1.1: Switch Multer to disk storage with 50 MB cap and per-request cleanup hook

**Files:**
- Modify: `server/middleware/validate.ts:1-73` (replace the `upload` constant block at lines 17–20; add cleanup hook export)

- [ ] **Step 1: Read current file to confirm starting state**

```bash
git grep -n 'memoryStorage\|fileSize.*1024.*1024' server/middleware/validate.ts
```
Expected: matches at line 18 (`memoryStorage()`) and line 19 (`500 * 1024 * 1024`).

- [ ] **Step 2: Edit `validate.ts` — replace the imports and the `upload` constant**

Replace the existing `import multer from 'multer';` line and the `upload` block (lines 17–20) with:

```ts
import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { ZodTypeAny } from 'zod';
import { logger } from '../lib/logger.js';

// (parsePositiveInt unchanged)

const upload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB hard cap (spec §6.1)
});
```

Notes:
- `multer.diskStorage()` writes uploaded files to `os.tmpdir()` with auto-generated filenames; `req.file.path` and `req.files[*].path` carry the absolute paths.
- Disk-stored files are NOT auto-cleaned — that is the cleanup hook below.
- Keep `parsePositiveInt`, `validateBody`, `validateQuery`, and the surrounding code unchanged.

- [ ] **Step 3: Replace the `validateMultipart` export with a wrapped variant that registers the cleanup hook**

Replace the existing line 73 (`export const validateMultipart = upload.any();`) with:

```ts
const multerAny = upload.any();

/**
 * Multipart parser middleware. Wraps `multer.any()` to register a request-scoped
 * cleanup hook: every file Multer wrote to disk is unlinked on `res.on('close')`,
 * which fires on both successful response and client-abort. ENOENT is treated as
 * success (consuming route may have already deleted the file). Other unlink errors
 * (EACCES, ENOSPC, EBUSY) emit `multer.cleanup_failed` at warn level so a recurring
 * leak surfaces in log aggregation rather than disappearing into debug noise.
 *
 * Crash-recovery (§10.6): `res.on('close')` does NOT fire on process crash. OS-level
 * tmpdir reaping (Linux `systemd-tmpfiles`, default 10 days for /tmp) is the only
 * safety net. No periodic in-process tmp-sweep job is shipped here.
 *
 * **Operational consequence:** a process crash mid-upload (OOM kill, panic, host
 * reboot) leaks the in-flight tempfiles until the OS reaper sweeps `/tmp` —
 * up to 10 days on a default Linux deploy. On a healthy deploy the volume is
 * negligible (50 MB cap × low concurrent-upload count); on a misconfigured host
 * with `/tmp` mounted as a small partition this could fill the disk. Operators
 * monitoring tmp-volume usage is a deploy-time concern, not an in-process one.
 *
 * **Intentional tradeoff — NO SIGTERM / SIGINT handler.** A graceful-shutdown hook
 * that walked in-flight requests and unlinked their tempfiles before exit was
 * considered and rejected: it adds cross-cutting state (a registry of in-flight
 * uploads), can race with normal `res.on('close')` cleanup, and overlaps the OS
 * tmpdir reaper for negligible benefit on a daily/weekly horizon. If a future
 * change argues for one anyway, audit the failure mode of SIGTERM during a
 * concurrent upload before adding it — do NOT just bolt one on top of `res.on('close')`.
 */
export const validateMultipart = (req: Request, res: Response, next: NextFunction): void => {
  multerAny(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    res.on('close', () => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      for (const file of files) {
        fs.unlink(file.path, (unlinkErr) => {
          if (!unlinkErr || unlinkErr.code === 'ENOENT') return;
          logger.warn('multer.cleanup_failed', {
            path: file.path,
            code: unlinkErr.code,
            err: unlinkErr.message,
          });
        });
      }
    });
    next();
  });
};
```

Why a wrapper not `upload.any()` directly: a request-scoped `res.on('close')` listener must register **after** Multer has populated `req.files`, which is why the listener registration sits in Multer's callback rather than at module top.

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. The new `os`, `fs` imports are Node built-ins (already in `@types/node`); the `Express.Multer.File[]` type is already provided by `@types/multer` which is in use.

- [ ] **Step 5: Static-grep verification of the four invariants**

```bash
git grep -n "memoryStorage" server/middleware/validate.ts
git grep -n "500 \* 1024 \* 1024" server/middleware/validate.ts
git grep -n "diskStorage" server/middleware/validate.ts
git grep -n "50 \* 1024 \* 1024" server/middleware/validate.ts
git grep -n "multer.cleanup_failed" server/middleware/validate.ts
```
Expected:
- Line 1 (memoryStorage): zero matches
- Line 2 (500 MB): zero matches
- Line 3 (diskStorage): one match
- Line 4 (50 MB): one match
- Line 5 (cleanup_failed): one match

- [ ] **Step 6: Commit**

```bash
git add server/middleware/validate.ts
git commit -m "feat(phase-1): switch Multer to disk storage with 50 MB cap and tempfile cleanup

- Replace multer.memoryStorage() with multer.diskStorage(os.tmpdir()) for all uploads.
- Drop fileSize limit from 500 MB to 50 MB hard cap.
- Wrap upload.any() to register request-scoped fs.unlink on res.on('close').
- ENOENT treated as success; EACCES/ENOSPC/EBUSY logged at warn so leaks surface.
- Crash-recovery is OS tmpdir reaping (out of process); not added in this PR.

Spec: docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md §6.1, §10.6.
Acceptance: AC1."
```

## 3. Phase 2A — Rate-limit migration + Drizzle schema

**Spec reference:** § 6.2.1, § 6.2.2, § 7.2, § 8.
**Goal:** Create `rate_limit_buckets` (table, index, primary key), the matching Drizzle schema, the schema export, and the RLS-not-applicable allow-list entry. No application code consumes the schema yet.

### Task 2A.1: Author migration `0253_rate_limit_buckets.sql` + matching down migration

**Files:**
- Create: `migrations/0253_rate_limit_buckets.sql`
- Create: `migrations/0253_rate_limit_buckets.down.sql`

- [ ] **Step 1: Write the up migration**

Create `migrations/0253_rate_limit_buckets.sql` with exactly this content:

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

- [ ] **Step 2: Write the down migration**

Create `migrations/0253_rate_limit_buckets.down.sql` with exactly this content:

```sql
DROP TABLE IF EXISTS rate_limit_buckets;
```

- [ ] **Step 3: Verify the migration files are well-formed**

```bash
git status
git diff --cached migrations/0253_rate_limit_buckets.sql migrations/0253_rate_limit_buckets.down.sql
```
Expected: both files present in `git status` as untracked. The diff after `git add` shows the SQL above verbatim.

- [ ] **Step 4: Commit**

```bash
git add migrations/0253_rate_limit_buckets.sql migrations/0253_rate_limit_buckets.down.sql
git commit -m "feat(phase-2a): add migration 0253 — rate_limit_buckets table

- New table rate_limit_buckets(key TEXT, window_start TIMESTAMPTZ, count INTEGER) PK (key, window_start).
- Secondary index on window_start for the TTL cleanup job's range delete.
- No organisation_id; system-wide infrastructure (allow-list entry follows in next commit).

Spec: §6.2.1, §7.2, §8."
```

### Task 2A.2: Author Drizzle schema `server/db/schema/rateLimitBuckets.ts` and export it

**Files:**
- Create: `server/db/schema/rateLimitBuckets.ts`
- Modify: `server/db/schema/index.ts` (one-line `export * from './rateLimitBuckets';` addition)

- [ ] **Step 1: Write the Drizzle schema**

Create `server/db/schema/rateLimitBuckets.ts` with exactly this content:

```ts
import { pgTable, text, timestamp, integer, primaryKey, index } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Rate Limit Buckets — sliding-window rate-limit infrastructure (spec §6.2.1).
// Keyed on caller-defined `key` + window_start; count incremented via UPSERT.
// System-wide (no organisationId). Cleanup TTL = 2 * max(windowSec) = 2 hours
// today (longest call-site window is 3600s; see spec §6.2.4 retention rationale).
// Registered in scripts/rls-not-applicable-allowlist.txt — RLS not applicable.
// ---------------------------------------------------------------------------

export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.key, table.windowStart] }),
    windowStartIdx: index('rate_limit_buckets_window_start_idx').on(table.windowStart),
  }),
);

export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type NewRateLimitBucket = typeof rateLimitBuckets.$inferInsert;
```

- [ ] **Step 2: Add the export to `server/db/schema/index.ts`**

Insert one line near the other infrastructure-style schema exports (alphabetical placement is fine; reseed scripts and tests do `import { ... } from '../db/schema/index.js'`).

Edit:
```ts
// Add anywhere in the exports list — convention places infrastructure tables late.
export * from './rateLimitBuckets';
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. The Drizzle exports compile cleanly.

- [ ] **Step 4: Run Drizzle migration generator and verify NO new migration is produced**

```bash
npm run db:generate
git status migrations/
```
Expected: no new files in `migrations/` and no modifications. The hand-authored `0253_rate_limit_buckets.sql` is the canonical migration; if `db:generate` would have produced a divergent file, we want to know now.

If `db:generate` does emit a new file (because Drizzle's diff doesn't recognise the hand-authored migration), inspect it: it should be byte-identical to the hand-written SQL after column-order normalisation. If it differs (e.g. column nullability, default), reconcile by editing the Drizzle schema to match the SQL — the SQL is canonical because the table will be created from it. Delete the auto-generated file before commit.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/rateLimitBuckets.ts server/db/schema/index.ts
git commit -m "feat(phase-2a): add Drizzle schema for rate_limit_buckets

- New schema mirrors migration 0253: TEXT key + TIMESTAMPTZ window_start composite PK, INTEGER count default 0, secondary index on window_start.
- No relations; no organisation binding; type-only consumers in Phase 2B/2C.
- Export wired into server/db/schema/index.ts.

Spec: §6.2.2, §7.2."
```

### Task 2A.3: Add RLS-not-applicable allow-list entry

**Files:**
- Modify: `scripts/rls-not-applicable-allowlist.txt`

- [ ] **Step 1: Append the allow-list entry**

The file is currently empty of entries (only comments). Append exactly one entry on a new line at the end of the file:

```
rate_limit_buckets  System-wide rate-limit infrastructure; keys are opaque caller-defined strings, rows are not tenant-private. [ref: docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md#8]
```

- [ ] **Step 2: Verify the allow-list entry parses against the format rules**

```bash
git grep -n "^rate_limit_buckets" scripts/rls-not-applicable-allowlist.txt
```
Expected: one match. The entry MUST have `[ref: ...]` per the format rules at lines 22–27 of the file.

- [ ] **Step 3: Run typecheck (no-op for this file, but the verification gates don't run locally; capture sanity)**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/rls-not-applicable-allowlist.txt
git commit -m "chore(phase-2a): register rate_limit_buckets in rls-not-applicable allow-list

System-wide rate-limit infrastructure; keys are opaque, rows are not tenant-private.
Cites spec §8 per the allow-list format rules.

Spec: §8."
```

## 4. Phase 2B — Pure helper + `rateLimiter.check()`

**Spec reference:** § 6.2.3, § 7.1, § 10.1.
**Goal:** Author the pure sliding-window helper with its unit test, then implement the `check()` primitive that wraps the single-CTE round-trip.

> **SPEC GAP NOTED — file rename.** Spec §5 + §6.2.3 use the file path `server/lib/rateLimiter.ts` for the new primitive, but a file at that path **already exists on `main`** as the outbound-provider token-bucket limiter (GHL / Teamwork / Slack — different concern, not surveyed in spec §4). To avoid conflating the two limiters and to keep this spec's surface minimal, this plan ships the new primitive at **`server/lib/inboundRateLimiter.ts`** and exports `check`, `getRetryAfterSeconds`, `computeEffectiveCount` from there. Every spec reference to `server/lib/rateLimiter.ts` for the inbound primitive should be read as `server/lib/inboundRateLimiter.ts`. The existing outbound `server/lib/rateLimiter.ts` is not touched. Recording this here so the next reviewer doesn't re-litigate the rename and so `tasks/todo.md` can pick up a follow-up to either (a) accept the rename in the spec or (b) move the outbound limiter to `outboundRateLimiter.ts` later — out of scope for this PR.

### Task 2B.1: Author the pure helper `computeEffectiveCount` and its unit test (TDD)

**Files:**
- Create: `server/lib/inboundRateLimiterPure.ts` (the pure helper, exported separately so the test does not import a module that touches `db`)
- Create: `server/services/__tests__/rateLimiterPure.test.ts` (test file name matches spec §5)

- [ ] **Step 1: Write the failing test FIRST**

Create `server/services/__tests__/rateLimiterPure.test.ts` with exactly this content:

```ts
/**
 * rateLimiterPure.test.ts — Pure-unit tests for the sliding-window math helper
 * `computeEffectiveCount(prevCount, currentCount, elapsedFractionOfCurrentWindow)`.
 *
 * Spec §6.2.3, §12 test matrix.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/rateLimiterPure.test.ts
 */
import { strict as assert } from 'node:assert';
import { computeEffectiveCount } from '../../lib/inboundRateLimiterPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

// Boundary moment: elapsedFraction = 0 → previous window contributes fully.
test('boundary: elapsed=0 — full prev contribution', () => {
  // 100 prev * (1 - 0) + 5 curr = 105
  assert.equal(computeEffectiveCount(100, 5, 0), 105);
});

// Mid-window: elapsedFraction = 0.5 → half of prev + all of curr.
test('mid-window: elapsed=0.5 — half prev contribution', () => {
  // 100 * 0.5 + 5 = 55
  assert.equal(computeEffectiveCount(100, 5, 0.5), 55);
});

// Full window (just before rollover): elapsedFraction = 1 → no prev contribution.
test('full window: elapsed=1 — zero prev contribution', () => {
  // 100 * 0 + 5 = 5
  assert.equal(computeEffectiveCount(100, 5, 1), 5);
});

// Clamp lower bound: spec mandates clamp on slightly-out-of-range inputs.
test('clamp lower: elapsed=-1e-9 treated as 0', () => {
  assert.equal(computeEffectiveCount(100, 5, -1e-9), 105);
});

// Clamp upper bound: elapsed > 1 treated as 1.
test('clamp upper: elapsed=1+1e-9 treated as 1', () => {
  assert.equal(computeEffectiveCount(100, 5, 1 + 1e-9), 5);
});

// Empty prev window: prev=0 means weighted contribution is 0; effective = curr only.
test('empty prev: prev=0 — effective equals curr', () => {
  assert.equal(computeEffectiveCount(0, 7, 0.3), 7);
});

// Empty curr window (request just opened): effective = prev * (1 - elapsed).
test('empty curr at rollover: curr=0 — effective is weighted prev', () => {
  // 60 * (1 - 0.25) = 45
  assert.equal(computeEffectiveCount(60, 0, 0.25), 45);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx tsx server/services/__tests__/rateLimiterPure.test.ts
```
Expected: failure — `Cannot find module '../../lib/inboundRateLimiterPure.js'`. The test file references a not-yet-created module.

- [ ] **Step 3: Write the minimal pure helper to make the test pass**

Create `server/lib/inboundRateLimiterPure.ts` with exactly this content:

```ts
/**
 * inboundRateLimiterPure.ts — pure sliding-window math.
 *
 * Lives in its own module (separate from inboundRateLimiter.ts) so unit tests
 * can import it without dragging in `db` or any IO. Spec §6.2.3 invariant: the
 * weighting clamp is mandatory — leap-second drift and float rounding can
 * produce inputs fractionally outside [0, 1).
 */

/**
 * Effective count under sliding-window approximation.
 *
 * @param prevCount             Count in the previous fixed window (UNCLAMPED).
 * @param currentCount          Count in the current fixed window (UNCLAMPED).
 * @param elapsedFractionOfCurrentWindow
 *                              How far through the current window we are; clamped
 *                              into `[0, 1]` internally per the spec invariant.
 * @returns                     Weighted count for limit comparison.
 */
export function computeEffectiveCount(
  prevCount: number,
  currentCount: number,
  elapsedFractionOfCurrentWindow: number,
): number {
  const elapsed = Math.min(1, Math.max(0, elapsedFractionOfCurrentWindow));
  return prevCount * (1 - elapsed) + currentCount;
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

```bash
npx tsx server/services/__tests__/rateLimiterPure.test.ts
```
Expected: `7 passed, 0 failed` then exit code 0.

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add server/lib/inboundRateLimiterPure.ts server/services/__tests__/rateLimiterPure.test.ts
git commit -m "test(phase-2b): add computeEffectiveCount pure helper + unit tests

- New pure helper in inboundRateLimiterPure.ts implements the sliding-window
  formula with the mandatory [0,1] clamp on elapsedFractionOfCurrentWindow.
- Unit tests cover boundary, mid-window, full-window, both clamp edges, and
  empty prev/curr cases.
- Runnable: npx tsx server/services/__tests__/rateLimiterPure.test.ts.

Spec gap: spec §5 says rateLimiter.ts but that path is taken by the existing
outbound provider limiter; this PR uses inboundRateLimiter.ts instead. See
plan §4 for the rename rationale.

Spec: §6.2.3, §12."
```

### Task 2B.2: Implement the `check()` primitive with the single-CTE round-trip

**Files:**
- Create: `server/lib/inboundRateLimiter.ts`

- [ ] **Step 1: Write the primitive**

Create `server/lib/inboundRateLimiter.ts` with exactly this content:

```ts
/**
 * inboundRateLimiter.ts — Postgres-backed sliding-window rate-limit primitive.
 *
 * Single CTE round-trip per check: derives window boundaries from DB time,
 * UPSERTs the current bucket, reads the prior bucket, and returns counts.
 * The DB is the canonical clock so multi-instance topologies cannot fragment
 * buckets via clock skew (spec §6.2.3 invariant).
 *
 * **Time-source invariant.** Every timestamp used in a rate-limit calculation —
 * window bounds, current-window epoch, prev-window epoch, the `now_epoch` used
 * to compute elapsed fraction — comes from a SINGLE call to `now()` inside the
 * CTE. PostgreSQL's `now()` is `transaction_timestamp()` so all derivations
 * within one statement see the same instant; this is what makes the math
 * internally consistent under concurrent load. **Do NOT mix `Date.now()`,
 * `clock_timestamp()`, request-arrival time, or any other clock into the
 * calculation.** The only `Date.now()` use in this module is in
 * `getRetryAfterSeconds` (header derivation, OUTSIDE the rate-limit math) —
 * if you find yourself adding another, redesign instead. The `rateLimitCleanupJob`
 * (sibling module) follows the same invariant — its cutoff also reads `now()`
 * server-side, so the limiter and its janitor share a clock.
 *
 * **Design stance.** This module is intentionally conservative and
 * correctness-first. Any performance optimisation (batching, in-memory caching,
 * SKIP the DB on high-confidence allowed paths, …) must preserve ALL documented
 * invariants: single time source, fail-closed posture, no silent permit on
 * operational failure, no retry-storm compensation logic. Test guarantees must
 * continue to hold. If an optimisation breaks any of these, the optimisation
 * is wrong, not the invariant.
 *
 * Pure math is in inboundRateLimiterPure.ts (separately testable without IO).
 *
 * **Response-header contract (intentional minimalism).** On a 429 we emit:
 *   - `Retry-After` (RFC 7231 §7.1.3) — whole seconds until the current FIXED
 *     window rolls over; clamped to ≥ 1. Centralised rounding rule in
 *     `getRetryAfterSeconds`.
 *   - `X-RateLimit-Policy: sliding-window;no-auto-retry` — project-defined,
 *     tells SDKs / proxies that automatic retry is unsafe (denied calls still
 *     increment).
 * On a 200 we emit NOTHING — no `X-RateLimit-Limit`, `-Remaining`, or `-Reset`
 * triple, no draft-ietf-httpapi-ratelimit-headers compliance. This is deliberate:
 *   - `remaining` is an instantaneous sliding-window estimate that can RECOVER
 *     between calls (prior-window weight decreasing) — exposing it as a header
 *     would let well-meaning clients build a decrementing counter that
 *     desynchronises from the server.
 *   - `limit` is a per-call-site constant; clients don't need it.
 *   - `reset` would mislead in the same way `Retry-After` could (the FIXED-window
 *     rollover is not a guaranteed-acceptance moment; sliding weighting can
 *     extend denial past it).
 *   - The IETF draft is still unstable — adopting it now risks needing to
 *     rename headers later and would break any client that locked in early.
 * If a future use case genuinely needs to surface remaining-budget UX (e.g. a
 * "you have 3 attempts left" indicator on a login page), surface it in the
 * RESPONSE BODY of that specific route — not as a global header — so it stays
 * scoped to where the UX consumes it.
 *
 * Spec §6.2.3, §7.1, §10.1.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from './logger.js';
import { computeEffectiveCount } from './inboundRateLimiterPure.js';

export interface RateLimitCheckResult {
  /** True if this call is permitted; false means the caller MUST reject. */
  allowed: boolean;
  /**
   * Remaining calls in the current effective window after this one is counted.
   * Clamped at 0. Instantaneous estimate, not a monotonic sequence — sliding-window
   * weighting can let `remaining` recover between calls. UX hint only; never a
   * client-side decrementing counter.
   */
  remaining: number;
  /**
   * End of the current FIXED window. Approximation, not a guaranteed-acceptance
   * moment — under sliding-window math, residual prior-window weight may keep
   * denying past this instant. Clients SHOULD use this as the seed for jittered
   * exponential backoff, not retry exactly at it.
   */
  resetAt: Date;
}

/**
 * Derives the `Retry-After` header value (whole seconds) from a `resetAt` instant.
 * Centralised so every 429 emission shares the same rounding rule.
 *
 * - `Math.ceil` rounds partial seconds up so the caller never re-fires inside the same window.
 * - `Math.max(1, …)` guarantees the header is never 0 or negative (per RFC 7231).
 */
export function getRetryAfterSeconds(resetAt: Date): number {
  return Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
}

/**
 * Policy header tag emitted on every 429 response. Signals to clients (and any
 * intermediate proxy / SDK) that automatic retry is **not safe** for this
 * primitive: every call — including denied calls — increments the bucket, so
 * a naïve client-side retry-on-429 loop deepens the denial rather than recovering.
 *
 * The expected client behaviour is:
 *   - surface the 429 to the user (or the caller's error path)
 *   - if a retry is genuinely needed, use `Retry-After` as the SEED for jittered
 *     exponential backoff — never as a "retry-exactly-at" instant
 *   - never auto-retry inside SDK / fetch wrapper layers
 *
 * **Server-side posture (intentional).** This server does NOT attempt to
 * mitigate retry storms — there is no "if I see N consecutive denials, switch
 * to a 'don't increment on denial' mode" branch. That logic would couple the
 * primitive to per-key state and breaks the single-CTE-round-trip invariant.
 * The contract is: the header signals the policy, well-behaved clients comply,
 * misbehaving clients pay the deepening-denial cost themselves. If a future
 * incident shows a real client (e.g. our own SDK) is auto-retrying, fix the
 * client — do NOT add server-side compensating logic here.
 *
 * See spec §10.1 *Unsafe retry classification* and the "double increment" risk note.
 */
export const RATE_LIMIT_POLICY_HEADER_VALUE = 'sliding-window;no-auto-retry';

/**
 * Sets the canonical 429 response headers in one place: `Retry-After` (RFC 7231)
 * and `X-RateLimit-Policy` (project convention; tells clients NOT to auto-retry).
 * Centralising avoids drift between routes — every denial path consumes this helper.
 */
export function setRateLimitDeniedHeaders(res: import('express').Response, resetAt: Date): void {
  res.set('Retry-After', String(getRetryAfterSeconds(resetAt)));
  res.set('X-RateLimit-Policy', RATE_LIMIT_POLICY_HEADER_VALUE);
}

interface CheckRow {
  current_count: number;
  curr_window_start: Date;
  prev_count: number;
  now_epoch: number;
  curr_epoch: number;
}

/**
 * Sliding-window rate-limit check. Atomic UPSERT — every call increments the
 * bucket regardless of allowed. Caller MUST treat allowed=false as "reject" and
 * MUST NOT retry on operational failure (denied calls still increment, so a
 * naïve retry deepens the denial; see §10.1 unsafe retry classification).
 *
 * **Precision expectation (sliding-window approximation).** The limiter
 * guarantees APPROXIMATE fairness over the configured window, not per-request
 * exactness. Under concurrent load the effective count interpolates between
 * the previous and current fixed windows using a linear weighting; a burst at
 * the boundary instant can over- or under-count by up to one window's worth of
 * weighted contribution, depending on where in the window the requests land.
 * In practice this means: a configured 10-per-minute limit will reliably block
 * sustained traffic above 10/min, but a single test that fires exactly 11
 * requests in <1 second may or may not see an 11th 200 — that is the design,
 * not a bug. If exact per-request precision is ever required (it isn't for
 * any current call site), use a fixed-window or token-bucket primitive instead;
 * do NOT try to "tighten" this one by adding mutex / advisory-lock layers.
 *
 * **Failure mode (fail closed):** rejected promise propagates to the route's
 * existing error path → HTTP 500. Pre-production framing prefers correctness
 * over availability; rate-limit unavailability never silently permits writes.
 *
 * **Denial observability:** emits `rate_limit.denied` exactly once per denial.
 * Routes do not need to log denial themselves.
 *
 * @param key       Caller-defined opaque string. Convention: `{namespace}:{kind}:{value}`.
 *                  Bounded-shape inputs only (see spec §7.2 "Key cardinality").
 * @param limit     Maximum allowed calls per window.
 * @param windowSec Window size in seconds.
 * @returns         Decision + remaining-budget metadata.
 * @throws          Operational DB errors (connection drop, query failure, pool timeout) only.
 */
export async function check(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitCheckResult> {
  const result = await db.execute<CheckRow>(sql`
    WITH bounds AS (
      SELECT
        to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec})            AS curr_start,
        to_timestamp((floor(extract(epoch from now()) / ${windowSec}) - 1) * ${windowSec})      AS prev_start,
        extract(epoch from now())                                                                AS now_epoch,
        floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}                           AS curr_epoch
    ),
    upserted AS (
      INSERT INTO rate_limit_buckets (key, window_start, count)
      SELECT ${key}, curr_start, 1 FROM bounds
      ON CONFLICT (key, window_start) DO UPDATE
        SET count = rate_limit_buckets.count + 1
      RETURNING count AS current_count, window_start AS curr_window_start
    ),
    prev AS (
      SELECT count AS prev_count
      FROM rate_limit_buckets, bounds
      WHERE key = ${key} AND window_start = bounds.prev_start
    )
    SELECT
      upserted.current_count,
      upserted.curr_window_start,
      COALESCE(prev.prev_count, 0) AS prev_count,
      bounds.now_epoch,
      bounds.curr_epoch
    FROM upserted CROSS JOIN bounds LEFT JOIN prev ON true
  `);

  const row = result.rows[0];
  if (!row) {
    // Should never happen — the CTE always returns one row.
    throw new Error('inboundRateLimiter.check: CTE produced no row');
  }

  const elapsedFraction = (Number(row.now_epoch) - Number(row.curr_epoch)) / windowSec;
  const effectiveCount = computeEffectiveCount(
    Number(row.prev_count),
    Number(row.current_count),
    elapsedFraction,
  );
  const allowed = effectiveCount <= limit;
  // `Math.floor` (not `Math.round`) because `remaining` is the budget the caller
  // can spend WITHOUT crossing the limit. With sliding-window weighting,
  // `effectiveCount` is fractional — flooring guarantees we never advertise a
  // slot that does not exist (`effectiveCount = 9.4`, limit 10 → remaining 0,
  // not 1). `Math.max(0, …)` handles the post-denial case where
  // `effectiveCount > limit` and the subtraction is negative.
  const remaining = Math.max(0, Math.floor(limit - effectiveCount));
  const currWindowStartMs =
    row.curr_window_start instanceof Date
      ? row.curr_window_start.getTime()
      : new Date(row.curr_window_start as unknown as string).getTime();
  const resetAt = new Date(currWindowStartMs + windowSec * 1000);

  if (!allowed) {
    logger.info('rate_limit.denied', {
      key,
      limit,
      windowSec,
      currentCount: Number(row.current_count),
      effectiveCount,
      remaining,
      resetAt: resetAt.toISOString(),
    });
  }

  return { allowed, remaining, resetAt };
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. The `db.execute` generic call uses Drizzle's typed result; `rate_limit_buckets` is referenced via raw SQL string (not the schema export) because the `INSERT ... ON CONFLICT ... RETURNING` pattern is already idiomatic raw SQL in this repo.

- [ ] **Step 3: Re-run the pure-unit test (smoke that nothing it depends on broke)**

```bash
npx tsx server/services/__tests__/rateLimiterPure.test.ts
```
Expected: `7 passed, 0 failed`.

- [ ] **Step 4: Static verification of single CTE round-trip + DB-clock invariant**

```bash
git grep -n "extract(epoch from now())" server/lib/inboundRateLimiter.ts
git grep -n "Date.now()" server/lib/inboundRateLimiter.ts
git grep -n "clock_timestamp" server/lib/inboundRateLimiter.ts
```
Expected:
- Line 1 (DB-time epoch): three matches (curr_start, prev_start, now_epoch derivations)
- Line 2 (`Date.now()`): zero matches inside the CTE; one match in `getRetryAfterSeconds` (header derivation, NOT the CTE)
- Line 3 (`clock_timestamp`): zero matches — the spec invariant forbids it

- [ ] **Step 5: Commit**

```bash
git add server/lib/inboundRateLimiter.ts
git commit -m "feat(phase-2b): add inboundRateLimiter.check primitive

- Single-CTE round-trip: derives bounds from DB time, UPSERTs the current bucket,
  reads the prior bucket, returns counts. PostgreSQL now() is transaction_timestamp
  so all derivations within the statement are mutually consistent.
- Pure math (computeEffectiveCount with [0,1] clamp) lives in
  inboundRateLimiterPure.ts so the unit test does not need IO.
- Fail-closed posture: operational errors propagate as rejected promises and the
  route's existing error path emits HTTP 500.
- Denial emits one rate_limit.denied log per denied call; routes do not log denial.
- getRetryAfterSeconds centralises Retry-After rounding (Math.ceil + max(1, …)).
- setRateLimitDeniedHeaders is the canonical denial-header helper: emits Retry-After
  AND X-RateLimit-Policy: sliding-window;no-auto-retry so client SDKs do not
  auto-retry on 429 (denied calls still increment, naïve retry deepens the denial).

Spec: §6.2.3, §7.1, §10.1."
```

### Task 2B.3: Author `rateLimitKeys.ts` — centralised key builders

**Files:**
- Create: `server/lib/rateLimitKeys.ts`

Centralising the keys prevents long-term drift — inconsistent casing, varying dimensions across routes, future contributors inventing new patterns that silently fragment a bucket. Every call site in Phase 2D / 2E / 6 imports from this module instead of constructing strings inline.

- [ ] **Step 1: Write the module**

Create `server/lib/rateLimitKeys.ts` with exactly this content:

```ts
/**
 * rateLimitKeys.ts — typed builders for the keys consumed by inboundRateLimiter.check.
 *
 * Centralisation rationale (spec §7.2 *Key cardinality*): inline string assembly
 * at every call site fragments buckets when contributors vary casing, delimiters,
 * or dimension order. This module pins the canonical shape — adding a new
 * rate-limited route requires adding a builder here, which surfaces in code review.
 *
 * Convention: `{namespace}:{kind}:{value}[:{secondary}]`.
 *
 * NORMALISATION POLICY — read before adding a new builder:
 *   - **Emails ARE lowercased** (`.toLowerCase()`). Email addresses are
 *     case-insensitive per RFC 5321 §2.3.11 (the local-part is technically
 *     case-sensitive but no real-world MTA enforces this); without lowercasing
 *     `Alice@x.com` and `alice@x.com` would land in different buckets.
 *   - **IPs are NOT normalised**. The route already narrows the IP to a single
 *     token before calling the builder (X-Forwarded-For → first hop). IPv6
 *     addresses ARE case-insensitive in theory but Express normalises them
 *     upstream. If you build a new IP-keyed builder, do NOT lowercase here —
 *     you'd just paper over an upstream parsing inconsistency.
 *   - **UUIDs are NOT normalised**. Postgres emits UUIDs in lowercase by
 *     convention; the application never produces uppercase UUIDs. If a future
 *     external system passes an uppercase UUID through (e.g. webhook callback),
 *     normalise at the BOUNDARY of the system, not inside this builder.
 *   - **Page IDs / generic opaque IDs are NOT normalised**. They're treated
 *     as bytewise-comparable identifiers — silently lowercasing a case-sensitive
 *     identifier would create cross-bucket collisions, which is worse than
 *     under-counting on a casing variant.
 *
 * Default for new builders: pass through verbatim unless you have a documented
 * RFC / domain reason to canonicalise. Always include the rationale in a
 * builder-level comment so the next contributor doesn't have to re-derive it.
 *
 * **Version prefix.** Every key starts with `rl:${KEY_VERSION}:`. The version
 * tag exists so that a future structural change (renaming a namespace, changing
 * dimension order, switching key encoding) can be rolled out by bumping
 * `KEY_VERSION` to `v2` — the new keys land in fresh buckets, the old `v1`
 * buckets age out via the TTL cleanup job (2 hours), and no manual table cleanup
 * is required. Bumping the version is also the cleanest way to invalidate
 * everyone's bucket during an incident or tuning phase. Do NOT change a builder's
 * shape WITHOUT bumping the version — silently mixing old + new keys in the same
 * bucket fragments the count.
 */
const KEY_VERSION = 'v1';

export const rateLimitKeys = {
  // ---------------- auth (Phase 2D) ----------------
  authLogin: (ip: string, email: string): string =>
    `rl:${KEY_VERSION}:auth:login:${ip}:${email.toLowerCase()}`,
  authSignup: (ip: string): string =>
    `rl:${KEY_VERSION}:auth:signup:${ip}`,
  authForgot: (ip: string): string =>
    `rl:${KEY_VERSION}:auth:forgot:${ip}`,
  authReset: (ip: string): string =>
    `rl:${KEY_VERSION}:auth:reset:${ip}`,

  // ---------------- public (Phase 2D) ----------------
  publicFormIp: (ip: string): string =>
    `rl:${KEY_VERSION}:public:form:ip:${ip}`,
  publicFormPage: (pageId: string): string =>
    `rl:${KEY_VERSION}:public:form:page:${pageId}`,
  publicTrackIp: (ip: string): string =>
    `rl:${KEY_VERSION}:public:track:ip:${ip}`,

  // ---------------- test-run (Phase 2E) ----------------
  testRun: (userId: string): string =>
    `rl:${KEY_VERSION}:testrun:user:${userId}`,

  // ---------------- session message (Phase 6) ----------------
  sessionMessage: (userId: string): string =>
    `rl:${KEY_VERSION}:session:message:user:${userId}`,
};
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. The module has no external dependencies.

- [ ] **Step 3: Static-grep verification — every namespace appears exactly once**

```bash
git grep -n "rl:\${KEY_VERSION}:auth:login\|rl:\${KEY_VERSION}:auth:signup\|rl:\${KEY_VERSION}:auth:forgot\|rl:\${KEY_VERSION}:auth:reset\|rl:\${KEY_VERSION}:public:form\|rl:\${KEY_VERSION}:public:track\|rl:\${KEY_VERSION}:testrun:user\|rl:\${KEY_VERSION}:session:message:user" server/lib/rateLimitKeys.ts
```
Expected: each namespace appears in this file exactly once. Phase 2D / 2E / 6 will add a follow-up grep that asserts NO call site outside this file constructs a key string inline.

- [ ] **Step 4: Commit**

```bash
git add server/lib/rateLimitKeys.ts
git commit -m "feat(phase-2b): add centralised rateLimitKeys builders

Single source of truth for the keys passed to inboundRateLimiter.check.
Builders cover auth (login/signup/forgot/reset), public (formIp/formPage/trackIp),
test-run, and session message. Email is lowercased at build time; IPs and UUIDs
pass through verbatim (normalisation policy documented inline). Every key
prefixed with rl:v1: so a future structural change can be rolled out by bumping
KEY_VERSION — old buckets age out via the TTL cleanup job, no manual cleanup.
Adding a new rate-limited route requires adding a builder here; inline key
strings at call sites become a code-review red flag.

Spec: §7.2 (key cardinality)."
```

### Task 2B.4: Author `rateLimitKeysPure.test.ts` — cross-namespace + cross-user isolation

**Files:**
- Create: `server/services/__tests__/rateLimitKeysPure.test.ts`

The `rateLimitKeys` module's whole job is to prevent bucket fragmentation by ensuring distinct conceptual buckets get distinct keys. A pure-unit test pins this contract — same key for the same logical bucket, distinct key for any axis that should be distinct.

- [ ] **Step 1: Write the test**

Create `server/services/__tests__/rateLimitKeysPure.test.ts` with exactly this content:

```ts
/**
 * rateLimitKeysPure.test.ts — Pure-unit tests for the rateLimitKeys builders.
 *
 * Goal: pin the cross-namespace and cross-user isolation invariants — same
 * logical bucket → same key; distinct dimension (user, IP, page, route) → distinct
 * key. Catches future refactors that accidentally collapse two buckets into one.
 *
 * Spec §7.2 (key cardinality), plan §4 Task 2B.4.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/rateLimitKeysPure.test.ts
 */
import { strict as assert } from 'node:assert';
import { rateLimitKeys } from '../../lib/rateLimitKeys.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

// --- determinism: same inputs → same key (no random salt, no Date.now) ---
test('determinism: authLogin is stable across calls', () => {
  assert.equal(
    rateLimitKeys.authLogin('1.2.3.4', 'a@x.com'),
    rateLimitKeys.authLogin('1.2.3.4', 'a@x.com'),
  );
});

// --- normalisation: email lowercased, IP/userId passed through ---
test('email casing collapses (Alice@x.com === alice@x.com)', () => {
  assert.equal(
    rateLimitKeys.authLogin('1.2.3.4', 'Alice@x.com'),
    rateLimitKeys.authLogin('1.2.3.4', 'alice@x.com'),
  );
});

test('IP is bytewise — different IPs distinct', () => {
  assert.notEqual(
    rateLimitKeys.authLogin('1.2.3.4', 'a@x.com'),
    rateLimitKeys.authLogin('1.2.3.5', 'a@x.com'),
  );
});

// --- cross-user isolation ---
test('different users do NOT collide on same route (testRun)', () => {
  assert.notEqual(rateLimitKeys.testRun('user-a'), rateLimitKeys.testRun('user-b'));
});

test('different users do NOT collide on same route (sessionMessage)', () => {
  assert.notEqual(
    rateLimitKeys.sessionMessage('user-a'),
    rateLimitKeys.sessionMessage('user-b'),
  );
});

// --- cross-namespace isolation: same userId across different routes ---
test('same userId on testRun vs sessionMessage produces distinct keys', () => {
  // If these collided, a user hammering /api/session/message could exhaust
  // their /api/agents/run budget — different routes, different limits.
  assert.notEqual(
    rateLimitKeys.testRun('user-a'),
    rateLimitKeys.sessionMessage('user-a'),
  );
});

test('same IP on auth vs public routes produces distinct keys', () => {
  // If these collided, a botnet hitting /api/public/track would burn auth
  // login budget for any user behind the same NAT.
  assert.notEqual(
    rateLimitKeys.authLogin('1.2.3.4', 'a@x.com'),
    rateLimitKeys.authSignup('1.2.3.4'),
  );
  assert.notEqual(
    rateLimitKeys.authSignup('1.2.3.4'),
    rateLimitKeys.publicFormIp('1.2.3.4'),
  );
  assert.notEqual(
    rateLimitKeys.publicFormIp('1.2.3.4'),
    rateLimitKeys.publicTrackIp('1.2.3.4'),
  );
});

// --- shape: every key carries the rl:v1 version prefix ---
test('every builder emits the rl:v1 version prefix', () => {
  const samples = [
    rateLimitKeys.authLogin('1.2.3.4', 'a@x.com'),
    rateLimitKeys.authSignup('1.2.3.4'),
    rateLimitKeys.authForgot('1.2.3.4'),
    rateLimitKeys.authReset('1.2.3.4'),
    rateLimitKeys.publicFormIp('1.2.3.4'),
    rateLimitKeys.publicFormPage('page-1'),
    rateLimitKeys.publicTrackIp('1.2.3.4'),
    rateLimitKeys.testRun('user-a'),
    rateLimitKeys.sessionMessage('user-a'),
  ];
  for (const k of samples) {
    assert.ok(k.startsWith('rl:v1:'), `expected rl:v1: prefix on ${k}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run the test and confirm it passes**

```bash
npx tsx server/services/__tests__/rateLimitKeysPure.test.ts
```
Expected: `8 passed, 0 failed`.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/services/__tests__/rateLimitKeysPure.test.ts
git commit -m "test(phase-2b): add rateLimitKeys cross-namespace isolation tests

- Determinism: same inputs always produce the same key.
- Email normalisation: case folding works (Alice@x.com === alice@x.com).
- IP / userId: bytewise distinct (different inputs → different keys).
- Cross-user isolation: same route, different user → distinct keys.
- Cross-namespace isolation: same userId on testRun vs sessionMessage → distinct.
  Same IP on auth vs public form vs public track → all distinct.
- Shape: every emitted key starts with the rl:v1 version prefix.

Catches future refactors that accidentally collapse two buckets into one
(e.g. dropping a namespace component, missing the version prefix).

Spec: §7.2 (key cardinality)."
```

## 5. Phase 2C — Rate-limit cleanup job

**Spec reference:** § 6.2.4, § 7.2, § 10.2.
**Goal:** Implement a pg-boss-scheduled cleanup job that batched-deletes expired rate-limit buckets, register it in `server/index.ts` `start()`.

**Architect call:** spec §6.2.4 leaves "pg-boss vs `setInterval`" to architect choice. This plan picks **pg-boss** for parity with `agentScheduleService`, `paymentReconciliationJob`, and `queueService.startMaintenanceJobs()`. The setInterval fallback is recorded in the plan as an alternative if pg-boss is unavailable on the deploy target — but every existing maintenance job in the repo uses pg-boss, so this is the path of least surprise.

### Task 2C.1: Implement the cleanup job

**Files:**
- Create: `server/lib/rateLimitCleanupJob.ts`

- [ ] **Step 1: Write the cleanup job module**

Create `server/lib/rateLimitCleanupJob.ts` with exactly this content:

```ts
/**
 * rateLimitCleanupJob.ts — TTL cleanup for rate_limit_buckets.
 *
 * Runs every 5 minutes via pg-boss (see registerRateLimitCleanupJob below).
 * Bounded-batch DELETE of rows older than 2 hours (= 2 * max(windowSec) per
 * spec §6.2.4 retention rationale; longest call-site window is 3600s today).
 *
 * Bounded-batch pattern: at most 5000 rows per DELETE × 20 iterations per run
 * (= ≤ 100k rows per scheduled run). Reaching the cap emits
 * rate_limit.cleanup_capped so an outsized backlog surfaces.
 *
 * **Concurrency invariant (singleton-safe by design).** The cleanup is safe to
 * run concurrently — pg-boss schedules one worker per queue name by default,
 * AND the `FOR UPDATE SKIP LOCKED` inside the CTE means even if a second
 * invocation somehow fires (manual trigger, deploy overlap, future code path)
 * each worker picks a disjoint slice of victim rows and makes forward progress
 * without deadlock. The metrics emitted by each invocation are independent —
 * a partial run by one worker does not corrupt the count seen by another.
 * Do NOT add an external mutex / advisory lock to "enforce" singleton-ness;
 * the job is designed to tolerate it, and a lock would actually reduce
 * throughput when the queue backs up.
 *
 * FOR UPDATE SKIP LOCKED lets concurrent worker invocations make progress
 * without serialising. Cutoff is computed inline from DB time to keep the
 * limiter and its janitor reading the same clock (per the time-source
 * invariant in inboundRateLimiter.ts).
 *
 * Spec §6.2.4, §10.2.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from './logger.js';
import { env } from './env.js';
import { getPgBoss } from './pgBoss.js';

const QUEUE_NAME = 'maintenance:rate-limit-cleanup';
const SCHEDULE_CRON = '*/5 * * * *'; // every 5 minutes
const BATCH_SIZE = 5000;
const MAX_BATCHES_PER_RUN = 20;
// Retention = 2 * max(windowSec). Longest call-site window today is 3600s
// (testRun, 1 hour). Surfaced as a constant so a future contributor adding a
// longer-window route knows where to lift the floor (and where to look first
// when the cleanup_capped log fires).
const RETENTION_INTERVAL = '2 hours';

/**
 * Run one cleanup invocation. Loops the batched DELETE until either the row
 * count returned drops below BATCH_SIZE (caught up) or MAX_BATCHES_PER_RUN
 * batches have run (cap reached — emit warning).
 */
export async function runRateLimitCleanupOnce(): Promise<{ rowsDeleted: number; iterations: number; capped: boolean }> {
  let rowsDeleted = 0;
  let iterations = 0;

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    iterations = i + 1;
    const result = await db.execute<{ ok: number }>(sql`
      WITH victims AS (
        SELECT key, window_start
        FROM rate_limit_buckets
        WHERE window_start < now() - (${RETENTION_INTERVAL})::interval
        ORDER BY window_start
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM rate_limit_buckets r
      USING victims v
      WHERE r.key = v.key AND r.window_start = v.window_start
      RETURNING 1 AS ok
    `);
    const batchRows = result.rows.length;
    rowsDeleted += batchRows;
    if (batchRows < BATCH_SIZE) {
      // Caught up — exit early.
      return { rowsDeleted, iterations, capped: false };
    }
  }

  // Reached the cap — emit warning so the backlog surfaces.
  //
  // Two signals carry different alert semantics:
  //   `backlogEstimate`       — coarse classification (full-cap | partial-cap),
  //                             surfaced for human-readable log triage.
  //   `likelyBacklogRemaining` — boolean for trivial alert rules. True when every
  //                             batch returned a full BATCH_SIZE — meaning we
  //                             stopped at the cap, not because we caught up.
  //                             Wire ops alerts on a sustained streak (e.g. true
  //                             on N consecutive runs), not on the single event —
  //                             one capped run can happen during a normal traffic
  //                             spike and is self-correcting.
  //
  // Future-proofing: if this fires routinely, the lift order is (1) raise
  // MAX_BATCHES_PER_RUN, (2) shorten SCHEDULE_CRON, (3) shorten RETENTION_INTERVAL
  // (only after auditing the longest call-site window).
  const fullCap = rowsDeleted === BATCH_SIZE * MAX_BATCHES_PER_RUN;
  logger.warn('rate_limit.cleanup_capped', {
    rowsDeleted,
    iterations,
    batchSize: BATCH_SIZE,
    maxBatchesPerRun: MAX_BATCHES_PER_RUN,
    retentionInterval: RETENTION_INTERVAL,
    backlogEstimate: fullCap ? 'full-cap' : 'partial-cap',
    likelyBacklogRemaining: fullCap,
  });
  return { rowsDeleted, iterations, capped: true };
}

/**
 * Register the pg-boss queue + cron schedule. Called from server/index.ts start().
 * No-op when JOB_QUEUE_BACKEND !== 'pg-boss'.
 */
export async function registerRateLimitCleanupJob(): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    logger.warn('rate_limit_cleanup_skipped', { reason: 'pg-boss not configured' });
    return;
  }
  const boss = await getPgBoss();
  await boss.work(QUEUE_NAME, async () => {
    const summary = await runRateLimitCleanupOnce();
    logger.info('rate_limit.cleanup_run', summary);
  });
  await boss.schedule(QUEUE_NAME, SCHEDULE_CRON, {}, { tz: 'UTC' });
  logger.info('rate_limit_cleanup_scheduled', { cron: SCHEDULE_CRON });
}
```

- [ ] **Step 2: Verify the imports resolve correctly**

```bash
git grep -n "from '../lib/env" server/services/paymentReconciliationJob.ts
git grep -n "from '../lib/pgBoss\|getPgBoss" server/services/paymentReconciliationJob.ts
```
Expected: paths align with the `server/lib/env.js` and `server/lib/pgBoss.js` import sites used elsewhere. If the existing convention is `from './env.js'` (since the new file is in `server/lib/` already), correct the import to a relative path: `from './env.js'` and `from './pgBoss.js'` instead of `'../lib/env.js'`. The task code above used `../lib/` which is wrong for a file inside `server/lib/`; **before commit, change every `'../lib/<x>.js'` to `'./<x>.js'`** in this file.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. If `getPgBoss` is named differently in the project, adjust the import to the actual export.

- [ ] **Step 4: Commit**

```bash
git add server/lib/rateLimitCleanupJob.ts
git commit -m "feat(phase-2c): add rate_limit_buckets TTL cleanup job

- Bounded-batch DELETE: up to 5000 rows per query, capped at 20 batches per run.
- ORDER BY window_start + FOR UPDATE SKIP LOCKED — concurrent workers make
  progress without serialising; oldest-first bias is intentional (§6.2.4).
- Cutoff (now() - interval '2 hours') is DB-side, consistent with the limiter's
  clock invariant. 2-hour retention = 2 * max(windowSec); current longest is 3600s.
- Cap-reached path emits rate_limit.cleanup_capped at warn (with backlogEstimate
  human-readable + likelyBacklogRemaining boolean for trivial alert rules) so
  backlogs surface; alert on sustained likelyBacklogRemaining streaks, not single events.
- 2-hour retention extracted as RETENTION_INTERVAL constant for future-proofing.
- registerRateLimitCleanupJob is a no-op when JOB_QUEUE_BACKEND != 'pg-boss'.

Spec: §6.2.4, §10.2."
```

### Task 2C.2: Register the cleanup job in `server/index.ts` `start()`

**Files:**
- Modify: `server/index.ts` (one import + one `await` call inside `start()`)

- [ ] **Step 1: Add the import near the other queue-job imports at the top of the file**

```ts
// Near initializePaymentReconciliationJob etc.
import { registerRateLimitCleanupJob } from './lib/rateLimitCleanupJob.js';
```

- [ ] **Step 2: Call `registerRateLimitCleanupJob()` in `start()` alongside other maintenance jobs**

Locate the block in `server/index.ts` (around line 485) where `queueService.startMaintenanceJobs()` and `initializePaymentReconciliationJob()` are awaited. Add the new registration adjacent:

```ts
await queueService.startMaintenanceJobs();
await initializePageIntegrationWorker();
await initializePaymentReconciliationJob();
await registerRateLimitCleanupJob();  // Phase 2C — TTL on rate_limit_buckets
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Static verification that registration is gated under the same `JOB_QUEUE_BACKEND` check as other maintenance jobs**

```bash
git grep -n "registerRateLimitCleanupJob" server/index.ts
```
Expected: one match in `start()`. The gating is internal to `registerRateLimitCleanupJob` (it returns early when `env.JOB_QUEUE_BACKEND !== 'pg-boss'`), so no outer `if` block in `index.ts` is needed.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts
git commit -m "chore(phase-2c): register rate-limit cleanup job in server start()

Spec: §6.2.4."
```

## 6. Phase 2D — Call-site migration (auth + public routes)

**Spec reference:** § 6.2.5, § 7.2 *Key cardinality*, § 8.
**Goal:** Replace the in-process / `express-rate-limit` limiters in `auth.ts`, `formSubmission.ts`, `pageTracking.ts` with `inboundRateLimiter.check`. Each route emits 429 + `Retry-After` + `X-RateLimit-Policy` headers on denial via `setRateLimitDeniedHeaders`.

**Common patterns used in every task below:**

```ts
import { check, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
// (paths use '../../' from server/routes/public/*)

const result = await check(rateLimitKeys.<builder>(...), limit, windowSec);
if (!result.allowed) {
  setRateLimitDeniedHeaders(res, result.resetAt);
  res.status(429).json({ error: '...message matching the existing route...' });
  return;
}
```

**Why `setRateLimitDeniedHeaders` not raw `res.set('Retry-After', …)`:** the helper also emits `X-RateLimit-Policy: sliding-window;no-auto-retry` on every denial. Because the primitive increments the bucket on every call (including denied calls), naïve auto-retry on 429 deepens the denial — `RATE_LIMIT_POLICY_HEADER_VALUE` (centralised in `inboundRateLimiter.ts`) tells client SDKs / proxies that automatic retry is unsafe. See spec §10.1 *Unsafe retry classification*. Centralising header emission also prevents drift if the policy changes (e.g. add a `RateLimit-*` triple per draft RFC) — every route picks up the change automatically.

**Error-message convention:** the 429 body across every call site uses the shape `Too many <noun>. Please try again later.` (capital P, full sentence, period). Each route picks the right `<noun>` (login attempts / signup attempts / submissions / test runs). The `sessionMessage` arm uses `{ type: 'error', message: '...' }` (its discriminated-union shape) but the message text follows the same convention. Don't invent ad-hoc phrasing per route — the convention is reviewer-enforced.

**Generic fallback** for any new route that doesn't have a clean noun: `Too many requests. Please try again later.` This is the form `sessionMessage` uses (the route handles three different paths so no single noun fits). Reach for the generic before inventing awkward phrasing like "Too many session message creations" — readability wins over specificity at this layer.

Routes call `await check(...)` from inside `asyncHandler`, so the existing async route shape is preserved.

### Task 2D.1: Migrate `server/routes/auth.ts` login + signup + forgot + reset

**Files:**
- Modify: `server/routes/auth.ts:1-30, 41-72, 108, 120` (drop the `express-rate-limit` import + the in-process Map + `enforceLoginRateLimit` + `forgotPasswordRateLimit` / `resetPasswordRateLimit` middleware references)

- [ ] **Step 1: Edit imports — drop `express-rate-limit`, add `inboundRateLimiter`**

Replace `auth.ts:1-9` imports block:

```ts
import { Router } from 'express';
import { authService } from '../services/authService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { auditService } from '../services/auditService.js';
import { validateBody } from '../middleware/validate.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
import { loginBody, acceptInviteBody, forgotPasswordBody, resetPasswordBody, signupBody } from '../schemas/auth.js';
import type { LoginInput, AcceptInviteInput, ForgotPasswordInput, ResetPasswordInput, SignupInput } from '../schemas/auth.js';
```

The `import rateLimit from 'express-rate-limit';` line is **deleted**.

- [ ] **Step 2: Delete the in-process limiter constants and helper (lines 11–30)**

Delete lines 11–30 in their entirety:
- `const forgotPasswordRateLimit = rateLimit(...)`
- `const resetPasswordRateLimit = rateLimit(...)`
- `const router = Router();` (KEEP — re-emitted below)
- `const LOGIN_WINDOW_MS = …`
- `const LOGIN_MAX_ATTEMPTS = …`
- `const loginAttemptTimestamps = new Map<…>();`
- `function enforceLoginRateLimit(…) { … }`

After deletion, the file should pick back up at `// Validates password strength: …` (currently line 32) preceded by:

```ts
const router = Router();
```

(Restore the `Router()` line that lived at line 14; do not delete it.)

- [ ] **Step 3: Replace login rate-limit usage (was lines 67–72)**

Replace the inside-handler block:

```ts
const { email, password, organisationSlug } = req.body as LoginInput;
const limitResult = await rateLimitCheck(rateLimitKeys.authLogin(req.ip ?? 'unknown', String(email)), 10, 900); // 10 / 15 min, spec §6.2.5
if (!limitResult.allowed) {
  setRateLimitDeniedHeaders(res, limitResult.resetAt);
  res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  return;
}
```

The rest of the login handler (`authService.login`, audit logs, `res.json(result)`) is unchanged.

- [ ] **Step 4: Replace signup rate-limit usage (was lines 41–46)**

Replace:

```ts
router.post('/api/auth/signup', validateBody(signupBody), asyncHandler(async (req, res) => {
  const limitResult = await rateLimitCheck(rateLimitKeys.authSignup(req.ip ?? 'unknown'), 10, 900); // spec §6.2.5
  if (!limitResult.allowed) {
    setRateLimitDeniedHeaders(res, limitResult.resetAt);
    res.status(429).json({ error: 'Too many signup attempts. Please try again later.' });
    return;
  }
  const { agencyName, email, password } = req.body as SignupInput;
  // ... unchanged below
```

- [ ] **Step 5: Replace forgot-password middleware (was line 108)**

Change the route declaration from a chained middleware to inline check:

```ts
router.post('/api/auth/forgot-password', validateBody(forgotPasswordBody), asyncHandler(async (req, res) => {
  const limitResult = await rateLimitCheck(rateLimitKeys.authForgot(req.ip ?? 'unknown'), 5, 900); // 5 / 15 min, spec §6.2.5
  if (!limitResult.allowed) {
    setRateLimitDeniedHeaders(res, limitResult.resetAt);
    res.status(429).json({ error: 'Too many password reset requests. Please try again later.' });
    return;
  }
  const { email } = req.body as ForgotPasswordInput;
  // ... unchanged below
```

The previous `forgotPasswordRateLimit` argument is removed from the middleware chain.

- [ ] **Step 6: Replace reset-password middleware (was line 120)**

Same shape — drop the `resetPasswordRateLimit` middleware argument and add an inline check at the top of the handler:

```ts
router.post('/api/auth/reset-password', validateBody(resetPasswordBody), asyncHandler(async (req, res) => {
  const limitResult = await rateLimitCheck(rateLimitKeys.authReset(req.ip ?? 'unknown'), 5, 900);
  if (!limitResult.allowed) {
    setRateLimitDeniedHeaders(res, limitResult.resetAt);
    res.status(429).json({ error: 'Too many password reset attempts. Please try again later.' });
    return;
  }
  const { token, password } = req.body as ResetPasswordInput;
  // ... unchanged below
```

- [ ] **Step 7: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. Any leftover `enforceLoginRateLimit` / `forgotPasswordRateLimit` / `resetPasswordRateLimit` / `loginAttemptTimestamps` reference will produce `Cannot find name`; chase those before continuing.

- [ ] **Step 8: Static-grep verification**

```bash
git grep -n "express-rate-limit" server/
git grep -n "loginAttemptTimestamps\|enforceLoginRateLimit" server/
git grep -n "forgotPasswordRateLimit\|resetPasswordRateLimit" server/
```
Expected: zero matches across all three patterns. The package import is gone; the helpers are gone; the middleware refs are gone.

- [ ] **Step 9: Commit**

```bash
git add server/routes/auth.ts
git commit -m "refactor(phase-2d): migrate auth.ts rate limits to inboundRateLimiter

- Drop import 'express-rate-limit' and the in-process Map + enforceLoginRateLimit helper.
- Login keyed 'auth:login:<ip>:<email-lower>' at 10 / 15 min (matches prior).
- Signup keyed 'auth:signup:<ip>' at 10 / 15 min.
- Forgot/reset keyed 'auth:forgot|reset:<ip>' at 5 / 15 min (matches prior).
- All denials emit Retry-After + X-RateLimit-Policy via setRateLimitDeniedHeaders.

Spec: §6.2.5, §7.2."
```

### Task 2D.2: Migrate `server/routes/public/formSubmission.ts`

**Files:**
- Modify: `server/routes/public/formSubmission.ts:1-77` (drop in-process Maps + `setInterval` cleanup + `rateLimitMiddleware`; add inline check)

- [ ] **Step 1: Replace the imports + helpers + `setInterval` cleanup**

Delete lines 12–69 (the `TODO(PROD-RATE-LIMIT)` block, the `ipHits` / `pageHits` Maps, the `IP_LIMIT` / `PAGE_LIMIT` / `WINDOW_MS` constants, the `checkRateLimit` helper, the `setInterval` cleanup, and the `rateLimitMiddleware` function).

Replace with imports near the top + inline check inside the route:

```ts
/**
 * Public form submission route — no authentication required.
 * Rate-limited per IP (5/min) and per page (50/min) via the DB-backed
 * inboundRateLimiter primitive (spec §6.2.5).
 *
 * Middleware order (locked, plan §6 Task 2D.3): validateBody → rateLimit (inside
 * the asyncHandler) → handler body. Do NOT reorder — body validation is cheap
 * and lets us reject malformed payloads with 400 before charging the rate-limit
 * bucket. The authenticated-route invariant (auth → rateLimit → permission) does
 * not apply here; this route has no auth or permission step.
 */

import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { formSubmissionService } from '../../services/formSubmissionService.js';
import { validateBody } from '../../middleware/validate.js';
import { formSubmissionBody } from '../../schemas/public.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../../lib/rateLimitKeys.js';

const router = Router();

router.post(
  '/api/public/pages/:pageId/submit',
  validateBody(formSubmissionBody),
  asyncHandler(async (req, res) => {
    const ip = (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : null) ?? req.ip ?? 'unknown';
    const pageId = req.params.pageId ?? 'unknown';

    const ipResult = await rateLimitCheck(rateLimitKeys.publicFormIp(ip), 5, 60);
    if (!ipResult.allowed) {
      setRateLimitDeniedHeaders(res, ipResult.resetAt);
      res.status(429).json({ error: 'Too many submissions. Please try again later.' });
      return;
    }
    const pageResult = await rateLimitCheck(rateLimitKeys.publicFormPage(pageId), 50, 60);
    if (!pageResult.allowed) {
      setRateLimitDeniedHeaders(res, pageResult.resetAt);
      res.status(429).json({ error: 'This form is receiving too many submissions. Please try again later.' });
      return;
    }

    const { pageId: _pageIdBody } = req.params;
    const data = req.body as Record<string, unknown>;
    // ... existing handler body continues unchanged below this point.
  }),
);

export default router;
```

(Replace the placeholder comment with the actual existing handler body — copy verbatim from the current file lines 78–end.)

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Static-grep verification**

```bash
git grep -n "ipHits\|pageHits\|trackHits" server/routes/public/
git grep -n "TODO(PROD-RATE-LIMIT)" server/routes/public/formSubmission.ts
```
Expected: zero matches for the in-process Maps; zero matches for the TODO marker (it's deleted with the block).

- [ ] **Step 4: Commit**

```bash
git add server/routes/public/formSubmission.ts
git commit -m "refactor(phase-2d): migrate formSubmission rate limits to inboundRateLimiter

- Drop in-process ipHits/pageHits Maps + setInterval cleanup + rateLimitMiddleware.
- IP keyed 'public:form:ip:<ip>' at 5 / 60s.
- Page keyed 'public:form:page:<pageId>' at 50 / 60s.
- Both checks emit Retry-After + X-RateLimit-Policy via setRateLimitDeniedHeaders.

Spec: §6.2.5."
```

### Task 2D.3: Migrate `server/routes/public/pageTracking.ts`

**Files:**
- Modify: `server/routes/public/pageTracking.ts:1-58` (drop `trackHits` Map + `setInterval` + `checkTrackRateLimit`; add inline check)

- [ ] **Step 1: Replace imports + helpers + middleware**

Delete lines 13–58 (the TODO block, `trackHits` Map, `TRACK_IP_LIMIT`, `TRACK_WINDOW_MS`, `checkTrackRateLimit`, `setInterval` cleanup, and the inline middleware on the route declaration).

Replace with:

```ts
/**
 * Public page view tracking route — no authentication required.
 * Fire-and-forget: always returns 204, never fails the client.
 * Rate-limited per IP at 60/min via the DB-backed inboundRateLimiter primitive.
 *
 * Middleware order (locked, plan §6 Task 2D.3): validateBody → rateLimit (inside
 * the asyncHandler) → handler body. Same rationale as formSubmission.ts —
 * malformed bodies reject with 400 before charging the rate-limit bucket.
 */

import { Router } from 'express';
import { pageTrackingService } from '../../services/pageTrackingService.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validateBody } from '../../middleware/validate.js';
import { pageTrackingBody } from '../../schemas/public.js';
import type { PageTrackingInput } from '../../schemas/public.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../../lib/rateLimitKeys.js';

const router = Router();

router.post('/api/public/track', validateBody(pageTrackingBody), asyncHandler(async (req, res) => {
  const ip = (typeof req.headers['x-forwarded-for'] === 'string'
    ? req.headers['x-forwarded-for'].split(',')[0].trim()
    : null) ?? req.ip ?? 'unknown';

  const limitResult = await rateLimitCheck(rateLimitKeys.publicTrackIp(ip), 60, 60);
  if (!limitResult.allowed) {
    setRateLimitDeniedHeaders(res, limitResult.resetAt);
    res.status(429).end();
    return;
  }

  res.status(204).end();

  // Fire-and-forget — process after response is sent.
  const { pageId, sessionId, referrer, utmSource, utmMedium, utmCampaign } = req.body as PageTrackingInput;
  try {
    await pageTrackingService.recordView({
      pageId,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      referrer: typeof referrer === 'string' ? referrer : undefined,
      utmSource: typeof utmSource === 'string' ? utmSource : undefined,
      utmMedium: typeof utmMedium === 'string' ? utmMedium : undefined,
      utmCampaign: typeof utmCampaign === 'string' ? utmCampaign : undefined,
    });
  } catch (err) {
    console.error('[PageTracking] Failed to record page view:', err instanceof Error ? err.message : String(err));
  }
}));

export default router;
```

**Public-route ordering rule (locked by this plan).** Spec §6.1 *Middleware ordering invariant* defines the order for AUTHENTICATED routes only: `authenticate → rateLimit → permission` (so 401 → 429 → 403 by failure class). It does NOT specify an ordering for unauthenticated public routes. This plan resolves that gap by adopting:

- **Authenticated routes:** `authenticate → rateLimit → permission` (per spec, applied at `/api/session/message` in Phase 6).
- **Public routes** (`formSubmission`, `pageTracking`): `validateBody → rateLimit (inside the asyncHandler) → handler body`.

Rationale for the public-route shape: public routes have no `authenticate` step, the rate limiter is IP-keyed (does NOT depend on the body), and putting `validateBody` first costs nothing (Zod parse is microseconds) but lets us reject malformed bodies with 400 *before* charging the rate-limit bucket — a malformed payload from a flooding bot otherwise wastes a bucket slot per request. This trades a little bot-resistance (an attacker can deliberately send well-formed-but-empty payloads to drain buckets) for a much cleaner client-error response on accidental misuse, which is the right call for the consumer-form / pixel-tracking surface this plan migrates.

Encode the ordering choice in a route-file header comment so future contributors don't move the rate-limit middleware "back where it was". The grep gate in Phase 2E.6 Step 4 already enforces no inline key strings; the ordering itself is reviewer-enforced.

The spec catch-up (extend §6.1 to include the public-route ordering rule explicitly) is filed in §13.6 as a new item — see below.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Static-grep verification**

```bash
git grep -n "trackHits\|checkTrackRateLimit" server/
git grep -n "TODO(PROD-RATE-LIMIT)" server/routes/public/pageTracking.ts
```
Expected: zero matches.

- [ ] **Step 4: Commit**

```bash
git add server/routes/public/pageTracking.ts
git commit -m "refactor(phase-2d): migrate pageTracking rate limit to inboundRateLimiter

- Drop trackHits Map, setInterval cleanup, checkTrackRateLimit helper.
- IP keyed 'public:track:ip:<ip>' at 60 / 60s.
- 429 path returns empty body (matches prior); Retry-After + X-RateLimit-Policy headers added via setRateLimitDeniedHeaders.

Spec: §6.2.5."
```

## 7. Phase 2E — Test-run call-site migration + file deletions

**Spec reference:** § 6.2.5 (test-run row), §1.1 (deletions list).
**Goal:** Replace `checkTestRunRateLimit(userId)` (sync, throws on 429) at the four route call sites with `await rateLimitCheck('testrun:user:' + userId, TEST_RUN_RATE_LIMIT_PER_HOUR, 3600)`. Then delete `server/lib/testRunRateLimit.ts` and its pure test file.

The existing sync helper throws an object literal with `{ statusCode: 429, message }`; the new behaviour explicitly emits a `429 + Retry-After` response from inside the route handler — same effect, observable via the same HTTP status, with the addition of the `Retry-After` header.

### Task 2E.1: Migrate `server/routes/agents.ts` test-run call site

**Files:**
- Modify: `server/routes/agents.ts:11, 167` (drop import + replace call)

- [ ] **Step 1: Replace the import (line 11)**

```ts
// Was: import { checkTestRunRateLimit } from '../lib/testRunRateLimit.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
import { TEST_RUN_RATE_LIMIT_PER_HOUR } from '../config/limits.js';
```

If `TEST_RUN_RATE_LIMIT_PER_HOUR` is already imported in this file (it isn't on `main` but might land in another commit before this one), keep the existing import and skip re-import.

- [ ] **Step 2: Replace the call (line 167)**

```ts
// Was: checkTestRunRateLimit(req.user!.id);
const limitResult = await rateLimitCheck(rateLimitKeys.testRun(req.user!.id), TEST_RUN_RATE_LIMIT_PER_HOUR, 3600);
if (!limitResult.allowed) {
  setRateLimitDeniedHeaders(res, limitResult.resetAt);
  res.status(429).json({ error: `Too many test runs (max ${TEST_RUN_RATE_LIMIT_PER_HOUR} per hour). Please try again later.` });
  return;
}
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/agents.ts
git commit -m "refactor(phase-2e): migrate agents.ts test-run rate limit to inboundRateLimiter

Spec: §6.2.5."
```

### Task 2E.2: Migrate `server/routes/skills.ts` test-run call site

**Files:**
- Modify: `server/routes/skills.ts:10, 158` (drop import + replace call)

- [ ] **Step 1: Replace the import (line 10)**

```ts
// Was: import { checkTestRunRateLimit } from '../lib/testRunRateLimit.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
import { TEST_RUN_RATE_LIMIT_PER_HOUR } from '../config/limits.js';
```

- [ ] **Step 2: Replace the call (line 158)**

```ts
// Was: checkTestRunRateLimit(req.user!.id);
const limitResult = await rateLimitCheck(rateLimitKeys.testRun(req.user!.id), TEST_RUN_RATE_LIMIT_PER_HOUR, 3600);
if (!limitResult.allowed) {
  setRateLimitDeniedHeaders(res, limitResult.resetAt);
  res.status(429).json({ error: `Too many test runs (max ${TEST_RUN_RATE_LIMIT_PER_HOUR} per hour). Please try again later.` });
  return;
}
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/skills.ts
git commit -m "refactor(phase-2e): migrate skills.ts test-run rate limit to inboundRateLimiter

Spec: §6.2.5."
```

### Task 2E.3: Migrate `server/routes/subaccountAgents.ts` test-run call site

**Files:**
- Modify: `server/routes/subaccountAgents.ts:12, 286` (drop import + replace call)

- [ ] **Step 1: Replace the import (line 12)**

```ts
// Was: import { checkTestRunRateLimit } from '../lib/testRunRateLimit.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
import { TEST_RUN_RATE_LIMIT_PER_HOUR } from '../config/limits.js';
```

- [ ] **Step 2: Replace the call (line 286)**

```ts
// Was: checkTestRunRateLimit(req.user!.id);
const limitResult = await rateLimitCheck(rateLimitKeys.testRun(req.user!.id), TEST_RUN_RATE_LIMIT_PER_HOUR, 3600);
if (!limitResult.allowed) {
  setRateLimitDeniedHeaders(res, limitResult.resetAt);
  res.status(429).json({ error: `Too many test runs (max ${TEST_RUN_RATE_LIMIT_PER_HOUR} per hour). Please try again later.` });
  return;
}
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/subaccountAgents.ts
git commit -m "refactor(phase-2e): migrate subaccountAgents.ts test-run rate limit to inboundRateLimiter

Spec: §6.2.5."
```

### Task 2E.4: Migrate `server/routes/subaccountSkills.ts` test-run call site

**Files:**
- Modify: `server/routes/subaccountSkills.ts:9, 125` (drop import + replace call)

- [ ] **Step 1: Replace the import (line 9)**

```ts
// Was: import { checkTestRunRateLimit } from '../lib/testRunRateLimit.js';
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
import { TEST_RUN_RATE_LIMIT_PER_HOUR } from '../config/limits.js';
```

- [ ] **Step 2: Replace the call (line 125)**

```ts
// Was: checkTestRunRateLimit(req.user!.id);
const limitResult = await rateLimitCheck(rateLimitKeys.testRun(req.user!.id), TEST_RUN_RATE_LIMIT_PER_HOUR, 3600);
if (!limitResult.allowed) {
  setRateLimitDeniedHeaders(res, limitResult.resetAt);
  res.status(429).json({ error: `Too many test runs (max ${TEST_RUN_RATE_LIMIT_PER_HOUR} per hour). Please try again later.` });
  return;
}
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/subaccountSkills.ts
git commit -m "refactor(phase-2e): migrate subaccountSkills.ts test-run rate limit to inboundRateLimiter

Spec: §6.2.5."
```

### Task 2E.5: Delete `server/lib/testRunRateLimit.ts` and its pure test file

**Files:**
- Delete: `server/lib/testRunRateLimit.ts`
- Delete: `server/services/__tests__/testRunRateLimitPure.test.ts`

- [ ] **Step 1: Confirm zero remaining references in server/**

```bash
git grep -n "checkTestRunRateLimit\|testRunRateLimit\|_resetWindowStoreForTest\|getTestRunRateLimitMetrics" server/
```
Expected: matches only inside the two files being deleted. If a match exists outside those files, fix that import first (likely a missed call site) before deleting.

- [ ] **Step 2: Delete the files**

```bash
rm server/lib/testRunRateLimit.ts
rm server/services/__tests__/testRunRateLimitPure.test.ts
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. Any unresolved import to `testRunRateLimit` would surface here — fix and re-run if so.

- [ ] **Step 4: Static-grep verification — zero in-process limiters left in server/**

```bash
git grep -n "Map<string, number\[\]>" server/
git grep -n "TODO(PROD-RATE-LIMIT)" server/
```
Expected: zero matches across both — every TODO marker the spec called out is gone (and the only remaining `Map<string, number[]>` would be unrelated; if any matches surface, audit them).

- [ ] **Step 5: Commit the deletions**

```bash
git add -A server/lib/testRunRateLimit.ts server/services/__tests__/testRunRateLimitPure.test.ts
git commit -m "chore(phase-2e): delete testRunRateLimit module + pure test

The four test-run call sites (agents, skills, subaccountAgents, subaccountSkills)
now use inboundRateLimiter.check directly with key 'testrun:user:<userId>'.
The pure test (computeEffectiveCount) provides equivalent math coverage; the
caller migration is verified by static inspection (§12 test matrix).

Spec: §6.2.5, §1.1 deletions list."
```

### Task 2E.6: Final Phase 2 verification (no rebaseline of CI gates locally)

- [ ] **Step 1: Whole-repo typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 2: Re-run the rate-limit pure-unit test as a sanity smoke**

```bash
npx tsx server/services/__tests__/rateLimiterPure.test.ts
```
Expected: `7 passed, 0 failed`.

- [ ] **Step 3: Static-grep verification of the spec's three "every in-process limiter is gone" invariants**

```bash
git grep -n "express-rate-limit" server/
git grep -n "Map<string, number\[\]>" server/
git grep -n "TODO(PROD-RATE-LIMIT)" server/
```
Expected: zero matches across all three.

- [ ] **Step 4: Static-grep verification — no inline rate-limit key strings at call sites**

```bash
git grep -nE "rateLimitCheck\(\`" server/
```
Expected: zero matches. Every call site MUST consume `rateLimitKeys.<builder>(...)` rather than constructing the key as a backtick-template inline. The pattern is intentionally broad (any `rateLimitCheck(` followed by a backtick) so it catches future inline keys regardless of namespace or version prefix. (Builder definitions inside `server/lib/rateLimitKeys.ts` use template strings but are NOT `rateLimitCheck(` invocations, so they're excluded.)

- [ ] **Step 5: Static-grep verification — no inline `Retry-After` emission at call sites**

```bash
git grep -n "res.set('Retry-After'" server/ | grep -v "server/lib/inboundRateLimiter.ts"
```
Expected: zero matches. The only `res.set('Retry-After', …)` in the repo lives inside `setRateLimitDeniedHeaders` in `inboundRateLimiter.ts`; every route consumes the helper, which guarantees `X-RateLimit-Policy` is always paired with `Retry-After` and clients never see a half-set 429.

No commit at this step — this is the verification gate before moving to Phase 6 (which depends on Phase 2 having fully landed).

## 8. Phase 4 — Brief-creation envelope harmonisation

**Spec reference:** § 6.4, § 7.4, § 10.8.
**Goal:** Add `BriefCreationEnvelope` to `shared/types/briefFastPath.ts`. Make `/api/briefs` and `/api/session/message` `brief_created` arms return the envelope. Tighten the client types in Layout, GlobalAskBar, GlobalAskBarPure.

**Depends on:** none. Lands BEFORE Phase 6 because Phase 6's integration tests assert against `BriefCreationEnvelope` fields. (Spec §11 lists 6 before 4 — see §13.6 item 2 for the spec catch-up entry.)

### Task 4.1: Extend `shared/types/briefFastPath.ts` with `BriefCreationEnvelope`

**Files:**
- Modify: `shared/types/briefFastPath.ts:1-25` (append the new type)

- [ ] **Step 1: Append the type at the end of the file**

```ts
/**
 * Unified response shape for any brief-creation result. Returned by
 * POST /api/briefs and by every `brief_created` arm of POST /api/session/message
 * (Path A pendingRemainder resolution, Path B decisive command, Path C plain submission).
 *
 * Spec §7.4. Source-of-truth precedence: route response is canonical; the client
 * does whole-object replace, never selective merge.
 */
export interface BriefCreationEnvelope {
  /** Newly-created brief ID. UUID. */
  briefId: string;
  /** Conversation thread for the brief. UUID. */
  conversationId: string;
  /** Fast-path triage decision computed before persistence. */
  fastPathDecision: FastPathDecision;
  /** Resolved organisation; always present (route only succeeds with a resolved org). */
  organisationId: string;
  /** Resolved subaccount, or null if the brief is org-scoped. */
  subaccountId: string | null;
  /** Display name for the resolved organisation. May be null when the route does not have a name lookup pre-loaded (Path C currently — F15 deferred entry covers backfilling this). */
  organisationName: string | null;
  /** Display name for the resolved subaccount. May be null per the same rule as `organisationName`. */
  subaccountName: string | null;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add shared/types/briefFastPath.ts
git commit -m "feat(phase-4): add BriefCreationEnvelope unified response type

Single shape for any brief-creation result (POST /api/briefs and every
brief_created arm of POST /api/session/message). Required organisationId,
nullable subaccountId/names. Required fastPathDecision and conversationId.

Spec: §6.4, §7.4."
```

### Task 4.2: Tighten `/api/briefs` to return `BriefCreationEnvelope`

**Files:**
- Modify: `server/routes/briefs.ts:61-73`

- [ ] **Step 1: Add `BriefCreationEnvelope` import**

```ts
// At the top of briefs.ts, alongside the existing BriefUiContext import:
import type { BriefUiContext, BriefCreationEnvelope } from '../../shared/types/briefFastPath.js';
```

- [ ] **Step 2: Build the envelope before responding**

The current `createBrief()` returns `{ briefId, fastPathDecision, conversationId }`. The route already knows `req.orgId` (organisation) and `effectiveSubaccountId`. Extend the response:

```ts
const result = await createBrief({
  organisationId: req.orgId!,
  subaccountId: effectiveSubaccountId,
  submittedByUserId: req.user!.id,
  text: text?.trim() ?? explicitTitle!.trim(),
  source: source ?? 'global_ask_bar',
  uiContext: context,
  explicitTitle: explicitTitle?.trim(),
  explicitDescription: explicitDescription?.trim(),
  priority,
});

// Optional name lookup: the resolveSubaccount call above already validated
// effectiveSubaccountId belongs to req.orgId, but it does not return the org/sub
// names. We could fetch them here for a tighter envelope; spec §4.2 says they
// are returned when known and null otherwise. For this route the names are NOT
// pre-loaded (parity with current behaviour) — surface as null. F15 deferred
// entry (tasks/todo.md:345) covers backfilling.
const envelope: BriefCreationEnvelope = {
  briefId: result.briefId,
  conversationId: result.conversationId,
  fastPathDecision: result.fastPathDecision,
  organisationId: req.orgId!,
  subaccountId: effectiveSubaccountId ?? null,
  organisationName: null,
  subaccountName: null,
};
res.status(201).json(envelope);
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. The `BriefCreationEnvelope` shape MUST satisfy at compile time; if Drizzle infers `effectiveSubaccountId` as `string | undefined`, the `?? null` coerces it correctly.

- [ ] **Step 4: Commit**

```bash
git add server/routes/briefs.ts
git commit -m "feat(phase-4): /api/briefs returns BriefCreationEnvelope

Adds organisationId/subaccountId/names to the response. Names null for now —
F15 deferred entry covers backfilling.

Spec: §6.4.2, §7.4."
```

### Task 4.3: Tighten `/api/session/message` `brief_created` arms to `BriefCreationEnvelope`

**Files:**
- Modify: `server/routes/sessionMessage.ts:22-26` (the `SessionMessageResponse` discriminated union); plus every `brief_created` return point in the file

- [ ] **Step 1: Update the discriminated union**

Replace the existing `brief_created` arm in `SessionMessageResponse`:

```ts
import type { BriefCreationEnvelope } from '../../shared/types/briefFastPath.js';

type SessionMessageResponse =
  | { type: 'disambiguation'; candidates: ScopeCandidate[]; question: string; remainder: string | null }
  | { type: 'context_switch'; organisationId: string | null; organisationName: string | null; subaccountId: string | null; subaccountName: string | null }
  | ({ type: 'brief_created' } & BriefCreationEnvelope)
  | { type: 'error'; message: string };
```

- [ ] **Step 2: Locate every `type: 'brief_created'` return in the file and add `fastPathDecision` + `conversationId` + tighten `organisationId` to non-null**

```bash
git grep -n "type: 'brief_created'" server/routes/sessionMessage.ts
```
Expected: matches at 3+ sites — Path A (`pendingRemainder` resolution), Path B (decisive command), Path C (plain submission). For each, the route currently returns `{ type: 'brief_created', briefId, conversationId, organisationId, organisationName, subaccountId, subaccountName }`. Add the missing `fastPathDecision` field — it is already returned by `createBrief` (the route just discards it). Walk each call site:

  - **Path A `resolveAndCreate` (around `sessionMessage.ts:resolveAndCreate`)** — the helper currently returns the path-A response shape. Modify it to surface `fastPathDecision` from the `createBrief` result and to ensure `organisationId` is non-null.
  - **Path B (decisive command after `resolveSubaccount` succeeded)** — same change.
  - **Path C (plain submission)** — same change.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. Any `brief_created` return that did not include `fastPathDecision` will fail compilation against the tightened union.

- [ ] **Step 4: Static-grep verification**

```bash
git grep -n "fastPathDecision" server/routes/sessionMessage.ts
```
Expected: at least three matches (one per Path A/B/C `brief_created` arm) plus any pre-existing helper.

- [ ] **Step 5: Commit**

```bash
git add server/routes/sessionMessage.ts
git commit -m "feat(phase-4): unify /api/session/message brief_created arms on BriefCreationEnvelope

- Discriminated union arm 'brief_created' is now '{ type: \"brief_created\" } & BriefCreationEnvelope'.
- Each Path (A/B/C) returns fastPathDecision in addition to existing fields.
- organisationId tightened to non-null (route only succeeds with resolved org).

Spec: §6.4.2, §7.4."
```

### Task 4.4: Update `client/src/components/global-ask-bar/GlobalAskBarPure.ts` discriminated union

**Files:**
- Modify: `client/src/components/global-ask-bar/GlobalAskBarPure.ts:23-27`

- [ ] **Step 1: Replace the inline `brief_created` payload with `BriefCreationEnvelope`**

```ts
import type { BriefCreationEnvelope } from '../../../../shared/types/briefFastPath.js';

// ... (isValidBriefText, parseSlashRemember, ScopeCandidate unchanged)

export type SessionMessageResponse =
  | { type: 'disambiguation'; candidates: ScopeCandidate[]; question: string; remainder: string | null }
  | { type: 'context_switch'; organisationId: string | null; organisationName: string | null; subaccountId: string | null; subaccountName: string | null }
  | ({ type: 'brief_created' } & BriefCreationEnvelope)
  | { type: 'error'; message: string };
```

Verify the import path: from `client/src/components/global-ask-bar/GlobalAskBarPure.ts` to `shared/types/briefFastPath.ts`. The relative path is `../../../../shared/types/briefFastPath.js` (four `..`s — `global-ask-bar → components → src → client → repo-root`). Adjust if Vite's tsconfig path-mapping convention differs (e.g. `@shared/types/...`). Check `client/tsconfig.json` for `paths` aliases first.

- [ ] **Step 2: Run typecheck for the client**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/global-ask-bar/GlobalAskBarPure.ts
git commit -m "feat(phase-4): GlobalAskBarPure SessionMessageResponse uses BriefCreationEnvelope

Tightens the brief_created arm; the discriminated union shape is otherwise
unchanged (disambiguation / context_switch / error arms keep their existing types).

Spec: §6.4.3."
```

### Task 4.5: Update `GlobalAskBar.tsx` and `Layout.tsx` consumers

**Files:**
- Modify: `client/src/components/global-ask-bar/GlobalAskBar.tsx`
- Modify: `client/src/components/Layout.tsx`

- [ ] **Step 1: Verify GlobalAskBar's `brief_created` handlers compile against the tightened type**

```bash
npx tsc --noEmit
```
Expected: zero errors. Per spec §6.4.3, the existing handler in `GlobalAskBar` already consumes `data.organisationId / .subaccountId / .briefId`; the new envelope adds `fastPathDecision` + `conversationId` (forward-compatible — existing handler ignores extra fields). If a per-route branch did exist (e.g. a `if (response.type === 'brief_created' && 'organisationId' in response)` narrowing), audit and remove it — the unified envelope removes the need.

- [ ] **Step 2: Tighten `Layout.tsx` New Brief modal response type**

Open `client/src/components/Layout.tsx` and locate the `fetch('/api/briefs', { method: 'POST', ... })` call. The response is currently typed inline as `{ briefId: string; conversationId: string }`. Replace with:

```ts
import type { BriefCreationEnvelope } from '../../../shared/types/briefFastPath.js';

// inside the modal submit handler:
const data = (await res.json()) as BriefCreationEnvelope;
// Existing navigation: navigate(`/briefs/${data.briefId}`) — unchanged.
// fastPathDecision is now visible to the modal but the modal does not act on it
// (the brief detail page consumes it). Type-only import.
```

- [ ] **Step 3: Build the client**

```bash
npm run build:client
```
Expected: success. If type errors appear in the modal handler that previously narrowed on field presence, follow them and remove per-route branches.

- [ ] **Step 4: Static-grep verification — no per-route branching survives**

```bash
git grep -n "if.*type.*'brief_created'" client/src/
```
Expected: matches only the discriminated-union narrowing in event handlers (e.g. `if (data.type === 'brief_created') navigate(...)`); zero matches that further narrow ON FIELD PRESENCE within the `brief_created` arm.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/global-ask-bar/GlobalAskBar.tsx client/src/components/Layout.tsx
git commit -m "feat(phase-4): client surfaces consume unified BriefCreationEnvelope

- Layout modal response typed as BriefCreationEnvelope (was inline { briefId, conversationId }).
- GlobalAskBar handlers compile against the tightened SessionMessageResponse arm.
- No per-route field-presence branches remain in client code (G5 acceptance).

Spec: §6.4.3, §7.4."
```

## 9. Phase 6 — `/api/session/message` rate-limit + integration tests

**Spec reference:** § 6.1 (rate limit middleware), § 6.2 (test matrix T1–T8).
**Goal:** Add a rate-limit middleware to `POST /api/session/message` placed between `authenticate` and `requireOrgPermission(BRIEFS_WRITE)` per the spec ordering invariant. Add `sessionMessage.test.ts` covering Paths A/B/C, cross-tenant rejection, stale-subaccount drop.

**Depends on:** Phase 2A–2E (the `inboundRateLimiter.check` primitive must exist) AND Phase 4 (the `BriefCreationEnvelope` shape that T6/T8 assert against).

### Task 6.1: Add rate-limit middleware to `/api/session/message`

**Files:**
- Modify: `server/routes/sessionMessage.ts:28-34` (insert middleware between `authenticate` and `requireOrgPermission`)

- [ ] **Step 1: Add import**

At the top of `sessionMessage.ts`, add the imports alongside the existing imports (after line 5):

```ts
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../lib/rateLimitKeys.js';
```

- [ ] **Step 2: Add the middleware between `authenticate` and `requireOrgPermission`**

Replace the existing route declaration block (lines 28–35):

```ts
router.post(
  '/api/session/message',
  authenticate,
  // Phase 6: rate-limit BEFORE permission check so unauthenticated noise gets 401
  // (no charge), authenticated abuse gets 429, lacks-permission gets 403.
  // See spec §6.1 *Middleware ordering invariant*.
  asyncHandler(async (req, res, next) => {
    const limitResult = await rateLimitCheck(rateLimitKeys.sessionMessage(req.user!.id), 30, 60);
    if (!limitResult.allowed) {
      setRateLimitDeniedHeaders(res, limitResult.resetAt);
      res.status(429).json({ type: 'error', message: 'Too many requests. Please try again later.' });
      return;
    }
    next();
  }),
  // Path B (with remainder) and Path C both call createBrief; gate the route on the
  // same BRIEFS_WRITE permission /api/briefs enforces so read-only users cannot
  // create briefs through GlobalAskBar.
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE),
  asyncHandler(async (req, res) => {
    // existing handler body unchanged
```

The `req.user!.id` reference is safe because this middleware sits AFTER `authenticate`.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Static-grep verification of middleware ordering**

```bash
git grep -n "authenticate,\|rateLimitCheck\|requireOrgPermission" server/routes/sessionMessage.ts
```
Expected: in source order, `authenticate` precedes the rate-limit check, which precedes `requireOrgPermission`. The four-line ordering matters because §6.1 binds it to the response-code semantics.

- [ ] **Step 5: Commit**

```bash
git add server/routes/sessionMessage.ts
git commit -m "feat(phase-6): rate-limit /api/session/message at 30/min per user

- Middleware between authenticate and requireOrgPermission(BRIEFS_WRITE).
- Key 'session:message:user:<userId>'; 30 calls / 60s sliding window.
- 429 body matches existing SessionMessageResponse 'error' arm so the GlobalAskBar
  error handler renders correctly with no client change. Retry-After header set.
- Ordering invariant: 401 → 429 → 403 by failure class (spec §6.1).

Spec: §6.1."
```

### Task 6.2: Add the `sessionMessage.test.ts` integration test (T0–T8)

**Files:**
- Create: `server/routes/__tests__/sessionMessage.test.ts`

This is the F8 deviation — the only integration test this spec ships. It mirrors `conversationsRouteFollowUp.integration.test.ts` for the DB skip / dynamic-import shape.

> **Pre-task: read the existing `briefsArtefactsPagination.integration.test.ts` for any project-specific helpers** (test-org seeding, request shaping, JWT minting) so the new file matches conventions. Where the existing pattern uses `request(app)` for HTTP-level testing, this plan does the same.

- [ ] **Step 1: Write the failing test (skeleton + cases T0–T8)**

Create `server/routes/__tests__/sessionMessage.test.ts`. The full file is long; the structure is:

```ts
// guard-ignore-file: pure-helper-convention reason="Integration test — gated on a real DATABASE_URL probe before dynamically importing IO modules."
/**
 * sessionMessage.test.ts — Integration tests for POST /api/session/message.
 *
 * Spec §6.2 test matrix (T0–T8). Requires a live DB.
 *
 * Runnable via:
 *   npx tsx server/routes/__tests__/sessionMessage.test.ts
 *
 * What is tested:
 *   T0. No X-Stub-User-Id header → 401 from the stub authenticate middleware.
 *       Validates the 401 → 429 → 403 ordering invariant (spec §6.1) — without a
 *       failing-path test the stub could silently regress to letting unauth
 *       requests through to the rate limiter (which would then 429 them on the
 *       wrong arm). T0 pins that ordering; the stub returns 401 before the
 *       rate-limit middleware ever runs.
 *   T1. Path A — disambiguation candidate (org) → context_switch response.
 *   T2. Path A — disambiguation candidate (subaccount) WITH pendingRemainder → brief_created.
 *   T3. Path A — cross-tenant rejection: non-system-admin clicks an id from a different org.
 *   T4. Path B — decisive command "change to <name>, schedule a follow-up" → brief_created.
 *   T5. Path B — short hint (< 2 chars) → route-level error response.
 *   T6. Path C — plain submission → brief_created.
 *   T7. Path C — cross-tenant via X-Organisation-Id header rejected by auth middleware.
 *   T8. Path C — stale-subaccount drop: subaccountId not in resolved org → null + warn log.
 */
export {};

import { strict as assert } from 'node:assert';

await import('dotenv/config');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.includes('placeholder')) {
  console.log('\nSKIP: sessionMessage.test requires a real DATABASE_URL.\n');
  process.exit(0);
}

// Dynamic imports AFTER the DB-URL probe so a missing DB does not pull
// the IO graph into the test runner.
const { db } = await import('../../db/index.js');
const { tasks, organisations, subaccounts, users } = await import('../../db/schema/index.js');
const { eq } = await import('drizzle-orm');
const { default: express } = await import('express');
// Mount sessionMessage router into a minimal Express app for HTTP-level testing.
const { default: sessionMessageRouter } = await import('../sessionMessage.js');

const app = express();
app.use(express.json());
// Minimal stub for authenticate + requireOrgPermission. Mirrors the real
// middleware's behaviour: NO X-Stub-User-Id header → 401. This is what makes
// the T0 ordering test meaningful — a stub that silently let unauthenticated
// requests through to the rate limiter would mask a 401-vs-429 ordering regression
// in the route. Spec §6.1 *Middleware ordering invariant* requires 401 to fire
// before 429 / 403, and T0 below pins that with a real failing path.
app.use((req, res, next) => {
  const stubUserId = req.header('X-Stub-User-Id');
  if (!stubUserId) {
    res.status(401).json({ error: 'Unauthenticated (stub)' });
    return;
  }
  const stubRole = req.header('X-Stub-Role') ?? 'user';
  const stubOrgId = req.header('X-Stub-Org-Id');
  (req as unknown as { user: { id: string; role: string; organisationId: string | null } }).user = {
    id: stubUserId,
    role: stubRole,
    organisationId: stubOrgId ?? null,
  };
  (req as unknown as { orgId: string | null }).orgId = stubOrgId ?? null;
  next();
});
app.use(sessionMessageRouter);

// ... (helpers: makeRequest(body), seedOrg(), seedSubaccount(orgId), seedUser(orgId), countTasksFor(orgId))
// ... (T0 posts WITHOUT X-Stub-User-Id, asserts response.status === 401 — proves the
//      ordering invariant: 401 fires before the rate-limit middleware can 429.)
// ... (test cases T1–T8 each call makeRequest with the appropriate body and headers, assert response shape and DB state)
```

The test file IS long — the nine cases plus seed/teardown are roughly 270 lines. Rather than inline the full body here, the implementer follows the conversationsRouteFollowUp pattern verbatim:
- One DB seed/teardown helper per test (each case gets its own org, subaccount, user, tearing down on completion).
- Each case posts to `/api/session/message` with the correct body, asserts the response shape against `SessionMessageResponse`, and checks `tasks` row count + values via `db.select().from(tasks).where(eq(tasks.organisationId, orgId))`.
- T8 captures the `logger.warn('session.message.stale_subaccount_dropped', …)` emission by spying on `logger.warn` (e.g. monkey-patching `logger.warn` to push into an array, then asserting one matching entry — or by reading the `pino`-style log output if the project's logger streams to a captureable target).

- [ ] **Step 2: Run the test and confirm it passes**

```bash
DATABASE_URL=$DATABASE_URL npx tsx server/routes/__tests__/sessionMessage.test.ts
```

Expected: each case prints `PASS  T<N>: …` — 9 PASS lines (T0 through T8). Phase 4 has already landed at this point in the locked execution order (1 → 2 → 4 → 6 → 3 → 5 → 7), so `BriefCreationEnvelope` fields (`organisationId`, `subaccountId`, `fastPathDecision`) are present on every `brief_created` arm and T6 / T8 can assert against them. If T6 / T8 fail at the envelope-shape assertion, double-check that all five Phase 4 commits landed on this branch before continuing — `git log --oneline | grep phase-4` must show five entries. T0 has no Phase-4 dependency — failure of T0 means the stub middleware is not enforcing the no-stub-user-id → 401 path; fix the stub before treating any other test result as meaningful.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/__tests__/sessionMessage.test.ts
git commit -m "test(phase-6): add F8 integration tests for /api/session/message

T0 pins the 401 → 429 → 403 ordering (no stub user → 401 before rate limiter).
T1–T8 cover Path A/B/C, cross-tenant rejection, stale-subaccount drop. Real DB
required (skips when DATABASE_URL absent — matches conversationsRouteFollowUp).
F8 is the explicit pre-prod-spec deviation from spec-context's pure_function_only
posture; the brief author opted in.

Spec: §6.1 (middleware ordering), §6.2, §12 test matrix."
```

## 10. Phase 3 — Webhook secret boot assertion + open-mode warning

**Spec reference:** § 6.3, § 7.3, § 10.3, § 10.4.
**Goal:** Crash boot in production when `WEBHOOK_SECRET` is unset, and warn-once-per-process the first time a callback is verified in open mode (non-production, secret absent).

### Task 3.1: Add boot-time assertion in `server/index.ts` `start()`

**Files:**
- Modify: `server/index.ts:570-576` (insert after `validateSystemSkillHandlers()` catch block)

- [ ] **Step 1: Insert the assertion immediately after the system-skill validator block**

After line 576 (the closing `}` of the existing `try / catch` for `validateSystemSkillHandlers`), insert:

```ts
// Phase 3: webhook secret boot assertion (spec §6.3.1).
// Production MUST have a long random WEBHOOK_SECRET. An unset secret means
// outbound webhooks would be unsigned AND inbound callbacks would accept any
// token (verifyCallbackToken open-mode branch).
if (env.NODE_ENV === 'production' && !env.WEBHOOK_SECRET) {
  throw new Error(
    '[boot] WEBHOOK_SECRET is unset in production. Outbound webhooks would be unsigned and inbound callbacks would accept any token. Set WEBHOOK_SECRET to a long random string before booting in production.',
  );
}
```

The throw is caught by the existing `start().catch((err) => …)` at line 625 which logs and exits — same pattern as `validateSystemSkillHandlers`.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. `env.WEBHOOK_SECRET` is already typed as `string | undefined` in `server/lib/env.ts` (per spec §4 existing primitives table).

- [ ] **Step 3: Static-grep verification**

```bash
git grep -n "WEBHOOK_SECRET is unset in production" server/index.ts
```
Expected: one match.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat(phase-3): boot-time assertion for unset WEBHOOK_SECRET in production

Boot crashes via the existing start().catch path (no new error-handling lane).
Dev/test environments are unchanged.

Spec: §6.3.1, §10.3."
```

### Task 3.2: Add open-mode warn-once log in `verifyCallbackToken`

**Files:**
- Modify: `server/services/webhookService.ts:74-87` (the `verifyCallbackToken` body — insert warn-once before the `if (!secret) return true;` line)

- [ ] **Step 1: Add a module-level warn-once flag and `logger`/`env` imports if not already present**

At the top of `webhookService.ts`, ensure `logger` and `env` are imported. They almost certainly already are (the file references `env.WEBHOOK_SECRET`). Add a module-level let:

```ts
let webhookOpenModeWarned = false;
```

Place this after the existing top-of-file constants (e.g. after the `env` import block; pick a location consistent with how the file separates module-level state from function definitions).

- [ ] **Step 2: Modify `verifyCallbackToken`**

Replace the existing function body:

```ts
verifyCallbackToken(executionId: string, token?: string, engineHmacSecret?: string): boolean {
  const secret = engineHmacSecret ?? env.WEBHOOK_SECRET;
  if (!secret) {
    if (!webhookOpenModeWarned) {
      webhookOpenModeWarned = true;
      logger.warn('webhook.open_mode_active', {
        reason: 'WEBHOOK_SECRET unset; verifyCallbackToken accepts any token',
        nodeEnv: env.NODE_ENV,
      });
    }
    return true;
  }
  if (!token) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(executionId)
    .digest('hex');
  // Validate lengths match before timingSafeEqual (prevents throw on mismatched lengths)
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  if (tokenBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(tokenBuf, expectedBuf);
}
```

The behaviour change is purely additive — the open-mode branch already returned `true`; now it also warns the first time per process. The Phase 3.1 boot assertion guarantees this branch never fires in production.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Static-grep verification**

```bash
git grep -n "webhook.open_mode_active\|webhookOpenModeWarned" server/services/webhookService.ts
```
Expected: one match for the log key, and exactly the right number of references for the flag (declaration + read + set = three).

- [ ] **Step 5: Commit**

```bash
git add server/services/webhookService.ts
git commit -m "feat(phase-3): warn-once when verifyCallbackToken runs in open mode

Module-level flag emits webhook.open_mode_active the first time the open-mode
branch executes per process. Phase 3.1's boot assertion prevents this branch
from firing in production.

Spec: §6.3.2, §7.3, §10.4."
```

## 11. Phase 5 — Scope-resolution perf guard

**Spec reference:** § 6.5, § 12 (test matrix).
**Goal:** Extract the min-length predicate as a pure helper so the boundary is testable without spinning up the service. Call it at the top of `findEntitiesMatching` to short-circuit before the DB query.

### Task 5.1: Author the pure helper test FIRST (TDD)

**Files:**
- Create: `server/services/__tests__/scopeResolutionPure.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * scopeResolutionPure.test.ts — pure-unit tests for shouldSearchEntityHint.
 *
 * Spec §6.5, §12.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/scopeResolutionPure.test.ts
 */
import { strict as assert } from 'node:assert';
import { shouldSearchEntityHint } from '../scopeResolutionService.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

test('empty string returns false', () => {
  assert.equal(shouldSearchEntityHint(''), false);
});

test('whitespace-only returns false', () => {
  assert.equal(shouldSearchEntityHint('   '), false);
});

test('single character returns false', () => {
  assert.equal(shouldSearchEntityHint('a'), false);
});

test('single character padded with whitespace returns false', () => {
  assert.equal(shouldSearchEntityHint(' a '), false);
});

test('two characters returns true', () => {
  assert.equal(shouldSearchEntityHint('ab'), true);
});

test('longer hint returns true', () => {
  assert.equal(shouldSearchEntityHint('Acme'), true);
});

test('two characters with surrounding whitespace returns true', () => {
  assert.equal(shouldSearchEntityHint('  ab  '), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run the test and confirm failure**

```bash
npx tsx server/services/__tests__/scopeResolutionPure.test.ts
```
Expected: failure — `shouldSearchEntityHint` does not yet exist; `Cannot find module` or `is not a function`.

### Task 5.2: Add the pure helper + call-site short-circuit

**Files:**
- Modify: `server/services/scopeResolutionService.ts:27-29` (add helper above `findEntitiesMatching`; call it inside)

- [ ] **Step 1: Insert the pure helper above `findEntitiesMatching`**

```ts
/** Pure predicate for the entity-search guard. Exported so tests pin the boundary without spinning up the service. */
export function shouldSearchEntityHint(hint: string): boolean {
  return hint.trim().length >= 2;
}

export async function findEntitiesMatching(input: EntitySearchInput): Promise<ScopeCandidate[]> {
  const { hint, entityType, userRole, organisationId } = input;
  if (!shouldSearchEntityHint(hint)) return [];
  // Escape ILIKE special chars to prevent pattern injection
  const pattern = `%${hint.trim().replace(/[%_\\]/g, '\\$&')}%`;
  // ... existing body unchanged below
```

- [ ] **Step 2: Run the test and confirm it passes**

```bash
npx tsx server/services/__tests__/scopeResolutionPure.test.ts
```
Expected: `7 passed, 0 failed`.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Static-grep verification**

```bash
git grep -n "shouldSearchEntityHint" server/services/scopeResolutionService.ts
```
Expected: at least two matches — one declaration, one call site at the top of `findEntitiesMatching`.

- [ ] **Step 5: Commit**

```bash
git add server/services/__tests__/scopeResolutionPure.test.ts server/services/scopeResolutionService.ts
git commit -m "feat(phase-5): add shouldSearchEntityHint min-length guard

- Pure helper exported from scopeResolutionService.
- findEntitiesMatching short-circuits with [] when hint trims to < 2 chars,
  closing the class for any future caller that bypasses the route guard at
  sessionMessage.ts:84.
- 7-case pure-unit test covers empty / whitespace / single-char / two-char /
  longer / padded inputs.

Spec: §6.5, §12."
```

## 12. Phase 7 — Dev-script safety

**Spec reference:** § 6.7, § 7.5, § 10.7.
**Goal:** `_reseed_drop_create.ts` refuses to run unless `NODE_ENV=development`. `_reseed_restore_users.ts` wraps the per-row UPDATE loop in a single `pg` client transaction (BEGIN / COMMIT / ROLLBACK) so mid-loop failure leaves the DB unchanged.

### Task 7.1: Add NODE_ENV guard to `_reseed_drop_create.ts`

**Files:**
- Modify: `scripts/_reseed_drop_create.ts:1-3` (insert guard immediately after the `dotenv/config` import)

- [ ] **Step 1: Insert the guard at the top of the script after `dotenv/config`**

```ts
import 'dotenv/config';

if (process.env.NODE_ENV !== 'development') {
  throw new Error(
    `[reseed] Refusing to run: NODE_ENV is "${process.env.NODE_ENV ?? 'undefined'}", expected "development". This script DROPs and recreates the database.`,
  );
}

import { Pool } from 'pg';

// ... rest of file unchanged
```

The guard sits AFTER `dotenv/config` so a `.env`-supplied `NODE_ENV=development` value is read before the check. Per spec §4 *Existing primitives search*, importing the full `server/lib/env.js` validation chain into a CLI script is heavier than the spec wants — a literal `process.env.NODE_ENV` check is correct.

- [ ] **Step 2: Verify by running the script in a non-dev shell (manual smoke)**

```bash
NODE_ENV=production npx tsx scripts/_reseed_drop_create.ts 2>&1 | head -3
```
Expected: the script throws and exits non-zero before it touches the admin Pool. The error message includes the literal `NODE_ENV is "production"`.

In a dev shell:
```bash
NODE_ENV=development DATABASE_URL=postgres://stub npx tsx scripts/_reseed_drop_create.ts 2>&1 | head -3
```
Expected: the script proceeds (and then fails on the next IO step against `postgres://stub` — that is fine; the guard let it pass, which is what we wanted to verify).

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/_reseed_drop_create.ts
git commit -m "feat(phase-7): NODE_ENV=development guard on _reseed_drop_create.ts

Refuses to run unless NODE_ENV='development'. The check happens before any
DB connection so a misconfigured NODE_ENV cannot drop a non-dev database.

Spec: §6.7.1, §10.7."
```

### Task 7.2: Wrap `_reseed_restore_users.ts` UPDATE loop in a single transaction

**Files:**
- Modify: `scripts/_reseed_restore_users.ts:21-46` (lease a `client` via `pool.connect()`, wrap loop in `BEGIN/COMMIT`/`ROLLBACK`)

- [ ] **Step 1: Replace the per-row `pool.query` loop with a transaction-leased client**

Replace lines 21–46 (the `let updated = …` declarations through the closing `await pool.end()`):

```ts
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

let updated = 0;
let skipped = 0;

try {
  await client.query('BEGIN');
  for (const row of rows) {
    const r = await client.query(
      `UPDATE users
          SET password_hash = $1,
              first_name    = $2,
              last_name     = $3,
              slack_user_id = $4,
              updated_at    = now()
        WHERE email = $5
        RETURNING id, email`,
      [row.password_hash, row.first_name, row.last_name, row.slack_user_id, row.email],
    );
    if (r.rowCount && r.rowCount > 0) {
      console.log(`[restore] updated ${row.email} (id=${r.rows[0].id})`);
      updated += r.rowCount;
    } else {
      console.log(`[restore] no match for ${row.email} — skipping`);
      skipped++;
    }
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  throw err;
} finally {
  client.release();
}

console.log(`\n[restore] done: ${updated} updated, ${skipped} skipped`);
await pool.end();
```

Invariants enforced by this shape:
1. Every UPDATE runs through the SAME leased `client` so the BEGIN actually establishes a transaction (calling `pool.query` returns a different connection per call and would NOT establish a transaction).
2. Mid-loop failure (Ctrl-C, network blip, malformed row) triggers `ROLLBACK` — the DB is unchanged, re-run starts from row 0 idempotently.
3. `client.release()` runs in `finally` so the connection is returned to the pool whether the transaction committed or rolled back.
4. The `.catch(() => {})` on the ROLLBACK swallows secondary errors that would otherwise mask the original — the `throw err` re-raises the primary failure.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. The `pg` `Pool` and `PoolClient` types are already in the project's `@types/pg`.

- [ ] **Step 3: Static-grep verification**

```bash
git grep -n "pool.connect\|client.query\|BEGIN\|COMMIT\|ROLLBACK\|client.release" scripts/_reseed_restore_users.ts
```
Expected: each pattern appears at least once. **No** `pool.query` calls remain inside the loop.

```bash
git grep -n "pool.query" scripts/_reseed_restore_users.ts
```
Expected: zero matches inside the loop. (The script still uses `pool.connect()` once at the top and `pool.end()` once at the bottom; `pool.query` itself is no longer used.)

- [ ] **Step 4: Commit**

```bash
git add scripts/_reseed_restore_users.ts
git commit -m "feat(phase-7): wrap _reseed_restore_users UPDATE loop in transaction

- Lease one client via pool.connect(); BEGIN before the loop, COMMIT after.
- Mid-loop failure rolls back so the DB is unchanged on error (idempotent re-run).
- finally releases the client even on failure; ROLLBACK errors swallowed so they
  don't mask the original throw.
- All DML uses the leased client; pool.query never appears inside the loop.

Spec: §6.7.2, §7.5, §10.7."
```

## 13. Final acceptance checklist + housekeeping

### 13.1 Pre-PR static-gate verification (run locally; CI is canonical)

- [ ] **Step 1: Whole-repo typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors. CI also runs this; failing locally means the PR will not pass.

- [ ] **Step 2: Re-run all three new pure-unit tests as a sanity smoke**

```bash
npx tsx server/services/__tests__/rateLimiterPure.test.ts
npx tsx server/services/__tests__/rateLimitKeysPure.test.ts
npx tsx server/services/__tests__/scopeResolutionPure.test.ts
```
Expected: all three report `N passed, 0 failed`.

- [ ] **Step 3: Conditional integration test (only if `DATABASE_URL` is set locally)**

```bash
npx tsx server/routes/__tests__/sessionMessage.test.ts
```
Expected: `T0–T8 PASS`. If `DATABASE_URL` is unset the test prints a SKIP line and exits 0 — that is acceptable; CI runs the integration suite against the seeded test DB.

- [ ] **Step 4: Static-grep verification of the four spec invariants**

```bash
git grep -n "express-rate-limit" server/
git grep -n "Map<string, number\[\]>" server/
git grep -n "TODO(PROD-RATE-LIMIT)" server/
git grep -n "memoryStorage" server/middleware/validate.ts
```
Expected: zero matches across all four. If any pattern matches, audit the offending file before opening the PR.

### 13.2 Update `tasks/current-focus.md`

The current-focus pointer must reflect post-build state. Update both the mission-control block and the prose so the next session knows the spec is complete and the PR is open.

- [ ] **Step 1: Edit `tasks/current-focus.md`**

Replace the current spec/branch references with a "review-pending" marker pointing at this PR. The exact format depends on whatever convention the file uses today (look at the previous entry for shape). Sample diff intent:

```diff
- Active spec: pre-prod-boundary-and-brief-api (in build)
+ Active spec: pre-prod-boundary-and-brief-api (review-pending — PR #<NN>)
```

- [ ] **Step 2: Commit the housekeeping change**

```bash
git add tasks/current-focus.md
git commit -m "chore: update current-focus pointer for pre-prod-boundary-and-brief-api PR"
```

### 13.3 Acceptance criteria mapping (mirrors spec § 14)

| AC | Verified by |
|---|---|
| AC1 — Multer cap 50 MB + diskStorage + tempfile cleanup | Phase 1 Task 1.1 (steps 4–5 grep) |
| AC2 — `inboundRateLimiter.ts` shipped with `computeEffectiveCount` pure-unit test | Phase 2B Task 2B.1 + 2B.2 |
| AC2.1 — `rateLimitKeys.ts` shipped with cross-namespace isolation pure-unit test | Phase 2B Task 2B.3 + 2B.4 |
| AC3 — Every old call site migrated; `testRunRateLimit.ts` deleted; in-process Maps gone | Phase 2D + 2E (final greps) |
| AC4 — Production boot fails fast on unset `WEBHOOK_SECRET`; non-prod logs open-mode warn-once | Phase 3 Tasks 3.1 + 3.2 |
| AC5 — `/api/briefs` and `/api/session/message` return same `BriefCreationEnvelope`; clients consume unified shape | Phase 4 Tasks 4.1–4.5 |
| AC6 — `findEntitiesMatching` returns `[]` for hint < 2 chars (unit-tested) | Phase 5 Tasks 5.1 + 5.2 |
| AC7 — `/api/session/message` rate-limited at the new primitive | Phase 6 Task 6.1 |
| AC8 — `sessionMessage.test.ts` covers T0 (401-no-stub for ordering invariant), Path A/B/C, cross-tenant, stale-subaccount | Phase 6 Task 6.2 |
| AC9 — Reseed scripts: NODE_ENV guard + transaction wrap | Phase 7 Tasks 7.1 + 7.2 |
| AC10 — `npx tsc --noEmit` clean | §13.1 Step 1 |
| AC11 — Existing CI gates (RLS coverage, no-silent-failures, RLS-protected-tables registry) continue to pass | CI on PR open; not run locally |

### 13.4 Review pipeline (per CLAUDE.md task class — Major)

After committing all phases and pushing the branch:

1. Run `spec-conformance` (the spec is the source of truth — this auto-detects and verifies):
   ```
   spec-conformance: verify the current branch against its spec
   ```
2. If `spec-conformance` returns `CONFORMANT_AFTER_FIXES`, re-run `pr-reviewer` on the expanded changed-code set.
3. Run `pr-reviewer`:
   ```
   pr-reviewer: review the changes I just made on the pre-prod-boundary-and-brief-api branch
   ```
4. **Optional** (only when the user explicitly asks): `dual-reviewer` for a Codex-loop second pass — local-only.

The review pipeline order is mandatory for Major tasks per CLAUDE.md *Review pipeline*.

### 13.5 Open the PR

After review agents pass:

```bash
git push -u origin pre-prod-boundary-and-brief-api
gh pr create --title "Pre-Production Boundary Security + Brief API" --body "$(cat <<'EOF'
## Summary

Hardens the HTTP boundary surface and brief-creation API for pre-production lockdown.

- **Phase 1 — Multer:** disk storage + 50 MB cap + per-request tempfile cleanup.
- **Phase 2 — Rate limiter:** new Postgres-backed sliding-window primitive at `server/lib/inboundRateLimiter.ts`; replaces every in-process / express-rate-limit call site (auth, public form/track, four test-run routes). `testRunRateLimit.ts` deleted.
- **Phase 3 — Webhook:** boot crashes when `WEBHOOK_SECRET` unset in production; warn-once log when verifyCallbackToken runs in open mode.
- **Phase 4 — Brief envelope:** unified `BriefCreationEnvelope` returned by `/api/briefs` and every `brief_created` arm of `/api/session/message`. Clients consume the unified shape.
- **Phase 5 — Scope-resolution:** pure-helper min-length guard at the service layer (defence in depth over the existing route guard).
- **Phase 6 — Session message:** rate-limited at 30/min per user; integration tests cover Paths A/B/C, cross-tenant rejection, stale-subaccount drop.
- **Phase 7 — Reseed scripts:** NODE_ENV guard + transactional restore.

Spec: docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md
Plan: docs/superpowers/plans/2026-04-29-pre-prod-boundary-and-brief-api.md

## Test plan

- [ ] CI: lint + typecheck + full gate suite green.
- [ ] CI: integration suite (sessionMessage T0–T8) passes against the seeded test DB.
- [ ] Manual: 20 MB upload via the file route (parity smoke for Multer disk-storage).
- [ ] Manual: `NODE_ENV=production WEBHOOK_SECRET= node …` exits non-zero with the expected boot error.
- [ ] Manual: `NODE_ENV=production npx tsx scripts/_reseed_drop_create.ts` exits non-zero before any DB IO.
EOF
)"
```

Set the title concise (under 70 chars), use the body for everything else.

### 13.6 Spec-gap follow-ups for `tasks/todo.md`

Per the spec gaps surfaced in this plan, append entries to `tasks/todo.md` as deferred items so the spec catches up post-merge:

1. **`server/lib/rateLimiter.ts` rename collision** — plan §4 callout. Either accept the new file `inboundRateLimiter.ts` and update spec §5/§6.2.3 to match, or rename existing outbound provider limiter to `outboundRateLimiter.ts` and reclaim `rateLimiter.ts` for the inbound primitive.
2. **Phase ordering 4-before-6** — plan now locks execution order to 1 → 2 → 4 → 6 → 3 → 5 → 7 (header + ToC + body all updated). Spec §11 still lists the older 1 → 2 → 6 → 3 → 4 → 5 → 7 order; update spec §11 to match the plan (same set, swap 6 and 4) so future authors don't re-litigate the order.
3. **F8 `sessionMessage.test.ts` stub helpers** — Phase 6 §8 Task 6.2 Step 1 inlines a Express stub for `authenticate` / `requireOrgPermission`. This is bespoke to the test; centralising into a shared `server/test-helpers/mountStubAuth.ts` is a follow-up if the integration-test surface grows beyond this single file.

4. **Public-route middleware ordering** — spec §6.1 only defines the ordering invariant for authenticated routes (`auth → rateLimit → permission`). Plan §6 Task 2D.3 extends this to public routes as `validateBody → rateLimit (inside asyncHandler) → handler` and records the rationale (rate limiter is IP-keyed, body validation is microseconds, malformed payloads should reject before charging bucket). Update spec §6.1 to include the public-route variant so future authors don't re-litigate.

Every item above is **out of scope for this PR** — they are spec / test-helper improvements, not behaviour changes.

---

## Self-review notes

This plan was self-reviewed at authoring time per the writing-plans skill checklist:

1. **Spec coverage check.** Each of the 7 phases in the spec maps to one or more plan tasks. Each goal G1–G10 in spec §2 maps to an acceptance criterion AC1–AC11 in §13.3. Each "New / Modified / Deleted" file in spec §5 appears in plan §1.1 and is touched by at least one task.

2. **Placeholder scan.** No `TBD`, `TODO`, `implement later`, `fill in details`, "add appropriate error handling", or "similar to Task N" placeholder phrases. Where the integration test in Task 6.2 is described structurally rather than line-by-line, the implementer is pointed at a concrete existing file (`conversationsRouteFollowUp.integration.test.ts`) to copy from — not asked to invent.

3. **Type consistency.** `BriefCreationEnvelope` carries the same six fields in §4.1 (server type), §4.2 (server route), §4.3 (server route), §4.4 (client pure types), §4.5 (client surfaces). `RateLimitCheckResult` returns `{ allowed, remaining, resetAt }` consistently across spec §7.1, plan §4 Task 2B.2, and every call-site usage in Phases 2D / 2E / 6. `setRateLimitDeniedHeaders(res, resetAt)` is the canonical 429-header helper at every call site — no inline `res.set('Retry-After', …)` survives, which keeps the `X-RateLimit-Policy` header consistent across all denial paths. `rateLimitKeys.<builder>(...)` is the canonical key form — no inline string concatenation at any call site.

4. **Spec deviations flagged in plan.** Two non-trivial deviations are recorded inline so the reviewer can adjudicate:
   - **File rename** (spec says `server/lib/rateLimiter.ts` for the new primitive; that path is taken by an unrelated existing file). Plan ships at `server/lib/inboundRateLimiter.ts`; spec catch-up filed as §13.6 item 1.
   - **Phase 4-before-6 ordering** (spec §11 recommends 6 before 4; plan locks 4 before 6 because Phase 6's tests assert `BriefCreationEnvelope` fields Phase 4 introduces — header, ToC, and body order all enforce this). Spec catch-up filed as §13.6 item 2.

No third deviation surfaced during authoring. The Phase 2 vs Phase 6 dependency in spec §11 is preserved.
