# PR Review — wave-6: cleanup batch + stale-status sweep (Session Q)

**Branch:** claude/wave-6-cleanup-batch
**Commit:** 5cddc767
**Files reviewed:** 43 files / 337 insertions / 65 deletions
**Reviewed at:** 2026-05-17T11:10:07Z

Blocking: 1 / Should-fix: 4 / Consider: 3
**Verdict:** CHANGES_REQUESTED (1 blocking, 4 should-fix)

---

## 🔴 Blocking — must be fixed before merge

- [🔴] **B1** `server/services/operatorSessionService.ts:535-540` (and re-read at `:560-565`) — `listForSubaccount()` missing `eq(integrationConnections.organisationId, input.organisationId)` on both WHERE clauses.
  Why: This is the exact `DEVELOPMENT_GUIDELINES §1` defence-in-depth predicate that this PR explicitly adds to the sibling `listAllowedSubscriptionsForAgent()` at `:466` and `:497`. Adversarial reviewer's `likely-hole` finding is confirmed: PR added defence-in-depth in one sibling method but left the twin uncovered, ending the cleanup pass with internal inconsistency.
  Fix: prepend `eq(integrationConnections.organisationId, input.organisationId),` to the `and(...)` block at lines 536 and 561.

---

## 🟡 Should-fix — non-blocking but expected to be addressed in-PR unless explicitly deferred

- [🟡] **S1** `server/services/__tests__/persistAndAnnounce.updateClaim.test.ts:102-122` — Drizzle WHERE-tree walker asserts presence of `id`, `status`, `pending` but does NOT assert the new `organisationId` predicate added by W5K-ADV-2.
  Why: With W5K-ADV-2 landing the org-id predicate as defence-in-depth, the test should grow to pin it — otherwise a future refactor can silently drop the predicate.

- [🟡] **S2** `migrations/0369_operator_session_usability_state_check.sql:5-14` — CHECK constraint added with no `NOT VALID` clause and no pre-migration verification.
  Why: Any legacy operator_session row with an out-of-enum `usability_state` would fail the CHECK and abort the ALTER. Recommend `ADD CONSTRAINT ... NOT VALID;` + a follow-up `VALIDATE CONSTRAINT`.

- [🟡] **S3** `server/jobs/skillAnalyzerJob/__tests__/consolidationOutcomePure.test.ts:35-42` — The divide-by-zero guard branch in the pure helper is NEVER exercised by the test set (the only path that hits `reductionPct` requires `postWords < preWords`).
  Why: Pure helper has dead code reachable only via specific shapes. Either add a shape test, or drop the `: 0` guard.

- [🟡] **S4** `server/services/operatorSessionService.ts:467-481` + `:498-511` (and the new `:537-545` / `:563-571` mirror) — Three-Similar-Lines violation: the order-by clause `sql\`${integrationConnections.isDefault} DESC\`, asc(label), asc(id)` is duplicated four times across two methods.
  Why: §6 CLAUDE.md tolerates three near-identical lines; this is the fourth occurrence. Defer if the operator-session feature is still settling.

---

## 💭 Consider — taste / future-proofing / nice-to-have

- [💭] **N1** `server/jobs/lib/definePruneJob.ts:55` — Pull the allowlist regex out to a named `const ALLOWED_EXTRA_WHERE` at module scope so the test file can import it directly.
- [💭] **N2** `architecture.md:460-471` AE4 worker-restart recovery section — name the watchdog file and the idle-threshold constant explicitly.
- [💭] **N3** `server/services/operatorSessionService.ts:224-226` — Use `assertNever(providerEntry.connectionMechanism)` instead of cast-and-compare for stronger exhaustiveness.

---

## Files NOT read

- client/src/components/clientpulse/ProposeInterventionModal.tsx — default-export drop, mechanical
- client/src/components/org-settings/PermissionsTab.tsx — same
- client/src/components/workflow-run/StepDetailPane.tsx — same
- client/src/pages/govern/components/*.tsx (12 files, type="button" sweep) — mechanical
- tasks/todo.md (full file) — spot-grep only

Unread files do not invalidate the verdict.

---

## Resolution plan (operator-confirmed autonomous)

- B1: fix in this branch (one-line per call site)
- S1, S3: apply (low-risk test coverage)
- S2: route to tasks/todo.md backlog (NOT VALID clause requires operator approval; the migration already passed CI on the existing branch)
- S4: route to tasks/todo.md backlog (refactor scope; Three-Similar-Lines tolerance)
- N1, N2, N3: route to tasks/todo.md backlog (deferrable polish)
