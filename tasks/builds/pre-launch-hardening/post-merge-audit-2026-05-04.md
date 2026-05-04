# Pre-Launch Hardening — Post-Merge Relevance Audit

**Audited:** 2026-05-04 (after merging `origin/main` into `claude/pre-launch-hardening-spec-fs3Wy`)
**Mini-spec authored:** 2026-04-26 (8 days ago)
**Main commits absorbed:** 908 between mini-spec authoring and this audit
**Audit scope:** every item ID cited in `docs/pre-launch-hardening-mini-spec.md` × current state of `tasks/todo.md` and `docs/superpowers/specs/`

---

## Table of contents

- §0 Headline finding + per-chunk verdict
- §1 Chunk 1 — RLS Hardening Sweep
- §2 Chunk 2 — Schema Decisions + Renames
- §3 Chunk 3 — Dead-Path Completion
- §4 Chunk 4 — Maintenance Job RLS Contract
- §5 Chunk 5 — Execution-Path Correctness
- §6 Chunk 6 — Gate Hygiene Cleanup
- §7 Recommendation summary + pre-write verifications

---

## §0 Headline finding

**Roughly half of the mini-spec's items have already shipped on `main` since 2026-04-26.** Three downstream specs absorbed the work the mini-spec was about to carve up:

- **PR #196** (`codebase-audit-remediation`) — Phases 1+2+3, merged earlier.
- **PR #235** (`pre-prod-tenancy`) — merged 2026-04-29. Closed 13/15 Chunk 1 items + the three `B10` jobs' silent-no-op behaviour (Chunk 4) + parts of Chunk 6.
- **PR #247** (`deferred-items-pre-launch`) — merged 2026-05-01. Closed `DR1`, `DR2`, `DR3`, `S2-SKILL-MD`.
- **PR #211** (state-machine guards) — closed part of Chunk 5's `C4b-INVAL-RACE` at terminal-write boundaries (intermediate transitions still uncovered).

### Per-chunk verdict

| Chunk | Verdict | Action |
|---|---|---|
| 1 — RLS Hardening | **DROP** | 13/15 closed; the 2 residuals (SC-2026-04-26-1, GATES-2026-04-26-2) move to Chunk 6 |
| 2 — Schema Decisions + Renames | **KEEP** | All 12 items still open; nothing on main touched the F-items, W1-6/29, WB-1, DELEG-CANONICAL, BUNDLE-DISMISS-RLS, CACHED-CTX-DOC |
| 3 — Dead-Path Completion | **SHRINK** | DR1/DR2/DR3 all shipped; only `C4a-REVIEWED-DISP` remains. Fold into Chunk 5. |
| 4 — Maintenance Job RLS | **DROP** | Silent-no-op behaviour fixed; per-org `withOrgTx` defense-in-depth already routed to pre-prod-tenancy Phase 3 (optional) |
| 5 — Execution-Path Correctness | **KEEP (narrowed)** | 6 of 7 items still open. `C4b-INVAL-RACE` scope narrows to "intermediate non-terminal transitions" (terminal-write boundaries already covered by PR #211). Folds in `C4a-REVIEWED-DISP` from Chunk 3. |
| 6 — Gate Hygiene Cleanup | **KEEP (narrowed)** | Most items still open. Drop `S2-SKILL-MD` (closed). Take on the 2 residuals from Chunk 1. |

Result: **3 specs, not 6** — Chunk 2, narrowed Chunk 5, narrowed Chunk 6. Chunks 1, 3, 4 dissolve into either prior shipped work or the surviving three specs.

---

## §1 Chunk 1 — RLS Hardening Sweep

**Status overall:** **13 / 15 closed.** One PR-level migration (`0227_rls_hardening_corrective.sql`) + `0228_phantom_var_sweep.sql` + `0229_reference_documents_force_rls_parent_exists.sql` closed the FORCE-RLS gaps and the phantom-var bug.

| Mini-spec ID | Status now | Evidence |
|---|---|---|
| `P3-C1` memory_review_queue FORCE RLS + CREATE POLICY | **CLOSED 2026-04-29** | `migrations/0227_rls_hardening_corrective.sql` lines 22–39 |
| `P3-C2` drop_zone_upload_audit FORCE RLS | **CLOSED 2026-04-29** | `migrations/0227_rls_hardening_corrective.sql` lines 41–59 |
| `P3-C3` onboarding_bundle_configs FORCE RLS | **CLOSED 2026-04-29** | `migrations/0227_rls_hardening_corrective.sql` lines 61–79 |
| `P3-C4` trust_calibration_state FORCE RLS | **CLOSED 2026-04-29** | `migrations/0227_rls_hardening_corrective.sql` lines 81–99 |
| `P3-C5` phantom RLS session var | **CLOSED 2026-04-29** | `migrations/0228_phantom_var_sweep.sql` |
| `P3-C6` direct db import in routes/memoryReviewQueue.ts | **CLOSED 2026-04-29** | Route now uses `memoryReviewQueueService` + `resolveSubaccount` |
| `P3-C7` direct db import in routes/systemAutomations.ts | **CLOSED 2026-04-29** | Route now imports only `systemAutomationService` |
| `P3-C8` direct db import in routes/subaccountAgents.ts | **CLOSED 2026-04-29** | Route now uses 4 services + 9 `resolveSubaccount` calls |
| `P3-C9` missing resolveSubaccount in routes/clarifications.ts | **CLOSED 2026-04-29** | Route uses `clarificationService` + `resolveSubaccount` |
| `P3-C10` missing orgId filter in documentBundleService.ts | **CLOSED 2026-04-29** | `verifySubjectExists` uses `getOrgScopedDb` + `eq(table.organisationId, ...)` on every branch |
| `P3-C11` missing orgId filter in skillStudioService.ts | **CLOSED 2026-04-25** (audit-remediation) | Lines 168, 309, 318 carry the org filter |
| `P3-H2` direct db import in lib/briefVisibility.ts | **CLOSED 2026-04-29** | Lib is now thin re-export from `briefVisibilityService` |
| `P3-H3` direct db import in lib/workflow/onboardingStateHelpers.ts | **CLOSED 2026-04-29** | Lib is now thin re-export from `onboardingStateService` |
| `GATES-2026-04-26-1` reference_documents/_versions FORCE RLS | **CLOSED 2026-04-29** | `migrations/0229_reference_documents_force_rls_parent_exists.sql` |
| `SC-2026-04-26-1` 60-table registry-vs-migrations delta | **STILL OPEN** | Pre-prod-tenancy spec authored a Phase 1 plan (§3.3 hard rubric, §3.4 classification table — 67 tables); implementation status uncertain — `tasks/todo.md` line 1052 still marks it open. Needs a one-line gate-run to confirm. |

**Recommendation:** **DROP Chunk 1 spec entirely.** `SC-2026-04-26-1` is either resolved by the pre-prod-tenancy implementation (in which case the line in `tasks/todo.md` is stale), or it's the remaining tail of pre-prod-tenancy Phase 1 (in which case it belongs in that spec's follow-up, not in a new pre-launch spec). Either way, authoring a separate Chunk 1 spec duplicates work already designed elsewhere.

If `SC-1` does need new authoring, it goes into Chunk 6 (gate hygiene) — see §6 below.

---

## §2 Chunk 2 — Schema Decisions + Renames

**Status overall:** **12 / 12 still open.** Zero items closed since mini-spec authoring. Every architect-level call still pending.

| Mini-spec ID | Status now | `tasks/todo.md` line |
|---|---|---|
| `F6` safety_mode vs run_mode collision | OPEN | 605 |
| `F10` portal run-mode field unnamed | OPEN | 606 |
| `F11` side_effects storage decision | OPEN | 607 |
| `F15` input_schema/output_schema validator | OPEN | 608 |
| `F21` Rule 3 "Check now" trigger or removal | OPEN | 609 |
| `F22` definition of "meaningful" output | OPEN | 610 |
| `WB-1` agent_runs.handoff_source_run_id write-path | OPEN | (still in `Deferred from spec-conformance review — paperclip-hierarchy` section after merge — lines shifted) |
| `DELEG-CANONICAL` agent_runs vs delegation_outcomes truth | OPEN | 434 |
| `W1-6` automations table column renames | OPEN | 727 |
| `W1-29` `*.playbook.ts → *.workflow.ts` | OPEN | 728 |
| `BUNDLE-DISMISS-RLS` unique-key vs RLS | OPEN | 582 |
| `CACHED-CTX-DOC` Option B-lite documentation | OPEN | 593 |

**Recommendation:** **KEEP Chunk 2 unchanged.** Nothing on main has touched the F-items, W1-6/29, WB-1, DELEG-CANONICAL, or the cached-context decisions. The architect call is still needed; the spec scope holds.

Note on workflows-v1-phase-2 (PR #258) and other large merges: they introduced renames (e.g. `workflow_runs.task_id`, `flow_runs`) that may interact with W1-6 — the spec author should confirm the exact column-rename surface area against post-merge state, but the *decisions* in the mini-spec are unchanged.

---

## §3 Chunk 3 — Dead-Path Completion

**Status overall:** **3 / 4 closed.** Only the post-approval dispatch architectural call remains.

| Mini-spec ID | Status now | Evidence |
|---|---|---|
| `DR1` POST /api/rules/draft-candidates route | **CLOSED 2026-05-01** | PR #247 (`server/routes/rules.ts:111`) |
| `DR2` re-invoke fast-path + Orchestrator on follow-ups | **CLOSED** | Commit `4d64df6d` — visible in `tasks/todo.md` line 472 (status `[x]`) |
| `DR3` BriefApprovalCard approve/reject end-to-end | **CLOSED 2026-05-01** | PR #247 ("DR3 — BriefApprovalCard onApprove/onReject wired \| FIXED") |
| `C4a-REVIEWED-DISP` review-gated invoke_automation never dispatches after approval | OPEN (related approval-resume harness shipped 2026-04-28) | `tasks/todo.md` line 1336 confirms approval-resume harness landed; the original "step never dispatches" architectural call has not been recorded as resolved. Verification needed. |

**Recommendation:** **SHRINK and FOLD into Chunk 5.** Chunk 3's dead-path scope is essentially gone. The one architectural call left (`C4a-REVIEWED-DISP`) lives in the dispatcher and naturally pairs with `W1-43` / `W1-44` (also dispatcher contract gaps) in Chunk 5.

If approval-resume work in `pre-test-integration-harness` (2026-04-28) already implemented the post-approval dispatch path, `C4a-REVIEWED-DISP` may also be closed — verification needed before authoring.
