# Handoff — iee-browser-on-e2b

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** `tasks/builds/iee-browser-on-e2b/spec.md`
**Brief path:** `tasks/builds/iee-browser-on-e2b/brief.md` (LOCKED v7)
**Branch:** `claude/migrate-browser-e2b-snI99`
**Build slug:** `iee-browser-on-e2b`
**UI-touching:** yes
**Mockup paths:** `prototypes/iee-browser-on-e2b.html` (locked at round 3.1)
**Mockup log:** `tasks/builds/iee-browser-on-e2b/mockup-log.md` (rounds 1, 2, 3, 3.1)
**Spec status:** **LOCKED** (chatgpt-spec-review APPROVED after 4 rounds, 26 findings applied)
**Scope class:** Major (new subsystem + cross-cutting + architectural)
**Spec date:** 2026-05-13
**Phase 1 completed:** 2026-05-13

## Review tier outcomes

| Reviewer | Outcome | Notes |
|---|---|---|
| `spec-reviewer` (Codex) | REVIEW_GAP (Codex-CLI environment) | Local Codex CLI v0.118.0 incompatible with configured `gpt-5.5` default model (needs v0.125+). No iteration ran, no spec edits made. Pre-emptive citation observation (§3.13 vs §3.15) investigated and dismissed — spec correctly cites §3.15 matching wire-truth in `server/db/schema/operatorTaskProfiles.ts:10`. **0 of 5 iterations consumed** — full budget available for any future Phase 2 spec-reviewer pass after CLI upgrade. |
| `chatgpt-spec-review` (manual) | **APPROVED** (4 rounds complete) | Operator changed mind after handoff write and chose to run chatgpt-spec-review. 4 manual rounds with ChatGPT-web: R1 = CHANGES_REQUESTED (12 findings, 4 high-severity blockers); R2 = NEEDS_MINOR_TIGHTENING (7 findings, 2 medium + 5 low); R3 = APPROVED WITH MINOR EDITS (6 findings, 1 medium + 5 low); R4 = **APPROVED** (1 low style finding only). 26 findings applied across rounds. Session log: `tasks/review-logs/chatgpt-spec-review-iee-browser-on-e2b-2026-05-13T07-00-00Z.md`. Commits: `134201c6`, `81583ffe`, `41f8d327`, final round 4 + finalisation. |

**REVIEW_GAP artefact (per CLAUDE.md) — only spec-reviewer remains gapped:**

```
REVIEW_GAP: spec-reviewer | task-class: Major | reason: local Codex CLI v0.118 < required v0.125 for default model gpt-5.5 | operator-override: no | remediation: upgrade `npm install -g @openai/codex@latest` and re-run if a Phase 2 spec amendment justifies the iteration cost; full 5-iteration budget remains available
```

The chatgpt-spec-review gap was closed by running rounds 1+2+3+4 (operator decision post-handoff). Final verdict APPROVED; no remaining implementation-readiness blockers.

## Decisions made in Phase 1

1. **PLANNING lock override.** current-focus.md was REVIEWING for sibling `fleet-and-codebase-health` on a different branch; operator switched the pointer. Fleet build preserved as paused entry for restore later.
2. **Brief v7 committed** (`538641cd`, 2026-05-13). 8 pre-lock findings folded in.
3. **Sibling-table architecture choice.** **Three** new tables (`iee_browser_session_profiles`, `subaccount_iee_browser_settings`, `browser_warm_sessions` — last added in chatgpt-spec-review R1 F1) rather than extending the operator-area tables. Rationale: different key shapes and concerns.
4. **Cost-row discriminator design.** `llm_requests.subtype` column + `warm_session_id` FK column (last added in chatgpt-spec-review R2 F3) with two null-safe CHECK constraints using `IS DISTINCT FROM` (R3 F2), rather than a new cost table.
5. **`session_key` derivation = path (b)** (operator 2026-05-13). Per-skill derivation with `'default'` fallback. Spec §14 locked.
6. **`docs/iee-development-spec.md` Part 10 disposition = split** (operator 2026-05-13). Phase 2 creates new `docs/iee-on-e2b-rollout.md` and deletes legacy Part 10.
7. **Concurrent build coexistence.** `fleet-and-codebase-health` (REVIEWING on `codebase-health` branch) and `iee-browser-on-e2b` (this build) coexist on separate branches; current-focus.md `Paused build` section records the fleet build for later resume.
8. **Admin rollout-approval route** (chatgpt-spec-review R1 F3). Operator-approved auditable mutation path for `subaccount_iee_browser_settings.rolloutApproved`: `POST /api/admin/iee-browser/rollout-approval/:subaccountId`, system-admin-only, ETag-protected via `expectedSettingsVersion` (R2 F4), emits audit-log row in the same transaction.
9. **FK action = `ON DELETE RESTRICT`** (chatgpt-spec-review R3 F3). `browser_warm_sessions` rows are never deleted by service code; FK from `llm_requests.warm_session_id` uses RESTRICT (not SET NULL) so any accidental DELETE surfaces as a constraint violation rather than silently nulling out idempotency-bearing data.
10. **Named CI acceptance gate for profile-mount serialization** (chatgpt-spec-review R2 F6). `server/services/sandbox/__tests__/ieeBrowserProfileManager.serialization.test.ts` is a plan-gate for chunk 5; the profile manager doesn't ship until this CI test confirms the e2b provider honours per-volume single-mount (Spec B invariant).

## Open questions for Phase 2 (lookups, not design)

1. **Sandbox provider implementation exact file path.** Spec §17 notes `server/services/sandbox/e2bSandbox.ts` as the likely path. First Phase 2 chunk confirms and updates the inventory if different.
2. **Pre-existing host-disk profiles.** If `BROWSER_SESSION_DIR` already contains data, Phase 2 chunk 5 decides whether to migrate or treat as no-op (likely no-op given dogfood-first launch).

## Phase 2 entry checklist

Operator switching to `feature-coordinator` should:

1. Read this handoff + the spec + the brief.
2. Confirm both REVIEW_GAPs are acceptable, or initiate the deferred review before plan authoring.
3. Invoke `architect` to break the 16-chunk order in spec §6 into builder-sized units.
4. The two open lookups above are first-chunk verifications, not blockers — they can be resolved inside the Phase 2 flow.

## Files written / modified in Phase 1

| Path | Action | Source step |
|---|---|---|
| `tasks/builds/iee-browser-on-e2b/brief.md` | v7 commit `538641cd` | Pre-step (uncommitted v7 → committed) |
| `prototypes/iee-browser-on-e2b.html` | v7 prototype comment fix in commit `538641cd` | Pre-step |
| `tasks/current-focus.md` | switched to PLANNING / iee-browser-on-e2b | Step 0 PLANNING lock |
| `tasks/builds/iee-browser-on-e2b/progress.md` | NEW — Phase 1 progress log | Step 4 |
| `tasks/builds/iee-browser-on-e2b/spec.md` | NEW — 627 lines, 50KB, accepted | Step 6 (chunked) |
| `tasks/builds/iee-browser-on-e2b/handoff.md` | NEW — this file | Step 9 |
| (merge commit) `chore(sync): merge main into claude/migrate-browser-e2b-snI99 (S0)` | S0 sync — 1 commit behind, merged 2bdebb83 (chatgpt-pr-review codification + spec-authoring-checklist updates) | Step 2 |
| `tasks/review-logs/spec-review-plan-iee-browser-on-e2b-2026-05-13T120000Z.md` | NEW (informational only) | Step 7 (spec-reviewer plan, no review ran) |

## Phase 2 commit posture

The end-of-phase auto-commit (Step 11) bundles the spec, handoff, progress, and the current-focus → BUILDING transition into a single coordinator commit. Phase 2 (`feature-coordinator`) starts from that commit.

## Verification surface for Phase 2

When Phase 2 starts, verify:

- `tasks/current-focus.md` mission-control block: `status: BUILDING`, `build_slug: iee-browser-on-e2b`, `active_spec: tasks/builds/iee-browser-on-e2b/spec.md`.
- `tasks/builds/iee-browser-on-e2b/spec.md` exists with `Status: accepted` frontmatter.
- This handoff file exists.

If any of those are missing, the auto-commit failed and Phase 2 should not proceed.

## End of handoff
