# ChatGPT PR Review Session — claude-integration-tests-fix-2026-04-30 — 2026-04-30T05-02-40Z

## Session Info
- Branch: claude/integration-tests-fix-2026-04-30
- PR: #241 — https://github.com/michaelhazza/automation-v1/pull/241
- Mode: manual
- Started: 2026-04-30T05:02:40Z

---

## Round 1 — Codex inline review

ChatGPT/Codex posted one inline finding on PR #241 (the user pasted a partial dump of the PR Files-changed view; the message was truncated mid-diff after the crmQueryPlanner test, so any further findings beyond the one captured below are not visible in this round).

### Finding R1.1 — P1: Skip superuser CRM-RLS test instead of returning early
- **Source:** Codex inline comment on `server/services/crmQueryPlanner/__tests__/integration.test.ts` line ~152 (`subaccount-A caller …` test body).
- **Verbatim:** "When `runningAsSuperuser` is true this test exits at the first line, so Vitest reports it as passed even though no RLS assertions execute. In this repo's integration workflow the DB user is `postgres` (`.github/workflows/ci.yml`), which is a superuser, so this path masks regressions in tenant isolation while still turning the gate green. Mark the case as skipped (or fail fast in `beforeAll`) rather than returning from the test body."
- **Decision:** ACCEPT.
- **Why:** Codex is right. `if (runningAsSuperuser) return;` makes vitest report PASSED on a contract that did not run — exactly the false-negative trap this repo's testing posture is built to avoid. The same pattern exists in `server/services/__tests__/rls.context-propagation.test.ts` (two test bodies). All four call sites must be reported as SKIPPED, not PASSED.
- **Fix shape:** Convert each test from `() => { if (runningAsSuperuser) return; … }` to `(ctx) => { if (runningAsSuperuser) ctx.skip(); … }`. Vitest 2.x's context `skip()` throws a SkipError that the runner catches and surfaces in the report as SKIPPED (not PASSED). No test runs assertions silently anymore.
- **Files changed:**
  - `server/services/__tests__/rls.context-propagation.test.ts` — two tests: "per-table Layer A + Layer B contracts hold for all RLS-protected tables" and "reference_document_versions: org-scoped context sees own versions, not other org's"
  - `server/services/crmQueryPlanner/__tests__/integration.test.ts` — both subaccount-A / subaccount-B tests
  - Comment headers in both files updated to describe the skip semantics accurately ("reported as SKIPPED" instead of "short-circuited").
- **Verification:** `npx tsc --noEmit` clean. Runtime verification happens in CI on the next push.
- **Considered alternative:** Fail fast in beforeAll (throw if superuser) so the entire suite is FAILED rather than SKIPPED. Rejected because the explicit goal of this PR is to flip the integration-tests gate to load-bearing; turning it red on every CI run until a non-superuser app role is configured would block every PR. SKIPPED accurately reports "this case did not run" without blocking the gate, while leaving a clear loud breadcrumb (the `runningAsSuperuser` console.warn in beforeAll plus the SKIPPED status in the report) for the follow-up.

---

## Round 1 — closeout

Findings: 1 visible (P1). The user's pasted view of the GitHub PR was truncated mid-diff, so any additional findings beyond R1.1 were not surfaced in this round. If Codex posted more inline comments after the truncation point, they will need to be brought in via a follow-up paste — the existing PR thread on GitHub remains the source of truth.

Implemented: R1.1 (ACCEPT).
Deferred: none.
Rebutted: none.

Next: commit the fix, push, and either (a) ask the user for any additional rounds or (b) finalise the session.
