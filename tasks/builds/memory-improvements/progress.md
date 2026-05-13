# Memory Improvements — Phase 1 Progress

**Build slug:** `memory-improvements`
**Branch:** `claude/add-memvid-integration-ehAOr`
**Phase:** 1 (SPEC)
**Started:** 2026-05-13
**Scope class:** Major
**UI-touching:** yes (mockup loop pre-complete)

## Phase 1 status

| Step | Status | Notes |
|------|--------|-------|
| 0. Context loading + PLANNING lock | done | lock acquired commit `b5729f48` |
| 1. TodoWrite emitted | done | 11 items |
| 2. S0 branch-sync | done | merged `main` (PR #291 personal-assistant-v1) cleanly via commit `d4cadaf`; post-merge typecheck deferred (npm install blocked by SSL cert — operator-approved skip; markdown-only authoring unaffected) |
| 3. Brief intake + UI-touch | done | Scope: Major. UI-touch: yes. Mockups pre-locked. |
| 4. Build slug + directory | done | slug `memory-improvements`, dir pre-existing |
| 5. Mockup loop | skipped | brief Rev 6.3 LOCKED references prototypes/memory-improvements/ as design source of truth; 3 mockup rounds already complete |
| 6. Spec authoring | pending | target `docs/superpowers/specs/2026-05-13-memory-improvements-spec.md` |
| 7. spec-reviewer | pending | |
| 8. chatgpt-spec-review | pending | MANUAL mode |
| 9. Handoff write | pending | |
| 10. current-focus.md → BUILDING | pending | |
| 11. End-of-phase prompt + auto-commit | pending | |

## Mockup state (pre-locked)

| File | Surface | Status |
|------|---------|--------|
| `prototypes/memory-improvements/index.html` | Landing | done |
| `prototypes/memory-improvements/memory-block-detail.html` | Proposal A — Sources tab on MemoryBlockDetailPage | done |
| `prototypes/memory-improvements/citation-utility-dashboard.html` | Proposal B2 — Memory Utility tab on UsagePage | done |
| `prototypes/memory-improvements/rationale.html` | CEO-level UI rationale (operator doc, not a screen) | done |
| `prototypes/memory-improvements/akr-ranker-settings.html` | retired in Rev 6 — staged-rollout dropped | n/a |

## Brief reference

Source brief: `tasks/builds/memory-improvements/brief.md` (Rev 6.3, LOCKED 2026-05-12)

## Phase 1 decisions log

**Spec-reviewer iteration 1 (REVIEW_GAP — Codex unavailable; rubric pass applied 12 mechanical fixes):**
- Migration numbers shifted `0330→0333`, `0331→0334` (avoid collision with `external_source_triggers` and `system_agents_home_widget`).
- Pinned write site `agentExecutionService.ts:1349-1356`.
- Pinned route guard `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`.
- Added `idx_mbvs_source_entry_hash` index for reverse-lineage query.
- Aligned Usage route to existing `/api/orgs/:orgId/usage/<surface>` convention with `SETTINGS_VIEW` guard.
- Corrected stale line anchors in §8.2 cache-boundary discussion.
- Made NULL-discriminator asymmetry explicit in §3.5 / §3.6.
- Spec frontmatter: `Status: draft → reviewing`.

**Open-question resolutions (operator-approved 2026-05-13):**
- **Q1 (D query):** Task description only. Rationale: cleanest, lowest cost, falsifiable via B1 within ~2 weeks of enablement.
- **Q2 (D threshold):** Default `AKR_RETRIEVAL_THRESHOLD = 0.30` with mandatory build-phase spot-check of ~10 dev runs before any enablement. Adjust to `0.25` if filtering rejects >50% of recall-relevant chunks.
- **Q5 (MV refresh window):** **16:00 UTC nightly** (AU 02:00 AEST / 03:00 AEDT). Originally 03:00 UTC, changed after operator flagged AU customer-base timezone collision. Operator note: "we are focused for Australian clients to start with, [03:00 UTC] is during the day for us."
- **Q7 (coverage metric):** Deferred explicitly. Different operator question from utility; belongs as follow-up extension of `retrievalObservabilityService`.

Q3, Q4, Q6 were resolved by spec-reviewer iteration 1 (see above).

**No open questions remain at spec-lock.** Spec is technically ready for chatgpt-spec-review (Step 8).

**ChatGPT spec-review Round 1 (CHANGES_REQUESTED → auto-applied):**
- F1: B2 dashboard time-series — added §6.6 contract with `agents[]` + `dailySeries[]`; new `memoryUtilityDailySeriesPure.ts` in inventory.
- F2: Reverse-lineage default-off (corrected §15 Q6 against §6.1).
- F3: Path-org / session-org 403-before-query rule in §7.3 + §7.4.
- T1: `onConflictDoNothing` clause + per-block-version idempotency scoping.
- T2: Source-run provenance verification step.
- T3: `source_type` narrowed to `'workspace_memory'` for v1.
- T4: Threshold spot-check moved from spec to handoff acceptance checklist.
- W1: §13.5 terminal-event wording tightened.

**ChatGPT spec-review Round 2 (APPROVED — spec locked):**
- R2-T1 (banner copy): operator-approved.
- R2-T2: daily-series test added to §12.1.

Spec frontmatter: `Status: reviewing → accepted`. Phase 1 complete.
