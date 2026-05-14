<!-- mission-control
active_spec: tasks/builds/skill-merge-consolidation-pass/spec.md
active_plan: tasks/builds/skill-merge-consolidation-pass/plan.md
build_slug: skill-merge-consolidation-pass
branch: claude/improve-skill-analyzer-RiFpB
status: REVIEWING
last_updated: 2026-05-14T03:25:00Z
last_merged_pr: #299
last_merged_slug: personal-assistant-v2-operator
last_merged_branch: claude/personal-assistant-post-merge-audit
last_merged_at: 2026-05-14T00:44:20Z
last_merged_commit: 6cd7e158
-->

# Current Focus

Sprint-level pointer for the active session. Update when the current spec, branch, or sprint changes. If no spec is in flight, leave the fields below set to `none`.

The HTML comment block at the top is read by the Mission Control dashboard (`tools/mission-control/`). Keep prose in sync; prose is canonical if they disagree. Status enum: `PLANNING` | `BUILDING` | `REVIEWING` | `MERGE_READY` | `MERGED` | `NONE`.

Per-session progress goes in `tasks/builds/<slug>/progress.md`, not here. Historical merge log lives in git (`git log --merges main`) and in per-build handoff files under `tasks/builds/<slug>/handoff.md`.

---

**Active spec:** tasks/builds/skill-merge-consolidation-pass/spec.md
**Active plan:** tasks/builds/skill-merge-consolidation-pass/plan.md
**Active build slug:** skill-merge-consolidation-pass
**Branch:** claude/improve-skill-analyzer-RiFpB
**Status:** **REVIEWING**

**Active build:** `skill-merge-consolidation-pass` — adds a conditional LLM consolidation pass to the skill analyzer's merge pipeline. Fires only when `validateMergeOutput` emits `SCOPE_EXPANSION` / `SCOPE_EXPANSION_CRITICAL`. Spec at `tasks/builds/skill-merge-consolidation-pass/spec.md` (3 ChatGPT review rounds + Phase 2 amendment for `not_shortened` failureReason). Plan at `tasks/builds/skill-merge-consolidation-pass/plan.md` (1 ChatGPT plan-review round complete). Task class: Significant. Migration `0358` (renumbered from 0351 after PR #299 occupied slots 0351–0357).

**Phase 2 complete (2026-05-14T03:25:00Z).** 4 chunks built, branch-level review pass complete: spec-conformance CONFORMANT_AFTER_FIXES (3 mechanical gaps auto-fixed); adversarial-reviewer HOLES_FOUND advisory (6 items routed to backlog); pr-reviewer rounds 1→3 closing with APPROVED (round 1 found 3 blockers — consolidation success path was structurally unreachable due to rationale-stripping; resolved in fix-loop commit 17d9d930); reality-checker READY; dual-reviewer APPROVED with 1 ACCEPT applied (non-shortening outputs routed to `failed` — commit b7432cf1). Doc-sync gate: architecture.md + capabilities.md + KNOWLEDGE.md updated. Handoff at `tasks/builds/skill-merge-consolidation-pass/handoff.md`. Next: open a new Claude Code session and type `launch finalisation`.

**Last merged:** PR #299 — `personal-assistant-v2-operator` (squash-commit `6cd7e158`, 2026-05-14T00:44:20Z). Personal Assistant V2 (Operator Mode): cross-owner delegation pattern, live file events via R2 + UPSERT-derived version, capability-map V2 axis (`owner_user_id`), three-state owner-lookup privacy projection enforced at both service and route layers with org-scoped fail-closed, atomic claim+emit pattern for cross-owner timeout events with stale-claim TTL retry, DB trigger to auto-bump substep status-transition timestamp. 7 rounds of chatgpt-pr-review (APPROVED on Round 7); 22 findings applied; 4 backlog items routed to tasks/todo.md (PA-V2-LIST-APPROVALS-V1-ARM, PA-V2-WATCHER-HOST-BRIDGE, PA-V2-OPERATOR-TEMPLATE-PROMOTION, PA-V2-EVENT-IDEMPOTENCY). Mid-Phase-3 main-sync renumbered 6 V2 migrations to 0351-0356 (after main's iee-browser-on-e2b PR #297 claimed 0346-0350), plus EA controller-style flip moved 0345 → 0357. CI auto-fix loop closed: 2 iterations (RLS-gate single-line CREATE POLICY + action-registry snapshot refresh; then PDF determinism standalone-date-literal normaliser fix).

**Prior merge:** PR #297 — `iee-browser-on-e2b` (squash-commit `8008abae`, 2026-05-14). IEE browser substrate redirect from DigitalOcean to e2b sandboxes: 3 new tables (session profiles, per-subaccount settings, warm sessions), dispatch seam in `_ieeShared.ts::ieeDispatchBrowser`, profile manager + warm pool service scaffolds (RUNTIME-DISABLED until SDK lands), DigitalOcean retirement + CI gate. chatgpt-pr-review APPROVED after 4 rounds (28 findings closed); 9 deferred items as IEE-DEF-1..9. Phase 3 handoff: `tasks/builds/iee-browser-on-e2b/handoff.md`.

**Paused build:** `support-desk-canonical` on `claude/support-ticket-structure-xMcy8`, PR [#277](https://github.com/michaelhazza/2025-automation/pull/277). Phase 2 (BUILD) complete; handoff at `tasks/builds/support-desk-canonical/handoff.md`. Recover by reverting `current-focus.md` to that build when ready to finalise PR #277.

---

**Pick-next queue:** See `tasks/todo.md` for the durable backlog.

**Prior merges:** see `git log --merges main` or the per-build handoffs under `tasks/builds/<slug>/handoff.md`. The historical merge log that previously lived in this file was trimmed 2026-05-13 (commit on branch `claude/cleanup-todo-knowledge-5ALbK`); content is preserved in git history.
