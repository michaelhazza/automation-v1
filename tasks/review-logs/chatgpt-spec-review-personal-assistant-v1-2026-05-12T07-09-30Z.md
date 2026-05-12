# ChatGPT Spec Review — personal-assistant-v1

## Session Info

- **Spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`
- **Spec slug:** `personal-assistant-v1`
- **Branch:** `claude/synthetos-personal-assistant-0kaIM`
- **PR:** [#291](https://github.com/michaelhazza/automation-v1/pull/291)
- **Started:** 2026-05-12T07:09:30Z
- **Mode:** manual
- **HUMAN_IN_LOOP:** n/a (manual)
- **Coordinator:** spec-coordinator (inline, Phase 1 step 8)
- **Prior reviews:** spec-reviewer (Codex) ran 5 iterations; verdict NEEDS_REVISION at cap. 52 mechanical fixes applied. Final report: `tasks/review-logs/spec-review-final-personal-assistant-v1-20260512T065942Z.md`.
- **Directional decisions ratified by operator pre-chatgpt-spec-review (2026-05-12):**
  1. `googleWebhook.ts` deferred; `calendarLookaheadJob.ts` 1-min scheduled scan replaces Calendar push channels.
  2. Slack auto-send-scope dropdown deferred V1; fixed policy (DM-to-owner auto, all else review); mockup renders dropdown as static text.
  3. `risk_tier_ceiling` 5 → 6 (Tier 6 actions in default allowlist, review-gated, not auto-execute).

## Rounds

### Round 1 — 2026-05-12T07:09:30Z

**Verdict from ChatGPT:** CHANGES_REQUESTED. 2 Blockers (F1 idempotency, F2 approval composition) + 2 Required (F3 Slack table wording, F4 slack_mention routing) + 1 Smaller (T1 sentMessageId rename). ChatGPT explicit close: "After those are patched, I'd call the spec build-ready."

**Top themes:** Approval-primitive composition (F2 vs prior EA-V1-AD1 deferral); idempotency narrowing for V1 (F1 Option A); aligning Slack table to fixed-V1 policy (F3); deferring slack_mention webhook handler V1 to match Workflow #4 deferral (F4); generic naming on draft result column (T1).

**Recommendations + decisions:**

| # | Finding | Triage | Severity | My recommendation | Final decision | Notes |
|---|---|---|---|---|---|---|
| F1 | `create_event` idempotency assumes draft-mediation but action is described as generic | technical (initially escalated then auto-applied) | critical | apply Option A — V1 `create_event` draft-mediated only | auto-apply Option A | Spec §8.4 handler step now REJECTS calls without `eaDraftId` with `code: 'missing_draft_context'`. §7.2 input shapes for `create_event` / `update_event` / `respond_to_invite` all include `eaDraftId: uuid (REQUIRED V1)`. §8.2 action table cells updated. §26 deferred items add "Generic, non-draft-mediated Calendar event creation." |
| F2 | Approval split between `ea_drafts` and existing `actionService.proposeAction` | technical (initially escalated then auto-applied per operator feedback) | critical | apply COMPOSITION — `ea_drafts.proposalId` FK to proposal row | auto-apply composition | Spec §7.5 LOCKS composition: proposal primitive owns approval state (`pending/approved/rejected/expired`); `ea_drafts.sendState` owns post-approval send (`idle/sending/sent/send_failed`). §11.2 + §11.6 + §24.2 + §24.3 updated. `tasks/todo.md` EA-V1-AD1 marked RESOLVED. §27 open question #12 narrowed to "verify primitive's FK shape support." |
| F3 | Slack action table still says "review per scope dropdown" | technical | medium | apply ChatGPT's verbatim wording | auto-apply | §9.1 action table cells now read "review (fixed V1; see §9.3)" and "dynamic: auto when target = owner; review otherwise (fixed V1; see §9.3)". Added explicit "There is no configurable per-instance auto-send dropdown in V1" note under the table. |
| F4 | `slack_mention` trigger needs deterministic owner rule (or defer) | technical (initially escalated then auto-applied) | medium | defer slack_mention webhook handler V1.5 | auto-apply defer | §10.2 slackWebhook extension scoped down to `url_verification` only V1; `app_mention` event_callback path explicitly deferred V1.5. `slack_mention` enum value still ships V1 (forward-compat in `agent_triggers.event_type`). §11.5 + §26 deferred entries updated. |
| T1 | Rename `sentMessageId` to generic name | technical | low | apply rename to `externalResultId` | auto-apply rename | Global rename `sentMessageId` → `externalResultId` across all 22 occurrences. §7.5 row description generalised to cover all 4 draft kinds (gmail/slack/calendar_create/calendar_respond). |

**Operator intervention this round:** Operator noted (mid-round) that the 3 escalations I batched as AskUserQuestion blocks (F1, F2, F4) should have been auto-applied as technical findings — "all of those user questions are all technical, you should just implement these." Memory saved at `~/.claude/memory/feedback_review_triage.md`: spec/PR review triage defaults to technical for architectural primitive composition, idempotency contracts, internal state machines, trigger routing rules; user-facing escalation reserved for visible product surface only.

**Integrity check (post-edit, single pass):** Cascaded the F2 composition lock through §6.1 entity table, §7.10 source-of-truth precedence, §14.3 Workspace tab description, §18 ea_drafts index, §19 home widget query, §20.2 retry path, §20.4 approval timeout, §24.9 unique-constraint table. Cascaded F1 reject path through §7.2 + §8.2 + §8.4. Cascaded F4 deferral through §10.2 + §11.5 + §26.

**Files committed this round:**
- `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`
- `tasks/review-logs/chatgpt-spec-review-personal-assistant-v1-2026-05-12T07-09-30Z.md`
- `tasks/todo.md` (EA-V1-AD1 marked RESOLVED)

Waiting for round 2 paste or `done`.
