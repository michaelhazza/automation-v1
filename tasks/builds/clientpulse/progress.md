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

## Session 2 — real CRM wiring + drilldown + polish (2026-04-20)

Branch: `claude/clientpulse-session-2-arch-gzYlZ`. Spec: `tasks/builds/clientpulse/session-2-spec.md`. Plan: `tasks/builds/clientpulse/session-2-plan.md`.

**Chunks landed:**

| # | Chunk | Ship gate | Summary |
|---|-------|-----------|---------|
| 1 | Architect pass | — | `session-2-plan.md` (775 lines) — ship-gate crosswalk, file inventory attributed per chunk, 13 per-chunk build subsections, risk register, decisions log. |
| 2 | **B.1** — `apiAdapter` real GHL wiring | **S2-6.1 ✓** | Pure classifier (10-case test) + 5 endpoint mappings + HTTP dispatcher with idempotency-key forwarding + structured log + §2.6 precondition gate (validationDigest drift check + per-subaccount advisory lock + timeout budget). Migration 0185 pre-documents `actions.replay_of_action_id` per contract (s). |
| 3 | **B.2** — Live-data pickers | **S2-6.2 ✓** | 5 new subaccount-scoped GET routes + `crmLiveDataService` (60 s in-memory cache) + `ghlReadHelpers` + reusable `<LiveDataPicker>` component (200 ms debounce, keyboard nav, 429 backoff). 4 editor rewires (FireAutomation/EmailAuthoring/SendSms/CreateTask). |
| 4 | **B.3** — Drilldown page | **S2-6.3 ✓** | `/clientpulse/clients/:subaccountId` shipped with Q5-locked minimal surface: header + signal panel + 90-day band-transitions table + intervention history with outcome badges + contextual "Open Configuration Assistant" trigger. Pure `deriveOutcomeBadge` (11-case test) + `drilldownService` + 4 new routes. Dashboard high-risk rows deep-link in. |
| 5 | **C.1** — `notify_operator` fan-out | **S2-8.3 ✓** | `notifyOperatorFanoutService` orchestrator + in-app/email/slack channel adapters + pure availability+plan module (8-case test). Slack webhook read from `organisations.settings.slackWebhookUrl`. `skillExecutor.ts` notify_operator case rewired. |
| 6 | **C.2** — Outcome-weighted recommendation | **S2-8.1 ✓** | Pure `pickRecommendedTemplate` (8-case test) with `outcome_weighted / priority_fallback / no_candidates` reason + `aggregateOutcomesByTemplate` in context service + `recommendedReason` on response. Badge differentiates in ProposeInterventionModal. |
| 7 | **C.3** — Typed `InterventionTemplatesEditor` | **S2-8.4 ✓** | List+expand form editor + 5 per-actionType payload sub-editors + `MergeFieldPicker` (static vocabulary) + round-trip module preserving unknown fields verbatim. JSON editor kept as advanced fallback toggle. |
| 8 | **C.4** — Dual-path UX + per-block deep-links | **B6 ✓** | `ConfigUpdateToolResult` + `parseConfigUpdateToolResult` render the three result shapes (`applied_inline / queued_for_review / error`) with JSON fallback for unknown shapes. Renderer wired into `ConfigAssistantPage` via a message-scan that detects the latest `config_update_organisation_config` tool_result and surfaces it below the message list. `configAssistantPrompts.buildBlockContextPrompt` + "Ask the assistant →" button on every block card. |
| 10 | **D.1 (minimal)** — `createFromTemplate` | partial | Service method lands (stamps `applied_system_template_id` + writes config_history creation-event). Modal rebuild + hierarchy_templates/system-agent seed (spec §11.1.1 steps 3–4) deferred. |
| 11 | **D.2** — Typed Settings editors (9 blocks) | — | Compact functional editors for healthScoreFactors, churnRiskSignals, churnBands, interventionDefaults, alertLimits, dataRetention, onboardingMilestones, staffActivity, integrationFingerprints + shared `ArrayEditor` + `NormalisationFieldset` primitives. Settings page dispatches on `block.path`; JSON fallback preserved for unhandled paths. |
| 13 | **D.4 (partial)** — `recordHistory` refactor | partial | `recordHistory` now returns `Promise<number>` (the version it wrote); `configUpdateOrganisationService.commitOverrideAndRecordHistory` drops the redundant SELECT MAX round-trip. Integration test file (8-case matrix) deferred. |

**Chunks deferred within Session 2 (flagged, not silent):**

- **Chunk 9 (C.5)** — wizard scan-frequency + alert-cadence controls. Schema fields confirmed present (`scanFrequencyHours`, `alertLimits`) at kickoff, but the current `OnboardingWizardPage` Step 3 shows sync progress, not a config-defaults screen; spec §10.2's assumed Screen-3 structure has diverged. UI wiring deferred; schema is ready.
- **Chunk 12 (D.3)** — `<ConfigAssistantPanel>` extraction. Spec §11.3.4 itself notes "Contract (k) is structurally honoured today" via Session 1 URL-param plumbing; the extraction is a large refactor of `ConfigAssistantPage`'s message pipeline (~500 lines). Deferred to Session 3.
- **D.1 modal rebuild** — create-org modal UX (template picker + tier toggle + live preview + organisations.tier migration) lands with the remaining template-aware seeding.
- **Chunk 13 integration test** — `organisationConfig.integration.test.ts` (8-case matrix) pending DB-fixture layer first-classed in the test infra.
- **Chunk 8 dual-path UX wire-up** into `ConfigAssistantPage` message pipeline — component + parser ready; pipeline currently filters tool_result messages entirely, wiring lands with the D.3 panel extraction.
- **GHL `merge-field-vocabulary` endpoint** — static token list ships; dynamic endpoint deferred.
- **On-call recipient role audit** — `notify_operator` preset falls back to "all org members" until the audit lands.
- **OAuth refresh-on-expire for apiAdapter** — adapter reads `access_token` directly from `integration_connections`; refresh semantics pending Session 3.

**Ship-gate matrix:**

| Gate | Status | Verification |
|------|--------|--------------|
| S2-6.1 (apiAdapter GHL wiring) | passed | Pure classifier 10/10, precondition gate live, migration 0185 landed |
| S2-6.2 (Live-data pickers) | passed | 5 routes + service + 4 editor rewires; typecheck baseline held |
| S2-6.3 (Drilldown page) | passed | Outcome-badge pure 11/11, 4 routes + page + 4 components |
| S2-8.1 (Outcome-weighted recommendation) | passed | Pure decision function 8/8 + aggregation query + recommendedReason surfaced |
| S2-8.3 (notify_operator fan-out) | passed | Availability+plan pure 8/8 + 3 channel adapters + skillExecutor rewire |
| S2-8.4 (Typed templates editor) | passed | List+edit form + 5 per-actionType sub-editors + round-trip module |
| B6 (Dual-path UX copy) | passed | Component + parser + ConfigAssistantPage wire-up all shipped; renders the latest config_update tool result inline in the message list |
| S2-D.1 (createFromTemplate) | partial | Core service method + audit event; modal rebuild deferred |
| S2-D.2 (9 typed editors) | passed | 9 editors + 2 shared primitives + Settings page dispatcher |
| S2-D.3 (Panel extraction) | deferred | Session 1 URL-param plumbing remains valid per spec §11.3.4 |
| S2-D.4 (Integration test + recordHistory) | partial | recordHistory returns version; integration test deferred |

**Sanity gate (final run):**
- Server typecheck: **43 = baseline** (zero new errors across 12 commits).
- Client typecheck: **11 = baseline** (zero new errors).
- Pure tests: classifier (10), drilldownOutcomeBadge (11), recommendedIntervention (8), notifyOperatorFanout availability (8) — all green.

**Post-ship pr-reviewer follow-ups (commit TBD, 2026-04-20):**

pr-reviewer run against `170f560^..HEAD` (log at `tasks/pr-review-log-clientpulse-session-2-2026-04-20T072618Z.md`) raised 4 blockers + 5 high-priority items. All code-level findings resolved:

- **B-1** — `drilldownService.getSignals` now filters `clientPulseSignalObservations` on `organisationId` + `subaccountId`.
- **B-2** — `POST /interventions/propose` now requires `ORG_PERMISSIONS.AGENTS_EDIT`; `GET /intervention-context` now requires `ORG_PERMISSIONS.AGENTS_VIEW`; 400 response on propose now includes Zod `issues`.
- **B-3** — `resolveGhlContext` now filters `integrationConnections` on `organisationId` (was silently ignoring the parameter).
- **H-1** — dead `pickRecommendedActionType` removed from `clientPulseInterventionContextService.ts`.
- **H-2** — `createOrganisationFromTemplate` now routes through `configHistoryService.recordHistory` instead of direct insert (sensitive-field stripping + graceful version derivation).
- **H-3** — `deliverInApp` now returns `status: 'skipped_not_configured'` with honest errorMessage — was reporting `delivered` for zero-delivery calls, creating misleading audit rows.
- **H-4** — `apiAdapter.execute` logs structured `apiAdapter.token_expired` / `apiAdapter.token_near_expiry` warnings when `tokenExpiresAt` is in the past or within 5 minutes (defensive trace pending full OAuth refresh-on-expire in Session 3).
- **N-1** — priority inversion at `clientPulseInterventionContextService:174` now carries a comment explaining the config-priority ↔ sort-key bridge.
- **N-3** — `crmLiveDataService` cache now enforces `MAX_CACHE_ENTRIES = 500` with oldest-insertion eviction.

**B-4 and H-5** (test-layer acceptance gaps) are re-classified — see "Session 3 acceptance-test gates" below.

**External-reviewer audit follow-ups (commits 2a295bb + 1d8c132, 2026-04-20):**

A final external review highlighted edge-condition concerns around idempotency canonicalisation, observability of precondition blocks, and the retry-vs-replay boundary. Three fixes landed:

- **Canonical JSON (concern #1).** `computeValidationDigest` and `hashActionArgs` had been using `JSON.stringify(payload, Object.keys(payload).sort())`. The 2nd arg to `JSON.stringify` is an allowlist applied at every depth — nested keys not in the top-level sorted list were silently dropped. Replaced with a recursive `canonicaliseJson` walker that sorts object keys at every level and preserves array order. Latent at the time (nothing writes `validationDigest` at propose-time yet) but the function itself was wrong.
- **Present-vs-absent trap (concern #1 continued).** `{ contactId: 'c1' }` and `{ contactId: 'c1', replyToAddress: undefined }` were hashing differently, so two callers with the same logical intent could bypass the dedup layer. Fix: `canonicaliseJson` filters out object properties with `undefined` values before emit, matching `JSON.stringify`'s default behaviour. Explicit `null` stays distinct — null is semantically meaningful ("explicitly unset") whereas undefined-vs-absent is a JS surface accident.
- **Precondition-gate observability (concern #8).** `executionLayer.precondition_block` structured log lines now emit on every block path (`drift_detected`, `timeout_budget_exhausted`, `concurrent_execute`) with `actionId`, `organisationId`, `subaccountId`, and reason — complements the existing `execution_failed` action_event row with an ops-greppable dispatch-time signal.
- **Retry-vs-replay boundary (concern #2).** `buildActionIdempotencyKey` now carries a prominent contract comment: retry (same logical attempt) → same key → row reused; replay (new attempt after terminal failure) → new key → new row with `replay_of_action_id` pointing at the original. Pinned inline to prevent future drift.

Pure tests: `actionServiceCanonicalisationPure.test.ts` (9 cases) covers top-level order, nested order, array positional semantics, deep nesting, `hashActionArgs` parity, null/undefined/empty-object distinction, present-vs-absent trap (omitted = undefined, omitted ≠ explicit null, recursive).

Reviewer's final verdict: "merge-ready territory... no structural issues left."

**Session 3 acceptance-test gates (named targets, target session: Session 3):**

| Gate | Target file | Reason deferred |
|------|-------------|-----------------|
| S2-D.4 test | `server/routes/__tests__/organisationConfig.integration.test.ts` (8-case matrix) | Pending first-class DB-fixture layer in server test infra; `recordHistory` version-return contract (the other half of S2-D.4) shipped |
| S2-D.1 test | `server/services/__tests__/organisationServiceCreateFromTemplate.test.ts` (4-invariant) | Pending same DB-fixture layer; the service method itself shipped in Chunk 10 |
| H-4 full close | `server/services/adapters/apiAdapter.ts` — `ghlOAuthService.getValidToken()` call before dispatch | Requires `ghlOAuthService` audit + refresh wiring; defensive log warning shipped in audit commit |
| N-3 Redis upgrade | `server/services/crmLiveDataService.ts` — Redis backend | Per spec §14.3; max-size cap shipped as interim safety |
| N-5 / Chunk 8 wire-up | `client/src/pages/ConfigAssistantPage.tsx` — tool_result message pipeline | Lands with D.3 panel extraction per spec §11.3.4 |

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
