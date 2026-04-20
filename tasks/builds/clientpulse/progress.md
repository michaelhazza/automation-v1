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
| 7 | Phase 4 — Intervention pipeline | **done (chunks A–D)** | Chunk A: 5 namespaced action primitives (crm.fire_automation / send_email / send_sms / create_task / clientpulse.operator_alert) + mergeFieldResolver (V1 grammar, 24 pure tests) + migration 0178 (indexes). Chunk B: event-driven proposer job + pure matcher (14 tests) + propose/context routes. Chunk C: hourly outcome-measurement job + pure helper + B2 end-to-end fixture (11 tests, closes B2). Chunk D: ProposeInterventionModal wrapper + 5 editor components + high-risk widget click-to-propose wiring. Typecheck baseline unchanged at 43 errors. |
| 8 | Phase 4.5 — Configuration Agent extension | **done (chunks A–B)** | Chunk A: config_update_hierarchy_template skill + orchestration service with sensitive-path split (closes B3 + B5) + 14 pure tests + action registry + skill executor. Chunk B: ConfigAssistantChatPopup with confirm-before-write flow + /api/clientpulse/config/apply route + docs sync (capabilities.md, integration-reference.md, configuration-assistant-spec.md, orchestrator-capability-routing-spec.md). |

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
| B1 | Wire `RateLimiter` into GHL adapter | 1 | yes | **done** (Phase 1) |
| B2 | Implement `measureInterventionOutcomeJob` | 4 | **yes** (Phase 4 PR) | **done** — hourly cron + pure fixture test for atRisk→watch band change |
| B3 | Wire Configuration Agent writes to `config_history` with `entity_type='clientpulse_operational_config'` | 4.5 | **yes** (Phase 4.5 PR) | **done** — change_source='config_agent' on all writes |
| B4 | Author `operational_config` JSON Schema with `sensitive` flags | 0 | yes | **done** (Phase 0) |
| B5 | Implement sensitive-path routing through action→review queue | 4.5 | **yes** (Phase 4.5 PR) | **done** — sensitive paths insert actions row with gateLevel=review, approval-execute commits |
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

## Session 1 — platform foundation + settings + onboarding wizard (2026-04-20)

Branch: `claude/clientpulse-session-1-foundation`. Spec: `tasks/builds/clientpulse/session-1-foundation-spec.md`. Plan: `tasks/builds/clientpulse/session-1-plan.md`.

**Contract surface advanced (spec §1.3):**
- **(h)** `organisations.operational_config_override` is now the single org-owned writable source of truth. Migrations 0180 + 0182 + schema updates + read chain in place.
- **(i)** Platform primitives renamed: `clientpulse.operator_alert → notify_operator`; `config_update_hierarchy_template → config_update_organisation_config`; pseudo-integration `clientpulse-configuration → organisation-configuration`; capability taxonomy renames in `docs/integration-reference.md`.
- **(j)** Settings page + Configuration Assistant popup are equal surfaces — both write via `configUpdateOrganisationService.applyOrganisationConfigUpdate` → same `config_history` audit trail → same sensitive-path split.
- **(k)** Popup session lifecycle — 15-minute resume window wired via `updatedAfter` query param on `GET /api/agents/:agentId/conversations`; popup close does not kill the run.
- **(l)** `resolveActionSlug` defensive normalisation added to the action registry; log-once warning per alias per process.
- **(n)** Module-composable `sensitiveConfigPathsRegistry` replaces the hardcoded `SENSITIVE_CONFIG_PATHS`; ClientPulse registers 14 paths at boot.
- **(t)** Config-history union (`organisation_config_all`) ships so operators see a single contiguous timeline across `clientpulse_operational_config` (legacy rows) + `organisation_operational_config` (new target).

**Chunks landed (one commit each on the branch):**

| # | Chunk | Commit summary |
|---|-------|----------------|
| 1 | Docs sync | Plan + spec fixes (5 regression-check drifts). |
| 2 | **A.1** — data model + core renames | 3 forward migrations + rollback pairs; slug rewrite; alias resolver + 2 new pure tests; 83/83 affected pure tests green. |
| 3 | **A.2** — config service refactor + sensitive-paths registry | Service rename `configUpdateHierarchyTemplate → configUpdateOrganisation{Service,ConfigPure}`; writer retargets `organisations.operational_config_override`; registry + ClientPulse module registration; `sensitiveConfigPathsRegistryPure.test.ts` new (8 cases). |
| 4 | **A.3** — generic `/api/organisation/config` + UI renames | New route (POST apply + GET read); legacy `/api/clientpulse/config/apply` retired; `/system/config-templates → /system/organisation-templates`; capability taxonomy renames in 4 doc files. |
| 5 | **A.4** — Configuration Assistant popup | `ConfigAssistantPopup` + `useConfigAssistantPopup` hook + context; legacy `ConfigAssistantChatPopup` deleted; nav trigger; dashboard rewire; `listConversations` params (`updatedAfter`/`order`/`limit`). |
| 6 | **Chunk 5** — Settings page + Subaccount Blueprints rename | `/clientpulse/settings` page with 10 blocks, JSON editor + schema validation via server (typed editors deferred to Session 2); shared primitives (`ProvenanceStrip`, `OverrideBadge`, `ManuallySetIndicator`, `ResetToDefaultButton`, `differsFromTemplate`); `AdminAgentTemplatesPage → SubaccountBlueprintsPage`. |
| 7 | **Chunk 6** — Onboarding wizard redirect + completion | `needsOnboarding` on `GET /api/onboarding/status` (derived from `organisations.onboarding_completed_at IS NULL`); `POST /api/onboarding/complete`; `useOnboardingRedirect` hook in `ProtectedLayout`. |

**Ship-gate matrix:**

| Gate | Status | Verification |
|------|--------|--------------|
| S1-A1 (data-model separation) | passed | `orgOperationalConfigMigrationPure.test.ts` (6/6), migration 0180 rollback-safe |
| S1-A2 (slug rename) | passed | `actionSlugAliasesPure.test.ts` (6/6) — every alias resolves to registered slug |
| S1-A3 (sensitive-paths registry) | passed | `sensitiveConfigPathsRegistryPure.test.ts` (8/8) |
| S1-A4 (generic route) | passed | Route handler + zod schema + service pass-through in place; integration test deferred to Session 2 per scope fence |
| S1-A5 (popup lifecycle) | partial | Popup + hook + deep-link shipped; manual browser test deferred to Session 2 verification doc |
| S1-5.1 (Settings page) | passed | 10-block page + save flow + provenance strip + reset-to-default |
| S1-5.2 (blueprint editor refactor) | passed | Page renamed + nav label updated |
| S1-7.1 (new terminology) | passed | "Config Templates" → "Organisation Templates"; "Team Templates" → "Subaccount Blueprints" across client UI + docs |
| S1-7.2 (OAuth soft-gate + completion) | passed | Wizard marks `onboarding_completed_at`; redirect hook skips wizard on subsequent sign-ins |

**Sanity gate (final run):**
- Server typecheck: 43 = baseline (zero new errors).
- Client typecheck: 11 = baseline.
- 151 pure tests across 11 files: all green.
- `verify-integration-reference.mjs`: 0 blocking errors (26 pre-existing MCP-preset warnings unchanged).

**Deferred to Session 2 (tracked, not silent):**
- Full ConfigAssistantPanel extraction (Session 1 ships iframe-wrapped popup for MVP).
- Typed form editors for each of the 10 Settings blocks (Session 1 ships schema-validated JSON editor per block).
- Create Organisation modal rebuild (template picker + tier toggle + live preview per spec §7.1) + `organisationService.createFromTemplate` method.
- Integration test `organisationConfig.test.ts` per spec §8.2 (S1-A4 automated).
- Manual verification doc `session-1-verification.md` per spec §8.4.

---

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
