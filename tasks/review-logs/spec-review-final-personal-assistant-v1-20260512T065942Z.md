# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`
**Spec commit at start:** `bd30060a8e7a2a670d6cbe5505bcc369cb8d782f`
**Spec commit at finish:** `996abe340b360e5c5620c799142f3f89067df6b5`
**Spec-context source:** `docs/spec-context.md` (last_reviewed_at: 2026-05-11; staleness gate green)
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap
**Verdict:** NEEDS_REVISION (cap reached with iter5 still producing 7 new mechanical findings; convergence trajectory not yet complete — see "Convergence assessment" below)

---

## Iteration summary

| # | Codex findings | Rubric findings | Mechanical accepted | Mechanical rejected | AUTO-REJECT (framing) | AUTO-DECIDED (routed) |
|---|---|---|---|---|---|---|
| 1 | 12 | 3 | 13 | 0 | 1 | 1 |
| 2 | 10 | 0 | 8 | 0 | 1 | 1 (REPEAT — same as iter1) |
| 3 | 12 | 0 | 10 | 0 | 1 | 1 (REPEAT) |
| 4 | 15 | 0 | 14 | 0 | 1 | 0 |
| 5 | 9 | 0 | 7 | 1 | 1 | 0 |

Trajectory: 15 → 10 → 12 → 15 → 9. Iter4 spiked because iter3's Calendar push retirement opened many stale-reference cleanups. Iter5 dropped to 9 but still found 2 critical issues (trigger provisioning, voice_profiles RLS admin path) that required real new content. Spec is converging but not yet two-mechanical-only.

---

## Mechanical changes applied (grouped by spec section)

### §1 + §2 (Framing + Goals)
- Goal §2.3: Slack writes review-gated per the FIXED V1 policy (DM-to-owner auto; everything else review). Removed "per-instance dropdown" wording.
- Goal §2.6: VoiceProfile schema clarified — two independent enums (`source`: V1 = gmail + drive; `refreshPolicy`: V1 = periodic + manual; `on_send_count` reserved). EA default `periodic, 30 days`.
- Goal §2.4: External-source trigger sources now correctly named (`gmailInboxPollJob`, `calendarLookaheadJob`, extended `slackWebhook`); Calendar push deferred to V1.5.

### §5 (File inventory)
- §5.1 added: `server/lib/permissions.ts` (6 new permission keys), `shared/types/agentExecutionLog.ts` (17 new event types), `server/db/schema/systemAgents.ts` (`home_widget jsonb` column), `server/jobs/workflowGateStallNotifyJob.ts` (extend for ea_drafts expiry), 6 `*Pure.test.ts` files, 1 integration test, `calendarLookaheadJob.ts` (replaces channel renewal).
- §5.1 removed: `googleWebhook.ts`, `calendarChannelRenewalJob.ts`, `webhook_channel_registrations` migration (deferred to V1.5).
- §5.2 updated: `oauthProviders.ts` row now mentions both Google Calendar + Slack scope additions; `actionRegistry.ts` `create_event` idempotency cell corrected.
- §5.3 (out-of-inventory): added `webhook_channel_registrations.ts`, `googleWebhook.ts` as V1.5 deferrals.

### §7 (Contracts)
- §7.1: per-event-type dedup-key shapes (Gmail message id; Calendar `'{calendarId}@{eventId}@{startAt}@{lookaheadMinutes}'`; Slack event id); locked to `external_trigger_dedup` table (Option A).
- §7.2 + §7.5: `create_event` idempotency rewritten — uses `ea_drafts.sentMessageId` state-based path + `extendedProperties.private.ea_draft_id` recovery tag; introduces `sending` transitional state with unknown-success-outcome recovery via `events.list?privateExtendedProperty=ea_draft_id=X`.
- §7.4: VoiceProfile schema clarified — `source` reduced to V1 enum (`gmail_sent_sampler` + `drive_doc_sampler`; `manual` deferred); `refreshPolicy` includes `on_send_count` as reserved but rejected by write API; added `state` column for derivation lifecycle.
- §7.8: `webhook_channel_registrations` contract collapsed to a deferral notice (deferred to V1.5).
- §7.10 source-of-truth table: removed webhook_channel_registrations row; locked dedup to `external_trigger_dedup`.

### §8 (Calendar)
- §8.2 action registry: `create_event` idempotency cell now `state-based via ea_drafts.sentMessageId`.
- §8.4 step 3: clarified that Google requestId is NOT used.
- §8.5: `deriveIdempotencyKey` repurposed as internal-correlation only, not Google requestId.

### §9 (Slack)
- §9.3: rewrote auto-send-scope from configurable dropdown to FIXED V1 policy (DM-to-owner auto; all else review). Dropdown deferred per §26.
- §9.4 step 3: handler uses `slackActionServicePure.decideAutoSendScope` enforcing the §1 ceiling.

### §10 (External-source triggers)
- §10.2: removed `googleWebhook.ts` from V1; only extended `slackWebhook.ts` ships.
- §10.2 Slack handler: locked owner-resolution to `(team_id, owner_user_id with EA agent)` matching; defined `owner_unresolved` / `owner_ambiguous` suppression reasons.
- §10.3 + §10.7 + §10.9: dedup-key terminology consistent (`dedup_key` everywhere; per-event-type shape).
- §10.5: replaced `calendarChannelRenewalJob.ts` with `calendarLookaheadJob.ts` (scheduled 1-min scan; rationale: Google Calendar push does not fire at reminder time).
- §10.7 suppression reasons: added `missing_skill`, `owner_unresolved`, `owner_ambiguous`.

### §11 (V1 workflows)
- §11.1 + §11.3: removed false "No external sends" claims (DM-to-self is Tier 6 but auto-allowed).
- §11.3 meeting prep: trigger source corrected to `calendarLookaheadJob` scheduled scan.

### §12 (Voice profile)
- §12.4: voice profile attachment locked to memory_block `ea.voice_profile_id` (single SOT); opt-out only sets `optOutAt`, never clears the attachment.
- §12.5 refresh job: handles only `periodic` in V1; `manual` and `on_send_count` rows never auto-refresh.
- §12.6 opt-out: reactivation is one-click (attachment preserved).
- §12.8 reuse: per-agent slug convention for memory_block key.

### §13 (EA template + provisioning)
- §13.1: `risk_tier_ceiling = 6` (was 5; contradicted Tier 6 actions in allowlist).
- §13.1 default approval policy: explicit note that action-level `defaultGate: review` overrides tier-default (covers `respond_to_invite` Tier 3 review).
- §13.4 provisioning: added concurrency guard (advisory lock + partial unique index); seeds three `agent_triggers` rows for external-event subscriptions; calendar lookahead recurring task replaces channel registration; skip-voice path lazy-creates row.

### §18 (Live-fetch vs canonical)
- §18.2 `ea_drafts` index corrected to `(organisation_id, owner_user_id, state)`.
- §18.2: `webhook_channel_registrations` row removed.

### §20 (Failure modes)
- §20.2 retry: existing `ea_drafts` row retains state on failure; no new row created.
- §20.5: removed `webhook_channel_registrations` failure path; replaced with calendar lookahead scan failure semantics.

### §21 (RLS)
- §21.1 voice_profiles: added admin clause to RLS (`org_admin` / `subaccount_admin` see rows; API serialiser redacts `profile_json` for non-owners).
- §21.3 external_trigger_dedup: schema uses `dedup_key` column name; PK is `(provider, dedup_key, owner_user_id)`.
- §21.5 added 6 new permission keys (consistent with §5.2 modified files).

### §22 (Execution model)
- §22.2 job idempotency claim corrected — uses advisory locks + `external_trigger_dedup`, not a new "job idempotency table".
- §22.5 webhook latency: tightened to <3s (Slack's hard requirement).

### §23 (Phase sequencing)
- §23.2 chunk graph renumbered after Calendar push retirement (37 chunks total, was 41).
- §23.2 `docs/integration-reference.md` slug-additions land in chunk B.11, not terminal doc-sync.

### §24 (Execution-safety contracts)
- §24.1: locked dedup mechanism to `external_trigger_dedup` table (Option A).
- §24.2 `create_event`: full unknown-success recovery contract via `extendedProperties.private.ea_draft_id` + `events.list` lookup; introduces `sending` transitional state.
- §24.3 `ea_drafts` state machine: added `sending` state + valid transitions.
- §24.5: replaced channel renewal contract with calendar lookahead scan contract (advisory lock + dedup ledger).
- §24.6 voice profile derivation: state-based via new `state` column; added derivation lifecycle events.
- §24.9 unique-constraint-to-HTTP table: removed webhook_channel_registrations row.
- §24.10: V1 has only one webhook route (extended slackWebhook); `oauth_state_nonces` reuse locked.

### §25 (Testing)
- §25.1 static gates: 3 tenant tables listed (was 4; webhook_channel_registrations removed).
- §25.2 + §25.3: test files now in §5.1 file inventory.

### §26 (Deferred items)
- Added: `manual` voice-profile sampler (V1.5); `manual` voice-profile pasted-sample storage; `on_send_count` activation; combined "periodic OR send-count" mode; Slack auto-send dropdown activation; `webhook_channel_registrations` + `googleWebhook.ts` (V1.5); Calendar push channel design (V1.5); Gmail Pub/Sub push (V1.5).
- Updated: Gmail push wording removed flag-gated language.

### §27 (Open questions for Phase 2)
- Resolved + removed: external-event dedup mechanism (Q1 → locked Option A); webhook_nonces table (Q5 → locked to reuse `oauth_state_nonces`); voice_profiles state column (Q5 → locked to add the column); auto-send-scope memory_block key (Q7 → dropdown deferred entirely).
- Renumbered to 12 open questions total.
- Updated Q3 (was calendar push channel state) to be about lookahead cadence + horizon.
- Added Q12 (was Q15 → renumbered): `actionService.proposeAction` composition with `ea_drafts` (routed to `tasks/todo.md`).

---

## Rejected findings

### Iteration 5 — Codex Finding #1 — "spec contradicts V1 scope by deferring `googleWebhook.ts`"
- **Rejection reason:** Reverses a correctness-driven decision from iter3. Google Calendar push notifications fire on event create/update/delete, NOT at reminder time; with V1's live-fetch architecture (no local Calendar mirror per §18), push provides no V1 consumer. Re-introducing the route would create unused code. The user-prompt's mention of "new google webhook route" reflected pre-correction scope; iter3 corrected the architecture. The iter3 decision stands; Codex's iter5 push to reverse it is asked-and-answered.

(The 4 iteration repeats of the integration-test finding are AUTO-REJECT framing — counted separately below — not in this rejected-findings list.)

---

## Directional and ambiguous findings (autonomously decided)

### AUTO-REJECT (framing) — Codex Finding #4 (iter1) and repeats in iter2/3/4/5
- **Finding:** "§25.3 integration test violates 'pure-function unit tests only' posture."
- **Decision:** AUTO-REJECT.
- **Rationale:** Framing assumption "rapid evolution / light testing" allows up to 3 carved-out integration tests for genuinely hot-path concerns (RLS, crash-resume, bulk idempotency). `docs/spec-context.md` `accepted_primitives` explicitly lists `rls.context-propagation.test.ts` as an existing integration-test primitive. The §25.3 test (owner-scoped credential isolation) is exactly the carve-out kind — RLS-class multi-tenant safety invariant. Codex repeated this finding in every iteration; same answer every time.

### AUTO-DECIDED — Codex Finding #11 (iter1) + repeats in iter2 and iter3
- **Finding:** "Review-gated action handling bypasses `actionService.proposeAction` primitive."
- **Decision:** AUTO-DECIDED — routed to `tasks/todo.md` as **EA-V1-AD1**; reflected as §27 open question #12.
- **Rationale:** Matches the directional signal "Introduce a new abstraction / service / pattern" + framing assumption "prefer existing primitives." But composing `ea_drafts` over `proposeAction` requires verifying the existing primitive's exact contract — specifically whether `proposeAction` supports a per-domain payload reference. Without that visibility from the spec alone, editing the spec to mandate composition would be premature; editing it to lock the parallel state machine would foreclose the cleaner option. Phase 2 architect investigates `proposeAction`'s actual surface area against the codebase, then decides in `plan.md`. Spec NOT edited beyond noting the open question.

---

## Convergence assessment

Iteration findings trajectory: **15 → 10 → 12 → 15 → 9**.

The spec did NOT converge to two-consecutive-mechanical-only within MAX_ITERATIONS=5. Iter5 still produced 7 mechanical fixes (including two critical: trigger subscription provisioning was missing, voice_profiles RLS lacked admin path) plus 1 rejected directional reversal.

**Why convergence wasn't faster:**

1. **Iter3 introduced a major rework** (Calendar push → scheduled lookahead) after Codex spotted that Google Calendar push doesn't fire at reminder time. That single correctness fix cascaded into stale references across many sections, which iter4 had to sweep.
2. **The spec is large** (~2000 lines, 27 sections, 4 migrations, ~6 services, 2 new primitives). Each iteration's prose changes generate new opportunities for drift between cross-referenced sections.
3. **Multiple Codex findings depended on specific code-base knowledge** that the spec author didn't have at draft time — `integration_connections.config_json` (not `meta`), Google Calendar `events.insert` does NOT honour `requestId`, Google Calendar push doesn't fire at reminder time, Slack `app_mention.user` is the sender not the bot owner. Each correction tightened the spec.
4. **The Slack auto-send dropdown** went through three rounds of refinement (iter3 framing fix → iter4 forward-compat hide → iter5 fixed-policy static-text) before stabilising on "deferred to a future spec that relaxes the §1 ceiling."

**Spec state at iteration cap:**

- All Codex findings classified as mechanical have been applied except where they would reverse a deliberate correctness decision (1 rejection in iter5).
- All Codex findings classified as directional have been resolved by the framing-assumption table (Step 7 priority 1): 5 AUTO-REJECTs (all the integration-test posture repeats), 1 AUTO-DECIDED (routed to `tasks/todo.md`).
- §27 open questions reduced from 15 to 12 by resolving the dedup mechanism, webhook nonces, voice_profile state column, and auto-send dropdown.

**Remaining latent risks the spec-reviewer cannot mechanically fix:**

- **The `actionService.proposeAction` composition decision (EA-V1-AD1).** If composition turns out to be feasible, the §24.3 state machine + §7.5 schema simplifies meaningfully — `sending` transitional state goes away, recovery contract simplifies. Phase 2 architect must verify the primitive's contract.
- **The DRAFT predecessor brief.** `user-owned-agents` is referenced as `MERGED before Phase 2 BUILD starts` but is currently DRAFT. The spec assumes the predecessor's column/index/RLS shapes are final; if the predecessor changes shape during its own Phase 2/3, EA V1 spec adjusts. Spec §3.2 acknowledges this risk.
- **The 1-minute Calendar lookahead cadence.** §27 Q3 flags this for Phase 2 confirmation — quota headroom permitting. If real-world Google rate-limits the 1-min cadence, the spec needs a fallback (5-min baseline + on-demand fast-track).
- **The `respond_to_invite` Tier 3 vs Tier 4 risk-tier rationale.** §27 Q1 flags this. The current spec uses Tier 3 + action-level review-gate override; the alternative is Tier 4 + tier-default review-gate. The behaviour is identical; the classification debate is non-binding.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across 5 iterations. The human has the following items to verify directionally:

1. **EA-V1-AD1 in `tasks/todo.md`.** Phase 2 architect investigates `actionService.proposeAction`'s contract and decides whether `ea_drafts` should compose over it or remain a parallel state machine.
2. **The framing assumptions at the top of `spec-reviewer.md`.** The review did NOT re-verify them against the current product stage. If pre-production no longer holds, or if the testing posture is shifting, re-read the spec's §1 Framing + §22 Execution model + §25 Testing posture before calling the spec implementation-ready.
3. **The `googleWebhook.ts` deferral.** This was a meaningful scope reduction during iter3 (originally listed as V1 scope in the user prompt). If the operator wants the route shipped in V1 despite no V1 consumer (e.g. for future-compat reasons), call this out before Phase 2.
4. **The locked Slack auto-send dropdown deferral.** The mockup `03-ea-settings.html` shows the dropdown but V1 renders it as static text. If the operator wants the dropdown shipped as interactive (even with all-options-identical V1 behaviour), call this out — Codex flagged it three times.
5. **The `risk_tier_ceiling` change (5 → 6).** Iter1 raised the ceiling because Tier 6 sends (`send_email`, `slack.post_message`, `slack.post_dm`) are in the default allowlist. If the operator wants Tier 6 stripped from the EA's V1 allowlist (e.g. no third-party sends in V1), call this out — the alternative is to drop those actions, which materially changes the EA's V1 capability shape.

**Recommended next step:** read the spec's §1 + §2 + §11 + §13 (~200 lines, the framing + workflow + provisioning core) one more time, confirm the headline decisions match your current intent (especially items 3-5 above), and only then start Phase 2 (architect → plan.md).

