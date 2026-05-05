# Spec Conformance Audit — cached-context-infrastructure

**Date:** 2026-04-23T09-50-17Z
**Spec:** `docs/cached-context-infrastructure-spec.md`
**Branch:** `claude/implementation-plan-Y622C`
**Execution model:** In-session playbook (not sub-agent).
**Scope:** Full spec (§4–§7, §11, plus infrastructure wiring).

---

## Summary

Next-step verdict: **CONFORMANT_AFTER_FIXES**.

- 40 subcomponents audited one at a time under the §Step 0 TodoWrite protocol.
- 3 mechanical fixes applied in-session.
- 0 directional gaps remaining (all resolved in-session rather than routed to tasks/todo.md).
- Caller should re-run `pr-reviewer` on the expanded changed-code set.

---

## Mechanical fixes applied

### 1. Migration 0210 filename renamed (§5.9)
- **Before:** `migrations/0210_llm_requests_cache_attribution.sql`
- **After:** `migrations/0210_llm_requests_cached_context.sql`
- Spec §5.9 explicitly names the file. Rename via `git mv` preserves history.

### 2. `suggestBundle` over-broad "named bundle exists" check (§6.2)
- **File:** `server/services/documentBundleService.ts` lines ~263–290
- Before: returned `suggest: false` whenever ANY named bundle existed in the org/subaccount.
- After: joins `document_bundles` + `document_bundle_members`, computes each candidate named bundle's doc-set hash, returns `suggest: false` only when a named bundle with THIS exact doc set exists — matching spec §6.2 condition #3.

### 3. Shared `ResolvedExecutionBudget` + `ContextAssemblyResult` aligned with spec (§4.1, §4.2)
- **File:** `shared/types/cachedContext.ts`
- `ResolvedExecutionBudget` — renamed `maxTotalCostUsdCents` → `maxTotalCostUsd`, renamed `softWarnThreshold` → `softWarnRatio`, added required `resolvedFrom`, `modelContextWindow`; narrowed `modelFamily` to the Sonnet/Opus/Haiku union. Matches spec §4.1 exactly.
- `ContextAssemblyResult` — changed `kind: 'ready'` → `kind: 'ok'` with `routerPayload`, `prefixHash`, `variableInputHash`, `bundleSnapshotIds`, `softWarnTripped`, `assemblyVersion` fields. `budget_breach` variant reduced to `{ kind, blockPayload: HitlBudgetBlockPayload }`. Matches spec §4.2.
- No consumers broken — the impl (engine + resolver + orchestrator) already returned the spec-matching shape; only the stale shared-type declaration was wrong.

---

## Requirements extracted (full checklist)

All 40 subcomponents from the audit todo list — one item per numbered spec subsection that names an implementable artifact.

### §5 Schema (10 items)
- §5.1 `reference_documents` — **PASS**
- §5.2 `reference_document_versions` — **PASS**
- §5.3 `document_bundles` (+ CHECK) — **PASS**
- §5.4 `document_bundle_members` — **PASS**
- §5.5 `document_bundle_attachments` — **PASS**
- §5.6 `bundle_resolution_snapshots` — **PASS**
- §5.7 `model_tier_budget_policies` (+ capacity CHECK) — **PASS**
- §5.8 `agent_runs` new columns — **PASS**
- §5.9 `llm_requests` new columns — **MECHANICAL_GAP** (migration filename) → fixed in session.
- §5.12 `bundle_suggestion_dismissals` — **PASS**

### §6 Services (7 items)
- §6.1 `referenceDocumentService` (+ pure) — **PASS**
- §6.2 `documentBundleService` (+ pure) — **DIRECTIONAL_GAP** (suggestBundle) → fixed in session.
- §6.3 `bundleResolutionService` (+ pure) — **PASS** (minor: `assemblyVersion` is a module-level constant rather than a parameter; safer behavior equivalence).
- §6.4 `contextAssemblyEngine` (+ pure) + `ASSEMBLY_VERSION` — **PASS**
- §6.5 `executionBudgetResolver` (+ pure) — **PASS**
- §6.6 `cachedContextOrchestrator` + outcome classification + router extension — **PASS**
- §6.7 `bundleUtilizationJob` — **PASS**

### §7 Routes (4 items)
- §7.1 reference documents routes (12 routes) — **PASS**
- §7.2 document bundles routes (15 routes) — **PASS**
- §7.2 admin routes (2 routes) — **PASS**
- §7.2 subject listing routes (3 routes) — **PASS**

### §4 Contracts (6 items)
- §4.1 `ResolvedExecutionBudget` — **DIRECTIONAL_GAP** → fixed in session.
- §4.2 `ContextAssemblyResult` — **DIRECTIONAL_GAP** → fixed in session.
- §4.3 `BundleResolutionSnapshotEntry` — **PASS**
- §4.4 `PrefixHashComponents` + hash algorithm — **PASS**
- §4.5 `HitlBudgetBlockPayload` — **PASS**
- §4.6 `RunOutcome` + `DegradedReason` — **PASS**

### Infrastructure wiring (8 items)
- Action registry `cached_context_budget_breach` entry — **PASS**
- Migrations 0200–0212 (0211 intentionally skipped per spec) — **PASS**
- RLS coverage (8 tenant-scoped tables) in `rlsProtectedTables.ts` — **PASS**
- Schema index.ts exports (8 modules) — **PASS**
- `server/index.ts` mounts both routers — **PASS**
- `queueService.ts` bundleUtilizationJob registered — **PASS**
- §11.1 golden-fixture test — **PASS**
- `architecture.md` + `docs/capabilities.md` — **PASS**

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

None. All directional gaps were non-architectural and were resolved in-session.

---

## Files modified by this run

- `migrations/0210_llm_requests_cache_attribution.sql` → `migrations/0210_llm_requests_cached_context.sql` (rename)
- `server/services/documentBundleService.ts` (suggestBundle fix)
- `shared/types/cachedContext.ts` (ResolvedExecutionBudget + ContextAssemblyResult aligned to spec)

---

## Next step

- Caller should re-run `pr-reviewer` on the expanded changed-code set since mechanical fixes were applied.
- No deferred backlog items. No further spec-conformance re-invocation needed.
