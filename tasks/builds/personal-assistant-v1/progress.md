# Build progress — personal-assistant-v1

**Build slug:** personal-assistant-v1
**Branch:** claude/synthetos-personal-assistant-0kaIM
**Started:** 2026-05-12
**Strategic parent:** `docs/synthetos-governed-agentic-os-brief-v1.2.md` §16.1 (Executive Assistant)
**Locked predecessor:** `tasks/builds/user-owned-agents/brief.md` (foundation primitive — must MERGE before Phase 2 BUILD starts)

## Phase status

| Phase | Status | Artefact |
|---|---|---|
| Phase 1 — SPEC | COMPLETE | `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md` |
| Phase 2 — BUILD | COMPLETE (2026-05-13) | `tasks/builds/personal-assistant-v1/plan.md` (25 chunks; all built + reviewed) |
| Phase 3 — FINALISATION | NOT_STARTED | — |

## Decisions captured this phase

- 2026-05-12 — Mockup loop skipped. Operator accepted the 3 existing locked mockups in `prototypes/personal-assistant-v1/` (01-first-run-setup, 02-my-ea-home, 03-ea-settings) as the spec's design source of truth.
- 2026-05-12 — Phase 1 proceeds in parallel with `user-owned-agents` Phase 1. Build (Phase 2) for EA V1 is explicitly gated on the predecessor reaching MERGED.

## Open at start of Phase 1

- §4 in brief lists 8 architectural questions. Items 1–8 are all LOCKED per operator on 2026-05-12 chat per brief §0.5.5 and §4.
- Spec-time confirmations (per brief): Calendar action risk-tier justification (Tier 4 vs Tier 6 for internal-to-colleague calendar events); Slack `channels:history` scope add for `slack.read_channel`; Slack `im:write` scope add for `slack.post_dm`; `slack.search_messages` workspace-scope availability (paid plans only); Calendar event_imminent lookahead value(s); EA agent's `Specialist` agentRole vs alternatives.

## Notes

- Branch already carries 4 commits on the brief + mockup rounds (3b8e9021, 83bdad85, 6ca0e71e, e3fb23e5).
- Predecessor brief at `tasks/builds/user-owned-agents/brief.md` — status DRAFT, no spec authored yet.

## Phase 3 — FINALISATION

Not yet started. Run `launch finalisation` in a new session.

## Phase 2 — BUILD log

- 2026-05-12T07:25Z — Coordinator adopted inline per operator instruction (`launch feature co-ordinator from spec`).
- 2026-05-12T07:25Z — S1 branch-sync: clean. No new origin/main commits to merge. No migration-number collisions.
- 2026-05-12T07:36Z — architect returned 22-chunk plan at `tasks/builds/personal-assistant-v1/plan.md` (862 lines). All chunks carry `spec_sections`, `files`, `contracts`, `error handling`, `dependencies`, `acceptance`. §27 open questions all resolved; Q12 verified satisfiable. Zero `SPEC_REVISION_NEEDED` findings.
- 2026-05-12T07:36Z — Predecessor gate: chunk 1 includes a pre-check for `agents.owner_user_id`, broker `injectIntoEnvironment({ ownerUserId? })`, and 11 other predecessor primitives. Builder returns `PLAN_GAP` if any are missing.
- 2026-05-12T07:45Z — chatgpt-plan-review round 1 completed. Operator pasted 4 findings; all auto-applied per `feedback_review_triage.md` (technical, including 2 blockers): **F1** (blocker) EA draft service relocated from chunk 13 to chunk 6; downstream chunks renumbered (Calendar 6→7, Slack 7→8, ext-source triggers 8→9, Gmail/Calendar jobs 9→10, capabilityGroups 10→11, VoiceProfile service 11→12 with 11b→12b, VoiceProfile route 12→13). **F2** (blocker) Calendar (chunk 7) + Slack (chunk 8) write-action invariant now requires `actions.status = 'approved'` AND `ea_drafts.send_state = 'idle'`; explicit prohibition on `ea_drafts.state` and `ea_drafts.send_state = 'approved'`; grep gate added in chunk 6 acceptance. **F3** (required) migration 0330 split into 0330_system_agents_home_widget (generic column with refuse-to-drop down-script guard) + 0331_executive_assistant_seed (EA-only row + partial index). **T1** chunk 6 approval-routing wording no longer points at chunk 14; now reads "commit hook routes to the action handler for the draft's `kind` (Gmail send via existing send_email handler; Calendar write via chunk 7; Slack write via chunk 8)".

- 2026-05-12T~08:00Z — chatgpt-plan-review round 2 completed. Operator pasted 3 findings; all auto-applied (technical, including 2 blockers): **F1** (blocker) Chunk 14 had a forward dependency on Chunk 17 (permissions); permission keys extracted into new Chunk 13a before Chunk 14. **F2** (blocker) Chunk 14 read `system_agents.home_widget` from Chunk 15 (forward dep); DDL + Drizzle field extracted into new Chunk 13b before Chunk 14. **F3** (required) Chunk 16 (workflow skills) came after Chunk 15 (EA seed), but seed references skill slugs; Chunk 16 renamed Chunk 15a and moved before Chunk 15. Old Chunk 16 retired (redirect stub left in plan.md). Q8 "Where realised" updated from Chunk 17 → Chunk 13a. Plan is now forward-only in all dependency chains.

## Plan summary (post chatgpt-plan-review rounds 1 + 2)

- **Chunks:** 25 logical chunks: 1–13, 13a, 13b, 14, 15a, 15, 17, 18, 19a/b/c (12b sub-chunk included; Chunk 16 retired).
- **Migrations:** 0327 voice_profiles, 0328 ea_drafts, 0329 external_source_triggers + agent_triggers.event_type enum add, **0330 system_agents.home_widget column (generic, chunk 13b, with refuse-to-drop guard)**, **0331 executive_assistant seed + partial index (EA-only, chunk 15)**.
- **Top 3 risks:** R1 predecessor primitives unmerged; R2 enum-add migration race; R6 EA draft + action row out of sync.
- **§27 decisions:** Q1 Tier 3 + review-gate; Q3 1-min cadence + 5-min 429-fallback; Q4 15-min global constant; Q5 `agentRole: 'Specialist'`; Q7 no stub agent (integration test as proof); Q8 `EA_PROVISION` default-granted; Q12 FK shape verified satisfiable.
- **Approval-state ownership invariant (F2):** approval state lives on `actions` (`pending_approval -> approved | rejected | expired`); `ea_drafts` stores ONLY `send_state` (`idle -> sending -> sent | send_failed`). No code may reference `ea_drafts.state` or `ea_drafts.send_state = 'approved'`. Chunk-6 grep gate enforces this across `server/` `shared/` `client/`.
