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
