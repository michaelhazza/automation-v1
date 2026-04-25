# Audit Remediation — Implementation Plan

**Build slug:** `audit-remediation`
**Source spec:** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`
**Branch base:** every chunk branches off `main`
**Branch strategy:** one PR per spec phase (Phases 1–4 each one PR; Phase 5A §8.1 is two PRs in sequence; Phase 5A §8.2 is one PR; Phase 5B items are individual PRs in any order).
**Execution model:** strict phase ordering — Chunk N+1 does not begin until Chunk N's ship gate is green on `main` (per spec §2.1). Phase 5B (Chunk 8) may begin once Chunk 4 (Phase 4) ships, independent of Phase 5A.

**Total chunks:** 8

---

## Contents

- [Chunk table](#chunk-table)
- [Chunk 1 — Phase 1: RLS hardening](#chunk-1--phase-1-rls-hardening)
- [Chunk 2 — Phase 2: Gate compliance](#chunk-2--phase-2-gate-compliance)
- [Chunk 3 — Phase 3: Architectural integrity](#chunk-3--phase-3-architectural-integrity)
- [Chunk 4 — Phase 4: System consistency](#chunk-4--phase-4-system-consistency)
- [Chunk 5 — Phase 5A PR 1: Rate limiter shadow mode](#chunk-5--phase-5a-pr-1-rate-limiter-shadow-mode)
- [Chunk 6 — Phase 5A PR 2: Rate limiter authoritative flip](#chunk-6--phase-5a-pr-2-rate-limiter-authoritative-flip)
- [Chunk 7 — Phase 5A §8.2: Silent-failure path closure](#chunk-7--phase-5a-82-silent-failure-path-closure)
- [Chunk 8 — Phase 5B: Optional backlog](#chunk-8--phase-5b-optional-backlog)
- [Cross-chunk dependencies](#cross-chunk-dependencies)
- [Executor notes](#executor-notes)

---

## Chunk table

| # | Name (kebab-case) | Spec section(s) | PR boundary | Est. files (create + modify) | Primary gate(s) |
|---|---|---|---|---|---|
| 1 | `phase-1-rls-hardening` | §4.1 – §4.6 (1A → 1E) | One PR | 7 create, ~22 modify | `verify-rls-coverage`, `verify-rls-contract-compliance`, `verify-rls-session-var-canon`, `verify-org-scoped-writes`, `verify-subaccount-resolution` |
| 2 | `phase-2-gate-compliance` | §5.1 – §5.8 | One PR | 0 create, ~9 modify | `verify-action-call-allowlist`, `verify-canonical-read-interface`, `verify-no-direct-adapter-calls`, `verify-principal-context-propagation`, `verify-skill-read-paths`, `verify-canonical-dictionary` |
| 3 | `phase-3-architectural-integrity` | §6.1 – §6.3 | One PR | 3 create, ~13 modify | `madge --circular` server ≤ 5 / client ≤ 1 |
| 4 | `phase-4-system-consistency` | §7.1 – §7.4 | One PR (§7.3 may split) | 0 create, ~10 modify | `npm run skills:verify-visibility`, `node scripts/verify-integration-reference.mjs`, `npm install` |
| 5 | `phase-5a-rate-limiter-shadow-mode` | §8.1 (PR 1) | One PR | 4 create, ~9 modify | `npm run build:server`; structured-log divergence emission; in-memory limiter remains authoritative |
| 6 | `phase-5a-rate-limiter-authoritative-flip` | §8.1 (PR 2) | One PR | 0 create, ~8 modify | `npm run build:server`; PR-1 divergence-log evidence referenced; `rateLimitBucketCleanupJob` registered |
| 7 | `phase-5a-silent-failure-path-closure` | §8.2 | One PR | 0 create, ~variable modify (per gate output) | `verify-no-silent-failures` returns clean (no WARNING) |
| 8 | `phase-5b-optional-backlog` | §8.3, §8.4 | Multiple PRs (one per item) | per item; up to 4 create + ~12 modify | `npm run build:server`; per-item local gate/test |

---

## Chunk 1 — Phase 1: RLS hardening

**Objective.** Eliminate every cross-tenant fail-open. Lock the three-layer isolation contract: every protected table enforces FORCE RLS keyed on `app.organisation_id`; every route and lib file goes through services or `withAdminConnection()`; every cross-tenant write is org-scoped; every `:subaccountId` route resolves the subaccount.

**Sub-phases (all ship in the same PR):** 1A (corrective migration) → 1B (direct-DB removal) → 1C (cross-org write guards) → 1D (subaccount resolution) → 1E (gate baselines + historical-file annotations).

### a) Files to create

| File | Purpose |
|---|---|
| `migrations/0227_rls_hardening_corrective.sql` | FORCE RLS + canonical org-isolation policy on the 8 tables flagged at spec authoring time. (1A) |
| `server/services/briefVisibilityService.ts` | New service — DB-touching code moves out of `server/lib/briefVisibility.ts`. (1B) |
| `server/services/onboardingStateService.ts` | New service — DB-touching code moves out of `server/lib/workflow/onboardingStateHelpers.ts`. (1B) |
| `server/services/systemAutomationService.ts` | New admin-tier service for `systemAutomations.ts` route — uses `withAdminConnection()`. (1B) |
| `server/services/configDocumentService.ts` | New service — singular naming per repo convention. (1B) |
| `server/services/portfolioRollupService.ts` | New service. (1B) |
| `server/services/automationConnectionMappingService.ts` | New service — singular naming. (1B) |

### b) Files to modify

**1A — historical migrations (annotation only).** Six files get a one-line `-- @rls-baseline:` comment immediately above the relevant policy block. The migrations have already run at the Postgres level — these `.sql` files are read-only at runtime; the on-disk text is editable for the gate's annotation check.

- `migrations/0204_document_bundles.sql`
- `migrations/0205_document_bundle_members.sql`
- `migrations/0206_document_bundle_attachments.sql`
- `migrations/0207_bundle_resolution_snapshots.sql`
- `migrations/0208_model_tier_budget_policies.sql`
- `migrations/0212_bundle_suggestion_dismissals.sql`

The annotation line is verbatim:

```sql
-- @rls-baseline: phantom-var policy replaced at runtime by migration 0213_fix_cached_context_rls.sql
```

**1B — direct-DB removal (13 routes / lib files).**

- `server/lib/briefVisibility.ts` — strip DB-touching code; pure helpers remain.
- `server/lib/workflow/onboardingStateHelpers.ts` — strip DB-touching code; pure helpers remain.
- `server/routes/memoryReviewQueue.ts` (line 16 `db` import) — extend existing `memoryReviewQueueService`.
- `server/routes/systemAutomations.ts` (line 9) — call new `systemAutomationService` (uses `withAdminConnection`).
- `server/routes/subaccountAgents.ts` (line 14) — extend existing `subaccountAgentService`. Preserve existing `resolveSubaccount(...)` calls verbatim during extraction.
- `server/routes/configDocuments.ts` (line 21) — call new `configDocumentService`. Preserve existing `resolveSubaccount(...)`.
- `server/routes/portfolioRollup.ts` (line 16) — call new `portfolioRollupService`.
- `server/routes/clarifications.ts` (line 17) — extend existing `clarificationService` (also addressed in 1D).
- `server/routes/conversations.ts` (line 11) — extend existing `conversationService`.
- `server/routes/automationConnectionMappings.ts` (line 8) — call new `automationConnectionMappingService`. Preserve existing `resolveSubaccount(...)`.
- `server/routes/webLoginConnections.ts` (line 32) — extend existing `webLoginConnectionService`. Preserve existing `resolveSubaccount(...)`.
- `server/routes/systemPnl.ts` (line 9) — extend existing `systemPnlService` (admin tier — `withAdminConnection`).
- `server/routes/automations.ts` (line 3) — extend existing `automationService`.

**1C — cross-org write guards (2 services, 4 line edits).**

- `server/services/documentBundleService.ts:679` — `.where(eq(agents.id, subjectId))` → `.where(and(eq(agents.id, subjectId), eq(agents.organisationId, organisationId)))`.
- `server/services/documentBundleService.ts:685` — same pattern with `tasks`.
- `server/services/documentBundleService.ts` `scheduledTasks` branch (immediately after line 686) — apply the same `eq(scheduledTasks.organisationId, organisationId)` filter even though the gate does not currently flag it.
- `server/services/skillStudioService.ts:168` — `eq(skills.id, skillId)` → `and(eq(skills.id, skillId), eq(skills.organisationId, organisationId))`.
- `server/services/skillStudioService.ts:309` — same; inside `tx.update`.

Add `and` to the `drizzle-orm` import where missing.

**1D — subaccount resolution (already-touched routes).**

- `server/routes/memoryReviewQueue.ts` — at the top of every handler that consumes `req.params.subaccountId`, add `const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);`. Pass `subaccount.id` (not the raw param) into service calls. Remove the inline `eq(subaccounts.id, ...)` check.
- `server/routes/clarifications.ts` — same pattern.

These edits land inside the same 1B service-extraction commits.

**1E — gate scripts.**

- `scripts/verify-rls-session-var-canon.sh` — add the `HISTORICAL_BASELINE_FILES` array (the 6 files listed under the historical-migrations annotation) and an `is_baselined()` helper that requires both filename match AND the `@rls-baseline:` annotation. See spec §4.5 for the exact bash sketch.
- `scripts/verify-rls-coverage.sh` — apply the parallel allowlist + annotation check for the same six files. (The four files genuinely missing FORCE/POLICY at runtime — `0139`, `0141`, `0142`, `0147` — and the two re-assertion candidates — `0153`, `0192` — are addressed by `0227` and are NOT baselined. `0202` and `0203` are correct-as-written first-creation migrations and are NOT in the baseline set.)

### c) Implementation steps

1. **Pre-step: write-path audit (mandatory before drafting `0227`).** From the repo root:

   ```bash
   grep -rn "\.insert\(\|\.update\(\|\.delete\(" server/ \
     | grep -E "memory_review_queue|drop_zone_upload_audit|onboarding_bundle_configs|trust_calibration_state|agent_test_fixtures|agent_execution_events|agent_run_prompts|agent_run_llm_payloads"
   ```

   For each match, confirm the query runs inside `withOrgTx(organisationId, …)` OR `withAdminConnection()`. Any match that does neither is a defect. Fix it in 1B/1C BEFORE the migration is applied.

2. **Re-run the captured-state gate set (spec §3.5)** to confirm violation set has not drifted:

   ```bash
   bash scripts/verify-rls-coverage.sh
   bash scripts/verify-rls-contract-compliance.sh
   bash scripts/verify-rls-session-var-canon.sh
   bash scripts/verify-org-scoped-writes.sh
   bash scripts/verify-subaccount-resolution.sh
   ```

   If new violations have appeared since 2026-04-25, append them to the PR's scope. If existing violations have been resolved by parallel work, drop them from this chunk's scope.

3. **Draft `migrations/0227_rls_hardening_corrective.sql`.** Use the per-table block skeleton below. The full text for all eight tables lives in spec §4.1 — copy verbatim. The canonical block shape (mirror across all eight tables) is:

   ```sql
   ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

   -- Drop EVERY historical policy name on the table — see per-table inventory in spec §4.1.
   DROP POLICY IF EXISTS <historical_policy_name_1> ON <table>;
   DROP POLICY IF EXISTS <historical_policy_name_2> ON <table>;     -- if applicable
   DROP POLICY IF EXISTS <table>_org_isolation ON <table>;          -- canonical name (idempotent)

   CREATE POLICY <table>_org_isolation ON <table>
     USING (
       current_setting('app.organisation_id', true) IS NOT NULL
       AND current_setting('app.organisation_id', true) <> ''
       AND organisation_id = current_setting('app.organisation_id', true)::uuid
     )
     WITH CHECK (
       current_setting('app.organisation_id', true) IS NOT NULL
       AND current_setting('app.organisation_id', true) <> ''
       AND organisation_id = current_setting('app.organisation_id', true)::uuid
     );
   ```

   Per-table historical policy names to drop (from spec §4.1):
   - `memory_review_queue`: `memory_review_queue_org_isolation`
   - `drop_zone_upload_audit`: `drop_zone_upload_audit_tenant_isolation` (and the canonical-named drop)
   - `onboarding_bundle_configs`: `onboarding_bundle_configs_tenant_isolation` (and canonical)
   - `trust_calibration_state`: `trust_calibration_state_tenant_isolation` (and canonical)
   - `agent_test_fixtures`: `agent_test_fixtures_org_isolation`
   - `agent_execution_events`: `agent_execution_events_org_isolation`
   - `agent_run_prompts`: `agent_run_prompts_org_isolation`
   - `agent_run_llm_payloads`: `agent_run_llm_payloads_org_isolation`

   No subaccount-isolation policies. No Drizzle schema edits required — policies only.

4. **Apply migration locally:**

   ```bash
   npx tsx scripts/migrate.ts
   bash scripts/verify-rls-coverage.sh   # expect 0 violations on the 8 tables
   ```

5. **1B refactors.** For each of the 13 files:
   - **Service-creation rule (spec §2.8 — non-negotiable).** Create a new service file ONLY when the route has more than one DB interaction OR the logic is reused by more than one route. Otherwise replace the direct `db` import with an inline `withOrgTx(req.orgId!, …)` directly in the route. **Max 1 service per domain.** Two service files for the same domain in the same PR is a signal the split is wrong.
   - **Tier choice:** org-scoped HTTP routes use `withOrgTx(req.orgId, …)` from `server/instrumentation.ts`; system-admin routes (`systemAutomations`, `systemPnl`) use `withAdminConnection()` from `server/lib/adminDbConnection.ts`; lib-tier files split — pure helpers stay in `lib/`, DB-touching code moves to a new sibling service.
   - **Refactor template:** see spec §4.2 "Refactor pattern (template)".
   - **Caller updates:** for each new service file, run `grep -rn "from.*<oldImport>" server/ client/ shared/` and update every importer. Update co-located `__tests__/`.

6. **1C cross-org write filters.** Apply the four line edits in spec §4.3 verbatim. `organisationId` is already in scope at each call site. Inspect the `scheduledTasks` branch of `documentBundleService.verifySubjectExists` and apply the same filter even though the gate doesn't flag it — the principle generalises across branches.

7. **1D subaccount resolution.** In the two routes (`memoryReviewQueue.ts`, `clarifications.ts`), replace inline `eq(subaccounts.id, ...)` with `await resolveSubaccount(req.params.subaccountId, req.orgId!)` and pass `subaccount.id` downstream. The `resolveSubaccount` helper lives at `server/lib/resolveSubaccount.ts` (canonical primitive — do not re-implement).

8. **1E gate baselines.**
   - Update `scripts/verify-rls-session-var-canon.sh` per the bash sketch in spec §4.5: add `HISTORICAL_BASELINE_FILES` array, `BASELINE_ANNOTATION="@rls-baseline:"` constant, `is_baselined()` helper that requires BOTH filename match AND annotation presence, and call `is_baselined "$file"` early in the violation-emission loop with `continue` on match.
   - Apply the same allowlist + annotation logic to `scripts/verify-rls-coverage.sh`.
   - Add the one-line `@rls-baseline:` comment to each of the six historical migration files (above the relevant policy block).

9. **Hard ordering preconditions for `0227` (non-bypassable — spec §4 header):**
   1. Write-path audit (step 1) is complete; every write site runs inside `withOrgTx` OR `withAdminConnection`.
   2. All 1B/1C changes are staged in the same PR as the migration.
   3. Local verification has confirmed `npx tsx scripts/migrate.ts` applies cleanly AND every affected write path succeeds under FORCE RLS with `app.organisation_id` set.

   None of the three are negotiable.

10. **Re-run all five RLS gates + adjacent typecheck/test gates** (verification commands below). All five must return clean exit. **CI enforcement (spec §2.4):** every gate must run in CI and block merge on failure — local-only validation is insufficient.

### d) Verification commands

Copy verbatim from spec §4.6:

```bash
bash scripts/verify-rls-coverage.sh
bash scripts/verify-rls-contract-compliance.sh
bash scripts/verify-rls-session-var-canon.sh
bash scripts/verify-org-scoped-writes.sh
bash scripts/verify-subaccount-resolution.sh
```

Plus:

```bash
npm run build:server                                         # typecheck still passes
npm run test:gates                                           # wraps the gates above + adjacent gates
npx tsx server/services/__tests__/<relocated-test>.test.ts   # any service-relocated test still green (per repo convention; scripts/run-all-unit-tests.sh ignores `--` filters)
npx tsx scripts/migrate.ts                                   # 0227 applies cleanly against a fresh DB
```

### e) Definition of done (verbatim from spec §13.1)

- [ ] `migrations/0227_rls_hardening_corrective.sql` exists and applies cleanly against a fresh DB.
- [ ] `bash scripts/verify-rls-coverage.sh` returns 0 violations.
- [ ] `bash scripts/verify-rls-contract-compliance.sh` returns 0 violations.
- [ ] `bash scripts/verify-rls-session-var-canon.sh` returns 0 violations (with the historical baseline implemented).
- [ ] `bash scripts/verify-org-scoped-writes.sh` returns 0 violations.
- [ ] `bash scripts/verify-subaccount-resolution.sh` returns 0 violations.
- [ ] `npm run build:server` passes.
- [ ] `npm run test:gates` passes (catches regressions from adjacent gates).
- [ ] `npm test -- rls.context-propagation` passes — RLS three-layer integration test still green.
- [ ] No `db` import in any file under `server/routes/**` or `server/lib/**` (verified by `grep -rn "from.*db/index" server/routes/ server/lib/` returning either zero matches or only matches inside `withAdminConnection()` wrappers).
- [ ] All eight tables in §4.1's table — `memory_review_queue`, `drop_zone_upload_audit`, `onboarding_bundle_configs`, `trust_calibration_state`, `agent_test_fixtures`, `agent_execution_events`, `agent_run_prompts`, `agent_run_llm_payloads` — have `FORCE ROW LEVEL SECURITY` set (verified via `psql` or by re-running the gate).

### f) Deferred items (related to this chunk)

From spec §14:
- 0192 source-file regex cleanup (double-space `FORCE  ROW LEVEL SECURITY`) — migrations are append-only; the new `0227` re-asserts FORCE with single-space syntax; the historical `0192` source file remains as-written.
- Subaccount-isolation policies on the §4.1 tables — service-layer filtering remains the posture; mirrors `0213` precedent.
- DB-layer principal-aware scoping for `canonical_*` tables — separate canonical-data-platform roadmap.

---

## Chunk 2 — Phase 2: Gate compliance

**Objective.** Bring every architectural-contract gate that currently fails (blocking) to clean exit; warning-level gates (`verify-input-validation`, `verify-permission-scope`) do not regress and any new violations introduced by this phase are resolved.

**Subsection ordering inside the PR:** §5.1 → §5.2 → §5.3 → §5.4 → §5.5 → §5.6 → §5.7 (warning-level triage). Per spec §3.2, §5.4 depends on §5.2 (same canonical files); the rest are independent. **CI enforcement: every gate listed below must run in CI and block merge per spec §2.4.**

### a) Files to create

None. Phase 2 is line-edits and additions to existing files.

### b) Files to modify

- `scripts/verify-action-call-allowlist.sh` (line 29) — change `ALLOWLIST_FILE="$ROOT_DIR/server/lib/playbook/actionCallAllowlist.ts"` to `ALLOWLIST_FILE="$ROOT_DIR/server/lib/workflow/actionCallAllowlist.ts"`. (§5.1)
- `server/jobs/measureInterventionOutcomeJob.ts` (lines 213–218) — replace direct `canonicalAccounts` SELECT with a `canonicalDataService` call (existing method or new `accountExistsInScope(principal, accountId)`). Construct `PrincipalContext` via `fromOrgId(organisationId, subaccountId)` if not already in scope. (§5.2)
- `server/services/llmRouter.ts` — add `countTokens` method + re-export `SUPPORTED_MODEL_FAMILIES` and the `SupportedModelFamily` type. The new method records the call in `llm_requests` for cost attribution (delegates to the appropriate adapter). (§5.3)
- `server/services/referenceDocumentService.ts` (line 7) — replace `import { countTokens, SUPPORTED_MODEL_FAMILIES } from './providers/anthropicAdapter.js';` with `import { llmRouter, SUPPORTED_MODEL_FAMILIES, type SupportedModelFamily } from './llmRouter.js';`. Update the call site to pass the `context` object the service already has. (§5.3)
- `server/config/actionRegistry.ts` (line 112) — add `import { fromOrgId } from '../services/principal/fromOrgId.js';`. Wrap `canonicalDataService` call sites with `fromOrgId(organisationId, subaccountId)`. (§5.4)
- `server/services/intelligenceSkillExecutor.ts` (line 1) — add `import type { PrincipalContext } from './principal/types.js';`. Thread the agent-run principal through to `canonicalDataService` calls. (§5.4)
- `server/services/connectorPollingService.ts` (line 7) — at org-level call sites use `fromOrgId(organisationId)`; at per-record call sites where `dbAccount.subaccountId` is in scope use `fromOrgId(organisationId, dbAccount.subaccountId ?? undefined)`. Call out which calls fall in each bucket in the PR description. (§5.4)
- `server/services/crmQueryPlanner/executors/canonicalQueryRegistry.ts` (line 4) — thread the planner's incoming `PrincipalContext` down to the canonical-service calls. Update import to include `PrincipalContext` type. (§5.4)
- `server/routes/webhooks/ghlWebhook.ts` (line 7) — **unauthenticated route** (HMAC signature only — no JWT, no `req.orgId`). After the existing `connectorConfigs` + `canonicalAccounts` lookup resolves `config` and `dbAccount`, call `fromOrgId(config.organisationId, dbAccount.subaccountId ?? undefined)` and thread the resulting principal through every `canonicalDataService` call downstream. Do not reference `req.orgId`. (§5.4)
- `server/config/actionRegistry.ts` — also add `readPath` to the missing literal-action entries identified by the §5.5 enumeration step (only after the enumeration is complete). (§5.5)
- `server/services/canonicalDataService.ts` (or adjacent registry — confirm location at execution time) — add registry entries for `canonical_flow_definitions` and `canonical_row_subaccount_scopes`. Mirror the schema of neighbouring entries verbatim (do not invent fields). (§5.6)

### c) Implementation steps

1. **§5.1 — Action-call allowlist gate path correction.** Edit `scripts/verify-action-call-allowlist.sh:29` per the file-modify entry above. **Do NOT create a new file at `server/lib/playbook/actionCallAllowlist.ts`** — the populated file already exists at `server/lib/workflow/actionCallAllowlist.ts` (32 slugs as of spec authoring time). Forking the file would leave the validator, the test, and the gate disagreeing on which file matters. Run:

   ```bash
   bash scripts/verify-action-call-allowlist.sh
   ```

   Expect: clean exit with `0 violations`.

2. **§5.2 — Canonical-read interface enforcement.** Read `server/services/canonicalDataService.ts` exports first. If a method like `findAccountById` or `assertAccountExists` already fits the (organisationId, subaccountId, accountId) check the job needs, call it. Otherwise add a thin boolean-returning helper `canonicalDataService.accountExistsInScope(principal, accountId): Promise<boolean>` — the body lifts the existing query into the service with `withPrincipalContext` wrapping.

   **Hard rule (spec §5.2):** `canonicalDataService` is a read-only abstraction layer — no side effects. The new method must be a read-only query: never writes, never triggers background work, never mutates cache. If a caller needs to write to a canonical table, it does so through the table's owning service (e.g. CRM ingestion service). This is invariant §15.2 row 7 — enforced at code-review time.

   Replace the direct SELECT in `server/jobs/measureInterventionOutcomeJob.ts:213-218` with the canonical-service call. Pass the `PrincipalContext` the job already has (or build via `fromOrgId(organisationId, subaccountId)` if org-only).

3. **§5.3 — Direct-adapter call removal.** Add `countTokens` + re-exports to `server/services/llmRouter.ts` per the sketch in spec §5.3. The method delegates to the appropriate adapter based on `modelFamily`, wraps in the same provisional-row + finaliser pattern `routeCall` uses, and records the call in `llm_requests`. Update `referenceDocumentService.ts:7` per the file-modify entry; update the call site to pass the `context` object (orgId, sourceType, etc.) the service already has.

   **Why route through `llmRouter`:** `countTokens` calls Anthropic's token-counting endpoint via `ANTHROPIC_API_KEY` — a billable API request. Cost accounting depends on `llm_requests` capture.

4. **§5.4 — Principal-context propagation.** Apply the per-file strategy in the file-modify table. Use `fromOrgId(orgId, subaccountId?)` from `server/services/principal/fromOrgId.ts` as the migration shim (existing primitive). Per `convention_rejections` in `docs/spec-context.md`, do not introduce a new abstraction.

5. **§5.5 — Skill read-path completeness.** Enumerate the offending entries before fixing:

   ```bash
   bash scripts/verify-skill-read-paths.sh --verbose 2>&1 | tail -40
   ```

   If `--verbose` is not supported, modify the gate temporarily to print BOTH the literal-action slugs and the `readPath` slugs, then diff the two lists to enumerate the actual five entries. Revert the temporary gate edit before merge. Write the enumerated list inline into the PR description.

   Once the five entries are named, classify each:
   - Genuinely lacks `readPath` → add it. Valid values: `internal:skills/<category>/<slug>.md` or registered handler reference.
   - Has duplicate or stale `readPath` → remove the duplicate.
   - Misclassified entry → escalate to operator before adding a placeholder.

6. **§5.6 — Canonical dictionary additions.** Re-run the gate at the start of Phase 2 since it captured "TBD" at spec authoring time:

   ```bash
   bash scripts/verify-canonical-dictionary.sh
   ```

   Reconcile against live output. For each missing table (expected: `canonical_flow_definitions`, `canonical_row_subaccount_scopes`), add a registry entry with `tableName`, `pkColumn`, `orgScopeColumn`, `subaccountScopeColumn` if applicable, and read-side metadata mirroring neighbouring entries.

7. **§5.7 — Input validation and permission scope warnings.** Re-run with verbose mode:

   ```bash
   bash scripts/verify-input-validation.sh --verbose 2>&1 | tee /tmp/input-validation.log
   bash scripts/verify-permission-scope.sh --verbose 2>&1 | tee /tmp/permission-scope.log
   ```

   For each named site:
   - Genuine miss → add Zod schema or `requirePermission` call inline.
   - False positive → add `# baseline-allow` directive at the gate's specific match point with one-line rationale (warning-level gates only — never on a blocking gate; spec §2.4 carve-out).
   - Triage cost > 15 min/warning → defer to Phase 5 with PR-description note.

   **Phase 2 ship gate does NOT require these warnings to clear** — best-effort triage. New regressions introduced during Phase 2 work itself MUST be resolved before merge.

8. **Run all six core gates plus typecheck/test:**

   ```bash
   bash scripts/verify-action-call-allowlist.sh
   bash scripts/verify-canonical-read-interface.sh
   bash scripts/verify-no-direct-adapter-calls.sh
   bash scripts/verify-principal-context-propagation.sh
   bash scripts/verify-skill-read-paths.sh
   bash scripts/verify-canonical-dictionary.sh

   npm run build:server
   npm run test:gates
   ```

   All six core gates must return 0 violations. Manual verification: call the `referenceDocumentService` token-counting path once and check `llm_requests` has new rows under the chosen `featureTag`.

### d) Verification commands

Verbatim from spec §5.8:

```bash
bash scripts/verify-action-call-allowlist.sh
bash scripts/verify-canonical-read-interface.sh
bash scripts/verify-no-direct-adapter-calls.sh
bash scripts/verify-principal-context-propagation.sh
bash scripts/verify-skill-read-paths.sh
bash scripts/verify-canonical-dictionary.sh
```

Plus:

```bash
npm run build:server               # typecheck still passes
npm run test:gates                 # static gates regression-check
```

### e) Definition of done (verbatim from spec §13.2)

- [ ] `bash scripts/verify-action-call-allowlist.sh` returns 0 violations.
- [ ] `bash scripts/verify-canonical-read-interface.sh` returns 0 violations.
- [ ] `bash scripts/verify-no-direct-adapter-calls.sh` returns 0 violations.
- [ ] `bash scripts/verify-principal-context-propagation.sh` returns 0 violations.
- [ ] `bash scripts/verify-skill-read-paths.sh` returns 0 violations (literal-action-entries count matches readPath count).
- [ ] `bash scripts/verify-canonical-dictionary.sh` returns 0 violations.
- [ ] `npm run build:server` passes.
- [ ] `npm run test:gates` passes.
- [ ] No regression in `verify-input-validation` or `verify-permission-scope` warning counts (warning-level is not a blocker but new warnings introduced by this phase must be resolved).
- [ ] `llm_requests` shows new rows for `referenceDocumentService` token-counting calls (manual verification — call the path once and check the table).

### f) Deferred items (related to this chunk)

From spec §14:
- `verify-input-validation.sh` and `verify-permission-scope.sh` warnings — not blockers. Best-effort pass; remaining warnings remain warnings.
- DB-layer principal-aware scoping for `canonical_*` tables — separate roadmap. Phase 2 §5.4 is the file-level gate fix only.

---

## Chunk 3 — Phase 3: Architectural integrity

## Chunk 4 — Phase 4: System consistency

## Chunk 5 — Phase 5A PR 1: Rate limiter shadow mode

## Chunk 6 — Phase 5A PR 2: Rate limiter authoritative flip

## Chunk 7 — Phase 5A §8.2: Silent-failure path closure

## Chunk 8 — Phase 5B: Optional backlog

## Cross-chunk dependencies

## Executor notes
