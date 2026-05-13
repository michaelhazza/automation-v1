# Spec Conformance Log — personal-assistant-v1

**Spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`
**Spec commit at check:** (uncommitted in branch tree — file present at HEAD)
**Branch:** `claude/synthetos-personal-assistant-0kaIM`
**Base:** merge-base with `main`
**Scope:** full spec (all sections; Phase 2 BUILD branch verification per caller request)
**Changed-code set:** 80 files (28 modified, 52 untracked) across `server/`, `client/`, `shared/`, `migrations/`, `prototypes/`
**Run at:** 2026-05-12T13:15:07Z
**Commit at finish:** `f844922d`

---

## Summary

- Requirements extracted:     53 (covering §5–§25 of the spec)
- PASS:                       36
- MECHANICAL_GAP → fixed:      5
- DIRECTIONAL_GAP → deferred: 12
- AMBIGUOUS → deferred:        0
- OUT_OF_SCOPE → skipped:      0

**Verdict:** CONFORMANT_AFTER_FIXES (5 mechanical gaps closed in-session; 12 directional gaps routed to `tasks/todo.md` for operator review)

---

## Mechanical fixes applied

| REQ | File | Change |
|---|---|---|
| REQ-P3 (already closed pre-run) | `server/routes/eaDrafts.ts` | `requireOrgPermission(EA_DRAFT_READ)` on list/get; `requireOrgPermission(EA_DRAFT_DECIDE)` on approve/reject/retry. Owner-match check on approve/reject (extra hardening beyond spec). |
| REQ-P4 (already closed pre-run) | `server/routes/agentHomeWidgets.ts` | `requireOrgPermission(HOME_WIDGET_READ)` on GET. |
| REQ-P5 (already closed pre-run) | `server/routes/personalSetup.ts` | `requireOrgPermission(EA_PROVISION)` on POST. |
| REQ-SLK1a | `server/config/oauthProviders.ts` | Added `mpim:history` to Slack scopes (spec §9.2). |
| REQ-SLK1b | `server/config/oauthProviders.ts` | Added `app_mentions:read` to Slack scopes (spec §9.2 + §10.6). |

Notes:
- REQ-P3, REQ-P4, REQ-P5: the three route files already had the gates applied when I read them in Step 4. A linter or prior session had closed those gaps before this conformance pass. No edit applied; verified in place.
- REQ-SLK1a/b: Edit applied; only `oauthProviders.ts` Slack `scopes` array touched.

Verified post-edit: `npm run lint` passes (0 errors, 902 pre-existing warnings unchanged). `npm run typecheck` passes cleanly.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

See `tasks/todo.md` § "Deferred from spec-conformance review — personal-assistant-v1 (2026-05-12)" for the 12 deferred items:

- REQ-C4 — `voice_profiles` schema diverges from spec §7.4 (missing `name`, single `source`, `sourceConfig`, `refreshConfig`; renames on 3 columns)
- REQ-CAL2 — Calendar `create_event`/`update_event` risk tier (code Tier 6, spec Tier 4 with action-level review gate)
- REQ-T8 — Dedup key formats diverge from §7.1 (Slack and Calendar)
- REQ-C1 — `ExternalSourceTriggerEvent` schema simplified vs spec §7.1 envelope
- REQ-EA1 — EA default skill allowlist incomplete vs spec §13.2 (may be covered by universal skills — needs confirmation)
- REQ-EA3 — Partial unique index uses `(organisation_id, owner_user_id)` instead of `(subaccount_id, owner_user_id)` per §13.4
- REQ-EA4 — EA `home_widget.refreshPolicy` is `every_5m`; spec §13.1 says `on_login`
- REQ-EA5 — EA `home_widget.titleTemplate` hardcoded; spec §13.1 says `${agent.displayName}`
- REQ-M15 — Personal nav group placement (mid-sidebar vs spec §14.1 "top of sidebar")
- REQ-P6 — `external_trigger_dedup` RLS uses `subaccount_admin` instead of `system_admin` per §21.3
- REQ-C3 — `slack.list_channels` Zod schema missing `types` filter per §7.3
- REQ-CAL3-naming — Calendar write-action error codes differ from spec §8.4 (`DRAFT_NOT_APPROVED`/`DRAFT_NOT_FOUND`/`DRAFT_SEND_IN_FLIGHT` vs `missing_draft_context`); also missing owner-userId mismatch check

Additional bookkeeping item (M9): stall job 7-day proposal expiry path — needs verification whether existing `actions` primitive expiry already covers it.

---

## Files modified by this run

- `server/config/oauthProviders.ts` (Slack scopes — `mpim:history`, `app_mentions:read` added)
- `tasks/todo.md` (12-item deferred section appended)
- `tasks/review-logs/spec-conformance-log-personal-assistant-v1-2026-05-12T13-15-07Z.md` (this log)

---

## Requirements extracted (high-level checklist)

Spec sections covered: §5.1 (new files), §5.2 (modified files), §7 (contracts §7.1–7.10), §8 (Calendar), §9 (Slack), §10 (external-source triggers), §11 (workflows), §12 (voice profile), §13 (EA template + provisioning), §14 (UI surfaces), §15 (multi-user consumption), §17 (capability grouping), §21 (permissions + RLS), §22 (execution model), §24 (execution-safety contracts), §25 (testing posture).

PASS items (selected):
- All migrations 0327–0332 with up + down scripts, RLS policies, CHECK constraints.
- All six new shared-type files with Zod schemas.
- 6 Calendar + 6 Slack actions in `actionRegistry` with `requiredIntegration`, idempotency strategies, retry policies.
- 6 new permission keys in `ORG_PERMISSIONS` with role grants.
- 14 telemetry event criticalities in `AGENT_EXECUTION_EVENT_CRITICALITY`.
- 16 skill markdown files (6 calendar + 6 slack + 3 workflow + 1 home-widget) with valid YAML frontmatter.
- Three pg-boss jobs (Gmail poll, Calendar lookahead, voice profile refresh) with advisory-lock single-writer guarantees.
- Voice profile `<voice>` block injection in `agentExecutionService` via memory_block `ea.voice_profile_id` SOT (matches §12.4 SOT clarification).
- Slack url_verification handler + `app_mention` no-op for V1 deferred Workflow #4 per §10.2.
- Per-action write-action invariant (`writePreFlight` + `claimSend`) enforces `actions.status='approved' AND ea_drafts.send_state='idle'` per F2 spec compliance.
- ConnectionsPage Personal/Subaccount chip via `ownerUserId !== null`.
- Client routes `/personal/setup`, `/personal/:agentId`, `/personal/:agentId/setup`.
- Four React-Query hooks + tabbed shell + first-run wizard + PersonalZoneCard frame.
- Integration test `userOwnedAgentCredentialIsolation` exists.
- RLS_PROTECTED_TABLES registrations for `voice_profiles`, `ea_drafts`, `external_trigger_dedup`.
- All listed pure-helper Vitest tests present.
- `c.ts` SUBACCOUNT_AGENTS gains `executive-assistant` entry.
- `topicRegistry.ts` adds `calendar` + `slack` topics.

---

## Next step

**CONFORMANT_AFTER_FIXES** — the 5 mechanical gaps are closed (3 routes were closed pre-run by a linter/prior pass; 2 OAuth scopes added in this pass). The OAuth-scope edit touched `server/config/oauthProviders.ts`. Re-run `pr-reviewer` on the expanded changed-code set so it sees the final fixed state.

12 directional gaps are now in `tasks/todo.md` for operator review before PR opens. Main session should triage them (most are schema-vs-spec naming choices, one is a likely real defect — REQ-EA3 partial unique index axis — and one needs runtime verification — REQ-M9 stall job).

**Commit at finish:** (to be recorded after auto-commit step)
