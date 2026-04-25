# PR Review Log — audit-remediation (Chunks 1+2+3)

**Reviewer:** pr-reviewer (independent, read-only)
**Branch:** `feat/codebase-audit-remediation-spec`
**Spec:** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`
**Build slug:** `audit-remediation`
**Scope reviewed:**
- Chunk 1 (Phase 1) committed at `c6f491c3`
- Chunk 2 (Phase 2) committed at `79b6e89f`
- Spec-conformance auto-fix at `5bc3b19c`
- Chunk 3 (Phase 3) — uncommitted working tree
- skillStudioService directional fix — uncommitted working tree
**Run at:** 2026-04-25T12:21:49Z
**Pre-existing baselines acknowledged (NOT flagged as branch regressions):** `verify-skill-read-paths.sh`, `verify-pure-helper-convention.sh`, `verify-integration-reference.mjs` (gates), and the four pre-existing failing unit-test files (`referenceDocumentServicePure`, `skillAnalyzerServicePureFallbackAndTables`, `skillHandlerRegistryEquivalence`, `crmQueryPlannerService`). Verified against `main` HEAD `ee428901`.

---

## Contents

- [Blocking Issues](#blocking-issues-must-fix-before-marking-done)
- [Strong Recommendations](#strong-recommendations-should-fix)
- [Non-Blocking Improvements](#non-blocking-improvements)
- [Additional check results (passed)](#additional-check-results-positive--passed-independent-verification)
- [Verdict](#verdict)

---

## Blocking Issues (must fix before marking done)

### B-1 — Migration 0227 will fail to apply on `reference_document_versions`

**File:** `migrations/0227_rls_hardening_corrective.sql:38-53`
**Severity:** CRITICAL — production-blocker. The migration cannot run.

The migration creates a canonical-shape policy on `reference_document_versions`:

```sql
CREATE POLICY reference_document_versions_org_isolation ON reference_document_versions
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (...);
```

But `reference_document_versions` does **not** have an `organisation_id` column. Per `migrations/0203_reference_document_versions.sql:13-32` and `server/db/schema/referenceDocumentVersions.ts:18-46`, the table has only `id`, `document_id`, `version`, `content`, `content_hash`, `token_counts`, `serialized_bytes_hash`, `created_by_user_id`, `change_source`, `notes`, `created_at`. Postgres will raise `ERROR: column "organisation_id" does not exist` when 0227 attempts the CREATE POLICY.

The original 0203 policy correctly used an EXISTS subquery against the parent `reference_documents` table.

**Fix options:**
1. Remove the `reference_document_versions` block from 0227 entirely (consistent with spec §0/§3.5/§4.1 which exclude 0202/0203 from scope; see B-3 below).
2. If FORCE RLS is genuinely desired on this table, keep only the `ALTER TABLE … FORCE ROW LEVEL SECURITY` and rebuild the policy using the EXISTS subquery shape from 0203 (with `WITH CHECK` mirroring `USING`). Add explicit non-empty / non-null guards on `current_setting(...)` inside the subquery's `rd.organisation_id` comparison, since the policy still depends on the session var.

### B-2 — Migration 0227 leaves stale `reference_documents_subaccount_isolation` policy in place

**File:** `migrations/0227_rls_hardening_corrective.sql:15-33`

The migration drops only `reference_documents_org_isolation` but `migrations/0202_reference_documents.sql:62-66` also created `reference_documents_subaccount_isolation`, which references the phantom session variable `app.current_subaccount_id`:

```sql
CREATE POLICY reference_documents_subaccount_isolation ON reference_documents
  USING (
    subaccount_id IS NULL
    OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid
  );
```

After 0227 lands (and assuming B-1 is fixed and the migration applies), Postgres applies USING policies as a conjunction. Under `withPrincipalContext` (which DOES set `app.current_subaccount_id`), reads work. Under the canonical request paths (`server/middleware/auth.ts`, `server/lib/createWorker.ts`) which do NOT set the var, the conjunct evaluates `subaccount_id = NULL::uuid` → NULL → the row is excluded for any document with a non-null `subaccount_id`. This is a regression risk for legitimate readers and exactly the failure mode `migrations/0213_fix_cached_context_rls.sql` (the spec's named precedent) explicitly avoids by dropping subaccount-isolation policies.

Spec §4.1 line 351: "If the actual migration text introduces policies under additional names …, 0227 must be updated to drop those names too before merge. Mirroring 0213's precedent — which explicitly drops `*_subaccount_isolation`, `*_read`, and `*_write` policies per affected table — is the canonical posture: enumerate every historical name; never assume the canonical-shape policy is the only one present."

Spec §4.1 line 382 (Subaccount scoping clarification): "**no subaccount-isolation policies are created** for these tables."

**Fix:** Add `DROP POLICY IF EXISTS reference_documents_subaccount_isolation ON reference_documents;` to 0227 alongside the existing `reference_documents_org_isolation` drop.

### B-3 — Migration 0227 includes tables explicitly excluded by spec §0/§3.5/§4.1

**File:** `migrations/0227_rls_hardening_corrective.sql:15-53`
**Severity:** Scope discipline / spec conformance.

Spec §0 line 65, §3.5 line 266, §4.1 line 768, and the §4.1 table (lines 340-349) all explicitly exclude `reference_documents` and `reference_document_versions` from 0227's scope. The §4.1 table lists exactly eight tables; the migration adds two more.

The spec-conformance log (Notes section, item 1) flagged this as "more conservative than the spec required" and asked the operator to decide between updating the spec or accepting the expansion. The expansion is defensible on its own merits (0202 genuinely lacks FORCE RLS), but the implementation introduced B-1 and B-2 in the process. The spec's exclusion was correct: 0203's child-table policy is structurally different from the canonical pattern, and the canonical pattern cannot be applied verbatim without engineering the EXISTS variant.

**Fix:** Either (a) remove both `reference_documents` and `reference_document_versions` blocks from 0227 to match spec scope, OR (b) rewrite both blocks correctly (per B-1 / B-2), update the spec §0/§3.5/§4.1 to reflect the expansion, and update the migration's header comment lines 16 and 36 (which currently say "Migration 0202 was missing FORCE ROW LEVEL SECURITY" / "Migration 0203 was missing FORCE ROW LEVEL SECURITY" without acknowledging the divergence from the spec scope).

The minimum-risk option is (a): drop the two blocks. The two tables can be addressed in a separate follow-on migration with a properly designed policy for the version table.

## Strong Recommendations (should fix)

### S-1 — `rollbackSkillVersion` passes `null` orgId; will throw for org/subaccount scopes after the directional fix

**File:** `server/services/skillStudioService.ts:378`

After today's directional fix made `orgId` required for non-system scopes in `saveSkillVersion`, the existing call inside `rollbackSkillVersion` is now a latent footgun:

```ts
await saveSkillVersion(skillId, scope, null, { … }, authorUserId);
```

Today, the only caller (`server/routes/skillStudio.ts:73`) passes `'system'` scope, so it's safe in practice. But `rollbackSkillVersion`'s outer signature still accepts `'system' | 'org' | 'subaccount'`, so any future caller that invokes it with org/subaccount scope will hit the new throw inside `saveSkillVersion` with a confusing "saveSkillVersion: orgId is required for scope=…" error from a callee.

**Fix:** Either (a) propagate `orgId` through `rollbackSkillVersion`'s signature and call `saveSkillVersion(skillId, scope, orgId, …)`, or (b) tighten `rollbackSkillVersion`'s `scope` parameter to `'system'` only (matching the single existing caller). Option (b) is the smaller change; option (a) is more future-proof.

### S-2 — Principal-context propagation is import-only, no `fromOrgId(...)` calls anywhere

**Files:**
- `server/config/actionRegistry.ts:4`
- `server/services/intelligenceSkillExecutor.ts:2`
- `server/services/connectorPollingService.ts:8`
- `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts:5`
- `server/routes/webhooks/ghlWebhook.ts:8`

Each of the five files imports `fromOrgId` to satisfy `verify-principal-context-propagation.sh`, but **none call it**. `grep -rn "fromOrgId(" server/` returns only the function definition itself. The canonicalDataService callers (e.g. `ghlWebhook.ts:115-145`, `connectorPollingService.ts:126-220`, `canonicalQueryRegistry.ts:43-139`) continue to invoke methods with `(orgId, accountId, …)` legacy signatures.

Spec §5.4 line 922 for `ghlWebhook`: "Construct the principal context AFTER that lookup with `fromOrgId(config.organisationId, dbAccount.subaccountId ?? undefined)` and pass it to every `canonicalDataService` call downstream."

Spec §5.4 line 920 for `connectorPollingService`: "Use `fromOrgId(organisationId)` at org-level call sites and `fromOrgId(organisationId, dbAccount.subaccountId ?? undefined)` at the per-record sites — call out which calls fall into each bucket in the PR description."

Spec §5.4 line 918 for `actionRegistry`: "wrap with `fromOrgId(organisationId, subaccountId)` when invoking `canonicalDataService` methods."

The implementation does not match the spec for at least three of the five files. The unused-import pattern also raises a lint / dead-code smell — `fromOrgId` is a value import, not a `type` import, so any `@typescript-eslint/no-unused-vars` configuration will flag it.

Note: the spec itself acknowledges (line 919) that `intelligenceSkillExecutor.ts` is import-presence-only ("Add `import type { PrincipalContext }` to satisfy the gate's import-presence check"), so that single file is consistent with spec text. The other four are not.

**Fix:** Either (a) add real `fromOrgId(...)` calls at each canonicalDataService invocation site per spec §5.4 (the spec's "Fix per file" table prescribes exact patterns), or (b) update spec §5.4 to acknowledge that the propagation work is import-presence-only across all five files and route the actual propagation to a follow-on phase. Document the choice in the PR description.

### S-3 — `automationConnectionMappingService.listMappings` and `cloneAutomation` source SELECT lack `organisationId` filter

**File:** `server/services/automationConnectionMappingService.ts:16-23, 92-94`

`listMappings(subaccountId, automationId)` filters by `subaccountId` and `automationId` only — no `organisationId`. The route caller does call `resolveSubaccount(...)` first, which protects against horizontal escalation, but the spec / `architecture.md` defence-in-depth principle (every read by ID also filters `organisationId` explicitly) is not honoured here.

`cloneAutomation`'s source SELECT (line 92-94) similarly omits `organisationId` from the WHERE clause — the cross-org guard happens via the manual check on line 99 (`source.scope !== 'system' && source.organisationId !== organisationId`). This works but is the pattern the gate `verify-org-scoped-writes.sh` exists to retire.

**Fix:** Add `eq(automationConnectionMappings.organisationId, organisationId)` to both `listMappings` queries; add `eq(automations.organisationId, organisationId)` (or use a `OR scope = 'system'` branch) to `cloneAutomation`'s source SELECT. Threading `organisationId` requires a small signature change to `listMappings`.

### S-4 — Server cycle count is 43, spec DoD target was ≤ 5

Per the spec-conformance log (REQ #43) and spec §6.3, the Phase 3 ship gate is `madge --circular server/ ≤ 5`. The actual count is 43. The agentRunSnapshots cascade WAS broken (the 175→43 reduction happened), so the root fix is correct — but the residual 43 cycles are unrelated pre-existing chains that were not in the audit's headline finding.

The conformance log proposes triaging the remainder into clusters and deciding between "in-Phase-3 follow-up" vs "Phase 5A". That decision belongs to the operator, not the reviewer.

### S-5 — Pure-function test for the `rollbackSkillVersion` signature constraint

**Given** `saveSkillVersion` now throws when `orgId` is null and `scope !== 'system'`,
**when** any caller invokes `saveSkillVersion(id, 'org', null, …)` or `saveSkillVersion(id, 'subaccount', null, …)`,
**then** the throw fires with the exact message `saveSkillVersion: orgId is required for scope=org` (or `…=subaccount`).

A small pure unit test in `server/services/__tests__/skillStudioServicePure.test.ts` capturing both branches plus the system happy-path would lock the contract. Compatible with the `runtime_tests: pure_function_only` posture.

## Non-Blocking Improvements

### N-1 — `briefVisibilityService` and `onboardingStateService` use `db` direct, not `getOrgScopedDb`

**Files:**
- `server/services/briefVisibilityService.ts:9, 30-34, 49-53`
- `server/services/onboardingStateService.ts:13, 51-76`

The spec template (§4.2 lines 631-644) shows the canonical pattern uses `withOrgTx` / `getOrgScopedDb`. Several existing services already use `getOrgScopedDb` (e.g. `agentRunPromptService.ts:6,39`, `documentBundleService.ts:672`). The new services use raw `db` from the global pool, which is consistent with several legacy services (`taskService.ts`, `memoryBlockService.ts`) but diverges from the modern pattern.

This is observational — the pre-existing inconsistency exists across the codebase and is not introduced by this branch — but the new files lock in the older pattern in places where the modern pattern was the local-style precedent. Future audits will surface these.

### N-2 — `measureInterventionOutcomeJob.resolveAccountIdForSubaccount` fetches all org accounts to find one

**File:** `server/jobs/measureInterventionOutcomeJob.ts:208-218`

The Phase 2 §5.2 fix replaced a direct SELECT with `canonicalDataService.getAccountsByOrg(organisationId)` and a client-side `.find()`. Functionally correct but inefficient at scale. A targeted `findAccountBySubaccountId(orgId, subaccountId)` method on `canonicalDataService` would be the right follow-up. Acceptable as a Phase 2 mechanical compliance fix; flag for Phase 5 if cost shows up.

### N-3 — `actionRegistry.ts:2-4` carries a comment that contradicts the runtime behaviour

**File:** `server/config/actionRegistry.ts:2-4`

```ts
// fromOrgId imported here to satisfy verify-principal-context-propagation gate; callers of
// canonicalDataService within this file should use fromOrgId() when the service migrates to PrincipalContext.
import { fromOrgId } from '../services/principal/fromOrgId.js';
```

`grep -n "canonicalDataService" server/config/actionRegistry.ts` returns only the JSDoc reference at line 115 — the file does not actually call `canonicalDataService`. The comment "callers of canonicalDataService within this file" is therefore aspirational. Tighten the comment to reflect reality.

### N-4 — Migration 0227 header comment claims a behaviour the migration does not deliver

**File:** `migrations/0227_rls_hardening_corrective.sql:1-13`

The header says "8 tables" but the migration body has 10 blocks. Either the header is stale relative to the body, or the body is over-scope (B-3). Either way, header and body disagree.

### N-5 — `configDocuments` route's in-memory `parsedCache` (lines 36, 103) has the same multi-process bug as §8.1

**File:** `server/routes/configDocuments.ts:33-36, 103`

Pre-existing — the file's own comment says "Phase 3 in-memory cache — swapped for a table-backed cache in Phase 4". Not introduced by this branch. Recording observationally so the cleanup-runbook in Phase 5A's §8.1 (rate limiter durability) can pick it up — it shares the same per-process-state defect class and likely belongs in the same primitive (`rateLimitStoreService` is read-write key-value with TTL; this cache is read-write key-value with TTL).

## Additional check results (positive — passed independent verification)

- **§4.2 service extractions** — `briefVisibilityService`, `onboardingStateService`, `configDocumentService`, `portfolioRollupService`, `automationConnectionMappingService`, `systemAutomationService` all exist; `lib/briefVisibility.ts` and `lib/workflow/onboardingStateHelpers.ts` re-export shapes are correct.
- **§4.3 cross-org write guards** — `documentBundleService.ts:679, 685, 691` correctly use `and(eq(id), eq(organisationId))` patterns; the `scheduledTasks` branch is also fixed (line 691) per the spec's "principle generalises" instruction.
- **§4.4 subaccount resolution** — `memoryReviewQueue.ts:34` and `clarifications.ts:33` both call `resolveSubaccount(req.params.subaccountId, req.orgId!)` correctly.
- **§4.5 baseline annotations** — all six historical files (0204, 0205, 0206, 0207, 0208, 0212) carry the `-- @rls-baseline:` annotation; both gate scripts (`verify-rls-session-var-canon.sh`, `verify-rls-coverage.sh`) implement the dual-condition check.
- **§5.1 action-call allowlist** — `scripts/verify-action-call-allowlist.sh:29` correctly points at `server/lib/workflow/actionCallAllowlist.ts`.
- **§5.2 canonical-read interface** — `measureInterventionOutcomeJob.ts:215` correctly delegates to `canonicalDataService.getAccountsByOrg`.
- **§5.3 direct-adapter removal** — `referenceDocumentService.ts` no longer imports from `providers/anthropicAdapter`; `llmRouter.ts` re-exports `countTokens` / `SUPPORTED_MODEL_FAMILIES` / `SupportedModelFamily`.
- **§5.6 canonical dictionary** — `canonical_flow_definitions` and `canonical_row_subaccount_scopes` entries present in `canonicalDictionaryRegistry.ts`.
- **§6.1 schema-leaf root fix** — `shared/types/agentExecutionCheckpoint.ts` clean; `server/services/middleware/types.ts:10-15` re-exports correctly; `server/db/schema/agentRunSnapshots.ts:3` imports from `shared/types/...`. Schema file's outbound import surface is now drizzle + shared + sibling-schema only.
- **§6.2 client cycle clusters** — `client/src/components/clientpulse/types.ts` and `client/src/components/skill-analyzer/types.ts` both exist and consolidate the previously circular interfaces; the spec-conformance auto-fix on `SkillAnalyzerResultsStep.tsx` is correct.
- **§4.1 (the eight in-spec tables)** — for the 8 tables that ARE in spec scope, the policy text is canonical, the historical-name DROPs are correct, no subaccount-isolation policies are created, and the canonical guards (`IS NOT NULL`, non-empty, uuid cast) are present in both USING and WITH CHECK.

## Verdict

**REQUEST_CHANGES** — three blocking issues (B-1 migration will fail to apply; B-2 stale subaccount-isolation policy left in place; B-3 spec-scope deviation) plus five strong recommendations. The blocking issues all centre on the `reference_documents`/`reference_document_versions` over-scope of migration 0227; resolving B-1/B-2/B-3 together (most likely by removing the two blocks from 0227 entirely per spec scope) closes the critical path. The eight in-spec tables in 0227 look correct; the rest of the branch is largely conformant with the spec, modulo the principal-context import-only pattern (S-2) and the `rollbackSkillVersion` signature footgun (S-1).
