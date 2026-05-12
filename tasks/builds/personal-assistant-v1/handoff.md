# Handoff — personal-assistant-v1

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`
**Spec status:** accepted (locked 2026-05-12)
**Branch:** `claude/synthetos-personal-assistant-0kaIM`
**Build slug:** `personal-assistant-v1`
**PR:** [#291](https://github.com/michaelhazza/automation-v1/pull/291)
**UI-touching:** yes
**Mockup paths:** `prototypes/personal-assistant-v1/01-first-run-setup.html`, `prototypes/personal-assistant-v1/02-my-ea-home.html`, `prototypes/personal-assistant-v1/03-ea-settings.html`
**Spec-reviewer iterations used:** 5 / 5 (NEEDS_REVISION at cap; 52 mechanical fixes applied; 3 directional decisions operator-confirmed)
**ChatGPT spec review log:** `tasks/review-logs/chatgpt-spec-review-personal-assistant-v1-2026-05-12T07-09-30Z.md` (2 rounds, APPROVED, "build-ready")

## BLOCKING DEPENDENCY — read before launching Phase 2

The spec is `accepted`, but Phase 2 BUILD is gated on the **locked predecessor** `user-owned-agents` reaching **MERGED**:

- Predecessor brief: `tasks/builds/user-owned-agents/brief.md` (status: DRAFT)
- Predecessor delivers: `agents.owner_user_id` column + index + RLS; `agent_runs.owner_user_id` column + index; `integration_connections.owner_user_id` column + index; `CredentialBrokerService.injectIntoEnvironment({ ownerUserId? })` signature extension + `OWNER_MISMATCH` typed error + owner-scoped revocation; RLS clauses for user-owned visibility; admin redaction policy + typed audit event `owner.content_revealed`; doc updates to master brief §5.1 + §9.

**Operator action before launching feature-coordinator:**
1. Take `user-owned-agents` through Phase 1 spec-coordinator on its own branch.
2. Take it through Phase 2 feature-coordinator (this is the predecessor BUILD).
3. Take it through Phase 3 finalisation-coordinator until it reaches MERGED.
4. Only then re-base this branch (`claude/synthetos-personal-assistant-0kaIM`) on the new main and launch feature-coordinator for EA V1.

If Phase 2 is launched before predecessor MERGED, `feature-coordinator` MUST detect the missing predecessor primitives (look for `agents.owner_user_id` column in `server/db/schema/agents.ts`) and pause with a clear operator-facing message.

## Open questions for Phase 2 architect

Per spec §27 (12 items, none blocking operator). Architect resolves each in `plan.md`:

1. Calendar `respond_to_invite` Tier 3 vs Tier 4 risk-tier rationale.
2. Slack scope-add verification across `channels:history`, `groups:history`, `im:history`, `mpim:history`, `im:write`, `search:read`.
3. Calendar lookahead cadence (1-min vs 5-min baseline + on-demand fast-track) — Google quota headroom.
4. Calendar lookahead horizon (15-min default; memory_block vs global constant).
5. EA `agentRole: 'Specialist'` vs alternatives.
6. EA system-prompt canonical text drafting.
7. Stub second user-owned agent (ship vs integration-test-only) — reuse acceptance criterion proof.
8. `EA_PROVISION` permission key default-grant (every-user vs admin-gated).
9. Operator user's seed EA at deploy time (recommendation: no seed; wizard like every user).
10. Capability slug naming for new Slack actions (`channel_messages_read`, `channel_post_message`, `channel_search_messages`, `dm_send`).
11. Workflow execution-event taxonomy landing in `shared/types/agentExecutionLog.ts`.
12. `actionService.proposeAction` FK-shape verification (LOCKED composition; architect verifies primitive's row schema accepts the FK shape; if not, escalates BACK to spec revision rather than authoring a parallel state machine).

## Decisions made in Phase 1

- **2026-05-12 — Mockup loop skipped.** Operator accepted the 3 existing locked mockups in `prototypes/personal-assistant-v1/` as the spec's design source of truth.
- **2026-05-12 — Calendar push deferred; lookahead scan replaces it.** Google Calendar push notifications fire on event create/update/delete, NOT at reminder time, with no V1 consumer. Spec ships `calendarLookaheadJob.ts` (scheduled 1-min scan) instead of `googleWebhook.ts` + `webhook_channel_registrations` table. Latter pair deferred V1.5.
- **2026-05-12 — Slack auto-send-scope dropdown deferred V1.** Fixed policy: DM-to-owner auto; all else review-gated. Locked mockup `03-ea-settings.html` renders dropdown as static text. Dropdown activates when a future spec relaxes the §1 framing ceiling.
- **2026-05-12 — `risk_tier_ceiling` raised 5 → 6.** Tier 6 actions (`send_email`, `slack.post_message`, `slack.post_dm`) ship in default skill allowlist, review-gated by default approval policy (not auto-execute).
- **2026-05-12 — `slack_mention` trigger enum value ships V1 forward-compat.** Webhook handler (`app_mention` event_callback) AND Workflow #4 BOTH defer V1.5. V1 `slackWebhook` only handles `block_actions` (approval) + `url_verification`.
- **2026-05-12 — Calendar write actions draft-mediated only V1.** `create_event` / `update_event` / `respond_to_invite` handlers REJECT calls without `eaDraftId` with `code: 'missing_draft_context'`. Generic non-draft Calendar event creation deferred V1.5.
- **2026-05-12 — `ea_drafts` composes over `actionService.proposeAction`.** Composition LOCKED in spec §7.5 + §11.6 + §24.3: proposal primitive owns approval state (`pending → approved | rejected | expired`); `ea_drafts.sendState` owns post-approval send (`idle → sending → sent | send_failed`). No parallel approval state machine. Resolves the previously-deferred `EA-V1-AD1` open question.
- **2026-05-12 — `sentMessageId` renamed to `externalResultId`.** Generic naming covers Gmail messageId / Slack messageTs / Calendar eventId / Calendar responded-event-id.
- **2026-05-12 — Review-triage feedback captured to memory.** Operator preference: auto-apply technical findings (including critical / architectural ones); reserve escalation for genuine user-facing product-surface decisions. Saved at `~/.claude/memory/feedback_review_triage.md`.

## Verdict + verdict trail

- **spec-reviewer:** NEEDS_REVISION at MAX_ITERATIONS=5 (cap reached). 52 mechanical fixes applied. 3 directional decisions ratified by operator. Convergence trajectory: 15→10→12→15→9 findings per iteration. Final report: `tasks/review-logs/spec-review-final-personal-assistant-v1-20260512T065942Z.md`.
- **chatgpt-spec-review:** APPROVED at round 2. 8 findings across 2 rounds, all auto-applied (zero rejected; zero deferred to Phase 2 beyond the predecessor gate + §27 spec-time confirmations). Final round verdict explicit: "After [these patches], I'd call this build-ready." Log: `tasks/review-logs/chatgpt-spec-review-personal-assistant-v1-2026-05-12T07-09-30Z.md`.

## Files for Phase 2 to read first

1. `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md` — the spec itself
2. `tasks/builds/personal-assistant-v1/brief.md` — source brief (for context)
3. `tasks/builds/user-owned-agents/brief.md` — locked predecessor (must MERGE first)
4. `prototypes/personal-assistant-v1/` — 3 locked hi-fi mockups
5. `tasks/review-logs/chatgpt-spec-review-personal-assistant-v1-2026-05-12T07-09-30Z.md` — round-by-round decisions

## Phase 2 launch instruction (operator)

In a new Claude Code session, after `user-owned-agents` reaches MERGED:

```
launch feature coordinator
```

The new session reads `tasks/current-focus.md` (status BUILDING; build_slug `personal-assistant-v1`), reads this handoff, invokes `architect` to author `tasks/builds/personal-assistant-v1/plan.md`, runs `chatgpt-plan-review` for plan gate, then builds chunk-by-chunk per `superpowers:subagent-driven-development`.
