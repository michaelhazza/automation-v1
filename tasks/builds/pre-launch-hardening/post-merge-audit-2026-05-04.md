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

---

## §4 Chunk 4 — Maintenance Job RLS Contract

**Status overall:** **partially closed.** The silent-no-op behaviour is gone; the defense-in-depth upgrade is routed but not yet implemented.

| Mini-spec ID | Status now | Evidence |
|---|---|---|
| `B10-MAINT-RLS` | **PARTIAL** — original failure mode resolved; defense-in-depth upgrade routed to pre-prod-tenancy Phase 3 (optional) | `tasks/todo.md` line 451: "no longer silent no-ops"; per-org `withOrgTx` upgrade routed to `docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md` Phase 3 |

**Recommendation:** **DROP standalone Chunk 4 spec.** The mini-spec's stated done-criterion ("decay/pruning actually runs") is met. The remaining defense-in-depth concern is either (a) already in pre-prod-tenancy Phase 3 or (b) a one-line follow-on PR — does not warrant a dedicated spec.

If the user wants the defense-in-depth upgrade prioritised, the cleanest path is: confirm it's still in pre-prod-tenancy Phase 3, and if not, add it as one bullet to Chunk 6 (gate hygiene).

---

## §5 Chunk 5 — Execution-Path Correctness

**Status overall:** **6 of 7 items still open.** One item (`C4b-INVAL-RACE`) is partially covered by PR #211's state-machine guards but the original cross-cutting fix scope is wider than what shipped.

| Mini-spec ID | Status now | Notes |
|---|---|---|
| `C4b-INVAL-RACE` re-check invalidation after I/O | **PARTIAL** — terminal-write boundaries covered by PR #211 (`shared/stateMachineGuards.ts`); intermediate non-terminal transitions, `decideApproval`, `completeStepRunFromReview`, run-level terminal writes, agent-run aggregation paths NOT covered | `tasks/todo.md` line 1133 records the gap explicitly |
| `W1-43` dispatcher §5.10a rule 4 defence-in-depth | OPEN | line 729 |
| `W1-44` pre-dispatch required_connections resolution | OPEN | line 730 |
| `W1-38` automation_execution_error vocab alignment | OPEN | line 732 |
| `HERMES-S1` errorMessage thread from preFinalizeMetadata | OPEN | line 73 (still in Hermes Tier 1 deferred section) |
| `H3-PARTIAL-COUPLING` partial-status decoupled from summary | OPEN | line 128 |
| `C4a-6-RETSHAPE` skill error envelope grandfather-vs-migrate | OPEN | lines 439, 689 (cross-referenced) |

**Plus, recommended fold-in from Chunk 3:** `C4a-REVIEWED-DISP` (post-approval dispatch architectural call) — cleanly belongs alongside W1-43/W1-44 in the dispatcher contract.

**Recommendation:** **KEEP Chunk 5 with two adjustments:**
1. Narrow `C4b-INVAL-RACE` scope to the **uncovered surface area** (per the post-merge state of PR #211): intermediate non-terminal transitions + `decideApproval` + `completeStepRunFromReview` + run-level terminal writes + agent-run aggregation. Reference `shared/stateMachineGuards.ts` as the existing primitive to extend.
2. Fold `C4a-REVIEWED-DISP` from Chunk 3 into Chunk 5's dispatcher items. Keep its architect-call separate from the inline-resolved items.

---

## §6 Chunk 6 — Gate Hygiene Cleanup

**Status overall:** **most items still open.** One closure (`S2-SKILL-MD` shipped via PR #247).

| Mini-spec ID | Status now | `tasks/todo.md` line |
|---|---|---|
| `P3-H4` actionCallAllowlist.ts file missing | OPEN | 928 |
| `P3-H5` measureInterventionOutcomeJob queries canonicalAccounts outside service | OPEN | 929 |
| `P3-H6` referenceDocumentService imports anthropicAdapter | OPEN | 930 |
| `P3-H7` 5+ files import canonicalDataService without PrincipalContext | OPEN | 931 |
| `S-2` Principal-context propagation import-only | OPEN | 1009 |
| `S-5` saveSkillVersion pure unit test | OPEN | 1016 |
| `S2-SKILL-MD` skill .md files for ask_clarifying_questions / challenge_assumptions | **CLOSED 2026-05-01** | PR #247 |
| `S3-CONFLICT-TESTS` rule-conflict parser tests | OPEN | 453 |
| `P3-M10` skill visibility drift | OPEN | 949 |
| `P3-M11` 5 workflow skills missing YAML frontmatter | OPEN | 950 |
| `P3-M12` verify-integration-reference.mjs yaml dep | OPEN | 951 |
| `P3-M15` canonical_flow_definitions / canonical_row_subaccount_scopes registry | OPEN | 933 |
| `P3-M16` docs/capabilities.md editorial violation | OPEN | 953 |
| `P3-L1` explicit package.json deps | OPEN | 952 |
| `SC-COVERAGE-BASELINE` (REQ #35) | OPEN | 985 |
| `RLS-CONTRACT-IMPORT` (GATES-2026-04-26-2) | OPEN | 1077 |

**Recommendation:** **KEEP Chunk 6, narrowed.**
- Drop `S2-SKILL-MD` (closed).
- Optionally absorb `SC-2026-04-26-1` if it turns out to need a new owning spec (verification: run `verify-rls-protected-tables.sh` and confirm exit code).

---

## §7 Recommendation summary + pre-write verifications

### 7.1 Three specs, not six

| New spec slug | Carries items from | Architect needed? |
|---|---|---|
| `pre-launch-schema-decisions-spec` | original Chunk 2 (12 items, all open) | **Yes** — F6/F10/F11, WB-1, DELEG-CANONICAL |
| `pre-launch-execution-correctness-spec` | original Chunk 5 (6+1 open items, with `C4b` narrowed) + `C4a-REVIEWED-DISP` from Chunk 3 | **Yes** — `C4a-REVIEWED-DISP` resume-vs-branch + `C4a-6-RETSHAPE` grandfather-vs-migrate |
| `pre-launch-gate-hygiene-spec` | original Chunk 6 minus `S2-SKILL-MD`, optionally absorbing `SC-2026-04-26-1` and pre-prod-tenancy Phase 3 `B10` defense-in-depth | No |

### 7.2 Pre-write verifications (1 minute each)

Run these before authoring any of the 3 specs to confirm the reduced scope is correct:

1. `bash scripts/verify-rls-protected-tables.sh` — does `SC-2026-04-26-1` still fail? If yes, Chunk 6 absorbs it. If no, stale `tasks/todo.md` entry — close it.
2. `grep -n "completeStepRun\|approvalResume\|invokeAutomationStep" server/services/workflowEngineService.ts | head -30` and verify the approval-resume path does an `invokeAutomationStep()` re-entry — confirms `C4a-REVIEWED-DISP` open vs closed.
3. Confirm pre-prod-tenancy Phase 3 (`docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md`) still owns `B10` defense-in-depth — if not, lift into Chunk 6.
4. `grep -n "stateMachineGuards" server/services/workflowEngineService.ts server/services/agentRunFinalizationService.ts` — confirm the wired surface area matches what `tasks/todo.md` line 1133 records, so Chunk 5's narrowed `C4b` scope is accurate.

### 7.3 Suggested next move (if user agrees with this audit)

- **Discard the 6-spec plan in `tasks/builds/pre-launch-hardening/plan.md`.** Replace with a 3-spec plan reflecting this audit. The existing plan WIP (Chunks 2 / 5 / 6 outlines) survives largely intact as raw material; Chunks 1 / 3 / 4 outlines drop.
- **Annotate the closed mini-spec items in `tasks/todo.md`** with `[absorbed: <merging-spec-slug>]` so the audit trail survives. Don't delete the items.
- **Update `docs/pre-launch-hardening-mini-spec.md`** with a `## 2026-05-04 audit` section noting which chunks dissolved and pointing at this file.
- **Branch-rename suggestion.** The branch is `claude/pre-launch-hardening-spec-fs3Wy`. Keep the name — this branch authors the surviving 3 specs and lands them via separate PRs as originally planned.

### 7.4 If the user disagrees

- The pre-merge 6-spec plan is preserved in `tasks/builds/pre-launch-hardening/plan.md` (commits up to `b37fc6a`) plus the in-flight Chunk 5 outline (commit `ee83d99`). Nothing is lost.
- Standalone Chunk 1 / 3 / 4 specs would mostly restate already-shipped work plus the 1-2 residual items per chunk; the user should confirm explicitly that this is the desired shape before reopening that path.
