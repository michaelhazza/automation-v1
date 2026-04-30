# Doc Sync Audit — Inventory (2026-04-21 → 2026-05-01)

**Produced:** 2026-05-01  
**Purpose:** Input for the diff + triage + fix pass. Read-only — no docs edited here.  
**Row count:** 40

---

## Table of Contents

- [Inventory Table — rows 1–20](#inventory-table--rows-120)
- [Inventory Table — rows 21–40](#inventory-table--rows-2140)
- [Source artefacts walked](#source-artefacts-walked)
- [Candidate drift items flagged for diff pass](#candidate-drift-items-flagged-for-diff-pass)

---

## Inventory Table — rows 1–20

| Build / PR slug | Window date | Spec(s) touched | Top files changed | Doc sections this should have updated |
|---|---|---|---|---|
| `llm-observability-ledger` / PR #158 | 2026-04-21 | tasks/llm-observability-ledger-generalisation-spec.md | architecture.md, docs/capabilities.md, system-pnl components, server/config/limits.ts, migrations/0189 | architecture.md (LLM P&L, in-flight tracking); docs/capabilities.md (LLM observability ledger entry) |
| `build-llm-inflight-tracker` / PR #161 | 2026-04-21 | tasks/llm-inflight-realtime-tracker-spec.md | architecture.md, PnlInFlightTable, SystemPnlPage, docs/capabilities.md, server/config/limits.ts | architecture.md (in-flight LLM registry); docs/capabilities.md (real-time in-flight panel) |
| `hermes-audit-tier-1` / PR #162 | 2026-04-21 | docs/hierarchical-delegation-dev-spec.md (audit tier 1) | architecture.md, KNOWLEDGE.md, RunCostPanel, RunCostPanelPure, CLAUDE.md | architecture.md (Hermes cost visibility, RunCost panel); docs/capabilities.md (run cost/budget enforcement) |
| `hermes-tier-1-docs-sync` / PR #163 | 2026-04-21 | n/a (docs-sync PR) | CLAUDE.md, KNOWLEDGE.md, architecture.md, docs/capabilities.md | All four explicitly updated — architecture.md (Hermes routes/agents), capabilities.md (hermes feature entry), KNOWLEDGE.md, CLAUDE.md |
| `build-llm-inflight-tracker` / PR #164 | 2026-04-21 | tasks/llm-inflight-realtime-tracker-spec.md (refresh) | CLAUDE.md, tasks/llm-inflight-deferred-items-brief.md, tasks/llm-inflight-realtime-tracker-spec.md | CLAUDE.md updated; spec updated; capabilities.md — no entry for deferred items brief |
| `llm-inflight-tracker-cs4n7` / PR #165 | 2026-04-21 | tasks/llm-inflight-realtime-tracker-spec.md | architecture.md, KNOWLEDGE.md, CLAUDE.md, PnlInFlightTable, PnlInFlightPayloadDrawer, docs/capabilities.md | architecture.md updated; docs/capabilities.md updated; KNOWLEDGE.md updated; CLAUDE.md updated |
| `build-agent-execution-spec-6p1nC` / PR #168 | 2026-04-21/22 | tasks/live-agent-execution-log-spec.md | architecture.md, CLAUDE.md, agentRunLog components (EventDetailDrawer, EventRow, Timeline) | architecture.md updated (live agent execution log); CLAUDE.md updated; docs/capabilities.md — live agent execution log entry not confirmed |
| `implement-chatgpt-review-agents-GG7FR` / PR #169 | 2026-04-21/22 | n/a (fleet agent PR) | .claude/agents/chatgpt-pr-review.md, chatgpt-spec-review.md, CLAUDE.md, KNOWLEDGE.md, spec-reviewer.md | CLAUDE.md updated; KNOWLEDGE.md updated; architecture.md — no structural change; docs/capabilities.md — no operator-visible change |
| `claude-md-updates` / PR #171 | 2026-04-22 | n/a (CLAUDE.md refactor) | CLAUDE.md, KNOWLEDGE.md, architecture.md, chatgpt-pr-review.md, chatgpt-spec-review.md | CLAUDE.md updated; architecture.md updated; KNOWLEDGE.md updated |
| `crm-query-planner` / PR #173 | 2026-04-22 | tasks/builds/crm-query-planner/spec.md (new) | KNOWLEDGE.md, agent files | No architecture.md or capabilities.md update confirmed (spec/brief added, no implementation) |
| `create-spec-conformance` / PR #174 | 2026-04-22 | n/a (new fleet agent) | .claude/agents/spec-conformance.md, CLAUDE.md, KNOWLEDGE.md, feature-coordinator.md | CLAUDE.md updated; KNOWLEDGE.md updated; no architecture.md change (process-only) |
| `spec-conformance-fleet-updates` / PR #175 | 2026-04-22 | n/a (fleet doc update) | .claude/agents/feature-coordinator.md, CLAUDE.md | CLAUDE.md updated; minor fleet doc alignment only |
| `implement-universal-brief-qJzP8` / PR #176 | 2026-04-22 | docs/universal-brief-dev-spec.md | KNOWLEDGE.md, architecture.md, CLAUDE.md, client/App.tsx, BriefLabel, BriefDetailPage | architecture.md updated (partial); docs/capabilities.md — not updated in this PR (caught by PR #178) |
| `crm-query-planner-WR6PF` / PR #177 | 2026-04-22 | tasks/builds/crm-query-planner/spec.md | KNOWLEDGE.md, architecture.md, docs/capabilities.md, SystemPnlPage, scripts/verify-crm-query-planner-read-only.sh | architecture.md updated (CRM query planner section); docs/capabilities.md updated (CRM query planner entry) |
| `universal-brief-docs-update` / PR #178 | 2026-04-22 | docs/universal-brief-dev-spec.md | architecture.md, docs/capabilities.md, tasks/current-focus.md | architecture.md updated (universal brief section); docs/capabilities.md updated (brief creation, scope resolution entries) |
| `analyze-automation-insights-GCoq3` / PR #179 | 2026-04-23 | docs/riley-observations-dev-spec.md (new) | KNOWLEDGE.md, docs/riley-observations-dev-brief.md, docs/riley-observations-dev-spec.md | KNOWLEDGE.md updated; no architecture.md or capabilities.md (research/spec-only PR) |
| `cached-context-infrastructure-fcVmS` / PR #180 | 2026-04-23 | docs/cached-context-infrastructure-spec.md (new) | CLAUDE.md, KNOWLEDGE.md, .claude/agents (dual-reviewer, spec-conformance, spec-reviewer) | CLAUDE.md updated; KNOWLEDGE.md updated; no architecture.md or capabilities.md (spec authoring PR, no implementation) |
| `paperclip-agent-hierarchy-9VJyt` / PR #181 | 2026-04-23 | docs/hierarchical-delegation-dev-spec.md (new) | KNOWLEDGE.md, docs/hierarchical-delegation-dev-brief.md, docs/hierarchical-delegation-dev-spec.md | KNOWLEDGE.md updated; no architecture.md or capabilities.md (spec authoring PR) |
| `build-paperclip-hierarchy-ymgPW` / PR #182 | 2026-04-23/24 | docs/hierarchical-delegation-dev-spec.md | architecture.md, KNOWLEDGE.md, chatgpt-pr-review.md, chatgpt-spec-review.md, DelegationGraphView | architecture.md updated (delegation graph); KNOWLEDGE.md updated; docs/capabilities.md — delegation graph view not confirmed added |
| `implementation-plan-Y622C` / PR #183 | 2026-04-23 | docs/cached-context-infrastructure-spec.md | architecture.md, KNOWLEDGE.md, docs/capabilities.md, migrations/0202, spec-conformance.md | architecture.md updated (cached context, RLS canonical session vars); docs/capabilities.md updated (cached context / doc bundle feature); KNOWLEDGE.md updated |

---

## Inventory Table — rows 21–40

| Build / PR slug | Window date | Spec(s) touched | Top files changed | Doc sections this should have updated |
|---|---|---|---|---|
| `bugfixes-april26` / PR #185 | 2026-04-24 | docs/skill-analyzer-spec.md (updated) | KNOWLEDGE.md, skill-analyzer components, migrations/0189 view | KNOWLEDGE.md updated; architecture.md — no (bugfix PR); docs/capabilities.md — no confirmed update |
| `start-riley-architect-pipeline-7ElHp` / PR #186 | 2026-04-24 | docs/riley-observations-dev-spec.md | KNOWLEDGE.md, architecture.md, AutomationPickerDrawer, App.tsx, Layout.tsx | architecture.md updated; KNOWLEDGE.md updated; docs/capabilities.md — invoke_automation step type / AutomationPickerDrawer not confirmed added |
| `clientpulse-ui-simplification` / PR #187 | 2026-04-24 | docs/clientpulse-dev-spec.md | KNOWLEDGE.md, UnifiedActivityFeed, client/App.tsx, Layout.tsx | KNOWLEDGE.md updated; docs/capabilities.md — ClientPulse UI simplification not confirmed added; docs/frontend-design-principles.md — simplified surface not confirmed updated |
| `system-monitoring-agent-PXNGy` / PR #188 | 2026-04-25 | tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md | KNOWLEDGE.md, architecture.md, docs/capabilities.md, SystemIncidentsPage, server schema | architecture.md updated (system incidents sink); docs/capabilities.md updated (system incidents feature); KNOWLEDGE.md updated |
| `codebase-audit-SFbfn` / PR #190 | 2026-04-25 | docs/codebase-audit-framework.md (new) | KNOWLEDGE.md, docs/codebase-audit-framework.md | KNOWLEDGE.md updated; CLAUDE.md — audit-runner not yet registered (done in PR #191); docs/capabilities.md — no |
| `audit-runner-agent` / PR #191 | 2026-04-25 | n/a (new fleet agent) | .claude/agents/audit-runner.md, CLAUDE.md | CLAUDE.md updated (audit-runner fleet registration); KNOWLEDGE.md — no new entries confirmed |
| `audit-runner-full-MwZlO` / PRs #192+194 | 2026-04-25 | n/a (audit-runner inline/refinement) | .claude/agents/audit-runner.md, CLAUDE.md, codebase-audit-log | CLAUDE.md updated; no other docs |
| `full-codebase-2026-04-25` / PR #195 | 2026-04-25 | n/a (audit run output) | KNOWLEDGE.md, tasks/audit-progress.md, codebase-audit-log, tasks/todo.md | KNOWLEDGE.md updated; docs/capabilities.md and architecture.md — not updated (audit findings only, no code shipped) |
| `pre-launch-hardening` / PR #211 | 2026-04-26/27 | docs/pre-launch-hardening-spec.md | DEVELOPMENT_GUIDELINES.md, architecture.md, KNOWLEDGE.md, CLAUDE.md, docs/capabilities.md, server/routes | DEVELOPMENT_GUIDELINES.md updated (RLS, multi-tenant safety checklist); architecture.md updated (RLS canonical session vars, routes); docs/capabilities.md updated (minor); KNOWLEDGE.md updated |
| `deferred-quality-fixes-ZKgVV` / PRs #201–203 | 2026-04-26 | docs/pre-launch-hardening-mini-spec.md (new) | KNOWLEDGE.md, architecture.md, .claude/hooks/rls-migration-guard.js | architecture.md updated; KNOWLEDGE.md updated; docs/capabilities.md — no |
| `system-monitoring-agent-BgLlY` / PRs #213+215 | 2026-04-26/27 | tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md | KNOWLEDGE.md, architecture.md, CLAUDE.md, system-incidents UI, DiagnosisAnnotation, FeedbackWidget | architecture.md updated (system monitor Phase A+1+2, diagnosis agent); CLAUDE.md updated; KNOWLEDGE.md updated; docs/capabilities.md — diagnosis/feedback UI not confirmed added |
| `audit-system-agents-46kTN` / PRs #212+216 | 2026-04-27 | docs/automation-os-system-agents-master-brief-v7.1.md (new) | KNOWLEDGE.md, CLAUDE.md, AGENTS.md files, skillExecutor.ts, system-agent skill files | KNOWLEDGE.md updated; CLAUDE.md updated; docs/capabilities.md — 14 new system-agent skills not confirmed added; architecture.md — executor contract not confirmed updated |
| `system-monitoring-agent-fixes` / PR #217 | 2026-04-27/28 | tasks/builds/system-monitoring-agent-fixes/spec.md | KNOWLEDGE.md, DEVELOPMENT_GUIDELINES.md, system-incidents UI, migrations/0239 | KNOWLEDGE.md updated; DEVELOPMENT_GUIDELINES.md updated; architecture.md — no structural change confirmed; docs/capabilities.md — no operator-visible change confirmed |
| `create-views` (home-dashboard-reactivity) / PR #218 | 2026-04-27/28 | docs/pre-launch-hardening-spec.md (reactivity section) | architecture.md, KNOWLEDGE.md, CLAUDE.md, DEVELOPMENT_GUIDELINES.md, docs/capabilities.md | All five updated — architecture.md (live reactivity primitives); docs/capabilities.md (Pulse home dashboard live line); DEVELOPMENT_GUIDELINES.md; CLAUDE.md; KNOWLEDGE.md |
| `pre-test-backend-hardening` / PR #223 | 2026-04-28 | docs/specs/2026-04-28-pre-test-backend-hardening-spec.md | KNOWLEDGE.md, migrations/0240, conversations schema, test files | KNOWLEDGE.md updated; architecture.md — no structural change confirmed; docs/capabilities.md — no |
| `system-monitoring-coverage` / PR #226 | 2026-04-28/29 | docs/specs/2026-04-28-system-monitoring-coverage-spec.md | architecture.md, KNOWLEDGE.md, jobConfig.ts, ieeRunCompletedHandler.ts, skillAnalyzerJobWithIncidentEmission, server/index.ts | architecture.md updated (G3 async-ingest worker, integration points table); KNOWLEDGE.md updated; docs/capabilities.md — async ingest / DLQ monitoring not confirmed |
| `pre-prod-boundary-and-brief-api` / PR #234 | 2026-04-29 | docs/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md | architecture.md, KNOWLEDGE.md, inboundRateLimiter.ts, rateLimitCleanupJob.ts, migrations/0253, BriefCreationEnvelope, GlobalAskBarPure | architecture.md updated (rate limiter section replaced); KNOWLEDGE.md updated; docs/capabilities.md — rate-limiting and scope-resolution not confirmed; docs/integration-reference.md — n/a |
| `pre-prod-tenancy` / PR #235 | 2026-04-29 | docs/specs/2026-04-29-pre-prod-tenancy-spec.md | KNOWLEDGE.md, migrations/0244+0245, server/config/rlsProtectedTables.ts, ruleAutoDeprecateJob | KNOWLEDGE.md updated; architecture.md — no new structural surface confirmed; DEVELOPMENT_GUIDELINES.md — advisory-lock pattern already existed |
| `add-github-actions-ci` / PR #236 | 2026-04-29 | docs/ci-readiness-report.md | .github/workflows/ci.yml, migrations/0245 fixes, scripts/verify-rls-protected-tables.sh, rlsProtectedTables.ts | DEVELOPMENT_GUIDELINES.md — CI gate policy already updated earlier; architecture.md — no new routes; docs/capabilities.md — no |
| `vitest-migration` / PRs #238+239 | 2026-04-29/30 | docs/test-migration-spec.md | docs/testing-conventions.md, vitest.config.ts, .nvmrc, scripts/verify-test-quality.sh, KNOWLEDGE.md | docs/testing-conventions.md updated (Vitest now canonical); KNOWLEDGE.md updated; DEVELOPMENT_GUIDELINES.md — test discipline section not confirmed updated |
| `agent-as-employee` / PR #240 | 2026-04-30 | docs/agent-coworker-features-spec.md | architecture.md, KNOWLEDGE.md, workspace components (MigrateWorkspaceModal, IdentityCard, AgentActivityTab), auditEvents schema | architecture.md updated (workspace identity model, resolveAgentSubaccountId invariant); KNOWLEDGE.md updated; docs/capabilities.md — agent-as-employee workspace identity not confirmed added |
| `agentic-engineering-notes` (PR #243, in progress) | 2026-04-30/05-01 | docs/agentic-engineering-notes-dev-spec.md, docs/agent-coworker-features-spec.md | .claude/agents/adversarial-reviewer.md, CLAUDE.md, docs/README.md, docs/scripts index, architect.md | CLAUDE.md updated (adversarial-reviewer fleet + verifiability heuristic); architecture.md — no structural change; docs/capabilities.md — no; KNOWLEDGE.md updated |

---

## Source artefacts walked

**Source 1 — Git log (main branch, 2026-04-21 → 2026-05-01):** YES — 60+ commits on main; 43 PR merge commits identified; 40 distinct build/PR rows inventoried.

**Source 2 — Specs:** YES — 20+ spec files touched in window:
- `docs/universal-brief-dev-spec.md` (PRs #176, #178)
- `docs/hierarchical-delegation-dev-spec.md` (PRs #181, #182)
- `docs/cached-context-infrastructure-spec.md` (PRs #180, #183)
- `docs/riley-observations-dev-spec.md` (PRs #179, #186)
- `docs/pre-launch-hardening-spec.md` / `docs/pre-launch-hardening-mini-spec.md` (PRs #211, #203)
- `tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md` (PRs #202, #213, #215)
- `docs/specs/2026-04-28-pre-test-backend-hardening-spec.md` (PR #223)
- `docs/specs/2026-04-28-system-monitoring-coverage-spec.md` (PR #226)
- `docs/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md` (PR #234)
- `docs/specs/2026-04-29-pre-prod-tenancy-spec.md` (PR #235)
- `docs/agentic-engineering-notes-dev-spec.md` (PR #243)
- `docs/agent-coworker-features-spec.md` (PR #240)
- `docs/test-migration-spec.md` (PR #238)
- `docs/codebase-audit-framework.md` (PR #190)
- `tasks/builds/crm-query-planner/spec.md` (PRs #173, #177)
- `tasks/builds/system-monitoring-agent-fixes/spec.md` (PR #217)
- `tasks/live-agent-execution-log-spec.md` (PR #168)
- `tasks/llm-inflight-realtime-tracker-spec.md` (PRs #161, #164, #165)

**Source 3 — Build plans:** YES — 15 plan.md files changed in window across slugs: `agentic-engineering-notes`, `audit-remediation`, `cached-context-infrastructure`, `clientpulse`, `code-intel-phase-0`, `paperclip-hierarchy`, `pre-launch-hardening-specs`, `pre-prod-tenancy`, `pre-test-audit-fixes`, `pre-test-backend-hardening`, `pre-test-brief-and-ux`, `riley-observations`, `system-agents-v7-1-migration`, `system-monitoring-agent-fixes`, `system-monitoring-coverage`.

**Source 4 — Spec-conformance logs:** YES — 30 spec-conformance log files in window covering: `agent-as-employee` (phases A–E), `agentic-engineering-notes`, `audit-remediation`, `audit-remediation-followups`, `cached-context-infrastructure`, `clientpulse-ui-simplification`, `code-intel-phase-0`, `crm-query-planner`, `dev-mission-control`, `home-dashboard-reactivity`, `paperclip-hierarchy` (chunks 3a–4d), `pre-prod-boundary-and-brief-api`, `pre-prod-tenancy`, `pre-test-backend-hardening`, `pre-test-brief-and-ux`, `riley-observations-wave1`, `system-agents-v7-1-migration`, `system-monitoring-agent`, `system-monitoring-agent-fixes`.

**Source 5 — PR-reviewer logs:** YES — 20+ PR reviewer logs in window. Notable: `hermes-tier-1`, `live-agent-execution-log`, `llm-inflight-deferred-items`, `skill-analyzer-crash-resume`, `cached-context-infrastructure`, `claude-md-updates`, `clientpulse-ui-simplification`, `create-spec-conformance`, `crm-query-planner`, `dev-mission-control`, `paperclip-hierarchy` (chunks 3b–4d), `pre-test-backend-hardening`, `riley-observations`, `skill-analyzer-resilience`, `skill-analyzer-v6`, `system-monitoring-agent`, `agent-as-employee-de-fixes`, `agentic-engineering-notes`, `fix-doco-may2026-phase1`.

**Source 6 — Dual-reviewer logs:** YES — 20 dual-review logs in window: `agent-as-employee-final`, `agentic-engineering-notes`, `agents-as-employees`, `audit-remediation`, `brief-feature-updates`, `cached-context-infrastructure`, `claude-md-updates`, `clientpulse-ui-simplification`, `create-spec-conformance`, `crm-query-planner`, `deferred-quality-fixes`, `fix-logical-deletes` (×2), `hermes-tier-1`, `home-dashboard-reactivity`, `pre-launch-hardening`, `pre-prod-boundary-and-brief-api`, `riley-observations`, `skill-analyzer-v6`, `skill-analyzer-v7`, `system-agents-v7-1-migration`, `system-monitor-directional-fixes`, `system-monitoring-agent`, `system-monitoring-coverage`.

**Source 7 — ChatGPT review logs:** YES — 22 chatgpt-pr-review logs and 10 chatgpt-spec-review logs in window. Explicit "updated: no" confessions (drift signals):

| Log file | Confession |
|---|---|
| `chatgpt-pr-review-brief-feature-updates-…Z.md` | `architecture.md updated: no (no structural change)` |
| `chatgpt-pr-review-bugfixes-april26-…Z.md` | `architecture.md updated: no` / `docs/capabilities.md updated: no` |
| `chatgpt-pr-review-claude-add-system-monitoring-BgLlY-…Z.md` | `architecture.md updated: no` |
| `chatgpt-pr-review-claude-agentic-engineering-notes-WL2of-…Z.md` | `architecture.md updated: no` |
| `chatgpt-pr-review-claude-audit-system-agents-46kTN-…Z.md` | `architecture.md updated: no — executor contract change internal to skillExecutor.ts` |
| `chatgpt-pr-review-claude-deferred-quality-fixes-ZKgVV-…Z.md` | `architecture.md updated: no` |
| `chatgpt-pr-review-claude-md-updates-…Z.md` | `architecture.md updated: no` |
| `chatgpt-pr-review-claude-system-monitoring-agent-PXNGy-…Z.md` | `architecture.md updated: no (no [missing-doc] >2)` |
| `chatgpt-pr-review-fix-logical-deletes-…Z.md` | `architecture.md updated: no (no structural change)` |
| `chatgpt-pr-review-feat-agents-are-employees-…Z.md` | `architecture.md updated: no (existing § Workspace identity model is current)` |
| `chatgpt-pr-review-vitest-migration-…Z.md` | `architecture.md updated: no` |
| `chatgpt-pr-review-system-monitoring-agent-fixes-…Z.md` | `architecture.md updated: no` / `docs/capabilities.md updated: no` |
| `chatgpt-pr-review-pre-prod-tenancy-…Z.md` | `architecture.md updated: no` |
| `chatgpt-pr-review-implement-chatgpt-review-agents-GG7FR-…Z.md` | `architecture.md updated: no` |

---

## Candidate drift items flagged for diff pass

Items where the "no" or absent update is a plausible miss (not clearly justified by the log), to be resolved in the diff pass:

1. **`docs/capabilities.md` — agent-as-employee workspace identity** (PR #240): workspace actor model, migration modal, agent activity feed — no capabilities entry confirmed.
2. **`docs/capabilities.md` — system-agent v7.1 skills** (PRs #212, #216): 14 new skills registered in system-agent fleet — no capabilities.md entry confirmed.
3. **`docs/capabilities.md` — live agent execution log** (PR #168): new live execution log page shipped — no capabilities.md entry confirmed at merge time; PR #163 hermes-docs-sync added a small entry but may be incomplete.
4. **`docs/capabilities.md` — clientpulse UI simplification** (PR #187): significant UI restructure — no capabilities.md update in review log.
5. **`docs/capabilities.md` — AutomationPickerDrawer / invoke_automation step** (PR #186): new automation picker drawer and invoke_automation step type — no capabilities.md entry confirmed.
6. **`docs/capabilities.md` — system-monitoring-coverage gaps G1–G11** (PR #226): new incident ingest worker, DLQ monitoring, skill-analyzer incident emission — review log notes architecture.md was updated but capabilities.md not mentioned.
7. **`docs/capabilities.md` — rate-limit-buckets / inboundRateLimiter** (PR #234): new rate-limiting primitive — no capabilities.md entry confirmed in review log.
8. **`docs/capabilities.md` — DelegationGraphView / split-pane brief detail** (PR #182): delegation graph component shipped — no capabilities.md entry confirmed for delegation graph.
9. **`docs/frontend-design-principles.md` — clientpulse simplification** (PR #187): UI simplification is a worked example of the five hard rules — not confirmed updated.
10. **`DEVELOPMENT_GUIDELINES.md` — vitest conventions / test discipline** (PRs #238+239): Vitest is now the canonical test runner; `docs/testing-conventions.md` updated but `DEVELOPMENT_GUIDELINES.md` test discipline section not confirmed updated.
11. **`architecture.md` — skill executor contract change** (PRs #212, #216): system-agent skill executor contract changed internally — review log justifies "no" but worth a diff-check during the fix pass.
12. **`docs/integration-reference.md`** — no PRs in window touched integration/OAuth/MCP behaviour; this doc is NOT a drift target for this window.
