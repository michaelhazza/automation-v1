# pre-testing-fixes — session progress

**Branch:** `claude/pre-testing-fixes-OPR8w`
**Started:** 2026-04-27
**Goal:** Ship LAEL-P1-1 (LLM event emission + payload writer wiring) before testing iteration starts.

## Status of each brief task

### Task 1 — Hermes §6.8 errorMessage gap
**Status:** ALREADY MERGED on `main`. Commit `35112d0` ("feat(hardening): Phase 5 — execution-path correctness") landed `HERMES-S1`:
- `preFinalizeRow` select extended to fetch `agentRuns.errorMessage`.
- `threadedErrorMessage = derivedRunResultStatus === 'failed' ? (preFinalizeRow?.errorMessage ?? null) : null`.
- Passed to `extractRunInsights` instead of hardcoded null.
- Emits `run.terminal.extracted_with_errorMessage` (non-critical) when threading occurs.

Code site: `server/services/agentExecutionService.ts:1701-1731`. No further action. `tasks/todo.md` § "Hermes Tier 1 — Deferred Item (S1)" is stale and will be marked resolved.

### Task 2 — LAEL-P1-1 LLM event emission + payload writer wiring
**Status:** OUTSTANDING. TODO marker still present at `server/services/llmRouter.ts:845-855`. Architect plan in progress at `tasks/builds/pre-testing-fixes/lael-p1-1-plan.md`.

### Task 3 — S-2 Principal-context propagation
**Status:** ALREADY MERGED on `main`. Two commits resolved this:
- `cc68168` "feat(canonicalDataService): A1a — PrincipalContext as first parameter; caller sites migrated" — migrated `canonicalDataService` signatures to accept `PrincipalContext` and updated the 4 caller files.
- `58476bc` "feat(verify): A1b — call-site granularity for principal-context gate" — hardened `scripts/verify-principal-context-propagation.sh` to per-call-site enforcement (already at this granularity in current `scripts/verify-principal-context-propagation.sh`).

Verified by running `bash scripts/verify-principal-context-propagation.sh` → "7 files scanned, 0 violations found".

The 4 files from the brief:
- `server/config/actionRegistry.ts` — has `// @principal-context-import-only — reason:` annotation on line 1; the file does NOT actually call `canonicalDataService` (only references it in a docstring at line 113). Annotation is correct; no fix needed.
- `server/services/connectorPollingService.ts` — uses `fromOrgId(...)` at all `canonicalDataService.upsert*(principal, ...)` call sites (lines 125-225).
- `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts` — uses `fromOrgId(args.orgId, args.subaccountId)` at every `canonicalDataService.*(principal, ...)` call (lines 43-130+).
- `server/routes/webhooks/ghlWebhook.ts` — uses `fromOrgId(orgId, dbAccount.subaccountId ?? undefined)` after the `connectorConfigs`/`canonicalAccounts` lookup; threads through every `canonicalDataService.upsert*(principal, ...)` (lines 112-146).

`tasks/todo.md` § "Deferred from pr-reviewer review — audit-remediation (2026-04-25) / S-2" entry is stale and will be marked resolved.

## Outcome of this session

Only Task 2 produces new code. Tasks 1 and 3 produce only doc updates (`tasks/todo.md` cleanup) confirming the prior work landed.
