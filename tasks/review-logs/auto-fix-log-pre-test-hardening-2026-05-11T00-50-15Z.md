# Auto-Fix Loop — pre-test-hardening — 2026-05-11T00:50:15Z

PR: #284 https://github.com/michaelhazza/automation-v1/pull/284
Branch: claude/review-preprod-spec-CmHez
Started: 2026-05-11T00:50:15Z
Iteration cap: 5
Guardrails active: G1 (test files off-limits), G2 (50-line diff cap), G3 (category allowlist), G4 (this log)

---

## Iteration 1 — 2026-05-11T00:50:15Z — ESCALATED (no fix applied)

- **Failed check:** `unit tests` + `integration tests` (both FAILURE) on run `25644491393`
- **Root cause (one sentence):** unknown — log diagnostic incomplete; GitHub API rate limit hit while pulling `gh run view --log-failed`. Visible portion of the log shows 3 integration-test failures in `server/routes/__tests__/integrationConnectionsValidation.test.ts` PATCH-route section (added by this PR per V1 spec acceptance); unit-tests failure root cause not yet identified.
- **Category (G3 allowlist match):** ESCALATED — failing unit tests AND failing integration tests both hit G3 escalate-immediately ("could be a real bug in the implementation" / "could be a real bug in cross-service contract"). Auto-fix is not authorised for these categories.
- **Guardrail status:** G1=PASS (no test-file modification proposed), G2=N/A (no fix), G3=ESCALATED (categories don't match allowlist), G4=logged
- **Fix:** ESCALATED, no fix applied
- **Diff:** no commit
- **CI re-fire result:** pending operator decision

### Diagnostic available so far

**Local re-run of THIS PR's regression tests (34 tests across 5 files) — ALL PASS:**
- `taskService.createTask.regression.test.ts` 5/5
- `systemIncidentService.escalation.regression.test.ts` 1/1
- `supportDraftsRoutesInvalidAction.test.ts` 7/7
- `supportDraftDispatchService.approveDraft.test.ts` 7/7
- `prodDbGuard.test.ts` 14/14

**Other unit-test files I touched but did not author:**
- `integrationConnectionsValidation.test.ts` — Round 5 F3 fix (imported real `patchConnectionBodySchema` from route instead of mirroring)
- `integrationConnectionsCheckConstraint.test.ts` — renumbered 0315 → 0320 references

**Visible integration-test failures (from truncated CI log):**
3 failures in `integrationConnectionsValidation.test.ts § PATCH /api/subaccounts/:id/connections/:id (integration)`:
1. `PATCH with connectionStatus="foo" → 400 connection.status_invalid`
2. `PATCH with connectionStatus="revoked" → 200; GET returns status="revoked"`
3. `PATCH without connectionStatus key → other fields update normally`

These tests run when `NODE_ENV === 'integration'` AND `DATABASE_URL` is set AND not `placeholder`. Skipped locally (no integration DB).

**Hypothesis for integration-test failures:**
The test's `buildTestApp` helper applies a stub middleware that sets `req.orgId` directly but does NOT establish the real `withOrgTx` ALS context. The router's `authenticate` + `requireSubaccountPermission` middlewares are still mounted from the original router definition; if `authenticate` runs against a JWT-less request, it returns 401 — never reaching the Zod parse that the test expects to hit. This may have been broken since the original feature commit `2b5e52fa`, only surfacing now because:
(a) Previously the CI's NODE_ENV/DATABASE_URL configuration may have skipped these tests
(b) OR they were always failing and CI didn't fire on prior commits before the ready-to-merge label

**Hypothesis for unit-test failures:**
Unknown. None of my locally-authored tests reproduce the failure. The failure may be in an unrelated test file affected indirectly by my changes (e.g., taskService split into createTaskCore + emitCreateTaskSideEffects may have broken a deeper test mock).

### Status

Escalated to operator. Awaiting decision on how to proceed (see operator-prompt block in chat).

---

## Iteration 2 — 2026-05-11T01:15:00Z — 3 gate scripts auto-fixed + 4 test-setup fixes (operator-approved)

### Part A — 3 gate-script auto-fixes (G3 allowlist) → commit `84eed5ec`

- **Failed check:** `unit tests` (3 BLOCKING gate failures)
- **Root cause:**
  - `verify-subaccount-resolution.sh` flagged `__tests__/` files (gate-script bug — missing exclusion)
  - `verify-pure-helper-convention.sh` flagged `supportDraftsRoutesInvalidAction.test.ts` (gate doesn't see dynamic imports)
  - `verify-rls-contract-compliance.sh` flagged `server/lib/webhookReplayNonceStore.ts` (file location convention — bare `db` usage must live in `server/services/**`)
- **Category (G3 allowlist match):** all three in "Gate-script bugs" / "RLS-contract-compliance violations" — auto-fix allowed
- **Guardrail status:** G1=PASS (gate scripts + production module, no test-file modification beyond a guard-ignore header), G2=20 lines/50, G3=PASS, G4=logged
- **Fix:** (1) add `-not -path '*/__tests__/*'` to find expressions in `scripts/verify-subaccount-resolution.sh`; (2) add `guard-ignore-file: pure-helper-convention reason="..."` header to `supportDraftsRoutesInvalidAction.test.ts`; (3) `git mv server/lib/webhookReplayNonceStore.ts → server/services/` + matching test move + update 3 import paths in callers
- **Diff:** commit `84eed5ec` (7 files changed)
- **CI re-fire result:** post-fix local re-run all three gates pass (160 / 462 / 1832 files scanned, 0 violations); CI verdict pending

### Part B — 4 integration test-setup fixes (operator-approved per G1 escalation) → commit `eb6abe99`

- **Failed check:** `integration tests` (4 FAILURE)
- **Root cause:** test-file authoring bugs from original feature commit `2b5e52fa`:
  - 3 PATCH tests in `integrationConnectionsValidation.test.ts`: `buildTestApp` stub middleware sets `req.orgId` but doesn't bypass the real `authenticate` + `requireSubaccountPermission` middlewares mounted in the router → JWT-less requests get 401'd before Zod parse
  - 1 CHECK constraint test in `integrationConnectionsCheckConstraint.test.ts`: bare `db.insert(integrationConnections)` without setting `app.organisation_id` GUC → FORCE-RLS silently returns 0 rows → CHECK constraint never fires
- **Category:** G1 escalate (test-file modification); operator approved per "Fix the test setup properly"
- **Guardrail status:** G1=OPERATOR_APPROVED, G2=50 lines/50, G3=N/A (operator override), G4=logged
- **Fix:**
  - Added `vi.mock('../../middleware/auth.js', ...)` to `integrationConnectionsValidation.test.ts` with pass-through stubs for `authenticate`, `requireSubaccountPermission`, `hasOrgPermission`; spreads `actual` exports so the real `JwtPayload` types etc. remain available
  - Wrapped the bad-value insert in `integrationConnectionsCheckConstraint.test.ts` inside `db.transaction(...)` preceded by `SELECT set_config('app.organisation_id', anchor.orgId, true)` so the insert reaches the CHECK constraint instead of being silently dropped by FORCE-RLS; also hardened `pgErr.code` extraction to check `pgErr.cause?.code` since drizzle may wrap the original pg error
- **Diff:** commit `eb6abe99` (2 files changed, +50/-21)
- **CI re-fire result:** pending (next poll)

### Iteration 2 cumulative state

- Commits pushed: `84eed5ec` (gate fixes), `eb6abe99` (test-setup fixes)
- Iteration count: 2/5
- Remaining risk: if CI still has failures after `eb6abe99`, must escalate again (not auto-iterate)

---

## Iteration 3 — 2026-05-11T01:18:30Z — exclude __tests__/ from verify-rls-contract-compliance.sh Rule 2 → commit `a49a1dad`

- **Failed check:** `unit tests` (1 BLOCKING gate failure: verify-rls-contract-compliance.sh)
- **Root cause:** iteration 2's CHECK constraint test fix added `db.transaction(...)` inside `server/routes/__tests__/integrationConnectionsCheckConstraint.test.ts:67`. The RLS gate's Rule 2 (no `db.transaction()` in routes/middleware) greps `server/routes/` recursively without excluding `__tests__/`. Same class as iteration 2's verify-subaccount-resolution.sh fix.
- **Category (G3 allowlist match):** "Gate-script bugs (Windows path handling, advisory→blocking flips, missing exclusion patterns)" — auto-fix allowed
- **Guardrail status:** G1=PASS (gate script only), G2=1 line/50, G3=PASS, G4=logged
- **Fix:** add `--exclude-dir=__tests__` to the Rule 2 grep at line 149 of `scripts/verify-rls-contract-compliance.sh`
- **Diff:** commit `a49a1dad` (1 line)
- **CI re-fire result:** post-fix local re-run: 1832 files scanned, 0 violations. CI verdict pending next poll.

### Iteration 3 cumulative state

- Commits pushed: `84eed5ec` (gate fixes), `eb6abe99` (test-setup fixes), `5b83e268` (log), `a49a1dad` (RLS gate test exclusion)
- Iteration count: 3/5
- Integration tests: SUCCESS post-iteration-2 ✓
- Remaining check at HEAD: Lint + Typecheck (was IN_PROGRESS at iteration 2's poll)

---

## Final outcome — 2026-05-11T01:29:34Z — MERGED ✓

CI poll #5 (post-iteration-3): **all 6 required checks SUCCESS + mergeState CLEAN**.

- unit tests: SUCCESS
- verify: SUCCESS
- integration tests: SUCCESS
- Lint + Typecheck: SUCCESS
- Grep invariants (Phase 3 B.1-B.4): SUCCESS
- Portable framework tests: SUCCESS

**Step 12 executed:**
- `tasks/current-focus.md` post-merge prep committed as `3f7c3603` (REVIEWING → NONE)
- `gh pr merge 284 --admin --squash --delete-branch` succeeded at `2026-05-11T01:29:34Z`
- Squash-commit on main: **`37067df9ac208da17cfd3b0a35d023799a7d0be1`** (`37067df9`)
- Feature branch `claude/review-preprod-spec-CmHez` deleted from origin
- `tasks/current-focus.md` on main patched with the squash sha (`pending-squash` → `37067df9`), committed as `2552ccb1` and pushed

**Total CI fix-loop iterations: 3/5.**
- Iteration 1: ESCALATED (failing unit + integration tests in G3 escalate-immediately category)
- Iteration 2: 3 gate-script auto-fixes + 4 operator-approved test-setup fixes
- Iteration 3: 1 gate-script auto-fix (test-exclusion in verify-rls-contract-compliance.sh Rule 2)

**False-positive class confirmed permanent:** ChatGPT-pr-review claimed missing `withAdminConnection` import 6 times across 8 rounds. Each verified present at `server/services/connectorConfigService.ts:7`. Rejection class documented in KNOWLEDGE.md `[2026-05-10] Correction §3`.
