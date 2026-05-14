# ChatGPT Plan Review Session — operator-backend — 2026-05-12T08-30-00Z

## Session Info
- Plan: `tasks/builds/operator-backend/plan.md`
- Spec: `docs/superpowers/specs/2026-05-12-operator-backend-spec.md`
- Branch: `claude/sandbox-execution-provider-DLfjn`
- Build slug: `operator-backend`
- Mode: manual (driven inline from feature-coordinator Step 4)
- Started: 2026-05-12T08:30:00Z
- Closed: 2026-05-12T09:00:00Z (Round 1 verdict applied)

---

## Round 1 — 2026-05-12T08:30:00Z

### ChatGPT verdict

> Not quite implementation-ready yet. I'd do a small plan Rev 2 with 6 fixes. The most important are F1, F2, and F3.

### Findings + decisions

| Finding | Severity | Triage | Decision | Cascade in plan |
|---|---|---|---|---|
| **F1** — Retry / extend-budget routes conflict with dispatcher reason gate (routes pre-transition `paused_* → delegated`, dispatcher then refuses the predecessor state) | blocker | technical | **apply** | Chunk 7 retry-chain-failure + extend-budget rewritten as ENQUEUE-ONLY with explicit `agent_runs.status` unchanged invariant; dispatcher is sole writer of paused → delegated. Added test file `retryChainFailureEnqueueOnly.test.ts`. Bound at Rev 2 invariant 1. |
| **F2** — Dispatch success predicate ambiguity (plan text could be read as including `delegated` in the predecessor set) | blocker | technical (clarification) | **apply** (clarification) | Verified the architect's R4 mitigation predicate already excluded `delegated` and `cancelled`. Added explicit invariant statement in Chunk 6 adapter contracts + Rev 2 invariant 2 listing the exact `WHERE status IN (...)` clause with `delegated` / `cancelled` / `paused_wall_clock_exceeded` / terminal states all EXCLUDED. |
| **F3** — RLS dual-GUC vs writers org-only mismatch (spec line 1104 mandates both `app.organisation_id` AND `app.subaccount_id` GUCs; codebase only has `setOrgGUC`; writers described as org-scoped only) | blocker | technical | **apply** | Verified by grep `grep -rln "app.subaccount_id\|set_config.*app\.sub" server/ migrations/` → ZERO existing hits. The spec's "existing" claim is incorrect. Chunk 1 now adds new helper `setOrgAndSubaccountGUC(tx, orgId, subaccountId)` at `server/lib/orgScoping.ts`. All three new RLS policies use dual-GUC `USING + WITH CHECK`. Chunk 5 service signatures take `(orgId, subaccountId)` as first two params; impure facades call `setOrgAndSubaccountGUC` as first statement in the transaction. New test `orgScopingDualGuc.test.ts`. Bound at Rev 2 invariant 3. |
| **F4** — Five open questions left for builder (architectural choices, not file paths) | high | technical | **apply (close all five)** | Resolved at plan time: `operator_managed → 'browser'`; canonical helper `setOrgAndSubaccountGUC` (introduced by F3 cascade); LLM-ledger writer locked to `server/services/llmRouter.ts` (verified by grep `grep -rln "llmRequests).values\|insert.*llm_requests" server/`); vendor version preserved verbatim from pre-rename CURRENT_VERSION as Chunk 4 acceptance item; `is_resumable_now` field name as Chunk 6 builder-must-inspect acceptance item. Bound at Rev 2 invariant 6. Original "Open questions" section in the plan replaced with a one-line pointer to invariant 6. |
| **F5** — Executor rules conflict (Chunk 1 calls for local `npm run db:rollback` verification; executor notes say CI-only) | medium | technical | **apply** | Chunk 1 acceptance + error-handling re-worded: `npm run db:generate` is the only local migration command; CI applies + rolls back on PR open. Bound at Rev 2 invariant 5. |
| **F6** — Fresh-profile restart route predicate too broad (`task is in a paused state` admits restart from any pause; spec semantics specifically about profile corruption / unrecoverable profile) | medium | technical | **apply** | Chunk 7 fresh-profile-restart precondition tightened: `task.status = 'paused_chain_failure'` AND latest non-superseded chain-link has `failure_class = 'profile_corruption'` OR `failure_reason = 'OPERATOR_PROFILE_UNRECOVERABLE'`. Other paused states return 409 `OPERATOR_PROFILE_RESTART_BLOCKED`. New test `freshProfileRestartPredicate.test.ts` covers every precondition branch. Bound at Rev 2 invariant 4. |
| **Minor — ETag** seconds-precision is weak if two writes land in the same second | low | technical (defer the column improvement; add the regression-check now) | **apply (partial)** | Chunk 9 manual acceptance check added: cross-session 409 regression check. Future monotonic-version-column improvement explicitly noted as a tracked open question, NOT a blocker. |

### Applied (auto-applied technical)

- [auto] F1 — Chunk 7: retry-chain-failure + extend-budget routes rewritten as enqueue-only; precondition checks added; explicit invariant that `agent_runs.status` is unchanged by the route. Test file `retryChainFailureEnqueueOnly.test.ts` added.
- [auto] F2 — Rev 2 invariant 2: explicit dispatch success predicate listed; Chunk 6 adapter contracts updated with the explicit `WHERE status IN (...)` clause.
- [auto] F3 — Chunk 1: new `setOrgAndSubaccountGUC` helper added to `server/lib/orgScoping.ts` MODIFY scope; three new RLS policies use dual-GUC; Chunk 5: every operator-service signature takes `(orgId, subaccountId)`; impure facades call the dual helper. Test file `orgScopingDualGuc.test.ts` added.
- [auto] F4 — All five Rev 1 open questions closed at plan time (Rev 2 invariant 6). Plan's "Open questions surfaced for the operator" section replaced with a pointer to invariant 6.
- [auto] F5 — Chunk 1 acceptance criteria + error-handling re-worded: `npm run db:generate` only locally; CI applies + rolls back on PR open.
- [auto] F6 — Chunk 7 fresh-profile-restart precondition tightened; new pure-helper test `freshProfileRestartPredicate.test.ts` covers every branch.
- [auto] Minor ETag — Chunk 9 manual cross-session 409 regression check added; monotonic-version-column improvement deferred to future spec amendment (not a blocker).

### Deferred / routed

- ETag monotonic-version-column improvement: track as a non-blocker post-launch hardening item if the seconds-precision turns out to be a real-world problem. Not added to `tasks/todo.md` (no specific incident has surfaced; deferring deferral until evidence).

### Integrity check

- Forward references: every "Rev 2 invariant N" pointer resolves to the numbered list at the top of the plan.
- Contradictions: F1's enqueue-only semantics is consistent with F2's dispatcher-as-sole-writer-of-transition. F3's dual-GUC requirement is consistent across Chunk 1 (helper + RLS policies), Chunk 5 (service signatures), and Chunk 6 (adapter calls).
- Missing inputs/outputs: F3's helper signature documented; F6's `decideFreshProfileRestartAllowed` pure-helper signature documented; F1's test file structure documented.

Integrity check: 0 issues found this round.

### Top themes

- **Race-safety hardening at the route/dispatcher boundary** (F1, F2): the route layer can never substitute for the dispatcher's optimistic-predicate UPDATE.
- **Defence-in-depth at the credential-bearing table boundary** (F3): the spec's dual-GUC mandate is the right shape; the implementation gap was that the codebase only had `setOrgGUC`. Closing the gap requires a small new helper and discipline at every service signature.
- **Plan-time architectural closure** (F4): builders are best at file-path discovery and code patterns; not at picking between alternative architectures. Every choice that affects multiple chunks must be locked at plan time.
- **Operational discipline** (F5): executor rules (lint/typecheck/targeted vitest local; everything else CI) MUST be honoured uniformly across all chunks.
- **Permission predicate tightening** (F6): admin-only routes that delete user state (fresh-profile-restart wipes conversation history) MUST encode the exact recovery scenario, not a generic "task is paused" check.

---

## Verdict (Round 1)

**Round 1 closed APPROVED — plan Rev 2 is implementation-ready.**

The six findings were either (a) clarifications surfacing implicit invariants that were already true in the architect's intent but were not stated explicitly (F2), or (b) genuine fixes to plan text that would have caused a production bug at first dispatch (F1), an RLS-induced fail-closed outage (F3), an over-broad recovery route (F6), or builder paralysis (F4). Apply rate: 6 of 6 (one with partial-apply on the ETag minor — the regression check is in; the column improvement is deferred without specific tracking).

ChatGPT's verdict quote: *"After those changes, the plan is implementation-ready."*

---

## Round 2 — 2026-05-12T09:30:00Z

### ChatGPT verdict

> Patch F1 and F2 before build. F3 is a strong tightening but not scope-changing. After that, the plan is implementation-ready.

### Findings + decisions

| Finding | Severity | Triage | Decision | Cascade in plan |
|---|---|---|---|---|
| **R2-F1** — Progress route `GET /api/operator-sessions/:operatorRunId/progress` has no `subaccountId` in path; route cannot call `setOrgAndSubaccountGUC` before reading the dual-GUC RLS-protected `operator_runs` table. Route would fail-closed at the RLS check for every caller. | blocker | technical | **apply** | Route path changed to `GET /api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress` in Chunk 7 module shape, files, and contracts. Chunk 7 error-handling strategy updated with R2-F2 GUC-split discipline. Chunk 7 acceptance criteria add R2-F1 path-mount grep check. Chunk 8 `getOperatorRunProgress` signature updated to `(subaccountId, operatorRunId)`. Chunk 9 Contracts section reference updated. |
| **R2-F2** — Chunk 7 route boilerplate said "all routes call `setOrgGUC`"; operator-table paths require `setOrgAndSubaccountGUC`. The plan did not distinguish between org-only table reads (agent_runs preflight) and operator-table reads, leaving builders free to use the wrong GUC helper. | high | technical | **apply** | Chunk 5 error-handling strategy clarified: `setOrgGUC` permitted ONLY for org-scoped tables; any call path touching `operator_runs`, `operator_task_profiles`, `subaccount_operator_settings` MUST use `setOrgAndSubaccountGUC`. Chunk 7 error-handling strategy updated with the split rule and a call to grep-verify. Chunk 7 acceptance criteria add R2-F2 grep check: `setOrgGUC(` must return ZERO hits in operator route files. |
| **R2-F3** — ETag derived from `Math.floor(updated_at.getTime() / 1000)` (seconds-precision) produces the same string for two writes in the same second, making the If-Match check fail to catch the concurrent-write case. | medium | technical | **apply** | Chunk 1: `subaccountOperatorSettings.ts` schema adds `settingsVersion integer NOT NULL DEFAULT 1`; migration 0329 includes the column; PATCH UPDATE uses `settings_version = settings_version + 1` (atomic increment). Chunk 3: `subaccountOperatorSettingsServicePure.ts` ETag derivation changed to `String(settings_version)`. Chunk 5: `EffectiveOperatorSettings` contract updated (ETag = `String(settings_version)`; PATCH increments column). Chunk 3 tests: version-increment path added. Chunk 9: manual regression check note updated to remove the "same-second blind spot" caveat. |
| **Small cleanup** — Rev 2 invariant 2 / Chunk 6 success predicate should reset `operator_chain_failure_count=0` on successful dispatch, otherwise a previously-failing task that recovers shows a stale non-zero count to the next chain-resume decision. | low | technical | **apply** | Rev 2 invariant 2 updated: `SET status='delegated', operator_chain_failure_count=0`. Chunk 6 dispatcher success predicate contract updated to match. |

### Applied (auto-applied technical)

- [auto] R2-F1 — Chunk 7 + Chunk 8 updated; progress route path now carries `subaccountId`; dual-GUC called before `operator_runs` read.
- [auto] R2-F2 — Chunk 5 + Chunk 7 error-handling strategies updated; Chunk 7 acceptance criteria add grep-check for zero plain `setOrgGUC` calls in operator route files.
- [auto] R2-F3 — `settings_version integer NOT NULL DEFAULT 1` column added to Chunk 1 schema + migration 0329; ETag derivation changed to `String(settings_version)` in Chunk 3 pure helper; PATCH increment + contract updated in Chunk 5; test coverage added in Chunk 3 tests; Chunk 9 regression check note updated.
- [auto] Small cleanup — Rev 2 invariant 2 + Chunk 6 dispatcher predicate updated with `operator_chain_failure_count=0` reset.

### Deferred / routed

- None.

### Integrity check

- Forward references: R2-F1 cascade (Chunk 7 → Chunk 8 `getOperatorRunProgress` signature → Chunk 10 callers) is consistent. Chunk 10 reads the progress via Chunk 8 helpers; the new `(subaccountId, operatorRunId)` signature means Chunk 10 component must pass `subaccountId` — Chunk 10 already has access to it via the task's `subaccountId` field.
- Contradictions: R2-F3 replaces the seconds-based ETag; no remaining reference to `Math.floor(updated_at.getTime() / 1000)` in operator-settings paths.
- Missing inputs/outputs: `settings_version` column is now part of the `EffectiveOperatorSettings` contract; Chunk 8 does not need to surface the raw version number to callers (they receive the `etag` string).

Integrity check: 0 issues found this round.

### Top themes

- **RLS dual-GUC surface completeness** (R2-F1, R2-F2): the plan must be explicit at every site where the operator tables are accessed. Route paths, service call sequences, and acceptance-criterion greps are the enforcement chain.
- **Deterministic ETag** (R2-F3): timestamp-derived ETags are brittle at second boundaries; integer version columns are the canonical pattern for optimistic concurrency when sub-second collision is possible.
- **Counter state consistency** (cleanup): any UPDATE that indicates "success" should also reset failure counters that were incremented on the path to that failure.

## Verdict (Round 2)

**Round 2 closed APPROVED — plan Rev 3 is implementation-ready.**

All four findings were genuine fixes. R2-F1 was a hard blocker: the progress route would have failed-closed for every caller due to missing subaccountId for the RLS check. R2-F2 ensures builders cannot accidentally use the wrong GUC helper in operator table paths. R2-F3 is a solid improvement — the seconds-blind-spot is a real race; the integer column is the right fix and costs one column. The cleanup is a hygiene fix that prevents a subtle state machine anomaly.

ChatGPT's verdict quote: *"Patch F1 and F2 before build. F3 is a strong tightening but not scope-changing. After that, the plan is implementation-ready."*
