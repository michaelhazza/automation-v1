# Progress: ClientPulse

Spec: `tasks/clientpulse-ghl-gap-analysis.md` (2,827 lines, spec-reviewer clean at 5/5 iterations)
Mockups: 20 HTML files at `tasks/clientpulse-mockup-*.html`
Branch: `claude/commit-to-main-y5BoZ`

## Scope (user-confirmed 2026-04-18)

One PR on `claude/commit-to-main-y5BoZ` covering Phases **0 + 0.5 + 1 + 2 + 3** (server-only work). Phase 4+ (intervention pipeline, UI editors, outcome loop) lands in a follow-up PR.

## Pipeline

| Stage | Status | Notes |
|-------|--------|-------|
| A) Intake | done | Scope locked: Phases 0, 0.5, 1, 2, 3 in one PR |
| B) Architecture | blocked | Coordinator subagent cannot invoke `architect` directly — needs parent-session delegation (see Blocker below) |
| C) Implementation | pending | |
| D) Handoff | pending | |

## Chunks (one per phase, serialised per the user's packaging)

| # | Name | Status | Notes |
|---|------|--------|-------|
| 1 | Phase 0 — Template extension + OAuth scope | **done** | Migration 0170, 5 accessors, operationalConfigSchema (B4), SSoT fix on routes/ghl.ts. 18 Pure tests pass. Zero new typecheck errors. |
| 2 | Phase 0.5 — Playbook engine scope refactor | **done** | Migration 0171 adds scope enum + nullable subaccount_id + CHECK + partial index. requireSubaccountId helper introduced. Zero new typecheck errors. |
| 3 | Phase 1 — Signal ingestion (6 adapters + canonical writes + B1 RateLimiter) | **done (substrate)** | Migration 0172 + 6 new adapter fns + RateLimiter wiring (B1) + ingestion service + polling integration. 9 Pure tests pass. Deferred to Phase 1.follow-up: webhook handlers (INSTALL/UNINSTALL/LocationCreate/Update + existing handlers writing canonical_subaccount_mutations); canonicalDictionary entries. staff_activity_pulse, integration_fingerprint, ai_feature_usage write placeholder observations. |
| 4 | Phase 2 — Health-score execution (re-target existing handler) | **done** | Migration 0173 adds client_pulse_health_snapshots. executeComputeHealthScore dual-writes to new + existing tables. No parallel handler file. Zero new typecheck errors. |
| 5 | Phase 3 — Churn risk evaluation (re-target existing handler) | **done** | Migration 0174 adds client_pulse_churn_assessments. executeComputeChurnRisk dual-writes with band derived from churnBands config. 3 new default signals seeded at weight=0. No parallel handler file. Zero new typecheck errors. |
| 6 | Phase 1 follow-ups (webhooks + 2 real skills + fingerprint tables) | **done** | Migration 0177 (bumped from 0176 after IEE 0176 landed on main) creates integration_fingerprints/detections/unclassified with RLS + CloseBot/Uphex seed. Webhook handler extended: 10 events now write canonical_subaccount_mutations (6 existing + 4 new INSTALL/UNINSTALL/LocationCreate/Update). 60 pure tests pass (25 webhook mutation mapper, 8 staff activity, 12 fingerprint scanner, 15 existing). staff_activity_pulse + integration_fingerprint placeholder observations replaced with real values; ai_feature_usage remains placeholder pending SaaS-tier endpoint. 3 canonicalDictionaryRegistry entries added for new fingerprint tables (the 6 Phase-1 entries already shipped in main). Zero typecheck regressions (43-error baseline maintained). Branch: `claude/clientpulse-phases-4-6-agu8s`. |

## Optimisation backlog (Phase 5+)

- **Scanner gate-position refactor.** `executeScanIntegrationFingerprints` currently runs the full scan (library load + artifact load + match) before the observation-insert win-gate fires. At current scale (hundreds of subs × tens of observations × ~10 seed patterns) the wasted compute on a pg-boss retry of a conflicting `sourceRunId` is negligible, so the gate sits after the compute in order to populate the observation row with real `detectionCount` / `unclassifiedCount` payload values. If poll cadence or library size grows meaningfully, move the observation insert to the top of the handler with a minimal payload and apply a follow-up UPDATE with the real counts once the scan completes. Flagged as non-blocking by external review.
| 7 | Phase 4 — Intervention pipeline | **pending** | Architect pending — separate call after Phase 1 follow-ups merges. Not planned in this PR. |

## Locked contracts (non-negotiable, carried from intake)

(a) 5 namespaced action slugs: `crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`, `clientpulse.operator_alert`
(b) Interventions are `actions` rows with `gateLevel='review'` + metadata — no parallel table
(c) Configuration Agent writes flow into `config_history` with `entity_type='clientpulse_operational_config'`
(d) Intervention templates live in `operational_config.interventionTemplates[]` JSONB
(e) No auto-execution path in V1
(f) **Phases 2 & 3: re-target existing handlers at `skillExecutor.ts:1269` and `:1279` — do NOT create parallel handler files**
(g) **OAuth scope SSoT:** only `oauthProviders.ts` — remove duplicate references in `server/routes/ghl.ts`
(h) **Canonical tables:** every new canonical table in Phase 1 needs `UNIQUE(organisation_id, provider_type, external_id)`, `rlsProtectedTables.ts` entry, RLS policy migration, `canonicalDictionary.ts` entry

## Ship-gate blockers (§26.1)

| # | Item | Phase | Owned by this PR? | Status |
|---|------|-------|-------------------|--------|
| B1 | Wire `RateLimiter` into GHL adapter | 1 | yes | pending |
| B2 | Implement `measureInterventionOutcomeJob` | 4 | **no** (Phase 4) | deferred |
| B3 | Wire Configuration Agent writes to `config_history` with `entity_type='clientpulse_operational_config'` | 4.5 | **no** (Phase 4.5) | deferred |
| B4 | Author `operational_config` JSON Schema with `sensitive` flags | 0 | yes | pending |
| B5 | Implement sensitive-path routing through action→review queue | 4.5 | **no** (Phase 4.5) | deferred |
| B6 | Update Configuration Assistant chat UX copy for dual-path governance | 5 | **no** (Phase 5) | deferred |

Per-phase ship gates (from the user's resume instructions):
- Phase 0: new/existing GHL Agency orgs load extended template; `orgConfigService.getStaffActivityDefinition(orgId)` returns seeded JSONB without caller providing defaults
- Phase 0.5: existing sub-account playbooks still work; engine accepts `scope='org'` registrations
- Phase 1: `client_pulse_signal_observations` has rows for all 8 signals across every sub-account after a poll cycle (fixture-data cycle acceptable)
- Phase 2: trajectory test `portfolio-health-3-subaccounts.json` passes end-to-end
- Phase 3: every sub-account has churn-assessment row with a band; dashboard high-risk widget no longer returns `[]`

## Vertical-slice validation

**NOT reachable in this PR.** Full slice (signal → scoring → detection → proposal → approval → CRM execution → outcome measurement) needs Phase 4. This PR lands the first half (signal → scoring → churn band). To be stated explicitly in the PR description.

## Also carry forward

- `CLAUDE.md` **Current focus** pointer is stale (points at canonical-data-platform-roadmap). The builder should update it at Phase 0 start to ClientPulse, then revert at handoff.
- `tasks/todo.md` is a closed 2026-04-01 audit list — do not touch. Phase tracking lives here.
- Spec is `spec-reviewer`-clean (5/5 lifetime cap reached). Architect consumes as ground truth — do not re-invoke `spec-reviewer`.

## Blocker (active — escalated to user 2026-04-18)

**Feature-coordinator cannot invoke sibling subagents from within its own process.**

The coordinator subagent has only `Read`, `Glob`, `Grep`, `Write`, `Edit` available. There is no `Task` / subagent-invocation tool exposed to this agent. The CLAUDE.md playbook describes delegating to `architect`, `pr-reviewer`, and `dual-reviewer` via natural-language messages, but those messages are commands the **parent (main Claude Code session)** issues — not commands a child subagent can issue to a sibling.

**What this means for the ClientPulse resume:**
- I cannot invoke `architect` from here to produce `tasks/builds/clientpulse/plan.md`
- I cannot invoke `pr-reviewer` or `dual-reviewer` after implementation
- I cannot drive the implementation chunks (coordinator never implements anyway)

**Correct path forward (needs parent-session action):**
1. Parent session invokes `architect` with the phase-by-phase scope from the resume brief, targeting plan output at `tasks/builds/clientpulse/plan.md`
2. Parent session implements Chunk 1 (Phase 0), then invokes `pr-reviewer` on the diff
3. Parent session (acting as coordinator) updates this `progress.md` between chunks
4. After all 5 chunks done: parent session runs `pr-reviewer` then `dual-reviewer` on the combined diff before PR

The parent session can still use this `progress.md` and the locked-contract table above as its orchestration checklist — the coordinator role becomes a checklist the parent follows, not a separate agent process.
