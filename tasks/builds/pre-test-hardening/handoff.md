# Pre-Test Hardening — Phase 2 → Phase 3 Handoff

**Build slug:** `pre-test-hardening`
**Spec:** [`tasks/builds/pre-test-hardening/spec.md`](./spec.md)
**Plan:** [`tasks/builds/pre-test-hardening/plan.md`](./plan.md)
**Branch:** `claude/review-preprod-spec-CmHez`
**Class:** Major
**Phase 2 closed at:** 2026-05-10T22:32:09Z
**Authored by:** main-session (backfilled — see context note)

---

## Table of contents

- Context note (non-standard pipeline state)
- What shipped
- DEC-1..4 resolutions
- Branch-level review pass — spec-conformance
- Branch-level review pass — pr-reviewer
- Branch-level review pass — adversarial-reviewer
- Branch-level review pass — dual-reviewer
- Doc-sync gate
- Spec deviations
- Pipeline state at handoff
- Open issues for finalisation
- Inputs for finalisation-coordinator

---

## Context note — non-standard pipeline state

This handoff was written **retroactively** when the operator launched `finalisation-coordinator` and the entry guard surfaced a state mismatch (`tasks/current-focus.md` pointed at a different build, no Phase 2 handoff for `pre-test-hardening`). The implementation work landed in three commits before `finalisation-coordinator` was invoked. The operator chose option **(a) backfill Phase 2 properly** at launch time. The branch-level review pass, doc-sync, and handoff therefore ran from the main session adopting `feature-coordinator`'s closing steps inline, then resumed `finalisation-coordinator`.

---

## What shipped

14-item security hardening sprint closing the launch-blocker backlog before testing lockdown. Three migrations (0318/0319/0320 — renumbered forward post-S2 to clear collision with PR #281 + PR #283). 76 files modified, +8082/-541 lines. Sister-branch scope-out gate clean (no diff in §0.2 forbidden paths).

| Item | What changed | Result |
|------|---|---|
| W1 | HMAC validation fails closed in production (`webhookService.ts`) | Negative test passes; dev opt-out preserved |
| W2 | `recordIncident` on Slack + Teamwork 5xx paths | Stable fingerprints `webhook:slack:handler_failed` + `webhook:teamwork:handler_failed` |
| W3 | Per-org Teamwork webhook URL token + DB-backed replay nonces (migrations 0318+0319, new `webhookReplayNonceStore` + prune job + `findByWebhookToken` admin-bypass) | New webhook URL `/api/webhooks/teamwork/:orgWebhookToken`; runbook `docs/runbooks/teamwork-webhook-token-rotation.md` |
| T1 | Support reads under `/api/subaccounts/:subaccountId/support/...` (5 routes + 11 client call-sites + integration test) | Legacy unscoped mount removed per DEC-1 |
| T2 | Cross-org scope-ID rejection on reference-doc promote/link (atomic verify-then-insert) | 403 `referenceDocument.scope_cross_org`; audit row carries only `{scopeKind, scopeId}` |
| T3 | `taskService.createTask` requires caller-supplied `tx`; 17 caller sites migrated; transitional 4-arg overload opens own tx + sets GUC + delegates | Type-pinned; FORCE-RLS regression test asserts the contract |
| S1 | 4 missing preflight checks (ticket-status eligibility, collision window, customer-match policy, supersession) | Pure helpers + tests in `supportDraftDispatchPreflightPure` |
| S2 | Agent-principal cannot set `overrideCollision: true` | 403 `support.draft.override_collision_human_only`; integration test |
| V1 | Connection-status Zod enum (route) + CHECK constraint (migration 0320 with preflight RAISE) | 400 `connection.status_invalid` at route; 23514 at DB |
| V2 | `pg_advisory_xact_lock` inside `withOrgTx` for `knowledgeService.overrideEntry` | Concurrent same-block writes serialise; cross-block parallelism preserved |
| O1 | Drop `RETURNING id` from working-time-rollup compact DELETE | Job runs to completion |
| O2 | Migration 0240 phased-swap runbook (DEC-3, code-deferred) | `docs/runbooks/migration-0240-phased-swap.md` |
| O3 | Reseed drop-create env guard: primary `NODE_ENV` + secondary host denylist (both fail-closed unconditionally) | `scripts/lib/prod-db-guard.ts` shared with O4 |
| O4 | Reseed restore-users transaction wrap + prod-DB guard | Mid-run interrupt leaves DB unchanged |
| O5 | Branch-protection requirement (operator action) | Recorded in `progress.md` §C10 |

### DEC-1..4 resolutions (locked in spec §0.4; no in-build deviations)

- **DEC-1 — Support read scoping shape:** subaccount-required path. Implemented per spec; verified via `server/index.ts` mount + three `Router({ mergeParams: true })` declarations + grep-gate output in `progress.md`.
- **DEC-2 — Webhook attribution shape (W3):** per-org URL path token. Three-filter lookup (`connector_type='teamwork' AND status='active' AND webhook_token=$1::uuid`) in `connectorConfigService.findByWebhookToken`. UUID-regex pre-validation gates malformed tokens before the DB call.
- **DEC-3 — Migration 0240 phased swap:** deferred post-launch; runbook landed.
- **DEC-4 — `taskService.createTask` signature:** caller-supplied `tx`. 17 caller sites migrated; transitional 4-arg overload opens its own tx, sets the GUC, and delegates.

---

## Branch-level review pass — spec-conformance

Verdict: **CONFORMANT_AFTER_FIXES** (2026-05-10). Log: `tasks/review-logs/spec-conformance-log-pre-test-hardening-2026-05-10T21-01-31Z.md`. All 14 implementation items verified. Mechanical gaps fixed in-session (DEC-1..4 re-statement + T1 grep-gate paste in `progress.md`). Out-of-scope: O5 (operator action). Server typecheck clean. Lint clean. Sister-branch scope-out gate clean.

## Branch-level review pass — pr-reviewer

Verdict: **APPROVED** after 2 rounds of fix-loop (2026-05-11).

**Round 1** (against commit `2b5e52fa`): CHANGES_REQUESTED — 3 Blockers (B1: `taskService.createTask` 4-arg overload threw synchronously, killing sister-branch callers; B2: `systemIncidentService.escalateIncidentToAgent` missing GUC SET inside its tx; S3: `supportDraftsRoutes.manualResolveDraft` missing 400 gate for unknown action). All three Blockers fixed in commit `3423a0d5` (operator-authored).

**Round 2** (against commit `3423a0d5`): CHANGES_REQUESTED → 1 Blocker (B1.x stale regression test still asserted old "throws" behaviour) + 3 Strong (S1 missing regression test for B2 FORCE-RLS path; S2 missing regression test for S3 400 gate; S3 dead `getOrgScopedDb` import in `systemIncidentService.ts:7`). All Round 2 items fixed in commit `930d385e`:
- **B1.x** — rewrote `taskService.createTask.regression.test.ts` legacy-4-arg test to assert (a) db.transaction opens, (b) first execute() is `SELECT set_config('app.organisation_id', ...)`, (c) canonical insert delegation runs, (d) deprecation warn fires. 5/5 pass.
- **S1** — new `systemIncidentService.escalation.regression.test.ts` pins B2 contract: GUC SET fires before taskService.createTask inside the transaction. 1/1 passes.
- **S2** — new `supportDraftsRoutesInvalidAction.test.ts` pins S3 contract: unknown action returns 400 `support.draft.invalid_action` AND service never called. 7/7 pass.
- **S3** — dead import removed.

**Deferred to backlog (post-launch hardening):**
- `PTH-PR-N3` — `systemIncidentService.escalationCount` TOCTOU (pre-existing; incident SELECT outside tx then used inside).
- `PTH-PR-N4` — `githubWebhook.ts:34-39` fail-open when `GITHUB_APP_WEBHOOK_SECRET` unset (out of spec scope per §0.2).

## Branch-level review pass — adversarial-reviewer

Verdict: **HOLES_FOUND** (2026-05-11) — 1 closed in-branch + 3 routed to backlog.

| Tag | Verdict | Item | Status |
|---|---|---|---|
| PTH-ADV-1 | LIKELY-HOLE | `approveDraft` UPDATE + fallback SELECT missing explicit `organisationId` filter (defence-in-depth gap per DEVELOPMENT_GUIDELINES §1) | **CLOSED in-branch** (commit `930d385e` — added `eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId)` to both clauses) |
| PTH-ADV-2 | WORTH-CONFIRMING | `findByWebhookToken` admin-bypass with `skipAudit: true` — silent tap on every Teamwork webhook | Deferred to `tasks/todo.md`; recommendation: emit counter metric so anomalous rates are visible |
| PTH-ADV-3 | WORTH-CONFIRMING | `pg_advisory_xact_lock` transaction-scope depends on caller opening a real `db.transaction()` | Deferred — auth middleware opens a real `withOrgTx` per request per `instrumentation.ts:172-173`; safe for HTTP path. Verify on background-job callers. |
| PTH-ADV-4 | WORTH-CONFIRMING | Webhook replay-nonce 10-min TTL vs Teamwork retry window (up to 72h) — correctness gap once downstream agent processing wires up | Deferred — current handler only logs (no side effects); revisit when downstream agent dispatch ships |

## Branch-level review pass — dual-reviewer

Verdict: **APPROVED** (2026-05-10, 4 iterations) — Codex CLI was available. Log: `tasks/review-logs/dual-review-log-pre-test-hardening-2026-05-10T22-08-04Z.md`.

**Accepted (committed as `bde109c9`):** auto-generate `webhook_token` UUID in `connectorConfigService.create` + `createForSubaccount`. Without this, any post-migration-0319 Teamwork connector created via the create path had `webhook_token=NULL` and the tokenised webhook route silently returned 401 on every delivery.

**Rejected with spec citation:**
- `prod-db-guard.ts` primary guard: Codex wanted `!== 'development'`; spec §6.3 mandates `=== 'production'` with denylist defence-in-depth. Spec-divergent change.
- `scheduledTaskService.fireOccurrence`: Codex flagged a regression on the `enqueueRunNow→setImmediate` path; deep-dive across iter2/iter3 showed the path was already broken on `main` pre-PR (FORCE-RLS read returns 0 rows for both old and new code shapes). Both attempted fixes architecturally invalid. Reverted. Pre-existing breakage routed as a separate spec item.

---

## Doc-sync gate

Per `docs/doc-sync.md`:

| Doc | Verdict |
|---|---|
| `architecture.md` | **yes** (§ Support Desk Routes mount-path updated to `/api/subaccounts/:subaccountId/support` per DEC-1/T1) |
| `docs/integration-reference.md` | **yes** (Teamwork entry: `setup_steps_summary` updated to per-org URL shape per DEC-2/W3; `known_gaps` SDC-ADV-1 + SDC-ADV-3 removed; `last_verified` 2026-05-11) |
| `KNOWLEDGE.md` | **yes** (3 patterns appended: stale-regression-test pass-by-accident; transitional-overload dual-mode coverage; S2 migration renumber-forward) |
| `docs/capabilities.md` | **n/a** — no skill/capability/integration add/remove/rename |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | **no** — PTH-ADV-1 rule already documented in DEVELOPMENT_GUIDELINES §1 |
| `CONTRIBUTING.md` | **no** — no contributor-facing convention change |
| `docs/frontend-design-principles.md` | **no** — T1 client-side changes are URL path rewrites only, no new pattern |
| `docs/decisions/` | **no** — DEC-1..4 are build-scoped; captured in spec §0.4 |
| `docs/context-packs/` | **no** — no section anchor changed |
| `references/test-gate-policy.md` | **no** — no test-gate posture change |
| `.claude/FRAMEWORK_VERSION` | **n/a** — no framework-layer change |
| `docs/spec-context.md` | **n/a** — not a spec-review session |

## Spec deviations

None. All 14 items shipped per spec §0.4 DEC-1..4 contracts. O5 (operator-applied branch protection) recorded in `progress.md` §C10 per its non-code acceptance criteria. The two pr-reviewer non-blockers (`PTH-PR-N3` + `PTH-PR-N4`) routed to backlog are explicitly out of spec scope per §0.2 + §10.

## Pipeline state at handoff

**Commits on branch (post-merge order, oldest first):**

- `3afd0554` — spec + brief authored
- `2b5e52fa` — 14 items implemented (single feature commit, all chunks bundled)
- `22061abc` — spec-conformance log persisted
- `3423a0d5` — pr-reviewer Round 1 Blockers fixed (B1/B2/S3)
- `bde109c9` — dual-reviewer Codex iter4 fix (auto-generate `webhook_token` on connector create)
- `fde9c734` — dual-reviewer commit-hash record
- `0c025224` — S2 merge of `origin/main`, 3 known-shape conflicts auto-resolved, migrations renumbered 0313/0314/0315 → 0318/0319/0320, npm install for `@react-pdf/renderer 4.5.1` + 52 transitive packages
- `930d385e` — pr-reviewer Round 2 + adversarial PTH-ADV-1 fixes (5 files, +455/-15)

**G1 gate (per-chunk):** all chunks PASSED at build time (per `progress.md`).
**G3 (current state):** server typecheck CLEAN (`npx tsc --noEmit -p server/tsconfig.json` 0 errors); lint CLEAN (`npm run lint` 0 errors, 899 warnings pre-existing).
**G2 (cross-chunk):** not formally run as a separate pass — cross-chunk contracts pinned by per-chunk tests and the spec-conformance run.

## Open issues for finalisation

1. **Review-log files (`tasks/review-logs/*pre-test-hardening*`) reference old migration numbers (0313/0314/0315).** Intentionally NOT renumbered — frozen historical record per the S2 commit message.
2. **CI risk: integration test `integrationConnectionsCheckConstraint.test.ts` requires migration 0320 to have applied locally.** Per CI policy, the test is `test.skipIf(SKIP_DB)` so it skips when `DATABASE_URL` is a placeholder; CI runs against a real DB with migrations applied.
3. **Codex availability for finalisation re-review:** dual-reviewer ran successfully in Phase 2 (4 iterations, APPROVED). If Codex remains available at finalisation, no re-run needed.

## Inputs for finalisation-coordinator

- `active_spec:` `tasks/builds/pre-test-hardening/spec.md`
- `active_plan:` `tasks/builds/pre-test-hardening/plan.md`
- `build_slug:` `pre-test-hardening`
- `branch:` `claude/review-preprod-spec-CmHez`
- `status:` `REVIEWING`
- `dual-reviewer verdict:` APPROVED (Codex available)
- `spec_deviations:` none
- `REVIEW_GAP:` none (dual-reviewer ran)

PR creation pending — `gh pr view` returns "no pull requests found for branch" as of handoff time. Finalisation-coordinator Step 4 creates the PR via `gh pr create --fill`.

---

## Phase 3 (FINALISATION) — complete

**PR number:** #284
**PR URL:** https://github.com/michaelhazza/automation-v1/pull/284
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-pre-test-hardening-2026-05-10T23-20-40Z.md`
**spec_deviations reviewed:** yes (2 operator-approved spec deviations recorded in `progress.md` "Post-spec tightening": R5 F1 createTask side-effect split + R8 F1 reseed primary-guard allowlist)
**Doc-sync sweep verdicts:** see chatgpt-pr-review log Final Summary block. Cross-check confirmed clean post-rounds:
- `architecture.md`: yes (Support Desk Routes mount-path + escalateIncidentToAgent createTaskCore split documented in §Phase 3 Step 6 cross-check)
- `docs/integration-reference.md`: yes (Teamwork entry: per-org URL shape + closed SDC-ADV-1/3 known_gaps + last_verified 2026-05-11)
- `KNOWLEDGE.md`: yes (4 entries — 3 Phase 2 patterns + 1 R3 correction covering 3 lessons)
- `docs/capabilities.md`: n/a (no skill/capability/integration add/remove/rename)
- `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md`: no (rules already documented)
- `frontend-design-principles.md`: no (no new UI pattern; T1 client-side changes are URL path rewrites only)
- `CONTRIBUTING.md`: no (no contributor-facing convention change)
- `docs/decisions/`: no (DEC-1..4 captured in spec §0.4)
- `docs/context-packs/`: no (no section anchor changed)
- `references/test-gate-policy.md`: no
- `.claude/FRAMEWORK_VERSION`: n/a
- `docs/spec-context.md`: n/a (not a spec-review session)

**KNOWLEDGE.md entries added:** 4 (3 Phase 2 + 1 R3 correction)
**tasks/todo.md items closed:** 10 (audit row 22 W1, CONSOL-GOV-DEF-18 V2, CONSOL-GOV-DEF-19 V1, AKR-ADV-3 T2, AGW-DEF-6 O1, REQ #45 S1, REQ #50 S2, SDC-ADV-1 T1, SDC-ADV-3 W3, webhook 5xx coverage W2, reseed scripts O3+O4)
**tasks/todo.md backlog items added:** 5 (PTH-CGT-R3-R2 weak 404 test; PTH-CGT-R6-F3 6 remaining createTask callers; PTH-CGT-R6-F6 resolveSubaccount 403 enumeration; PTH-CGT-R8-F1 spec amend; PTH-ADV-2/3/4 adversarial worth-confirming items)
**ready-to-merge label applied at:** 2026-05-11T00:44:16Z

### CI gate posture entering merge

- Server typecheck CLEAN at HEAD
- Lint CLEAN at HEAD (0 errors, 899 warnings — all pre-existing)
- 30+ regression tests pass (taskService.createTask, systemIncidentService.escalation, supportDraftsRoutesInvalidAction, supportDraftDispatchService.approveDraft, integrationConnectionsValidation, prodDbGuard, referenceDocumentScopeVerification)
- Migrations 0318/0319/0320 ship with `.down.sql` companions; no collision with main's 0313-0317
- Sister-branch scope-out gate clean (no diff in §0.2 forbidden paths)

### Loop summary across chatgpt-pr-review 8 rounds

- 13 real fixes auto-applied + 2 operator-approved spec deviations
- 4 backlog items routed (PTH-CGT-R3-R2, R6-F3, R6-F6, R8-F1)
- 6 duplicate false positives on `withAdminConnection` import (auto-rejected per Round 3 KNOWLEDGE entry §3)
- PTH-CGT-R2 (Round 2 deferral) closed inline in Round 5 F1 architectural refactor
