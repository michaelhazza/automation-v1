# Progress: ClientPulse

Spec: `tasks/clientpulse-ghl-gap-analysis.md` (2,827 lines, spec-reviewer clean at 5/5 iterations)
Mockups: 20 HTML files at `tasks/clientpulse-mockup-*.html`
Branch: `claude/commit-to-main-y5BoZ`

## Pipeline

| Stage | Status | Notes |
|-------|--------|-------|
| A) Intake | in-progress | Scope-delineation check raised with user before architect invocation |
| B) Architecture | pending | Blocked on user decision re: PR packaging scope |
| C) Implementation | pending | |
| D) Handoff | pending | |

## Chunks

Chunks will be populated once the architect emits `tasks/builds/clientpulse/plan.md`. Provisional mapping from the spec's phase model:

| # | Name (from spec §10) | Status | Notes |
|---|---------------------|--------|-------|
| 1 | Phase 0 — Template extension migration + OAuth scope | pending | Parallel with 2, 3 |
| 2 | Phase 0.5 — Playbook engine refactor for `scope='org'` | pending | Parallel with 1, 3 |
| 3 | Phase 1 — Six GHL adapter fetch fns + canonical writes | pending | Parallel with 1, 2 |
| 4 | Phase 2 — Health-score execution (pg-boss job + snapshot table) | pending | Serial |
| 5 | Phase 3 — Churn risk evaluation (snapshot table + scheduler) | pending | Serial |
| 6 | Phase 4 — Intervention pipeline (5 primitives + editors + merge fields + outcome job) | pending | Serial |
| 6.5 | Phase 4.5 — Configuration Agent extension | pending | Parallel with 7 |
| 7 | Phase 5 — Dashboard + briefings + digests + settings + alert tray | pending | Serial |
| 8 | Phase 5.5 — Template editor + onboarding flows + audit log view | pending | Serial |
| 9 | Phase 6 — Trial monitoring | pending | Post-launch |

## Locked contracts (non-negotiable)

(a) 5 namespaced action slugs: `crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`, `clientpulse.operator_alert`. No reuse of unprefixed `send_email` / `create_task`.
(b) Interventions are `actions` rows with `gateLevel='review'` + ClientPulse metadata in `actions.metadataJson`. No parallel `client_pulse_interventions` table.
(c) Configuration Agent writes flow into existing `config_history` with `entity_type='clientpulse_operational_config'`. No parallel `config_changes` table.
(d) Intervention templates live in `operational_config.interventionTemplates[]` JSONB. No new table for templates.
(e) No auto-execution path in V1. Every intervention action goes through `reviewItems`.

## Ship-gate blockers (§26.1)

| # | Item | Phase | Status |
|---|------|-------|--------|
| B1 | Wire `RateLimiter` into GHL adapter | 1 | pending |
| B2 | Implement `measureInterventionOutcomeJob` | 4 | pending |
| B3 | Wire Configuration Agent writes to `config_history` with `entity_type='clientpulse_operational_config'` | 4.5 | pending |
| B4 | Author `operational_config` JSON Schema with `sensitive` flags | 0 | pending |
| B5 | Implement sensitive-path routing through action→review queue | 4.5 | pending |
| B6 | Update Configuration Assistant chat UX copy for dual-path governance | 5 | pending |

## Vertical-slice validation

Required before expanding surface area:
> 1 signal → scoring → scenario detection → proposal → approval → CRM execution → outcome measurement

Status: not yet reached (needs Phases 0, 0.5, 1, 2, 3, 4 substrate at minimum for one end-to-end path).
