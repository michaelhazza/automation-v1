# Session 2 Brief — Pilot Enablement + Pilot Polish

**Status:** Not yet specced. High-level scope + pointers for a future session.
**Predecessor:** Session 1 — `tasks/builds/clientpulse/session-1-foundation-spec.md`
**Effort estimate:** ~2-2.5 weeks, one PR

---

## Contents

1. Scope — Phase 6 (pilot enablement) + Phase 8 (polish)
2. Locked contracts inherited from Session 1
3. Ship gates
4. Open questions to resolve at kickoff
5. Mockup inventory (already on branch)
6. What stays deferred

---

## §1. Scope

Two phases, one branch, one PR.

### Phase 6 — Pilot enablement (blocks real pilot launch)

**P6.1 — Real CRM execution wiring.** Implement `server/services/adapters/apiAdapter.ts` so approved `crm.*` actions actually dispatch to the connected CRM (GHL in pilot). Currently this file is a Phase-1A stub that returns `not_implemented`. Until the adapter wires, the intervention pipeline works in simulation only.

**P6.2 — Live CRM data in editor modals.** The 5 editor components today accept free-text IDs. Pilot UX needs searchable pickers backed by new adapter endpoints:

- `GET /api/clientpulse/subaccounts/:id/crm/automations`
- `GET /api/clientpulse/subaccounts/:id/crm/contacts`
- `GET /api/clientpulse/subaccounts/:id/crm/users`
- `GET /api/clientpulse/subaccounts/:id/crm/from-addresses` (email)
- `GET /api/clientpulse/subaccounts/:id/crm/from-numbers` (sms)

All five mockups already show this design.

**P6.3 — Per-client drilldown page.** `/clientpulse/clients/:subaccountId` — mounts the same `ProposeInterventionModal`, plus intervention history with B2 outcome badges, latest signal panel, tier migration history, "Open Configuration Assistant" contextual trigger. Mockup: `tasks/clientpulse-mockup-drilldown.html` (v2).

### Phase 8 — Pilot polish (ships with Phase 6)

**P8.1 — Outcome-weighted recommendation signal.** `buildInterventionContext`'s `recommendedActionType` currently picks highest-priority eligible template. Replace with signal weighted by historical outcome. Data source: `intervention_outcomes` aggregated by `(org_id, template_slug, band_before)`. Falls back to priority-based when < N outcome rows exist.

**P8.2 — Configuration Assistant dual-path UX copy (B6).** Sensitive vs non-sensitive copy clearly distinguishes "routed to review queue" vs "applied immediately." Mockup: `clientpulse-mockup-config-assistant-chat.html`.

**P8.3 — Channel fan-out verification for `notify_operator`.** Verify in-app + email + Slack delivery end-to-end. Build missing paths if the existing notifications worker doesn't cover all three.

**P8.4 — Typed `InterventionTemplatesEditor`.** Replace Session 1's JSON editor with per-field controls (slug + label + gateLevel + actionType + targets multi-select + priority + measurementWindowHours + payloadDefaults + defaultReason). Mockup: `clientpulse-mockup-template-editor.html`.

**P8.5 — Per-block "Ask the assistant" deep-links.** Each Settings-page editor card gets a contextual-prompt button that opens the Configuration Assistant popup seeded with the relevant path prompt. Deferred from Session 1 per §10.7.

**P8.6 — Wizard Screen-3 scan-frequency + alert-cadence controls (conditional).** Ships only if underlying `operational_config` schema fields are added as part of Phase 8. Deferred from Session 1 per §10.7.

## §2. Locked contracts — inherit Session 1

All Session 1 contracts (a) through (v) + `InterventionEnvelope` type + §1.6 invariants apply unchanged. Especially relevant:

- **(m)** Linear state machine; `blocked` terminal; `skipped` carries reason enum.
- **(n)** Config gating is pure; execute never mutates config.
- **(o)** Canonical idempotency key pattern for any new intervention trigger.
- **(p)** Atomicity boundaries — adapter calls land "external side effect last" per (t).
- **(q)** Every log/event/audit row carries `actionId`.
- **(s)** Automatic retry vs manual replay. **Manual replay (`replay_of_action_id`) may land in Phase 8** if pilot feedback calls for it — schema is pre-documented.
- **(t)** Internal state writes first, external side effects last, audit never skipped.
- **(u)** External side effect preconditions — adapter call requires approved + validated + idempotency-locked + timeout-budget-remaining.
- **(v)** PG advisory lock per subaccount for serial execute of approved actions.

## §3. Ship gates

| # | Gate | Verification |
|---|------|--------------|
| S2-6.1 | `apiAdapter.execute(action)` dispatches correctly for all 5 `crm.*` types + retries per `actionDefinition.retryPolicy` | Integration test against GHL sandbox |
| S2-6.2 | Editor modals render live-fetched pickers; free-text ID fallback removed | Manual smoke per editor |
| S2-6.3 | Drilldown page mounts; history shows ≥ 1 row with band-change badge when real data exists | Manual smoke |
| S2-8.1 | `recommendedActionType` returns weighted signal; fallback to priority-based when data sparse | Pure test + manual verification |
| S2-8.2 | `notify_operator` fans out to all three channels within one worker tick | Manual smoke on test org with all channels wired |
| S2-8.3 | Typed `InterventionTemplatesEditor` replaces JSON editor; existing templates round-trip | Manual smoke |
| S2-8.4 | Per-block "Ask the assistant" buttons present on each Settings card | Manual smoke |
| S2-8.5 (conditional) | Scan frequency + alert cadence editable + persisted | Manual smoke + schema inspection |
## §4. Open questions to resolve at Session 2 kickoff

1. **Subscription tier gating for Phase 6 (D6 from original roadmap).** Intervention execution was originally scoped as Operate-tier-only. Session 2 either enforces the gate (blocking Monitor-tier orgs from firing) or defers D6 to a later phase. Decision affects whether we build a tier-check middleware.
2. **Adapter retry strategy.** `actionDefinition.retryPolicy` declares retry behaviour; the adapter must honour it. Needs explicit mapping: what GHL response codes are retryable (429, 502, 503, network timeout) vs terminal (401, 422, contact-not-found)?
3. **Channel fan-out provider inventory.** Does the existing notifications worker support Slack + email + in-app today? If any are missing, P8.3 scope expands.
4. **Manual replay (`replay_of_action_id`) in Phase 8 or defer?** Pilot feedback dependent — document as open at kickoff; decide once pilot data is available.
5. **Drilldown feature scope.** Ship minimal (intervention history + outcome badges + signal panel) and iterate, or include segmented outcome charts + signal-overlay timeline upfront? Recommendation: minimal; iterate post-pilot.

## §5. Mockup inventory (already on branch)

All mockups are banner-tagged with Phase 6 / Phase 8 scope + pre-aligned with the locked contracts.

| Mockup | Phase 6 / 8 surface |
|---|---|
| `clientpulse-mockup-drilldown.html` | P6.3 — drilldown + outcome badges |
| `clientpulse-mockup-fire-automation.html` | P6.2 — live automation picker |
| `clientpulse-mockup-email-authoring.html` | P6.2 — live contact + sender pickers |
| `clientpulse-mockup-send-sms.html` | P6.2 — live contact + from-number picker |
| `clientpulse-mockup-create-task.html` | P6.2 — live user + contact pickers |
| `clientpulse-mockup-operator-alert.html` | P8.3 — fan-out verification |
| `clientpulse-mockup-propose-intervention.html` | P8.1 — outcome-weighted recommendation |
| `clientpulse-mockup-config-assistant-chat.html` | P8.2 — dual-path UX copy |
| `clientpulse-mockup-template-editor.html` | P8.4 — typed intervention template editor |
| `clientpulse-mockup-settings.html` | P8.5 — per-block deep-links (add to each card) |
| `clientpulse-mockup-onboarding-orgadmin.html` | P8.6 — Screen-3 scan frequency + alert cadence |

No mockup changes needed before Session 2 kickoff.

## §6. What stays deferred

- Full D6 subscription-tier runtime gating (unless resolved in §4 Q1)
- Drilldown feature-completeness beyond intervention history + signal panel
- Custom intervention-type authoring beyond the 5 primitives
- Dedicated `ORG_PERMISSIONS.CONFIG_EDIT` split
- Runtime `operationalConfigSchema.parse()` on the effective-read hot path

Consistent with Session 1 §10.7.

---

## Next action

When Session 2 kicks off:

1. Resolve the 5 open questions in §4 (HITL or auditable-at-kickoff).
2. Draft full Session 2 spec following Session 1's structure (§1 ship gates + contracts → §N per-phase detail → work sequence + file inventory → decisions log). Target ~800-1000 lines.
3. Run `spec-reviewer` loop (fresh 5-iteration budget for Session 2).
4. Architect pass produces `tasks/builds/clientpulse/session-2-plan.md`.
5. Implement chunk-by-chunk following the same 8-chunk cadence Session 1 uses.
