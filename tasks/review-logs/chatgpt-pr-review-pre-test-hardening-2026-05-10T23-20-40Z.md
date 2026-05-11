# ChatGPT PR Review — pre-test-hardening

## Session Info

- **Branch:** `claude/review-preprod-spec-CmHez`
- **Build slug:** `pre-test-hardening`
- **PR:** https://github.com/michaelhazza/automation-v1/pull/284
- **Mode:** manual
- **Started:** 2026-05-10T23:20:40Z
- **Coordinator:** main-session (chatgpt-pr-review playbook run inline; `chatgpt-pr-review` is not a registered sub-agent in this repo's Agent fleet, so the workflow runs directly in this session per the agent file's contract)
- **Prior agent verdicts (already closed before chatgpt-pr-review):**
  - spec-conformance: CONFORMANT_AFTER_FIXES
  - pr-reviewer: APPROVED after 2 rounds (3 Blockers in Round 1 fixed `3423a0d5`; 1 Blocker B1.x + 3 Strong fixed `930d385e`)
  - dual-reviewer Codex: APPROVED (4 iterations; 1 accepted fix `bde109c9` auto-generate `webhook_token` on Teamwork connector create; 2 rejected with spec citation)
  - adversarial-reviewer: HOLES_FOUND — PTH-ADV-1 LIKELY-HOLE closed in `930d385e`; 3 WORTH-CONFIRMING routed to backlog as PTH-ADV-2/3/4

## Round 1

**Diff files generated:**

- **Recommended (code-only):** `.chatgpt-diffs/pr284-round1-code-diff.diff` — 324K, 75 files
- **Full:** `.chatgpt-diffs/pr284-round1-diff.diff` — 1.6M, 90 files

(The full diff includes the S2 merge bringing in PR #281 + PR #283 — those changes are NOT part of this PR's review scope; they're already reviewed and merged. The code-only diff excludes spec/plan/log/KNOWLEDGE files already reviewed by other agents.)

**Status:** Awaiting operator's paste of ChatGPT's Round 1 response.

---

## Decisions log

### Round 1 — 2026-05-10T23:20:40Z

**ChatGPT verdict:** CHANGES_REQUESTED

| # | Finding | Severity | Category | finding_type | Triage | Recommendation | Decision |
|---|---|---|---|---|---|---|---|
| F1 | `connectorConfigService.ts` likely fails typecheck: missing imports for `withAdminConnection` and `ConnectorType` | high (claimed blocker) | typecheck | scope | technical | **reject** | auto (reject) — false positive. ChatGPT only saw the `findByWebhookToken` diff hunk; imports/types already exist in the file: `withAdminConnection` imported at line 7, `ConnectorType` defined locally at line 46 (`type ConnectorType = ConnectorInsert['connectorType']`). Local `npx tsc --noEmit -p server/tsconfig.json` PASSED post-merge and again post-R1-fix. |
| F2 | `scheduledTaskService.fireOccurrence` (line 648) + `deliveryService.deliver` (line 241) call `getOrgScopedDb()` directly without a local `withOrgTx` wrapper; risks runtime failure on non-HTTP code paths | high (claimed blocker) | tenant-isolation | architecture | technical (scope_signal: architectural) | **defer** | **ESCALATE to operator** — carveouts fire: `recommendation=defer` AND `scope_signal=architectural`. Dual-reviewer already deep-dived this same class of concern across 4 iterations (specifically the `enqueueRunNow→setImmediate` path) and concluded it's pre-existing breakage on `main` requiring its own spec item, not a fix in this PR. ChatGPT generalises the concern to all non-HTTP service callers but the dual-reviewer's same conclusion applies: scope is wider than this build. |
| R1 | `runWebhookReplayNoncePrune()` catches errors and returns `{ status: 'failed' }` instead of throwing; pg-boss worker treats job as complete despite failure, masking persistent DB/RLS issues | low | observability | error_handling | technical | **implement** | auto (implement) — 2-line fix applied: rethrow `err` after logging inside the catch block. The worker registration in `queueService.ts` already has a try/catch that rethrows to pg-boss, so the throw propagates correctly. The job's `SOURCE` retry classification explicitly says "safe — pg-boss retry is acceptable". |

**Auto-applied:** R1 (1 finding).
**Auto-rejected:** F1 (1 finding).
**Escalated → operator decision:** F2 — operator chose **APPLY NOW (wrap both services in conditional withOrgTx via `peekOrgTxContext()`)**, not the recommended defer.

**F2 implementation:**
- `server/services/scheduledTaskService.ts:610-712 fireOccurrence` — at the task-creation site (formerly line 648), replaced the direct `getOrgScopedDb()` call with a `peekOrgTxContext()` conditional: if ALS context is present, reuse the existing tx via `getOrgScopedDb()`; otherwise open `db.transaction(async (innerTx) => { SELECT set_config(...); return taskService.createTask(input, innerTx); })`. Added `sql` to drizzle import + `peekOrgTxContext` to orgScopedDb import.
- `server/services/deliveryService.ts:230-260 deliver` — same conditional pattern at the inbox-write site (formerly line 241). Added `sql` to drizzle import + `peekOrgTxContext` to orgScopedDb import.
- Comment at both call sites cites the PTH-CGT-F2 origin tag so future readers see the audit chain.

**Verification after F2 fix:** server typecheck CLEAN (0 errors); lint CLEAN (0 errors, 899 warnings pre-existing); all 13 regression tests in this build pass (`taskService.createTask.regression`, `systemIncidentService.escalation.regression`, `supportDraftsRoutesInvalidAction`).

**Round 1 verdict:** all findings resolved (F1 rejected as false positive; R1 auto-applied; F2 applied per operator decision). CHANGES_REQUESTED → APPROVED.

### Round 2 — 2026-05-10T23:40:00Z (post Round 1 commit `7a0efd71`)

**ChatGPT verdict:** CHANGES_REQUESTED

| # | Finding | Severity | Category | finding_type | Triage | Recommendation | Decision |
|---|---|---|---|---|---|---|---|
| F1 | `knowledgeService.overrideEntry()` lost explicit transaction boundary — `pg_advisory_xact_lock` only protects work inside the same transaction; if `getOrgScopedDb()` returns a non-transaction handle, the lock releases at statement end before the read+insert | high (claimed blocker) | tenant-isolation / correctness | architecture | technical (scope_signal: architectural) | **implement** | auto (implement) — applied conditional `peekOrgTxContext()` pattern. If ALS context exists, use existing tx via `getOrgScopedDb` (current behaviour); otherwise open own `db.transaction` + set `app.organisation_id` GUC + delegate. Extracted body into `runOverrideInTx(tx, opts, canonical, bodyHash)` helper. Lock + read + version insert + memory-block update now all execute on the same real transaction handle in both branches. Verified: `npx tsc --noEmit -p server/tsconfig.json` 0 errors. **Note on claim accuracy:** ChatGPT's specific premise ("`getOrgScopedDb()` may return a request-scoped DB handle that is not an explicit transaction") is false in this codebase — `getOrgScopedDb()` only returns `ctx.tx` from ALS, which is always a real `db.transaction()` opened by the auth middleware (line 148). But the conditional defence-in-depth wrapper aligns with the Round 1 F2 pattern and protects against any future non-HTTP caller. |
| F2 | Several new tests have wrong `vi.mock` paths that don't match production import paths; tests give false confidence | high (claimed blocker) | test-coverage | test_coverage | technical | **implement** | auto (implement) — fixed two test files: (a) `supportDraftsRoutesInvalidAction.test.ts` — corrected `../../../services/support/supportDraftDispatchService.js` (wrong) → `../../../services/supportDraftDispatchService.js` (right); (b) `supportDraftDispatchService.approveDraft.test.ts` — removed two dead `orgScopedDb.js` mocks at non-existent paths (`../orgScopedDb.js`, `../lib/orgScopedDb.js`), kept the correct `../../lib/orgScopedDb.js`; corrected two adapter mocks from `../adapters/*` (wrong — would resolve under server/services/adapters/) to `../../adapters/*` (right — resolves under server/adapters/). Comments added at each fix citing PTH-CGT-F2 Round 2 origin. All 7 + 7 + 5 + 1 = 20 tests still pass post-fix. |
| R1 | `connectorConfigs.webhookToken` comment references migration 0314 but actual file is 0319 (post-S2 renumber) | low | doc-rot | naming | technical | **implement** | auto (implement) — updated comment in `server/db/schema/connectorConfigs.ts:38` to "migration 0319 — renumbered from 0314 post-S2 to clear collision with PR #283". |
| R2 | `taskService.createTask` emits websocket/trigger/orchestrator side effects BEFORE the surrounding transaction commits; if the outer transaction rolls back, observers may have already seen task-created events for a row that was rolled back | medium | observability / transaction-correctness | architecture | technical (scope_signal: architectural) | **defer** | **deferred to backlog as PTH-CGT-R2**. ChatGPT's own recommendation: "Defer this if the current codebase has no afterCommit primitive yet, but document it as a known limitation." This codebase has no generic afterCommit primitive; adding one is architectural scope-out. The concern is also pre-existing — these side effects were inline in `taskService.createTask` before pre-test-hardening landed. Logged in `tasks/todo.md` with origin tag `PTH-CGT-R2`. |

**Auto-applied:** F1, F2, R1 (3 findings).
**Deferred to backlog:** R2 (1 finding) — `PTH-CGT-R2` in `tasks/todo.md`.

**Verification after Round 2 fixes (commit pending):** server typecheck CLEAN (0 errors); all 20 affected regression tests pass (taskService.createTask 5/5, systemIncidentService.escalation 1/1, supportDraftsRoutesInvalidAction 7/7, supportDraftDispatchService.approveDraft 7/7).

**Round 2 verdict:** CHANGES_REQUESTED → APPROVED with 1 deferred (PTH-CGT-R2).

### Round 3 — 2026-05-10T23:55:00Z (post Round 2 commit `48333766`)

**ChatGPT verdict:** CHANGES_REQUESTED

| # | Finding | Severity | Category | finding_type | Triage | Recommendation | Decision |
|---|---|---|---|---|---|---|---|
| F1 | `connectorConfigService.ts` uses `withAdminConnection` but does not import it | high (claimed blocker) | typecheck | scope | technical | **reject** | auto (reject) — **duplicate false positive of Round 1 F1**. `withAdminConnection` imported at line 7 of `server/services/connectorConfigService.ts`; verified again. Local typecheck PASSED in all 3 rounds. ChatGPT only sees the diff hunk for the new method and misreads its import context. |
| F2 | `knowledgeService.overrideEntry` uses `peekOrgTxContext() !== undefined` but mocks return `null`; tests would take wrong branch | high (claimed blocker) | tenant-isolation / test-mock-interaction | error_handling | technical | **implement** | auto (implement) — switched to truthy check (`const existingCtx = peekOrgTxContext(); return existingCtx ? ... : ...`) for consistency with `deliveryService.deliver` and `scheduledTaskService.fireOccurrence`. The truthy check treats both `null` (mock) and `undefined` (production no-ctx) as "no ctx", correctly routing to the `db.transaction` fallback in both. Added comment citing PTH-CGT-R3-F2 origin. |
| F3 | `webhookReplayNonces.ts` Drizzle schema declares `.references(() => organisations.id)` but migration 0318 does not create the FK — schema/migration drift | high (claimed blocker) | schema | naming | technical | **implement** | auto (implement) — added `REFERENCES organisations(id) ON DELETE CASCADE` to migration `0318_webhook_replay_nonces.sql:2`. CASCADE matches the table's lifecycle (per-org durable dedupe state; deleted with the org). Pre-launch posture: migration has not been applied in any production environment, so modifying the file in place rather than authoring a follow-up alter migration is safe and idempotent for CI re-runs against a clean DB. |
| R1 | `connectorConfigService.ts:145` comment references migration 0314 but actual file is 0319 (post-S2 rename) | low | doc-rot | naming | technical | **implement** | auto (implement) — updated to "Migration 0319 backfills existing rows (renumbered from 0314 post-S2 to clear collision with PR #283)". |
| R2 | `supportRouteScoping.test.ts` 404 section creates a minimal Express app with no support routes and asserts 404 — proves Express default 404 behaviour, not production legacy-mount removal. Structural assertions above do the real work | low | test-quality | test_coverage | technical | **defer** | **deferred to backlog as PTH-CGT-R3-R2**. Non-blocking; the structural source-grep assertions in the same test (lines 36-54) already verify production removed the legacy mount. The 404 section is redundant but not misleading enough to block merge on. Logged in `tasks/todo.md` with rewrite suggestion (mount the production router and exercise the actual unsmounted paths). |
| R3 | `webhookReplayNoncePruneJob.ts:36` uses `crypto.randomUUID()` without explicit import — works via global but inconsistent with codebase convention | low | imports / consistency | scope | technical | **implement** | auto (implement) — added `import { randomUUID } from 'crypto';` at the top of the file and changed call site to `randomUUID()`. Matches the convention used in `connectorConfigService.ts` and other files in the repo. |

**Auto-applied:** F2, F3, R1, R3 (4 findings).
**Auto-rejected:** F1 (1 finding — duplicate false positive).
**Deferred to backlog:** R2 (1 finding) — `PTH-CGT-R3-R2` in `tasks/todo.md`.

**Verification after Round 3 fixes (commit pending):** server typecheck CLEAN (0 errors); all 20 regression tests pass (taskService.createTask 5/5, systemIncidentService.escalation 1/1, supportDraftsRoutesInvalidAction 7/7, supportDraftDispatchService.approveDraft 7/7).

**Round 3 verdict:** CHANGES_REQUESTED → APPROVED with 1 deferred (PTH-CGT-R3-R2).

### Round 4 — 2026-05-11T00:00:00Z (post Round 3 commit `15f03f63`)

**ChatGPT verdict:** CHANGES_REQUESTED

| # | Finding | Severity | Category | finding_type | Triage | Recommendation | Decision |
|---|---|---|---|---|---|---|---|
| F1 | `connectorConfigService.ts` missing `withAdminConnection` import | high (claimed blocker) | typecheck | scope | technical | **reject** | auto (reject) — **third duplicate false positive** (also raised Round 1 F1, Round 3 F1). Import IS at line 7 of `server/services/connectorConfigService.ts`. Verified each round; typecheck PASSED in all four rounds. Per KNOWLEDGE.md `[2026-05-10] Correction — apply DiD patterns consistently...` §3, auto-rejecting duplicates without further investigation. |
| F2 | Drizzle schema `.references()` does NOT encode `ON DELETE CASCADE`; migration does. Round 3 fix incomplete. | high (claimed blocker) | schema | naming | technical | **implement** | auto (implement) — added `{ onDelete: 'cascade' }` to the Drizzle `.references()` declaration in `server/db/schema/webhookReplayNonces.ts:7`. Now both sides agree: SQL = `REFERENCES organisations(id) ON DELETE CASCADE`, TS = `.references(() => organisations.id, { onDelete: 'cascade' })`. This is the exact class of bug KNOWLEDGE.md `[2026-05-10] Correction §2` warned against — and I committed it the very next round. Lesson reinforced. |
| F3 | Migration uses unnamed `CREATE INDEX` (Postgres auto-names) but schema declares explicit name `webhook_replay_nonces_org_source_seen_at_idx`; introspection drift | medium (claimed blocker) | schema | naming | technical | **implement** | auto (implement) — added explicit index name to migration 0318: `CREATE INDEX webhook_replay_nonces_org_source_seen_at_idx ON webhook_replay_nonces (...)`. Both sides now agree on the index name. |
| T1 | `SET LOCAL ROLE admin_role` requires a real transaction context; verify `withAdminConnection` wraps callback in one | low | observability / safety-comment | other | technical | **implement (comment)** | auto (implement) — added explanatory comments at both `SET LOCAL ROLE` call sites (`server/jobs/webhookReplayNoncePruneJob.ts:46` and `server/services/connectorConfigService.ts:277`) citing `server/lib/adminDbConnection.ts:82` where `withAdminConnection` wraps the callback in `db.transaction(async (tx) => ...)`. Confirmed: `SET LOCAL ROLE` is transaction-scoped and correctly resets on commit/rollback. |
| T2 | Support legacy route 404 test mostly structural, not full app coverage | low | test-quality | test_coverage | technical | **defer** | already deferred from Round 3 as `PTH-CGT-R3-R2`. ChatGPT acknowledged this. No additional action. |

**Auto-applied:** F2, F3, T1 (3 findings).
**Auto-rejected:** F1 (1 finding — third duplicate false positive).
**Deferred to backlog (no change):** T2 (already deferred as PTH-CGT-R3-R2).

**Verification after Round 4 fixes (commit pending):** server typecheck CLEAN (0 errors); all 20 regression tests pass.

**Round 4 verdict:** CHANGES_REQUESTED → APPROVED.

### Round 5 — 2026-05-11T00:15:00Z (post Round 4 commit `d108fd42`)

**ChatGPT verdict:** CHANGES_REQUESTED

| # | Finding | Severity | Category | finding_type | Triage | Recommendation | Decision |
|---|---|---|---|---|---|---|---|
| F1 | `taskService.createTask(input, tx)` performs side effects (websocket emit, trigger fire, orchestrator enqueue) inline; if outer caller's tx rolls back, observers see phantom task-created events | high (claimed blocker) | observability / transaction-correctness | architecture | technical (scope_signal: architectural) | **defer** | **ESCALATED to operator — operator chose APPLY NOW.** Same concern as Round 2 R2 (deferred to PTH-CGT-R2). Refactor split: extracted `_createTaskCore(input, tx)` (DB writes only) + `emitCreateTaskSideEffects(item, input)` (websocket + triggers + orchestrator). Public `createTask` wraps both for backwards compat. Updated 5 cited call sites: systemIncidentService.escalateIncidentToAgent (after-commit emit), deliveryService.deliver (dual-branch: ALS inline, fallback after-commit), scheduledTaskService.fireOccurrence (same dual-branch), githubWebhook issue-opened (after-commit), githubWebhook issue-comment (after-commit). Updated systemIncidentService regression test to mock createTaskCore + emitCreateTaskSideEffects alongside createTask. Closes PTH-CGT-R2 from the backlog. |
| F2 | `connector_configs.webhook_token` Drizzle schema doesn't declare the partial unique index that migration 0319 creates | low | schema | naming | technical | **comment** | auto (comment) — verified the existing convention: lines 43-44 of `connectorConfigs.ts` explicitly document "two partial unique indexes (CRM-scoped + workspace-scoped) expressed in SQL only." The new webhook_token partial UNIQUE follows the same pattern. Added an explanatory comment at the column declaration citing this. No declaration change — would deviate from the local convention. |
| F3 | `integrationConnectionsValidation.test.ts` mirrors the route's Zod schema instead of importing it | medium | test-quality | test_coverage | technical | **implement** | auto (implement) — exported `patchConnectionBodySchema` from `server/routes/integrationConnections.ts`; updated the test to import it. Removed the unused `import { z } from 'zod'` from the test. All 13 tests (10 pure + 3 skipped integration) still pass. |
| F4 | `docs/runbooks/migration-0240-phased-swap.md:120` rollback wording contradicts itself ("Both constraints should still be present" — but on rollback the new constraint shouldn't be promoted) | low | doc | other | technical | **implement** | auto (implement) — rewrote the paragraph: "The old constraint should still be present, and the new constraint should NOT be promoted (the transaction rolled back before COMMIT). The concurrently built index from Step 2 may still exist and can be reused or dropped before retrying Step 3." |

**Auto-applied:** F2 (comment only), F3, F4 (3 findings).
**Operator-approved + applied:** F1 (1 finding — architectural refactor across 5 call sites + 2 test files).

**Verification after Round 5 fixes (commit pending):** server typecheck CLEAN (0 errors); all 30 regression tests pass + 3 skipped (DB-dependent integration tests).

**Round 5 verdict:** CHANGES_REQUESTED → APPROVED.

### Round 6 — 2026-05-11T00:25:00Z (post Round 5 commit `91ed6c8c`)

**ChatGPT verdict:** CHANGES_REQUESTED

| # | Finding | Severity | Category | finding_type | Triage | Recommendation | Decision |
|---|---|---|---|---|---|---|---|
| F1 | `connectorConfigService.ts` missing `withAdminConnection` import + `systemIncidentService.ts` missing `sql` import | high (claimed blocker) | typecheck | scope | technical | **reject** | auto (reject) — **fourth duplicate false positive** (Rounds 1, 3, 4, 6). Both imports verified present: `withAdminConnection` at `connectorConfigService.ts:7`; `sql` at `systemIncidentService.ts:3`. Typecheck PASSED across all 6 rounds. |
| F2 | Legacy 4-arg `createTask` shim still emits side effects pre-commit (calls `_createTask` recursively which fires emit inline) | high (claimed blocker) | observability / transaction-correctness | error_handling | technical | **implement** | auto (implement) — restructured the legacy shim: extract `input`, open `db.transaction(...)` containing only `_createTaskCore(input, innerTx)`, capture the returned item, then call `emitCreateTaskSideEffects(item, input)` AFTER the transaction returns. Side effects now fire post-commit on the legacy path too. |
| F3 | Public `createTask(input, tx)` still emits side effects inline; HTTP routes + skillExecutor + onboarding callers using `getOrgScopedDb()` get pre-commit emit if their wrapping tx rolls back | high (claimed blocker) | observability / transaction-correctness | architecture | technical (scope_signal: architectural) | **defer** | **ESCALATED to operator — operator chose DEFER as PTH-CGT-R6-F3.** PR has materially improved state (5 critical callers + legacy shim now correct). Remaining callers have narrow failure windows (HTTP routes do little between createTask and `res.json`). Pre-existing pattern; spec §0.1 forbids broader refactors. Backlog entry documents 3 fix options for next sprint (migrate all remaining, add afterCommit primitive, deprecate createTask). |
| F4 | `deliveryService.deliver` + `scheduledTaskService.fireOccurrence` ALS-present branches emit inline (same class as F3) | high (claimed blocker) | observability / transaction-correctness | architecture | technical (scope_signal: architectural) | **defer** | Tied to F3 decision — operator chose DEFER for the broader pattern. The fallback (no-ALS) branches in both services already emit post-commit per Round 5 F1. The ALS-present branches retain pre-PR semantics (caller-owns-tx; inline emit). Documented as part of PTH-CGT-R6-F3 backlog entry. |
| F5 | `supportRouteScoping.test.ts` 404 section has weak live-route coverage (already raised in Round 3 R2) | low | test-quality | test_coverage | technical | **no action** | already deferred as `PTH-CGT-R3-R2` in `tasks/todo.md`. No new action this round. |
| F6 | `resolveSubaccount` returns 403 for cross-org subaccount IDs vs 404 for non-existent — status-code enumeration leak | medium | security / defence-in-depth | other | technical | **defer** | spec-level decision. Spec §3.1 acceptance test for T1 explicitly chose 403 for cross-org subaccount IDs. Changing this requires amending the spec. Backlog entry `PTH-CGT-R6-F6` flags for spec review next sprint with two fix options. |

**Auto-applied:** F2 (1 finding).
**Auto-rejected:** F1 (1 finding — fourth duplicate false positive).
**Deferred to backlog:** F3, F4 (operator decision, single backlog entry `PTH-CGT-R6-F3`), F6 (spec-level, backlog entry `PTH-CGT-R6-F6`).
**No action:** F5 (already deferred as PTH-CGT-R3-R2).

**Verification after Round 6 fixes (commit pending):** server typecheck CLEAN (0 errors); taskService.createTask.regression 5/5 pass (the F2 fix preserves all assertions because the test mocks `db.transaction` and asserts the same execute-order contract).

**Round 6 verdict:** CHANGES_REQUESTED → APPROVED with 2 deferred (PTH-CGT-R6-F3, PTH-CGT-R6-F6).

### Round 7 — 2026-05-11T00:35:00Z (post Round 6 commit `1c8571dc`)

**ChatGPT verdict:** CHANGES_REQUESTED

| # | Finding | Severity | Category | finding_type | Triage | Recommendation | Decision |
|---|---|---|---|---|---|---|---|
| F1 | `connectorConfigService.findByWebhookToken` uses `withAdminConnection` without import | high (claimed blocker) | typecheck | scope | technical | **reject** | auto (reject) — **FIFTH duplicate false positive** (Rounds 1, 3, 4, 6, 7). `withAdminConnection` imported at `connectorConfigService.ts:7`. Typecheck PASSED in all 7 rounds. ChatGPT consistently misreads the import context when only viewing the diff hunk. Permanent rejection class per KNOWLEDGE.md `[2026-05-10] Correction §3`. |
| F2 | Migrated `createTask(input, tx)` callers (routes/tasks.ts, routes/workflowRuns.ts, routes/portal.ts, services/skillExecutor.ts, services/workflowRunStartSkillService.ts, services/subaccountOnboardingService.ts) still emit side effects pre-commit because public wrapper calls emit inline | high (claimed blocker) | observability / transaction-correctness | architecture | technical (scope_signal: architectural) | **defer** | **no action — already deferred as PTH-CGT-R6-F3 in Round 6.** Operator explicitly chose defer last round. ChatGPT is re-litigating a closed decision. The backlog entry documents these exact 6 callers and 3 fix options for the next sprint. The migrations to (input, tx) shape were made in the original feature commit `2b5e52fa` — they are not new in Round 7; ChatGPT misread their visibility-in-the-diff as newness. |
| F3 | `documentDataSourceService.verifyScopeIdsBelongToOrg` inserts directly into `auditEvents` instead of routing through `auditService.log` | medium | audit-discipline | other | technical | **implement** | auto (implement) — replaced direct `db.insert(auditEvents)` with `auditService.log({...})`. The service wraps the insert in its own try/catch so audit failure never masks the 403 (preserves prior best-effort contract). Removed `auditEvents` from the schema imports; added `auditService` import. Aligns with the audit-event discipline used elsewhere in the codebase. Comment added citing PTH-CGT-R7-F3 origin. |

**Auto-applied:** F3 (1 finding).
**Auto-rejected:** F1 (1 finding — fifth duplicate false positive).
**No action (re-litigated deferral):** F2 (PTH-CGT-R6-F3 remains the backlog entry).

**Verification after Round 7 fixes (commit pending):** server typecheck CLEAN (0 errors); referenceDocumentScopeVerification.test.ts 7/7 pass (2 skipped — DB-dependent).

**Round 7 verdict:** CHANGES_REQUESTED → APPROVED (F3 closed; F1 rejected; F2 remains operator-deferred).

### Round 8 — 2026-05-11T00:45:00Z (post Round 7 commit `f37dac5c`)

**ChatGPT verdict:** CHANGES_REQUESTED

| # | Finding | Severity | Category | finding_type | Triage | Recommendation | Decision |
|---|---|---|---|---|---|---|---|
| F1 | `assertDevTargetOrThrow` follows spec §6.3 blocklist (only `NODE_ENV=production` throws); `staging`/`test`/`integration`/`undefined` pass silently | high (claimed blocker) | security / defence-in-depth | error_handling | technical | **implement** | **ESCALATED to operator — operator chose APPLY NOW.** Switched primary guard from blocklist to allowlist: `NODE_ENV !== 'development'` throws. Added explicit fail for unset `DATABASE_URL`. Spec deviation documented in `tasks/builds/pre-test-hardening/progress.md` under "Post-spec tightening". Script is operator-only (no CI invocations — verified via grep), so allowlist has no compatibility cost. |
| F2 | `connectorConfigService.findByWebhookToken` uses `withAdminConnection` without import | high (claimed blocker) | typecheck | scope | technical | **reject** | auto (reject) — **SIXTH duplicate false positive** (Rounds 1, 3, 4, 6, 7, 8). Permanent rejection class. |
| F3 | Test coverage tightening — add tests for NODE_ENV=undefined/test/staging/integration | medium | test-coverage | test_coverage | technical | **implement** | auto (implement) — added 5 new tests to `scripts/lib/__tests__/prodDbGuard.test.ts` covering the new allowlist behaviour (NODE_ENV=production/staging/test/integration/undefined → throw) plus the new DATABASE_URL-unset guard. All 14 tests pass (was 9). |

**Auto-applied:** F3 (1 finding).
**Operator-approved + applied:** F1 (1 finding — spec deviation documented in progress.md).
**Auto-rejected:** F2 (1 finding — sixth duplicate false positive).

**Verification after Round 8 fixes (commit pending):** server typecheck CLEAN (0 errors); prodDbGuard tests 14/14 pass.

**Round 8 verdict:** CHANGES_REQUESTED → APPROVED.

**Loop status:** ChatGPT acknowledged at the end of Round 8 that the loop has reached diminishing returns. Recommend closing here unless the operator wants one more round. The next signal-to-noise ratio is poor — 6 consecutive rounds of the same import false positive + Round 5/6/7/8 each producing 1 real finding while progressively re-litigating earlier deferrals.

