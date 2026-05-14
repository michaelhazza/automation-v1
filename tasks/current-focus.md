<!-- mission-control
active_spec: none
active_plan: none
build_slug: none
branch: none
status: MERGE_READY
last_updated: 2026-05-14
last_merge_ready_pr: #299
last_merge_ready_slug: personal-assistant-v2-operator
last_merge_ready_branch: claude/personal-assistant-post-merge-audit
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

**Status:** **MERGE_READY** — PR #299 (`personal-assistant-v2-operator`) finalised; ready-to-merge label applied 2026-05-14T00:12:11Z. CI now running on branch `claude/personal-assistant-post-merge-audit` at HEAD post-Phase-3.

PR #299: Personal Assistant V2 (Operator Mode) — cross-owner delegation + live file events. Major build. 7 rounds of chatgpt-pr-review (APPROVED on Round 7); 22 findings applied; 4 backlog items routed to `tasks/todo.md`. Mid-Phase-3 main-sync handled the iee-browser-on-e2b PR #297 collision: 6 V2 migrations renumbered 0346–0351 → 0351–0356; EA controller-style flip renumbered 0345 → 0357.

**Just merged:** PR #297 — `iee-browser-on-e2b` (squash-commit `8008abae`, 2026-05-14). IEE browser substrate redirect from DigitalOcean to e2b sandboxes: 3 new tables (session profiles, per-subaccount settings, warm sessions), dispatch seam in `_ieeShared.ts::ieeDispatchBrowser`, profile manager + warm pool service scaffolds (RUNTIME-DISABLED until SDK lands), DigitalOcean retirement + CI gate. chatgpt-pr-review APPROVED after 4 rounds (28 findings closed); 9 deferred items as IEE-DEF-1..9. Phase 3 handoff: `tasks/builds/iee-browser-on-e2b/handoff.md`.

Build artefacts: `tasks/builds/personal-assistant-v2-operator/`. Phase 3 handoff section: `tasks/builds/personal-assistant-v2-operator/handoff.md § Phase 3 (FINALISATION) — complete`. chatgpt-pr-review log: `tasks/review-logs/chatgpt-pr-review-personal-assistant-v2-operator-2026-05-13T22-55-35Z.md`.

**Last merged:** PR #296 — `claude/close-deferred-pa-v1-13lHR` (commit `27b00d1d`, 2026-05-13). Closed all deferred PA-V1 items + adversarial findings; idempotency-key discriminator pattern extracted to `KNOWLEDGE.md`.

**Paused build:** `support-desk-canonical` on `claude/support-ticket-structure-xMcy8`, PR [#277](https://github.com/michaelhazza/automation-v1/pull/277). Phase 2 (BUILD) complete; handoff at `tasks/builds/support-desk-canonical/handoff.md`. Recover by reverting `current-focus.md` to that build when ready to finalise PR #277.

---

**Pick-next queue:** See `tasks/todo.md` for the durable backlog.

**Prior merges:** see `git log --merges main` or the per-build handoffs under `tasks/builds/<slug>/handoff.md`. The historical merge log that previously lived in this file was trimmed 2026-05-13 (commit on branch `claude/cleanup-todo-knowledge-5ALbK`); content is preserved in git history.
