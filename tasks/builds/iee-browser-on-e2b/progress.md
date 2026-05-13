# Progress — iee-browser-on-e2b

**Build slug:** `iee-browser-on-e2b`
**Branch:** `claude/migrate-browser-e2b-snI99`
**Scope class:** Major (new subsystem + cross-cutting + architectural)
**Spec:** `tasks/builds/iee-browser-on-e2b/spec.md` (to be authored)
**Brief:** `tasks/builds/iee-browser-on-e2b/brief.md` (LOCKED v7, 2026-05-13)

## Phase 1 status

| Step | Status | Notes |
|---|---|---|
| 0. Context loading + PLANNING lock | done | current-focus.md switched from REVIEWING (fleet-and-codebase-health, different branch) to PLANNING (iee-browser-on-e2b) per operator override; fleet build preserved as paused entry |
| 1. TodoWrite list | done | 11-item list emitted |
| 2. Branch-sync S0 | done | 1 commit behind main (green); merged 2bdebb83 (chatgpt-pr-review codification + spec-authoring-checklist updates); npm install + typecheck clean; no overlap with feature change-set |
| 3. Brief intake + UI-touch | done | Brief LOCKED v7. Major scope. UI-touching (4 new + 3 removed fields on Operator settings tab + role-visibility change) |
| 4. Build slug + directory | done | Slug `iee-browser-on-e2b`, directory pre-existing from mockup work |
| 5. Mockup loop | done | Rounds 1, 2, 3, 3.1 complete and committed before this session. `prototypes/iee-browser-on-e2b.html` is the locked design |
| 6. Spec authoring | done | `tasks/builds/iee-browser-on-e2b/spec.md` (initial 627 lines / 50KB → after 4 review rounds ~755 lines, architecture-level). Authored via chunked workflow. **Status: LOCKED.** |
| 7. spec-reviewer (Codex) | gap (REVIEW_GAP) | Local Codex CLI is v0.118.0; configured default `gpt-5.5` model requires v0.125+. Other ChatGPT-account models all rejected. No iteration ran, no spec edits made. Plan file at `tasks/review-logs/spec-review-plan-iee-browser-on-e2b-2026-05-13T120000Z.md` is informational only. Pre-emptive citation observation (§3.13 vs §3.15) investigated and dismissed. **0 of 5 iterations consumed**; full budget available post-CLI upgrade. |
| 8. chatgpt-spec-review (manual) | **DONE — APPROVED** | Operator changed mind post-handoff and ran chatgpt-spec-review. 4 manual rounds: R1 CHANGES_REQUESTED (12 findings, 4 high blockers) → R2 NEEDS_MINOR_TIGHTENING (7, 2 medium + 5 low) → R3 APPROVED WITH MINOR EDITS (6, 1 medium + 5 low) → R4 **APPROVED** (1 low). 26 findings applied. Commits: `134201c6`, `81583ffe`, `41f8d327`, final. Session log: `tasks/review-logs/chatgpt-spec-review-iee-browser-on-e2b-2026-05-13T07-00-00Z.md`. PR: [#297](https://github.com/michaelhazza/automation-v1/pull/297). |
| 9. Handoff write | done (amended post-review) | `tasks/builds/iee-browser-on-e2b/handoff.md` — chatgpt-spec-review REVIEW_GAP closed; only spec-reviewer (Codex) gap remains (environment, not spec). |
| 10. current-focus.md → BUILDING | done | Set 2026-05-13 end of Phase 1 base flow; remained BUILDING through the chatgpt-spec-review re-open. |
| 11. End-of-phase prompt + auto-commit | done (multiple) | Base Phase 1 commit `2be15c04`; chatgpt-spec-review rounds 1-4 commits; final commit forthcoming with finalisation artefacts. |

## Decisions made in Phase 1

1. **PLANNING lock override** (operator 2026-05-13). current-focus.md was REVIEWING for sibling `fleet-and-codebase-health` on a different branch; operator chose to switch the pointer to iee-browser-on-e2b. Fleet build preserved as paused entry for later restore.
2. **Brief v7 committed** (538641cd, 2026-05-13). Pre-lock cleanup: 8 v7 findings folded into the brief (TOC drift, parallel-run/shadow tests removed, cost-report reclassified, Status UI vs rollout enablement separated, warm-pool activation boundary, §7 step 4 stale wording, prototype role-visibility comment, profile security invariants).
3. **Sibling-table choice for browser profile state** (spec author 2026-05-13, ratified in spec §3 locked decision 3). New table `iee_browser_session_profiles` keyed on `(organisation_id, subaccount_id, session_key)` rather than extending `operator_task_profiles` keyed on `(task_id, attempt_number)`. Rationale: many tasks share one profile here; one profile per task attempt there.
4. **Sibling-table choice for IEE browser settings** (spec author 2026-05-13). New table `subaccount_iee_browser_settings` rather than extending `subaccount_operator_settings`. Rationale: matches existing per-concern isolated-table pattern (operator vs optimiser settings already split).
5. **Cost-row discriminator via `llm_requests.subtype` column** (spec author 2026-05-13). New nullable column with CHECK constraint enforcing it is non-null only when `source_type='sandbox_compute'`. Enables warm-pool vs task cost separation without a new table.
6. **`session_key` derivation policy = path (b)** (operator 2026-05-13). Per-skill derivation with `'default'` fallback. Cookie isolation between unrelated browser skills is defensive-by-default; rollback to (a) is trivial.
7. **`docs/iee-development-spec.md` Part 10 disposition = split** (operator 2026-05-13). Phase 2 creates new `docs/iee-on-e2b-rollout.md` and deletes legacy Part 10. Cleaner separation than rewriting.
8. **chatgpt-spec-review reopened post-handoff** (operator 2026-05-13). After initially skipping with REVIEW_GAP, operator decided to run manual review. 4 rounds, 26 findings, final verdict APPROVED. Spec amendments significant: new `browser_warm_sessions` table; admin rollout-approval route; null-safe CHECK constraints; FK ON DELETE RESTRICT; idle-duration formula; CI acceptance gate.
9. **All design-level open questions resolved before Phase 2 start.** Two original opens (`session_key` derivation, Part 10 disposition) decided in Phase 1 base flow; one new design choice (admin rollout-approval mutation path) decided in R1.

## Open questions for Phase 2

Two design-level open questions resolved in Phase 1 (recorded as DECIDED in spec §17). Remaining items are Phase 2 lookups:

- Sandbox provider implementation exact file path (Phase 2 chunk 1 confirms).
- Pre-existing host-disk profile migration handling (Phase 2 chunk 5 confirms; likely no-op since dogfood-first launch).

## Phase 2 status

**Completed:** 2026-05-14

| Step | Status | Notes |
|---|---|---|
| Plan locked | done | `tasks/builds/iee-browser-on-e2b/plan.md` — 19 chunks, LOCKED after 2 ChatGPT plan-review rounds |
| Chunks 1–15B | done | All built, G1 gate passed per chunk. Commits c40a37db–383f5af6 |
| Chunk 16 | done | IEE browser operator settings UI (`_fields.tsx`, `OperatorSettingsTab.tsx`, `AdminSubaccountDetailPage.tsx`). Commit 4464966c |
| Chunk 17 | done | DigitalOcean retirement + CI gate (`verify-no-do-references.sh`, worker files deleted). Commit e3a001be |
| Chunk 18 | done | Doc-sync post-DO-retirement (`docs/iee-on-e2b-rollout.md`, cost-report placeholder, calendar todo). Commit 831b0c58 |
| G2 gate | done | `npm run lint` + `npm run typecheck` + `npm run build:server` + `npm run build:client` all clean |
| spec-conformance | CONFORMANT_AFTER_FIXES | Removed `autoExtendGraceMinutes` NumberField from OperatorSettingsTab (now a server-side constant). Log: `tasks/review-logs/spec-conformance-log-iee-browser-on-e2b-2026-05-13T13-16-18Z.md`. Commit e7271991 |
| pr-reviewer (post-conformance) | APPROVED — 0 blocking | Initial pass: CHANGES_REQUESTED (4 blocking RLS issues B1-B4). RLS fix applied (commit e9293275); re-review: APPROVED (0 blocking, 3 strong, 4 non-blocking) |
| RLS fix (B1-B4) | done | `browserWarmPool`, `ieeBrowserProfileManager`, `_ieeShared`, `ieeBrowserDailyRollupJob` — all FORCE RLS tables now use `setOrgAndSubaccountGUC` inside transactions; daily rollup uses `withAdminConnection + SET LOCAL ROLE admin_role`. Commit e9293275 |
| reality-checker | READY (9/9) | All criteria verified via deterministic checks and pr-reviewer log. Log: `tasks/review-logs/reality-check-log-iee-browser-on-e2b-2026-05-13T14-00-00Z.md` |
| dual-reviewer (Codex) | done | Applied 4 fixes: dispatch safety (`_ieeShared.ts` `mounted=null` guard), upsert race fix (`ieeBrowserProfileManager.ts` INSERT ON CONFLICT), migration backfill, compose cleanup. Commit 3c44e44c |
| adversarial-reviewer | policy-not-applicable | Diff touches FORCE RLS tables but all scoped writes use `setOrgAndSubaccountGUC` per pr-reviewer APPROVED; no auth/token/webhook surface matching §5.1.2 auto-trigger conditions |
| doc-sync | done | All changed domains updated in same commit: `architecture.md`, `KNOWLEDGE.md`, `docs/iee-on-e2b-rollout.md`, `docs/iee-development-spec.md` Part 10 replaced, `docker-compose.yml` comments updated |
| Phase 3 handoff | this file | Ready for `launch finalisation` |

### Deferred items (non-blocking, TODO comments in code)
- `browserWarmPool.evictStale` — outer FOR UPDATE SKIP LOCKED still without `withAdminConnection`; not on critical dispatch path; zero callers of evictStale outside its own definition
- `browserWarmPool.refillIfEligible` — dead code (zero callers); TODO: add `organisationId` + dual-GUC when wired
- `ieeBrowserProfileManager.gcSweep` — cross-tenant sweep, TODO: `withAdminConnection`; dead code

### REVIEW_GAPs
None — all mandatory reviewers for Major class ran and completed.

## Concurrent build note

`fleet-and-codebase-health` (REVIEWING, on `codebase-health` branch) was active when this Phase 1 was launched. Operator chose to switch current-focus.md to iee-browser; fleet build is recorded in the `Paused build` section of current-focus.md for restore when work returns to that branch.
