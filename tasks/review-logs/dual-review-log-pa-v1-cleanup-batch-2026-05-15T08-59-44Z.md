# Dual Review Log — pa-v1-cleanup-batch

**Files reviewed:** branch `claude/pa-v1-cleanup-batch` against `origin/main` — 13 code files + 8 review/doc artifacts (full diff list per branch brief).
**Iterations run:** 2/3
**Timestamp:** 2026-05-15T08:59:44Z
**Commit at finish:** d60e94b9

---

## Iteration 1

Codex raised 1 finding (P1, repeated/duplicated as is normal for Codex). After thorough analysis it is REAL and CRITICAL.

[ACCEPT] `migrations/0360_voice_profiles_schema_align.down.sql:9-11` — Down migration uses bare `RENAME COLUMN` which is not idempotent. The custom `scripts/migrate.ts` runner picks up every `^\d{4}_.*\.sql$` file in lexical order; `.down.sql` sorts BEFORE `.sql` (the `.` before `down` < the terminating `.sql`), so on a fresh CI database the down migration runs FIRST. Bare RENAME would fail with `column "sample_size" does not exist` because `sample_size` only exists AFTER the up migration runs. Production deploy would be blocked.

  Codex's proposed remediation (move rollback SQL out of `migrations/` or use a runner-ignored name) is WRONG for this codebase — the repo convention (89 existing `.down.sql` files, KNOWLEDGE.md [2026-05-15] entry, `migrations/0358_skill_merge_consolidation.down.sql:1-9` exemplar) is to keep `.down.sql` in `migrations/` and write them idempotently with `IF EXISTS` / `IF NOT EXISTS` guards.

  Correct fix per repo convention: wrap the three `RENAME COLUMN` statements in a `DO $$ ... END $$` block with `information_schema.columns` existence checks so the rename only fires when the new column name exists (i.e. when the up migration has already run). All other steps already use `IF EXISTS` / `IF NOT EXISTS` and are fine.

  Reason accepted: blocks production deploy on the first apply; not a stylistic concern. Fix is mechanical and matches established repo convention.

## Iteration 2

Codex raised 1 finding (P2).

[REJECT — routed to `tasks/todo.md` as PA-CLEANUP-DEF-7] `server/services/eaProvisioningService.ts:32` — "Avoid enrolling failed new profiles in nightly retries". When a newly-provisioned profile's first derivation fails, `refreshPolicy='periodic'` + `lastDerivedAt=null` + `deriveProfile` allowing `failed` rows = indefinite nightly re-derivation.

  Reason rejected:
  1. The provisioning value `'periodic'` is explicitly mandated by spec §13.4 step 6. The pr-reviewer R1 BLOCKING (commit `44776dc6`) required exactly this value. Reverting would re-introduce the BLOCKING that already shipped a fix.
  2. The behavior Codex flags is PRE-EXISTING — the `shouldRefresh` semantics (null `lastDerivedAt` → eligible) and `deriveProfile` claim predicate (`inArray(state, ['pending', 'ready', 'failed'])`) both predate this PR. The issue surfaces for any `periodic` profile, not just wizard-provisioned ones.
  3. The fix requires a spec decision (should nightly refresh skip `failed` rows? Should `shouldRefresh` require non-null `lastDerivedAt`? Should `deriveProfile` exclude `failed`?). That's out of REQ-C4's stated scope (column rename + provisioning shape alignment).
  4. Per CLAUDE.md § 6 "Surface, don't smuggle": out-of-scope behavioral concerns are routed to `tasks/todo.md`, not silently fixed.

  Action taken: added PA-CLEANUP-DEF-7 entry to `tasks/todo.md` capturing the gap, the three candidate fix paths, and the reason for deferral. Mirrors the existing PA-CLEANUP-DEF-1..6 deferral pattern.

**Termination:** iteration 2 accepted zero findings → break per protocol ("If zero findings were accepted this iteration → break").

---

## Changes Made

- `migrations/0360_voice_profiles_schema_align.down.sql` — wrapped the three `RENAME COLUMN` statements in a `DO $$ ... END $$` block with `information_schema.columns` existence guards, so the down migration is idempotent when picked up before the up by `scripts/migrate.ts` (lexical-order convention). Header comment updated to call out the convention and reference KNOWLEDGE.md [2026-05-15] + `0358_skill_merge_consolidation.down.sql`.
- `tasks/todo.md` — added PA-CLEANUP-DEF-7 entry deferring the "failed profiles get retried nightly under periodic policy" behavioral concern surfaced by Codex iteration 2.

## Rejected Recommendations

- **Iteration 2, P2:** "Avoid enrolling failed new profiles in nightly retries" (`eaProvisioningService.ts:32`). Rejected as out-of-scope for REQ-C4 (the provisioning value is spec-mandated and pr-reviewer R1 already blocked on it); the underlying behavior is pre-existing system design and predates this PR. Routed to `tasks/todo.md` as PA-CLEANUP-DEF-7 with three candidate fix paths for future triage.

- **Iteration 1, P1 remediation framing:** Codex suggested moving `.down.sql` files out of `migrations/` or renaming to a pattern the runner ignores. Rejected as wrong-fix-for-this-codebase: 89 existing `.down.sql` files follow the in-place + idempotent-guards convention (documented in KNOWLEDGE.md [2026-05-15] and `0358_skill_merge_consolidation.down.sql`). The identified PROBLEM was accepted (and fixed); only Codex's proposed remediation path was rejected.

---

**Verdict:** APPROVED (2 iterations, 1 P1 fix applied, 1 P2 routed to deferred-items per surface-don't-smuggle)
