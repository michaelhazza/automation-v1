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

### Round 2 — 2026-05-12T07:40:00Z

**Verdict from ChatGPT:** APPROVED with 3 small fixes. ChatGPT explicit close: "After that, I'd call this build-ready." Operator-instructed final round — "lock the spec and finalise after this."

**Top themes:** Stale `state = 'pending'` references on `ea_drafts` after the round-1 composition lock (F1); §11.6 over-narrow claim that Workflow B is the only draft producer (F2); §9.3 title still says "dropdown" (T1).

**Recommendations + decisions:**

| # | Finding | Triage | Severity | My recommendation | Final decision | Notes |
|---|---|---|---|---|---|---|
| F1 | §5.2 stall-job description references `ea_drafts.state = 'pending'` / `state = 'expired'` (old approval-state model) | technical | required | auto-apply: rewrite stall-handler description to operate on the linked proposal row's approval state, not on `ea_drafts.state` | auto-apply | §5.2 stall job entry now: "emit one-time 24h reminder when the linked proposal row remains in approval state `pending` past its reminder threshold; transition expired proposal rows to approval state `expired`. The `ea_drafts` row's `sendState` stays `idle` after expiry. Approval-side state is owned by the proposal primitive." |
| F1 | §9.4 step 3 — confirm reviewed Slack write creates proposal + ea_drafts with `sendState: 'idle'`, not `state: 'pending'` | technical | required | auto-apply: rewrite step 3 to make both branches (auto vs review) explicit | auto-apply | §9.4 step 3 now splits explicitly: `decision === 'auto'` → call Slack immediately with idempotency key; `decision === 'review'` → create proposal row via `actionService.proposeAction` + linked `ea_drafts` row with `proposalId` + `sendState: 'idle'` in the same transaction. |
| F1 | §7.10 source-of-truth precedence row "EA draft state → `ea_drafts.state`" stale | technical | required | auto-apply: split into two rows — approval-state on proposal row; send-state on `ea_drafts.sendState` | auto-apply | §7.10 now lists two rows: "EA draft approval state → proposal primitive's row (linked via `ea_drafts.proposalId`)" and "EA draft send state → `ea_drafts.sendState`". |
| F2 | §11.6 claims Workflow B is the only V1 workflow that writes `ea_drafts` rows — too narrow now that Calendar handlers also require draft mediation | technical | required | auto-apply: distinguish "only default scheduled workflow" from "only draft producer" | auto-apply | §11.6 now: "Workflow B is the only default V1 scheduled workflow that creates `ea_drafts` rows during normal operation. HOWEVER, any V1 review-gated external write may create a proposal row + linked `ea_drafts` row through the shared draft/proposal helper" — explicitly naming Gmail sends, Slack reviewed posts/DMs, and Calendar create/update/respond. |
| T1 | §9.3 title still says "Auto-send scope dropdown" but dropdown is deferred | technical | minor | auto-apply: rename §9.3 to "Slack auto-send policy" | auto-apply | §9.3 title renamed; content unchanged (already correctly describes the fixed-V1 policy + dropdown deferral). |

**Operator intervention this round:** None. ChatGPT round 2 verdict explicit: "After [these patches], I'd call this build-ready." Operator instructed "lock the spec and finalise after this" — chatgpt-spec-review loop closes here at round 2.

**Integrity check (post-edit, single pass):** Grepped for `ea_drafts.state` / `state = 'pending'` / `state = 'expired'` / `state = 'approved'` across the full spec. Remaining matches at lines 299 (entity table — correctly describes new model), 428 (voice_profiles state, unrelated), 997 (UI status text, unrelated), 1813 + 1819 (§24.3 explicitly NAMES the proposal-row approval enum), 1867 + 1869 (voice_profiles, unrelated). No remaining ea_drafts approval-state references. Clean.

**Spec status transition:** Frontmatter `Status: draft → accepted` per `docs/spec-authoring-checklist.md §11`. Operator-confirmed locked.

**Files committed this round:**
- `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md` (5 edits + status frontmatter)
- `tasks/review-logs/chatgpt-spec-review-personal-assistant-v1-2026-05-12T07-09-30Z.md`

## KNOWLEDGE.md pattern extraction (final-round only)

One pattern worth lifting to `KNOWLEDGE.md` from this review:

**Pattern:** When introducing a new domain-specific draft / proposal / approval primitive, compose over the existing `actionService.proposeAction` primitive — never author a parallel approval state machine. The composition shape: domain row carries the per-domain payload + a FK to the proposal row. Approval state, expiry, audit, reviewer-decision live on the proposal row. The domain row owns only post-approval state (e.g. `sendState`). Caught by ChatGPT spec-review round 1 (F2) on `ea_drafts` for EA V1 — round-1 trade was "lock composition now vs defer to Phase 2 architect investigation"; locking now prevented a parallel state machine from being authored during build.

Routing: append to `KNOWLEDGE.md` during Phase 3 finalisation (per spec-coordinator playbook — KNOWLEDGE.md edits land in the finalisation-coordinator's doc-sync sweep, not here).

## Session closed

- **Final verdict:** APPROVED (build-ready per ChatGPT round 2 close).
- **Total rounds:** 2.
- **Total findings:** 8 (5 round-1 — F1/F2/F3/F4/T1; 3 round-2 — F1/F2/T1). All auto-applied. Zero rejected. Zero deferred to Phase 2 beyond the predecessor-MERGE gate and the §27 spec-time confirmations.
- **Tasks/todo.md changes:** 1 item resolved (EA-V1-AD1).
- **Frontmatter status:** `accepted`.
