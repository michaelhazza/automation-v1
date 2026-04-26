# Pre-Launch Hardening Specs — Progress

**Branch:** `spec/pre-launch-hardening`
**Plan:** `tasks/builds/pre-launch-hardening-specs/plan.md`
**Invariants:** `docs/pre-launch-hardening-invariants.md` (created in Task 0.6)
**Started:** 2026-04-26T09:44:53Z

## Implementation Order (MANDATORY — DO NOT REORDER)

```
1 → {2, 4, 6} → 5 → 3
```

Blocking rules — engineers picking up the implementation branches MUST honour all four:

- **Chunk 1 must land before ANY data-access changes.** RLS posture is the prerequisite for every other chunk; a code branch that touches tenant tables before Chunk 1 is merged risks silently fail-open queries.
- **Chunk 2 must land before any code touching `agent_runs`, schema renames (W1-6 / W1-29), or skill error envelope (C4a-6-RETSHAPE).** Schema decisions are ground-truth for Chunks 3 and 5.
- **Chunks 4 and 6 may run in parallel with 2.** They have no schema dependency.
- **Chunk 3 is last.** Dead-path completion depends on RLS (Chunk 1), schema decisions (Chunk 2), and execution correctness (Chunk 5) being stable.

PR order ≠ implementation order. Do **not** infer dependency ordering from PR merge order. The dependency graph above is authoritative.

## Pinned SHAs

- **Invariants pinned at:** `cf2ecbd06fa8b61a4ed092b931dd0c54a9a66ad2` (commit `cf2ecbd0`, 2026-04-26 — v3 with Manual-enforcement owners + 6.3 cancelled/skipped semantics + amendment SHA re-pin protocol; supersedes `31e94d34` → `a00506b0`)
- **Schema-decisions architect SHA:** `65494c88eb12bbaf22b2ed05ec1f29f14601f566` (commit `65494c88`, 2026-04-26 — final 630-line version; supersedes 314-line partial at `d5dc0b78`)
- **Dead-path-completion architect SHA:** `6bbbd737d48b9393146cd35f4930c0efdbb1be54` (commit `6bbbd737`, 2026-04-26)

## Workflow deviations from plan.md

**Authorised by user 2026-04-26 mid-Task-1:**

- **`spec-reviewer` agent is SKIPPED for every chunk in this sprint.** Plan.md §3 + every chunk task's Step 4 references `spec-reviewer`; those steps are bypassed. Each spec ships without the iterative reviewer pass. The user adjudicates spec quality directly when they review.
- **Review-cadence checkpoints are SKIPPED.** Plan.md §15 lists 7 checkpoint stops; the session runs straight through to Task 7 without pausing. Stop conditions still apply (anything that genuinely blocks → escalate), but normal review pauses are removed.
- **Per-chunk verification (Q2 default) is RETAINED.** Each chunk's cited items are verified against present `tasks/todo.md` + repo state before drafting, to avoid the same scope-mismatch caught on Chunk 1.

Effect on `## Status` below: spec-reviewer entries are not separately listed.

## Architect-output conflict check

**Completed:** 2026-04-26
**Schema-decisions SHA:** `d5dc0b7817eead437a715c23b2da55a3409fa01c`
**Dead-path-completion SHA:** `6bbbd737d48b9393146cd35f4930c0efdbb1be54`

**Result: PASSED — no cross-domain conflicts.**

Verified non-conflicts:
- **WB-1 / handoff_source_run_id:** Chunk 2 keeps both `handoffSourceRunId` + `parentRunId` for backward-compat. Chunk 3 doesn't modify either. No data-shape conflict.
- **Skill error envelope (C4a-6-RETSHAPE):** Chunk 3 explicitly defers to Chunk 5 (DR1 flat error envelope). Chunk 2 delegates the same decision to Chunk 5. Both architects align on "Chunk 5 owns this decision". No conflict.
- **DELEG-CANONICAL:** Chunk 2 declares `delegation_outcomes` canonical. Chunk 3 doesn't redefine. No conflict.
- **State-machine / approval flow:** Chunk 2 architect output does NOT touch decideApproval, completeStepRun, or invoke_automation flow. Chunk 3's C4a-REVIEWED-DISP resume path is fully owned by Chunk 3. No overlap.

No conflicts identified. Conflict resolution rule (§10b in plan.md) was not invoked. Tasks 2 and 3 specs proceed without HITL escalation on cross-architect coherence.

## Spec Freeze

**Preliminary freeze stamped at:** 2026-04-26
**Branch SHA at preliminary stamp:** `65494c88eb12bbaf22b2ed05ec1f29f14601f566`
**Specs included (PRs open, not yet merged):**

- pre-launch-rls-hardening-spec — PR [#204](https://github.com/michaelhazza/automation-v1/pull/204)
- pre-launch-schema-decisions-spec — PR [#209](https://github.com/michaelhazza/automation-v1/pull/209)
- pre-launch-dead-path-completion-spec — PR [#208](https://github.com/michaelhazza/automation-v1/pull/208)
- pre-launch-maintenance-job-rls-spec — PR [#205](https://github.com/michaelhazza/automation-v1/pull/205)
- pre-launch-execution-correctness-spec — PR [#207](https://github.com/michaelhazza/automation-v1/pull/207)
- pre-launch-gate-hygiene-spec — PR [#206](https://github.com/michaelhazza/automation-v1/pull/206)

**Implementation may begin AFTER all 6 PRs merge AND a final freeze re-stamp lands at the post-merge HEAD.** Implementation branches MUST follow the order `1 → {2, 4, 6} → 5 → 3` per the Implementation Order section above. Any code branch that starts before the post-merge freeze re-stamp is unauthorised.

**Open Decisions outstanding** (must be resolved by user before final freeze):

- **Chunk 1 § 4.2:** RLS gate posture (hard-block recommended; user adjudicates).
- **Chunk 2 § 11 Review Residuals:** F6 default for legacy rows; F10 inheritance precedence; F22 rejected proposals counted as meaningful.
- **Chunk 3 § 11 Review Residuals:** high-risk action handling; rate limiting cooldown.
- **Chunk 5 § 11 Review Residuals:** C4a-6-RETSHAPE branch confirmation (Branch A grandfather recommended via consistency sweep resolution); C4b-INVAL-RACE wrapper scope (single helper recommended); H3 option choice (option b recommended).
- **Chunk 6 § 11 Review Residuals:** capabilities.md editorial wording (Hyperscaler-scale recommended).

**Amendment rule (post-freeze):** any spec change after the final freeze stamp requires the 3-step protocol per `tasks/builds/pre-launch-hardening-specs/plan.md` § Task 6.5: explicit `## Amendments` section in the spec, invariants doc update if impacted, and re-run of Task 6.6 (consistency sweep) before re-stamping Task 6.5.

**This is a PRELIMINARY stamp.** It marks the end of pre-merge spec authoring; final stamp lands when PRs merge.

## Cross-Spec Consistency Sweep

**Completed at:** 2026-04-26 (preliminary — runs on integration-branch preview pre-PR merge per workflow deviation)
**Findings:** 1 total — 0 mechanical resolved · 1 directional resolved inline · 0 false alarms
**Sweep log:** `tasks/builds/pre-launch-hardening-specs/consistency-sweep.md`

The single finding (C4a-6-RETSHAPE unowned-decision drift across Chunks 2/3/5) was resolved inline: Chunk 5 spec amended to take ownership and recommend Branch A (grandfather flat-string error envelope); Chunk 3 spec amended to align. User can override at PR review.

**Implementation cleared** (subject to PR #204–#209 merging into the integration branch and freeze re-stamp post-merge).

## Coverage Baseline (SC-COVERAGE-BASELINE — captured 2026-04-26)

Per Chunk 6 spec § 2.2 SC-COVERAGE-BASELINE. Live counts captured before any pre-launch chunk PRs land. Future PRs touching input-validation or permission-scope must cite the baseline + delta in their PR body.

| Gate | Baseline (2026-04-26) |
|---|---|
| `verify-input-validation.sh` | **44 violations** (warning) |
| `verify-permission-scope.sh` | **13 violations** (warning) |

Source: live runs of `bash scripts/verify-input-validation.sh` and `bash scripts/verify-permission-scope.sh` against `spec/pre-launch-hardening` HEAD prior to Chunk 6 PR open.

## Status

- [x] Task 0    Branch setup
- [x] Task 0.5  Mini-spec on branch — no-op (PR #203 already merged to main, mini-spec inherited at branch creation; verified byte-identical to source SHA 1023ff02)
- [x] Task 0.6  Cross-chunk invariants doc — committed at 31e94d34 (v2 supersedes a00506b0), all 5 done-criteria pass (6 sections, 36 invariants, typed enforcement (Gate/Test/Static/Manual), State/Lifecycle category added, Invariant Violation Protocol explicit, Amendments section present)
- [x] Task 1    Chunk 1 — RLS Hardening Sweep — PR #204 open
- [x] Task 2.1  Architect input — Chunk 2 (committed at 65494c88)
- [x] Task 3.1  Architect input — Chunk 3 (committed at 6bbbd737)
- [x] Task 4    Chunk 4 — Maintenance Job RLS Contract — PR #205 open
- [x] Task 6    Chunk 6 — Gate Hygiene Cleanup — PR #206 open
- [x] Architect-output conflict check (pre-Task 2/3 gate) — PASSED (Schema vs Dead-Path; no cross-domain conflicts)
- [x] Task 2    Chunk 2 — Schema Decisions + Renames — PR #209 open
- [x] Task 5    Chunk 5 — Execution-Path Correctness — PR #207 open
- [x] Task 3    Chunk 3 — Dead-Path Completion — PR #208 open
- [ ] Task 6.5  Spec freeze gate
- [ ] Task 6.6  Cross-spec consistency sweep
- [ ] Task 7    Handoff log

## Per-spec PR list

_(populated as each chunk PR opens)_

| Chunk | Spec slug | Branch | PR # | Status |
|---|---|---|---|---|
| 1 | pre-launch-rls-hardening | spec/pre-launch-rls-hardening | [#204](https://github.com/michaelhazza/automation-v1/pull/204) | open for review |
| 2 | pre-launch-schema-decisions | spec/pre-launch-schema-decisions | [#209](https://github.com/michaelhazza/automation-v1/pull/209) | open for review |
| 3 | pre-launch-dead-path-completion | spec/pre-launch-dead-path-completion | [#208](https://github.com/michaelhazza/automation-v1/pull/208) | open for review |
| 4 | pre-launch-maintenance-job-rls | spec/pre-launch-maintenance-job-rls | [#205](https://github.com/michaelhazza/automation-v1/pull/205) | open for review |
| 5 | pre-launch-execution-correctness | spec/pre-launch-execution-correctness | [#207](https://github.com/michaelhazza/automation-v1/pull/207) | open for review |
| 6 | pre-launch-gate-hygiene | spec/pre-launch-gate-hygiene | [#206](https://github.com/michaelhazza/automation-v1/pull/206) | open for review |
