# Spec Review — Iteration 1 — closed-loop-skill-improvement

**Spec:** `docs/superpowers/specs/2026-05-18-closed-loop-skill-improvement-spec.md`
**Spec-context:** commit `62497257`, last_reviewed_at 2026-05-11, GREEN.
**Iteration:** 1 of 5 lifetime.
**Started:** 2026-05-18T03:17:50Z.

## Codex output

Captured at `tasks/review-logs/_codex_closed-loop-skill-improvement_iter1_2026-05-18T03-17-50Z.txt`. 12 distinct findings, verdict "Needs revision".

## Sections

1. Findings — Codex
2. Findings — rubric
3. Classification matrix
4. Disposition log
5. Iteration counts

---

## 1–4. Findings, classifications, dispositions

### FINDING #1 — Resolver purity vs snapshot DB write

- **Source:** Codex
- **Section:** §6.6, §8.1 step 5, §16 line 643, §23 line 928
- **Description:** §6.6 declares resolver pure; §8.1 step 5 has resolver write a snapshot row; §16 calls write "Fire-and-forget" inside `resolveSkillsForAgent`. Function with DB-write side effects is not pure.
- **Classification:** DIRECTIONAL — architecture: "Change the interface of X".
- **Disposition:** AUTO-DECIDED — accept (minimal reframing). Reframe §6.6 invariant 6 to apply to the composition step (`composeAmendmentsPure`), not the whole resolver wrapper; clarify §16 / §23 wording from "Pure function" to "Deterministic composition step; resolver wrapper writes snapshot fire-and-forget."
- **Routed to:** `tasks/todo.md` (visibility) AND apply prose reframing now.

### FINDING #2 — Regression replay forbidden transition

- **Source:** Codex
- **Section:** §9.2 step 3, §18.6, §7.1 line 197, §20 line 866
- **Description:** §9.2 sets `status='rejected', reject_reason='regression_failure'`. §18.6 forbids `accepted → rejected`; §20 already states correct behaviour (`accepted → retired` with `retirement_reason='rollback'`). Enum lacks `regression_failure`.
- **Classification:** MECHANICAL — pure contradiction, §20 wins.
- **Disposition:** ACCEPT — apply prose fix.

### FINDING #3 — Step 2 writes draft amendment rows

- **Source:** Codex
- **Section:** §17 Step 2, §9.1
- **Classification:** MECHANICAL — contradicts own intent ("RCA only, no amendment drafts yet").
- **Disposition:** ACCEPT — remove the draft-row-write from Step 2.

### FINDING #4 — Resolver query excludes org-scoped amendments

- **Source:** Codex
- **Section:** §8.1 step 1, §7.1 line 174, §22
- **Classification:** MECHANICAL — query filter contradicts schema's allowed value space.
- **Disposition:** ACCEPT — change filter to `(subaccount_id IS NULL OR subaccount_id = $subaccount)` and clarify Phase-1 writes are subaccount-only but resolver is org-scope-ready.

### FINDING #5 — "All five new tables" but seven are org-scoped

- **Source:** Codex
- **Section:** §14 line 537
- **Classification:** MECHANICAL — count drift.
- **Disposition:** ACCEPT — change "five" to "seven" and list them.

### FINDING #6 — Job inventory contradicts itself

- **Source:** Codex + rubric R3/R5
- **Section:** ABCd line 26, §9, §16, §17 Step 6, §23 line 924
- **Classification:** MECHANICAL — count drift + missing §9.3/§9.4 entries.
- **Disposition:** ACCEPT — add §9.3 (`amendment:stale-retire`) and §9.4 (`amendment:effectiveness-update`); reconcile all counts to **4 new jobs**; fix ABCd "7+ tables" to "8 tables".

### FINDING #7 — `originating_correction_cluster_id` FK + sidecar undefined

- **Source:** Codex
- **Section:** §7.1 line 196, §10.2 line 441
- **Classification:** DIRECTIONAL — architecture: "Introduce a new abstraction" (new cluster table) OR "Remove this item" (drop the path).
- **Disposition:** AUTO-DECIDED — middle path (conservative). Annotate column as Phase-2-reserved (null in Phase 1); trim §10.2 to keep new clustering dimensions but drop the sidecar-write claim; move cluster sidecar table + read path to §22 deferred items.
- **Routed to:** `tasks/todo.md` AND apply prose changes now.

### FINDING #8 — `global` freeze scope tenant-inconsistent

- **Source:** Codex
- **Section:** §7.8
- **Classification:** MECHANICAL — terminology contradiction; tenant isolation invariant §6.5 already implies rename.
- **Disposition:** ACCEPT — rename `global` to `org_global`.

### FINDING #9 — `review_required` referenced but never defined

- **Source:** Codex
- **Section:** §8.1, §9.1, §13.1, §17 Step 5
- **Classification:** MECHANICAL — load-bearing claim without mechanism.
- **Disposition:** ACCEPT — extend `skill_amendment_freezes.freeze_type` enum to include `review_required` (system-authored auto-freeze on truncation / cap-hit). No new table needed.

### FINDING #10 — `acceptAfterEdit()` state-machine transitions undefined

- **Source:** Codex
- **Section:** §11 line 456, §18.6
- **Classification:** MECHANICAL — state machine completeness.
- **Disposition:** ACCEPT — add explicit transitions to §18.6.

### FINDING #11 — DELETE verb for soft-delete thaw

- **Source:** Codex
- **Section:** §12 line 478
- **Classification:** MECHANICAL — minor clarification.
- **Disposition:** ACCEPT — strengthen description to make soft-thaw semantics explicit.

### FINDING #12 — Reject UI 3 buttons vs 7-value enum

- **Source:** Codex
- **Section:** §13.2 line 508, §7.1 line 197
- **Classification:** MECHANICAL — design source-of-truth (Round 5 CLEAN mockup) pins the 3 labels; spec just needs the mapping.
- **Disposition:** ACCEPT — add the 3 button labels + mapping to §13.2.

### FINDING R1 (rubric) — Snapshot `ON CONFLICT` key not declared on schema

- **Section:** §18.2 line 744, §7.7
- **Classification:** MECHANICAL — load-bearing claim without backing mechanism.
- **Disposition:** ACCEPT — add `UNIQUE NULLS NOT DISTINCT (run_id, system_skill_id, org_skill_id)` to §7.7.

### FINDING R2 (rubric) — Bare §X.Y cross-references to dev-brief sections

- **Section:** §2 lines 88–89, §7.7 line 306, §7.8 line 328, §11 line 453, §13.1 line 496, §19 line 792
- **Classification:** MECHANICAL — broken cross-references.
- **Disposition:** ACCEPT — disambiguate each bare reference with "of dev brief" or inline the content.

---

## 5. Iteration counts

- mechanical_accepted: 11 distinct finding fixes (Codex #2, #3, #4, #5, #6+R5, #8, #9, #10, #11, #12, R1, R2 — some bundled into single edits)
- mechanical_rejected: 0
- directional_or_ambiguous: 2 (Codex #1, #7 — both AUTO-DECIDED accept-with-clarification, routed to tasks/todo.md)
- reclassified: 0

Stopping heuristic: NOT a mechanical-only iteration (2 directional items resolved); cap not reached; Codex returned findings; acceptance rate non-zero. Iteration 2 would be eligible after applying fixes.

## Iteration 1 Summary

- Mechanical findings accepted: 10 (Codex #2, #3, #4, #5, #6, #8, #9, #10, #11, #12, plus rubric R1, R2 — bundled with Codex #6's job-count reconciliation that touched §9, §16, §17, §23, and ABCd).
- Mechanical findings rejected: 0
- Directional findings: 2 (Codex #1, #7)
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 2
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 2 (CL-SKI-1, CL-SKI-2 in tasks/todo.md)
- Spec commit after iteration: untracked working tree (caller's commit/push out of scope of this review's auto-commit policy — see note below).

**Auto-commit note (Step 8b override):** The spec under review is an untracked new file (introduced by Michael in this branch but not yet committed). The spec-reviewer agent's auto-commit step assumes the spec is tracked. To stay within the agent's safety rules, I am NOT initiating the first commit of an untracked file from a review iteration — that's the author's intent decision. The iteration log + plan + Codex output WILL be committed and pushed at iteration close per Step 8b.

