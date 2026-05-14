<!-- mission-control
active_spec: tasks/builds/skill-merge-consolidation-pass/spec.md
active_plan: tasks/builds/skill-merge-consolidation-pass/plan.md
build_slug: skill-merge-consolidation-pass
branch: claude/improve-skill-analyzer-RiFpB
status: BUILDING
last_updated: 2026-05-13T23:59:14Z
last_merged_pr: #297
last_merged_slug: iee-browser-on-e2b
last_merged_branch: claude/migrate-browser-e2b-snI99
last_merged_at: 2026-05-14T00:00:00Z
last_merged_commit: 8008abae
-->

# Current Focus

Sprint-level pointer for the active session. Update when the current spec, branch, or sprint changes. If no spec is in flight, leave the fields below set to `none`.

The HTML comment block at the top is read by the Mission Control dashboard (`tools/mission-control/`). Keep prose in sync; prose is canonical if they disagree. Status enum: `PLANNING` | `BUILDING` | `REVIEWING` | `MERGE_READY` | `MERGED` | `NONE`.

Per-session progress goes in `tasks/builds/<slug>/progress.md`, not here. Historical merge log lives in git (`git log --merges main`) and in per-build handoff files under `tasks/builds/<slug>/handoff.md`.

---

**Active spec:** tasks/builds/skill-merge-consolidation-pass/spec.md
**Active plan:** tasks/builds/skill-merge-consolidation-pass/plan.md (pending — architect to write)
**Active build slug:** skill-merge-consolidation-pass
**Branch:** claude/improve-skill-analyzer-RiFpB
**Status:** **BUILDING**

**Active build:** `skill-merge-consolidation-pass` — adds a conditional LLM consolidation pass to the skill analyzer's merge pipeline. Fires only when `validateMergeOutput` emits `SCOPE_EXPANSION` / `SCOPE_EXPANSION_CRITICAL`. Spec at `tasks/builds/skill-merge-consolidation-pass/spec.md` (3 ChatGPT review rounds complete). Phase 1 handoff bridged 2026-05-13 (spec was authored directly without spec-coordinator; operator confirmed "bridge and proceed" before Phase 2 launch). Task class: Significant.

**Just merged:** PR #297 — `iee-browser-on-e2b` (squash-commit `8008abae`, 2026-05-14). IEE browser substrate redirect from DigitalOcean to e2b sandboxes: 3 new tables (session profiles, per-subaccount settings, warm sessions), dispatch seam in `_ieeShared.ts::ieeDispatchBrowser`, profile manager + warm pool service scaffolds (RUNTIME-DISABLED until SDK lands), DigitalOcean retirement + CI gate. chatgpt-pr-review APPROVED after 4 rounds (28 findings closed); 9 deferred items as IEE-DEF-1..9. Phase 3 handoff: `tasks/builds/iee-browser-on-e2b/handoff.md`.

**Last merged:** PR #288 — `operator-backend` (squash-commit `83fd8347`, 2026-05-13). Operator Backend = first concrete adapter for delegated long-running operator-managed tasks. Phase 3 handoff: `tasks/builds/operator-backend/handoff.md`.

**Paused build (concurrent, different branch):** `fleet-and-codebase-health` on `codebase-health` branch (Branch 2 of 2). Status was REVIEWING when this iee-browser session was launched. Handoff: `tasks/builds/fleet-and-codebase-health/handoff-branch-2.md`. Progress: `progress-branch-2.md`. Sibling Branch 1 (`fleet-and-process` / PR #293) is APPROVED. To resume: switch to `codebase-health` branch and restore this pointer to `active_spec: tasks/builds/fleet-and-codebase-health/spec.md` / `build_slug: fleet-and-codebase-health` / `status: REVIEWING`.

**Paused build:** `support-desk-canonical` on `claude/support-ticket-structure-xMcy8`, PR [#277](https://github.com/michaelhazza/automation-v1/pull/277). Phase 2 (BUILD) complete; handoff at `tasks/builds/support-desk-canonical/handoff.md`. Recover by reverting `current-focus.md` to that build when ready to finalise PR #277.

---

**Pick-next queue:** See `tasks/todo.md` for the durable backlog.

**Prior merges:** see `git log --merges main` or the per-build handoffs under `tasks/builds/<slug>/handoff.md`. The historical merge log that previously lived in this file was trimmed 2026-05-13 (commit on branch `claude/cleanup-todo-knowledge-5ALbK`); content is preserved in git history.
