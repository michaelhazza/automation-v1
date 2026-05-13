<!-- mission-control
active_spec: none
active_plan: none
build_slug: none
branch: none
status: NONE
last_updated: 2026-05-13T00:22:37Z
last_merged_pr: #288
last_merged_slug: operator-backend
last_merged_branch: claude/sandbox-execution-provider-DLfjn
last_merged_at: 2026-05-13T00:22:37Z
last_merged_commit: 83fd8347
-->

# Current Focus

Sprint-level pointer for the active session. Update when the current spec, branch, or sprint changes. If no spec is in flight, leave the fields below set to `none`.

The HTML comment block at the top is read by the Mission Control dashboard (`tools/mission-control/`). Keep prose in sync; prose is canonical if they disagree. Status enum: `PLANNING` | `BUILDING` | `REVIEWING` | `MERGE_READY` | `MERGED` | `NONE`.

Per-session progress goes in `tasks/builds/<slug>/progress.md`, not here. Historical merge log lives in git (`git log --merges main`) and in per-build handoff files under `tasks/builds/<slug>/handoff.md`.

---

**Active spec:** none
**Active plan:** none
**Active build slug:** none
**Branch:** none
**Status:** **NONE**

**Last merged:** PR #288 — `operator-backend` (squash-commit `83fd8347`, 2026-05-13). Operator Backend = first concrete adapter for delegated long-running operator-managed tasks. Phase 3 handoff: `tasks/builds/operator-backend/handoff.md`.

**Paused build:** `support-desk-canonical` on `claude/support-ticket-structure-xMcy8`, PR [#277](https://github.com/michaelhazza/automation-v1/pull/277). Phase 2 (BUILD) complete; handoff at `tasks/builds/support-desk-canonical/handoff.md`. Recover by reverting `current-focus.md` to that build when ready to finalise PR #277.

---

**Pick-next queue:** See `tasks/todo.md` for the durable backlog.

**Prior merges:** see `git log --merges main` or the per-build handoffs under `tasks/builds/<slug>/handoff.md`. The historical merge log that previously lived in this file was trimmed 2026-05-13 (commit on branch `claude/cleanup-todo-knowledge-5ALbK`); content is preserved in git history.
