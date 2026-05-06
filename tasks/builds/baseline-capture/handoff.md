# Phase 2 Handoff — baseline-capture

**Spec:** `docs/baseline-capture-spec.md`
**Plan:** `tasks/builds/baseline-capture/plan.md`
**Branch:** `claude/baseline-capture`
**Worktree:** `C:\Files\Projects\automation-v1.baseline-capture\`
**Build slug:** `baseline-capture`
**HEAD:** `b516e26a`
**Author:** main session (direct implementation; no feature-coordinator pipeline run)

## Sections

- Summary
- Branch state
- Review pipeline outcomes
- Spec deviations
- Verification commands run
- Known deferrals + out-of-scope
- Phase 3 entrypoint

---

## Summary

F3 opening-state baseline capture at sub-account onboarding. All 12 plan chunks built and verified 2026-05-05. Spec is fully implemented per the spec-conformance re-run (CONFORMANT verdict). Two review cycles fixed in-branch:

- **pr-reviewer cycle:** 4 blocking (B1-B4) + 4 strong (S1-S4) + 3 non-blocking (N1-N3) all closed across two commits (`a3938e7c` + `6e9bbdce`).
- **adversarial-reviewer cycle:** 1 likely-hole (AR-1 runManual race) + 1 worth-confirming (AR-2 unbounded scan) closed in `ca2c81ee`.

Schema: 3 migrations (0280/0281/0282), partial UNIQUE index, FORCE RLS on both tables, FK-walked policy on the child table, 9 telemetry events registered.

## Branch state

| Field | Value |
|---|---|
| Branch | `claude/baseline-capture` |
| HEAD | `b516e26a` |
| Base | `main` (`12c38cdc`) |
| Migration high-water at branch tip | `0282_baseline_rls_and_dictionary.sql` |
| Migrations claimed | 0280 / 0281 / 0282 |
| Files changed vs main | ~62 files (~3900 insertions, ~150 deletions) |

Commit history (newest → oldest):
```
b516e26a chore(adversarial-review): persist baseline-capture log
ca2c81ee fix(baseline-capture): adversarial-reviewer findings — AR-1 race + AR-2 unbounded scan
6e9bbdce fix(baseline-capture): close pr-reviewer Strong-1 + Strong-2 follow-ups
a3938e7c fix(baseline-capture): pr-reviewer fix-loop — 4 blocking + 4 strong + 3 non-blocking
9c4ce8cf chore(spec-conformance): record finish commit hash in CONFORMANT log
a0faccf3 chore(spec-conformance): baseline-capture — CONFORMANT (re-run)
0f66f252 fix(baseline-capture): close REQ #24 — manual entry validation gaps
5e6616b4 feat(baseline-capture): F3 opening-state baseline capture at sub-account onboarding
8b7a50bf chore(spec-conformance): baseline-capture — NON_CONFORMANT
```

---

## Review pipeline outcomes

| Stage | Verdict | Log path | Auto-fixes | Deferred |
|---|---|---|---|---|
| spec-conformance (initial) | NON_CONFORMANT | `tasks/review-logs/spec-conformance-log-baseline-capture-2026-05-05T05-36-34Z.md` | REQ #21 (Date.now in metric reader) | REQ #20, REQ #24 |
| spec-conformance (re-run) | CONFORMANT | `tasks/review-logs/spec-conformance-log-baseline-capture-2026-05-05T09-10-57Z.md` | none (no mechanical gaps) | none |
| pr-reviewer | APPROVED (after fix-loop) | (in agent output; not persisted as separate file) | n/a (read-only) | Strong-1, Strong-2 — both closed in `6e9bbdce` |
| dual-reviewer | SKIPPED | n/a — Codex CLI unavailable in this Claude Code web session | n/a | REVIEW_GAP noted (per CLAUDE.md §"Review pipeline" — local-only) |
| adversarial-reviewer | HOLES_FOUND → ALL CLOSED | `tasks/review-logs/adversarial-review-log-baseline-capture-2026-05-05T10-04-57Z.md` | n/a (read-only) | AR-1, AR-2 — both closed in `ca2c81ee`. 3 observations explicitly out-of-scope. |

**Findings closed during this branch:**

- **REQ #20** — routes/baselines.ts now delegates manual + admin-reset to service methods. Single-writer rule restored. Invariant 3 grep gates strengthened to multi-line.
- **REQ #24** — Manual-entry validation: currency-required-for-cents (zod superRefine) + lead_count cap (canonical_metric_history MAX) with `LEAD_COUNT_EXCEEDS_HISTORICAL_HIGH` 400. 14 schema tests added.
- **B1** — routes/baselines.ts uses getOrgScopedDb (RLS contract gate now passes 0 violations).
- **B2** — baselineSubscriberService filters `status <> 'reset'` to disambiguate post-reset state.
- **B3** — getBaselineForSubaccount uses getOrgScopedDb + orderBy(baselineVersion DESC) + limit(1).
- **B4** — ManualBaselineForm cents↔dollars conversion (Math.round on submit, divide-by-100 on display). 21 pure-helper tests in `manualBaselineFormPure.test.ts`.
- **S1** — Hand-rolled try/catch + handleServiceError dropped; throws flow through asyncHandler. Three remaining res.json paths converted to throws (400 validation × 2, 404 GET × 1). Added `'details'` to FORWARDED_ERROR_FIELDS.
- **S2** — `hasNonManual` → `hasCanonical` so `unavailable` rows don't misclassify fully-manual baselines as 'mixed'.
- **S3** — `console.error` → `logger.error('baseline.evaluate_pending.candidate_failed', { ... })`.
- **S4** — Static-grep Invariant 8 added (subscriber filter + baselineHelper org-scoped/orderBy/limit).
- **N1** — BaselineStatusBadge uses api client.
- **N2** — Removed dead `capture_attempt_count = 3` retry-pickup branch with explanatory comment.
- **N3** — `aggregateOutcome` propagates per-metric `unavailableReason` (forward-compat for `schema_mismatch`, `reader_not_implemented`).
- **AR-1** — `runManual` restructured into 6 steps with atomic claim ahead of metric writes. Static-grep Invariant 9 added to prevent regression.
- **AR-2** — `evaluateAllPendingBaselines` candidate scan bounded to `ORDER BY created_at ASC LIMIT 1000`.

---

## Spec deviations

None outstanding. The spec-conformance re-run verified all 38 requirements PASS. No directional gaps, no ambiguous gaps, no out-of-scope clauses left unaddressed in the implementation.

Notes on intentional design choices that may look unusual:
- `subaccountOnboardingService.markBaselinePending` uses bare `db` for the initial pending-row insert (intentional — called from a route already inside `withOrgTx`; the SINGLE_WRITER_ALLOWED list explicitly includes this file as one of two valid writers). Verified via Invariant 3 grep gates.
- `captureBaselineService.run` uses bare `db` (intentional — pg-boss createWorker wraps the handler in its own org-scoped tx; comment at the call site explains).
- `captureBaselineService.adminReset` uses `withAdminConnection` + `SET LOCAL ROLE admin_role` (intentional — sysadmin route targets cross-org subaccounts; service resolves the org internally).

---

## Verification commands run

All run in the worktree at HEAD `b516e26a`:

| Command | Result |
|---|---|
| `npm run lint` | 0 errors (868 pre-existing warnings unchanged) |
| `npm run typecheck` | pass (both tsconfig.json + server/tsconfig.json) |
| `npm run build:server` | pass |
| `npm run build:client` | pass (5.22s) |
| `bash scripts/verify-rls-contract-compliance.sh` | 0 violations across 1544 files |
| `npx vitest run server/services/__tests__/baselineInvariants.test.ts` | 10/10 (incl. new Invariants 8 + 9) |
| `npx vitest run server/services/__tests__/baselineRetryClassifierPure.test.ts` | 30/30 (incl. unavailableReason propagation tests) |
| `npx vitest run server/services/__tests__/baselineSubscriberPure.test.ts` | 7/7 |
| `npx vitest run shared/schemas/__tests__/baselineManualForm.test.ts` | 14/14 |
| `npx vitest run client/src/components/baseline/__tests__/manualBaselineFormPure.test.ts` | 21/21 |

**Total pure-function tests:** 82/82 pass.

Per CLAUDE.md §"Test gates are CI-only", the full suite (`npm run test:gates`, `bash scripts/run-all-unit-tests.sh`) is NOT run locally. CI handles that as a pre-merge gate.

---

## Known deferrals + out-of-scope

### Carried forward from progress.md (acceptable for v1)

- Mailgun / Twilio / Google Business Profile metrics — no adapters exist; recorded as `unavailable` per spec.
- MRR formula — Stripe adapter reads payments; deferred until proper subscription model.
- Recurring re-baseline — admin reset only for v1.
- Historical backfill — v1 is T0 only; full history lives in `canonical_metric_history`.
- Integration tests — `server/services/__tests__/captureBaselineIntegration.test.ts` is `describe.skip` because the repo has no `createTestDb` / `TEST_DATABASE_URL` convention. All 7 invariant assertions are documented as `it.todo`. To run locally once a test DB exists: `DATABASE_URL=<test_db_url> npx vitest run server/services/__tests__/captureBaselineIntegration.test.ts`.

### Adversarial-reviewer observations explicitly out-of-scope

- `manualBaselineFormSchema.numeric` has no `.max()` cap — data-quality concern; spec doesn't pin upper bounds. Not security.
- `currency: z.string().length(3)` doesn't validate against ISO-4217 — minor data quality.
- `evaluateAllPendingBaselines` retry filter uses `last_attempt_at` rather than `next_attempt_at` — both are set together by `captureBaselineService.run` (consistent for normal flow).

### Pre-existing infra gaps (not regressions on this branch)

- No `createTestDb` helper / `TEST_DATABASE_URL` convention. Affects integration-level invariant assertions for this build (5 of 7 invariants); the static-grep stand-ins (Invariants 1, 3, 5, 6, 7, 8, 9) cover the same surface at the structural level.

---

## Phase 3 entrypoint

The branch is REVIEWING. Phase 3 (finalisation-coordinator) should:

1. **S2 branch sync** — fetch + rebase against `origin/main`. No conflicts expected (branch was kept current).
2. **G4 regression guard** — confirm verification commands still pass after sync.
3. **chatgpt-pr-review** — manual ChatGPT-web rounds. Spec deviations: NONE (all 38 spec requirements PASS in conformance re-run). Adversarial gaps: ALL CLOSED.
4. **Doc-sync sweep** — `docs/capabilities.md`, `architecture.md`, `KNOWLEDGE.md`, `replit.md`, `references/**` (per `docs/doc-sync.md`).
5. **KNOWLEDGE.md** — extract patterns from this build worth preserving (atomic-claim ordering for HTTP-tx async writers; cents↔dollars conversion as pure-helper extraction; FK-walked RLS policies for child tables; admin-bypass via `withAdminConnection` + `SET LOCAL ROLE admin_role` for sysadmin cross-org paths).
6. **`current-focus.md`** — transition status to MERGE_READY after PR is open + ready-to-merge label applied.
7. **Apply ready-to-merge label** — triggers CI.

**REVIEW_GAP note for chatgpt-pr-review and finalisation:** dual-reviewer was SKIPPED — Codex CLI unavailable in this Claude Code web session. `chatgpt-pr-review` is the second-opinion pass. `pr-reviewer` + `adversarial-reviewer` already ran with HOLES_FOUND → all closed. The fix-loop in this branch closed every finding from both reviewers; CHANGES_REQUESTED → APPROVED transitions are documented in commit messages.

**No outstanding blockers for merge.**
