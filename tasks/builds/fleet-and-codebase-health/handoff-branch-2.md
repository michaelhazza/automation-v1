# Handoff — fleet-and-codebase-health (Branch 2: codebase-health)

> **Reconstruction note:** Authored 2026-05-13 from committed artefacts. Phase 2 was not driven by `feature-coordinator` in the standard pipeline shape; this handoff is a faithful summary of what is verifiable on the branch (commits, spec-conformance log, branch diff). Fields below cite only artefacts that exist on the branch. Gaps and post-conformance closures are called out explicitly so chatgpt-pr-review handles them correctly.

---

## Phase 1 (SPEC) — summary (reconstructed)

**spec:** `tasks/builds/fleet-and-codebase-health/spec.md` (recovered from orphan branch `claude/review-agent-codebase-pCl2U` at commit `9376fefd`, 328 lines; locked 2026-05-12)
**plan:** `tasks/builds/fleet-and-codebase-health/plan.md` (1196 lines, authored 2026-05-12)
**class:** Major (cross-cutting — codebase hygiene + route service-layer migrations + sweeps)
**branch posture:** Two branches per plan §2. Branch 2 (this handoff) covers chunks 1, 3, 11 (9 sub-chunks), 12, 13. Branch 1 (`fleet-and-process` / PR #293) covers chunks 2, 4, 5, 6, 7, 8, 9, 10. Branches are independent; Branch 1 should land first per the plan because Chunk 9 references Chunk 7's `reality-checker`.

## Phase 2 (BUILD) — summary

**build_slug:** fleet-and-codebase-health
**branch:** codebase-health
**branch_role:** Branch 2 of 2
**commits_ahead_of_main:** 8 (see `progress-branch-2.md` for the full list)
**files_changed:** 331 (10,418 insertions, 3,073 deletions)
**latest_main_merge:** `642dce2c` (2026-05-13 12:11 UTC+10)

**chunks_completed:** 1, 3, 11 (9 sub-chunks), 12, 13 — all in scope per plan §2; see `progress-branch-2.md` § "Plan chunks covered".

**spec_deviations:** three deferred items raised by spec-conformance NON_CONFORMANT verdict. **Two now closed; one open.** See "REVIEW_GAP entries" below for the full set with current state.

**spec-conformance verdict (committed):** **NON_CONFORMANT** — 33 PASS / 3 MECHANICAL_GAP (fixed) / 3 DIRECTIONAL_GAP (deferred) / 1 OUT_OF_SCOPE. Log: `tasks/review-logs/spec-conformance-log-fleet-and-codebase-health-branch-2-2026-05-13T01-17-33Z.md` (committed in `d8483c38`, log-metadata fix in `4eb5d92b`).

**spec-conformance re-run status:** **NOT re-run** after the post-conformance closures of REQ-FCH-B1 and REQ-FCH-C2. The committed verdict still says NON_CONFORMANT. Current state of the three deferred items:

| ID | Original | Current | Closing commit |
|---|---|---|---|
| REQ-FCH-B1-gate-red | gate RED, 2 violations from operator-backend merge | **CLOSED** — gate now GREEN (verified 2026-05-13) | `5ce8f2c7` + `79fc01db` |
| REQ-FCH-C2-knowledge-over-target | KNOWLEDGE.md 3,846 lines (target ≤2,500) | **CLOSED** — now 1,190 lines | `642dce2c` (main-merge of PR #292) |
| REQ-FCH-C4-new-prototypes | 3 new top-level `prototypes/{operator-backend, personal-assistant-v1, memory-improvements}/` dirs from post-Chunk-3 merges | **OPEN** — chatgpt-pr-review to adjudicate | not yet closed |

**pr-reviewer verdict:** findings ADDRESSED (no committed log on branch). Evidence: commit `79fc01db` (`fix(review): address pr-reviewer findings — move predicate to services, tx wrapping, org filters, drop cast`). Four findings:
- predicate moved into service layer
- transaction wrapping
- organisation filters added
- unsafe cast dropped

The reviewer's own log was not committed to the branch — only the response commit. chatgpt-pr-review may want to look at `79fc01db`'s diff to confirm the findings were genuinely addressed.

**REVIEW_GAP entries:**

```
REVIEW_GAP: spec-conformance-rerun | task-class: Major | reason: spec-conformance was NOT re-run after REQ-FCH-B1 and REQ-FCH-C2 were closed by post-conformance commits; committed verdict still says NON_CONFORMANT despite 2 of 3 deferred items resolved | operator-override: yes-2026-05-13T02:50:00Z | remediation: chatgpt-pr-review covers as the sole second-opinion pass and will validate the closed items by inspecting current state
REVIEW_GAP: dual-reviewer | task-class: Major | reason: operator explicitly skipped per 2026-05-13 scope decision (Codex availability not the issue) | operator-override: yes-2026-05-13T02:50:00Z | remediation: accept
REVIEW_GAP: adversarial-reviewer | task-class: Major | reason: diff touches §5.1.2 security surface (server/routes/*) so policy auto-invocation would normally trigger; operator explicitly skipped per 2026-05-13 scope decision (chatgpt-pr-review as sole second-opinion) | operator-override: yes-2026-05-13T02:50:00Z | remediation: chatgpt-pr-review reviews the route migrations
REVIEW_GAP: reality-checker | task-class: Major | reason: operator skipped per 2026-05-13; bootstrap gap (agent introduced by Branch 1, not yet on this branch's HEAD) | operator-override: yes-2026-05-13T02:50:00Z | remediation: accept
```

## Open issues for finalisation

1. **REQ-FCH-C4 still open** — three new top-level `prototypes/` dirs. Spec §5.C4 convention scope is ambiguous. chatgpt-pr-review should adjudicate (accept, defer, or recommend archive).
2. **spec-conformance not re-run** after deferred-item closures. chatgpt-pr-review will see the current code state and can validate B1 and C2 closures by inspection.
3. **adversarial-reviewer skipped despite §5.1.2 surface match.** The diff includes 9 route files migrated to service layer. Auto-invocation would normally trigger. Operator explicitly opted out for this scope reduction. chatgpt-pr-review's review of `server/routes/*` and `server/services/**` substitutes.
4. **pr-reviewer log not committed.** Only commit `79fc01db` documents the round. chatgpt-pr-review may want to read that diff for verification.
5. **Sibling branch dependency:** Branch 1 (`fleet-and-process` / PR #293) lands first per plan §2. Branch 2's S2 sync (when finalising) will pull in Branch 1's agent fleet + GRADED matrix changes.

## Doc-sync touchpoints (Phase 3 sweep input)

See `progress-branch-2.md` § "Doc-sync touchpoints". Already touched by Branch 2: `architecture.md` (route entries), `KNOWLEDGE.md` (condensed), `tasks/todo.md` + `tasks/todo-archive/2026-Q2.md` + `tasks/todo-triage-inventory.md` (triage sprint), `docs/decisions/*` (ADR renumber + index sync), `_archive/prototypes/`, `_archive/attached_assets/`, `scripts/verify-no-db-in-routes.sh`. Pending Phase 3 verification: per-route architecture.md entries against the actual service-layer migrations; `docs/capabilities.md` (no expected change); `docs/integration-reference.md` (no expected change); `docs/frontend-design-principles.md` (no expected change).
