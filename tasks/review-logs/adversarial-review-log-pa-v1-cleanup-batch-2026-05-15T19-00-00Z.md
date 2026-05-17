# Adversarial Review Log — pa-v1-cleanup-batch

**Reviewer:** adversarial-reviewer (Phase 1 advisory)
**Branch:** claude/pa-v1-cleanup-batch
**Timestamp:** 2026-05-15T19:00:00Z

**Files reviewed:**
- `migrations/0360_voice_profiles_schema_align.sql` + `.down.sql`
- `server/db/schema/voiceProfiles.ts`
- `shared/types/voiceProfile.ts`
- `server/services/voiceProfile/voiceProfileService.ts`
- `server/jobs/voiceProfileRefreshJob.ts`
- `server/services/agentExecutionServicePure.ts`
- `server/services/operatorSessionInitialContextBundler.ts`
- `client/src/config/sidebar.ts`
- `client/src/config/__tests__/buildNavItems.test.ts`
- `server/services/voiceProfile/__tests__/voiceProfileColumnAlignment.test.ts`
- `tasks/builds/pa-v1-cleanup-batch/plan.md`
- `tasks/builds/pa-v1-cleanup-batch/progress.md`

---

## Verdict: HOLES_FOUND (0 confirmed-holes, 1 likely-hole, 2 worth-confirming)

Phase 1 advisory; non-blocking. Findings routed to `tasks/todo.md` as PA-CLEANUP-DEF-1 through PA-CLEANUP-DEF-3.

---

## Context loaded

- `CLAUDE.md`, `architecture.md`, `DEVELOPMENT_GUIDELINES.md` read
- `migrations/0328_voice_profiles.sql` read (original creation + RLS policy)
- `server/config/rlsProtectedTables.ts` (confirmed voice_profiles entry + policyMigration pointer)
- `scripts/.gate-baselines/with-org-tx-or-scoped-db.txt` (confirmed all 10 voiceProfileService.ts entries + 3 operatorSessionInitialContextBundler.ts entries)
- `server/lib/orgScopedDb.ts`, `server/lib/adminDbConnection.ts`, `server/instrumentation.ts` read

---

## Threat-model checklist

### 1. RLS / Tenant isolation

**CLEAR — RLS policy survives column renames.** `voice_profiles_isolation` (defined in `migrations/0328_voice_profiles.sql:37-45`) references only `owner_user_id`, `org_scope`, and `organisation_id` in both USING and WITH CHECK clauses. None of the three renamed columns appear. The migration contains no `DROP POLICY` statement.

**CLEAR — FORCE RLS preserved.** Migration 0360 does not issue `NO FORCE ROW LEVEL SECURITY`.

**CLEAR — No `req.user.organisationId` reads introduced.** All service-layer code passes `ctx.organisationId` from `req.orgId`.

**LIKELY — Missing `organisationId` predicate on three state-flip UPDATEs inside `deriveProfile`.**
`server/services/voiceProfile/voiceProfileService.ts:88-91`, `:99-102`, `:112-121` — these three UPDATE calls (error-path, empty-samples-path, success-path) filter only on `voiceProfiles.id`. The initial claim UPDATE at lines 29-39 correctly includes `eq(voiceProfiles.organisationId, ctx.organisationId)`, but the three follow-on updates do not.

Attack scenario: The initial claim is org-scoped (prevents cross-org claim). UUIDs are unguessable. However, the defense-in-depth gap is real: the three follow-on UPDATEs should include the org predicate, consistent with the initial claim and with `optOut`/`reactivate` (lines 208-213, 221-228).

Note: the bare-`db` pattern across all functions in `voiceProfileService.ts` (10 call sites) is pre-existing and is fully baselined in `scripts/.gate-baselines/with-org-tx-or-scoped-db.txt:4105-4123` with expiry 2026-08-13. This batch did not introduce those baseline entries.

→ Routed to `tasks/todo.md` as **PA-CLEANUP-DEF-1**.

### 2. Auth & permissions

**CLEAR — All routes gated correctly.** `server/routes/voiceProfiles.ts`: all five routes use `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.VOICE_PROFILE_READ)` or `VOICE_PROFILE_WRITE`. No new routes added by this batch.

**CLEAR — No webhook handlers in this diff.**

**CLEAR — No `:subaccountId` route params introduced.**

### 3. Race conditions

**CLEAR — Claim-then-work pattern preserved.** `deriveProfile` uses an atomic UPDATE with `inArray(voiceProfiles.state, ['pending', 'ready', 'failed'])` as a state predicate. Zero rows returned → 409 DERIVATION_IN_PROGRESS.

**CLEAR — Nightly job concurrency.** `voiceProfileRefreshJob.ts` scans candidates in an admin connection, then processes one at a time. Per-row try/catch with continue means one failure does not block others.

### 4. Injection

**CLEAR — No raw SQL string concatenation.** All SQL uses Drizzle ORM prepared expressions. Migration uses `ALTER TABLE ... RENAME COLUMN` (DDL only).

**CLEAR — No new prompt-injection surface.** `assembleVoiceBlock` (`agentExecutionServicePure.ts:570-575`) injects `profileJson` into an XML block; `profileJson` is platform-controlled derivation output.

**CLEAR — `sourceConfig` / `refreshConfig` are jsonb OPAQUE.** No SQL constructed from their contents in this diff.

### 5. Resource abuse

**CLEAR — No new unbounded loops.** `voiceProfileRefreshJob.ts` iterates over a bounded candidate set.

**CLEAR — No new LLM calls or queue payloads.**

### 6. Cross-tenant data leakage

**CLEAR — No shared caches involving voice profile data.**

**CLEAR — No log lines leaking cross-tenant identifiers.**

**WORTH_CONFIRMING — `operatorSessionInitialContextBundler.ts:80-90` voice profile read missing `organisationId` predicate.** The voice profile SELECT filters on `ownerUserId`, `state = 'ready'`, and `optOutAt IS NULL`, but not on `organisationId`. The query runs via `getOrgScopedDb()` so the Postgres session variable IS set and the RLS USING clause provides enforcement. Defense-in-depth gap per DEVELOPMENT_GUIDELINES.md §1.

→ Routed to `tasks/todo.md` as **PA-CLEANUP-DEF-2**.

---

## STRIDE sweep

### Spoofing
No new routes or auth flows in this diff.

### Tampering
The three state-flip UPDATEs without `organisationId` predicate — cross-referenced from RLS §1 above (PA-CLEANUP-DEF-1).

### Repudiation
**WORTH_CONFIRMING — nightly refresh job emits no durable audit trail per profile.** Log lines are not an audit record. Acceptable for V1 (system-initiated background action). Future compliance requirements may demand a per-refresh audit trail.

→ Routed to `tasks/todo.md` as **PA-CLEANUP-DEF-3**.

### Information disclosure
`operatorSessionInitialContextBundler.ts` voice-profile read — cross-referenced from §6 (PA-CLEANUP-DEF-2).

### Denial of service
No unbounded loops, no new queue payloads, no recursive handoff paths.

### Elevation of privilege
No `withAdminConnection` used where `getOrgScopedDb` is required.

---

## Migration safety assessment

| Check | Result |
|---|---|
| Column rename order: drop index → rename → add → recreate index | PASS |
| `IF EXISTS` on index drop | PASS |
| `IF NOT EXISTS` on index create and column adds | PASS |
| RLS policy references renamed columns | PASS — none |
| DOWN migration reversal correctness | PASS — data-loss warning present |
| `NOT NULL DEFAULT '{}'` on new jsonb columns | PASS |
| Migration number unique | PASS |
| Drizzle schema / migration alignment | PASS |

---

## Gate baseline coordinate check

All 10 `voiceProfileService.ts` baseline entries in `with-org-tx-or-scoped-db.txt` (lines 4105-4123) confirmed still pointing at correct source lines after rename edits. All 3 `operatorSessionInitialContextBundler.ts` entries (lines 2031-2035) confirmed.

---

## Additional observations

- `sampleSize: 0` hardcoded at `voiceProfileService.ts:118` is intentional per R5 privacy comment. Routed separately as PA-CLEANUP-DEF-4 (pr-reviewer STRONG_RECOMMENDATION).
- `shouldRefresh` JSDoc at `voiceProfileServicePure.ts:128` still uses phrase "last_refreshed_at" — documentation text, not code reference. Routed as PA-CLEANUP-DEF-5.

---

**Verdict:** HOLES_FOUND (0 confirmed, 1 likely, 2 worth-confirming). All advisory-level findings routed to `tasks/todo.md`. Non-blocking.
