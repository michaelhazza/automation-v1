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
