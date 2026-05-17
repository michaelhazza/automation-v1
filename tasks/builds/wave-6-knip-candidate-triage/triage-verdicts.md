# Wave 6 Session P — knip candidate triage verdicts (chunk 0)

**Branch:** `claude/wave-6-knip-candidate-triage`
**Baseline:** `npx knip` on `claude/wave-6-knip-candidate-triage` (= `origin/main` at HEAD `9fdcabd7`, post-PR #341)
**Knip raw output:** `tasks/builds/wave-6-knip-candidate-triage/knip-baseline.txt` (184 unused files; 562 unused exports; 473 unused exported types; 18 duplicate exports)
**Date:** 2026-05-17
**Status:** OPERATOR APPROVED 2026-05-17 — see § 8 for final post-review verdicts and execution plan.

## Table of contents

1. Summary
2. Operator decision points (Dec.1/2/3)
3. Per-file verdicts
   - 3a. Client — components (top-level + agent-run-chat)
   - 3b. Client — components (subdirs, page-split cluster)
   - 3c. Client — components (mid-Z subdirs)
   - 3d. Client — config / hooks / lib / pages
   - 3e. Server — top-level + scripts + worker + shared
   - 3f. Server — services
4. FALSE-POSITIVE mechanism summary (chunk F `knip.json` patch)
5. DEFER items not covered by Dec.1/2/3
6. Proposed chunk plan (after operator approval)
7. Acceptance criteria

---

## 1. Summary

| Verdict | Count | Action |
|---|---|---|
| DELETE | 73 | Remove file in chunk D (split by subdomain to keep each commit ≤ 30 files) |
| WIRE | 30 | Add route mount / lazy import / pg-boss registration in chunk W |
| FALSE-POSITIVE | 8 | Add to `knip.json` `entry` with WHY comment in chunk F |
| DEFER | 73 | Operator decides (see § 2 *Operator decision points*) |
| **Total** | **184** | matches `Unused files (184)` in knip-baseline.txt |

The 73 DEFERs are not random: 35 cluster into **3 operator-level decisions** that resolve them in batches.

---

## 2. Operator decision points

Three high-level go/no-go calls collapse 35 of the 73 DEFERs into bulk verdicts. Make these first.

### Decision 1 — Page-split orphan cascade (~35 files, ~12 orphan pages + downstream)

The 2026-05-15 page-splits commit (`f957f3f2`) extracted leaf components from monolith pages, but the consolidation-2026-05-06 effort then routed several of these pages to successor pages and the split leaves were never re-wired. Specifically, these pages exist on disk with `export default function` but are NOT in `client/src/App.tsx` lazy-import list (route to them is a `<Navigate>` redirect to the successor):

- `pages/AgentsPage.tsx` (superseded by `pages/build/AgentsListPage`)
- `pages/BriefDetailPage.tsx` (route `/admin/briefs/:id` redirects to `OpenTaskView`)
- `pages/McpServersPage.tsx` (route `/admin/mcp-servers` redirects to `/connections`)
- `pages/SubaccountKnowledgePage.tsx` (route redirects to govern `KnowledgePage`)
- `pages/SubaccountAgentsPage.tsx` (consolidated into `AdminSubaccountsPage`)
- `pages/SpendLedgerPage.tsx` (redirects to govern `SpendingPage`)
- `pages/HierarchyTemplatesPage.tsx` / `OrgAgentConfigsPage.tsx` / `ConnectorConfigsPage.tsx` / `AdminPermissionSetsPage.tsx` / `AdminSettingsPage.tsx` / `IntegrationsAndCredentialsPage.tsx` / `ProjectsPage.tsx` (all redirect to successors)

These pages + their orphan-via-orphan-parent leaves total **~35 files**:

- `client/src/components/baseline/{2 files}` (consumed only by SubaccountKnowledgePage)
- `client/src/components/brief-artefacts/{9 files}` (consumed only by BriefDetailPage)
- `client/src/components/subaccount-knowledge/{6 files}` (consumed only by SubaccountKnowledgePage)
- `client/src/components/subaccount-agents/{3 files}` (consumed only by SubaccountAgentsPage)
- `client/src/components/spend/{7 files}` (consumed only by SpendLedgerPage)
- `client/src/components/run-trace/DelegationGraphView.tsx` (consumed only by BriefDetailPage)
- `client/src/components/{BriefLabel,McpCatalogue,McpToolBrowser,TeamHeartbeatView,RichTextEditor}` (single-orphan-page consumers)
- `client/src/components/workspace/OnboardAgentModal.tsx` (consumed only by SubaccountAgentsPage)
- `client/src/lib/{briefArtefactLifecycle,runPlanView}.ts` (consumed only by orphan pages)

**Operator question 1:** All of these orphan pages have explicit successor routes/redirects in App.tsx. Confirm: **DELETE the orphan page + its entire downstream leaf cluster as one bulk per orphan page.** (Recommended.)

- If yes → these ~35 files all become DELETE.
- If no (you want to revive any orphan page) → tell me which pages; those become WIRE; the rest still DELETE.

### Decision 2 — systemMonitor subsystem (~24 files, all-or-nothing)

`server/services/systemMonitor/*` (19 files: baselines/4, heuristics/2, synthetic/11, triage/3) plus the 4 wrapper jobs at `server/jobs/systemMonitor{Triage,Sweep,SyntheticChecks,BaselineRefresh}Job.ts` plus `scripts/lib/systemMonitorSeed.ts` form a single subsystem.

Internal references are intact (synthetic checks are registered in `synthetic/index.ts`; jobs import handlers from the services tree). What's broken: **the four jobs are NOT registered in `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts`** — only `system-monitor-self-check` is registered. So nothing in this subsystem ever runs at runtime.

The skill-executor side (`systemMonitorShells.ts` → `skills/readBaseline.ts`, `skills/readHeuristicFires.ts`) IS live but queries the DB directly and does not import any of the candidate files.

**Operator question 2:** Was the system-monitoring-agent's active-monitoring layer (jobs + scheduled checks) **(a) supposed to be registered as part of Phase 2 (registration is the missing wire), (b) intentionally descoped (delete the whole subsystem), or (c) on hold (keep all files; add to knip.json entry with a WHY comment)?**

- If (a) → 19 services + 4 jobs + seed = 24 files become WIRE; chunk W adds pg-boss registrations.
- If (b) → all 24 files become DELETE.
- If (c) → all 24 files become FALSE-POSITIVE; add `server/services/systemMonitor/**/*.ts` glob to knip entry with a comment naming the design doc.

### Decision 3 — Worker browser subsystem (9 files)

`worker/src/browser/*` (7 files) + `worker/src/lib/uploadArtifact.ts` + `worker/src/persistence/integrationConnections.ts` are all flagged. A draft spec `tasks/builds/iee-worker-retirement/spec.md` (also landed today, 2026-05-17 in PR #341) lays out a plan to delete the entire `worker/` directory.

**Operator question 3:** Is `iee-worker-retirement` going to ship before or after Session P? If iee-worker-retirement ships first or concurrently, **all 9 files DEFER to that build** (don't duplicate the delete). If it's not yet planned, this session can DELETE them as a unit per the spec's §2 inventory.

Recommended verdict: DEFER all 9 to `iee-worker-retirement` to keep the cleanup in one place.

---

## 3. Per-file verdicts

### 3a. Client — components (top-level + agent-run-chat)

| File | Verdict | Rationale |
|---|---|---|
| client/src/api/goals.ts | DELETE | Zero importers; `GoalsPage` was replaced by `<Navigate>` redirect per App.tsx:483 |
| client/src/components/agent-run-chat/AgentRunChatPane.tsx | DELETE | Zero importers; built 2026-04-22 but never wired; spec scaffolding |
| client/src/components/BriefLabel.ts | DELETE (via Dec.1) | Imported by orphan BriefDetailPage only |
| client/src/components/ClarificationInbox.tsx | DELETE | Only "reference" is a comment in `MemoryReviewQueuePage.tsx:8`; no import; spec S8 surface unwired |
| client/src/components/DropZone.tsx | DELETE | Zero importers; server matches are unrelated `DropZoneProcessing*` schema types |
| client/src/components/EmailChannelTile.tsx | DELETE | Zero importers; mini-cluster with EmailConfigEditor + EmailConfigSetupCard |
| client/src/components/EmailConfigEditor.tsx | DELETE | Only consumer is sibling EmailChannelTile (unwired) — delete cluster as one |
| client/src/components/EmailConfigSetupCard.tsx | DELETE | Same cluster as EmailChannelTile |
| client/src/components/ExecutionPlanPane.tsx | DELETE | All matches are COMMENT-ONLY mentions; no actual import |
| client/src/components/HealthAuditWidget.tsx | DELETE | Zero importers; brain-tree-os P4 dashboard never wired |
| client/src/components/InvocationChannelTile.tsx | DELETE | Only consumer is sibling InvocationsCard (also orphan) |
| client/src/components/InvocationsCard.tsx | DEFER | Touched 2026-05-15 in page-splits #313; no consumers; may be mid-migration |
| client/src/components/McpCatalogue.tsx | DELETE (via Dec.1) | Imported only by orphan McpServersPage |
| client/src/components/McpToolBrowser.tsx | DELETE (via Dec.1) | Imported only by orphan McpServersPage |
| client/src/components/MemoryInspectorChat.tsx | DELETE | Zero importers; spec S13 surface never wired |
| client/src/components/PortalConfigEditor.tsx | DELETE | Zero importers; spec S16/S17 surface never wired |
| client/src/components/RichTextEditor.tsx | DELETE (via Dec.1) | Imported only by ReferencesTab → orphan SubaccountKnowledgePage |
| client/src/components/SchedulePicker.tsx | DELETE | Zero client importers; only matches are docs/server-side comments |
| client/src/components/TeamHeartbeatView.tsx | DELETE (via Dec.1) | Imported only by orphan AgentsPage |
| client/src/components/TeamPicker.tsx | DELETE | Pure name collision with StartingTeamPicker; no actual import |
| client/src/components/TraceChainSidebar.tsx | DELETE | Only matches are COMMENT references; no import |
| client/src/components/TraceChainTimeline.tsx | DELETE | Only matches are COMMENT references; no import |

### 3b. Client — components (subdirs, page-split cluster)

| File | Verdict | Rationale |
|---|---|---|
| client/src/components/baseline/BaselineArtefactsStatusBadge.tsx | DELETE (via Dec.1) | Orphan via SubaccountKnowledgePage |
| client/src/components/baseline/EditArtefactDrawer.tsx | DELETE (via Dec.1) | Orphan via SubaccountKnowledgePage |
| client/src/components/brief-artefacts/ApprovalCard.tsx | DELETE (via Dec.1) | Orphan via BriefDetailPage |
| client/src/components/brief-artefacts/ApprovalSuggestionPanel.tsx | DELETE (via Dec.1) | Phase 8/W3c surface; orphan via BriefDetailPage cluster |
| client/src/components/brief-artefacts/BudgetContextStrip.tsx | DELETE (via Dec.1) | Orphan via BriefDetailPage |
| client/src/components/brief-artefacts/BudgetContextStripPure.ts | DELETE (via Dec.1) | Lives/dies with BudgetContextStrip |
| client/src/components/brief-artefacts/ClarifyingQuestionsCard.tsx | DELETE (via Dec.1) | Orphan via BriefDetailPage cluster |
| client/src/components/brief-artefacts/ConfidenceBadge.tsx | DELETE (via Dec.1) | Orphan via BriefDetailPage cluster |
| client/src/components/brief-artefacts/ErrorArtefactCard.tsx | DELETE (via Dec.1) | Orphan via BriefDetailPage |
| client/src/components/brief-artefacts/RulesAppliedPanel.tsx | DELETE (via Dec.1) | Orphan via BriefDetailPage cluster |
| client/src/components/brief-artefacts/StructuredResultCard.tsx | DELETE (via Dec.1) | Orphan via BriefDetailPage |
| client/src/components/dashboard/OperationalMetricsPlaceholder.tsx | DEFER | Header says "Piece 3 layout reservation" — placeholder by design; operator: keep or delete? |
| client/src/components/dashboard/QueueHealthSummary.tsx | DEFER | Extracted from a parent in clientpulse-ui-simplification; never re-wired |
| client/src/components/dashboard/WorkspaceFeatureCard.tsx | DEFER | Created by clientpulse-ui-simplification (#264); never re-wired |
| client/src/components/invocations-card/AccordionRow.tsx | DEFER | Consumed only by InvocationsCard (also DEFER) |
| client/src/components/invocations-card/HeartbeatTimeline.tsx | DEFER | Consumed only by InvocationsCard (also DEFER) |

### 3c. Client — components (mid-Z subdirs)

| File | Verdict | Rationale |
|---|---|---|
| client/src/components/openTask/AskFormCardPlaceholder.tsx | DELETE | Sibling AskFormCard wired; this placeholder stub has zero callers |
| client/src/components/operator/OperatorBudgetExceededModal.tsx | WIRE | Backend `extendBudget` API exists; modal unused; spec D operator UX incomplete |
| client/src/components/operator/OperatorConcurrencyLimitModal.tsx | WIRE | operator-backend spec D in progress; backend exists |
| client/src/components/operator/OperatorUnavailableModal.tsx | WIRE | operator-backend Phase D unfinished wire-up |
| client/src/components/pulse/ActionBar.tsx | DELETE | Pulse retired (App.tsx L494 redirects /admin/pulse to /); whole dir DELETE |
| client/src/components/pulse/Card.tsx | DELETE | Pulse retired |
| client/src/components/pulse/HistoryTab.tsx | DELETE | Pulse retired |
| client/src/components/pulse/Lane.tsx | DELETE | Pulse retired |
| client/src/components/pulse/MajorApprovalModal.tsx | DELETE | Pulse retired |
| client/src/components/recommendations/AgentRecommendationsList.tsx | DEFER | Test references "DashboardPageOptimiserSection" — orphan-via-removed-parent; operator: wire-or-delete? |
| client/src/components/rules/RuleConflictResolutionDialog.tsx | WIRE | Backend `ruleConflictDetectorService` + types exist; UI dialog authored but never imported |
| client/src/components/run-trace/DelegationGraphView.tsx | DELETE (via Dec.1) | Only caller is orphan BriefDetailPage |
| client/src/components/spend/ConservativeDefaultsButton.tsx | DELETE (via Dec.1) | Orphan via SpendLedgerPage |
| client/src/components/spend/EmptyAllowlistBanner.tsx | DELETE (via Dec.1) | Orphan via SpendLedgerPage |
| client/src/components/spend/KillSwitchPanel.tsx | DELETE (via Dec.1) | Orphan via SpendLedgerPage |
| client/src/components/spend/PromotePolicyConfirmationModal.tsx | DELETE (via Dec.1) | Orphan via SpendLedgerPage |
| client/src/components/spend/RetryGroupRow.tsx | DELETE (via Dec.1) | Orphan via SpendLedgerPage |
| client/src/components/spend/ShadowRetentionConfigSection.tsx | DELETE (via Dec.1) | Orphan via SpendLedgerPage |
| client/src/components/spend/TopBlockReasonsPanel.tsx | DELETE (via Dec.1) | Orphan via SpendLedgerPage |
| client/src/components/subaccount-agents/RoleBadge.tsx | DELETE (via Dec.1) | Orphan via SubaccountAgentsPage |
| client/src/components/subaccount-agents/StatusBadge.tsx | DELETE (via Dec.1) | Orphan via SubaccountAgentsPage |
| client/src/components/subaccount-agents/SubaccountTreeRow.tsx | DELETE (via Dec.1) | Orphan via SubaccountAgentsPage |
| client/src/components/subaccount-knowledge/BlocksTab.tsx | DELETE (via Dec.1) | Orphan via SubaccountKnowledgePage |
| client/src/components/subaccount-knowledge/InsightsTab.tsx | DELETE (via Dec.1) | Orphan via SubaccountKnowledgePage |
| client/src/components/subaccount-knowledge/ReferencesTab.tsx | DELETE (via Dec.1) | Orphan via SubaccountKnowledgePage |
| client/src/components/subaccount-knowledge/RenameReferenceModal.tsx | DELETE (via Dec.1) | Orphan via SubaccountKnowledgePage |
| client/src/components/subaccount-knowledge/TabButton.tsx | DELETE (via Dec.1) | Orphan via SubaccountKnowledgePage |
| client/src/components/subaccount-knowledge/types.ts | DELETE (via Dec.1) | Orphan via SubaccountKnowledgePage |
| client/src/components/system-incidents/DiagnosisAnnotation.tsx | WIRE | Wave-4 FE4 extraction didn't re-wire 4 diagnosis components; spec §10.3 expects them |
| client/src/components/system-incidents/DiagnosisFilterPill.tsx | WIRE | Same cluster — diagnosis UI authored, not imported into IncidentDetailDrawer |
| client/src/components/system-incidents/FeedbackWidget.tsx | WIRE | spec §10.4 feedback widget unwired post-FE4 split |
| client/src/components/system-incidents/InvestigatePromptBlock.tsx | WIRE | diagnosis-investigate block unwired post-FE4 split |
| client/src/components/workspace/OnboardAgentModal.tsx | DELETE (via Dec.1) | Orphan via SubaccountAgentsPage |

### 3d. Client — config / hooks / lib / pages

| File | Verdict | Rationale |
|---|---|---|
| client/src/config/capabilityGroups.ts | DELETE | Client mirror of server config; never imported; server version is live |
| client/src/hooks/useAgentPresence.ts | DEFER | No consumers; agent-workspace spec but unclear if planned for upcoming wiring |
| client/src/hooks/useAgentRecommendations.ts | FALSE-POSITIVE | Imported by `AgentRecommendationsList.tsx` (also DEFER); knip flagged via dead-parent chain |
| client/src/hooks/useAgentRecommendationsTotal.ts | DEFER | Companion to useAgentRecommendations |
| client/src/hooks/useWorkspacePresence.ts | DELETE | No consumers; agent-workspace feature shipped without it |
| client/src/lib/accessibility/announceLiveUpdate.ts | DEFER | Pure a11y helper; useful primitive — operator: keep or delete? |
| client/src/lib/agentPresenceStream.ts | DELETE | Only consumer is orphan useWorkspacePresence — cascade delete |
| client/src/lib/api/memoryBlocks.ts | DELETE | Thin re-export of listKnowledge; no consumers |
| client/src/lib/briefArtefactLifecycle.ts | DELETE (via Dec.1) | Used only by orphan BriefDetailPage |
| client/src/lib/runPlanView.ts | DELETE | Used only by orphan ExecutionPlanPane |
| client/src/pages/AdminPermissionSetsPage.tsx | DELETE (via Dec.1) | Route `/admin/permission-sets` redirects to `/admin/org-settings` |
| client/src/pages/AdminSettingsPage.tsx | DELETE (via Dec.1) | Route `/admin/settings` redirects to `/admin/org-settings` |
| client/src/pages/agents/AgentCreateScorecardSection.tsx | WIRE | trust-verification spec §12.2; meant to embed in agent-create flow |
| client/src/pages/agents/AgentEditScorecardTab.tsx | WIRE | trust-verification spec §12.2; meant to be a tab in AgentEditPage |
| client/src/pages/AgentsPage.tsx | DELETE (via Dec.1) | Replaced by `pages/build/AgentsListPage` |
| client/src/pages/BriefDetailPage.tsx | DELETE (via Dec.1) | Route redirects to OpenTaskView |
| client/src/pages/ConnectorConfigsPage.tsx | DELETE (via Dec.1) | Route redirects to /connections |
| client/src/pages/govern/components/ConnectionTestButton.tsx | WIRE | consolidation-govern spec §4.9; intended for ConnectionsPage row actions |
| client/src/pages/govern/components/DisclosureVersionBumpModal.tsx | WIRE | operator-session-identity spec Chunk 7; AI Subscriptions consent re-ack |
| client/src/pages/HierarchyTemplatesPage.tsx | DELETE (via Dec.1) | Route redirects to `/agents?tab=team-templates` |
| client/src/pages/IntegrationsAndCredentialsPage.tsx | DELETE (via Dec.1) | Consolidated into govern ConnectionsPage |
| client/src/pages/McpServersPage.tsx | DELETE (via Dec.1) | Route redirects to /connections |
| client/src/pages/OrgAgentConfigsPage.tsx | DELETE (via Dec.1) | Route redirects to `/agents?tab=org-execution` |
| client/src/pages/ProjectsPage.tsx | DELETE (via Dec.1) | Route `/projects` redirects to `/` |
| client/src/pages/skills/SkillCreatePage.tsx | WIRE | trust-verification-layer §11.3/§14 shipped two-stage flow but no `/skills/create` route |
| client/src/pages/SpendLedgerPage.tsx | DELETE (via Dec.1) | Route redirects to govern SpendingPage |
| client/src/pages/SptOnboardingPage.tsx | DEFER | Unrouted Stripe Provisioning Tenant onboarding; paused or never shipped? |
| client/src/pages/SubaccountAgentsPage.tsx | DELETE (via Dec.1) | Route redirects to `/admin/subaccounts` |
| client/src/pages/SubaccountKnowledgePage.tsx | DELETE (via Dec.1) | Route redirects to govern KnowledgePage |
| client/src/pages/SystemOrganisationTemplatesPage.tsx | DEFER | No route or successor; sibling SystemOrganisationsPage is wired |

### 3e. Server — top-level + scripts + worker + shared

| File | Verdict | Rationale |
|---|---|---|
| scripts/lib/check-handler-registry-verdicts.mjs | FALSE-POSITIVE | Invoked by `scripts/verify-handler-registry-fixture.sh:180` via shell spawn |
| scripts/lib/check-knip-config.mjs | FALSE-POSITIVE | Invoked by `scripts/verify-knip-config.sh:24` via shell spawn |
| scripts/lib/systemMonitorSeed.ts | DEFER (via Dec.2) | Migration 0233 header points to this as seed SoT; tied to systemMonitor decision |
| server/db/rlsExclusions.ts | DEFER | Heavily referenced in architecture.md as canonical registry; awaiting gate consumer |
| server/jobs/skillIdempotencyKeysCleanupJob.ts | DEFER | Header claims "scheduled daily 05:30 UTC in queueService.ts" but handler never registered |
| server/jobs/systemMonitorBaselineRefreshJob.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/jobs/systemMonitorSweepJob.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/jobs/systemMonitorSyntheticChecksJob.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/jobs/systemMonitorTriageJob.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/lib/briefVisibility.ts | DELETE | Pure re-export shim; service was extracted; all callers now import service directly |
| server/lib/canonicaliseUrl.ts | DEFER | Reporting Agent spec v3.4 §6.7.2 names this as fingerprint-dedup SoT |
| server/lib/workflow/index.ts | DELETE | Barrel re-export; consumers import submodules directly |
| server/lib/workflowLogger.ts | DELETE | `workflowLog` exported but no caller; engine never adopted it |
| server/processors/budgetGuardrail.ts | DELETE | `budgetGuardrailProcessor` no-op stub; never imported |
| server/routes/agentTemplates.ts | DELETE | Mount removed at `server/index.ts:365`; source orphaned |
| server/routes/orgWorkspace.ts | DELETE | Mount removed; handler returns 501 stubs |
| server/schemas/common.ts | DELETE | `uuidParam` etc. exported but no consumer |
| server/schemas/index.ts | DELETE | Barrel; consumers import schemas directly |
| server/tests/services/agentRunCancelService.unit.ts | DELETE | `*.unit.ts` not in vitest config glob; self-doc says "run via npx tsx" — standalone, not in harness |
| server/tools/meta/types.ts | DEFER | 3-line type-only re-export shim created for cycle-break in feat-split-skillexecutor §5.1 |
| server/workflows/event-creation.workflow.ts | FALSE-POSITIVE | Loaded via glob `*.workflow.ts` by scripts/seed.ts:612 |
| server/workflows/intelligence-briefing.workflow.ts | FALSE-POSITIVE | Same glob loader |
| server/workflows/weekly-digest.workflow.ts | FALSE-POSITIVE | Same glob loader |
| shared/types/capabilityMap.ts | DEFER | personal-assistant-v2-operator spec §5.1; future-use spec scaffolding |
| shared/types/errorCodes.ts | FALSE-POSITIVE | `scripts/verify-error-code-taxonomy.sh:40` reads this file as canonical CODES_FILE |
| shared/types/slackAction.ts | DEFER | personal-assistant-v1 spec §7.3 names canonical Slack schema location |
| shared/types/systemIncidentEvent.ts | FALSE-POSITIVE | `scripts/verify-event-type-registry.sh:30` reads this file as canonical CANONICAL union |
| worker/src/browser/artifactValidator.ts | DEFER (via Dec.3) | Tied to iee-worker-retirement |
| worker/src/browser/captureStreamingVideo.ts | DEFER (via Dec.3) | Tied to iee-worker-retirement |
| worker/src/browser/contractEnforcedPage.ts | DEFER (via Dec.3) | Tied to iee-worker-retirement |
| worker/src/browser/executor.ts | DEFER (via Dec.3) | Tied to iee-worker-retirement |
| worker/src/browser/login.ts | DEFER (via Dec.3) | Tied to iee-worker-retirement |
| worker/src/browser/observe.ts | DEFER (via Dec.3) | Tied to iee-worker-retirement |
| worker/src/browser/playwrightContext.ts | DEFER (via Dec.3) | Tied to iee-worker-retirement |
| worker/src/lib/uploadArtifact.ts | DEFER (via Dec.3) | Tied to iee-worker-retirement |
| worker/src/persistence/integrationConnections.ts | DEFER (via Dec.3) | Tied to iee-worker-retirement |

### 3f. Server — services

| File | Verdict | Rationale |
|---|---|---|
| server/services/adminOpsService.ts | DELETE | SDR/finance stubs; zero callers; never wired |
| server/services/agentTemplateService.ts | DEFER | Listed in Session O Chunk 14 Tier 1 RLS bulk migration (`wave-5-prevention-gates-and-rls/tier-categorisation.md`) — overlap |
| server/services/alertFatigueGuard.ts | DELETE | Class has zero callers; only base class used (by systemIncidentFatigueGuard, also dead) |
| server/services/briefArtefactBackstop.ts | DELETE | Impure wrapper unused; live consumption uses Pure variant |
| server/services/bundleResolutionService.ts | DELETE | Only caller is dead cachedContextOrchestrator |
| server/services/bundleResolutionServicePure.ts | DELETE | Only used inside dead cached-context cluster |
| server/services/cachedContextOrchestrator.ts | DELETE | Zero callers; orphan root of dead cached-context cluster |
| server/services/configAssistantModeService.ts | DELETE | Zero callers; memory-and-briefings build planned but never wired |
| server/services/contextAssemblyEngine.ts | DELETE | Only caller is dead cachedContextOrchestrator; live code uses Pure variant |
| server/services/crmQueryPlanner/resultNormaliser.ts | DELETE | Re-export barrel; live callers use Pure variant directly |
| server/services/crossOwnerDelegationRequestAssembler.ts | DELETE | Impure wrapper unused; live consumption uses Pure variant |
| server/services/dataRetentionService.ts | DELETE | Zero callers; no pg-boss schedule registers it |
| server/services/executionBudgetResolver.ts | DELETE | Only caller is dead cachedContextOrchestrator |
| server/services/executionBudgetResolverPure.ts | DELETE | Only consumed by dead executionBudgetResolver |
| server/services/leadDiscovery/googlePlacesProvider.ts | DELETE | Sole caller is sdrService (also dead) |
| server/services/leadDiscovery/hunterProvider.ts | DELETE | Zero callers anywhere |
| server/services/orchestratorTaskCommentTemplate.ts | DELETE | Zero callers; orchestrator routing spec'd but not wired |
| server/services/principal/assertSystemAdminContext.ts | DELETE | Zero callers; `UnauthorizedSystemAccessError` not imported |
| server/services/principal/systemPrincipal.ts | FALSE-POSITIVE | Imported by 4 systemMonitor jobs (chain dead — tied to Dec.2) |
| server/services/processedResourceService.ts | DELETE | Service wrapper unused; schema used directly by webhookDedupe/ghlWebhook |
| server/services/retentionSuccessService.ts | DELETE | v7.1 stub handlers; never registered |
| server/services/sdrService.ts | DELETE | v7.1 stub handlers; never registered in any skill executor |
| server/services/skillAnalyzerServicePure/tableRemediation.ts | DELETE | 3-line re-export shim; bypassed by barrel |
| server/services/systemIncidentFatigueGuard.ts | DELETE | Class has zero callers; reserved-for-Phase-0.75 never wired |
| server/services/systemMonitor/baselines/baselineReader.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/baselines/refreshJob.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/baselines/refreshJobPure.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/baselines/sourceTableQueries.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/heuristics/index.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/heuristics/phaseFilter.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/synthetic/agentRunSuccessRateLow.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/synthetic/connectorErrorRateElevated.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/synthetic/connectorPollStale.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/synthetic/dlqNotDrained.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/synthetic/heartbeatSelf.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/synthetic/incidentSilence.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/synthetic/index.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/synthetic/noAgentRunsInWindow.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/synthetic/pgBossQueueStalled.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/synthetic/silentAgentSuccess.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/synthetic/syntheticChecksTickHandler.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/triage/loadCandidates.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/triage/sweepHandler.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/systemMonitor/triage/writeHeuristicFire.ts | DEFER (via Dec.2) | Tied to systemMonitor decision |
| server/services/topicClassifier.ts | DELETE | Impure wrapper unused; live consumption uses topicClassifierPure directly |
| server/services/trajectoryService.ts | DELETE | Impure wrapper unused; live consumption uses trajectoryServicePure directly |
| server/services/trustCalibrationService.ts | DEFER | Listed in Session O Chunk 14 Tier 1 RLS bulk migration — overlap |

---

## 4. FALSE-POSITIVE mechanism summary (chunk F `knip.json` patch)

If operator confirms, the chunk F PR adds these to `knip.json` `entry` with WHY comments:

```jsonc
{
  "entry": [
    // ...existing entries...
    "scripts/lib/check-handler-registry-verdicts.mjs", // shell-spawned by verify-handler-registry-fixture.sh
    "scripts/lib/check-knip-config.mjs",               // shell-spawned by verify-knip-config.sh
    "server/workflows/*.workflow.ts",                  // glob-loaded by scripts/seed.ts + scripts/validate-playbooks.ts
    "shared/types/errorCodes.ts",                      // bash-parsed by verify-error-code-taxonomy.sh as CODES_FILE
    "shared/types/systemIncidentEvent.ts"              // bash-parsed by verify-event-type-registry.sh as CANONICAL union
    // Conditional on Dec.2: server/services/systemMonitor/**/*.ts if systemMonitor stays "on hold"
    // Conditional on Dec.3: worker/**/*.ts if iee-worker-retirement is descoped
  ]
}
```

The systemPrincipal.ts case will be resolved automatically when Dec.2 resolves — either the chain becomes WIRE (live), DELETE (also dead), or FALSE-POSITIVE (knip ignore).

---

## 5. DEFER items not covered by Dec.1/2/3

After Decisions 1-3 resolve, these remain. They're isolated questions:

| File | Question |
|---|---|
| `client/src/components/InvocationsCard.tsx` + `invocations-card/{AccordionRow,HeartbeatTimeline}` | Touched 2026-05-15 in PR #313 page-splits; either monolith intentionally retired or wire-up missed. **Delete or wire?** |
| `client/src/components/dashboard/{OperationalMetricsPlaceholder,QueueHealthSummary,WorkspaceFeatureCard}` | Extracted during clientpulse-ui-simplification (#264) but parent dashboard page never re-wired them. **Delete or wire?** |
| `client/src/components/recommendations/AgentRecommendationsList.tsx` | Test references `DashboardPageOptimiserSection`; optimiser section was removed. **Restore optimiser, or delete component + test + Pure?** |
| `client/src/hooks/{useAgentPresence,useAgentRecommendationsTotal}` | Companion hooks for an agent-workspace feature that shipped without them. **Planned for upcoming, or supersede?** |
| `client/src/lib/accessibility/announceLiveUpdate.ts` | Useful a11y primitive, zero consumers. **Keep as future-use helper, or delete until first consumer?** |
| `client/src/pages/SptOnboardingPage.tsx` | Unrouted Stripe Provisioning Tenant onboarding flow. **Paused mid-build, or never shipped?** |
| `client/src/pages/SystemOrganisationTemplatesPage.tsx` | No successor found; sibling SystemOrganisationsPage is wired. **Aborted sibling?** |
| `server/db/rlsExclusions.ts` | Canonical registry per architecture.md, but no current gate reads it. **Is `verify-rls-coverage.sh` planned?** |
| `server/jobs/skillIdempotencyKeysCleanupJob.ts` | Header claims registered in queueService.ts; handler not actually registered. **Wiring bug — fix it (WIRE), or delete (it's unused intentionally)?** |
| `server/lib/canonicaliseUrl.ts` | Reporting Agent spec v3.4 §6.7.2 names this as fingerprint-dedup SoT. **Is the Reporting Agent fingerprint code shipping? If yes, keep — it will be wired soon.** |
| `server/tools/meta/types.ts` | 3-line type re-export shim documented as cycle-break in feat-split-skillexecutor §5.1. **Still needed for cycle-guard, or superseded?** |
| `shared/types/capabilityMap.ts` + `shared/types/slackAction.ts` | Scaffolded per personal-assistant v1/v2 specs but not yet adopted. **Keep as spec-anchored contracts (add to knip entry), or delete until handlers ship?** |
| `server/services/agentTemplateService.ts` + `server/services/trustCalibrationService.ts` | Both listed in Session O Chunk 14 RLS migration (`tier-categorisation.md` line 390). **Recommend: DEFER, do not touch in Session P — let Session O determine fate to avoid merge conflicts.** |

---

## 6. Proposed chunk plan (after operator approval)

Assuming the recommended verdicts on Dec.1/2/3 (DELETE the page-split cascade; DEFER systemMonitor pending operator answer; DEFER worker to iee-worker-retirement):

- **Chunk D1 — page-split orphan pages (12 files):** delete the 12 superseded pages in `client/src/pages/`. Verify build:client + typecheck after.
- **Chunk D2 — page-split downstream cluster (~23 files):** delete the orphan-via-orphan-parent leaves: components/baseline, brief-artefacts, subaccount-knowledge, subaccount-agents, spend, run-trace/DelegationGraphView, BriefLabel, McpCatalogue, McpToolBrowser, TeamHeartbeatView, RichTextEditor, workspace/OnboardAgentModal, lib/briefArtefactLifecycle.
- **Chunk D3 — pulse retirement (5 files):** delete entire `client/src/components/pulse/` directory.
- **Chunk D4 — orphan top-level client components (~18 files):** delete the standalone DELETE items in client/src/{api,components,config,hooks,lib}.
- **Chunk D5 — server orphans (~24 files):** delete the server DELETE items (services, lib, routes, schemas, processors, tests).
- **Chunk W1 — operator modals + rules dialog (4 files):** wire the operator-backend modals + RuleConflictResolutionDialog into their spec-named consumer pages.
- **Chunk W2 — system-incidents diagnosis cluster (4 files):** wire 4 diagnosis components into IncidentDetailDrawer per spec §10.3/§10.4.
- **Chunk W3 — agent + skill scorecard pages (3 files):** wire SkillCreatePage route, scorecard tab + section into AgentEditPage.
- **Chunk W4 — govern row actions (2 files):** wire ConnectionTestButton + DisclosureVersionBumpModal into ConnectionsPage.
- **Chunk F — knip.json patch (1 commit):** add the FALSE-POSITIVE entries listed in §4.
- **Sub-task — shared/types/* unused exports sweep:** after chunks D/W/F land, re-run `npx knip --reporter json | jq '.exports[]'` and produce a similar verdict table for the ~80 unused exports flagged. Apply the same DELETE / KEEP-WITH-WHY pattern.

---

## 7. Acceptance criteria (post all chunks)

- `npx knip` reports **< 10 unused-file** flags (down from 184) and **< 10 unused-export** flags in shared/types (down from ~80).
- `npm run build:server`, `npm run build:client`, `npm run lint`, `npm run typecheck` all exit 0.
- `tasks/todo.md` line 1867+ "Wave 5 knip candidate triage" marked `[status:closed:pr:<num>]`.
- `tasks/todo.md` line 314 "~80 unused exports in shared/types/*" marked `[status:closed:pr:<num>]`.

---

## 8. Post-operator-review final verdicts

### Operator decisions

- **Dec.1** (page-split cascade): DELETE entire cascade — all 14 orphan pages + ~23 downstream leaf components.
- **Dec.2** (systemMonitor): WIRE — add 4 pg-boss registrations in `pgBossRegistrations.ts`; all 19 service files + 4 jobs become reachable via the chain.
- **Dec.3** (worker browser subsystem): DEFER all 9 files to `iee-worker-retirement` build.
- **§5 individual DEFERs**: I decide per-file unless UI implication, in which case ask operator.

### Discoveries during execution-prep that changed initial verdicts

Several "DELETE" candidates from chunk 0 turned out to be **spec-backed-but-pending-wire**. Per operator guidance ("don't make UX surface decisions without me"), I'm reclassifying these as **FALSE-POSITIVE (add to knip.json entry with WHY pointing at spec)** rather than DELETE. Each gets a follow-up `tasks/todo.md` item to do the actual wiring in a UI-focused future build:

| File(s) | Initial verdict | Final verdict | Reason for change |
|---|---|---|---|
| `client/src/components/recommendations/AgentRecommendationsList.tsx` (+ Pure) | DEFER | FALSE-POSITIVE | Documented capability per `docs/capabilities.md:565`; `docs/sub-account-optimiser-spec.md`; Phase 0 already shipped (PR #251 / migration 0267); Phase 4 (dashboard wiring) pending. Backend route live at `/api/recommendations`. |
| `client/src/hooks/useAgentRecommendations.ts` | FALSE-POSITIVE | FALSE-POSITIVE | (confirmed — consumed by AgentRecommendationsList) |
| `client/src/hooks/useAgentRecommendationsTotal.ts` | DEFER | FALSE-POSITIVE | Companion hook for optimiser dashboard count badge |
| `client/src/hooks/useAgentPresence.ts` | DEFER | FALSE-POSITIVE | `docs/agent-workspace-implementation-brief.md:389` names this hook as load-bearing primitive; backend SSE endpoints live at `/api/agent-presence/stream/*`; ADR-0008 |
| `client/src/hooks/useWorkspacePresence.ts` | DELETE | FALSE-POSITIVE | Companion to useAgentPresence; workspace-scoped variant per agent-workspace plan |
| `client/src/lib/agentPresenceStream.ts` | DELETE | FALSE-POSITIVE | ADR-0008 SSE client lib; consumed by presence hooks |
| `client/src/components/operator/{OperatorBudgetExceededModal,OperatorConcurrencyLimitModal,OperatorUnavailableModal}.tsx` | WIRE | FALSE-POSITIVE | Spec D operator-backend authored these; wiring into operator workflows is UX-decision-laden — defer to operator-backend-completion build |
| `client/src/components/rules/RuleConflictResolutionDialog.tsx` | WIRE | FALSE-POSITIVE | Backend `ruleConflictDetectorService` live; UX-decision for when to trigger; defer to rules-conflict-resolution build |
| `client/src/components/system-incidents/{DiagnosisAnnotation,DiagnosisFilterPill,FeedbackWidget,InvestigatePromptBlock}.tsx` | WIRE | FALSE-POSITIVE | system-incidents Phase 0.75 spec §10.3/§10.4; wiring into IncidentDetailDrawer needs UX validation |
| `client/src/pages/agents/{AgentCreateScorecardSection,AgentEditScorecardTab}.tsx` | WIRE | FALSE-POSITIVE | trust-verification spec §12.2; wiring into AgentEditPage tabs needs UX validation |
| `client/src/pages/govern/components/{ConnectionTestButton,DisclosureVersionBumpModal}.tsx` | WIRE | FALSE-POSITIVE | consolidation-govern §4.9 + operator-session-identity Chunk 7; wiring into ConnectionsPage row actions needs UX validation |
| `client/src/components/dashboard/{OperationalMetricsPlaceholder,QueueHealthSummary,WorkspaceFeatureCard}.tsx` | DEFER | FALSE-POSITIVE | home-dashboard-reactivity + clientpulse-ui-simplification plans authored these; HomePage wiring step never executed; preserve files pending dashboard rewrite decision |
| `client/src/components/InvocationsCard.tsx` + `invocations-card/{2}` | DEFER | DELETE | Touched 2026-05-15 in PR #313 page-splits; no live consumer; the split intentionally retired the monolithic InvocationsCard (the post-split pages don't render it). Safe to delete. |
| `client/src/lib/accessibility/announceLiveUpdate.ts` | DEFER | DELETE | Pure a11y helper with zero consumers; can be re-added from git when first consumer needs it (three-similar-lines rule — don't keep abstractions without callers) |
| `client/src/pages/SptOnboardingPage.tsx` | DEFER | FALSE-POSITIVE (operator KEEP) | Agentic-commerce build deferred to pre-launch-phase-3 backlog; keep file alive pending agentic-commerce reactivation |
| `client/src/pages/SystemOrganisationTemplatesPage.tsx` | DEFER | DELETE (operator delegated to recommendation) | Duplicate of live SubaccountBlueprintsPage per wave-4 DUP5 audit; rename-but-unrouted artefact; re-implement from scratch with shared TemplateGrid per wave-4 §6.5 if system-level org-template view is needed later |
| `server/db/rlsExclusions.ts` | DEFER | FALSE-POSITIVE | Consumed by `scripts/verify-rls-coverage.sh` (bash gate); referenced in `server/db/schema/index.ts` comments + architecture.md as canonical registry |
| `server/lib/canonicaliseUrl.ts` | DEFER | FALSE-POSITIVE | Reporting Agent spec v3.4 §6.7.2 names this as fingerprint-dedup SoT; preserve pending Reporting Agent feature ship |
| `server/tools/meta/types.ts` | DEFER | FALSE-POSITIVE | 3-line cycle-break shim per feat-split-skillexecutor §5.1; preserve until cycle-guard fate confirmed |
| `shared/types/capabilityMap.ts` | DEFER | FALSE-POSITIVE | personal-assistant-v2-operator spec §5.1 names canonical JSONB contract |
| `shared/types/slackAction.ts` | DEFER | FALSE-POSITIVE | personal-assistant-v1 spec §7.3 names canonical Slack schema location |
| `server/jobs/skillIdempotencyKeysCleanupJob.ts` | DEFER | WIRE | Header explicitly claims "scheduled daily 05:30 UTC in queueService.ts" but registration missing — wiring bug, fix per file's own intent doc |
| `server/services/agentTemplateService.ts` | DEFER | DEFER (Session O overlap) | Listed in Session O Chunk 14 Tier 1 RLS migration; let Session O determine fate |
| `server/services/trustCalibrationService.ts` | DEFER | DEFER (Session O overlap) | Listed in Session O Chunk 14 Tier 1 RLS migration; let Session O determine fate |

### Final counts

| Verdict | Count |
|---|---|
| DELETE | ~78 |
| WIRE (mechanical, this PR) | 6 (4 systemMonitor pg-boss registrations + 1 skillIdempotencyKeysCleanup registration + 1 SystemOrganisationTemplatesPage cascade unwire) |
| FALSE-POSITIVE (add to knip entry this PR) | ~26 |
| DEFER (Session O / iee-worker-retirement / explicit follow-up) | 11 |
| **Total** | **184** |

### Revised chunk plan

- **Chunk D1** — orphan client pages (~14 files): delete the page-split + redirect-residue pages
- **Chunk D2** — orphan client downstream components (~28 files): baseline, brief-artefacts, subaccount-knowledge, subaccount-agents, spend, run-trace, singletons. Also delete sibling Pure files + their tests when the Pure file's sole consumer is the deleted .tsx.
- **Chunk D3** — pulse retirement (5 files): delete entire `client/src/components/pulse/`
- **Chunk D4** — client standalones (~13 files): AgentRunChatPane, ClarificationInbox, DropZone, EmailChannelTile + 2 siblings, ExecutionPlanPane, HealthAuditWidget, MemoryInspectorChat, PortalConfigEditor, SchedulePicker, TeamPicker, TraceChainSidebar, TraceChainTimeline, AskFormCardPlaceholder, InvocationsCard + 2 subdir, api/goals, config/capabilityGroups, lib/api/memoryBlocks, lib/runPlanView, lib/accessibility/announceLiveUpdate
- **Chunk D5** — server orphans (~24 files): adminOpsService, alertFatigueGuard, briefArtefactBackstop, bundleResolution{,Pure}, cachedContextOrchestrator, configAssistantModeService, contextAssemblyEngine, crmQueryPlanner/resultNormaliser, crossOwnerDelegationRequestAssembler, dataRetentionService, executionBudgetResolver{,Pure}, leadDiscovery/{googlePlaces,hunter}Provider, orchestratorTaskCommentTemplate, principal/assertSystemAdminContext, processedResourceService, retentionSuccessService, sdrService, skillAnalyzerServicePure/tableRemediation, systemIncidentFatigueGuard, topicClassifier, trajectoryService; plus briefVisibility, workflow/index, workflowLogger, processors/budgetGuardrail, routes/{agentTemplates,orgWorkspace}, schemas/{common,index}, tests/agentRunCancelService.unit
- **Chunk W1** — systemMonitor pg-boss registrations (1 file): register 4 jobs in `pgBossRegistrations.ts`
- **Chunk W2** — skillIdempotencyKeysCleanup pg-boss registration (1 file): same file, add registration
- **Chunk F** — knip.json entry updates (1 file): add ~26 FALSE-POSITIVE files/globs with WHY comments
- **Sub-task** — shared/types/* unused exports sweep
- **Follow-up todo.md item** — "Wave 6 follow-up: wire deferred spec-backed UI surfaces" listing each cluster + its spec reference + the page to wire it into
