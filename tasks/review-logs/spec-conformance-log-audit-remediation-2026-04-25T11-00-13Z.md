# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`
**Spec commit at check:** `1af09739f5125fb50a190c7dff758792166921b8`
**Branch:** `feat/codebase-audit-remediation-spec`
**Branch HEAD:** `342e1b4ca1b32c7f245c234e5e5b545db939bd3c`
**Base (merge-base with main):** `f8c83962091aacfb9ca4072aaaed324782405d78`
**Scope:** Chunks 1+2+3 — Phase 1 (§4.1–§4.6), Phase 2 (§5.1–§5.8), Phase 3 (§6.1–§6.3). Phases 4 & 5 explicitly out of scope per caller.
**Run at:** 2026-04-25T11:00:13Z
**Commit at finish:** `5bc3b19c`

---

## Contents

- [Summary](#summary)
- [Requirements extracted (full checklist)](#requirements-extracted-full-checklist)
- [Mechanical fixes applied](#mechanical-fixes-applied)
- [Directional / ambiguous gaps (routed to tasks/todo.md)](#directional--ambiguous-gaps-routed-to-taskstodomd)
- [Files modified by this run](#files-modified-by-this-run)
- [Notes (non-blocking observations)](#notes-non-blocking-observations)
- [Next step](#next-step)

---

## Summary

- Requirements extracted:     46
- PASS:                       40
- MECHANICAL_GAP -> fixed:    1
- DIRECTIONAL_GAP -> deferred: 4
- AMBIGUOUS -> deferred:      0
- OUT_OF_SCOPE -> skipped:    0

> `AMBIGUOUS` is reported separately for diagnostic visibility — none in this run.

**Verdict:** CONFORMANT_AFTER_FIXES (1 mechanical gap closed; 4 directional items routed to `tasks/todo.md`)

---

## Requirements extracted (full checklist)

### Chunk 1 — Phase 1 (§4.1–§4.6)

| # | Spec section | Requirement | Verdict |
|---|---|---|---|
| 1 | §4.1 | `migrations/0227_rls_hardening_corrective.sql` exists with FORCE+canonical policy on the 8 named tables (memory_review_queue, drop_zone_upload_audit, onboarding_bundle_configs, trust_calibration_state, agent_test_fixtures, agent_execution_events, agent_run_prompts, agent_run_llm_payloads) | PASS |
| 2 | §4.1 | Each table block uses canonical policy shape: ENABLE+FORCE RLS, DROP IF EXISTS, CREATE POLICY with USING+WITH CHECK and IS NOT NULL+non-empty guards | PASS |
| 3 | §4.1 | Each table has the historical policy names dropped per per-table inventory (e.g. `*_tenant_isolation` for 0141/0142/0147) | PASS |
| 4 | §4.1 | No subaccount-isolation policies created (mirrors 0213 precedent) | PASS |
| 5 | §4.2 | Direct `db` import removed from all 13 named files (briefVisibility, onboardingStateHelpers, memoryReviewQueue, systemAutomations, subaccountAgents, configDocuments, portfolioRollup, clarifications, conversations, automationConnectionMappings, webLoginConnections, systemPnl, automations) | PASS |
| 6 | §4.2 | New service files exist for each "new" route per the §4.2 table (`briefVisibilityService`, `onboardingStateService`, `systemAutomationService`, `configDocumentService`, `portfolioRollupService`, `automationConnectionMappingService`) | PASS |
| 7 | §4.2 | Existing services extended (`memoryReviewQueueService`, `subaccountAgentService`, `clarificationService`, `conversationService`, `webLoginConnectionService`, `systemPnlService`, `automationService`) | PASS |
| 8 | §4.3 | `documentBundleService.ts:679` filter `and(eq(agents.id, ...), eq(agents.organisationId, ...))` | PASS |
| 9 | §4.3 | `documentBundleService.ts:685` filter on `tasks` | PASS |
| 10 | §4.3 | `documentBundleService.ts` scheduledTasks branch filter on `scheduledTasks` | PASS (line 691) |
| 11 | §4.3 | `skillStudioService.ts:168` filter on `skills` | DIRECTIONAL_GAP (conditional on optional `orgId` — fails open when undefined) |
| 12 | §4.3 | `skillStudioService.ts:309` filter on `skills` (inside `tx.update`) | DIRECTIONAL_GAP (same conditional pattern at lines 304/312) |
| 13 | §4.4 | `memoryReviewQueue.ts` calls `resolveSubaccount(req.params.subaccountId, req.orgId!)` | PASS (line 34) |
| 14 | §4.4 | `clarifications.ts` calls `resolveSubaccount(...)` | PASS (line 33) |
| 15 | §4.5 | `verify-rls-session-var-canon.sh` has `HISTORICAL_BASELINE_FILES` array, `BASELINE_ANNOTATION` const, `is_baselined()` helper | PASS |
| 16 | §4.5 | `verify-rls-coverage.sh` has parallel allowlist+annotation check | PASS |
| 17 | §4.5 | Six historical files (0204, 0205, 0206, 0207, 0208, 0212) carry `-- @rls-baseline:` annotation above their phantom-var policy | PASS |
| 18 | §4.6 | All 5 RLS gates return 0 violations on working tree | PASS (verified by running each) |

### Chunk 2 — Phase 2 (§5.1–§5.8)

| # | Spec section | Requirement | Verdict |
|---|---|---|---|
| 19 | §5.1 | `scripts/verify-action-call-allowlist.sh:29` points at `server/lib/workflow/actionCallAllowlist.ts` (NOT `server/lib/playbook/...`) | PASS |
| 20 | §5.1 | `verify-action-call-allowlist.sh` returns 0 violations | PASS |
| 21 | §5.2 | `measureInterventionOutcomeJob.ts:213-218` direct `canonicalAccounts` SELECT replaced with `canonicalDataService` call | PASS (line 215: `canonicalDataService.getAccountsByOrg(organisationId)`) |
| 22 | §5.2 | `verify-canonical-read-interface.sh` returns 0 violations | PASS |
| 23 | §5.3 | `referenceDocumentService.ts:7` no longer imports from `./providers/anthropicAdapter.js`; imports from `./llmRouter.js` | PASS |
| 24 | §5.3 | `llmRouter.ts` re-exports `countTokens`, `SUPPORTED_MODEL_FAMILIES`, `SupportedModelFamily` | PASS (lines 1575-1576) |
| 25 | §5.3 | `verify-no-direct-adapter-calls.sh` returns 0 violations | PASS |
| 26 | §5.4 | `actionRegistry.ts` imports `fromOrgId` from `principal/fromOrgId` | PASS (line 4) |
| 27 | §5.4 | `intelligenceSkillExecutor.ts` imports `fromOrgId` (or `PrincipalContext`) at line 1 area | PASS (line 2) |
| 28 | §5.4 | `connectorPollingService.ts` imports `fromOrgId` | PASS (line 8) |
| 29 | §5.4 | `crmQueryPlanner/executors/canonicalQueryRegistry.ts` threads PrincipalContext | PASS (line 5: imports `fromOrgId`) |
| 30 | §5.4 | `webhooks/ghlWebhook.ts` constructs principal via `fromOrgId(config.organisationId, dbAccount.subaccountId ?? undefined)` after lookup | PASS (line 8) |
| 31 | §5.4 | `verify-principal-context-propagation.sh` returns 0 violations | PASS |
| 32 | §5.5 | `verify-skill-read-paths.sh` returns clean exit | DIRECTIONAL_GAP — gate still reports `Literal action entries: 94, with readPath: 99` (count mismatch of 5). Already tracked in `tasks/todo.md:862` (P3-H8). Phase 2 PR explicitly deferred per progress.md session 3. |
| 33 | §5.6 | `canonicalDataService` registry has entries for `canonical_flow_definitions` and `canonical_row_subaccount_scopes` | PASS (`canonicalDictionaryRegistry.ts` lines 592, 625) |
| 34 | §5.6 | `verify-canonical-dictionary.sh` returns 0 violations | PASS |
| 35 | §5.7 | warning gates do not regress beyond baseline | DIRECTIONAL_GAP — `verify-input-validation.sh` reports 44 violations and `verify-permission-scope.sh` reports 13 violations. Spec says "best-effort triage" not a Phase 2 ship blocker; no baseline reference available to confirm "no regression introduced by Phase 2 work itself" |

### Chunk 3 — Phase 3 (§6.1–§6.3)

| # | Spec section | Requirement | Verdict |
|---|---|---|---|
| 36 | §6.1 | `shared/types/agentExecutionCheckpoint.ts` exists and exports `AgentRunCheckpoint`, `SerialisableMiddlewareContext`, `SerialisablePreToolDecision`, `PreToolDecision` | PASS |
| 37 | §6.1 | `server/services/middleware/types.ts` re-exports the four types from shared | PASS (lines 10-15) |
| 38 | §6.1 | `server/db/schema/agentRunSnapshots.ts:3` imports from `shared/types/agentExecutionCheckpoint.js` | PASS |
| 39 | §6.2.1 | `client/src/components/clientpulse/types.ts` exists with shared interfaces | PASS |
| 40 | §6.2.1 | All 5 sub-editors plus `ProposeInterventionModal` import from `./types` | PASS (verified all 6 files) |
| 41 | §6.2.2 | `client/src/components/skill-analyzer/types.ts` exists with shared interfaces | PASS |
| 42 | §6.2.2 | `SkillAnalyzerWizard` and the four step components import from `./types` | MECHANICAL_GAP -> FIXED — `SkillAnalyzerResultsStep.tsx` was importing types via `./SkillAnalyzerWizard`; spec §6.2.2 names this file as part of the cluster ("Update both `SkillAnalyzerWizard.tsx` and the four step components to import from the new file"). Fixed by changing the import source to `./types`. |
| 43 | §6.3 | `npx madge --circular --extensions ts server/ \| wc -l` ≤ 5 | DIRECTIONAL_GAP — server cycle count is **43**, far above DoD target of ≤ 5. Spec predicted 175→≤5 by fixing the schema-leaf root, but the remaining 43 cycles are unrelated pre-existing cycles. The agentRunSnapshots cascade was successfully eliminated. |
| 44 | §6.3 | `npx madge --circular --extensions ts,tsx client/src/ \| wc -l` ≤ 1 | PASS — count is 0 after the mechanical fix in REQ #42 |
| 45 | §6.3 | `npm run build:server` passes | PASS |
| 46 | §6.3 | `npm run build:client` passes | PASS |

---

## Mechanical fixes applied

### `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx`

```
[FIXED] REQ #42 — SkillAnalyzerResultsStep imports types from ./types (was ./SkillAnalyzerWizard)
  File: client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx
  Lines: 7-14
  Spec quote: "Update both `SkillAnalyzerWizard.tsx` and the four step components to import from the new file."
  Change: changed import source from './SkillAnalyzerWizard' to './types'; all 6 named imports (AnalysisJob, AnalysisResult, AgentProposal, AvailableSystemAgent, ParsedCandidate, BackupMetadata) are present in types.ts.
  Verification: client cycle count dropped from 1 to 0 (`npx madge --circular --extensions ts,tsx client/src/`); `npm run build:client` passes.
```

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

| REQ | Section | Gap (one-line) | Suggested approach |
|---|---|---|---|
| 11 / 12 | §4.3 | `skillStudioService.ts` lines 168 / 304-305 / 312-313 conditionalise the org filter on `orgId` being truthy; spec required unconditional filter | Decide whether `orgId` should be a required parameter in `getSkillStudioContext`/`saveSkillVersion` (signature change, 2-3 callers) or whether the gate's defense-in-depth principle accepts the conditional fallback for system-scoped admin paths |
| 32 | §5.5 | `verify-skill-read-paths.sh` still reports `Literal action entries: 94, with readPath: 99` | Already tracked at `tasks/todo.md:862` (P3-H8). Skipping new entry to avoid duplication per CLAUDE.md routing rule. |
| 35 | §5.7 | `verify-input-validation.sh` (44) and `verify-permission-scope.sh` (13) emit non-blocker warnings — no baseline available to confirm Phase 2 didn't regress | Capture pre-Chunk-2 baseline counts from a `main`-state run and diff against current; if Phase 2 introduced new warnings, fix them per §5.7 step 3; otherwise accept as pre-existing observability |
| 43 | §6.3 | Server `madge --circular` count is 43, spec DoD target is ≤ 5 | Triage the remaining 43 cycles into clusters: (a) `skillExecutor` <-> tools handlers, (b) `agentExecutionService` <-> `services/middleware/*` chain, (c) `agentService` <-> `llmService` <-> `queueService` <-> proposeClientPulseInterventionsJob chain. Decide which clusters land in Phase 5A and which (if any) require an in-Phase-3 follow-up. |

---

## Files modified by this run

- `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` (mechanical fix REQ #42)

---

## Notes (non-blocking observations)

1. **Migration 0227 includes `reference_documents` and `reference_document_versions` (10 tables total)** even though spec §0 / §3.5 explicitly state these two tables are NOT part of the historical-noise / first-creation correction set. Inspection of `migrations/0202_reference_documents.sql` and `0203_reference_document_versions.sql` shows they actually DO lack `FORCE ROW LEVEL SECURITY` and `WITH CHECK` — so the implementation is **more conservative than the spec required**. Adding canonical-pattern coverage to these two tables is defensible (it removes a real gap in the on-disk policy text); flagging here only because the spec narrative excluded them. Operator may want to update spec §0/§3.5/§4.1 to reflect the actual state, or accept the 0227 expansion as final.

2. **§5.5 deferral is documented in two places** (`tasks/builds/audit-remediation/progress.md` session 3 + `tasks/todo.md:862`). No additional routing needed.

---

## Next step

**CONFORMANT_AFTER_FIXES** — one mechanical gap closed in-session (`SkillAnalyzerResultsStep.tsx`); four directional items routed to `tasks/todo.md` for the main session to triage. The mechanical fix expanded the changed-code set, so when running `pr-reviewer` afterwards it must see the post-fix state.

Recommended sequence:
1. Resolve the 4 directional items in `tasks/todo.md` (or accept them as deferred)
2. Re-run `pr-reviewer` on the expanded changed-code set
3. Decide whether the 43-cycle server-cycles overshoot vs the ≤ 5 DoD target requires (a) re-scoping Phase 3 DoD against actual pre-existing cycle baseline, (b) extending Phase 3 with additional cycle-reduction work, or (c) accepting that the cycle reduction lands across Phase 3 + Phase 5A as a unified outcome.

