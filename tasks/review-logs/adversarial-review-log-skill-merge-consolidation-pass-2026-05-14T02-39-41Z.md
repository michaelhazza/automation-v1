# Adversarial Review Log

**Build slug:** skill-merge-consolidation-pass
**Branch:** claude/improve-skill-analyzer-RiFpB
**HEAD:** b47b1019
**Review timestamp:** 2026-05-14T02:39:41Z
**Reviewer:** adversarial-reviewer (Phase 1, advisory, non-blocking)

**Verdict:** HOLES_FOUND (1 confirmed-hole, 3 likely-holes, 2 worth-confirming)

**Files reviewed:**
- migrations/0358_skill_merge_consolidation.sql + .down.sql
- server/db/schema/skillAnalyzerConfig.ts
- server/db/schema/skillAnalyzerResults.ts
- server/services/skillAnalyzerConfigService.ts
- server/services/skillAnalyzerServicePure.ts (consolidation block, lines 3320-3710)
- server/jobs/skillAnalyzerJob.ts (consolidation gate, lines 1142-1425)
- client/src/components/skill-analyzer/MergeReviewBlock.tsx (ConsolidationBanner, lines 957-1065)
- client/src/components/skill-analyzer/mergeTypes.ts
- client/src/components/skill-analyzer/types.ts

---

## Findings (summary)

| # | Label | Category | Location |
|---|---|---|---|
| 1 | confirmed-hole | RLS / tenant isolation | `skill_analyzer_results` not in RLS registry; new JSONB columns of sensitive content added without RLS backstop |
| 2 | likely-hole | Race conditions / semantics | `originalProposedMerge` repurposing changes Reset semantics in ways that may surprise operators |
| 3 | likely-hole | Injection | `buildConsolidationPrompt` interpolates untrusted LLM-generated `instructions` into the second prompt; `instructions` field not protected by parser mutation guards |
| 4 | likely-hole | Resource abuse | Consolidation gate adds an unbounded-per-job LLM call count with `bypass_routing` that may skip per-org budget guards |
| 5 | worth-confirming | Auth & permissions | Config update route for new fields should verify `requireSystemAdmin` gating |
| 6 | worth-confirming | Repudiation | No durable audit event written for consolidation transformation; log-only trail |

---

## Detailed findings

### 1. RLS / Tenant Isolation — confirmed-hole

`skill_analyzer_results` is NOT in `server/config/rlsProtectedTables.ts`. The three new columns (`pre_consolidation_merge`, `consolidation_outcome`, `consolidation_note`) are added to this table via migration 0358 and hold multi-tenant skill content. No RLS policy exists for the table in any migration.

The diff EXPANDS the surface (new JSONB content column) without addressing the pre-existing gap.

**Fix:** Add `skill_analyzer_results` to `rlsProtectedTables.ts` with a join-based policy via `skill_analyzer_jobs.organisation_id`. Add `-- system-scoped: singleton row, no per-org data` comment to migration header for `skill_analyzer_config`.

### 2. Race Conditions — likely-hole (semantics shift)

`originalProposedMerge` repurposing on consolidation success means Reset gives the reviewer the consolidated output, not the first-pass merge. The pre-consolidation draft is only accessible via the read-only `preConsolidationMerge` disclosure panel. Spec §4.5 documents this; the concern is operator surprise and inability to recover the first-pass draft through the UI.

### 3. Injection — likely-hole

`buildConsolidationPrompt` interpolates the merged skill content via `JSON.stringify(mergedForPrompt, null, 2)`. The `merged` object comes from the first-pass LLM response. A jailbroken upstream LLM response could plant adversarial directives in `merged.instructions` that survive serialization and appear in the consolidation prompt.

`parseConsolidationResponse` guards `name/description/definition/mergeRationale` via deep-equal mutation checks but does NOT guard `instructions` — second-order prompt injection vector for `instructions` content.

### 4. Resource Abuse — likely-hole

Consolidation LLM call uses `systemCallerPolicy: 'bypass_routing'`, which may exempt it from the `assertWithinRunBudgetFromLedger` per-org budget guard. A large import job (e.g. 500 skills, 30% SCOPE_EXPANSION) could trigger 150 unbounded Sonnet calls × 8K maxTokens = 1.2M output tokens with no per-job consolidation-call cap.

### 5. Auth & Permissions — worth-confirming

`skillAnalyzerConfigService.updateConfig()` accepts `consolidationEnabled` and `consolidationTriggerSeverity` as patchable fields. Confirm the route serving config updates is gated by `requireSystemAdmin` and not by a tenant-scoped admin middleware that would let an org admin flip consolidation settings for all tenants.

### 6. Repudiation — worth-confirming

No `agent_execution_events` row or equivalent durable audit table entry is written for the consolidation transformation. Trail is logger-only. For a system-admin-only surface this is low severity but worth noting — operators cannot query "did consolidation modify this row?" without log access.

---

## Phase 1 advisory routing

All findings are non-blocking under current policy. Routing to `tasks/todo.md` for finalisation-coordinator review:

- SKILL-MERGE-RLS-1 — Add `skill_analyzer_results` to `rlsProtectedTables.ts` with join-based policy via `skill_analyzer_jobs.organisation_id`. Add system-scoped comment to migration header for `skill_analyzer_config`.
- SKILL-MERGE-INJECTION-1 — Decide whether to guard `instructions` field against mutation in `parseConsolidationResponse`, or accept the second-order prompt injection risk on the system-admin-only surface.
- SKILL-MERGE-BUDGET-1 — Verify whether `systemCallerPolicy: 'bypass_routing'` exempts consolidation calls from per-org LLM budget guards; if yes, add per-job consolidation-call cap or budget-aware skip.
- SKILL-MERGE-AUDIT-1 — Decide whether to add a durable audit event for consolidation transformations.
- SKILL-MERGE-AUTHGATE-1 — Verify config-update route gating for new `consolidationEnabled` / `consolidationTriggerSeverity` fields.
- SKILL-MERGE-RESET-UX-1 — Confirm Reset semantics change (UI affordance discoverability) with operator before merge.
