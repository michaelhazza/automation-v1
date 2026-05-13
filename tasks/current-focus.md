<!-- mission-control
active_spec: none
active_plan: none
build_slug: none
branch: none
status: MERGE_READY
last_updated: 2026-05-13T23:25:46Z
last_merge_ready_pr: #297
last_merge_ready_slug: iee-browser-on-e2b
last_merge_ready_branch: claude/migrate-browser-e2b-snI99
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

**Status:** **MERGE_READY** — PR [#297](https://github.com/michaelhazza/2026-05-13/pull/297) (`iee-browser-on-e2b` on `claude/migrate-browser-e2b-snI99`). chatgpt-pr-review APPROVED after 4 rounds (R1: 9 fixes, R2: 10 fixes, R3: 6 fixes, R4: 3 cleanups). Doc-sync sweep complete. KNOWLEDGE.md updated (4 patterns). 9 deferred items queued as IEE-DEF-1..9 in `tasks/todo.md`. ready-to-merge label applied 2026-05-13T23:25:46Z. CI monitoring + auto-merge in progress.

Phase 3 handoff: `tasks/builds/iee-browser-on-e2b/handoff.md` (Phase 3 section appended).

**Last merged:** PR #288 — `operator-backend` (squash-commit `83fd8347`, 2026-05-13). Operator Backend = first concrete adapter for delegated long-running operator-managed tasks. Phase 3 handoff: `tasks/builds/operator-backend/handoff.md`.

**Paused build (concurrent, different branch):** `fleet-and-codebase-health` on `codebase-health` branch (Branch 2 of 2). Status was REVIEWING when this iee-browser session was launched. Handoff: `tasks/builds/fleet-and-codebase-health/handoff-branch-2.md`. Progress: `progress-branch-2.md`. Sibling Branch 1 (`fleet-and-process` / PR #293) is APPROVED. To resume: switch to `codebase-health` branch and restore this pointer to `active_spec: tasks/builds/fleet-and-codebase-health/spec.md` / `build_slug: fleet-and-codebase-health` / `status: REVIEWING`.

**Paused build:** `support-desk-canonical` on `claude/support-ticket-structure-xMcy8`, PR [#277](https://github.com/michaelhazza/automation-v1/pull/277). Phase 2 (BUILD) complete; handoff at `tasks/builds/support-desk-canonical/handoff.md`. Recover by reverting `current-focus.md` to that build when ready to finalise PR #277.

---

**Pick-next queue:** See `tasks/todo.md` for the durable backlog.

**Prior merges:** see `git log --merges main` or the per-build handoffs under `tasks/builds/<slug>/handoff.md`. The historical merge log that previously lived in this file was trimmed 2026-05-13 (commit on branch `claude/cleanup-todo-knowledge-5ALbK`); content is preserved in git history.
