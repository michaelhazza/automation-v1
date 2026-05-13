**Status:** accepted
**Spec date:** 2026-05-12
**Last updated:** 2026-05-13 (post-merge deferred-item sweep — 6 directional gaps closed as spec amendments per `tasks/builds/personal-assistant-v1/post-merge-audit-2026-05-13.md` §2; plus a second-pass consistency sweep on the same date — F1/F2/T1/T2/O1 — fixing downstream prose; plus a third-pass top-level sweep on the same date — F1B/F2B/F3B/F4B — fixing Goals + file inventory + workflow heading + route description; plus a fourth-pass residual-ambiguity sweep on the same date — F1C/F2C/F3C/F4C — fixing §10.3 / §10.6 / §21.1 / §22.1 / §23.2 / §10.5; plus a fifth-pass Slack-scope cleanup on the same date — F1D/F2D/F3D — fixing §10.9 / §13.4 step 10 / §9.2 to match the "V1 does not consume Slack inbound events" contract end-to-end; plus a sixth-pass Calendar-error-code cleanup on the same date — F1E below — fixing §24.2 + §24.9 HTTP mappings to use the REQ-CAL3-naming `DRAFT_NOT_*` family end-to-end. **Spec is now lock-clean for Phase 2 build.**)
**Author:** Claude (spec-coordinator) for michael@breakoutsolutions.com
**Build slug:** personal-assistant-v1
**Reviews complete:** spec-reviewer (Codex, 5 iter cap, 52 mechanical fixes) + chatgpt-spec-review (2 rounds, 8 findings closed; final verdict "build-ready" after round 2). Logs: `tasks/review-logs/spec-review-final-personal-assistant-v1-20260512T065942Z.md`, `tasks/review-logs/chatgpt-spec-review-personal-assistant-v1-2026-05-12T07-09-30Z.md`.

**Amendments 2026-05-13 (deferred-sweep PR).** Six directional gaps from the post-merge spec-conformance review (`tasks/review-logs/spec-conformance-log-personal-assistant-v1-2026-05-12T13-15-07Z.md`) reconciled by amending the spec to match the as-built code:

- **REQ-C4** — `voice_profiles` row shape: keep the simpler as-built columns (`sources[] text[]`, `source_config jsonb`, `refresh_config jsonb`, no `name` column). Spec §7.4 rewritten below. Rationale: code shape is operator intent; column-name churn buys nothing.
- **REQ-T8** — Dedup key formats: Slack uses `channelId@messageTs`; Calendar uses `calendarEventId@startAt@minutesUntilStart` (no `calendarId` prefix; no separate `lookaheadMinutes` axis — `minutesUntilStart` is the canonical horizon field). Spec §7.1 + §10.5 + §10.9 + §24.1 align with code. Rationale: both forms are unique per occurrence; the as-built shape is what callers already integrate against.
- **REQ-C1** — `ExternalSourceTriggerEvent` is the flat per-event-type discriminated union (no outer envelope). Spec §7.1 aligns with code. Rationale: the envelope added complexity without producer/consumer benefit.
- **REQ-EA3** — Partial unique index on `agents` for the EA: `(organisation_id, owner_user_id) WHERE slug = 'executive-assistant'`. Spec §13.4 amended. Rationale: an operator's EA is unique across their entire org, not per-subaccount — a single user has one EA regardless of which subaccount context they enter.
- **REQ-M15** — Personal nav group sits at the **top** of the sidebar (above the Workspace nav group). The spec already said top; the as-merged code placed it mid-list. Code amended to match the spec (`client/src/config/sidebar.ts` group order: `top → personal → work → projects → agents → ...`). Rationale: per-user agents are a first-class entry point in the operator UX; mid-list placement buries them.
- **REQ-CAL3-naming** — Calendar write-action error codes are the `DRAFT_NOT_*` family (`DRAFT_NOT_FOUND`, `DRAFT_NOT_APPROVED`, `DRAFT_SEND_IN_FLIGHT`, plus the newly-added `DRAFT_OWNER_MISMATCH` per the owner-mismatch assertion added in this sweep). Spec §8.4 amended. Rationale: per-state-machine codes are more diagnostic than the umbrella `missing_draft_context`.

**Second-pass consistency sweep 2026-05-13.** Five downstream-prose gaps that the deferred-sweep amendments above introduced but did not finish (the amendment block declared new intent at the top; downstream sections still carried the pre-amendment shapes). Reconciled by editing the affected sections so a Phase 2 build agent reading the spec end-to-end gets one consistent shape per concern:

- **F1 — EA visibility contract.** REQ-EA3 made the EA org-wide unique per user but later sections (§13.4 provisioning, §15.1 row description, §19.2 home-widget lookup, §14.1 sidebar lookup) still queried by `subaccount_id` or implied subaccount-scoped EA ownership. Added §6.2.1 stating the contract once (EA is org-wide visible per user; `agents.subaccount_id` is the home/default subaccount pointer for budget rollup and provisioning context, not a uniqueness or visibility filter; `agent_runs.subaccount_id` and credential resolution use the active session subaccount, supplied separately at run creation). Lookup queries and provisioning prose in §13.4 / §14.1 / §15.1 / §19.2 aligned to the §6.2.1 contract.
- **F2 — VoiceProfile schema sweep.** REQ-C4 dropped the `name` column and replaced the single-source `source` enum with `sources[]` + caller-shaped `source_config`. Stale references corrected in §12.2 (sampler-by-`source` becomes sampler(s)-by-`sources[]`), §12.5 default-provisioning shape, §12.7 admin-redaction metadata field list, §13.4 step 6 default-row creation, §21.1 RLS schema column list, and §26 deferred-`manual` sampler note.
- **T1 — External trigger dedup-key consistency.** REQ-T8 pinned per-event-type shapes in §7.1; §10.5 / §10.9 / §24.1 and the §5.1 file-inventory helper-key reference still carried the legacy shapes (Slack `slack_event_id`, Calendar with a `calendarId` prefix, generic `external_event_id` composite). All four locations aligned to the §7.1 canonical: Gmail = `messageId`, Calendar = `calendarEventId@startAt@minutesUntilStart`, Slack = `channelId@messageTs`.
- **T2 — Gmail polling recovery contracts.** §10.4 mentioned bootstrap (initial `getProfile` to seed `lastHistoryId`) in passing but did not pin the two operational recovery paths: (a) first-run / missing `lastHistoryId` MUST NOT backfill mailbox history into EA triggers (only seed the baseline); (b) expired/invalid `historyId` cursor (Gmail `404` / `failedPrecondition` on `users.history.list`) MUST emit a typed `trigger.suppressed` with reason `gmail_history_cursor_expired`, reset the baseline via `users.getProfile`, and continue forward — also without retroactive backfill. §10.4 and §10.7's `trigger.suppressed` reason enum amended; §24.4 cross-references.
- **O1 — Idempotency wording.** §24.1 previously claimed "exactly-once dispatch" via insert-conflict semantics. That is true only at the admission boundary (event-to-trigger-firing), not end-to-end (a process crash between dedup insert and run creation breaks the claim). Reworded to "at-most-once admission per dedup key; downstream execution remains at-least-once / effectively-once via existing run/idempotency contracts."

**Third-pass top-level sweep 2026-05-13.** Four top-level-prose gaps that survived the second-pass sweep — the body sections were correct but Goal statements, file-inventory rows, and a workflow heading still surfaced pre-amendment scope/ownership. A Phase 2 build agent reading the top of the spec first (Goals, file inventory) would have got the wrong contract before reaching the corrected body. Reconciled by aligning the top-level prose to the body:

- **F1B — Slack `slack_mention` scope.** Goal 4 said V1 routes Slack via Slack Events API and an extended `slackWebhook.ts`; the file-inventory row for `slackWebhook.ts` said the route dispatches `slack_mention` to `externalSourceTriggers`; §6.4 Type B, §7.1 producer line, §10.3 step 1, §10.6, §22.1, and §23.2 chunk 13 all carried the same in-scope framing. But §10.2 + §11.5 + §26 defer the `app_mention` event handling and the `ea.slack_thread_summary` workflow to V1.5. Reconciled: V1 ships the enum value, the Zod variant, the dedup-key shape, the URL-verification handshake, and the dormant `agent_triggers` subscription row (all forward-compat). V1 does NOT fire `slack_mention`. All seven references aligned to that scope.
- **F2B — Goal 6 VoiceProfile shape.** Goal 6 still said "two independent enums" and described `source` as a singular scalar enum, contradicting §7.4's amended `sources: text[]` + caller-shaped `source_config` shape. Rewritten to describe the `sources[]` allowlist, multi-source merge semantics, and the V1 element allowlist (`gmail_sent_sampler`, `drive_doc_sampler`; `manual` deferred).
- **F3B — Workflow B trigger naming.** Goal 5 said inbox triage uses "cron + webhook"; §11.2 heading said "cron + `gmail_message_received` webhook/poll". Both kept alive the pre-amendment Gmail-push framing that §10.4 + §26 deferred. Updated both to "cron + `gmail_message_received` polling trigger" to match the as-built Gmail polling design.
- **F4B — `eaDrafts` route description.** File inventory described the route as "list / approve / reject endpoints for owner's EA drafts" and §22.1 said "Approval triggers the inline send path of the underlying action via `eaDraftService.approve`", inviting a parallel approval state machine on `ea_drafts`. The §7.5 / §11.6 / §24.3 composition lock requires approval state to live on the proposal primitive. Reconciled: the route lists/joins EA draft previews against the linked proposal row, and the decide endpoint **proxies** the approve/reject decision to `actionService.proposeAction`'s decide surface. There is no `eaDraftService.approve` parallel state machine. §22.1 mirror-updated.

Plus a minor terminology alignment in §11.3: the meeting-prep trigger config was written as `lookaheadMinutes = 15`, but `lookaheadMinutes` is the scanner-side config name on `calendarLookaheadJob.ts`; the event-payload field per REQ-T8 is `minutesUntilStart` (also the canonical dedup-key axis). §11.3 now uses `minutesUntilStart` and notes the scanner-config → event-field correspondence so future greps don't re-introduce a stale token.

**Fourth-pass residual-ambiguity sweep 2026-05-13.** Four residual stale-text hits that survived the third-pass sweep — the third-pass summary listed these as fixed, but the third-pass edits either left the wording too close to the pre-amendment shape (so a strict reading still found Slack in the V1 producer list) or missed the body location entirely. A Phase 2 build agent doing a strict consistency read would still have surfaced these as ambiguity. Reconciled by tightening each location to the strictest possible reading:

- **F1C — Slack `slack_mention` is NOT a V1 producer (residual ambiguity).** §10.3 step 1 still mentioned `slackWebhook.ts` inside the V1-producer dispatch step (as a "future producer, no-op'd in V1"), which a strict reader could parse as "Slack is a V1 producer that happens to be no-op'd this release." Rewritten so §10.3's V1 producer list is exhaustively two entries (`gmailInboxPollJob.ts`, `calendarLookaheadJob.ts`); Slack is named as a V1.5 producer in a separate paragraph; the Zod discriminated union's `slack_mention` variant is described as forward-compat that no V1 call site emits. §10.6 reframed with an explicit "V1 scope (exhaustive)" + "Explicit V1 non-scope" two-paragraph structure so a glance read can't conflate scaffolding with consumer. §23.2 chunk 13 already aligned; no further edit needed.
- **F2C — `eaDraftService.approve` reference (re-confirmation + tightening).** §22.1's third-pass wording was correct (negated `eaDraftService.approve`) but a reviewer reading it strictly could miss the negation. Replaced with the reviewer's exact framing: "list/JOIN draft previews and proxy approve/reject decisions to the linked proposal primitive's decide surface; eaDraftService owns draft payload + post-approval send state only, not approval state; no `eaDraftService.approve`, no parallel approval state machine, no inline approval logic on the route."
- **F3C — VoiceProfile admin metadata field list (real stale-text hit).** §21.1's admin clause still listed the metadata fields as `(name, source, lastDerivedAt, state, optOutAt)` — the second-pass sweep updated §12.7's privacy-framing field list but missed the §21.1 RLS-policy field list. Updated to `(sources, lastDerivedAt, state, optOutAt, refreshPolicy, sampleSize)` per REQ-C4, with an explicit "no `name` column, no scalar `source`" callout and a `sourceConfig`-also-redacted note.
- **F4C — `lookaheadMinutes` vs `minutesUntilStart` terminology pin.** Existing references in §10.5 / §11.3 / §22.5 / file inventory all reference one of the two correctly, but the spec lacked a single binding sentence pinning the producer/consumer-boundary convention. Added a "Terminology pin" paragraph at the end of §10.5 stating: `lookaheadMinutes` is the scanner-side configuration name; `minutesUntilStart` is the event-payload field and the dedup-key axis; the scanner copies its current `lookaheadMinutes` value into the emitted event's `minutesUntilStart` field. Future Phase 2 plan.md / code authors get one explicit rule instead of having to grep.

**Fifth-pass Slack-scope cleanup 2026-05-13.** Three residual Slack-scope leftovers that survived the F1B / F1C scope fixes. The top-of-spec contract (Goal 4, §10.2, §10.6) was correct that V1 does not consume Slack inbound events, but three later sections still wrote as if Slack were an active V1 concurrency/dedup/provisioning surface. Reconciled so a Phase 2 build agent reading any cross-section combination still gets the same answer:

- **F1D — §10.9 Slack Events API concurrency bullet (residual active-surface phrasing).** The §10.9 concurrency-guarantees section still said "Slack Events API: at-least-once delivery from Slack; dedup via §7.1 dedup key" — that's V1.5 behaviour applied to the V1 contract. Rewritten to state explicitly that V1 only handles URL verification, no-ops `event_callback` payloads, admits no Slack inbound events into `externalSourceTriggers.ts` / `triggerService.fireTriggers`, writes no `slack_mention` rows to `external_trigger_dedup`, and that the §7.1 dedup-key shape is forward-compat for V1.5.
- **F2D — §13.4 step 10 dedup-ledger-from-day-one claim (real contract contradiction).** The provisioning step seeded a `slack_mention` `agent_triggers` row and claimed "the trigger row is still seeded so the dedup ledger captures `slack_mention` events from day one, but `triggerService.fireTriggers` returns 'no subscriber for this skill in V1' via the existing missing-skill suppression path." That contradicts the rest of the spec — Slack `event_callback` is no-op'd at the route, so nothing reaches `triggerService.fireTriggers`, and no dedup row is written. Replaced with: the row is **dormant forward-compat only**; V1 does NOT emit `slack_mention`, does NOT write Slack dedup rows, and does NOT invoke `triggerService.fireTriggers` for Slack mentions; pre-seeding the row is purely so V1.5 activation doesn't require a provisioning rerun; no `trigger.fired` or `trigger.suppressed` events for `slack_mention` are written in V1.
- **F3D — §9.2 `app_mentions:read` scope wording (forward-compat framing).** The scope bullet read "required for `app_mention` event subscription" — accurate at the Slack-app level but readable as "required by active V1 functionality" by a builder doing a strict scope-vs-feature audit. Reframed as forward-compat scope used in V1 only to allow subscription registration and URL verification; `app_mention` payload consumption deferred to V1.5; `chat:write` (already on the Slack provider entry for outbound posts per §9.1) noted but not re-added.

**Sixth-pass Calendar-error-code cleanup 2026-05-13 (final lock pass).** One residual stale-token class surfaced by the reviewer's final mechanical grep — REQ-CAL3-naming replaced the umbrella `missing_draft_context` code with the per-state-machine `DRAFT_NOT_*` family in §8.4, but §24.2's three HTTP-mapping bullets (for `create_event`, `update_event`, `respond_to_invite`) still wrote the live mapping as "422 with `code: 'missing_draft_context'`", and §24.9's unique-constraint table carried the canonical send-claim race code in lower-case (`draft_send_in_flight`) instead of `DRAFT_SEND_IN_FLIGHT`. Reconciled:

- **F1E — §24.2 + §24.9 Calendar HTTP error codes.** Each §24.2 HTTP-mapping bullet now spells out the four `DRAFT_NOT_*` mappings explicitly (`DRAFT_NOT_FOUND` 404 / `DRAFT_OWNER_MISMATCH` 403 / `DRAFT_NOT_APPROVED` 422 / `DRAFT_SEND_IN_FLIGHT` 409) with an explicit REJECTED callout for the pre-amendment umbrella code. §24.9's `ea_drafts` send-claim race row case-normalised to `DRAFT_SEND_IN_FLIGHT`. After this edit, `missing_draft_context` survives only in the amendment-block audit history (line 15) and in explicit-rejection callouts in §8.4 and §24.2 — there is no live HTTP mapping using the umbrella code anywhere in the spec.

# Executive Assistant V1 — Spec

## Contents

1. [Framing](#1-framing)
2. [Goals + non-goals](#2-goals--non-goals)
3. [What's locked from upstream](#3-whats-locked-from-upstream)
4. [Phase plan](#4-phase-plan)
5. [File inventory lock](#5-file-inventory-lock)
6. [Domain model](#6-domain-model)
7. [Contracts](#7-contracts)
8. [Google Calendar OAuth + actions](#8-google-calendar-oauth--actions)
9. [Slack agent actions](#9-slack-agent-actions)
10. [External-source trigger primitive](#10-external-source-trigger-primitive)
11. [V1 workflows](#11-v1-workflows)
12. [Voice Profile primitive](#12-voice-profile-primitive)
13. [EA system-agent template + provisioning](#13-ea-system-agent-template--provisioning)
14. [UI surfaces](#14-ui-surfaces)
15. [Multi-user consumption of `user-owned-agents`](#15-multi-user-consumption-of-user-owned-agents)
16. [Notification + delivery + connection labelling](#16-notification--delivery--connection-labelling)
17. [Capability grouping for the connection UI](#17-capability-grouping-for-the-connection-ui)
18. [Live-fetch vs canonical decision](#18-live-fetch-vs-canonical-decision)
19. [Home-widget contribution contract](#19-home-widget-contribution-contract)
20. [Failure modes for triggered runs](#20-failure-modes-for-triggered-runs)
21. [Permissions and RLS checklist](#21-permissions-and-rls-checklist)
22. [Execution model](#22-execution-model)
23. [Phase sequencing dependency graph](#23-phase-sequencing-dependency-graph)
24. [Execution-safety contracts](#24-execution-safety-contracts)
25. [Testing posture](#25-testing-posture)
26. [Deferred items](#26-deferred-items)
27. [Open questions for Phase 2](#27-open-questions-for-phase-2)

## 1. Framing

**Source brief:** `tasks/builds/personal-assistant-v1/brief.md` (locked 2026-05-12, ratified after challenge-round scope-tightening and capability-alignment correction).

**Strategic parent:** `docs/synthetos-governed-agentic-os-brief-v1.2.md` §16.1 (Executive Assistant use case), §6.3 (Native Controller), §17 (use-case coverage matrix).

**Stage context** (per `docs/spec-context.md`): pre-production, rapid_evolution, static_gates_primary testing posture, commit_and_revert rollout. No live users, no live agencies. Breaking changes expected; do not author feature-flag gates for new schema.

**Naming.** The product surfaces an agent labelled "Personal Assistant" (configurable per subaccount). Its system slug is `executive-assistant` (master brief §16.1). The build slug `personal-assistant-v1` is the build-effort identifier, not the agent name.

**Strategic intent.** This is the first concrete consumer of the `user-owned-agents` foundation primitive (`tasks/builds/user-owned-agents/brief.md`). The spec succeeds if it proves the primitive is consumable end-to-end, not if it competes on personal-productivity richness with Claude / ChatGPT / Codex / Copilot. Explicit non-goal: replacing general-purpose personal AI assistants. SynthetOS owns the parts where individual-user automation must be governed, auditable, policy-controlled, connected to SynthetOS-native workflows, and aware of organisation/subaccount context.

**Reuse acceptance criterion** (carried from the predecessor brief). A stub second user-owned agent (e.g. a placeholder Dev Agent template) must be able to:
- appear in the Personal nav group + home Personal zone,
- render a home-widget contribution via the same contract,
- open the same per-agent tabbed shell,
- resolve only the owning user's credentials via the broker,
- emit user-owned run activity scoped to the owner,
- expose admin metadata without private content,

without EA-specific code branching. V1 ships the contracts + the EA as the first consumer; the stub second agent's full implementation is out of scope.

**Framing assumptions (binding on §22 execution model and §24 execution-safety contracts):**
- Every user-owned EA run is short and deterministic. No long-lived sessions; no autonomous multi-turn investigations. Long-running autonomous behaviour belongs to V2 (Operator Mode).
- Every Tier 4+ write to a third-party system is review-gated. Auto-send only to the operator's own surfaces (own Slack DMs, own Gmail Drafts).
- Personal-data reads (inbox content, calendar attendees, Slack quotes) are live-fetched, not mirrored. Canonical storage is reserved for derived features + state the agent needs across runs (drafts, memory, voice profile, run trace).
- Admins see metadata; admins do not see content. Break-glass override is logged + user-notified. Default-deny on content per the `user-owned-agents §3.6` admin-redaction policy.


## 2. Goals + non-goals

### Goals

1. Ship the `executive-assistant` system-agent template with `controllerStyle: 'native'` locked, restricted skill bundle, and per-instance display-name customisation.
2. Register Google Calendar as an OAuth provider and ship 6 Calendar actions: 3 reads (`list_events`, `get_event`, `find_free_slot`) auto-gated; 3 writes (`create_event`, `update_event`, `respond_to_invite`) review-gated. `delete_event` deferred.
3. Promote Slack from a delivery channel to a first-class agent connector. Ship 6 Slack actions: 4 reads + 2 writes. V1 Slack send policy is fixed: DM-to-owner is auto-allowed; all other Slack writes (channel posts, non-owner DMs) are review-gated. The configurable per-instance dropdown shown in the locked Settings mockup is rendered as static text in V1; the dropdown is deferred per §9.3 + §26.
4. Introduce the **external-source trigger** primitive on `agent_triggers`. Three new event types are added to the enum: `gmail_message_received`, `calendar_event_imminent`, `slack_mention`. **V1 fires two of the three:** `gmail_message_received` via the Gmail polling job (`gmailInboxPollJob.ts`); `calendar_event_imminent` via the Calendar lookahead scan job (`calendarLookaheadJob.ts`). The `slack_mention` enum value, its Zod variant in `shared/types/externalSourceTrigger.ts`, its dedup-key shape in §7.1, and the (dormant) `agent_triggers` subscription row seeded by §13.4 step 10 are all forward-compat scaffolding for V1.5 Workflow #4 — V1 does NOT fire `slack_mention` from any code path. The `slackWebhook.ts` extension is limited to the Slack URL-verification handshake (so the Slack-app Events-API subscription can be configured at install time); any `app_mention` `event_callback` received in V1 is no-op'd at the route per §10.2. Calendar push channels are NOT used in V1 (deferred to V1.5 per §7.8 / §10.2 — push does not fire at reminder time, so V1's `calendar_event_imminent` comes from scheduled lookahead, not push).
5. Ship 3 V1 workflows: daily briefing (07:00 cron + Slack DM), inbox triage with drafted replies (07:15 cron + `gmail_message_received` polling trigger), meeting prep summary (`calendar_event_imminent` trigger 15min before, from the Calendar lookahead scan).
6. Introduce the **VoiceProfile** primitive as a reusable platform resource (designed for EA, Riley, Helena, future content agents). Two independent shape axes on the schema (see §7.4 for the row contract):
   - `sources: text[]` (which sampler(s) read content): V1 allowlist for `sources[]` elements = `'gmail_sent_sampler'` and `'drive_doc_sampler'`. The `'manual'` element (operator pastes content) is deferred to V1.5 per §26. **Multi-source rows are supported**: a single profile MAY list more than one sampler — at derivation time the service runs each listed sampler against its slice of `source_config` and merges samples across all listed sources before distillation. The pre-amendment scalar `source` enum is rejected by the V1 schema CHECK (REQ-C4).
   - `refreshPolicy` (when to re-derive): V1 ships `'periodic'` (EA default = 30 days) and `'manual'` (operator-triggered only, no automatic refresh). The `'on_send_count'` value is schema-reserved but rejected by the write API in V1; activation is deferred per §26.

   Opt-in by default with one-click opt-out.
7. Introduce the **home-widget contribution contract** so any user-owned agent can declaratively contribute a card to the user's home Personal zone. EA is the first consumer.
8. Ship the **Personal nav group** in the sidebar (data-driven from `owner_user_id = current_user.id`) and the **home Personal zone** card grid. Both render empty when the user has no user-owned agents.
9. Ship the **first-run setup wizard** (existing locked mockup `prototypes/personal-assistant-v1/01-first-run-setup.html`), the **per-agent tabbed detail page** (Workspace / Activity / Settings), and the **EA settings page** (existing locked mockup `03-ea-settings.html`).
10. Ship the **connection chip** distinguishing `Personal` (user-owned `integration_connections`) from `Subaccount` (`owner_user_id IS NULL`) on `ConnectionsPage.tsx`.
11. Ship the **capability-grouping layer** for the connection UI (`server/config/capabilityGroups.ts`) — 4 user-facing groups mapping to existing integration-reference slugs.
12. Honour the `user-owned-agents §3.6` admin-redaction policy at the API serialisation layer for `agent_runs` content, `memory_blocks`, and `voice_profiles.profile_json`.

### Non-goals (explicit)

| Non-goal | Belongs in |
|---|---|
| `controllerStyle: 'operator'` on the EA agent | V2 (`personal-assistant-v2-operator`); depends on Spec D |
| Long-running autonomous sessions (multi-turn investigations) | V2 |
| ChatGPT OAuth as operator-session identity for the EA | V2 (consumes Spec C + Spec D) |
| Notion connector + actions | Operator-deferred; not in v1.2 master brief scope |
| Outlook / Microsoft 365 connector + actions | Operator-deferred; v1 dogfood is Google stack |
| Cross-session durable memory beyond existing `memory_blocks` / `update_memory_block` | Phase 3 (master brief §13) |
| Calendar conflict detection + automated reschedule | Fast follow-on |
| Expense receipt extraction + subscription tracker | Phase 1.5 |
| Customer productisation (multi-customer EA tier) | Not in roadmap |
| Browser Environment usage by the EA | Phase 2 / V2 (Operator Controller on Browser) |
| Calendar `delete_event` action | V1.5 (destructive, not yet in `WorkspaceAdapter`) |
| Drive writes (Docs / Sheets editing) | V1.5 (no V1 use case, ~3 dev-days real cost) |
| Gmail push notifications via Pub/Sub | Phase 1.5 (5-min polling V1; flag-gated push later) |
| Workflows #4 (Slack mention thread summary) + #5 (weekly review) | Fast follow-on once V1 trio lands cleanly |
| Per-user budget caps | Phase 1.5 IF customer demand emerges |
| Break-glass admin UI for redaction reveal | Phase 1.5 (V1 enforces redaction + audit event; admin access via direct API until UI ships) |
| Cross-ownership delegation (user-owned ↔ subaccount-owned agent calls) | Future spec — schema supports it; routing rules deferred |
| Shared user-scoped memory across multiple user-owned agents | Additive primitive IF a real need emerges |

The non-goals are binding on V1 scope decisions. Features that look like "compete with Claude on personal productivity richness" are cut; features that prove "governed user-owned agency works end-to-end inside SynthetOS" are in.


## 3. What's locked from upstream

Two classes: (a) primitives already merged that this spec composes; (b) the locked predecessor that gates Phase 2 BUILD start.

### 3.1 Merged primitives (composed by this spec)

| Capability | Source | Status |
|---|---|---|
| `controllerStyle` field on `agent_runs` (`native` / `operator`) | Phase 1 foundation refactor | merged PR #279 |
| Risk Tier 0–6 classification + `verify-risk-tier-assigned` CI gate | Phase 1 foundation refactor | merged PR #279 |
| `CredentialBrokerService` facade + subaccount-scoped retrieval + redacted env injection | Phase 1 foundation refactor | merged PR #279 |
| `PolicyEnvelopeResolver` + per-run `agent_runs.policy_envelope_snapshot` JSONB | Phase 1 foundation refactor | merged PR #279 |
| Run Trace virtual view over 7 ledger tables | Phase 1 foundation refactor | merged PR #279 |
| Gmail OAuth provider + `send_email` (Tier 6, review-gated) + `read_inbox` (Tier 2, auto) | shipped | shipped |
| Google Drive OAuth provider + read-only resolver via `read_data_source` | shipped | shipped |
| Slack OAuth provider + outbound delivery (`channels:read`, `chat:write`, `chat:write.public`, `users:read`, `files:write`) | shipped | shipped (no agent-callable read actions yet) |
| Web actions (`web_search`, `fetch_url`, `scrape_url`, `scrape_structured`, `monitor_webpage`) | shipped | shipped |
| System-agent registry pattern (`SystemAgentEntry` in `server/config/c.ts` + DB seed migration mirror) | shipped (precedent: migration 0256) | shipped |
| Scheduled-task engine (RRULE + IANA-timezone) | `server/services/scheduledTaskService.ts` | shipped |
| Agent triggers engine (event types `task_created` / `task_moved` / `agent_completed`) | `server/services/triggerService.ts` + `server/db/schema/agentTriggers.ts` | shipped |
| Webhook ingestion pattern (per-org HMAC + replay nonces) | `server/routes/webhooks/` (GHL, Slack, Stripe, Teamwork precedents) | shipped |
| HITL approval workflow + Slack-approval delivery channel | shipped | shipped |
| Three-tier agent model (System / Org / Subaccount) + hierarchical delegation | shipped | shipped |
| `WorkspaceAdapter` (`shared/types/workspaceAdapterContract.ts`) with `synthetos_native` + `google_workspace` backends, exposing `createEvent` + `respondToEvent` | shipped | shipped |
| Integration-reference taxonomy (`docs/integration-reference.md`) + `scripts/verify-integration-reference.ts` CI gate | shipped | shipped |
| Per-agent `subaccount_agents.capability_map` JSONB computed by `capabilityMapService.ts` | shipped | shipped |
| `rls.context-propagation.test.ts` Layer B integration test harness | shipped | shipped |
| `agentExecutionEventService` + agent-run execution-event ledger | shipped | shipped |
| Recurring-task pattern via `recurringTasksService` | shipped | shipped |
| RLS_PROTECTED_TABLES manifest + `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` | shipped | shipped |

### 3.2 Locked predecessor (gates Phase 2)

| Capability | Source | Status |
|---|---|---|
| `agents.owner_user_id` column (nullable; references `users.id` ON DELETE RESTRICT) + partial index `(organisation_id, owner_user_id) WHERE NOT NULL` | `tasks/builds/user-owned-agents/brief.md` §3.1 | **PREDECESSOR — must MERGE before Phase 2 BUILD starts** |
| `agent_runs.owner_user_id` column (nullable, copied from agent at run creation, immutable) + partial index `(organisation_id, owner_user_id, started_at DESC) WHERE NOT NULL` | predecessor §3.2 | predecessor |
| `integration_connections.owner_user_id` column (nullable) + partial unique index `(organisation_id, subaccount_id, owner_user_id, provider) WHERE NOT NULL` | predecessor §3.3 + §4 q1 | predecessor |
| `CredentialBrokerService.injectIntoEnvironment({ ownerUserId? })` signature extension + owner-scoped lookup + `OWNER_MISMATCH` typed error + owner-scoped revocation | predecessor §3.3 | predecessor |
| RLS clauses on `agent_runs` + `integration_connections` for user-owned visibility (`owner_user_id IS NULL` OR `owner_user_id = current_user_id` OR admin role) | predecessor §3.5 | predecessor |
| Admin redaction policy at API serialisation: Run Trace content payload, `memory_blocks`, voice-profile content → REDACTED for admin roles by default | predecessor §3.6 | predecessor |
| Typed audit event `owner.content_revealed` for break-glass overrides; user notification on next login; default 7-day time-limited, run-id-scoped grant | predecessor §3.6 | predecessor (V1 ships the typed event; UI surface for admin requests deferred per predecessor's own scope) |
| Memory remains per-agent (no `scope_type` / `scope_id` abstraction); each user-owned EA agent row has its own `memory_blocks` rows by virtue of being a separate agent row | predecessor §3.4 | predecessor (no new schema needed in EA V1) |
| Doc updates: master brief §5.1 + §9 + `architecture.md` + `KNOWLEDGE.md` for the ownership-axis concept | predecessor §3.9 | predecessor (shipped in predecessor's own doc-sync sweep) |

**Phase 2 BUILD gate.** The `feature-coordinator` invoked in Phase 2 of this build MUST verify the predecessor has reached MERGED before authoring `plan.md`. If predecessor is still in flight (`PLANNING` / `BUILDING` / `REVIEWING` / `MERGE_READY`), Phase 2 pauses with a clear operator-facing message. Phase 1 spec authoring is NOT gated.

Nothing else on the foundation is in flux. This spec is a pure composer of the merged primitives in §3.1 plus the predecessor primitives in §3.2 plus three new connector surfaces (Calendar OAuth + actions, Slack agent actions, external-source webhook triggers) plus two new platform-level primitives (VoiceProfile, home-widget contract) plus one new agent template (`executive-assistant`).


## 4. Phase plan

Single-phase build. No phase-1 / phase-2 / phase-3 split inside this spec. Phase sequencing inside the build is captured as a chunk dependency graph in §23.

Rationale: every primitive shipped here is additive to merged foundations + the locked predecessor. No primitive needs a separate launch window. Splitting into phases would introduce phase-boundary contradictions (e.g. "EA agent template ships in P1 but its credential resolution needs the broker extension shipping in P2") without operator-visible benefit.

Phases ABOVE this spec (the three-coordinator pipeline) remain:
- **Phase 1 — SPEC.** This document. Single coordinator run (spec-coordinator).
- **Phase 2 — BUILD.** feature-coordinator + architect (plan.md) + per-chunk builder + per-chunk G1 + branch-level review pass (spec-conformance → pr-reviewer → dual-reviewer → adversarial-reviewer). Gated on predecessor MERGED.
- **Phase 3 — FINALISATION.** finalisation-coordinator + chatgpt-pr-review + doc-sync sweep + MERGE_READY label.

Chunk count for Phase 2 is estimated 12–16 chunks. The architect agent during Phase 2 emits the final chunk count after reading the file inventory in §5.


## 5. File inventory lock

Every file this spec touches. Adding a prose reference in any later section requires cascading the file into this table in the same edit. Migration numbering: predecessor `user-owned-agents` claims the next migration window for its 3 columns + 3 indexes + 2 RLS clauses; EA V1 picks up the migrations AFTER predecessor's window. The architect agent in Phase 2 finalises exact numbering against `migrations/` at the time of build.

### 5.1 New files

| Path | Purpose | Section |
|---|---|---|
| `migrations/NNNN_executive_assistant_seed.sql` (+ down) | Add `home_widget jsonb` column to `system_agents` table (nullable; null = template does not surface to home zone); seed the `executive-assistant` system_agents row populating slug, name, default skill bundle, risk-tier ceiling, default approval policy, default system prompt, and `home_widget` declaration per §13.1; add partial unique index `agents_personal_assistant_per_user_idx ON agents(organisation_id, owner_user_id) WHERE slug = 'executive-assistant'` (REQ-EA3 amendment 2026-05-13 — org-wide uniqueness, not subaccount-wide) to defend against racing provisioning inserts (§13.4 concurrency guard) | §13, §13.4 |
| `migrations/NNNN_voice_profiles.sql` (+ down) | Create `voice_profiles` table + indexes + RLS policy + RLS_PROTECTED_TABLES registration | §12, §21 |
| `migrations/NNNN_ea_drafts.sql` (+ down) | Create `ea_drafts` table + indexes + RLS policy + RLS_PROTECTED_TABLES registration | §18, §21 |
| `migrations/NNNN_external_source_triggers.sql` (+ down) | Extend `agent_triggers.event_type` enum to add `gmail_message_received`, `calendar_event_imminent`, `slack_mention`; create `external_trigger_dedup` table with `UNIQUE(provider, dedup_key, owner_user_id)` for trigger idempotency (see §7.1 + §10.4 for the per-event-type `dedup_key` shape) + RLS policy + RLS_PROTECTED_TABLES registration | §10, §24.1 |
| `server/services/calendar/calendarActionService.ts` | Calendar action handlers: `list_events`, `get_event`, `find_free_slot`, `create_event`, `update_event`, `respond_to_invite` | §8 |
| `server/services/calendar/calendarActionServicePure.ts` | Pure helpers: input validation, idempotency-key derivation, free-slot computation, RFC5545 attendee normalisation | §8, §24, §25 |
| `server/services/slack/slackActionService.ts` | Slack action handlers: `list_channels`, `read_channel`, `search_messages`, `summarise_thread`, `post_message`, `post_dm` | §9 |
| `server/services/slack/slackActionServicePure.ts` | Pure helpers: input validation, idempotency-key derivation, auto-send-scope decision, thread-summary prompt-payload assembly | §9, §24, §25 |
| `server/services/triggers/externalSourceTriggers.ts` | External-source trigger orchestration: signature verification, subaccount resolution, owner-user resolution, dispatch into `triggerService.fireTriggers` with `triggerContext.source = 'external'` | §10 |
| `server/services/triggers/externalSourceTriggersPure.ts` | Pure helpers: dedup-key derivation per REQ-T8 (per-event-type shapes — Gmail = `messageId`, Calendar = `calendarEventId@startAt@minutesUntilStart`, Slack = `channelId@messageTs`; all canonicalised into the single `(provider, dedup_key, owner_user_id)` PK shape on `external_trigger_dedup` per §7.1), payload normalisation, calendar-lookahead computation | §10, §24, §25 |
| `server/services/voiceProfile/voiceProfileService.ts` | VoiceProfile service: derive/refresh/read; pluggable samplers (`gmail_sent_sampler`, `drive_doc_sampler`; `manual` deferred per §26) | §12 |
| `server/services/voiceProfile/voiceProfileServicePure.ts` | Pure helpers: feature distillation from sample messages, refresh-trigger decision, opt-out enforcement | §12, §25 |
| `server/services/voiceProfile/samplers/gmailSentSampler.ts` | Sample last N sent messages via existing `read_inbox` adapter; transient read (no body persistence) | §12 |
| `server/services/voiceProfile/samplers/driveDocSampler.ts` | Sample specified Drive doc(s) via existing read-only resolver | §12 |
| `server/services/eaDrafts/eaDraftService.ts` | EA-draft CRUD with state machine + audit-event emission | §11, §18, §24 |
| `server/services/eaDrafts/eaDraftServicePure.ts` | Pure helpers: state-transition rules, expiry computation | §11, §24, §25 |
| `server/services/homeWidget/homeWidgetService.ts` | Read user-owned agents for current user, invoke each agent template's `body_provider_skill`, return ordered `WidgetData[]` | §19 |
| `server/services/homeWidget/homeWidgetServicePure.ts` | Pure helpers: widget-card ordering, refresh-policy evaluation | §19, §25 |
| `server/routes/voiceProfiles.ts` | API: GET / refresh / opt-out endpoints for owner's voice profiles. RLS-defended | §12, §21 |
| `server/routes/eaDrafts.ts` | API: (a) list / get EA draft previews (the `ea_drafts.body` payload + the linked proposal's approval state, joined via `ea_drafts.proposalId`); (b) approve / reject endpoints that **proxy the decision to the proposal primitive** (`actionService.proposeAction`'s decide surface) — `ea_drafts` NEVER owns approval state per §7.5 composition lock. The route is a JOIN + proxy convenience for the per-agent Workspace tab; it does NOT host a parallel approval state machine. RLS-defended | §11, §18 |
| `server/routes/agentHomeWidgets.ts` | API: GET widget data for current user's user-owned agents. RLS-defended | §19 |
| `server/jobs/gmailInboxPollJob.ts` | pg-boss job: 5-minute polling fallback per connected Gmail account. Calls Gmail `users.history.list` with single-writer-per-connection guarantee via advisory lock | §10, §24 |
| `server/jobs/calendarLookaheadJob.ts` | pg-boss recurring job (every 1 min per connected Calendar account): scan the owner's primary calendar for events in `[now, now + lookaheadMinutes]` via `events.list`; fire `calendar_event_imminent` for events not already in the dedup ledger. Replaces the prior Calendar-push-channel design (Google Calendar push notifications fire on event create/update, NOT at reminder time — push cannot produce a 15-minute-before trigger). Single-writer-per-connection via advisory lock on `('calendar_lookahead', integration_connection_id)` | §10, §11.3, §24 |
| `server/jobs/voiceProfileRefreshJob.ts` | pg-boss job: refresh voice profiles whose refresh-policy threshold has triggered | §12, §24 |
| `server/skills/ea-home-widget-summary.md` | Skill: returns EA's home widget body (briefing one-liner + drafts count + next meeting prep + run recency) | §19 |
| `server/skills/ea-daily-briefing.md` | Workflow skill: assemble + post daily briefing | §11 |
| `server/skills/ea-inbox-triage.md` | Workflow skill: classify inbox + draft replies | §11 |
| `server/skills/ea-meeting-prep.md` | Workflow skill: assemble meeting prep summary | §11 |
| `server/skills/slack-list-channels.md` + `slack-read-channel.md` + `slack-search-messages.md` + `slack-summarise-thread.md` + `slack-post-message.md` + `slack-post-dm.md` | One skill markdown per Slack action | §9 |
| `server/skills/calendar-list-events.md` + `calendar-get-event.md` + `calendar-find-free-slot.md` + `calendar-create-event.md` + `calendar-update-event.md` + `calendar-respond-to-invite.md` | One skill markdown per Calendar action | §8 |
| `server/config/capabilityGroups.ts` | UI grouping layer: 4 user-facing groups (Email, Calendar, Files, Team chat) → existing integration-reference slugs | §17 |
| `shared/types/homeWidget.ts` | `HomeWidgetType` discriminated union + per-type `WidgetData` shape | §19, §7 |
| `shared/types/eaDraft.ts` | EA-draft state-machine enum + draft row Zod schema | §11, §7 |
| `shared/types/voiceProfile.ts` | VoiceProfile row Zod schema + sampler-config Zod discriminated union | §12, §7 |
| `shared/types/externalSourceTrigger.ts` | External-source trigger event payload Zod discriminated union (`gmail_message_received` / `calendar_event_imminent` / `slack_mention`) | §10, §7 |
| `shared/types/calendarAction.ts` | Calendar action input/output Zod schemas | §8, §7 |
| `shared/types/slackAction.ts` | Slack action input/output Zod schemas | §9, §7 |
| `client/src/pages/personal/PersonalAssistantPage.tsx` | Tabbed per-agent shell (Workspace / Activity / Settings). Wraps existing primitives; renders existing prototype mockup 02 + 03 | §14 |
| `client/src/pages/personal/EAFirstRunWizard.tsx` | First-run setup wizard. Renders existing prototype mockup 01 | §14, §13 |
| `client/src/components/personal/PersonalZoneCard.tsx` | Home Personal-zone card frame (consistent visual frame for any home-widget agent contribution) | §14, §19 |
| `client/src/hooks/useUserOwnedAgents.ts` | Hook: list current user's user-owned agents (`agents WHERE owner_user_id = current_user.id`) | §14, §15 |
| `client/src/hooks/useHomeWidgets.ts` | Hook: fetch widget data for current user's user-owned agents | §19 |
| `client/src/hooks/useVoiceProfile.ts` | Hook: read + refresh + opt-out for current user's voice profile | §12 |
| `client/src/hooks/useEADrafts.ts` | Hook: list + approve + reject for current user's EA drafts | §11 |
| `prototypes/personal-assistant-v1/01-first-run-setup.html` | EXISTING locked mockup — first-run wizard | §14 |
| `prototypes/personal-assistant-v1/02-my-ea-home.html` | EXISTING locked mockup — home Personal zone | §14 |
| `prototypes/personal-assistant-v1/03-ea-settings.html` | EXISTING locked mockup — per-instance EA settings | §14 |
| `prototypes/personal-assistant-v1/index.html` | EXISTING mockup index | §14 |
| `server/services/calendar/calendarActionServicePure.test.ts` | Vitest sibling — tests `validateCreateEventInput` / `validateUpdateEventInput` / `validateRespondToInviteInput` / `deriveIdempotencyKey` / `normaliseAttendees` / `computeFreeSlots` per §25.2 | §25 |
| `server/services/slack/slackActionServicePure.test.ts` | Vitest sibling — tests `decideAutoSendScope` (3 scopes × 2 actions × 3 targets = 18 cases) / `validatePostMessageInput` / `validatePostDmInput` / `deriveIdempotencyKey` / `assembleThreadSummaryPrompt` per §25.2 | §25 |
| `server/services/triggers/externalSourceTriggersPure.test.ts` | Vitest sibling — tests `deriveDedupKey` / `computeCalendarLookahead` per §25.2 | §25 |
| `server/services/voiceProfile/voiceProfileServicePure.test.ts` | Vitest sibling — tests `distilFeatures` / `shouldRefresh` per §25.2 | §25 |
| `server/services/eaDrafts/eaDraftServicePure.test.ts` | Vitest sibling — tests `canTransition` / `computeExpiresAt` per §25.2 | §25 |
| `server/services/homeWidget/homeWidgetServicePure.test.ts` | Vitest sibling — tests `orderAgents` / `shouldRefetch` per §25.2 | §25 |
| `tests/integration/userOwnedAgentCredentialIsolation.test.ts` | Vitest integration — exercises broker owner-scoping with two users in the same subaccount; cross-fetch attempt raises typed `OWNER_MISMATCH`. Sibling to `rls.context-propagation.test.ts` (an `accepted_primitive` per `docs/spec-context.md`) | §25.3 |

### 5.2 Modified files

| Path | Reason | Section |
|---|---|---|
| `server/config/oauthProviders.ts` | (a) Add `google_calendar` provider entry (authUrl, tokenUrl, scopes, `access_type: 'offline'`, `prompt: 'consent'`); env-var convention `OAUTH_GOOGLE_CALENDAR_CLIENT_ID` / `_CLIENT_SECRET`. (b) Extend the existing `slack` provider entry: add scopes `channels:history`, `groups:history`, `im:history`, `mpim:history`, `im:write`, `search:read`, `app_mentions:read` per §9.2; document the Slack `Event Subscriptions` config (`app_mention` event subscribed) per §10.6 — the subscription is configured at the Slack-app level (Slack admin UI), the spec-time reference in this file is a comment noting it | §8, §9.2, §10.6 |
| `server/config/actionRegistry.ts` | Add 6 Calendar actions + 6 Slack actions with risk tiers, default gates, Zod schemas, verify shapes, MCP annotations, retry policies, `requiredIntegration`. Register two new topic slugs `'calendar'` and `'slack'` in topic associations | §8, §9 |
| `server/config/topicRegistry.ts` | Add two new topics: `calendar` + `slack` | §8, §9 |
| `server/config/c.ts` | Add `executive-assistant` entry to `SUBACCOUNT_AGENTS` array with `agentRole: 'Specialist'`, `executionScope: 'subaccount'`. Mirror the DB seed row | §13 |
| `server/config/universalSkills.ts` | No change — V1 confirms universal skill list is unchanged | §13 |
| `server/services/triggerService.ts` | Extend `eventType` union to include the 3 new external-source event types (`gmail_message_received`, `calendar_event_imminent`, `slack_mention`). Propagate the new types through `fireTriggers`, `getTriggersForAgent`, and the `data` payload type | §10 |
| `server/db/schema/agentTriggers.ts` | Extend `agent_triggers.event_type` enum to include the 3 new external-source event types | §10 |
| `server/db/schema/integrationConnections.ts` | No change — predecessor adds `owner_user_id` column | §3.2 |
| `server/db/schema/agents.ts` | No change — predecessor adds `owner_user_id` column | §3.2 |
| `server/db/schema/agentRuns.ts` | No change — predecessor adds `owner_user_id` column | §3.2 |
| `server/db/schema/systemAgents.ts` | Add `homeWidget: jsonb('home_widget').$type<HomeWidgetDeclaration | null>()` column reflecting the migration in §5.1's `NNNN_executive_assistant_seed.sql`. Drizzle-level type matches `shared/types/homeWidget.ts` | §7.6, §13 |
| `server/services/credentialBrokerService.ts` | No change — predecessor extends `injectIntoEnvironment({ ownerUserId? })` | §3.2 |
| `server/routes/webhooks/slackWebhook.ts` | V1 scope: add the Slack `url_verification` handshake (`payload.type === 'url_verification'` echoes the `challenge`) so the Slack-app Events-API subscription can be configured at install time. Existing `block_actions` approval-callback handling preserved unchanged. `event_callback` payloads (including `app_mention`) are received and **no-op'd at the route in V1** (200 OK to Slack, no dispatch into `externalSourceTriggers`); the `slack_mention` trigger firing path is deferred to V1.5 alongside Workflow #4 per §10.2 + §26. | §10 |
| `server/jobs/workflowGateStallNotifyJob.ts` | Extend existing stall-handler to cover EA-linked proposal rows: emit one-time 24h reminder when the linked proposal row remains in approval state `pending` past its reminder threshold; transition expired proposal rows (`createdAt + 7d`) to approval state `expired`. The `ea_drafts` row's `sendState` stays `idle` after expiry. Approval-side state is owned by the proposal primitive; this job dispatches against proposal rows that carry the `eaDraftId` reference. Existing workflow-gate stall behaviour preserved | §7.5, §20.4, §22.2 |
| `server/services/agentExecutionService.ts` (and / or its `*Pure.ts` sibling) | Prompt-assembly extension: inject `<voice>` block before the task prompt when the agent has a configured `voice_profile_id` AND the profile's `optOutAt IS NULL`. Single small addition; no other change. Architect in Phase 2 confirms whether the change is in the main service file or in `agentExecutionServicePure.ts` per the existing pure-helper convention | §12.4, §22.3 |
| `server/routes/oauthIntegrations.ts` | No code change — callback handler is provider-generic and picks up `google_calendar` automatically when registered in `oauthProviders.ts` | §8 |
| `server/config/rlsProtectedTables.ts` | Add entries for `voice_profiles`, `ea_drafts`, `external_trigger_dedup` | §21 |
| `server/lib/permissions.ts` | Add 6 new permission keys: `VOICE_PROFILE_READ`, `VOICE_PROFILE_WRITE`, `EA_DRAFT_READ`, `EA_DRAFT_DECIDE`, `HOME_WIDGET_READ`, `EA_PROVISION`; each adds an `ALL_PERMISSIONS` entry. Existing `ORG_PERMISSIONS` cover admin redaction (no new admin-only keys) | §21.5 |
| `shared/types/agentExecutionLog.ts` | Add `AGENT_EXECUTION_EVENT_CRITICALITY` entries for new event types: `trigger.fired` (info), `trigger.suppressed` (warning), `workflow.started` / `workflow.completed` (info), `workflow.failed` (error), `workflow.partial` (warning), `draft.created` / `draft.approved` / `draft.rejected` (info), `draft.expired` (warning), `draft.sent` (info), `voice.profile.refreshed` (info), `voice.profile.derivation.started` (info), `voice.profile.derivation.completed` (info), `voice.profile.derivation.failed` (warning), `delivery_fallback` (warning), `credential.owner_mismatch` (error), `webhook.invalid_signature` (warning), `action.conflict` (warning) | §10.7, §11.4, §24.3, §24.6 |
| `client/src/pages/govern/ConnectionsPage.tsx` | Add `Personal` / `Subaccount` chip on the connection-row component, derived from `owner_user_id IS NOT NULL`. Use the capability-grouping layer for capability display | §16, §17 |
| `client/src/config/sidebar.ts` | Extend `buildNavItems` factory with a new `personal` nav group rendered at the top of the sidebar. Group is data-driven from `useUserOwnedAgents()` and hidden when the hook returns empty | §14 |
| `client/src/config/routes.ts` | Add routes: `/personal/:agentId` (PersonalAssistantPage tabbed shell), `/personal/setup` (first-run wizard before agent row exists — wizard completion creates the agent and redirects), `/personal/:agentId/setup` (edit-setup re-entry once the agent exists) | §14 |
| `client/src/pages/home/HomePage.tsx` | Render `PersonalZoneCard[]` at top, before existing home content. Empty state shows the "Set up my Personal Assistant" card per §13 provisioning | §14, §19 |
| `docs/integration-reference.md` | Add `google_calendar` provider block declaring capability slugs (`calendar_read`, `calendar_event_create`, `calendar_event_update`, `calendar_event_respond`). Add new Slack capability slugs (`channel_messages_read`, `channel_post_message`, `channel_search_messages`, `dm_send`) consumed by `capabilityGroups.ts` | §17 |
| `architecture.md` | Append: external-source trigger primitive; VoiceProfile primitive; home-widget contribution contract; Personal nav group + home Personal zone (data-driven); EA system-agent template; capability-grouping layer. Update "Key files per domain" with new entries | doc-sync (§13 trigger; per CLAUDE.md §11) |
| `KNOWLEDGE.md` | Append patterns observed during build (filled in Phase 3 finalisation; not authored here) | doc-sync |
| `docs/capabilities.md` | Append: Executive Assistant agent; Google Calendar integration; Slack agent actions; VoiceProfile capability; home-widget contract; per editorial rules | doc-sync (must follow vendor-neutral language) |
| `docs/synthetos-governed-agentic-os-brief-v1.2.md` | Strategic parent: mark §16.1 (EA) as Phase 1 shipped after Phase 3 merges | doc-sync (touched in Phase 3, not earlier) |

### 5.3 Out of inventory (intentionally)

- `server/services/securityAuditService.ts` — no new event types from EA V1 itself (predecessor introduces `owner.content_revealed`).
- `server/services/scheduledTaskService.ts` — no schema or signature change; EA V1 creates RRULE rows via existing API for the 07:00 briefing + 07:15 inbox triage workflows.
- `server/services/recurringTasksService.ts` — no schema or signature change; EA V1 seeds a `gmail_inbox_poll` recurring job per connected Gmail account via existing API.
- `server/services/agentExecutionService.ts` — voice-block injection per §12.4 is in §5.2 modified files. EA workflows otherwise run via existing native-controller path unchanged; the `triggerContext.source = 'external'` enum value is an additive JSONB value (no schema change).
- `server/lib/permissions.ts` is in §5.2 modified files (adds the 6 new permission keys per §21.5); existing `ORG_PERMISSIONS` + role checks continue to cover admin redaction.
- `server/db/schema/memoryBlocks.ts` — unchanged (memory remains per-agent per predecessor §3.4).
- `server/db/schema/integrationConnections.ts` — unchanged (Gmail polling state per §10.4 reuses the existing `config_json` JSONB column with a `lastHistoryId` key; no schema migration).
- `server/routes/webhooks/googleWebhook.ts` — NOT shipped in V1. Google Calendar push channels are deferred to V1.5 per §26 (Calendar push does not fire at reminder time, so V1's `calendar_event_imminent` trigger comes from `calendarLookaheadJob.ts` scheduled scan instead). Gmail push via Pub/Sub also deferred per §26.
- `server/db/schema/webhookChannelRegistrations.ts` — NOT created in V1. The `webhook_channel_registrations` table is deferred to V1.5 when Calendar push lands.

If a later section names a file not in §5.1 / §5.2, it is a file-inventory-drift bug and must be either added here or removed from the prose in the same edit.


## 6. Domain model

### 6.1 Entities introduced by this spec

| Entity | Persistence | Owner-scope axis | Subaccount-scope axis | Org-scope axis | Lifecycle |
|---|---|---|---|---|---|
| Executive Assistant agent (template + per-user instance) | `agents` row per instance (predecessor schema; `owner_user_id` set) + system_agents row for the template | yes (each user instance carries `owner_user_id`) | yes (every instance lives in a subaccount) | inherited via subaccount | provision on user opt-in; archive on user offboarding |
| Voice profile | `voice_profiles` row | optional (one of) | optional (one of) | optional (one of); CHECK enforces exactly one | derive on first-run setup; refresh on schedule; opt-out blocks derivation + use |
| EA draft (proposed outbound message awaiting review) | `ea_drafts` row + FK to `actionService.proposeAction` proposal row | yes (`owner_user_id` set, owned by the user whose EA proposed it) | yes | inherited | approval state on the proposal row (`pending → approved | rejected | expired`); send state on `ea_drafts` (`idle → sending → sent | send_failed`); proposal primitive owns approval, `eaDraftService` owns send |
| External-source trigger event (transient, not persisted as a domain row — payload lives in `agent_runs.triggerContext` JSONB only) | none (event-only) | inherits from agent's `owner_user_id` | inherits from agent's `subaccount_id` | inherited | fire once, dedup-key prevents replay |

### 6.2 Ownership-axis semantics

Per the locked predecessor `user-owned-agents`, every entity above carries an explicit ownership axis OR inherits one from its parent agent:
- **User-owned (V1 default for EA).** `owner_user_id` set on the agent row. Credentials resolve against the owner's connections. Runs scope to the owner. Memory rows are private to that agent instance.
- **Subaccount-owned (existing default for Sarah / Johnny / Riley / Helena / Patel / Dana etc.).** `owner_user_id IS NULL`. Existing behaviour, no change.
- **Mixed delegation (not in V1).** Cross-ownership delegation is explicitly out of V1 scope per `user-owned-agents §3.8`. A user-owned EA does NOT delegate into a subaccount-owned agent and vice versa in V1.

### 6.2.1 EA org-wide visibility contract (REQ-EA3 — binding)

The Executive Assistant is **org-wide unique per user**, not subaccount-scoped. Concretely:

- **Uniqueness axis.** Partial unique index on `agents` is `(organisation_id, owner_user_id) WHERE slug = 'executive-assistant'`. A user has exactly ONE EA per organisation, regardless of how many subaccounts they have access to.
- **`agents.subaccount_id` role for the EA.** A "home/default subaccount" pointer captured at provisioning time. Used for default budget rollup attribution and as the provisioning-context record. NOT a uniqueness axis. NOT a visibility filter. Renaming, settings edits, and per-instance memory_blocks remain on the same row regardless of which subaccount the operator enters.
- **Visibility lookups (sidebar, home Personal zone, per-agent detail page).** Query by `(organisation_id, owner_user_id)`. Do NOT add a `subaccount_id` predicate. When Michael enters Subaccount A vs Subaccount B, his EA appears identically in both — there is one EA, not two.
- **Run creation `agent_runs.subaccount_id`.** Set to the **active session subaccount** at run creation, supplied by the caller (trigger dispatcher, scheduler, or UI handler) — NOT copied from `agents.subaccount_id`. Run cost rolls up to the active subaccount's budget. The EA's home subaccount on the agent row is irrelevant to runtime billing.
- **Credential resolution.** Personal `integration_connections` rows still carry `(organisation_id, subaccount_id, owner_user_id, provider)` per the predecessor's unique index. The broker resolves against the **active session subaccount** at credential-injection time (passed by the action handler), not against `agents.subaccount_id`. If a Personal connection exists only in the user's home subaccount but the user is currently in a different subaccount, the broker returns `CONNECTION_NOT_FOUND` for that subaccount — V1 does not auto-cross-subaccount Personal credentials. (V1 dogfood is single-subaccount per §6.3, so this manifests only when the user expands to a second subaccount later.)
- **Concurrency under the contract.** §13.4's advisory lock on `('ea_provision', organisation_id::bigint, owner_user_id::bigint)` is keyed on `(organisation_id, owner_user_id)` — NOT on `(subaccount_id, owner_user_id)` — to match the partial unique index. Two simultaneous wizard submissions from the same user, even from two different subaccount contexts, arbitrate against the same lock.

This contract is binding on §13.4 / §14.1 / §15.1 / §19.2 / §22.1 lookups. A subaccount predicate added to any of those queries is a contract violation.

### 6.3 Agent role and execution model

- **`agentRole: 'Specialist'`** per existing `SystemAgentEntry` taxonomy (matches Sarah / Helena / Patel — workers with a defined skill bundle, not orchestrators).
- **`executionScope: 'subaccount'`.** V1 dogfood is single-subaccount. The EA is provisioned per user inside the subaccount; the subaccount-execution scope determines where its runs are billed + budgeted.
- **`controllerStyle: 'native'`** locked for V1. Each EA run is short, deterministic, and executes inside the Native Controller against the API + Tool Environment. No Browser, no Sandbox, no Operator Controller. V2 adds `'operator'` as a second allowed style on the same agent.
- **Risk-tier ceiling: 6.** Per brief §4 q3 (corrected — the ceiling is 6 so the EA can perform Tier 6 sends under `review_required` gating; without raising the ceiling, the default skill allowlist's `send_email`, `slack.post_message`, `slack.post_dm` would be blocked at policy enforcement).
- **Default approval policy.** Tier 0–3 auto; Tier 4–5 review; Tier 6 review-required (no auto path). Action-level `defaultGate: review` in `actionRegistry.ts` overrides the tier default for specific actions — `respond_to_invite` is Tier 3 but ships with `defaultGate: review` (per §8.2 table) because responding alters organiser-visible state, and the policy engine respects the action-level override per existing precedent.

### 6.4 Trigger taxonomy

Three trigger types fire EA runs:
- **Type A — Scheduled (RRULE / cron).** Existing `scheduledTaskService`. Triggers daily briefing (07:00) and inbox triage (07:15). Each run row carries `triggerContext: { source: 'schedule', scheduledTaskId, occurrenceAt }`.
- **Type B — External-source (NEW primitive).** Three new event types in the enum, two of which fire in V1: `gmail_message_received` (from `gmailInboxPollJob.ts` polling) and `calendar_event_imminent` (from `calendarLookaheadJob.ts` scheduled scan). The third, `slack_mention`, is forward-compat scaffolding for V1.5 Workflow #4 — V1 ships the enum value, the Zod variant, the dedup-key shape, and the (dormant) `agent_triggers` subscription row, but **no V1 code path fires `slack_mention`**; the `slackWebhook.ts` extension is limited to URL verification (see §10.2 / Goal 4). Each fired run row carries `triggerContext: { source: 'external', provider, externalEventId, eventData, triggerId }`. The label "webhook" was previously used for the Slack subtype but is misleading in V1 — Gmail + Calendar are job-driven, and Slack does not fire a V1 trigger from a webhook either.
- **Type C — Internal event-driven (existing).** No change. `task_created` / `task_moved` / `agent_completed`. EA may subscribe in future but V1 ships no subscriptions of this type.

Trigger uniformity contract (binding on §24): every triggered run writes the same `agent_runs.triggerContext` shape and emits a `trigger.fired` Run Trace event at run start. Failure to fire (rate-cap, missing agent, auth-expired credential) writes a `trigger.suppressed` event with reason.

### 6.5 Memory model (no scope abstraction)

Per predecessor §3.4. `memory_blocks` is unchanged. Each user-owned EA agent has its own memory rows by virtue of being a separate agent row. No `scope_type` / `scope_id` column added. First-run setup writes ~5–10 structured memory blocks keyed by the user's EA `agent_id` (e.g. `key = 'ea.working_hours'`, `key = 'ea.timezone'`, etc.). Editable via existing per-agent memory pattern.

Trade-off: memory does not auto-share between Michael's EA and (future) Michael's Dev Agent. Accepted; documented as the deliberate simplification vs the rejected `principal-scoped-agents` Option C.


## 7. Contracts

Every data shape that crosses a service boundary or is consumed by a parser is pinned here. Each contract names producer + consumer + nullability + a worked example.

### 7.1 `externalSourceTriggerEvent` (discriminated union)

Producers in V1: `gmailInboxPollJob.ts` (fires `gmail_message_received`) + `calendarLookaheadJob.ts` (fires `calendar_event_imminent`). The `slackWebhook.ts` extension is a future producer for `slack_mention` — V1 ships only its URL-verification handshake; the `event_callback`/`app_mention` dispatch lands in V1.5 (see §10.2 + Goal 4). The Zod variant for `slack_mention` ships V1 for forward compatibility and is enforced by the discriminated-union schema. Consumer: `externalSourceTriggers.ts` → `triggerService.fireTriggers`.

Lives in `shared/types/externalSourceTrigger.ts`. **REQ-C1 amendment (2026-05-13): the as-built shape is a flat discriminated union — no outer envelope.** Each variant carries its identifying fields directly on the event object rather than nesting under `messageMetadata` / `eventMetadata` / `mentionMetadata`. The pre-amendment shape (nested metadata blocks) is rejected for V1; if a future spec needs the envelope back, it adds it explicitly.

Discriminated on `eventType`:

- `gmail_message_received` — fields: `eventType`, `ownerUserId`, `messageId` (Gmail message id), `threadId`, `fromAddress`, `receivedAt`, and the canonical `dedupKey: string` (set to `messageId`). Body content is live-fetched at run time by the agent's `read_inbox` action; not embedded in the event.
- `calendar_event_imminent` — fields: `eventType`, `ownerUserId`, `calendarEventId`, `startAt`, `minutesUntilStart`, and `dedupKey: string` (set to `'{calendarEventId}@{startAt}@{minutesUntilStart}'`). Attendee detail is live-fetched.
- `slack_mention` — fields: `eventType`, `ownerUserId`, `slackUserId`, `channelId`, `messageTs`, `text`, and `dedupKey: string` (set to `'{channelId}@{messageTs}'`).

Tenant context (`organisationId`, `subaccountId`) is supplied to `dispatch()` by the caller in the `ctx` parameter, not as fields on the event — keeps the event payload provider-shaped and the tenant binding caller-shaped.

Example instance (`calendar_event_imminent`, post-amendment flat shape):

```json
{
  "eventType": "calendar_event_imminent",
  "ownerUserId": "u-michael-uuid",
  "calendarEventId": "abc123def456",
  "startAt": "2026-05-13T14:00:00Z",
  "minutesUntilStart": 15,
  "dedupKey": "abc123def456@2026-05-13T14:00:00Z@15"
}
```

**Dedup key (REQ-T8 amendment 2026-05-13).** Per-event-type shape, all canonicalised by `externalSourceTriggersPure.deriveDedupKey` into the single `dedup_key text` column on `external_trigger_dedup`:

- `gmail_message_received` → `dedup_key = messageId` (Gmail message ids are immutable + globally unique per Gmail account).
- `calendar_event_imminent` → `dedup_key = '{calendarEventId}@{startAt}@{minutesUntilStart}'`. Covers (a) recurring-event occurrences (each occurrence has the same `calendarEventId` but distinct `startAt` once `singleEvents=true`), (b) rescheduled occurrences (same `calendarEventId`, different `startAt` → fires again), (c) multi-horizon support if added later (different `minutesUntilStart` → fires separately). Spec did not previously include the multi-calendar `calendarId` prefix; the as-built two-axis composite is sufficient for V1 (single primary calendar per owner).
- `slack_mention` → `dedup_key = '{channelId}@{messageTs}'`. Slack guarantees `messageTs` uniqueness per channel, so the composite is per-occurrence unique without needing the Events-API envelope `event_id`.

Source-of-truth: new `external_trigger_dedup` table with `UNIQUE(provider, dedup_key, owner_user_id)` constraint + insert-with-conflict semantics. Schema: `(provider text NOT NULL, dedup_key text NOT NULL, owner_user_id uuid NOT NULL, organisation_id uuid NOT NULL, subaccount_id uuid NOT NULL, fired_at timestamptz NOT NULL DEFAULT now(), trigger_id uuid, run_id uuid, PRIMARY KEY(provider, dedup_key, owner_user_id))`. Rationale: explicit dedicated table is clearer than a JSONB partial index on `agent_runs.triggerContext`, avoids JSONB-index quirks, and decouples dedup from run-row lifecycle. See §24.1 for the contract.

### 7.2 Calendar action input / output (Zod schemas, all in `shared/types/calendarAction.ts`)

Producer: agent execution path → calendar action handler. Consumer: Google Calendar API + Run Trace event emitter.

- `list_events.input`: `{ calendarId: string = 'primary', timeMin: ISO8601, timeMax: ISO8601, maxResults: number = 50, query?: string }`. Output: `Array<{ eventId, summary, startAt, endAt, attendees: Array<{ email, responseStatus }>, organizerEmail }>`.
- `get_event.input`: `{ calendarId: string, eventId: string }`. Output: same shape as a single `list_events` row plus optional `description` (sanitised).
- `find_free_slot.input`: `{ calendarId: string = 'primary', timeMin: ISO8601, timeMax: ISO8601, durationMinutes: number, requiredAttendees?: string[] }`. Output: `Array<{ startAt, endAt }>` ranked earliest-first.
- `create_event.input`: `{ eaDraftId: uuid (REQUIRED V1; see §8.4), calendarId: string = 'primary', summary: string, startAt: ISO8601, endAt: ISO8601, attendees?: Array<{ email, optional?: boolean }>, description?: string, location?: string, conferenceData?: 'google_meet' | null }`. Output: `{ eventId, htmlLink }`.
- `update_event.input`: `{ eaDraftId: uuid (REQUIRED V1; see §8.4), calendarId: string, eventId: string, patch: Partial<CreateEventInput>, ifMatchETag?: string }`. Output: `{ eventId, htmlLink, updatedAt }`.
- `respond_to_invite.input`: `{ eaDraftId: uuid (REQUIRED V1; see §8.4), calendarId: string, eventId: string, response: 'accepted' | 'declined' | 'tentative', comment?: string }`. Output: `{ eventId, response }`.

Idempotency keys (corrected — Google Calendar's `events.insert` does NOT honour a `requestId` parameter; the prior draft was wrong about that API surface):

- **`create_event` (draft-mediated path — the V1 invocation path).** Every V1 `create_event` invocation is review-gated and proxied through an `ea_drafts` row (Tier 4 in the action registry but Tier 6-equivalent for V1 because EA writes always go through review per §13.1 default approval policy). The draft row IS the idempotency record: `ea_drafts.externalResultId` is set once on first successful send to Google's `events.insert`; subsequent retries against the same draft return the stored `externalResultId` without re-calling Google. Concurrency on the draft row uses the optimistic `UPDATE ... WHERE state = 'approved' AND externalResultId IS NULL` predicate; the losing caller reads the winning row's `externalResultId`.
- **`update_event`.** Optimistic `If-Match` on the event ETag (Google honours this). `update_event` invocations are also draft-mediated for V1 (Tier 4 review-gated); on retry, the draft row's stored target eventId + ETag drive the second attempt.
- **`respond_to_invite`.** Naturally idempotent (last write wins, no DB-level dedup needed).
- **Non-draft-mediated direct invocations** are out of V1 scope — all V1 EA Calendar writes go through the review/draft path. If a future caller bypasses the draft path (e.g. a different agent template authored later), the architect adds a dedicated idempotency record at that time; V1 does not pre-build one.

§24 pins the unique-constraint-to-HTTP mapping.

### 7.3 Slack action input / output (Zod schemas, all in `shared/types/slackAction.ts`)

Producer: agent execution path → slack action handler. Consumer: Slack Web API + Run Trace.

- `list_channels.input`: `{ types?: Array<'public_channel' | 'private_channel' | 'mpim' | 'im'> = ['public_channel'], excludeArchived: boolean = true }`. Output: `Array<{ channelId, name, isMember, memberCount, topic }>`.
- `read_channel.input`: `{ channelId: string, oldestTs?: string, latestTs?: string, limit: number = 50 }`. Output: `Array<{ messageTs, threadTs, userId, text, attachments }>`. Requires `channels:history` scope (NEW — see §9).
- `search_messages.input`: `{ query: string, count: number = 20 }`. Output: `Array<{ channelId, messageTs, userId, text, permalink }>`. Requires `search:read` scope (PAID-tier only — flagged §9).
- `summarise_thread.input`: `{ channelId: string, threadTs: string, summaryLength: 'short' | 'long' = 'short' }`. Output: `{ summary: string, sourceMessageCount: number }`. Calls existing `llmRouter`.
- `post_message.input`: `{ channelId: string, text: string, blocks?: Array<unknown>, threadTs?: string }`. Output: `{ messageTs, channelId, permalink }`. Idempotency-key strategy per §24.2.
- `post_dm.input`: `{ userId: string, text: string, blocks?: Array<unknown> }`. Output: `{ messageTs, channelId (the DM channel), permalink }`. Requires `im:write` scope (NEW — see §9).

### 7.4 `VoiceProfile` (row Zod schema in `shared/types/voiceProfile.ts`)

Producer: `voiceProfileService.ts` (and its samplers). Consumer: prompt-assembly in `agentExecutionService` (read-only at run time) + Settings page (read + refresh + opt-out).

Row fields (column-level). **REQ-C4 amendment (2026-05-13): as-built schema simplifies the row — no separate `name` column (callers display by owner / scope), `sources` is an array column rather than a single-source enum, and the discriminated-on-source `sourceConfig` collapses into a single `source_config` jsonb that callers shape per-row.**

- `id: uuid`
- `organisationId: uuid` (not null)
- **Exactly one of** `ownerUserId: uuid | null`, `subaccountId: uuid | null`, `orgScope: boolean = false`. CHECK constraint: `(ownerUserId IS NOT NULL)::int + (subaccountId IS NOT NULL)::int + orgScope::int = 1`.
- `sources: text[]` — V1 element enum `'gmail_sent_sampler' | 'drive_doc_sampler'` (the `'manual'` element is deferred to V1.5 per §26). Multi-source rows are supported: a profile may be derived from both Gmail and Drive simultaneously. At derivation time the service merges samples across all listed sources.
- `sourceConfig: jsonb` — caller-shaped per-row. Examples for a Gmail-only row: `{ gmail_sent_sampler: { lastN: 50, sinceDays: 90 } }`. The previous single-source discriminated-union shape is dropped.
- `profileJson: jsonb` — distilled feature set. NEVER raw content. Example: `{ greeting: { primary: 'Hi {name},', secondary: 'Hey {name},' }, signoff: { primary: 'Best,\nMichael', secondary: 'Cheers,\nMichael' }, sentenceLengthMean: 14, sentenceLengthP90: 28, formalityScore: 0.42, emDashUsage: 'avoid', commonPhrases: ['quick note', 'happy to chat'], signatureLine: 'Michael, Breakout Solutions' }`. Schema versioned via `profileJson.schemaVersion: 1`.
- `sampleSize: int`
- `lastDerivedAt: timestamptz`
- `refreshPolicy: 'manual' | 'periodic' | 'on_send_count'` — V1 ONLY accepts writes with values `'manual'` or `'periodic'`. The `'on_send_count'` enum value is schema-reserved for future use; the write API + Zod schema reject it until a future spec adds the `sent_count_since_derive` counter. Existing rows with `refreshPolicy = 'on_send_count'` (if any) never auto-refresh under V1 (§12.5).
- `refreshConfig: jsonb` — caller-shaped per-row. V1 examples: `{ days: 30 }` for `'periodic'`; `{}` for `'manual'`. (Reserved future shape: `{ everyN: 50 }` for `'on_send_count'` — not V1.)
- `state: 'pending' | 'deriving' | 'ready' | 'failed'` — derivation lifecycle. Default `'pending'` on row creation; transitions to `'deriving'` when `voiceProfileService.deriveProfile` starts; transitions to `'ready'` on success or `'failed'` on error. Reads by prompt-assembly check `state = 'ready' AND optOutAt IS NULL` before consuming `profileJson` (state ≠ ready → assemble without voice block).
- `optOutAt: timestamptz | null` — opt-out marker. When non-null, the profile is NOT used in prompt assembly; the derive/refresh paths skip this row.
- `createdAt: timestamptz`
- `updatedAt: timestamptz`

Worked example: see brief §3.11. Source-of-truth precedence: `optOutAt` wins over every other column — opted-out profile is treated as if absent at prompt-assembly time.

### 7.5 `EADraft` (row Zod schema in `shared/types/eaDraft.ts`)

**Approval-primitive composition (LOCKED V1).** `ea_drafts` does NOT own approval state. Approval state, approval audit, expiry, and reviewer decision are owned by the existing `actionService.proposeAction` primitive. `ea_drafts` carries EA-specific draft payload (rendered preview, proposed body, target metadata) and a FK to the proposal row. Approved proposals invoke the underlying action handler once; the result is recorded on the `ea_drafts` row's `externalResultId` for UI convenience, but the proposal row remains the approval source of truth. This is a hard composition contract — the builder MUST NOT introduce a parallel approval state machine on `ea_drafts`. Phase 2 architect verifies `actionService.proposeAction`'s contract supports a per-domain payload reference (FK or JSONB `proposal_payload_ref` column) at plan-authoring time. If the architect discovers the existing primitive cannot accept the FK shape, the architect escalates back to the spec for revision — implementation does NOT proceed with a parallel state machine.

Producer: workflow skill execution path (`ea-inbox-triage`) writes both the proposal row (via `actionService.proposeAction`) AND the `ea_drafts` row (via `eaDraftService.createDraft`). Consumer: `eaDraftService` + Drafts UI on Workspace tab + approval flow (driven by the proposal primitive) + the action handler that finally sends (invoked by the proposal primitive's commit hook).

Row fields:
- `id: uuid`
- `organisationId: uuid` (not null)
- `subaccountId: uuid` (not null)
- `ownerUserId: uuid` (not null)
- `agentId: uuid` (the EA agent that proposed the draft)
- `runId: uuid` (the agent run that proposed it)
- `proposalId: uuid` (not null) — FK to the `actionService.proposeAction` proposal row. THIS is the approval-state source of truth. State queries (`is the draft awaiting approval?`, `expired?`, `rejected?`) read from the proposal row, not from `ea_drafts`. Phase 2 architect names the exact target column (existing primitive's row id).
- `kind: 'gmail_reply' | 'gmail_new' | 'slack_post' | 'slack_dm' | 'calendar_create' | 'calendar_update' | 'calendar_respond'`
- `targetRef: jsonb` — kind-specific shape (e.g. `{ kind: 'gmail_reply', threadId, inReplyToMessageId, recipientEmail }`)
- `body: jsonb` — proposed action payload (e.g. for `gmail_reply`: `{ subject, body, cc?, bcc? }`)
- `sendState: 'idle' | 'sending' | 'sent' | 'send_failed'` — POST-approval send-attempt state (NOT the approval state — that lives on the proposal row). Default `'idle'` until the proposal is approved + the action handler is invoked. `'sending'` is the transitional state during the action's optimistic-predicate / unknown-success-recovery path per §24.2. `'sent'` when `externalResultId` is set. `'send_failed'` if all retries exhaust without producing an external object.
- `externalResultId: text | null` — populated when the draft's underlying action completes; the action's external result id, kind-specific (Gmail messageId for `gmail_reply` / `gmail_new`; Slack messageTs for `slack_post` / `slack_dm`; Calendar eventId for `calendar_create` / `calendar_update`; Calendar eventId of the responded-to event for `calendar_respond`). Set once; immutable thereafter. Used by Run Trace + operator UI to deep-link to the resulting external object.
- `createdAt`, `updatedAt`

Send-state machine (closed set; §24 names valid transitions). NOT the approval state machine — approval lives on the proposal row:
```
idle ─proposal-approved+send-claimed→ sending ─complete-send→ sent (with externalResultId set)
sending ─unknown-outcome-recovery→ sending (idempotent retry pickup)
       ─complete-send→ sent (with externalResultId set)
       ─exhaust-retries→ send_failed
sending ─stall→ idle (recovery handler resets after timeout; ready for a new claim)
send_failed ─manual-retry→ sending (operator clicks retry; new claim cycle)
```
Approval / rejection / expiry are recorded on the proposal row, NOT on `ea_drafts`. Once `sendState = 'sent' AND externalResultId IS NOT NULL`, no further transition is permitted (the row is the audit trail). The `'sending'` transitional state surfaces as `'sent (sending)'` in the operator UI for visibility; recovery is automatic.

### 7.6 `HomeWidgetDeclaration` (on system_agent template)

Producer: system_agent seed migration + `c.ts` template definition. Consumer: `homeWidgetService.ts` + `client/src/components/personal/PersonalZoneCard.tsx`.

Lives as a new `home_widget jsonb` column on the `system_agents` row, added in `NNNN_executive_assistant_seed.sql` (architect's `NNNN_executive_assistant_seed.sql` migration both creates the column and inserts the EA seed row populating it). Rationale: the existing JSONB columns on `system_agents` (`default_system_skill_slugs`, `default_org_skill_slugs`, etc.) carry typed arrays — overloading one with a discriminated-union object would invite type drift. A dedicated nullable column is clearer; null means the template does not surface to the home zone. Shape:

```
homeWidget: {
  type: 'summary_card' | 'queue_card' | 'metric_card',
  titleTemplate: string,
  bodyProviderSkill: string,  // skill slug
  refreshPolicy: 'on_login' | 'every_5m' | 'on_demand',
} | null  // null = template does not surface to home
```

EA's declaration:
```
{
  type: 'summary_card',
  titleTemplate: '${agent.displayName}',
  bodyProviderSkill: 'ea.home_widget.summary',
  refreshPolicy: 'on_login'
}
```

### 7.7 `WidgetData` (per-type union in `shared/types/homeWidget.ts`)

Producer: skill execution returning the widget body. Consumer: `PersonalZoneCard.tsx`.

Discriminated union on `type`:
- `summary_card` — `{ type: 'summary_card', primaryLine: string, secondaryLines: string[], badgeCount?: number, openLink: string }`. EA returns: `primaryLine = "{briefing one-liner}"`, `secondaryLines = ["{draftCount} drafts awaiting review", "Next: {nextMeetingPrep}"]`, `badgeCount = draftCount`, `openLink = '/personal/{agentId}'`.
- `queue_card` — `{ type: 'queue_card', items: Array<{ label, secondary, link }>, headerText: string }`. Reserved for future user-owned agents (Dev Agent: review queue; research agent: open threads).
- `metric_card` — `{ type: 'metric_card', metric: string, value: string | number, trend?: 'up' | 'down' | 'flat', subtext?: string }`. Reserved for future use.

Frame component renders each type into a consistent visual shell (the locked mockup `02-my-ea-home.html`). Agents return data only; no markup.

### 7.8 `webhook_channel_registrations` — DEFERRED to V1.5

The Calendar push channel design (table + renewal job + webhook ingestion handler) is deferred to V1.5 per §26. V1's `calendar_event_imminent` trigger comes from `calendarLookaheadJob.ts` (scheduled scan per §10.5), not from push channels. Push doesn't fire at reminder time; even with push, V1 has no local Calendar mirror to update (per §18 live-fetch). The combination of "no mirror" + "no reminder-time push" means push provides no V1 value.

When V1.5 adds either Gmail push (Pub/Sub) or a push-based Calendar mirror, that spec authors `webhook_channel_registrations` at that time.

### 7.9 `agent_runs.triggerContext` extension

Producer: trigger dispatch path. Consumer: Run Trace view.

Existing JSONB column. V1 adds a new discriminator value `'external'`:

```
triggerContext: {
  source: 'schedule' | 'trigger' | 'manual' | 'external',  // 'external' is NEW
  // when source === 'external':
  provider: 'gmail' | 'google_calendar' | 'slack',
  externalEventId: string,
  eventData: ExternalSourceTriggerEvent,
  triggerId: uuid
}
```

The existing `'trigger'` source value is preserved for internal-event triggers (Type C in §6.4). The new `'external'` value is exclusive to webhook-sourced triggers.

### 7.10 Source-of-truth precedence (cross-cutting)

When the same fact is represented in multiple stores, the precedence rule:

| Fact | Stores | Precedence (highest wins) |
|---|---|---|
| Voice profile content | `voice_profiles.profileJson` | only one store; opt-out wins over content |
| Voice profile opt-out | `voice_profiles.optOutAt` + UI toggle | DB column is canonical; UI reads from DB |
| EA draft approval state | proposal primitive's row (linked via `ea_drafts.proposalId`) | proposal primitive's row is canonical; `ea_drafts` never holds approval state |
| EA draft send state | `ea_drafts.sendState` | DB column is canonical (the row IS the post-approval send audit) |
| User's EA settings (display name, briefing time, delivery target, auto-send scope) | `agents.name` (display name) + memory_blocks (other settings) | DB rows canonical; cached `useAgent()` hook invalidates on change |
| External-event dedup | `external_trigger_dedup` row | `external_trigger_dedup` UNIQUE row is canonical (LOCKED per §7.1, §24.1) |
| Run cost rollup | `cost_aggregates` + per-call `llm_requests_all` | existing precedence (no change from EA V1) |
| Connection ownership (Personal vs Subaccount) | `integration_connections.owner_user_id` | DB column is canonical; UI chip derives |


## 8. Google Calendar OAuth + actions

### 8.1 OAuth provider entry

New entry in `server/config/oauthProviders.ts` keyed `google_calendar`. Shape mirrors `gmail` + `google_drive`. Required scopes:

- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/calendar.events.readonly`
- `https://www.googleapis.com/auth/calendar.events`

The third scope is REQUIRED in V1 because `create_event` / `update_event` / `respond_to_invite` ship. `calendar.events.readonly` covers read paths; `calendar.events` is the minimum write scope. The full-read `calendar` scope is NOT requested (broader than needed; would also cover ACLs which we do not use).

`extra: { access_type: 'offline', prompt: 'consent' }` for refresh-token issuance (matches Gmail / Drive pattern).

Env-var convention: `OAUTH_GOOGLE_CALENDAR_CLIENT_ID`, `OAUTH_GOOGLE_CALENDAR_CLIENT_SECRET`. Existing `getProviderClientId` switch-cases pick them up; no new infra.

Slug registered in `REQUIRED_INTEGRATION_SLUGS` and the `RequiredIntegrationSlug` type union in `server/config/actionRegistry.ts`.

OAuth callback handler reuses `server/routes/oauthIntegrations.ts` — no new route.

Connection row on `ConnectionsPage.tsx` follows the existing pattern. Personal chip (§16) derives from `owner_user_id IS NOT NULL` on the resulting `integration_connections` row.

### 8.2 Action registry rows

Six actions added to `server/config/actionRegistry.ts`:

| Action | Read/Write | Risk tier | Default gate | Verify shape | Idempotency | retryPolicy | createsBoardTask | isExternal |
|---|---|---|---|---|---|---|---|---|
| `list_events` | read | 2 | auto | `api_status_2xx` | safe | safe-default | false | true |
| `get_event` | read | 2 | auto | `row_exists` | safe | safe-default | false | true |
| `find_free_slot` | read (compute over read) | 2 | auto | `api_status_2xx` | safe | safe-default | false | true |
| `create_event` | write | 4 | **review** | `row_exists` | state-based via originating `ea_drafts.externalResultId` (V1 invocation path is draft-mediated; handler REJECTS calls without `eaDraftId` per §8.4 + §7.2 + §24.2) | guarded | false | true |
| `update_event` | write | 4 | **review** | `row_exists` | state-based via originating `ea_drafts.externalResultId` + `If-Match` ETag (handler REJECTS calls without `eaDraftId` per §8.4) | guarded | false | true |
| `respond_to_invite` | write | 3 | **review** | `api_status_2xx` | state-based (last-write-wins) | guarded | false | true |

Risk-tier justifications per Phase 1 foundation §4.2.3:
- Tier 2 — external API reads (no customer-visible side effect).
- Tier 3 — `respond_to_invite` is a self-action (replying to an invite addressed to the owner). The action does NOT message a third party in a content sense; it updates calendar state visible to the organiser only.
- Tier 4 — `create_event` / `update_event` create / mutate records visible to attendees. Internal-record write, third-party visibility limited to invited attendees (not a customer-broadcast). Tier 4, not Tier 6, because the user is the calendar owner and the third-party visibility is consent-based (attendees opted in by accepting the invite).

`createsBoardTask: false`. `isExternal: true`. `topics: ['calendar']` (NEW topic registered in `server/config/topicRegistry.ts`).

`requiredIntegration: 'google_calendar'` for all six. Existing `capabilityMapService` picks up the new actions automatically per its existing skill-allowlist crossing logic.

### 8.3 Workspace adapter alignment

The existing `WorkspaceAdapter` (`shared/types/workspaceAdapterContract.ts`) exposes `createEvent` + `respondToEvent` for subaccount-owned agents with workspace identities. For EA V1 user-owned agents, the Calendar action handlers in `server/services/calendar/calendarActionService.ts` bypass the adapter and call Google directly via the owner-scoped credential resolved by the broker. Rationale: the adapter abstracts "which calendar backend" (synthetos_native vs google_workspace); for user-owned EA, the backend is always Google and the identity is user-scoped, not workspace-scoped. Future user-owned agents acting on Outlook can introduce an `outlook_user_identity` adapter backend if a use case emerges.

This is the **alignment correction** noted in brief §0.5.4 + §3.2: V1 ships write actions for user-owned agents that are functionally equivalent to what subaccount-owned agents already do via the adapter. The risk control is review-gating, not capability removal.

### 8.4 Handler responsibilities

`server/services/calendar/calendarActionService.ts` action handler responsibilities (per action):

1. Resolve owner-scoped Google Calendar credential via `credentialBrokerService.injectIntoEnvironment({ subaccountId, provider: 'google_calendar', ownerUserId: agent.ownerUserId })`. If `agent.ownerUserId IS NULL`, the broker call is subaccount-scoped (existing path); for V1 this never happens for the EA but the handler is generic.
2. Validate input against the action's Zod schema. **For write actions (`create_event`, `update_event`, `respond_to_invite`):** the input MUST include `eaDraftId: uuid` referencing an `ea_drafts` row owned by the caller's `ownerUserId` whose linked proposal is in state `approved`. **REQ-CAL3-naming amendment (2026-05-13): the handler emits per-state-machine error codes** rather than the umbrella `missing_draft_context`:
   - missing row → `DRAFT_NOT_FOUND` (404)
   - `ea_drafts.ownerUserId !== ctx.ownerUserId` → `DRAFT_OWNER_MISMATCH` (403)
   - proposal not approved → `DRAFT_NOT_APPROVED` (422)
   - send already in flight → `DRAFT_SEND_IN_FLIGHT` (409)

   Generic, non-draft-mediated Calendar event creation is deferred to V1.5 per §26 (the V1.5 spec adds either a generic `external_action_idempotency` table OR a direct-call idempotency record on a per-action basis; V1 does not pre-build either).
3. For write actions: idempotency per §7.2 + §24.2 — the originating `ea_drafts` row's `externalResultId` is the idempotency record for `create_event` (set once on first send); `update_event` uses Google's `If-Match` ETag header; `respond_to_invite` is naturally idempotent. Do not pass a `requestId` parameter — Google Calendar `events.insert` does not honour it.
4. Call Google Calendar API with `withBackoff` wrapping.
5. Map errors:
   - 401 / 403 → typed `CREDENTIAL_REVOKED` or `INSUFFICIENT_SCOPE`; broker marks the connection `expired`; trigger emits `trigger.suppressed`.
   - 409 (conflict) → 422 to caller with `code: 'conflict'`; Run Trace event `action.conflict`.
   - 412 (precondition failed on `If-Match`) → 409 to caller with `code: 'stale_etag'`.
   - 429 (rate-limited) → backoff per existing primitive; if budget exceeded, return `partial` outcome.
   - 5xx → retry per `retryPolicy: 'guarded'`; if exhausted, propagate.
6. Emit `action.completed` Run Trace event with `result` + redaction-safe metadata.
7. On `create_event` / `update_event` / `respond_to_invite` success, write the external event id back to the originating `ea_drafts` row's `externalResultId` if one exists (§7.5 lifecycle).

### 8.5 Pure helpers (`calendarActionServicePure.ts`)

Pure functions per `docs/spec-context.md` runtime_tests posture:

- `validateCreateEventInput(input)` → branded `ValidatedCreateEventInput` or typed Zod error.
- `validateUpdateEventInput(input)` → branded type.
- `validateRespondToInviteInput(input)` → branded type.
- `deriveIdempotencyKey({ kind, ownerUserId, payload })` → 128-bit hex key. Used only for internal draft/action correlation (e.g. detecting "the same propose-action payload was generated twice within a workflow run"). NOT passed to Google Calendar; per §24.2, Google `events.insert` does not honour a `requestId` parameter, and `create_event` idempotency goes through the `ea_drafts.externalResultId` state-based path + `extendedProperties.private.ea_draft_id` recovery tag.
- `normaliseAttendees(attendees)` → deduped, lower-cased, optional-flag preserved.
- `computeFreeSlots({ events, timeMin, timeMax, durationMinutes, workingHours })` → ranked `Array<{ startAt, endAt }>`. Working-hours window read from the EA agent's `memory_blocks` (`key = 'ea.working_hours'`).

Each pure helper has Vitest unit coverage per §25.

### 8.6 Default skill bundle wiring

The EA's default skill allowlist includes all six Calendar actions (see §13). Existing skill markdown convention: one file per skill in `server/skills/` with YAML frontmatter naming the action slug, risk tier, default gate. Architect in Phase 2 produces the six skill markdown files per §5.1.


## 9. Slack agent actions

### 9.1 Action registry rows

Six actions added to `server/config/actionRegistry.ts`. Slack OAuth is already wired (existing bot scopes: `chat:write`, `channels:read`, `users:read`, `files:write`, `chat:write.public`). V1 adds new scopes per §9.2.

| Action | Read/Write | Risk tier | Default gate | Verify shape | Idempotency | retryPolicy | requiredIntegration |
|---|---|---|---|---|---|---|---|
| `slack.list_channels` | read | 2 | auto | `api_status_2xx` | safe | safe-default | `slack` |
| `slack.read_channel` | read | 2 | auto | `api_status_2xx` | safe | safe-default | `slack` |
| `slack.search_messages` | read | 2 | auto | `api_status_2xx` | safe | safe-default | `slack` |
| `slack.summarise_thread` | read + LLM | 2 | auto | `api_status_2xx` | safe | safe-default | `slack` |
| `slack.post_message` | write (channel) | 6 | review (fixed V1; see §9.3) | `row_exists` | key-based via `client_msg_id` | guarded | `slack` |
| `slack.post_dm` | write (user DM) | 6 | dynamic: auto when target = owner; review otherwise (fixed V1; see §9.3) | `row_exists` | key-based via `client_msg_id` | guarded | `slack` |

There is no configurable per-instance auto-send dropdown in V1. The Settings mockup `03-ea-settings.html` renders the locked policy as static explanatory text. Activating the dropdown is deferred per §26.

`topics: ['slack']` (NEW topic registered alongside `'calendar'`).

`createsBoardTask: false`. `isExternal: true`.

Risk-tier rationale per Phase 1 foundation §4.2.3:
- Tier 2 — Slack reads + LLM-over-Slack-content; no customer-visible side effect.
- Tier 6 — Slack writes are client/colleague-visible external messages, by definition. Tier 6 is the max-tier classification for "messaging actions that land in another human's feed."

### 9.2 New Slack scopes required

`server/config/oauthProviders.ts` `slack` entry — V1 spec adds:

- `channels:history` — required by `slack.read_channel`. Existing `channels:read` only lists channels.
- `groups:history` — same, for private channels the user is a member of. Spec confirms whether V1 ships private-channel read or only public. Default recommendation: ship `groups:history` too; the EA reads private channels the user is in (workplace expectations).
- `im:history` + `mpim:history` — same, for DMs and multi-person DMs.
- `im:write` — required by `slack.post_dm`.
- `search:read` — required by `slack.search_messages`. **Plan-tier caveat**: Slack's `search.messages` Web API method requires a paid Slack workspace plan (Pro / Business+ / Enterprise). V1 ships the action; on free plans, the action returns a typed `PLAN_NOT_SUPPORTED` error. Spec flags this for the first-run-setup UX to surface gracefully (a warning chip on the action if the workspace plan does not support it — Phase 2 plan decides the warning surface).
- `app_mentions:read` — **forward-compat scope** for the configured-but-dormant Events-API subscription. V1 uses this scope only to allow the Slack-app subscription to be registered and to satisfy URL verification (§10.2 / §10.6). V1 does NOT consume `app_mention` `event_callback` payloads; event consumption lands in V1.5 alongside `ea.slack_thread_summary`. `chat:write` already exists on the Slack provider entry for outbound Slack posts (§9.1) — V1 does not add it; it is named here only to record that the V1.5 Workflow #4 dispatch path will reuse it without further scope changes.

Scope upgrade on existing connected Slack workspaces: existing connections will lack the new scopes. The Connections page UI surfaces a "Re-authorise" action when an action requires a scope the connection lacks (architect picks the exact UI shape in Phase 2; spec mandates the affordance exists).

### 9.3 Slack auto-send policy

Per brief §4 q2 (LOCKED). The EA's V1 auto-send behaviour is fixed by the §1 framing assumption: "Every Tier 4+ write to a third-party system is review-gated. Auto-send only to the operator's own surfaces (own Slack DMs, own Gmail Drafts)." Concretely:

- `slack.post_message` (any channel) → ALWAYS review-gated (channels are third-party-visible).
- `slack.post_dm` (target = `userId == ownerUserId`) → auto-allowed (operator's own surface).
- `slack.post_dm` (target != ownerUserId) → review-gated (third-party DM).

The Slack action handlers call `slackActionServicePure.decideAutoSendScope({ action, target, ownerUserId })`. The pure helper enforces the rules above; there is no per-user configurable scope in V1.

**Auto-send scope dropdown is NOT shipped in V1.** The locked mockup `03-ea-settings.html` shows a dropdown control; in V1 it is hidden or rendered as static text (`Auto-send: Only direct messages to me`). The dropdown's variance only becomes meaningful when the §1 framing ceiling is relaxed in a future spec; until then a configurable dropdown produces identical behaviour for all options, which would mislead the operator. Deferred per §26.

This pattern is forward-compat reusable. Future agents that gain Slack post capability (Riley brand outreach, future content agents) consume the same `slackActionServicePure.decideAutoSendScope` helper, and a future spec MAY introduce the dropdown when policy relaxation lands.

### 9.4 Handler responsibilities

`server/services/slack/slackActionService.ts` action handlers:

1. Resolve owner-scoped Slack credential via `credentialBrokerService.injectIntoEnvironment({ subaccountId, provider: 'slack', ownerUserId })`.
2. Validate input.
3. For write actions: derive `client_msg_id` idempotency key per `slackActionServicePure.deriveIdempotencyKey`; call `slackActionServicePure.decideAutoSendScope`; then:
   - **If `decision === 'auto'`** (DM target = `ownerUserId`): call Slack `chat.postMessage` immediately with the `client_msg_id` and return the resulting `messageTs`.
   - **If `decision === 'review'`** (any channel post, or DM target ≠ ownerUserId): create a proposal row via `actionService.proposeAction({ action, payload, ownerUserId, agentId, runId })` AND a linked `ea_drafts` row with `proposalId` + `sendState: 'idle'` (both in the same transaction; FK is never dangling). Return — the action does not call Slack at this point. The proposal primitive owns approval state; on approval, its commit hook re-enters the handler with `eaDraftId` set and the original idempotency key (the row is the audit), which proceeds to the post-approval send path (step 4).
4. For approved drafts: re-enter the handler from the approval path; idempotency key is the same; Slack rejects duplicate `client_msg_id` with `already_in_channel` which we map to a 200-idempotent-hit response.
5. Map errors per Slack API conventions; emit Run Trace events.

### 9.5 Pure helpers (`slackActionServicePure.ts`)

- `validatePostMessageInput(input)` / `validatePostDmInput(input)` / etc.
- `deriveIdempotencyKey({ kind, ownerUserId, payload })` → 128-bit hex (used as `client_msg_id`).
- `decideAutoSendScope({ scope, action, target, ownerUserId, memberChannelIds })` → `'auto' | 'review'`. Pure; full Vitest coverage per §25.
- `assembleThreadSummaryPrompt({ messages, summaryLength })` → prompt-payload string.

### 9.6 Slack as both delivery channel AND first-class connector

Today, Slack is wired as an outbound delivery channel (for HITL approvals + briefings via direct webhook). V1 promotes it: Slack is also a first-class connector with agent-callable actions. The HITL approval Slack channel and the agent-action Slack post both use the same `chat.postMessage` API and the same connection — there is no duplicate authentication.

`slack.post_message` is registered in the action registry; the existing HITL Slack approval is NOT registered as an agent-callable action (it's an internal platform mechanism). No collision.


## 10. External-source trigger primitive

V1 introduces external-source triggers as a new sub-type of agent trigger. The existing internal-event trigger primitive (`task_created` / `task_moved` / `agent_completed`) is unchanged.

### 10.1 Event-type enum extension

Migration `NNNN_external_source_triggers.sql` extends `agent_triggers.event_type` enum to add:

- `gmail_message_received`
- `calendar_event_imminent`
- `slack_mention`

`server/db/schema/agentTriggers.ts` Drizzle schema mirrors the new enum values. `server/services/triggerService.ts` extends the `eventType` parameter union throughout the file (3 usages caught by `grep` in the codebase: lines 66, 162, 238 per the verification pass).

Existing rows are unchanged — the enum extension is additive and backwards-compatible.

### 10.2 Webhook ingestion routes

**No new Google webhook route in V1.** Google Calendar push notifications fire on event create/update/delete, NOT at reminder time — they cannot produce a 15-minute-before trigger. V1's `calendar_event_imminent` comes from `calendarLookaheadJob.ts` (scheduled scan per §10.5), not from push. Gmail push via Pub/Sub is also deferred per §26. `server/routes/webhooks/googleWebhook.ts` lands in V1.5 if/when push-based local mirroring or Gmail push provides a real consumer.

**`server/routes/webhooks/slackWebhook.ts` (EXTENDED for url_verification only).** Currently handles approval-callback events. V1 changes:

- Existing `payload.type === 'block_actions'` path (approval) — unchanged.
- Slack URL verification handshake (`payload.type === 'url_verification'` with `challenge`) — V1 spec adds the trivial echo handler if not already present. Needed so the Slack app's Events API subscription can be configured at install time (forward-compat for V1.5 when the `app_mention` handler ships).
- **`payload.type === 'event_callback'` with `payload.event.type === 'app_mention'` — DEFERRED to V1.5** alongside Workflow #4 (Slack thread summary). The `slack_mention` enum value lives in the `agent_triggers.event_type` enum (V1 ships the enum extension for forward-compat) but no V1 webhook path fires the trigger. Any `app_mention` event received in V1 is no-op'd at the route (200 OK to Slack, no internal dispatch). This avoids shipping owner-routing logic with no V1 consumer.
- Other event types passed through (no-op for V1).

### 10.3 Source routing → trigger dispatch

`server/services/triggers/externalSourceTriggers.ts` is the single dispatch surface.

**V1 producer list (exhaustive, two producers only):**
- `gmailInboxPollJob.ts` — fires `gmail_message_received`.
- `calendarLookaheadJob.ts` — fires `calendar_event_imminent`.

`slackWebhook.ts` is NOT a V1 producer. The route accepts the Slack `url_verification` handshake (so the Slack-app subscription can be configured at install time) and no-ops `event_callback` / `app_mention` payloads per §10.2. Slack becomes a producer for `slack_mention` in V1.5 alongside Workflow #4 per §26. The dispatch surface's Zod discriminated union accepts the `slack_mention` variant in V1 (forward compat for the V1.5 lift) but no V1 call site emits it.

**Dispatch steps (V1 producers):**
1. Receive a normalised external event from one of the V1 producers above.
2. Resolve `(organisationId, subaccountId, ownerUserId)` from the `integration_connections` row associated with the inbound event.
3. Compute dedup key per §7.1. Check the dedup store; skip if already fired.
4. Call `triggerService.fireTriggers(subaccountId, eventType, eventData)` with the event payload embedded under `eventData`.
5. The existing `triggerService.fireTriggers` performs the rate-cap check, looks up subscribed triggers, and enqueues runs.

`triggerContext.source = 'external'` is the new discriminator added to the JSONB embedded by `triggerService`. Existing `'schedule' | 'trigger' | 'manual'` values continue to work.

Owner scoping: external triggers ALWAYS resolve to a user-owned agent (the trigger's `agent_id` references an agent row that has `owner_user_id` set — by virtue of being the EA). Spec asserts: if `triggerService.fireTriggers` matches a subscribed agent whose `owner_user_id` differs from the event's resolved owner, the dispatch is skipped + a `trigger.suppressed` event with reason `owner_mismatch` is written. Defence-in-depth — the broker would reject the credential anyway, but this prevents wasted runs.

### 10.4 Gmail polling (V1 default; push is V1.5)

`server/jobs/gmailInboxPollJob.ts` is a pg-boss recurring job. One job per connected Gmail account (per `integration_connections` row where `provider = 'gmail'`):

1. Acquire advisory lock keyed on `('gmail_poll', integration_connection_id)` for single-writer guarantee.
2. Read the connection's `last_history_id` from `integration_connections.config_json.lastHistoryId` (existing JSONB column — no migration).
3. **Bootstrap path (no `lastHistoryId` on the connection — first run after connect).** Call Gmail `users.getProfile`; persist the returned `historyId` as the baseline (`config_json.lastHistoryId = <profile.historyId>`); commit and release the lock. **Do NOT call `users.history.list` on the bootstrap tick.** Do NOT emit any `gmail_message_received` triggers on this tick. The mailbox at connect time is treated as the empty starting state — historical messages that pre-date the connection are NEVER ingested into EA triggers (avoids "first poll floods the EA with months of old mail"). Next tick proceeds via the steady-state path (step 4) from the just-persisted baseline.
4. **Steady-state path.** Call Gmail `users.history.list?startHistoryId={last_history_id}&historyTypes=messageAdded`.
5. For each new message in the history result, emit a `gmail_message_received` external event with the message's metadata (NOT body).
6. Update `last_history_id` to the response's `historyId` (committed only after all events for the tick have been dispatched to `externalSourceTriggers.ts` — partial-tick failures roll back the cursor advance so the next tick re-reads the missed range).
7. Release the advisory lock.

Schedule: every 5 minutes. Single Gmail account ≈ 288 calls/day, well inside Google's free quota. LLM cost is zero until a new message arrives AND the EA decides to act.

**API-error contract:**
- **401 / 403 / `invalid_grant` / token revoked** → mark connection `expired`; trigger emits `trigger.suppressed` with reason `credential_unavailable`. Job stops polling this account until reconnect.
- **404 / `failedPrecondition` / `historyId not found` / cursor invalid or expired.** Gmail history IDs are not retained indefinitely — extended outages, very-low-traffic mailboxes, or Gmail-internal compaction can render the stored `lastHistoryId` invalid. Recovery is mandatory: emit one `trigger.suppressed` event with reason `gmail_history_cursor_expired` (NEW reason added to §10.7's reason enum; criticality `warning`); call `users.getProfile` to read a fresh baseline; overwrite `config_json.lastHistoryId` with the new value; commit and release the lock. **Do NOT call `users.history.list` with the new cursor on this tick. Do NOT emit `gmail_message_received` triggers for any messages between the old (expired) cursor and the new baseline — the gap is intentionally dropped** (V1 trades a one-time loss of mid-outage mail for a bounded-time recovery; no retroactive backfill, mirroring the bootstrap-path policy in step 3). The Workspace tab's degraded-state indicator surfaces "Recovered from a Gmail sync gap — older messages during the outage are not retried" until the next successful steady-state tick. Next tick proceeds via step 4 from the new baseline. No connection-status change — the credential is still valid; only the cursor was lost.
- **429 / rate-limited** → backoff per existing primitive; lock released, cursor unchanged.
- **5xx / transient network failure** → retry per existing pg-boss retry config; lock released, cursor unchanged. Differs from cursor-expired: 5xx is recoverable on the next tick without losing data.

The bootstrap-no-backfill and cursor-expired-no-backfill policies are operator-visible contracts, not implementation details. They MUST be reflected in §13.4's first-run wizard copy (the wizard's voice-profile-derivation explanation already notes "the EA starts from new mail you receive after connecting") and in the Settings page's connection-status surface (a small "Last sync recovery" timestamp when a `gmail_history_cursor_expired` event has fired in the trailing 7 days).

### 10.5 Calendar lookahead scan (V1 default — replaces the prior push-channel design)

`server/jobs/calendarLookaheadJob.ts` is a pg-boss recurring job. One job per connected Google Calendar account:

1. Schedule: every 1 minute (per connected Calendar account). The cadence is tight because the lookahead window is 15 min and missing a minute risks missing a meeting prep notification.
2. Acquire advisory lock keyed on `('calendar_lookahead', integration_connection_id)` for single-writer guarantee.
3. Resolve owner-scoped Google Calendar credential via `credentialBrokerService.injectIntoEnvironment({ subaccountId, provider: 'google_calendar', ownerUserId })`.
4. Call Google Calendar `events.list` with `calendarId = 'primary'`, `timeMin = now()`, `timeMax = now() + lookaheadMinutes` (default 15min), `singleEvents = true`, `orderBy = 'startTime'`. `singleEvents = true` expands recurring events to their individual occurrences.
5. For each event in the result, compute the per-occurrence dedup key per §7.1 (`(provider='google_calendar', dedup_key='{calendarEventId}@{startAt}@{minutesUntilStart}', ownerUserId)` — `minutesUntilStart` is the configured lookahead horizon for this scan, V1 default 15). Skip if the dedup ledger already has a row.
6. For each new event, emit a `calendar_event_imminent` external event with the event's metadata. Insert the dedup row in the same transaction.
7. Release the advisory lock.

Rationale for scheduled scan over push: Google Calendar push notifications fire on event create/update/delete — NOT at reminder time. There is no Google API that emits "this event starts in 15 minutes." The lookahead must be computed by SynthetOS.

API quota: 1 call/min × 1 calendar × 60 min/h × 24 h = 1,440 calls/day per connected Calendar account. Well inside Google's per-user free quota (1M units/day; `events.list` costs ~1 unit per call).

On API errors:
- 401 / 403 / token revoked → mark connection `expired`; trigger emits `trigger.suppressed`. Job stops polling this account until reconnect.
- 429 → backoff per existing primitive; if still hitting rate limit, fall back to a 5-minute cadence (loss of fidelity acceptable; meeting prep may fire a few minutes late).
- 5xx → retry per existing pg-boss retry config.

Lookahead semantics: V1 default lookahead `15 minutes`. Multiple lookahead horizons (e.g. 24h next-day prep + 15min imminent) deferred per §26.

**Terminology pin (binding to avoid future stale-token grep regressions).** `lookaheadMinutes` is the **scanner-side configuration** name on `calendarLookaheadJob.ts` — it controls how far ahead `events.list` scans. `minutesUntilStart` is the **event-payload field** on the emitted `calendar_event_imminent` event (per REQ-T8 / §7.1) AND the canonical axis in the dedup key (`'{calendarEventId}@{startAt}@{minutesUntilStart}'`). At emission time, the scanner copies its current `lookaheadMinutes` value into the event's `minutesUntilStart` field. The two names refer to the same numeric value (15 in V1) but live on different sides of the producer/consumer boundary; spec prose uses `lookaheadMinutes` only when referring to the scanner config and `minutesUntilStart` everywhere else (event payload, dedup key, downstream consumer references).

### 10.6 Slack Events API (V1 scaffolding only)

**V1 scope (exhaustive):** configure the Slack `url_verification` handshake in `slackWebhook.ts` so the Slack-app Events-API subscription can be registered at install time, plus a comment in `server/config/oauthProviders.ts` recording that `app_mention` is the subscribed event type. The subscription itself is configured at the Slack-app level (Slack admin UI on the SynthetOS Slack app).

**Explicit V1 non-scope:** `event_callback` payloads (including `app_mention`) are acknowledged with 200 OK and **no-op'd at the route** — no internal dispatch, no `slack_mention` trigger fires, no consumer code runs. V1 does NOT consume Slack inbound events beyond the URL verification handshake.

The full consumer (owner routing, dedup, trigger firing into Workflow #4) lands in V1.5 alongside `ea.slack_thread_summary` per §26.

Slack URL-verification handshake handled per §10.2.

### 10.7 Trigger uniformity contract (binding)

Every triggered run (Type A / B / C) emits a `trigger.fired` Run Trace event at run start with fields:

```
{
  type: 'trigger.fired',
  triggerId: uuid,
  triggerKind: 'schedule' | 'internal_event' | 'external',
  eventType: string,
  subaccountId, ownerUserId, organisationId,
  enqueuedAt: timestamptz,
  startedAt: timestamptz
}
```

Suppression events:

```
{
  type: 'trigger.suppressed',
  triggerId: uuid,
  triggerKind: 'schedule' | 'internal_event' | 'external',
  reason: 'rate_capped' | 'missing_agent' | 'missing_skill' | 'credential_unavailable' | 'owner_mismatch' | 'owner_unresolved' | 'owner_ambiguous' | 'dedup_hit' | 'gmail_history_cursor_expired',
  subaccountId, ownerUserId, organisationId,
  occurredAt: timestamptz
}
```

These event types are added to `shared/types/agentExecutionLog.ts` `AGENT_EXECUTION_EVENT_CRITICALITY` registry (existing primitive) with criticality `info` for `trigger.fired`, `warning` for `trigger.suppressed`.

### 10.8 Rate caps

Existing `MAX_TRIGGERED_RUNS_PER_MINUTE` (in `triggerService.ts`) applies. Spec adds a separate cap for external-source triggers: `MAX_EXTERNAL_TRIGGERED_RUNS_PER_MINUTE_PER_OWNER = 10` (recommendation; spec confirms). Rationale: Gmail burst (incoming mail spike) shouldn't trigger 100 EA runs per minute. Internal-event cap remains tuned for `task_created`-class throughput; external cap is owner-scoped because external bursts are per-user.

### 10.9 Concurrency guarantees

- Gmail polling: single-writer-per-connection via advisory lock per §10.4.
- Calendar lookahead: scheduled per-connection scan via advisory lock (§10.5); dedup via §7.1 dedup key (per-occurrence: `(provider='google_calendar', dedup_key='{calendarEventId}@{startAt}@{minutesUntilStart}', ownerUserId)` — no `calendarId` prefix per REQ-T8; V1 is single primary calendar per owner).
- Slack Events API: V1 only handles the URL-verification handshake and **no-ops** `event_callback` / `app_mention` payloads (per §10.6). No V1 concurrency or dedup guarantee applies because no Slack inbound event is admitted into `externalSourceTriggers.ts` or `triggerService.fireTriggers`. The `slack_mention` dedup-key shape in §7.1 is forward-compat for V1.5 — no V1 row is written to `external_trigger_dedup` for `provider='slack'`. V1.5 will add at-least-once delivery handling, owner routing, and dedup writes for `slack_mention` alongside Workflow #4.
- Trigger dispatch: idempotent on `(provider, dedup_key, ownerUserId)` per §7.1 (per-event-type `dedup_key` shape per REQ-T8: Gmail = `messageId`; Calendar = `'{calendarEventId}@{startAt}@{minutesUntilStart}'`; Slack = `'{channelId}@{messageTs}'`). Replay of the same dedup key is a no-op `trigger.suppressed` with reason `dedup_hit`.


## 11. V1 workflows

Three workflows ship V1 per brief §4 q5 (LOCKED). Each is a named native workflow registered as a skill markdown file under `server/skills/` and wired into the EA's default skill bundle.

### 11.1 Workflow A — Daily briefing (07:00 cron + Slack DM)

**Skill slug:** `ea.daily_briefing`. **Trigger:** Type A, RRULE `FREQ=DAILY;BYHOUR=7;BYMINUTE=0` in the owner's configured timezone (memory_block `ea.timezone` set at first-run setup).

**Steps:**
1. Read today's calendar events via `list_events` (timeMin = today 00:00, timeMax = today 23:59, timezone-aware).
2. Read overnight unread inbox via `read_inbox` (existing action; sinceTimestamp = yesterday 18:00).
3. Read overnight Slack mentions via `slack.search_messages` (query: `to:me after:yesterday`).
4. Assemble structured briefing payload (one-paragraph summary + bullet sections: schedule / inbox highlights / Slack mentions).
5. Compose via voice-profile-aware prompt (read `voice_profiles` for the owner; opt-out respected per §12).
6. Post to operator's Slack DM via `slack.post_dm` to `userId == ownerUserId`. Auto-allowed per the fixed V1 Slack send policy (DM-to-owner is the single auto-allow case; see §9.3).
7. Fallback to email via `send_email` if Slack not connected (delivery_fallback Run Trace event per §16).

**No third-party sends.** The only write invoked is `slack.post_dm` to `userId == ownerUserId` (Tier 6 in the registry per §9.1; auto-allowed by the auto-send-scope decision because DM-to-self is auto in every scope setting). No customer-broadcast writes, no third-party messages. Native run, ~10–30 seconds.

### 11.2 Workflow B — Inbox triage + drafted replies (07:15 cron + `gmail_message_received` polling trigger)

**Skill slug:** `ea.inbox_triage`. **Triggers:**
- Type A: RRULE `FREQ=DAILY;BYHOUR=7;BYMINUTE=15`. Catches up on anything that arrived overnight outside the polling window.
- Type B: `gmail_message_received` for new mail during the day.

**Steps:**
1. Read inbox new-mail batch via `read_inbox` (live-fetch).
2. Classify each message: urgent / normal / promotional / spam.
3. For known patterns (acks, simple Qs, calendar requests), draft a reply via the voice-profile-aware prompt. Write the proposal via `actionService.proposeAction({ action: 'send_email', payload, ownerUserId, agentId, runId })` — the proposal primitive owns approval state. Then write the linked `ea_drafts` row with `proposalId` = the proposal row's id and `sendState: 'idle'`. Both writes happen inside the same transaction so the FK is never dangling.
4. Notify the operator via `slack.post_dm` with a summary of drafts awaiting review + a link to the Drafts tab (per-agent detail page Workspace tab).
5. Approval is the operator's responsibility — driven by the proposal primitive's approval surface. On approval, the proposal primitive's commit hook invokes the underlying action handler (`send_email`) with the approved payload from `ea_drafts.body`; the handler records `externalResultId` on the `ea_drafts` row and transitions `sendState: idle → sending → sent`. Approved drafts may also create a Gmail Drafts row optionally (operator-configurable) so they appear in the operator's native Gmail Drafts folder during review. Rejection / expiry are recorded on the proposal row; the linked `ea_drafts` row remains with `sendState: 'idle'` and is hidden from the Workspace tab after the proposal primitive marks it terminal.

**Drafts go to Gmail Drafts by definition.** No outbound until approved. `send_email` is Tier 6 review-gated (existing action — unchanged).

### 11.3 Workflow C — Meeting prep summary (`calendar_event_imminent` trigger 15 min before)

**Skill slug:** `ea.meeting_prep`. **Trigger:** Type B `calendar_event_imminent` with `minutesUntilStart = 15` on the event payload (per REQ-T8 canonical field name; `calendarLookaheadJob.ts`'s scanner-side config is `lookaheadMinutes`, which becomes the `minutesUntilStart` field on each emitted event). The trigger fires from `calendarLookaheadJob.ts` (scheduled scan per §10.5), not from Calendar push.

**Steps:**
1. From the trigger payload, identify the event id + attendee list.
2. Pull attendee context from:
   - Drive (search docs by attendee email or attendee org domain via existing read-only resolver).
   - Recent inbox (search by attendee email via `read_inbox`).
   - Slack history with the attendees (via `slack.search_messages` or `slack.read_channel` for known shared channels).
3. Voice-profile-aware prompt assembles a one-paragraph context summary + relevant doc links.
4. Post to operator's Slack DM via `slack.post_dm` to `userId == ownerUserId`.

**No third-party sends.** The only write invoked is `slack.post_dm` to `userId == ownerUserId` (Tier 6 in the registry; auto-allowed because DM-to-self is auto in every scope setting). Read-heavy native run, ~15–45 seconds.

### 11.4 Workflow framing

All three workflows:
- Run as native-controller agent runs via existing `agentExecutionService`.
- Carry `controllerStyle: 'native'` and `triggerContext.source` per §6.4.
- Emit `workflow.started` and `workflow.completed | workflow.failed | workflow.partial` Run Trace events.
- Inherit the EA agent's risk-tier ceiling (6) and default approval policy (Tier 0–3 auto, Tier 4–5 review, Tier 6 review-required).
- Cost-attribute to the EA agent's `agent_id`; budget rolls up to the subaccount.

### 11.5 Deferred workflows

Per brief §4 q5, two workflows are deferred to a fast follow-on:

- **Workflow #4 — Slack thread summary on `slack_mention`** (Type B). Skill slug `ea.slack_thread_summary`. The `slack_mention` enum value ships V1 (forward-compat in `agent_triggers.event_type`), but the webhook handler that fires the trigger AND the workflow itself BOTH defer V1.5. V1 receives `app_mention` events but no-ops them.
- **Workflow #5 — Weekly review (Friday 16:00 cron + Slack DM).** Skill slug `ea.weekly_review`. RRULE `FREQ=WEEKLY;BYDAY=FR;BYHOUR=16;BYMINUTE=0`.

Both deferred workflows can land in V1.5 with NO foundation changes — only the new skill markdown + the workflow body code. V1 ships everything they depend on.

### 11.6 Workflow framing — interaction with the approval primitive + EA drafts

Workflow B (inbox triage) is the only default V1 scheduled workflow that creates `ea_drafts` rows during normal operation. HOWEVER, any V1 review-gated external write may create a proposal row + linked `ea_drafts` row through the shared draft/proposal helper — this explicitly includes Gmail sends (Workflow B's path), Slack reviewed channel posts and non-self DMs (§9.4 step 3), and Calendar `create_event` / `update_event` / `respond_to_invite` actions (§8.4 reject-if-missing-eaDraftId). The `ea_drafts.kind` enum (§7.5) names the seven supported draft kinds for exactly this reason.

Approval state always lives on the proposal row (`actionService.proposeAction` primitive), NOT on `ea_drafts` (per §7.5 composition lock). Whoever creates a draft (Workflow B, Calendar action handler, Slack action handler) writes both rows in the same transaction. The operator-driven approval surface is the proposal primitive's existing UI; the per-agent Workspace tab in §14.3 is a JOIN view that surfaces `ea_drafts.body` (the preview) alongside the proposal primitive's approve/reject buttons. On approval, the proposal primitive's commit hook invokes the underlying action handler with `eaDraftId` in the input. The action handler records `externalResultId` on the `ea_drafts` row + transitions `sendState: 'idle' → 'sending' → 'sent'`. No parallel approval primitive on `ea_drafts`.


## 12. Voice Profile primitive

The EA adopts the operator's writing voice from existing content. Implemented as a generic `VoiceProfile` primitive reusable across Riley (brand outreach voice), Helena (client-report voice), Sarah (analyst voice), and future content/marketing agents.

### 12.1 Resource shape

New table `voice_profiles`. Schema per §7.4. Key invariants:

- **Exactly one of** `ownerUserId` / `subaccountId` / `orgScope`. CHECK constraint enforces this.
- `optOutAt` is the kill-switch — when set, the profile is not derived/refreshed/consumed regardless of other state.
- `profileJson` stores derived features only — NEVER raw content. Schema versioned via `profileJson.schemaVersion`.

### 12.2 Service responsibilities

`server/services/voiceProfile/voiceProfileService.ts`:

- `deriveProfile({ profileId })` — read the row, pick the sampler(s) by `sources[]` (per REQ-C4 a profile MAY list multiple samplers), run each sampler against its `source_config` entry, merge samples across all listed sources, distil features, write `profileJson` + `sampleSize` + `lastDerivedAt`.
- `refreshProfile({ profileId, force })` — re-derive if refresh-policy threshold triggered OR `force === true`.
- `getProfile({ profileId })` — return profile (respects opt-out at the API serialisation layer per predecessor §3.6).
- `optOut({ profileId })` — set `optOutAt = now()`.
- `reactivate({ profileId })` — clear `optOutAt`. Triggers a re-derive on next refresh.

Pluggable sampler interface:

```
type VoiceSampler = {
  kind: 'gmail_sent_sampler' | 'drive_doc_sampler'
  sample: (config: SamplerConfig, ownerContext) => Promise<{ samples: Array<{ text: string }>, sampleSize: number }>
}
```

Two samplers ship V1 (`manual` deferred to V1.5 per §26):

- **`gmailSentSampler`** — receives its per-sampler slice from `voice_profiles.source_config['gmail_sent_sampler']` (the orchestrator reads the row, splits `source_config` by sampler key, and passes only the matching slice to each sampler's `sample()` call). Calls existing `read_inbox` adapter against the owner's Gmail with `folder = SENT`, `limit = config.lastN`, `sinceDays = config.sinceDays`. Optional `config.gmailLabelFilter`. Returns last N sent message bodies (TRANSIENT — read into memory, distilled, discarded).
- **`driveDocSampler`** — reads specified Drive doc(s) via existing read-only resolver. Used for brand-voice cases where a brand has a style-guide doc.

### 12.3 Feature distillation (pure)

`voiceProfileServicePure.distilFeatures(samples)` returns the `profileJson` shape. Pure function with Vitest unit coverage. Distillation:

- Greeting pattern frequency.
- Signoff pattern frequency.
- Sentence-length statistics (mean, p50, p90).
- Formality score (0–1, based on word-list classifier — see §25 pure test).
- Em-dash usage classification (`avoid` / `neutral` / `use`).
- Common phrases (top-K bigrams/trigrams by frequency).
- Signature line (last 1–2 lines that recur across samples).

Distillation is deterministic — same samples produce the same profile_json. No LLM call in distillation; deterministic feature extraction only.

### 12.4 Prompt integration

`agentExecutionService` prompt assembly gains a `<voice>` block injected before the task prompt when the agent has an attached voice profile.

**Voice profile attachment SOT (single source of truth).** The EA agent's attached profile id is stored as a memory_block on the EA agent: `key = 'ea.voice_profile_id'`, `value = '<voice_profile.id>'`. Prompt assembly reads exactly this memory_block; no other lookup path. Provisioning (§13.4 step 6) writes the memory_block after creating the `voice_profiles` row.

**Opt-out only sets `optOutAt`; it never clears the attachment memory_block.** This decouples attachment from active-state — when an operator re-activates the profile from Settings, the attachment is preserved and reactivation is one click (clearing `optOutAt`). Prompt assembly's check at run time: `profile.optOutAt IS NULL AND profile.state = 'ready'`. If either condition fails, the voice block is omitted. There is no second path; agent config does NOT carry `voice_profile_id`, and there is no fallback lookup. This reuses the existing memory_blocks primitive — no new column on `agents` and no new attachment table.

Behaviour:

- The block is rendered from `profileJson` as a structured instruction (e.g. "Greeting: prefer 'Hi {name},' over 'Hello'; signoff: 'Best, Michael'; avoid em-dashes; informal-leaning (0.42 formality)").
- Block respects `optOutAt` — opted-out profile produces no block.
- Block lives in the `stablePrefix` cache partition (per `docs/spec-context.md` accepted primitives) — the profile changes at most once per refresh interval (30 days for V1's default `periodic` policy), making it a high-cache-hit-rate prompt section.

### 12.5 Default refresh policy

EA's default profile is created on first-run setup with (REQ-C4 schema):

```
sources: ['gmail_sent_sampler'],
sourceConfig: { gmail_sent_sampler: { lastN: 50, sinceDays: 90 } },
refreshPolicy: 'periodic',
refreshConfig: { days: 30 },
optOutAt: null
```

(`sources` is the `text[]` column added by REQ-C4; `sourceConfig` is caller-shaped — keyed by sampler name. The `kind` discriminator on the value is dropped because `sources[]` already names which samplers apply. The old single-source `source` + discriminated `{ kind, ... }` shape is rejected by the V1 write API.)

The `voiceProfileRefreshJob.ts` pg-boss job runs nightly and finds rows whose refresh threshold has triggered:

- For `refreshPolicy = 'periodic'`: `lastDerivedAt + refreshConfig.days < now()`.
- For `refreshPolicy = 'manual'`: never auto-refresh (operator triggers via the Settings page).
- For `refreshPolicy = 'on_send_count'`: schema-reserved for a future spec — V1 ships the enum value but the counter that drives it (`sent_count_since_derive`) is NOT tracked in V1. Rows with `refreshPolicy = 'on_send_count'` never auto-refresh until a later spec adds the counter. Defer per §26.

For each matching row, the job calls `refreshProfile({ force: false })`. V1 default is `periodic, 30 days`, so the only path the job exercises in V1 is the periodic-time check.

### 12.6 Opt-out semantics

- **Default: opt-in** with a clear explanation at first-run setup. Brief §3.11 + §4 q8 LOCKED.
- One-click opt-out from the EA settings page (existing locked mockup `03-ea-settings.html`).
- Opt-out is reversible (clear `optOutAt`; next refresh re-derives from scratch). The memory_block attachment (§12.4) is preserved across opt-out → re-activation, so re-enabling is one click.
- Opt-out blocks both **derivation** and **consumption**. While opted-out, the EA's prompts include NO voice-aware block; outputs default to the EA's base system-prompt voice (generic professional). The single check at prompt-assembly time is `optOutAt IS NULL AND state = 'ready'`; the attachment memory_block is necessary but not sufficient.
- Opt-out state visible in the Settings page; status pill shows `Active` / `Opted out` / `Derivation pending` / `Refresh due`.

### 12.7 Privacy framing

- Source content (Gmail sent bodies, Drive doc text) is read transiently — never written to `voice_profiles` rows.
- `profileJson` is feature-level (counts, statistics, signatures) — not verbatim content.
- Admin redaction policy (predecessor §3.6) applies: org/subaccount admins see `voice_profiles` row metadata (`sources`, `lastDerivedAt`, `state`, `optOutAt`, `refreshPolicy`) but NOT `profileJson` content and NOT `sourceConfig` (which may carry per-sampler scoping hints — e.g. specific Drive doc ids — that are private to the owner). Owning user sees full content.
- Run Trace event `voice.profile.refreshed` fires on each refresh with `{ profileId, sampleSize, durationMs }`. Content NOT logged.

### 12.8 Reuse cases

V1 ships EA's profile only. Designed for V1.5+ reuse without schema changes:

- **Riley (brand-outreach voice).** A subaccount-scoped profile (`subaccountId` set) with `source: 'drive_doc_sampler'` reading the subaccount's brand style guide doc.
- **Helena (client-report voice).** Subaccount-scoped profile reading prior client reports.
- **Sarah (analyst voice).** Subaccount-scoped profile reading prior analyst notes.
- **Future content / marketing agents.** Same primitive.

Each agent attaches its profile via a memory_block keyed `<agent-slug>.voice_profile_id` (the EA uses `ea.voice_profile_id`; future agents follow the same per-slug convention). The prompt-integration path in §12.4 picks it up uniformly via the agent's per-instance memory_blocks.


## 13. EA system-agent template + provisioning

### 13.1 System-agent template (`c.ts` + seed migration)

`server/config/c.ts` `SUBACCOUNT_AGENTS` gains one entry:

```
{ slug: 'executive-assistant', name: 'Personal Assistant', agentRole: 'Specialist', executionScope: 'subaccount' }
```

The DB seed migration `migrations/NNNN_executive_assistant_seed.sql` is authoritative (matching precedent migration 0256). The seed row carries:

- `slug = 'executive-assistant'`
- `name = 'Personal Assistant'`
- `agentRole = 'Specialist'`
- `executionScope = 'subaccount'`
- `controllerStyle (default for instances)` = `'native'` (locked; V1 supports only this style)
- `risk_tier_ceiling = 6` (Tier 6 sends — `send_email`, `slack.post_message`, `slack.post_dm` — are core EA capability, gated by `review_required` per the default approval policy below)
- `default_approval_policy` = `{ tier_0_3: 'auto', tier_4_5: 'review', tier_6: 'review_required' }`
- `default_skill_allowlist` = full list per §13.2
- `default_system_prompt` = canonical EA prompt per §13.3
- `home_widget` = `{ type: 'summary_card', titleTemplate: '${agent.displayName}', bodyProviderSkill: 'ea.home_widget.summary', refreshPolicy: 'on_login' }`
- `default_capability_map` — computed by existing `capabilityMapService` from the skill allowlist crossed with integration-reference; no manual map authoring.

The seed inserts a single `system_agents` row. **No per-user EA agent row is created at seed time.** Per-user provisioning is explicit (§13.4).

### 13.2 Default skill allowlist

The "what ships enabled out-of-the-box" set:

- **Email**: `read_inbox`, `send_email`
- **Calendar**: `list_events`, `get_event`, `find_free_slot`, `create_event`, `update_event`, `respond_to_invite` (the 6 V1 actions from §8)
- **Slack**: `slack.list_channels`, `slack.read_channel`, `slack.search_messages`, `slack.summarise_thread`, `slack.post_message`, `slack.post_dm` (the 6 V1 actions from §9)
- **Drive**: existing read-only resolver via `read_data_source`
- **Web**: `web_search`, `fetch_url`, `scrape_structured`
- **Platform meta-skills**: `ask_clarifying_question`, `request_clarification`, `read_workspace`, `update_memory_block`, `notify_operator`, `read_priority_feed`, `search_agent_history`
- **Workflows (V1 trio)**: `ea.daily_briefing`, `ea.inbox_triage`, `ea.meeting_prep`
- **Home-widget skill**: `ea.home_widget.summary`

Universal skills per `server/config/universalSkills.ts` are always available regardless of allowlist — confirmed unchanged for V1 per §5.3.

### 13.3 Default system prompt

The system prompt (canonical text in the seed migration; not authored here in full — architect drafts in Phase 2) carries:

- **Identity**: "You are an Executive Assistant agent acting on behalf of {ownerUser.displayName}. You speak in their voice when composing outbound messages (see voice block). You ask before sending to third parties; you act freely on internal-only tasks."
- **Voice integration**: when `voice_profile_id` is set on the agent's config and `optOutAt IS NULL`, the prompt includes the `<voice>` block per §12.4. Otherwise the prompt notes "no voice profile configured; default to clear, professional tone."
- **Escalation rules**: when uncertain (low-confidence classification, ambiguous user intent, conflicting calendar/availability info) → `ask_clarifying_question` rather than guess. When a Tier 6 action surfaces → invoke `request_clarification` (do NOT just propose the action without context). When a credential is revoked → `notify_operator` with severity `warning`.
- **Memory awareness**: read working hours, timezone, briefing preferences from `memory_blocks` at run start.
- **Delivery awareness**: read briefing delivery target from `memory_blocks` (`ea.briefing_delivery_target`); fallback per §16.

The system prompt is voice-profile-aware but not voice-profile-dependent (it works correctly when no profile exists).

### 13.4 EA provisioning (explicit consent, not automatic)

Per brief §3.14, EAs are NOT auto-created for every user in the org. The provisioning flow:

1. User visits home page. The Personal nav group is empty; the home page renders a "Set up my Personal Assistant" card in the Personal zone (or in place of it, if the Personal zone is empty).
2. User clicks "Set up". The first-run wizard opens (per locked mockup `01-first-run-setup.html`).
3. Wizard steps:
   - **OAuth connections** (optional but recommended): Gmail, Google Calendar, Slack, Drive. Each opens the existing OAuth flow with `owner_user_id = current_user.id` set on the resulting `integration_connections` row (predecessor §3.3).
   - **Context questionnaire** (per brief §3.12, 5–10 fields max, one screen): timezone (auto-detected, confirm), working hours, briefing delivery target, briefing time, default meeting length, close colleagues / family (optional free-text), recurring people-or-projects to flag, day-one notes. The values are buffered in wizard state and written as `memory_blocks` rows at step 5 (after the EA agent row exists per step 4).
   - **Voice profile derivation confirmation** (per brief §3.11): explanation copy + "Derive my voice from sent mail" button + "Skip and derive later" link. Default action button derives; skip writes NO `voice_profiles` row at this step. The operator can later trigger derivation from the Settings page — that action lazily creates the row with `optOutAt = NULL` and enqueues `voiceProfileService.deriveProfile`. Until the row exists, prompt assembly takes the "no voice profile configured" branch per §13.3.
4. Wizard completion creates the EA agent row (uniqueness axis is `(organisation_id, owner_user_id) WHERE slug = 'executive-assistant'` per §6.2.1):
   - `agents` row with `slug = 'executive-assistant'`, `owner_user_id = current_user.id`, `subaccount_id = current_subaccount.id` (the user's home/default subaccount at provisioning time per §6.2.1 — NOT a uniqueness or visibility axis; the EA is org-wide visible regardless of which subaccount the user enters), `system_agent_id = <EA-template-row>`, `name = 'Personal Assistant'` (default; renameable via Settings).
   - Seeds default skill allowlist from the template.
   - Seeds default approval policy from the template.
5. Writes the memory_blocks from the wizard fields.
6. Writes the voice_profile row (if derivation requested) with `sources: ['gmail_sent_sampler']` + `sourceConfig: { gmail_sent_sampler: { lastN: 50, sinceDays: 90 } }` + `refreshPolicy: 'periodic'` + `refreshConfig: { days: 30 }` + `optOutAt = NULL` (per REQ-C4 schema; see §12.5). Enqueues `voiceProfileService.deriveProfile` as a background job (the wizard completes immediately; profile derives asynchronously, typically <1 minute).
7. Seeds the V1 workflows' RRULE rows in `scheduled_tasks` (07:00 briefing + 07:15 inbox triage).
8. Seeds the per-Gmail-connection `gmail_inbox_poll` recurring task.
9. Seeds the per-Calendar-connection `calendar_lookahead` recurring task (1-minute scan per §10.5).
10. Seeds three `agent_triggers` rows attaching the EA's external-event subscriptions:
    - `(agent_id=<EA>, event_type='gmail_message_received', target_skill_slug='ea.inbox_triage')`
    - `(agent_id=<EA>, event_type='calendar_event_imminent', target_skill_slug='ea.meeting_prep')`
    - `(agent_id=<EA>, event_type='slack_mention', target_skill_slug='ea.slack_thread_summary')` — **dormant forward-compat row only**. V1 does NOT emit `slack_mention`, does NOT write `slack_mention` rows to `external_trigger_dedup`, and does NOT invoke `triggerService.fireTriggers` for Slack mentions (Slack inbound `event_callback` payloads are no-op'd at the route per §10.2 / §10.6). Pre-seeding the row is purely so that when V1.5 wires `app_mention` dispatch and ships `ea.slack_thread_summary` per §26 deferred Workflow #4, the subscription activates without re-running provisioning. No `trigger.fired` or `trigger.suppressed` events for `slack_mention` are written in V1.
11. Sets up Slack Events API subscription (or notes that the workspace-level subscription is already active).
12. Redirects to the per-agent detail page (Workspace tab).

The provisioning flow is **idempotent**: re-running the wizard for a user who already has an EA is treated as "edit setup" and updates memory_blocks + voice_profile config but does NOT create a duplicate agent row.

**Concurrency guard.** Two simultaneous wizard submissions from the same user (e.g. browser-tab double-submit) are arbitrated by a Postgres advisory lock on `('ea_provision', organisation_id::bigint, owner_user_id::bigint)` taken in the wizard's `POST /personal/setup` handler. Loser waits up to 2s for the leader to release; if a row was created during the wait, loser routes to "edit setup" instead of attempting a second creation. The advisory lock is released at end-of-transaction. A defence-in-depth partial unique index `(organisation_id, owner_user_id) WHERE slug = 'executive-assistant'` on `agents` table (REQ-EA3 amendment 2026-05-13 — uniqueness is per-org, not per-subaccount, because a single user has one EA across their entire org regardless of which subaccount context they enter) catches racing inserts that bypass the advisory lock (e.g. via direct API).

### 13.5 Multi-user provisioning

Each user provisions independently. The dogfood subaccount's first user is the operator (`michael@breakoutsolutions.com`) — seed migration optionally creates this user's EA at deploy time (architect decides in Phase 2 whether to include the operator's user_id explicit seed; safer is NO seed, operator goes through the wizard like every user). Additional users provision when the dogfood expands.

Each user's EA is a distinct `agents` row. Credentials, memory, runs, and voice profile are private per the predecessor's RLS + redaction.

### 13.6 Display name

`agents.name` (existing column) holds the per-instance display name. Default `Personal Assistant`. Users rename via the Settings page (existing locked mockup `03-ea-settings.html`). The renamed name surfaces in:

- Sidebar nav entry (Personal group).
- Run Trace event headers.
- Delivery surfaces (Slack DM signature, email From-name when allowed).
- Confirmation modals.
- Home Personal-zone card title.

No new schema. Name change invalidates the `useUserOwnedAgents()` query.

### 13.7 Spending budget (pooled to subaccount)

Per brief §3.15 (LOCKED). EA token spend rolls up into the existing subaccount budget. No new per-user budget primitive. Existing `spendAlertConfig.ts` and the subaccount budget alert behaviour apply to EA runs the same as any other agent. Per-user budget caps deferred per §26.


## 14. UI surfaces

Three NEW user-facing surfaces ship. All three are visualised in the three locked mockups in `prototypes/personal-assistant-v1/`. Spec treats the mockups as the design source of truth — implementation must match the locked HTML.

### 14.1 Sidebar Personal nav group (data-driven)

`client/src/config/sidebar.ts` `buildNavItems` factory gains a new `personal` group rendered at the TOP of the sidebar, above `Operate` / `Build` / `Govern`.

- Entries data-driven from `useUserOwnedAgents()` (returns `agents WHERE owner_user_id = current_user.id AND organisation_id = current_org_id` — org-wide per §6.2.1, NOT filtered by `subaccount_id`; the EA appears in the Personal nav regardless of which subaccount the user is currently in).
- Each entry uses the agent's `name` (display) field; icon derived from the system_agent template type.
- Group is hidden entirely when the hook returns empty.
- Group is visible regardless of which Workspace / Org / System view-mode is active — orthogonal to organisational scope.
- Active route highlight: when the user is on `/personal/:agentId`, the matching entry is highlighted.

Per brief §3.13: "view modes today (Workspace / Org / System) control organisational scope. A 'Personal' mode would mix two orthogonal axes." The persistent nav group avoids this confusion.

**Phase 3 forward-compat:** when Dev Agent ships as a second user-owned agent, it appears in the same Personal nav group automatically. Zero hardcoding, no nav refactor.

### 14.2 Home Personal zone (data-driven)

`client/src/pages/home/HomePage.tsx` renders a new `PersonalZone` component at the top of the home content, before existing sections.

- `PersonalZone` calls `useHomeWidgets()` which calls `agentHomeWidgets` API → returns `WidgetData[]` for each of the current user's user-owned agents.
- One `PersonalZoneCard` rendered per widget. Card frame is consistent (visual shell from the locked mockup `02-my-ea-home.html`); the body data comes from the agent's `body_provider_skill` per §19.
- Zone hidden entirely when `useHomeWidgets()` returns empty.
- Empty state, when the user has NO user-owned agents at all: render a single CTA card "Set up my Personal Assistant" linking to the first-run wizard.

EA's card content (per §19 + §7.7): brief one-liner + drafts count + next meeting prep + Open link.

Refresh policy `on_login` per EA's `home_widget` declaration — invalidates on `useHomeWidgets()` query refetch (on route entry).

### 14.3 Per-agent detail page (tabbed shell)

`client/src/pages/personal/PersonalAssistantPage.tsx` is a tabbed shell:

- **Workspace tab** (default). Lists drafts awaiting review, today's briefing inline, next meeting prep, active triggers. Drafts UI: JOIN view of `ea_drafts` rows with their linked proposal row (approval state `pending`). Approve / reject buttons drive the proposal primitive's approval surface; approval triggers the proposal's commit hook → action's send path. Send state from `ea_drafts.sendState` shown as a secondary indicator ("sending" / "sent" / "retry needed"). (Reference: mockup `02-my-ea-home.html` content style, repurposed as the Workspace tab body.)
- **Activity tab**. Lists recent agent runs (existing RunTracePage style, scoped to this agent). Admin redaction policy (predecessor §3.6) applies — owners see full content, admins see metadata only.
- **Settings tab**. Per-instance settings (locked mockup `03-ea-settings.html`):
  - Display name (rename).
  - Voice profile status (Active / Opted out / Derivation pending / Refresh due) + manual refresh button + opt-out toggle.
  - Briefing delivery preference (Slack DM / email / both).
  - Briefing time.
  - Slack auto-send scope: static text in V1 reading `Auto-send: Only direct messages to me`. Dropdown control is deferred per §9.3 + §26 (the configurable dropdown variance is not implementable within the V1 framing ceiling, so V1 renders the locked single-policy result rather than misleading the operator).
  - Trigger schedule overrides (briefing time, inbox triage cadence).
  - Context memory edit (list of `memory_blocks` for this agent with edit / delete actions).

Tabs use existing tabbed-shell primitives (from `consolidation-foundation` PR #270).

### 14.4 First-run setup wizard

`client/src/pages/personal/EAFirstRunWizard.tsx` renders the existing locked mockup `01-first-run-setup.html`. Single-screen wizard with OAuth connections + context questionnaire + voice-profile derivation step per §13.4.

Route: `/personal/:agentId/setup` (when agent already exists — re-entry to edit setup) OR `/personal/setup` (first-time, before agent row exists — wizard completion creates the agent and redirects).

### 14.5 Connection chip on `ConnectionsPage.tsx`

Per §16. Tiny visual addition; the row component renders a `Personal` / `Subaccount` chip based on `owner_user_id IS NOT NULL`. No new component file — minor edit to the existing row template.

### 14.6 Reused without new mockups

- Connections page (Calendar new row + chip): existing `ConnectionsPage.tsx` pattern.
- System-agent template registration: DB seed migration, no UI.
- Triggers: scheduled via existing `RecurringTasksPage`, event-driven via existing `AgentTriggersPage`. Both unchanged.
- Run Trace: existing `RunTracePage.tsx` with redaction policy from predecessor enforced at API serialisation.
- Slack briefing rendering: Slack-side message formatting, no SynthetOS UI surface.

### 14.7 Visual conventions

Inherit from `prototypes/consolidation-2026-05-06/_shared.css` (foundation visual baseline) and `prototypes/operator-backend/_shared.css` (extended pills, time strips, progress patterns). The three locked mockups already follow these conventions.

CLAUDE.md user preferences apply: NO em-dashes in UI copy or sample data (commas / colons / rewrite instead). NO emojis unless explicitly requested.

### 14.8 Mobile

V1 ships desktop-first per existing product convention. The Personal zone + sidebar group are responsive at the existing breakpoints; the per-agent detail page tabs collapse into a select dropdown on narrow widths. No native mobile app target.

### 14.9 Empty / loading / error states (per primary-task framing in `docs/frontend-design-principles.md`)

Every new surface ships:
- **Empty state with one next action** — Personal zone empty → "Set up my Personal Assistant" card; Drafts list empty → "No drafts to review yet" + recent-runs link.
- **Loading state** — skeleton shells consistent with existing primitives.
- **Error state** — single inline error chip + a retry action; no full-page error walls.

No KPI tile rows. No multi-chart dashboards. The Workspace tab is operational (one primary action: review drafts), not analytical.


## 15. Multi-user consumption of `user-owned-agents`

EA V1 is the first consumer of the predecessor primitive. Behaviour:

### 15.1 Per-user agent rows

Each user provisions their own EA via the first-run wizard. The result is a distinct `agents` row, **uniquely keyed on `(organisation_id, owner_user_id)` for `slug = 'executive-assistant'`** per §6.2.1:
- `slug = 'executive-assistant'`
- `owner_user_id = current_user.id`
- `subaccount_id = the user's home/default subaccount at provisioning time` — per §6.2.1, this is a pointer (budget rollup default + provisioning record), NOT a uniqueness or visibility axis. One EA per user per org regardless of how many subaccounts they enter.
- `system_agent_id = <EA-template-row>`

Two distinct users with separate EAs (whether or not they share a subaccount) = two `agents` rows. They share the system_agent template (skills, default approval policy, system prompt, home_widget declaration); their per-instance state (memory_blocks, voice_profile, drafts, run history) is private.

### 15.2 Credential resolution

Every EA action handler calls `credentialBrokerService.injectIntoEnvironment({ subaccountId, provider, ownerUserId: agent.ownerUserId })`. The broker resolves `integration_connections` rows scoped to `(organisation_id, subaccount_id, owner_user_id, provider)` per predecessor §3.3.

Defence-in-depth: the broker asserts `connection.owner_user_id === requestedOwnerUserId`. Mismatch → typed `OWNER_MISMATCH`. Run fails closed; Run Trace event `credential.owner_mismatch` written.

### 15.3 Run scoping

`agent_runs.owner_user_id` is set at run creation by copying from the parent agent's `owner_user_id`. RLS policies enforce that only the owning user can see their own runs (admins see metadata only, content redacted per predecessor §3.6).

### 15.4 Admin visibility (redaction)

The redaction policy is OWNED by the predecessor. EA V1 honours it by:

- **Run Trace endpoint** — at API serialisation, when the requester is an org-admin or subaccount-admin AND the row's `owner_user_id` is not the requester, the content payload is REDACTED. Existing `agentRunVisibility` + `agentRunEditPermissionMask(Pure)` primitives (per `docs/spec-context.md` accepted primitives) cover this; EA V1 extends them with the user-owned admin-redaction column rule.
- **Memory blocks endpoint** — same rule: only the owning user sees block contents.
- **Voice profile endpoint** — same rule: only the owning user sees `profileJson`.

The break-glass override (predecessor §3.6) writes the typed audit event `owner.content_revealed` when an admin elects to reveal content. V1 ships the audit event + the user-notification on next login + the time-limited grant. V1 does NOT ship the admin-side UI for requesting the override — admins use direct API access; the request UI is deferred per §26.

### 15.5 Per-user surfacing

- Sidebar Personal nav group: shows only the requester's user-owned agents.
- Home Personal zone: same.
- Connections page chip: shows `Personal` next to connections owned by the requester; OTHER users' `Personal` connections in the same subaccount are NOT visible to the requester (predecessor §3.5 RLS).

### 15.6 Reuse acceptance criterion satisfaction

Per §1 framing assumption: the primitive must be reusable. To prove this in V1:

- The home-widget contribution contract (§19) is generic, not EA-specific.
- The Personal nav group is data-driven over `agents WHERE owner_user_id = current_user.id`, not filtered to EA.
- The per-agent tabbed detail page is generic (Workspace / Activity / Settings).
- Credential resolution is generic — the broker call is parametric in `provider` and `ownerUserId`.

V1 spec does NOT require shipping a second user-owned agent. The architect in Phase 2 MAY add a minimal stub (no-op Dev Agent template) to verify the contracts compile without EA-specific branching. If the architect skips the stub, the proof is left as a regression test that exercises the home-widget pathway against the EA template — sufficient for V1 acceptance.

### 15.7 Cross-ownership delegation

Out of V1 scope per predecessor §3.8. V1 explicitly does NOT support `Michael's EA delegates to Sarah-the-analyst` (user-owned → subaccount-owned). If a runtime path attempts this, the orchestrator's existing delegation guard returns a typed error and the run records the attempted cross-ownership in Run Trace for diagnostic visibility. No silent fallback.


## 16. Notification + delivery + connection labelling

### 16.1 Delivery defaults per workflow

| Workflow | Default delivery | Configurable | Configurable to |
|---|---|---|---|
| Daily briefing (§11.1) | Slack DM to operator | yes | Slack DM / email / both |
| Inbox triage drafts notification (§11.2) | Slack DM summary | no (Gmail Drafts is the canonical drafts surface) | n/a |
| Meeting prep summary (§11.3) | Slack DM to operator | yes | Slack DM / email |

Configuration lives on the EA agent's per-instance `memory_blocks`:
- `key = 'ea.briefing_delivery_target'`, value `'slack_dm' | 'email' | 'both'` (default `'slack_dm'`).
- `key = 'ea.meeting_prep_delivery_target'`, value `'slack_dm' | 'email'` (default `'slack_dm'`).

Edited via the Settings tab (locked mockup `03-ea-settings.html`).

### 16.2 Delivery target resolution

- Operator's Slack user-id resolved via the operator's identity binding on the subaccount (existing `workspaceActors` table; no new field).
- Operator's email resolved via the user's `users.email` (existing column).
- Slack DM channel id resolved at delivery time via `slack.users.conversations` or by opening a DM with the user's Slack id (existing Slack adapter handles this).

### 16.3 Delivery fallback

If Slack DM delivery is configured but Slack is not connected for the owner OR the Slack connection has status `expired`, the EA falls back to email delivery.

Fallback emits a `delivery_fallback` Run Trace event with `{ originalTarget: 'slack_dm', fallbackTarget: 'email', reason: 'no_slack_connection' | 'slack_credential_expired' }`. Operator sees a degraded-state indicator on the EA's home-widget card.

If BOTH delivery surfaces are unavailable, the run completes with `status: 'partial'`. The briefing body is preserved in the run's `agent_runs.output` (existing column) so the operator can retrieve it from the Activity tab on next login. No `ea_drafts` row is created — `ea_drafts` is reserved for review-gated SENDS, not undelivered briefings.

### 16.4 Connection chip on `ConnectionsPage.tsx`

Per brief §3.16. The connection row component renders a small chip next to the connection name:

- **`Personal`** chip when `integration_connections.owner_user_id IS NOT NULL`.
- **`Subaccount`** chip when `integration_connections.owner_user_id IS NULL`.

Chip styling: small pill, neutral colour for `Subaccount` (default), accent colour for `Personal`. No emoji.

Visibility:
- Subaccount admin sees ALL subaccount-level connections (`owner_user_id IS NULL`) — Subaccount chip on each.
- Subaccount admin sees the requester's own Personal connections — Personal chip.
- Subaccount admin does NOT see OTHER users' Personal connections (predecessor §3.5 RLS).
- Owner user sees their own Personal connections + subaccount-level connections they have access to via existing role-based gates.

### 16.5 Connection-status visibility

Existing connection-status states (`connected` / `expired` / `revoked` / `error`) apply uniformly to Personal and Subaccount connections. The chip is orthogonal to status; both render on the row.


## 17. Capability grouping for the connection UI

This is a thin UI grouping layer over the existing capability taxonomy. NO new abstraction below the UI.

### 17.1 Existing taxonomy (unchanged)

- **Capability slugs** live in `docs/integration-reference.md` (read/write capability slugs with aliases). CI-enforced by `scripts/verify-integration-reference.ts`.
- **Per-agent capability map** lives in `subaccount_agents.capability_map` JSONB, computed by `capabilityMapService.ts`.
- **Backend-agnostic workspace adapter** is `WorkspaceAdapter` with backends `'synthetos_native'` and `'google_workspace'`.

### 17.2 New UI grouping file

`server/config/capabilityGroups.ts` declares 4 user-facing groups → existing capability slugs:

```
export const CAPABILITY_GROUPS = {
  email:     { label: 'Email',     slugs: ['inbox_read', 'email_body_read', 'send_email', 'modify_labels', 'classify_email'] },
  calendar:  { label: 'Calendar',  slugs: ['calendar_read', 'calendar_event_create', 'calendar_event_update', 'calendar_event_respond'] },
  files:     { label: 'Files',     slugs: ['page_read', 'spreadsheet_read'] },
  team_chat: { label: 'Team chat', slugs: ['channel_messages_read', 'channel_post_message', 'channel_search_messages', 'dm_send'] },
} as const;
```

CI gate: existing `scripts/verify-integration-reference.ts` is extended (or a new sibling script) to validate that every slug in `CAPABILITY_GROUPS` exists in the integration-reference taxonomy. Architect picks Phase 2 (extend existing or add sibling).

### 17.3 New capability slugs introduced by EA V1

The existing integration-reference covers Gmail + Drive; V1 adds capability slugs for Calendar + the new Slack actions in `docs/integration-reference.md`:

- `calendar_read` (Google Calendar)
- `calendar_event_create` (Google Calendar)
- `calendar_event_update` (Google Calendar)
- `calendar_event_respond` (Google Calendar)
- `channel_messages_read` (Slack — new)
- `channel_post_message` (Slack — new)
- `channel_search_messages` (Slack — new)
- `dm_send` (Slack — new)

### 17.4 Wizard rendering

The first-run wizard renders 4 capability cards (Email, Calendar, Files, Team chat). Each card surfaces providers that declare any of the group's slugs (today: Gmail under Email; Google Calendar under Calendar; Google Drive under Files; Slack under Team chat). Future providers (Outlook → Email + Calendar; Notion → Files; Microsoft Teams → Team chat) plug into the wizard automatically by declaring slugs in `integration-reference.md`.

### 17.5 Slug visibility

Users NEVER see raw capability slugs in the wizard. Operators / system admins see them on the Connections page (existing) and in agent capability-map debug surfaces (existing).


## 18. Live-fetch vs canonical decision

The codebase supports both paths via `readPath: 'liveFetch' | 'canonical'` on each action. EA V1 makes the decision explicit per data category.

### 18.1 Live-fetch (no canonical storage)

| Data | Why |
|---|---|
| Email content (bodies, threads, headers) | Storage cost (GB per user); privacy escalation; no V1 use case requires cross-source SQL. Existing `read_inbox` is already live-fetch. |
| Calendar event content | Same. |
| Drive file content | Existing read-only resolver. |
| Slack message content | Same. |

### 18.2 Canonical (persisted to SynthetOS)

| Data | Reason |
|---|---|
| `voice_profiles.profileJson` (derived features) | Feature-level summary, small, valuable persistence; opt-out enforced. |
| `memory_blocks` (per-agent user context) | Already canonical (existing primitive). |
| Run Trace + run history | Already canonical (foundation primitive). |
| `ea_drafts` (draft payload + send state for proposed outbound actions) | Needs to survive across sessions; the proposal primitive's row tracks approval state, `ea_drafts` tracks the draft payload + send state. Small (~10 cols), indexed by `(organisation_id, owner_user_id, sendState)` + `(proposalId)` for the JOIN. |
| External-event dedup ledger (option per §24.1) | Needed for trigger idempotency. Small. |

### 18.3 Out of scope (explicitly NOT built)

- Inbox ingestion / sync jobs (NO).
- Calendar event mirror table (NO).
- File content cache (NO).
- Cross-source unified search index (NO).

Defer to Phase 1.5 IF a real use case requires cross-source SQL (Revenue Ops Assistant uses canonical for invoices because invoice reconciliation needs it; EA V1 has no equivalent need).

### 18.4 Implication for the architect

The plan.md must call out that "no inbox/calendar/file/slack mirror" is a binding constraint — if a chunk's implementation looks like it's mirroring, that's a deviation and the architect/builder must escalate.


## 19. Home-widget contribution contract

Generic primitive enabling any user-owned agent template to contribute a card to the home Personal zone (§14.2). Designed for reuse by Dev Agent (Phase 3), future personal-research agents, etc.

### 19.1 Declaration on the system_agent template

Per §7.6. `home_widget: HomeWidgetDeclaration | null` on the system_agent row.

EA's declaration (per §13.1):
```
{
  type: 'summary_card',
  titleTemplate: '${agent.displayName}',
  bodyProviderSkill: 'ea.home_widget.summary',
  refreshPolicy: 'on_login'
}
```

`null` value on a template = the agent does not surface to the home Personal zone. Most existing subaccount-owned agents (Sarah / Johnny / etc.) have `null` — they don't surface to USER home zones because they aren't user-owned.

### 19.2 Home zone rendering

`server/services/homeWidget/homeWidgetService.ts`:

1. Read `agents WHERE owner_user_id = current_user.id AND organisation_id = current_org_id` (org-wide per §6.2.1 — do NOT add a `subaccount_id` predicate; the EA is visible across all subaccounts the user has access to within the org).
2. For each agent, look up the `home_widget` declaration on the linked `system_agent_id` row.
3. Skip agents with `home_widget = null`.
4. For each remaining agent, invoke the `bodyProviderSkill` via existing skill-invocation primitive. The skill returns a `WidgetData` value matching the declared `type`.
5. Aggregate into an ordered `Array<{ agentId, agentName, widgetData }>`. Order: stable, sorted by `agents.createdAt ASC` (older agents first; in V1 most users have one).
6. Return as JSON to the client.

Errors from any individual skill invocation surface as a degraded card on the home zone — the card renders with a single line "Status unavailable" and a refresh button. Other agents' cards render normally.

### 19.3 Refresh policy semantics

- `on_login` (EA's default) — refetch when the home page is mounted (route entry). The `useHomeWidgets()` hook is invalidated on auth state change / route navigation.
- `every_5m` — periodic refetch every 5 minutes while the home page is open. Used by future agents whose data changes frequently.
- `on_demand` — refetch only when the user clicks a refresh button on the card. Used for agents whose data is expensive to compute.

Per CLAUDE.md async-polling cadence guidance: `every_5m` should be the minimum frequency for periodic refresh; sub-5-minute cadences are NOT supported in V1 because there's no use case for them.

### 19.4 EA's body provider skill

`server/skills/ea-home-widget-summary.md` (skill slug `ea.home_widget.summary`). Returns:

```
{
  type: 'summary_card',
  primaryLine: '<latest briefing one-liner, or "No briefing yet — first briefing tomorrow at 07:00">',
  secondaryLines: [
    '<draftCount> drafts awaiting review',
    'Next: <next meeting prep summary, or "No upcoming meetings">'
  ],
  badgeCount: <draftCount>,
  openLink: '/personal/<agentId>'
}
```

Implementation: live-fetch drafts-awaiting-review count via the proposal primitive's "open proposals for owner = current user where the linked agent is this EA" query (count of `proposalRow.state = 'pending'`); latest briefing (search recent `agent_runs` for this agent with `triggerContext.eventType = scheduledTask of daily_briefing`); upcoming `calendar_event_imminent` queue. NO LLM call — pure data read. Run cost: zero.

### 19.5 Frame component

`client/src/components/personal/PersonalZoneCard.tsx` is the single frame component. It renders any `WidgetData` type into a consistent visual shell per the locked mockup. Agents return data ONLY — no markup, no HTML, no styles. This prevents agents from polluting the home page with arbitrary rendering.

Per `docs/frontend-design-principles.md`: visuals as simplicity, status dot inline on title, badge for draft count, one primary action (Open → per-agent detail page).

### 19.6 Future widget types

`type` field is an open enum extensible per spec change. V1 ships `summary_card` (and reserved-but-unused `queue_card` + `metric_card` per §7.7). Adding a new type requires:

1. Append type to `shared/types/homeWidget.ts` `HomeWidgetType` union.
2. Define `WidgetData` shape for the new type in the same file.
3. Extend the frame component to render the new type.
4. Spec-amendment to document the new type.

V1 does NOT ship `queue_card` or `metric_card` (no agent uses them in V1). They're reserved in the type system to make the future addition smaller.


## 20. Failure modes for triggered runs

Four failure classes per brief §3.21. Each must have a defined behaviour, NOT a silent failure.

### 20.1 Auth-expired credential mid-run

**Trigger**: broker returns `revoked` / `expired_refresh_token` typed error.

**Behaviour**:
1. Run fails with `errorMessage = 'CREDENTIAL_REVOKED'` (or `EXPIRED_REFRESH_TOKEN`).
2. Connection status flipped to `expired` via existing `integration_connections.status` enum (predecessor's existing flow).
3. EA emits `notify_operator` with severity `warning` and a deep link to re-connect.
4. Trigger emits `trigger.suppressed` with reason `credential_unavailable` for subsequent triggers until the connection is restored.
5. The EA's home-widget card surfaces "Connection issue — click to reconnect" replacing the briefing one-liner.

Skipped runs visible in the EA's Run Trace view (existing surface). No silent retry.

### 20.2 External API timeout / 5xx

**Trigger**: action handler hits Google / Slack 5xx or timeout.

**Behaviour**:
1. Retry per the action's `retryPolicy: 'guarded'` (existing pattern).
2. If retries exhausted AND the run is a triggered briefing (daily / inbox / meeting prep): emit `workflow.partial` with the sources that DID succeed and a "data unavailable" line for sources that didn't. Briefing still posts.
3. If retries exhausted AND the run is a write action invocation: emit `workflow.failed`. The originating `ea_drafts` row (which already exists — the write was draft-mediated per §11.6) transitions `sendState → 'send_failed'`; the linked proposal row remains `approved` (the approval was valid; only the send failed). The Workspace tab's Drafts UI shows it under a "Retry needed" section with a single re-attempt button that resets `sendState → 'sending'` and re-runs the send path. No new `ea_drafts` row is created — the existing row is the retry record.

**Best-effort partial output** is the read-heavy pattern. Per `docs/spec-authoring-checklist.md §10.5`: status MUST be `partial` (not `success`) when any source is unavailable.

### 20.3 Rate-cap suppression

**Trigger**: `MAX_TRIGGERED_RUNS_PER_MINUTE` or `MAX_EXTERNAL_TRIGGERED_RUNS_PER_MINUTE_PER_OWNER` exceeded.

**Behaviour**:
1. Existing trigger-service pattern logs and skips. `trigger.suppressed` event with reason `rate_capped` written.
2. NEW behaviour for EA V1: when daily suppression count exceeds an operator-configurable threshold (default `10 / 24h`), the EA emits `notify_operator` with severity `warning` and a "degraded state" indicator on the home-widget card. Threshold is a memory_block (`key = 'ea.suppression_alert_threshold'`).

This is "no silent partial success" applied to suppression — the operator learns when their EA is being throttled.

### 20.4 Approval timeout

**Trigger**: Tier 6 send drafted, no human approval within 24 hours.

**Behaviour**:
1. Existing `workflowGateStallNotifyJob.ts` handles this.
2. The job sends a one-time reminder at 24h.
3. At 7 days (default expiry on the proposal row), the PROPOSAL row transitions to `expired`. The linked `ea_drafts` row's `sendState` remains `idle` and is hidden from the Workspace tab. Expiry is owned by the proposal primitive, NOT `eaDraftService`.
4. Expired drafts are visible in the Workspace tab under a separate "Expired" section (one click to re-create the draft from the underlying source mail or calendar event).

No silent stale drafts. Every state transition is visible in Run Trace.

### 20.5 Misc failure classes

- **Voice profile derivation failure** — Gmail sent box empty or sampler fails. Behaviour: voice_profile row stays in initial state; settings page shows "Derivation failed, retry available". Workflows continue without voice block (system prompt's "no voice profile configured" branch).
- **Calendar lookahead scan failure** — Google rejects the `events.list` call (auth, 5xx beyond retry budget). Behaviour: the per-connection advisory-locked job records the failure via `notify_operator` with severity `warning`; subsequent scans retry per existing pg-boss retry config. Meeting prep notifications may miss the 15-minute lookahead window during the outage; runs that should have fired are not retroactively triggered (acceptable per pre-production framing).
- **Slack workspace plan downgrade** (loses `search:read` mid-deployment) — `slack.search_messages` returns `PLAN_NOT_SUPPORTED`. Behaviour: workflow falls back to the search-less path (the daily briefing reads recent Slack mentions via channel reads only, no global search). Operator sees a notice on the settings page.

### 20.6 Visibility

All five failure paths surface in:
- The EA's Run Trace view (existing surface).
- The home-widget card's secondary line (degraded-state hint).
- The Workspace tab's empty/error state UI.

No failure is silent.


## 21. Permissions and RLS checklist

Per `docs/spec-authoring-checklist.md §4`, every new tenant-scoped table needs: RLS policy + RLS_PROTECTED_TABLES entry + route guard + principal-scoped context. EA V1 introduces three new tenant-scoped tables (`voice_profiles`, `ea_drafts`, `external_trigger_dedup`). `webhook_channel_registrations` is deferred to V1.5 per §7.8.

### 21.1 `voice_profiles`

- **Schema** (REQ-C4 amended — no `name` column; `source` replaced by `sources text[]`; `source_config` collapses into a single caller-shaped jsonb): `(id, organisation_id NOT NULL, owner_user_id NULLABLE, subaccount_id NULLABLE, org_scope BOOLEAN, sources text[] NOT NULL, source_config jsonb NOT NULL DEFAULT '{}', profile_json jsonb, sample_size int, last_derived_at timestamptz, refresh_policy text, refresh_config jsonb NOT NULL DEFAULT '{}', opt_out_at timestamptz, state text, created_at, updated_at)`. CHECK: exactly one of `(owner_user_id IS NOT NULL)`, `(subaccount_id IS NOT NULL)`, `(org_scope = true)`. CHECK: `refresh_policy IN ('manual', 'periodic')` for V1 inserts (the `'on_send_count'` enum value is reserved; the schema enum CAN hold it but the write API rejects it until a future spec activates). CHECK: every element of `sources` is in the V1 allowlist (`'gmail_sent_sampler'`, `'drive_doc_sampler'`); the `'manual'` element is deferred per §26.
- **RLS policy** (in the table-creation migration):
  - Owner clause: `owner_user_id IS NULL OR owner_user_id = current_setting('app.current_user_id')::uuid`
  - Subaccount clause: `subaccount_id IS NULL OR subaccount_id = ANY(current_setting('app.current_subaccount_ids')::uuid[])`
  - Org scope: `org_scope = false OR organisation_id = current_setting('app.current_org_id')::uuid`
  - Admin clause: `current_setting('app.current_role')::text IN ('org_admin', 'subaccount_admin')` — admins see ROWS, but API serialisation (per predecessor §3.6) redacts `profile_json` content for non-owners and surfaces only metadata (`sources`, `lastDerivedAt`, `state`, `optOutAt`, `refreshPolicy`, `sampleSize`; REQ-C4 shape — no `name` column, no scalar `source`). `sourceConfig` is ALSO redacted from non-owners (it may carry per-sampler scoping hints — e.g. specific Drive doc ids — that are private to the owner; consistent with §12.7). This implements the §12.7 "admins see metadata, not content" policy.
  - Combined: a row is visible if (it's user-owned by the requester) OR (it's subaccount-owned and the requester has access to that subaccount) OR (it's org-scoped and the requester is in the org) OR (the requester is an org/subaccount admin). FORCE RLS enabled.
- **RLS_PROTECTED_TABLES entry**: ADD.
- **Route guard**: `server/routes/voiceProfiles.ts` — `authenticate` + `requirePermission('VOICE_PROFILE_READ' | 'VOICE_PROFILE_WRITE')` (NEW permission keys; architect adds to `server/lib/permissions.ts`).
- **Principal-scoped context**: agent execution path resolves the profile by `voice_profile_id` on the agent config; broker-style assertion `profile.owner_user_id === agent.owner_user_id` (or matches the subaccount/org scope) before consumption. Mismatch → typed `VOICE_PROFILE_OWNERSHIP_MISMATCH` and the prompt assembles without voice block.

### 21.2 `ea_drafts`

- **Schema**: per §7.5.
- **RLS policy**: `owner_user_id = current_setting('app.current_user_id')::uuid OR current_setting('app.current_role')::text IN ('org_admin', 'subaccount_admin')`. The admin path serves the redaction layer at API serialisation — admins see metadata only, content (`body` JSONB) redacted.
- **RLS_PROTECTED_TABLES entry**: ADD.
- **Route guard**: `server/routes/eaDrafts.ts` — `authenticate` + `requirePermission('EA_DRAFT_READ' | 'EA_DRAFT_DECIDE')` (NEW permission keys).
- **Principal-scoped context**: draft creation only happens inside an agent run that has `owner_user_id` set; the run's owner context flows to the draft. Approval is owner-only in V1 (the `decidedByUserId` must equal the draft's `owner_user_id`).

### 21.3 `external_trigger_dedup`

- **Schema**: `(provider text NOT NULL, dedup_key text NOT NULL, owner_user_id uuid NOT NULL, organisation_id uuid NOT NULL, subaccount_id uuid NOT NULL, fired_at timestamptz NOT NULL DEFAULT now(), trigger_id uuid, run_id uuid, PRIMARY KEY(provider, dedup_key, owner_user_id))`. The composite PK is the dedup key per §7.1.
- **RLS policy**: `owner_user_id = current_setting('app.current_user_id')::uuid OR current_setting('app.current_role')::text IN ('org_admin', 'system_admin')`. Webhook handlers and trigger dispatch run as admin connection per existing pattern.
- **RLS_PROTECTED_TABLES entry**: ADD.
- **Route guard**: None directly via HTTP — the table is read/written by webhook ingestion + trigger dispatch (admin connection). No user-facing route.
- **Principal-scoped context**: writes happen inside webhook ingestion (admin context); reads happen inside trigger dispatch (admin context); user-facing surfaces never read this table.

### 21.4 Tables NOT scoped (intentional opt-outs)

None. All three new tenant-scoped tables follow the standard pattern. The new `system_agents.home_widget` jsonb column is on a system-wide reference table (no tenant axis); no RLS implication.

### 21.5 Permissions added

New permission keys in `server/lib/permissions.ts`:

| Key | Default role-grant | Purpose |
|---|---|---|
| `VOICE_PROFILE_READ` | every user (their own) | Read voice profiles via the voiceProfiles route |
| `VOICE_PROFILE_WRITE` | every user (their own) | Refresh / opt-out / re-activate |
| `EA_DRAFT_READ` | every user (their own) | Read drafts via the eaDrafts route |
| `EA_DRAFT_DECIDE` | every user (their own) | Approve / reject drafts |
| `HOME_WIDGET_READ` | every user | Read home-widget data |
| `EA_PROVISION` | every user | Provision an EA via the first-run wizard |

Each key adds an `ALL_PERMISSIONS` entry. Existing `ORG_PERMISSIONS` cover admin redaction; no new admin-only keys.

### 21.6 Connection RLS (PREDECESSOR-OWNED)

`integration_connections.owner_user_id` RLS clause is owned by the predecessor. EA V1 only consumes the predecessor's policy. If the predecessor's RLS policy is later revised, EA V1 inherits the change.

### 21.7 Run Trace + memory_blocks RLS (PREDECESSOR-OWNED)

Same — predecessor owns the user-owned admin-redaction policy for `agent_runs` content and `memory_blocks`. EA V1 honours the policy by ensuring API serialisers (Run Trace endpoint, memory-blocks endpoint) consult the existing `agentRunEditPermissionMaskPure` primitive and extend it with the user-ownership column rule.

### 21.8 Defence-in-depth invariants (binding)

- Every action handler asserts `agent.owner_user_id === broker.resolved_connection.owner_user_id`. Mismatch → typed error, run fails closed.
- Every API serialiser that returns content for a user-owned row checks the requester's id against the row's `owner_user_id`. Mismatch → content redacted (admins) or 403 (other users).
- Every cross-tenant route extending into EA V1 surfaces routes through existing `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh` CI gates.


## 22. Execution model

Every new code path picks ONE execution model per `docs/spec-authoring-checklist.md §5`. EA V1 mixes inline + queued + cached patterns; this section pins which is which.

### 22.1 Inline / synchronous

- **OAuth callback** (`/oauth/callback/google_calendar`) — existing route, sync.
- **`voiceProfiles` API endpoints** (read / refresh / opt-out) — sync for read + opt-out; refresh enqueues a job and returns immediately (queued semantics; see below).
- **`eaDrafts` API endpoints** — sync. The list/get endpoints JOIN draft previews (`ea_drafts.body` + target metadata) against the linked proposal row's approval state (looked up via `ea_drafts.proposalId`). The decide endpoint **proxies** approve/reject decisions to the linked proposal primitive's decide surface (`actionService.proposeAction`); the proposal primitive's commit hook then invokes the underlying action handler (the send path). `eaDraftService` owns draft payload + post-approval send state only, not approval state — there is no `eaDraftService.approve`, no parallel approval state machine on `ea_drafts`, and no inline approval logic on the route. Send-state transitions live on `ea_drafts.sendState` per §24.3.
- **`agentHomeWidgets` API endpoint** — sync. Aggregates current widget data via `homeWidgetService.getWidgets`.
- **Webhook ingestion route** (extended `slackWebhook` only in V1) — sync entry. V1's two active payload types are (a) the existing `block_actions` approval callback (which dispatches inline through the existing HITL approval primitive) and (b) the new `url_verification` handshake (which returns the `challenge` synchronously). The `event_callback` / `app_mention` payload type is received but no-op'd in V1 — it does NOT dispatch into `triggerService.fireTriggers` (that path lands in V1.5 alongside Workflow #4 per §10.2 + §26). The HTTP response returns 200 quickly per webhook best-practice in all three cases. `googleWebhook.ts` is not shipped in V1 (deferred to V1.5 per §5.3 / §7.8 / §10.2).
- **Agent action handlers** — sync within an agent's execution context. The agent run itself is async (existing pattern).

### 22.2 Queued / asynchronous (pg-boss)

- **`gmailInboxPollJob`** — recurring every 5 min per connected Gmail account. Per §10.4.
- **`calendarLookaheadJob`** — recurring every 1 minute per connected Calendar account. Per §10.5.
- **`voiceProfileRefreshJob`** — recurring nightly; processes profiles whose refresh threshold has been triggered.
- **EA agent runs** — triggered by §6.4 Type A/B/C; existing pattern (run enqueued by trigger or schedule, processed by `agent-scheduled-run` queue).
- **First-run setup wizard background tasks** — voice-profile initial derive enqueued after wizard completion.
- **`workflowGateStallNotifyJob`** — existing job, handles `ea_drafts` stall notifications + 7-day expiry.

Queued-job idempotency is provided by the per-job advisory locks named in §24.4 / §24.5 (Gmail poll, Calendar lookahead) + the `external_trigger_dedup` table (trigger-event idempotency). No new "job idempotency table" is created — V1 reuses existing pg-boss singleton-job semantics (job key uniqueness) layered with explicit dedup primitives per concern.

### 22.3 Cached / prompt-partition

- **Voice profile block** in agent prompts — placed in `stablePrefix` cache partition per §12.4. Cache window is the refresh interval (V1 default: 30 days under the `periodic` policy).
- **EA system prompt** — placed in `stablePrefix`. Changes only when the system_agent template's `default_system_prompt` is updated (rare).
- **EA default skill allowlist** — `stablePrefix`.
- **EA per-instance memory_blocks** — `stablePrefix` for unchanging blocks (timezone, working hours); `dynamicSuffix` for blocks edited per session (active context).
- **Trigger context** — `dynamicSuffix`. Changes per run.
- **Live-fetched data** (inbox / calendar / Slack at run time) — `dynamicSuffix`. Changes per run.

No partition contradictions. Goals NOT claimed: no specific cache-hit-rate target (per `docs/spec-context.md` `performance_baselines: defer_until_production`). Cache behaviour is best-effort; degraded cache-hit does not fail the run.

### 22.4 Cross-cutting constraints

- **No new long-running processes.** Every EA run is short, deterministic (terminates in seconds-to-minutes).
- **No new always-on workers.** Existing pg-boss handles all queued work.
- **No new pub/sub topics** in V1 (V1.5 may add Gmail Watch + Pub/Sub).
- **No new in-memory caches.** All caches go through existing primitives (prompt cache via cache partitions; React-Query on client; DB advisory locks for single-writer guarantees).

### 22.5 Latency budgets (informational, not binding)

Per `docs/spec-context.md` `performance_baselines: defer_until_production`, no formal latency budgets. Informally:

- Daily briefing run: target <30s end-to-end (read + compose + post).
- Inbox triage run per message: target <15s.
- Meeting prep run: target <45s (read-heavy).
- Webhook ingestion → 200 ack returned: target <3s (Slack's hard requirement; Google more forgiving). Trigger-fired dispatch is async after the ack — the ack returns as soon as signature + dedup-key checks pass, before the trigger run is enqueued.
- First-run setup wizard completion: target <2s for the user-visible action; voice-profile derivation enqueued async.

These are operational targets, not contracts. Phase 2 architect MAY tighten or relax in plan.md.


## 23. Phase sequencing dependency graph

Single-phase build per §4. The dependency graph below is for chunk ordering INSIDE the build, consumed by the Phase 2 architect when authoring `plan.md`.

### 23.1 Predecessor dependency (BLOCKING)

`user-owned-agents` (foundation primitive) MUST reach MERGED before Phase 2 BUILD authoring begins.

Predecessor delivers:
- `agents.owner_user_id` column + index + RLS.
- `agent_runs.owner_user_id` column + index.
- `integration_connections.owner_user_id` column + index.
- `CredentialBrokerService.injectIntoEnvironment({ ownerUserId? })` extension.
- Admin redaction policy + typed audit event `owner.content_revealed`.
- RLS clauses for user-owned visibility.
- Master brief §5.1 + §9 doc updates.

EA V1 spec assumes ALL of these are merged. If predecessor changes shape during its own Phase 2/3, EA V1 spec adjusts.

### 23.2 Chunk topological order (recommended)

Architect in Phase 2 finalises. Recommended ordering (foundations first, integration second, UI last):

**Chunk group A — Migrations + shared types** (must land before action / service work):
1. `voice_profiles` table + RLS + manifest entry.
2. `ea_drafts` table + RLS + manifest entry.
3. `agent_triggers.event_type` enum extension + `external_trigger_dedup` table + RLS + manifest entry (single migration: `NNNN_external_source_triggers.sql`).
4. EA system_agent seed migration (slug + name + template config + adds `home_widget jsonb` column to `system_agents`).
5. Shared types files (`homeWidget.ts`, `eaDraft.ts`, `voiceProfile.ts`, `externalSourceTrigger.ts`, `calendarAction.ts`, `slackAction.ts`).

**Chunk group B — OAuth provider + action registry** (depends on A.3 enum extension if any action references new event types):
6. `google_calendar` OAuth provider entry + Slack scope additions in the same `oauthProviders.ts`.
7. 6 Calendar action rows + Zod schemas + handler skeleton in `calendarActionService.ts`.
8. 6 Slack action rows + Zod schemas + handler skeleton in `slackActionService.ts`.
9. Calendar action handlers (full body) + pure helpers.
10. Slack action handlers (full body) + pure helpers.
11. `capabilityGroups.ts` + integration-reference slug additions.

**Chunk group C — External-source trigger primitive** (depends on A.3 + B.6):
12. `externalSourceTriggers.ts` service + pure helpers.
13. `slackWebhook.ts` extension — URL-verification handshake only in V1 (so the Slack-app Events-API subscription can be configured at install time). `event_callback` / `app_mention` dispatch is deferred to V1.5 per §10.2; the V1 builder MUST NOT wire `app_mention` into `externalSourceTriggers`.
14. `gmailInboxPollJob.ts` + advisory-lock infra.
15. `calendarLookaheadJob.ts` + advisory-lock infra (replaces the prior Calendar push design — `googleWebhook.ts` is deferred to V1.5 per §5.3 / §7.8 / §10.2).

**Chunk group D — VoiceProfile primitive** (depends on A.1):
16. `voiceProfileService.ts` + pure helpers + samplers.
17. `voiceProfileRefreshJob.ts`.
18. Prompt-assembly extension for `<voice>` block.
19. `voiceProfiles.ts` API route.

**Chunk group E — EA drafts** (depends on A.2):
20. `eaDraftService.ts` + pure helpers (state machine).
21. `eaDrafts.ts` API route.

**Chunk group F — EA system-agent template + workflows** (depends on A.4 + B + C + D + E):
22. `c.ts` entry + template DB seed row body (skill allowlist, default approval policy, system prompt, home_widget declaration).
23. Three workflow skill markdown files (`ea-daily-briefing.md`, `ea-inbox-triage.md`, `ea-meeting-prep.md`) — the workflow bodies live entirely in these files; no separate workflow-module .ts files in V1.
24. Auto-send-scope decision integration on Slack post handlers (depends on B.10).

**Chunk group G — Home widget contract** (depends on A.4 + F.22):
25. `homeWidgetService.ts` + pure helpers + `ea-home-widget-summary.md`.
26. `agentHomeWidgets.ts` API route.
27. `shared/types/homeWidget.ts` types (already in A.5).

**Chunk group H — UI surfaces** (depends on B + C + D + E + F + G + predecessor's UI hooks):
28. `useUserOwnedAgents.ts` + `useHomeWidgets.ts` + `useVoiceProfile.ts` + `useEADrafts.ts` hooks.
29. `sidebar.ts` extension (Personal nav group).
30. `routes.ts` extension (`/personal/:agentId`, `/personal/setup`, `/personal/:agentId/setup`).
31. `PersonalAssistantPage.tsx` (tabbed shell).
32. `PersonalZoneCard.tsx` frame component.
33. `EAFirstRunWizard.tsx` (wizard).
34. `HomePage.tsx` extension (Personal zone rendering).
35. `ConnectionsPage.tsx` chip + capability-group rendering.

**Chunk group I — Doc-sync + final checks**:
36. `architecture.md` updates (external-source trigger, VoiceProfile, home-widget contract, Personal nav, capability grouping).
37. `docs/capabilities.md` additions (vendor-neutral language per editorial rules).

(Note: `docs/integration-reference.md` Calendar + new Slack slug additions land in chunk B.11 alongside `capabilityGroups.ts`, NOT in terminal doc-sync — the static gate `verify-integration-reference.ts` runs against B.11 in CI, so the slugs must exist before B.11 ships. The chunk-I doc-sync sweep only updates wording in `integration-reference.md` post-merge if needed.)

Total estimated chunks: ~37. Architect MAY merge or split per implementation cost.

### 23.3 No backward references

Every chunk's "introduced by" set is in an EQUAL-OR-EARLIER chunk group. Verified manually:
- B (actions) references A (types + enum) — OK.
- C (triggers) references A + B — OK.
- D (voice) references A — OK.
- E (drafts) references A — OK.
- F (template + workflows) references A + B + C + D + E — OK. F.23 (template seed) introduces the `home_widget` jsonb column reflected in A.5 + the modified `systemAgents.ts` schema.
- G (home widget) references A + F — OK.
- H (UI) references all — OK.
- I (docs) — terminal.

### 23.4 No orphaned deferrals

The "Deferred Items" section (§26) is the single source of truth for everything in prose marked "deferred", "later", "Phase 1.5", "future", "not in this phase". Phase 2 architect re-verifies before locking plan.md.

### 23.5 No phase-boundary contradictions

Single phase; no boundary to contradict.


## 24. Execution-safety contracts

Per `docs/spec-authoring-checklist.md §10`. Every externally-triggered write and state machine pins its idempotency posture, retry classification, concurrency guard, and terminal events.

### 24.1 External-event dedup

**Producer:** webhook ingestion + Gmail polling. **Consumer:** `triggerService.fireTriggers`.

- **Posture:** key-based.
- **Key:** `(provider, dedup_key, ownerUserId)`. Deterministically derived by `externalSourceTriggersPure.deriveDedupKey` per event type per REQ-T8: Gmail = `messageId`; Calendar = `'{calendarEventId}@{startAt}@{minutesUntilStart}'`; Slack = `'{channelId}@{messageTs}'` (see §7.1).
- **Mechanism:** `external_trigger_dedup` table with `UNIQUE(provider, dedup_key, owner_user_id)` constraint + insert-with-conflict semantics. Created in `NNNN_external_source_triggers.sql` alongside the enum extension (see §5.1). Rationale: explicit dedicated table is clearer than a JSONB partial index on `agent_runs.triggerContext`, avoids JSONB-index quirks, and decouples dedup from run-row lifecycle.
- **Idempotency guarantee (O1 amendment 2026-05-13).** At-most-once **admission** per dedup key: the `INSERT ... ON CONFLICT DO NOTHING` on `external_trigger_dedup` admits each `(provider, dedup_key, ownerUserId)` at most once; a duplicate event is suppressed before `triggerService.fireTriggers` is invoked. The prior wording "exactly-once dispatch" overclaimed end-to-end — a process crash between the dedup-row insert and run-row creation breaks the chain (no compensating cleanup; the dedup row remains, so a retry sees `dedup_hit` and the would-have-fired run never lands). Downstream **execution** beyond admission remains at-least-once / effectively-once via existing per-action idempotency contracts (§24.2 for Calendar writes; `client_msg_id` for Slack posts; `ea_drafts.sendState` claim-cycle for drafted sends). Operationally: dedup admission is the boundary that matters for "EA won't run twice on the same Gmail message"; per-action idempotency is the boundary that matters for "the Slack post won't double-publish."
- **Retry:** safe — replay of an already-admitted event is a no-op `trigger.suppressed` with reason `dedup_hit`.
- **HTTP mapping:** webhook handlers return 200 either way; the dedup is internal.

### 24.2 Calendar write actions

**`create_event`**:
- **Posture:** state-based via the originating `ea_drafts.sendState` + deterministic-property recovery for unknown-success outcomes (V1 invocation path is always draft-mediated; handler rejects calls without `eaDraftId` per §7.2 + §8.4).
- **Deterministic-property tag.** Every `events.insert` call carries a synthetic property `extendedProperties.private.ea_draft_id = <ea_drafts.id>`. This survives the round-trip — Google preserves `extendedProperties` on inserted events.
- **Concurrency guard + unknown-success recovery:**
  - On first send attempt: the proposal primitive has already approved the proposal (approval state on the proposal row); the action handler runs the commit hook. Optimistic predicate on the draft row — `UPDATE ea_drafts SET sendState = 'sending' WHERE id = $draft_id AND sendState = 'idle' RETURNING id`. Zero rows = a concurrent caller already in flight or already sent.
  - Winning caller calls `events.insert` once. On success, `UPDATE ea_drafts SET externalResultId = $google_event_id, sendState = 'sent' WHERE id = $draft_id RETURNING id` and emit `draft.sent`.
  - On UNKNOWN outcome (timeout, network failure before response, or DB write failure after Google ack): re-enter the handler with the same draft row. The recovery path is: `events.list?privateExtendedProperty=ea_draft_id=$draft_id&timeMin=$draft.created_at - interval '1h'`. If the search returns an event, treat it as the prior-attempt's result: record `externalResultId` and emit `draft.sent`. If the search returns nothing, the prior attempt did not commit — retry `events.insert`.
  - Two simultaneous handlers for the same draft are arbitrated by the `sendState = 'sending'` predicate; the losing caller polls until `sendState` transitions to `'sent'` or the lock is released by a stall handler (which resets `sendState → 'idle'` for a fresh claim).
- **No `requestId` parameter passed to Google.** Google Calendar's `events.insert` does not honour a `requestId` idempotency parameter; the prior version of this spec was wrong about that API surface.
- **Retry:** guarded — `retryPolicy: 'guarded'`. Withbackoff. Network 5xx retried automatically; 4xx mapped to typed errors. Retry after an unknown outcome uses the recovery path above before re-attempting `events.insert`. If retries exhaust without `externalResultId`, `sendState → 'send_failed'`; operator-driven manual retry from the Workspace tab re-enters the claim cycle.
- **HTTP mapping:** 409 → 422 with `code: 'conflict'`; 401 → 401 with `code: 'credential_revoked'`; 403 → 403 with `code: 'insufficient_scope'`. Draft-context error mappings per the REQ-CAL3-naming `DRAFT_NOT_*` family (per §8.4): `eaDraftId` absent or row missing → 404 `code: 'DRAFT_NOT_FOUND'`; `ea_drafts.ownerUserId !== ctx.ownerUserId` → 403 `code: 'DRAFT_OWNER_MISMATCH'`; linked proposal not approved → 422 `code: 'DRAFT_NOT_APPROVED'`; concurrent send already claimed (`sendState != 'idle'`) → 409 `code: 'DRAFT_SEND_IN_FLIGHT'`. The pre-amendment umbrella `code: 'missing_draft_context'` is REJECTED — handlers MUST emit one of the four per-state-machine codes.
- **Terminal events:** `action.completed` (success | partial | failed) — exactly one per action invocation.

**`update_event`**:
- **Posture:** state-based via the originating `ea_drafts.sendState` (V1 draft-mediated; handler rejects calls without `eaDraftId`) + `If-Match` ETag for the underlying Google call.
- **Predicate:** same claim-cycle as `create_event`; `If-Match: <eventEtag>` header on the Calendar `events.patch` call.
- **Concurrency guard:** Google returns 412 on stale ETag; our handler returns 409 with `code: 'stale_etag'` to the caller. Losing caller MAY retry with re-fetched ETag (caller-driven, not auto-retried).
- **Retry:** guarded.
- **HTTP mapping:** 412 → 409 with `code: 'stale_etag'`. Draft-context error mappings use the `DRAFT_NOT_*` family per §8.4 / `create_event` above (`DRAFT_NOT_FOUND` 404, `DRAFT_OWNER_MISMATCH` 403, `DRAFT_NOT_APPROVED` 422, `DRAFT_SEND_IN_FLIGHT` 409). Same other mappings as `create_event`. The pre-amendment umbrella `code: 'missing_draft_context'` is REJECTED.

**`respond_to_invite`**:
- **Posture:** state-based via the originating `ea_drafts.sendState` (V1 draft-mediated). Naturally idempotent against Google (last write wins).
- **Concurrency guard:** the `sendState` claim-cycle prevents duplicate Google calls; Google itself merges duplicate responses.
- **Retry:** guarded.
- **HTTP mapping:** standard. Draft-context error mappings use the `DRAFT_NOT_*` family per §8.4 / `create_event` above (`DRAFT_NOT_FOUND` 404, `DRAFT_OWNER_MISMATCH` 403, `DRAFT_NOT_APPROVED` 422, `DRAFT_SEND_IN_FLIGHT` 409). The pre-amendment umbrella `code: 'missing_draft_context'` is REJECTED.

### 24.3 EA draft send-state machine + approval-primitive composition

**Approval state lives on the proposal row, NOT on `ea_drafts`.** Per §7.5 composition lock. The `actionService.proposeAction` primitive owns: approval enum (`pending | approved | rejected | expired`), `decided_at`, `decided_by_user_id`, expiry handling (`workflowGateStallNotifyJob`), audit trail. This section pins ONLY the post-approval send-state machine that lives on `ea_drafts.sendState`.

`ea_drafts.sendState` enum: `idle | sending | sent | send_failed`.

**Valid transitions on `ea_drafts.sendState`:**
- `idle → sending` (when the proposal's commit hook claims a send via the optimistic predicate per §24.2; only after the proposal row reaches `approved`).
- `sending → sent` (with `externalResultId` set, on successful action completion).
- `sending → idle` (stall-timeout reset by `workflowGateStallNotifyJob` — re-entry path for unknown-outcome recovery).
- `sending → send_failed` (when retries exhaust without producing an external object).
- `send_failed → sending` (manual retry from the Workspace tab; new claim cycle).

**Forbidden transitions:**
- `idle → sent` directly (must go via `sending`).
- `sent → anything` (terminal; the row is the audit trail).
- Any send-state transition while the linked proposal row is NOT in approved state.

**Status set closure:** the enum is closed. Adding a new send-state value requires a spec amendment. Approval-state enum closure is owned by the proposal primitive's own spec.

**Concurrency:**
- Two concurrent send-claims for the same draft → first commit wins via optimistic predicate `UPDATE ea_drafts SET sendState = 'sending' WHERE id = $1 AND sendState = 'idle'`. Losing caller polls or returns the winning send state.
- Two concurrent approval calls on the proposal row are handled by the proposal primitive (NOT this spec's concern).

**Terminal events on `ea_drafts`:**
- `draft.created` (info) at row insertion (paired with the proposal row's own creation event).
- `draft.sending` (info) on `sendState → sending` claim.
- `draft.sent` (info) on `externalResultId` set + `sendState → sent`.
- `draft.send_failed` (warning) on `sendState → send_failed`.

Approval-side terminal events (`proposal.approved`, `proposal.rejected`, `proposal.expired`) are emitted by the proposal primitive, not by `eaDraftService`. The per-agent Workspace tab UI displays both sets in a single timeline.

`draft.sent` fires at most once per draft.

### 24.4 Gmail polling

**Posture:** state-based.
- **Predicate:** advisory-lock on `('gmail_poll', integration_connection_id)`. Single-writer guarantee.
- **`last_history_id` update:** within the locked critical section; written only after all events for the tick have been dispatched (commit-cursor-last semantics — partial-tick failures roll back the cursor so the next tick re-reads the missed range).
- **Bootstrap (no `lastHistoryId`):** see §10.4 step 3 — seed baseline via `users.getProfile`; do NOT backfill historical mail; no triggers fire on this tick.
- **Cursor-expired recovery (Gmail `404` / `failedPrecondition`):** see §10.4's API-error contract — emit `trigger.suppressed` with reason `gmail_history_cursor_expired`; reseed baseline via `users.getProfile`; do NOT backfill the gap; continue forward on the next tick. No connection-status change.
- **Retry:** safe within the lock; lock release on success or failure. Next poll picks up where the prior poll's `last_history_id` left off (or from the newly-seeded baseline if a cursor-expired recovery just ran).
- **Race:** if two workers try to poll the same connection simultaneously, one wins the lock; the other returns immediately with no-op.

### 24.5 Calendar lookahead scan

**Posture:** state-based via advisory lock + dedup ledger.

- **Predicate:** advisory lock on `('calendar_lookahead', integration_connection_id)` arbitrates single-writer-per-connection across pg-boss workers. Within the lock, per-occurrence dedup against `external_trigger_dedup` (UNIQUE `(provider, dedup_key, owner_user_id)` per §24.1).
- **Concurrency:** if two workers try to run the lookahead for the same connection simultaneously, one wins the lock; the other returns immediately with no-op.
- **Retry:** safe within the lock; the dedup ledger prevents the same `(eventId, startAt)` occurrence from firing twice across retries.
- **Recurring events:** `events.list?singleEvents=true` expands recurring events to their per-occurrence rows; each occurrence has a distinct `eventId` (e.g. `eventId_20260513T140000Z`). The dedup key per §7.1 includes `startAt` so a re-scheduled occurrence (same `eventId`, different `startAt`) fires separately.

**No `webhook_channel_registrations` row state machine** — that primitive is deferred to V1.5 per §7.8.

### 24.6 Voice profile derivation

**Posture:** state-based via the `state` column added to `voice_profiles` per §7.4.
- **Predicate:** `UPDATE voice_profiles SET state = 'deriving' WHERE id = $1 AND state IN ('pending', 'ready', 'failed') RETURNING id`. Zero rows = derivation already in-flight; winner-takes-all.
- **Concurrency:** Two simultaneous `deriveProfile` calls for the same profile id — only one wins; the other returns the existing `profileJson` if `state = 'ready'`, or a typed `derivation_in_progress` error if `state = 'deriving'`.
- **Retry:** guarded. On failure, `state → 'failed'`; manual retry from Settings transitions back to `'pending'` and re-enters the deriveProfile flow.
- **Terminal events:** `voice.profile.derivation.started` (info) when state transitions to `'deriving'`; `voice.profile.derivation.completed` (info) on `'ready'`; `voice.profile.derivation.failed` (warning) on `'failed'`. These join the existing `voice.profile.refreshed` event in the criticality registry (§5.2 modified `shared/types/agentExecutionLog.ts`).

### 24.7 Voice profile consumption

**Posture:** state-based.
- **Predicate:** opt-out check at prompt-assembly time: `profile.optOutAt IS NULL`. Opted-out profile → prompt assembles without `<voice>` block.
- **Concurrency:** Opt-out toggled DURING a run that already started — the profile read happens at prompt-assembly time; subsequent toggles do not affect in-flight runs. Acceptable per `pre-production / rapid_evolution` framing.

### 24.8 Trigger uniformity terminal events

Per §10.7. Every triggered run emits exactly one of `workflow.completed | workflow.failed | workflow.partial` as the terminal event. The `trigger.fired` and `trigger.suppressed` events are NOT terminal — they pair with the run lifecycle events.

No event with the same `correlation_key` after the terminal. This is the existing Run Trace contract (foundation primitive).

### 24.9 Unique-constraint-to-HTTP mapping (table)

| Constraint | Likely violation source | HTTP mapping | Code |
|---|---|---|---|
| `voice_profiles` CHECK exactly-one-of | API write with bad shape | 422 | `voice_profile_invalid_scope` |
| `ea_drafts` race on send-claim | Two simultaneous send-claims | 409 | `DRAFT_SEND_IN_FLIGHT` (per REQ-CAL3-naming `DRAFT_NOT_*` family — case canonicalised to match §8.4 / §24.2; return current `sendState` alongside) — approval-race handling is owned by the proposal primitive |
| `integration_connections` UNIQUE on `(org, subaccount, owner_user_id, provider)` (PREDECESSOR) | Duplicate user connection | 409 | `connection_already_exists` |
| `external_trigger_dedup` PRIMARY KEY on `(provider, dedup_key, owner_user_id)` | Replay of external event (webhook or poll) | 200 (no-op for caller) | n/a |
| Any other `23505` | unexpected | 500 mapped to typed error envelope with correlationId | per `pre-launch-phase-2` envelope contract |

`23505` MUST NOT bubble as a 500 unmapped — every constraint above has a defined HTTP code.

### 24.10 Idempotency for HTTP webhook handlers

The webhook route (extended `slackWebhook` — V1's only webhook ingestion route) follows the existing pattern:
- HMAC verification per provider.
- Replay-nonce check via the existing `oauth_state_nonces` infrastructure (V1 reuses; no new nonce table).
- 200 response on success (Google + Slack treat 2xx as ack; both will retry on 5xx).
- 4xx response on signature/payload failure (no retry expected).


## 25. Testing posture

Per `docs/spec-context.md` (`testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`). EA V1 does NOT propose anything in the `none_for_now` / `defer_until_*` categories.

### 25.1 Static gates (primary, CI-enforced)

The following existing gates apply to every chunk and are non-negotiable:

- `verify-rls-coverage.sh` — every new tenant table (`voice_profiles`, `ea_drafts`, `external_trigger_dedup`) must appear in `RLS_PROTECTED_TABLES` with a matching RLS policy.
- `verify-rls-contract-compliance.sh` — no direct `db` import in user-facing routes; org-scoped reads via `getOrgScopedDb()` / `withOrgTx`; admin-context reads via `withAdminConnection`.
- `verify-risk-tier-assigned` — every new action in `actionRegistry.ts` has an explicit `riskTier`.
- `verify-integration-reference.ts` — capability slugs referenced from `capabilityGroups.ts` exist in `integration-reference.md`.
- `verify-pure-helper-convention.sh` — pure decision helpers live in `*Pure.ts` siblings; tests import the pure helper, not re-implement.
- `verify-test-quality.sh` — every new test uses **Vitest** with `expect()` API. NO `node:test`, NO `node:assert`, NO `tsx`-driven harnesses. Per `references/test-gate-policy.md` and the user's memory `feedback_test_runner.md`.
- Lint + typecheck (project-wide).

### 25.2 Pure helper unit tests (Vitest)

The following pure helpers are introduced and require Vitest unit coverage:

| Pure helper | What is tested |
|---|---|
| `externalSourceTriggersPure.deriveDedupKey` | Same inputs produce same key; differing inputs differ; key length deterministic. |
| `externalSourceTriggersPure.computeCalendarLookahead` | Returns true for events within lookahead window; false otherwise. |
| `calendarActionServicePure.validateCreateEventInput` (+ peers) | Accepts valid Zod input; rejects invalid with typed errors. |
| `calendarActionServicePure.deriveIdempotencyKey` | Deterministic key derivation. |
| `calendarActionServicePure.normaliseAttendees` | Dedup + lowercase + flag-preservation. |
| `calendarActionServicePure.computeFreeSlots` | Correct ranking; honours working-hours window; handles empty input. |
| `slackActionServicePure.decideAutoSendScope` | Returns `auto` / `review` per scope enum + action + target + ownerUserId + memberChannelIds. Test matrix: 3 scopes × 2 actions × 3 target types = 18 cases. |
| `slackActionServicePure.assembleThreadSummaryPrompt` | Renders messages + length into prompt string. |
| `voiceProfileServicePure.distilFeatures` | Deterministic feature extraction; counts greeting/signoff frequency; sentence-length stats; formality score; em-dash classification. |
| `voiceProfileServicePure.shouldRefresh` | Returns true when refresh threshold met; false otherwise. |
| `eaDraftServicePure.canTransition` | Returns `{ allowed: true }` for valid transitions; `{ allowed: false, reason }` for forbidden. |
| `eaDraftServicePure.computeExpiresAt` | Deterministic based on `createdAt + 7d`. |
| `homeWidgetServicePure.orderAgents` | Stable ordering by `createdAt ASC`. |
| `homeWidgetServicePure.shouldRefetch` | Returns true per refresh-policy semantics. |

Each helper lives in `*Pure.ts` and is tested via `*Pure.test.ts` sibling with Vitest `expect()`. NO mocks of internal services in these tests (pure functions only).

### 25.3 Integration test (one, narrow)

One integration test in the existing `rls.context-propagation.test.ts` style:

- `tests/integration/userOwnedAgentCredentialIsolation.test.ts` — exercises the broker's owner-scoping with the EA agent template. Two users in the same subaccount; each provisions an EA; each connects their own Gmail; the broker resolves credentials for User A's EA → returns User A's connection; for User B's EA → returns User B's connection; cross-fetch attempt → typed `OWNER_MISMATCH` error.

This test covers the most critical safety invariant from §15. Authored as a Vitest integration test against the existing Postgres-backed test infrastructure.

### 25.4 What is NOT in V1's test plan

- NO Playwright or other E2E tests against the app (`e2e_tests_of_own_app: none_for_now`).
- NO frontend component tests (`frontend_tests: none_for_now`).
- NO API contract tests via supertest or sibling (`api_contract_tests: none_for_now`).
- NO migration-safety integration tests (`migration_safety_tests: defer_until_live_data_exists`).
- NO performance baselines (`performance_baselines: defer_until_production`).

Per `docs/spec-context.md`, any deviation from this list is a framing finding and must be flagged in this section. None proposed.

### 25.5 Manual verification gates (operator-owned)

Phase 3 finalisation requires manual visual verification of the three locked mockups against the implementation. Documented in the handoff but not automated.

### 25.6 Test gate runner reminder

Test gates are CI-only per `references/test-gate-policy.md`. Local Vitest runs are scoped to the tests authored in THIS change via `npx vitest run <path>`. No `test:gates`, `test:qa`, `test:unit`, or `scripts/run-all-*` runs from the local session.


## 26. Deferred items

Per `docs/spec-authoring-checklist.md §7`. Anything mentioned in prose as "deferred", "later", "Phase 1.5", "future", "not in this phase" appears here. Single source of truth.

- **Calendar `delete_event` action.** V1 does not register this action. Tier 5 destructive. Defer to V1.5 once V1 write patterns prove reliable. Reason: not currently in `WorkspaceAdapter` capability surface; deferral creates no inconsistency.
- **Drive writes (Docs / Sheets editing).** Defer to V1.5 IF a real use case emerges. Reason: no V1 use case requires it; ~3 dev-days real cost (Docs / Sheets batch-update APIs); workspace adapter doesn't have these capabilities today.
- **Gmail push notifications (Watch API + Cloud Pub/Sub).** V1 ships 5-minute polling only — no Gmail push code path is shipped, flag-gated or otherwise. V1.5 may add Gmail push if the 5-minute polling latency becomes felt; the V1.5 spec will author the full Pub/Sub ingestion path at that time.
- **Workflow #4 — Slack thread summary on `slack_mention` trigger.** Enum value ships V1; the webhook handler (`app_mention` event_callback dispatch) AND the workflow body BOTH defer V1.5. V1 ships the slackWebhook url_verification handler for the Slack-app subscription setup but no-ops `app_mention` events. Skill slug `ea.slack_thread_summary`. Owner-routing rules (DM vs channel; ambiguous-mention suppression) authored in the V1.5 spec.
- **Generic, non-draft-mediated Calendar event creation.** V1 invocation path for `create_event` / `update_event` / `respond_to_invite` is always draft-mediated (handler rejects calls without `eaDraftId`). A future V1.5 may add either a generic `external_action_idempotency` table OR a direct-call idempotency record on a per-action basis to support non-draft callers. Today no such caller exists.
- **EA-V1-AD1 (`actionService.proposeAction` composition).** RESOLVED in this spec — `ea_drafts` composes over the proposal primitive per §7.5 + §11.6 + §24.3. Phase 2 architect verifies the primitive's contract supports a per-domain payload reference at plan-authoring time. If the existing primitive cannot accept the FK shape, the architect escalates back to the spec for revision — implementation does NOT proceed with a parallel state machine.
- **Workflow #5 — Weekly review (Friday 16:00 cron + Slack DM).** Skill slug `ea.weekly_review`. RRULE seeded in V1.5.
- **Calendar conflict detection + automated reschedule.** Fast follow-on, NOT V1.
- **Expense receipt extraction from Drive.** Phase 1.5 (depends on canonical receipt schema).
- **Subscription / renewal tracker.** Phase 1.5.
- **Travel + itinerary management.** Phase 3 (master brief §16.1).
- **Break-glass admin UI for redaction reveal.** V1 ships the typed audit event `owner.content_revealed` + user-notification + time-limited grant logic. The admin-side UI ("request access" button + reveal flow) deferred to Phase 1.5. Until UI ships, admins use direct API access.
- **Per-user budget caps.** Phase 1.5 IF customer demand emerges. V1 pools spend to subaccount budget.
- **Multiple Calendar lookahead horizons.** V1 ships 15-minute lookahead default. Multi-horizon (e.g. 24h next-day prep + 15min imminent) deferred until workflow #5 (weekly review) lands and operators request it.
- **`controllerStyle: 'operator'` on the EA.** V2 — depends on Spec D (`operator-backend`).
- **Long-running autonomous sessions (multi-turn investigations).** V2 — Operator Mode.
- **ChatGPT OAuth as operator-session identity for the EA.** V2 — depends on Spec C (`operator-session-identity`) which has already shipped, plus Spec D, then EA V2 composes them.
- **Notion connector + actions.** Not in V1.2 brief scope. Operator-deferred.
- **Outlook / Microsoft 365 connector + actions.** V1 dogfood is Google stack; Outlook lands when a customer use case emerges. Wizard already future-compatible via capability grouping (§17.4).
- **Cross-session durable memory beyond existing `memory_blocks`.** Phase 3 (master brief §13).
- **Customer productisation (multi-customer EA tier).** Not in roadmap.
- **Cost-savings dashboard for operator-mediated runs.** Phase 3.5 (OpenClaw strategic analysis Phase 3).
- **Routing policy explainability (which controller chose what).** Separate spec (OpenClaw strategic analysis Phase 2).
- **Browser Environment usage by the EA (e.g. logging into web portals).** Phase 2 / V2 (Operator Controller on Browser).
- **Cross-ownership delegation** (Michael's EA delegates a research task to Sarah, or vice versa). Predecessor §3.8 documents the schema-support but explicitly defers the runtime routing rules.
- **Shared user-scoped memory** across multiple user-owned agents (e.g. Michael's EA and future Michael's Dev Agent reading the same memory). Predecessor §3.4 — additive primitive deferred until a real need emerges.
- **`queue_card` and `metric_card` home-widget types.** §7.7 reserves the type-system slots; no agent uses them V1.
- **Slack `search:read` plan-tier upgrade path.** Free Slack workspaces lack search; V1 returns typed `PLAN_NOT_SUPPORTED`. UI affordance for upgrade-prompt deferred.
- **VoiceProfile `manual` sampler.** The `manual` value is NOT a valid element of the V1 `voice_profiles.sources[]` allowlist (V1 allowlist = `'gmail_sent_sampler' | 'drive_doc_sampler'`; the §21.1 schema CHECK rejects any other element on insert/update). Activating the `manual` sampler in V1.5 requires (a) adding `'manual'` to the allowlist (CHECK migration; `sources` remains `text[]` per REQ-C4), (b) a pasted-sample storage column or table, (c) the wizard/Settings UI for pasting, (d) the sampler implementation. Not in V1 scope.
- **VoiceProfile `on_send_count` refresh policy** + **combined "periodic OR send-count" refresh policy.** V1 schema reserves the `'on_send_count'` enum value but the write API + Zod schema reject it (existing rows with that value never auto-refresh). Activating the policy requires a future spec to (a) add the `sent_count_since_derive` counter (likely a column on `voice_profiles` or a small ledger), (b) lift the write-rejection, and (c) define how counter increments interact with concurrent runs. A combined "30 days OR N sends" mode would additionally require a new enum variant; both are deferred until the EA dogfood proves either mode actually matters.
- **Operator impersonation** (e.g. Sarah running Michael's EA while he's on holiday). Predecessor §5 — future work; V1 forbids cross-user impersonation.
- **Slack auto-send scope dropdown** (`Only me (DMs)` / `My own channels` / `Anywhere`). The dropdown is shown in locked mockup `03-ea-settings.html` but is NOT shipped as an interactive control in V1 — the §1 framing ceiling ("Every Tier 4+ write to a third-party system is review-gated") makes all dropdown options produce identical behaviour, and shipping a non-functional control would mislead the operator. V1 renders the field as static text. A future spec that relaxes the framing ceiling activates the dropdown.


## 27. Open questions for Phase 2

Carried from brief §4 + spec-time confirmations. Phase 2 architect resolves each in `plan.md`.

1. **Calendar `respond_to_invite` risk-tier rationale.** Spec lists Tier 3 (between read-Tier-2 and internal-record-write-Tier-4). Confirm with risk-tier rubric authors in Phase 2. Alternative: Tier 4 if "responding alters organiser-visible state" is judged the same as "creating an event."

2. **Slack `channels:history`, `groups:history`, `im:history`, `mpim:history`, `im:write`, `search:read` scope additions.** All required by V1 actions. Phase 2 must verify Slack workspace plan supports each scope; document the `search:read` plan-tier caveat in the wizard UX.

3. **Calendar lookahead cadence + horizon override.** V1 default 1-minute scan cadence + 15-minute lookahead. Phase 2 confirms whether the 1-minute cadence holds in practice (Google Calendar quota headroom permitting) or should fall back to 5-minute baseline with on-demand fast-track when an EA run depends on the data.

4. **Calendar lookahead horizon.** V1 default 15 minutes. Confirm value and whether the lookahead is a memory_block setting per-user OR a global constant.

5. **EA agent's `Specialist` vs alternative `agentRole`.** Spec recommends `Specialist` (matches Sarah / Helena / Patel). Phase 2 confirms vs alternatives (`Worker`, new `Personal_Assistant` role) — recommendation stands unless `agentRole` is consumed by a code path that treats `Specialist` differently than is appropriate.

6. **System-prompt canonical text.** §13.3 names sections (identity / voice integration / escalation rules / memory awareness / delivery awareness). Phase 2 architect drafts the prompt body itself.

7. **Stub second user-owned agent (reuse criterion).** §15.6 names the option of adding a no-op Dev Agent template stub. Phase 2 architect decides whether the stub ships in V1 OR the contract proof is left as the integration test in §25.3.

8. **First-run wizard `EA_PROVISION` permission key default-grant.** Spec proposes "every user." Phase 2 confirms — alternatives include subaccount-admin-gated provisioning (admin invites users to provision their EA).

9. **Operator user's seed EA at deploy time.** §13.5 leaves this to the architect. Recommendation: no seed; operator goes through the wizard like any other user.

10. **Capability slug naming for new Slack actions.** Spec proposes `channel_messages_read`, `channel_post_message`, `channel_search_messages`, `dm_send`. Phase 2 confirms against the existing integration-reference naming conventions.

11. **Workflow execution-event taxonomy.** §10.7 names `trigger.fired` / `trigger.suppressed`; §11.4 names `workflow.started` / `workflow.completed` / `workflow.failed` / `workflow.partial`; §24.3 names `draft.created` / `draft.sending` / `draft.sent` / `draft.send_failed` on `ea_drafts`; approval-side events (`proposal.approved` / `proposal.rejected` / `proposal.expired`) are emitted by the proposal primitive, not by `eaDraftService`. Phase 2 architect verifies each new event type lands in `shared/types/agentExecutionLog.ts` `AGENT_EXECUTION_EVENT_CRITICALITY` with appropriate criticality and is consumable by Run Trace.

12. **`actionService.proposeAction` FK shape verification.** §7.5 LOCKS the composition: `ea_drafts.proposalId` FK to the proposal primitive's row. Phase 2 architect verifies the existing `actionService.proposeAction` primitive supports being the approval source for an external draft row (i.e. the existing row schema accepts a per-domain payload reference OR `ea_drafts` is the inverse-FK direction so the proposal row's payload is just `{ kind: 'ea_draft', draftId }`). If the existing primitive cannot accept either shape, the architect escalates BACK to spec revision rather than proceeding with a parallel state machine. Routed to `tasks/todo.md` (`EA-V1-AD1`) resolved by this spec — Phase 2 verification only.

Phase 2 plan.md addresses each as the architect prefers — none of the 12 above is blocking on operator decision; all are spec-time confirmations the architect resolves with codebase context.

---

## End of spec

