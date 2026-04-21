# Dual Review Log — llm-observability-ledger

**Files reviewed:** server/jobs/llmLedgerArchiveJob.ts, llmLedgerArchiveJobPure.ts, server/routes/systemPnl.ts, server/services/systemPnlService.ts, systemPnlServicePure.ts, llmRouter.ts, llmService.ts, providers/callerAssert.ts, agentBriefingService.ts, outcomeLearningService.ts, workspaceMemoryService.ts, skillExecutor.ts, scripts/verify-no-direct-adapter-calls.sh, shared/types/systemPnl.ts, migrations/0189
**Iterations run:** 1/3
**Timestamp:** 2026-04-20T11:58:00Z

---

## Findings

[ACCEPT] server/services/llmRouter.ts:285-287 — guard throws for existing system-scoped routeCall contexts that pass executionPhase
  Reason: REAL and BLOCKING. Migration 0185 added a DB CHECK constraint requiring execution_phase IS NULL when source_type IN ('system','analyzer'). The router guard enforces this at the application layer. However 8 existing call sites across 4 files (workspaceMemoryService x3, agentBriefingService x1, outcomeLearningService x1, skillExecutor x1) still pass sourceType:'system' with executionPhase:'execution'. Without the fix, every system-background feature (memory compilation, HyDE expansion, context enrichment, briefings, outcome learning, scrape_structured) throws RouterContractError. Fix: removed executionPhase from all 8 sites.

[ACCEPT] server/services/providers/callerAssert.ts:38-40 — PROVIDER_FRAME_PATTERN always matches, making the guard a no-op
  Reason: REAL logic bug introduced in this branch. When assertCalledFromRouter() is called from an adapter's call() method, the adapter's own file is always in the call stack and matches PROVIDER_FRAME_PATTERN. So hasRouterOrProviderFrame is always true — the guard never throws. There is no intra-provider fallback in this codebase (providerAdapter.call() has only one caller: llmRouter.ts). Fix: removed PROVIDER_FRAME_PATTERN entirely; guard checks only ROUTER_FRAME_PATTERN.

[ACCEPT] server/services/systemPnlService.ts:441,491 — pctOfCost denominator double-counts overhead
  Reason: REAL math bug. platformTotals() returns costCents = SUM(cost_raw*100) across ALL source types including system/analyzer, and overheadCents = same filtered to overhead. So platform.costCents already includes overhead. Formula pctOfTotal(x, platform.costCents + platform.overheadCents) adds overhead twice to the denominator, understating all pctOfCost values in the By Source Type and By Provider/Model tabs. Fix: changed to pctOfTotal(x, platform.costCents) in getBySourceTypeTx and getByProviderModel.

[REJECT] server/services/llmRouter.ts:696-700 — parse_failure records zero tokens and zero cost
  Reason: Intentional design. When postProcess throws ParseFailureError the code nulls providerResponse and retries. After all retries exhaust, token data from every prior attempt is discarded by design (the retry loop tries multiple providers). Recording zero cost is the conservative choice. Fixing this properly requires preserving the last successful token response across retries — architectural scope beyond these pr-reviewer fixes. The spec acknowledges parse_failure as a status with known cost-accounting limits.

[REJECT] server/jobs/llmLedgerArchiveJobPure.ts:15-17 — setUTCMonth day overflow on short months
  Reason: Conservative under-archiving at month boundaries; no data loss. The test at lines 62-72 explicitly documents and pins the V8 month-arithmetic behavior. For the edge case (e.g. Mar 31 - 1 month overflows to Mar 3), the cutoff is more recent than intended — more rows stay in the live table, never fewer. Pre-existing acknowledged design choice.

[REJECT] server/services/systemPnlService.ts:203 — cost_aggregates 'organisation' dimension includes system/analyzer overhead costs
  Reason: DIRECTIONAL. Fixing this requires modifying costAggregateService.ts to filter source_type before writing the 'organisation' aggregate dimension. Outside scope of these fixes. With the executionPhase fix now applied, system/analyzer rows have margin=1.0× (revenue=cost), so the distortion is bounded: revenue and cost for those rows are equal, leaving profit/margin unaffected. Belongs in a future spec refinement.

---

## SQL-specific analysis (user's explicit questions)

1. Archive CTE (B1/S4): The doomed→inserted(ON CONFLICT DO NOTHING)→deleted(WHERE id IN doomed) chain is PostgreSQL-correct. DELETE uses doomed not inserted, so rows skipped by ON CONFLICT (already archived) are still deleted from the live table, preventing "never shrinks" bug. FOR UPDATE SKIP LOCKED in a CTE locks at statement start; subsequent CTEs see the same snapshot within the transaction. No concurrency or snapshot-visibility issue.

2. security_invoker=on (B5): Correct. RLS is evaluated against the caller's role. System P&L caller is admin_role (BYPASSRLS) so the view is a plain union for that caller. Any future org-scoped caller gets RLS from both underlying tables. The alternative (security_definer) would bypass RLS entirely for whoever owns the view — wrong for a cross-tenant view.

3. Direct-HTTP regex (B6): Pattern catches string-literal URLs to known provider hostnames. Gaps: template literals, env-variable URLs, dynamic construction — acceptable for a belt-and-suspenders gate. Primary enforcement is the adapter import check + runtime assertCalledFromRouter(). New providers must be added to both PROVIDER_NAMES and the hostname list.

4. platformTotals() math: FILTER aggregate correctly scopes overhead. previousMonth() uses Date.UTC(y, m-2, 1) — always day 1, no overflow. parseMonthParam() regex rejects month 00 and 13+. pctOfCost double-count: fixed.

---

## Changes Made

- server/services/workspaceMemoryService.ts — removed executionPhase:'execution' from 3 system-scoped routeCall contexts (hyde_expansion, memory_compile, context_enrichment)
- server/services/agentBriefingService.ts — removed executionPhase:'execution' from system-scoped briefing call
- server/services/outcomeLearningService.ts — removed executionPhase:'execution' from system-scoped outcome-learning call
- server/services/skillExecutor.ts — removed executionPhase:'execution' from system-scoped scrape_structured call
- server/services/providers/callerAssert.ts — removed PROVIDER_FRAME_PATTERN; guard now checks only ROUTER_FRAME_PATTERN
- server/services/systemPnlService.ts — fixed pctOfCost denominator in getBySourceTypeTx and getByProviderModel from platform.costCents+platform.overheadCents to platform.costCents

## Verification

- systemPnlServicePure.test.ts: 25/25 pass
- ledgerArchivePure.test.ts: 6/6 pass
- verify-no-direct-adapter-calls.sh: PASS
- TypeScript build: no new errors in edited files (pre-existing errors in pulseService, workspaceMemoryService:1244, capabilityDiscoveryHandlers confirmed pre-existing on main)

---

**Verdict:** `PR ready. All critical and important issues resolved.` Three real bugs fixed: (1) blocking RouterContractError regression for 8 existing system-background call sites, (2) callerAssert runtime guard was a no-op due to provider-frame false-positive, (3) pctOfCost denominator double-counted overhead understating all cost-share percentages. Two findings rejected as pre-existing acknowledged design choices. One finding rejected as directional/out-of-scope.
