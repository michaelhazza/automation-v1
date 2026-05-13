<!-- mission-control
active_spec: docs/superpowers/specs/2026-05-13-memory-improvements-spec.md
active_plan: tasks/builds/memory-improvements/plan.md
build_slug: memory-improvements
branch: claude/add-memvid-integration-ehAOr
status: BUILDING
last_updated: 2026-05-13
last_merge_ready_pr: none
last_merge_ready_slug: none
last_merge_ready_branch: none
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

**Active spec:** [`docs/superpowers/specs/2026-05-13-memory-improvements-spec.md`](../docs/superpowers/specs/2026-05-13-memory-improvements-spec.md) (Status: accepted, locked 2026-05-13)
**Active plan:** `tasks/builds/memory-improvements/plan.md` (pending — feature-coordinator writes this in Phase 2)
**Active build slug:** `memory-improvements`
**Branch:** `claude/add-memvid-integration-ehAOr`
**Status:** **BUILDING** — Phase 1 (SPEC) complete 2026-05-13. Phase 2 plan LOCKED 2026-05-13: 11 chunks across A synthesis lineage (`memory_block_version_sources`, migration 0333), B1+B2 citation-rate utility (`agent_runs.injected_entry_ids` migration 0334 + `mv_memory_utility_30d` migration 0343 with null-stable unique index for REFRESH CONCURRENTLY, COALESCEd aggregate totals, jsonb_typeof guards), D semantic ranker for AKR (env-flagged, no UI). chatgpt-plan-review 2 rounds — R1 closed 2 BLOCKERs + 6 TIGHTENINGs (commit `331ee9cc`); R2 closed 3 BLOCKERs + 4 TIGHTENINGs + 1 polish, R2 APPROVED. All 15 findings TECHNICAL, auto-applied. Phase 1 handoff updated with resume contract for Sonnet execution session: `tasks/builds/memory-improvements/handoff.md`. Plan: `tasks/builds/memory-improvements/plan.md`. **Next:** operator opens new Claude Code session on Sonnet, runs the chunk loop against the locked plan.

**Last merged:** PR #288 — `operator-backend` (squash-commit `83fd8347`, 2026-05-13). Operator Backend = first concrete adapter for delegated long-running operator-managed tasks. Phase 3 handoff: `tasks/builds/operator-backend/handoff.md`.

**Paused build:** `support-desk-canonical` on `claude/support-ticket-structure-xMcy8`, PR [#277](https://github.com/michaelhazza/automation-v1/pull/277). Phase 2 (BUILD) complete; handoff at `tasks/builds/support-desk-canonical/handoff.md`. Recover by reverting `current-focus.md` to that build when ready to finalise PR #277.

---

**Pick-next queue:** See `tasks/todo.md` for the durable backlog.

**Prior merges:** see `git log --merges main` or the per-build handoffs under `tasks/builds/<slug>/handoff.md`. The historical merge log that previously lived in this file was trimmed 2026-05-13 (commit on branch `claude/cleanup-todo-knowledge-5ALbK`); content is preserved in git history.
