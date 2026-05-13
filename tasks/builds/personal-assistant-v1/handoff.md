# Handoff — personal-assistant-v1

**Phase complete:** BUILD (Phase 2)
**Next phase:** FINALISATION (run `launch finalisation` in a new session)
**Spec path:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`
**Plan path:** `tasks/builds/personal-assistant-v1/plan.md`
**Branch:** `claude/synthetos-personal-assistant-0kaIM`
**Build slug:** `personal-assistant-v1`
**PR:** [#291](https://github.com/michaelhazza/automation-v1/pull/291)
**Build completed:** 2026-05-13

---

## Phase 2 outcome

All 25 implementation chunks (0–19c) built and gated. All reviews passed:

| Review | Verdict | Notes |
|--------|---------|-------|
| G2 gate | PASS | 0 lint errors, 0 typecheck errors |
| spec-conformance | CONFORMANT_AFTER_FIXES | 2 mechanical fixes: Slack OAuth scopes `mpim:history` + `app_mentions:read` |
| adversarial-reviewer | HOLES_FOUND → FIXED | 5 confirmed/likely holes — all fixed inline (see below) |
| pr-reviewer | CHANGES_REQUESTED → FIXED | 7 blocking issues fixed (see below) |
| doc-sync | COMPLETE | architecture.md, capabilities.md, integration-reference.md, KNOWLEDGE.md updated |

---

## Adversarial fixes applied (all merged to branch)

1. `migrations/0328_voice_profiles.sql` — RLS subaccount axis removed (app.current_subaccount_ids never set → fail-closed). V1 is strictly user-scoped.
2. `server/routes/eaDrafts.ts` — Added `requireOrgPermission(EA_DRAFT_READ/DECIDE)` to all 5 endpoints. Added owner check on approve/reject (non-admin can only approve their own draft).
3. `server/routes/personalSetup.ts` — Added `requireOrgPermission(EA_PROVISION)`.
4. `server/routes/agentHomeWidgets.ts` — Added `requireOrgPermission(HOME_WIDGET_READ)`.
5. `server/services/eaDrafts/eaDraftService.ts` — `resetStalledSendingDrafts` wrapped in `withAdminConnection` + `SET LOCAL ROLE admin_role` to bypass FORCE RLS.

---

## PR-reviewer blocking issues fixed (all merged to branch)

1. **SKILL_HANDLERS** — Added 12 entries for `calendar.*` and `slack.*` skills in `server/services/skillExecutor.ts`. Each resolves `ownerUserId` from `agents.ownerUserId` via `resolveAgentOwner()`, not from LLM input.
2. **Approval flow** — `server/routes/eaDrafts.ts` approve handler now dispatches fire-and-forget send after `transitionState('approved')`. Slack → `executeApprovedDraftSend`; calendar → matching service method.
3. **Job registration** — `voiceProfileRefreshJob`, `gmailInboxPollJob`, `calendarLookaheadJob` registered in `server/index.ts`. `eaDraftStallResetHandler` wired into the workflow-gate-stall-notify worker.
4. **Cross-org DB safety** — All three job handlers now use `withAdminConnection` + `SET LOCAL ROLE admin_role` for FORCE RLS table queries.
5. **homeWidgetService organisationId** — Added `eq(agents.organisationId, organisationId)` filter. Return type aligned to shared `HomeWidget[]` shape with `SummaryCardData` payload.
6. **API shape mismatches** — (a) `GET /api/ea-drafts` returns `{ drafts }` wrapper; (b) `GET /api/agents?ownerScope=user` filter + `{ agents }` wrapper added; (c) `GET /api/agent-runs?agentId=...&limit=...` list endpoint added; (d) HomeWidget server/client shapes aligned.
7. **Dedup race** — Rate-cap check moved BEFORE dedup insert in `externalSourceTriggers.ts`; off-by-one `>` → `>=` corrected.

---

## Deferred items (in tasks/todo.md)

- `createDraftWithProposal` non-atomic — actionService.proposeAction doesn't accept a tx parameter
- `dispatch()` organisationId filter gap — connection lookup not filtered by org
- Rate-cap scope gap — cap is per-owner globally, not per-owner-per-org
- `assembleThreadSummaryPrompt` future prompt-injection surface
- 12 directional spec-vs-code gap items from spec-conformance (schema naming, calendar risk tier, etc.)

---

## Branch state

- All migrations: 0328–0332 present
- Untracked/unstaged files: all new files from chunks are unstaged (not yet committed). Phase 3 `finalisation-coordinator` handles the S2 branch sync.
- Last review commit: `f844922d` (spec-conformance OAuth scope fix)

---

## Files for Phase 3 to read first

1. `tasks/builds/personal-assistant-v1/plan.md` — full plan with all 25 chunks
2. `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md` — spec
3. `tasks/review-logs/spec-conformance-log-personal-assistant-v1-2026-05-12T13-15-07Z.md` — 12 deferred spec gaps
4. `tasks/todo.md` — deferred adversarial items + directional gaps
5. `tasks/builds/personal-assistant-v1/progress.md` — session log

---

## Phase 3 launch instruction (operator)

In a new Claude Code session:

```
launch finalisation
```

The new session reads `tasks/current-focus.md` (status FINALISING; build_slug `personal-assistant-v1`), reads this handoff, runs the S2 branch sync, G4 regression guard, chatgpt-pr-review, full doc-sync sweep, KNOWLEDGE.md update, and transitions to MERGE_READY.

---

## Phase 3 (FINALISATION) — complete

**PR number:** #291
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-claude-synthetos-personal-assistant-0kaIM-2026-05-12T21-00-51Z.md`
**Rounds completed:** 2 (operator finalised after Round 2; no Round 3)
**chatgpt-pr-review verdict:** APPROVED_AFTER_FIXES
**spec_deviations reviewed:** n/a (none recorded in Phase 2)
**REVIEW_GAP:** dual-reviewer's final log was not persisted in Phase 2 (5 codex iteration temp files visible in `tasks/review-logs/.codex-iter*-raw.txt` but never finalised). chatgpt-pr-review covered the second-opinion pass as primary; reduced formal coverage acknowledged.

**Pre-finalisation catch-up:** at finalisation entry, `tasks/current-focus.md` carried `status: FINALISING` (non-canonical — canonical enum is `REVIEWING`) and ~98 Phase-2 files were uncommitted on the working tree despite the handoff claiming Phase 2 complete. Operator-approved single-commit catch-up: `557b4f64 chore(feature-coordinator): Phase 2 catch-up — personal-assistant-v1 chunks 5-24` (+7601 / -95 across 98 files; status name fixed in the same commit). After catch-up, S2 was clean (0 commits behind main) and G4 PASSED (lint 0 errors, typecheck clean).

**chatgpt-pr-review fixes by round:**
- Round 1: F2 owner-only approve/reject/retry; F3 proposal commit hook owns dispatch (removed fire-and-forget); F4 viewer-aware draft body redaction (11 new tests); F5 `GET /api/agent-runs?agentId=` per-row owner/admin redaction; R2 `external_trigger_dedup` RLS admin role aligned to spec. F1 rejected (combined predecessor + EA scope intentional per operator). R1 rejected (text column, not enum). R3 auto-closed by F1. Commit `0886def6`.
- Round 2: F1 `external_trigger_dedup` writes wrapped in `withAdminConnection` + `SET LOCAL ROLE admin_role` (BYPASSRLS); F2 claim-first dispatch with `markSendFailed` on pre-claim errors (closes approved-but-`idle` durability window); F3 `triggerContext` dropped from agent-runs list response with `triggerContextRedacted: true` marker. Commit `b010a04c`. KNOWLEDGE.md finalisation commit `21fcf853` added 5 new patterns.

**Doc-sync sweep verdicts** (per `docs/doc-sync.md` investigation procedure):
- architecture.md: yes (Phase 2 catch-up covered EA service tier, voice profile primitive, external trigger dedup, admin BYPASSRLS convention; 7 candidate-term hits verified)
- docs/capabilities.md: yes (EA capability + new skill catalogue; 2 hits)
- docs/integration-reference.md: yes (Slack/Gmail/Google Calendar scopes + new write capabilities; 12 hits)
- KNOWLEDGE.md: yes (5 entries appended at chatgpt-pr-review finalisation)
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md: n/a (no build-discipline / convention / locked-rule change; this is a feature add reusing existing patterns)
- CONTRIBUTING.md: n/a (no lint-suppression or contributor-convention change)
- docs/frontend-design-principles.md: n/a (Personal zone uses existing `consolidation-foundation` primitives; no new UI pattern)
- docs/decisions/: n/a (no durable "chose X over Y" decision; V1 owner-only approval is product policy, claim-first is operational pattern)
- docs/context-packs/ / references/test-gate-policy.md / references/spec-review-directional-signals.md / .claude/FRAMEWORK_VERSION + CHANGELOG.md: n/a (no triggers from this change-set)
- docs/spec-context.md: n/a (not a spec-review session)

**KNOWLEDGE.md entries added:** 5
**tasks/todo.md items removed:** 2 (EA-V1-AD1 already RESOLVED; REQ-P6 closed by R2 RLS admin role fix)
**Remaining deferred items:** 4 adversarial worth-confirming + 11 spec-conformance directional gaps (REQ-C4, REQ-CAL2, REQ-T8, REQ-C1, REQ-EA1, REQ-EA3, REQ-EA4, REQ-EA5, REQ-M15, REQ-C3, REQ-CAL3-naming, REQ-M9 — note REQ-P6 removed)
**ready-to-merge label applied at:** 2026-05-12T21:58:47Z
