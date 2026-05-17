# Wave 6 Session P — knip.json entry additions (rationale)

The launch prompt requires every FALSE-POSITIVE knip entry to carry a WHY comment. Since `knip.json` is strict JSON (`scripts/lib/check-knip-config.mjs` uses `JSON.parse`, so JS-style comments would break the gate), the rationale lives here.

Every entry below was added in chunk F of `claude/wave-6-knip-candidate-triage`. Each row matches one entry in `knip.json`'s `entry` array.

## Shell-spawned helpers (knip can't trace shell-spawn boundaries)

| Entry | Why |
|---|---|
| `scripts/lib/check-handler-registry-verdicts.mjs` | Spawned by `scripts/verify-handler-registry-fixture.sh:180` via `node <path>` — knip's static graph stops at the JS module boundary. |
| `scripts/lib/check-knip-config.mjs` | Spawned by `scripts/verify-knip-config.sh:24` via `KNIP_CONFIG_FILE=<path> node …` — same shell-spawn pattern. |

## Glob-loaded modules (knip can't trace filesystem-scan loaders)

| Entry | Why |
|---|---|
| `server/workflows/*.workflow.ts` | Loaded at runtime via `*.workflow.ts` glob in `scripts/seed.ts:612` and `scripts/validate-playbooks.ts:20`. Never appears in a static `import` statement. |

## Bash-gate file dependencies (file is parsed AS DATA by a gate, not imported as a module)

| Entry | Why |
|---|---|
| `shared/types/errorCodes.ts` | Bash gate `scripts/verify-error-code-taxonomy.sh:40` reads this file as the canonical `CODES_FILE` taxonomy. Migration plan CHATGPT-R3-2-V2 is migrating runtime callsites to import from it. Deleting it would silently break the gate. |
| `shared/types/systemIncidentEvent.ts` | Bash gate `scripts/verify-event-type-registry.sh:30` reads this file as the canonical event-type CANONICAL union. Hard gate dependency. |
| `server/db/rlsExclusions.ts` | Bash gate `scripts/verify-rls-coverage.sh` (invoked via `scripts/run-all-gates.sh:84`) reads this file as the canonical RLS-exclusion registry. Documented in `architecture.md` and `server/db/schema/index.ts` comments. |

## Spec-anchored contracts (canonical SoT files cited by specs; runtime adoption pending)

| Entry | Why |
|---|---|
| `server/lib/canonicaliseUrl.ts` | Reporting Agent spec v3.4 §6.7.2 names this as fingerprint-dedup single source of truth. Preserve pending Reporting Agent feature ship. |
| `server/tools/meta/types.ts` | 3-line type-only re-export shim documented as cycle-break in `feat-split-skillexecutor §5.1`. Preserve until cycle-guard fate confirmed. |
| `shared/types/capabilityMap.ts` | Canonical JSONB shape contract per `personal-assistant-v2-operator` spec §5.1. Runtime shape lives in service. |
| `shared/types/slackAction.ts` | Canonical Slack schema location per `personal-assistant-v1` spec §7.3. Awaiting handler wiring. |

## Spec-backed features (backend live; client wiring deferred to a UI-focused follow-up build)

### Sub-account Optimiser dashboard (sub-account-optimiser-spec.md F2 Phase 4)

`<docs/capabilities.md:565>` documents the optimiser as a live capability. F2 Phase 0 shipped (PR #251 / migration 0267). Backend route is live at `/api/recommendations` (`server/index.ts:480`). Phase 4 — dashboard wiring — is pending.

| Entry | Role |
|---|---|
| `client/src/components/recommendations/AgentRecommendationsList.tsx` | The list section to be rendered on Home dashboard. Transitively covers `AgentRecommendationsListPure.ts` (its sole-non-test consumer). |
| `client/src/hooks/useAgentRecommendations.ts` | Data hook for the list. |
| `client/src/hooks/useAgentRecommendationsTotal.ts` | Count badge hook. |

### Agent presence SSE client (agent-workspace-implementation-brief.md §389 + ADR-0008)

Backend SSE endpoints are live at `/api/agent-presence/stream/*` (`server/routes/agentPresenceStream.ts` mounted at `server/index.ts:506`). The client SSE plumbing exists but is not consumed by any rendered surface yet.

| Entry | Role |
|---|---|
| `client/src/hooks/useAgentPresence.ts` | Per-agent presence hook (named in spec §389 as load-bearing). |
| `client/src/hooks/useWorkspacePresence.ts` | Workspace-scoped variant. |
| `client/src/lib/agentPresenceStream.ts` | ADR-0008 SSE client lib that the hooks import. |

### Operator-backend modals (operator-backend-spec.md Spec D)

Backend APIs are live (e.g., `extendBudget` per `server/routes/agentInbox.ts`). The modal UX integration into operator workflows is pending UX validation.

| Entry | Role |
|---|---|
| `client/src/components/operator/OperatorBudgetExceededModal.tsx` | Spec D R8 modal pattern. |
| `client/src/components/operator/OperatorConcurrencyLimitModal.tsx` | Same cluster. |
| `client/src/components/operator/OperatorUnavailableModal.tsx` | Same cluster. |

### Rules conflict resolution (rules-conflict-resolution-spec)

Backend `ruleConflictDetectorService` is live and emits `RuleConflictReport`. The dialog component is authored but the trigger UX (when to surface the dialog) is pending.

| Entry | Role |
|---|---|
| `client/src/components/rules/RuleConflictResolutionDialog.tsx` | The dialog surface. |

### System-incidents diagnosis cluster (system-monitoring-coverage-spec §10.3/§10.4)

Backend writes `agent_diagnosis_run_id` + diagnosis events; client surface to render them in `IncidentDetailDrawer` is pending.

| Entry | Role |
|---|---|
| `client/src/components/system-incidents/DiagnosisAnnotation.tsx` | spec §10.3 |
| `client/src/components/system-incidents/DiagnosisFilterPill.tsx` | spec §10.3 |
| `client/src/components/system-incidents/FeedbackWidget.tsx` | spec §10.4 |
| `client/src/components/system-incidents/InvestigatePromptBlock.tsx` | diagnosis-investigate block |

### Home dashboard reactivity (home-dashboard-reactivity plan + clientpulse-ui-simplification §2.3.1)

Components extracted from `DashboardPage` ahead of the dashboard rewrite; the rewrite never landed.

| Entry | Role |
|---|---|
| `client/src/components/dashboard/OperationalMetricsPlaceholder.tsx` | "Piece 3 layout reservation" — renders `null` by design. |
| `client/src/components/dashboard/QueueHealthSummary.tsx` | Extracted with `refreshToken` prop per home-dashboard-reactivity plan. |
| `client/src/components/dashboard/WorkspaceFeatureCard.tsx` | clientpulse-ui-simplification §2.3.1 / §3.4.6. |

### Trust-verification scorecards (trust-verification-spec §11.3 + §12.2)

Two-stage skill-create flow + agent scorecard tab + creation section authored; route mount + tab wiring pending.

| Entry | Role |
|---|---|
| `client/src/pages/agents/AgentCreateScorecardSection.tsx` | §12.2 — agent-create flow embed. |
| `client/src/pages/agents/AgentEditScorecardTab.tsx` | §12.2 — `AgentEditPage` scorecard tab. |

### Govern row actions (consolidation-govern-spec §4.9 + operator-session-identity-spec Chunk 7)

| Entry | Role |
|---|---|
| `client/src/pages/govern/components/ConnectionTestButton.tsx` | §4.9 — ConnectionsPage row action. |
| `client/src/pages/govern/components/DisclosureVersionBumpModal.tsx` | Chunk 7 — AI Subscriptions consent re-ack. |

### Agentic commerce SPT onboarding (pre-launch-phase-3-deferred-backlog)

Operator confirmed KEEP. Agentic-commerce build deferred to pre-launch-phase-3 backlog; preserve file pending reactivation.

| Entry | Role |
|---|---|
| `client/src/pages/SptOnboardingPage.tsx` | Stripe Provisioning Tenant onboarding flow (agentic-commerce build §spec). |

### Skill-create two-stage flow (trust-verification-layer-spec §11.3 / §14)

Two-stage flow (Describe → Runtime check suggestion) is implemented end-to-end on backend + page. The route mount is non-trivial — current information architecture scopes skills to subaccount (`/admin/subaccounts/:subaccountId/skills`) and system (`/system/skills`); a top-level `/skills/create` doesn't fit. Wiring decision is UX-laden and deferred.

| Entry | Role |
|---|---|
| `client/src/pages/skills/SkillCreatePage.tsx` | The two-stage skill creation page. |

### systemMonitor seed data (migration 0233 SoT)

Migration 0233 header line 8 declares this file as "single source of truth for all seed data" for the 11 system_skills rows the system-monitoring-agent calls. Migrations 0234-0236 originally seeded these; relocated here for co-location with the rest of seed pipeline. Pending wiring: `scripts/seed.ts` should consume `SYSTEM_MONITOR_SKILL_SEEDS`. Until then, preserve the SoT.

| Entry | Role |
|---|---|
| `scripts/lib/systemMonitorSeed.ts` | Canonical seed data for system_monitor skill rows. |

### Wave-5 RLS migration overlap (defer to Session O — wave-5 follow-up)

Both files are listed in `tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md` as Tier 1 Chunk 14 RLS migration targets. Session O will determine whether they survive the migration (with new tenant scoping) or are also dropped as dead code. Preserve until Session O ships, to avoid merge conflicts.

| Entry | Role |
|---|---|
| `server/services/agentTemplateService.ts` | Session O Tier 1 RLS migration target. |
| `server/services/trustCalibrationService.ts` | Session O Tier 1 RLS migration target. |

### Worker browser subsystem (defer to iee-worker-retirement build)

Operator decision Dec.3. `tasks/builds/iee-worker-retirement/spec.md` (drafted 2026-05-17) plans to retire the entire `worker/` directory in a single bulk-delete. Listing the 9 files here keeps knip green during the interim and ensures the iee-worker-retirement build deletes them coherently (not fragmented across Session P + Session iee).

| Entry | Role |
|---|---|
| `worker/src/browser/artifactValidator.ts` | Worker browser subsystem — iee-worker-retirement target. |
| `worker/src/browser/captureStreamingVideo.ts` | Same. |
| `worker/src/browser/contractEnforcedPage.ts` | Same. |
| `worker/src/browser/executor.ts` | Same. |
| `worker/src/browser/login.ts` | Same. |
| `worker/src/browser/observe.ts` | Same. |
| `worker/src/browser/playwrightContext.ts` | Same. |
| `worker/src/lib/uploadArtifact.ts` | Same. |
| `worker/src/persistence/integrationConnections.ts` | Same. |

## Follow-up

A new `tasks/todo.md` item — "Wave 6 follow-up: wire deferred spec-backed UI surfaces" — tracks the actual wiring work, grouped by spec. Each entry above lists the spec section to consult when picking up the wiring work.
