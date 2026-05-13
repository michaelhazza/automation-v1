<!-- mission-control
active_spec: none
active_plan: none
build_slug: none
branch: none
status: NONE
last_updated: 2026-05-13
last_merged_pr: #298
last_merged_slug: memory-improvements
last_merged_branch: claude/add-memvid-integration-ehAOr
last_merged_at: 2026-05-13T10:11:16Z
last_merged_commit: 2bd3d6d3
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

**Just merged:** PR [#298](https://github.com/michaelhazza/automation-v1/pull/298) — `memory-improvements` (squash-commit `2bd3d6d3`, 2026-05-13T10:11:16Z). Shipped 3 capabilities: synthesis lineage (`memory_block_version_sources` migration 0333, sources route + UI tab), citation-rate utility (migrations 0334 + 0345, materialised view with nightly 16:00 UTC refresh, dashboard tab), env-flagged AKR semantic ranker. 5 Phase 2 reviewers + chatgpt-pr-review (2 rounds, 11 findings auto-applied) + 1 CI fix-loop iteration (RLS-contract org-filter on tasks lookup); no REVIEW_GAP. 6 env-gated operational items deferred to pre-enablement before flipping AKR ranker flag.

**Previously merged:** PR #294 — `fleet-and-codebase-health` Branch 2 (gate fix + 9 route migrations + KNOWLEDGE/todo sweeps, 2026-05-13). Branch 1 (PR #293 — agent fleet upgrades + GRADED review posture) merged same session.

**Paused build:** `support-desk-canonical` on `claude/support-ticket-structure-xMcy8`, PR [#277](https://github.com/michaelhazza/automation-v1/pull/277). Phase 2 (BUILD) complete; handoff at `tasks/builds/support-desk-canonical/handoff.md`. Recover by reverting `current-focus.md` to that build when ready to finalise PR #277.

---

**Pick-next queue:** See `tasks/todo.md` for the durable backlog.

**Prior merges:** see `git log --merges main` or the per-build handoffs under `tasks/builds/<slug>/handoff.md`. The historical merge log that previously lived in this file was trimmed 2026-05-13 (commit on branch `claude/cleanup-todo-knowledge-5ALbK`); content is preserved in git history.
