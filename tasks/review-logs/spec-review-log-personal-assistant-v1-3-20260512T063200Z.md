# Spec Review Log — personal-assistant-v1, Iteration 3

**Spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`
**Spec commit at start:** `42d3de474c030c24b00ada2417b9f9f68f183078`
**Codex run:** 3 of 5 (lifetime)

---

## Codex findings (12)

### Finding 1 — Integration test posture (REPEAT iter1+iter2)
- Classification: directional | Disposition: **AUTO-REJECT (framing)** — third repeat.

### Finding 2 — `create_event` action-registry row still says "key-based via Google `requestId`" after iter2 fixed §7.2/§8.4/§24.2
- Section: §8.2 table line 578
- Classification: mechanical | Disposition: auto-apply (update the table cell to `state-based via ea_drafts.sentMessageId`)

### Finding 3 — Slack auto-send modes violate §1 ceiling (Tier 4+ third-party writes are review-gated)
- Section: §9.3, §1, §13.1
- Severity: critical
- Classification: mechanical | Disposition: auto-apply (tighten — channel posts ALWAYS review-gated regardless of dropdown; dropdown's only V1 effect is DM-target check)

### Finding 4 — `agent_triggers.event_type` enum extension claimed by TWO migrations
- Section: §5.1 line 183 (seed) + line 186 (external_source_triggers)
- Classification: mechanical | Disposition: auto-apply (lock to `NNNN_external_source_triggers.sql`; remove from seed migration row)

### Finding 5 — `oauthProviders.ts` modified-files row only names Google Calendar but Slack scope additions + Event Subscriptions also touch it
- Section: §5.2, §9.2, §10.6
- Classification: mechanical | Disposition: auto-apply (extend the modified-files row to cover Slack additions too)

### Finding 6 — `workflowGateStallNotifyJob.ts` load-bearing for `ea_drafts` expiry but absent from §5.2
- Section: §7.5, §20.4, §22.2
- Classification: mechanical | Disposition: auto-apply (add to §5.2)

### Finding 7 — Home-widget declaration storage left "architect picks"
- Section: §7.6
- Classification: mechanical | Disposition: auto-apply (lock to new `system_agents.home_widget jsonb` column; added in the seed migration; reflected in `systemAgents.ts` schema)

### Finding 8 — Calendar push doesn't fire at reminder time — meeting prep cannot be triggered from push
- Section: §10.2, §10.5, §11.3
- Severity: critical
- Codex fix: scheduled lookahead job that fires `calendar_event_imminent` 15 min before start.
- Classification: mechanical | Disposition: auto-apply
- Reasoning: Codex is technically correct — Google Calendar push notifications fire on event create/update/delete, NOT at reminder time. The spec's prior design (push channels → `calendar_event_imminent`) is impossible. Replaced with `calendarLookaheadJob.ts` (1-minute scheduled scan). Dropped the entire `webhook_channel_registrations` + `googleWebhook.ts` + `calendarChannelRenewalJob.ts` triad in V1 (deferred to V1.5) because without a local Calendar mirror (§18 live-fetch), push provides no V1 value.

### Finding 9 — External-trigger dedup key too coarse for recurring/rescheduled calendar events
- Section: §7.1, §10.9, §24.1
- Codex fix: For `calendar_event_imminent`, derive dedup key from `(provider, calendarId, eventId, startAt, lookaheadMinutes, ownerUserId)`.
- Classification: mechanical | Disposition: auto-apply (per-event-type dedup key shape; covered by the Finding #8 rework via `singleEvents=true` + `startAt` in the dedup key)

### Finding 10 — VoiceProfile `on_send_count` has no counter; rows with that policy never refresh
- Section: §2.6, §12.5, §26
- Codex fix: V1 reserves but rejects writes with `on_send_count` until a future spec adds the counter.
- Classification: mechanical | Disposition: auto-apply (tighten the schema CHECK + write-API to reject `on_send_count` until counter ships)
- Already partially addressed in iter2's §12.5 update (the job now skips `on_send_count` rows). Tighten further per Codex.

### Finding 11 — `voice_profiles.state` needed by §24.6 concurrency contract but absent from §7.4 schema
- Section: §24.6, §27
- Classification: mechanical | Disposition: auto-apply (add `state` column to §7.4; resolve §27 open question)

### Finding 12 — `eaDraftService` state machine vs `actionService.proposeAction` (REPEAT iter1+iter2)
- Classification: directional | Disposition: **AUTO-DECIDED → REPEAT** (already routed; §27 open question covers this)

---

## Rubric findings (Claude pass)

None this iteration — Codex Finding #8 (Calendar push at reminder time) was the major rubric-class problem that survived iter1+iter2 because it required external-API knowledge to spot. Caught here.

---

## Decisions summary

- Codex findings: 12
- Rubric findings: 0
- Total findings: 12
- Mechanical accepted: 9 (Codex #2, #3, #4, #5, #6, #7, #8, #9, #10, #11 — minus REPEATS = 10 → minus 1 = wait, let me recount: Codex #2 mech, #3 mech, #4 mech, #5 mech, #6 mech, #7 mech, #8 mech, #9 mech, #10 mech, #11 mech. 10 mechanical.)
- Mechanical rejected: 0
- AUTO-REJECT (framing): 1 (Codex #1 REPEAT)
- AUTO-DECIDED (already routed): 1 (Codex #12 REPEAT)
- Reclassified: 0

Counts for stopping heuristic:
- mechanical_accepted: 10
- directional_or_ambiguous: 2 (both REPEATS — already covered, no new action)
