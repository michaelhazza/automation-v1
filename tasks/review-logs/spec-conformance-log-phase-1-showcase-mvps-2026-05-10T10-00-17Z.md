# Spec Conformance Log

**Spec:** `tasks/builds/phase-1-showcase-mvps/spec.md`
**Spec commit at check:** `b0fda916b12555927560e66a0e56d15f58559edb`
**Branch:** `feat/phase-1-showcase-mvps`
**Base:** `1447d29e781147179d2a0f5ce90a3f8ea19d6ba5` (merge-base with origin/main)
**Scope:** all 10 chunks (caller confirmed: integrated branch, all chunks implemented)
**Changed-code set:** 122 files
**Run at:** 2026-05-10T10:00:17Z

---

## Summary

- Requirements extracted: 55
- PASS: 38
- MECHANICAL_GAP -> fixed: 0
- DIRECTIONAL_GAP -> deferred: 14
- AMBIGUOUS -> deferred: 2
- OUT_OF_SCOPE -> skipped: 1

**Verdict:** NON_CONFORMANT (16 deferred items)

The branch implements substantial portions of the spec but has structural integration gaps that prevent end-to-end functioning in production: three pg-boss jobs are declared but never registered, the internal finalize endpoint is built but not mounted on the Express app, the master prompt is seeded as a literal placeholder string, and the InboxAgentConfigTab UI exists in isolation without composition into the inbox config page. Several events promised by the canonical event registry have no emitter sites.

The mechanical-fix path is not appropriate for these findings; each represents a design or wiring decision that requires human judgement about scope and approach.

---

## Requirements extracted (full checklist)

| # | Category | Spec | Verdict | Evidence |
|---|----------|------|---------|----------|
| 1 | schema | §6.1.2 | PASS | migrations/0313_run_artifacts.sql:21-23 |
| 2 | service | §6.1.3 | PASS | server/services/fileDeliveryService.ts |
| 3 | file | §6.1.4 | PASS | worker/src/lib/uploadArtifact.ts |
| 4 | route | §6.1.4 | DIRECTIONAL_GAP | server/routes/internal/runArtifactsFinalize.ts (file exists; never mounted on app) |
| 5 | job | §6.1.2b | DIRECTIONAL_GAP | server/jobs/runArtifactsRetentionSweepJob.ts (registerRunArtifactsRetentionSweepJob never called) |
| 6 | behavior | §6.1.5b | PASS | fileDeliveryService.ts:131-184 (wasReplay both paths) |
| 7 | behavior | §4.5.2,§6.1.5b | PASS | server/routes/runArtifacts.ts:204-213, 292-298 |
| 8 | route | §4.5.3 | PASS | server/routes/agentRuns.ts:657 |
| 9 | UI | §4.5.2 | PASS | client/src/components/run-trace/RunTraceArtifactsPanel.tsx |
| 10 | UI | §4.5.1 | PASS | client/src/components/run-trace/RunTraceHeadline.tsx:73 |
| 11 | client | §4.5.3 | PASS | client/src/lib/api/runArtifacts.ts |
| 12 | service | §4.4.3 | DIRECTIONAL_GAP | reportRenderingService.ts:25-31 - xref-sort step omitted from determinism contract |
| 13 | template | §4.4.2 | PASS | server/services/reportTemplates/MacroReport.tsx |
| 14 | config | §4.4.3 | PASS | ieeRunCompletedHandler.ts:28; package.json pinned 4.5.1 |
| 15 | behavior | §4.4.3 | PASS | ieeRunCompletedHandler.ts:175-224 |
| 16 | service | §4.6.2 | PASS | server/services/workspaceHealth/detectors/staleMacroRunDetector.ts |
| 17 | event | §4.6.1 | PASS | worker/src/browser/executor.ts:188 |
| 18 | event | §3.5 | DIRECTIONAL_GAP | phase1.macro.run_started, run_completed, artifact_delivered never emitted (type-only) |
| 19 | event | §3.5,§4.6.2 | DIRECTIONAL_GAP | phase1.macro.run_stuck logged from worker not from staleMacroRunDetector |
| 20 | UI | §4.6.3,§5.6.3 | PASS | client/src/components/run-trace/MacroFailureRenderers.tsx |
| 21 | skill | §5.4.1 | PASS | server/skills/support/classify-ticket.md |
| 22 | service | §5.4.1 | PASS | server/services/skillHandlers/supportClassifyTicket.ts |
| 23 | config | §5.4.3 | PASS | server/config/actionRegistry.ts:3811 (riskTier 1, gateLevel auto) |
| 24 | schema | §5.4.1 | PASS | shared/types/supportClassifyTicketResult.ts |
| 25 | schema | §5.4.3 | DIRECTIONAL_GAP | system_skills row not seeded; comment says "Phase 1.5 will add the migration" |
| 26 | migration | §5.3.1 | PASS | migrations/0314_support_agent_install.sql |
| 27 | seed | §5.3.2 | DIRECTIONAL_GAP | master_prompt seeded as '{{MASTER_PROMPT_PLACEHOLDER}}' literal; .md file never read |
| 28 | seed | §5.3.1,§9.2 | DIRECTIONAL_GAP | default_system_skill_slugs has set_custom_field instead of ask_clarifying_question |
| 29 | service | §5.3.1 | PASS | server/services/supportAgentInstallService.ts |
| 30 | route | §5.3.1 | DIRECTIONAL_GAP | mounted at /api/support/subaccounts/... vs spec /api/subaccounts/... |
| 31 | file | §5.3.2 | PASS | server/prompts/support-agent-master.md |
| 32 | schema | §5.3.2,§5.6.2 | PASS | shared/types/supportInboxAgentConfig.ts:20-22 |
| 33 | service | §5.3.6 | DIRECTIONAL_GAP | promptOverridePure narrower than spec forbidden-token list |
| 34 | process | §5.3.5 | OUT_OF_SCOPE | process discipline; CI eval-gate-before-prompt-bump not implemented but is informational |
| 35 | service | §5.3.3 | PASS | server/services/supportAgentExecutionService.ts |
| 36 | behavior | §5.3.7,INV-8 | AMBIGUOUS | controller_style enforcement at run-create not visible in changeset |
| 37 | behavior | §5.3.4 | PASS | supportAgentExecutionService.ts:47-82, 251-257, 270-275 |
| 38 | behavior | §5.3.4 | PASS | supportAgentExecutionService.ts:115-148 |
| 39 | job | §5.3.4 | PASS | server/jobs/supportAgentRunJob.ts:77 (singletonKey set) |
| 40 | wiring | §5.3.3 | DIRECTIONAL_GAP | registerSupportAgentRunJob never called from server/index.ts |
| 41 | wiring | §5.5.4 | DIRECTIONAL_GAP | registerSupportEvalDailyJob never called from server/index.ts |
| 42 | event | §5.6.3 | DIRECTIONAL_GAP | phase1.support.draft_dispatched and draft_blocked_by_policy never emitted |
| 43 | service | §5.5 | PASS | server/services/supportEvalHarness.ts (manual-seed fallback per spec §5.5.2) |
| 44 | gate | §5.5.4,§7.3 | PASS | scripts/gates/verify-support-agent-eval-thresholds.sh + evalGateRunner.ts |
| 45 | gate | §9.2 | PASS | scripts/gates/verify-support-agent-skill-set.sh |
| 46 | UI | §5.5.3 | PASS | client/src/pages/operate/SupportEvalsPage.tsx (App.tsx:533) |
| 47 | route | §5.5.4 | PASS | server/routes/support/supportEvalsRoutes.ts |
| 48 | UI | §5.6.1 | PASS | client/src/pages/operate/SupportAgentDashboard.tsx (App.tsx:532) |
| 49 | UI | §5.6.2 | DIRECTIONAL_GAP | InboxAgentConfigTab orphaned - never imported into inbox config page |
| 50 | UI | §5.6.3 | PASS | client/src/components/run-trace/SupportEventRenderers.tsx |
| 51 | route | §5.6.4 | PASS | server/routes/support/supportAgentRoutes.ts |
| 52 | event-bus | §3.5,INV-16 | DIRECTIONAL_GAP | events logged only; agent_execution_events double-write missing - breaks REQ #38 outer-loop predicate at runtime |
| 53 | docs | doc-sync | PASS | KNOWLEDGE.md, architecture.md, docs/capabilities.md in diff |
| 54 | migration | §6.1.2,§5.5.4,§5.3.1 | PASS | _down/0313, _down/0314, _down/0315 all present |
| 55 | event | §3.5 | PASS | shared/types/runTraceEvent.ts:32-55 (all 19 event-type names in discriminator) |

---

## Mechanical fixes applied

None. All 16 deferred findings require human design judgement and are routed to `tasks/todo.md`.

Rationale: most gaps are wiring or integration choices (where to call `register*Job` from, how to substitute `{{MASTER_PROMPT_PLACEHOLDER}}` at install time, which inbox config page should compose `InboxAgentConfigTab`, whether to add agent_execution_events double-write infrastructure) that exceed the agent's mechanical-fix mandate. The skill list deviation and route-path divergence likewise need operator confirmation about which side is authoritative.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

| REQ | One-line | Priority |
|-----|----------|----------|
| 4 | Internal finalize route never registered on Express app | high (blocks worker uploads) |
| 5 | Run artifacts retention sweep job never wired into pg-boss | high (blocks retention) |
| 40 | registerSupportAgentRunJob never called | high (Support Agent never runs) |
| 41 | registerSupportEvalDailyJob never called | high (no eval drift detection) |
| 27 | Master prompt seeded as literal '{{MASTER_PROMPT_PLACEHOLDER}}' | high (agent runs on placeholder) |
| 49 | InboxAgentConfigTab orphaned - not in inbox config page | high (operators cannot configure) |
| 52 | Events logged only; agent_execution_events double-write missing | high (breaks list_open_tickets predicate) |
| 28 | default_system_skill_slugs has set_custom_field, not ask_clarifying_question | medium (intentional or not?) |
| 30 | install route mounted under /api/support/... vs spec /api/... | medium (path mismatch) |
| 18 | phase1.macro.run_started/run_completed/artifact_delivered never emitted | medium (Run Trace coverage) |
| 19 | phase1.macro.run_stuck emitted from worker not detector | medium (emitter location mismatch) |
| 42 | phase1.support.draft_dispatched and draft_blocked_by_policy never emitted | medium (Run Trace coverage) |
| 33 | promptOverride forbidden-token list far narrower than spec | medium (security defence-in-depth) |
| 12 | PDF determinism: xref-sort step omitted | low (timestamps + /ID stripped is partial defence) |
| 25 | system_skills row for support.classify_ticket not seeded | low (skillExecutor routes by handler key) |
| 36 | controller_style 'native' enforcement at run-create not visible | low (AMBIGUOUS - assumes existing infra) |
| 34 | Master-prompt eval-gate before bump (process discipline) | low (OUT_OF_SCOPE) |

All routed to `tasks/todo.md` under section "Deferred from spec-conformance review - phase-1-showcase-mvps (2026-05-10)".

---

## Files modified by this run

None (no mechanical fixes applied).

---

## Next step

NON_CONFORMANT - 16 directional/ambiguous gaps must be addressed by the main session before `pr-reviewer`.
