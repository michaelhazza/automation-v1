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

**Objective.** Cut the schema → services circular-dependency root that drives 175 server-side cycles, and eliminate the two largest client cycle clusters. Server cycle count drops from 175 to ≤ 5; client cycle count drops from at least 14 to ≤ 1. (Phase 5A drives the server count to 0; the two schema-leaf tail items live in §8.4.)

### a) Files to create

| File | Purpose |
|---|---|
| `shared/types/agentExecutionCheckpoint.ts` | New home for `AgentRunCheckpoint`, `SerialisableMiddlewareContext`, `SerialisablePreToolDecision`, `PreToolDecision`. (§6.1) |
| `client/src/components/clientpulse/types.ts` | Extracted shared interfaces for `ProposeInterventionModal` ↔ five sub-editor components. (§6.2.1) |
| `client/src/components/skill-analyzer/types.ts` | Extracted shared interfaces for `SkillAnalyzerWizard` ↔ four step components. (§6.2.2) |

### b) Files to modify

**§6.1 — Server cycle root.**

- `server/services/middleware/types.ts` — replace the four type definitions (`AgentRunCheckpoint`, `SerialisableMiddlewareContext`, `SerialisablePreToolDecision`, `PreToolDecision`) with re-exports: `export type { AgentRunCheckpoint, SerialisableMiddlewareContext, SerialisablePreToolDecision, PreToolDecision } from '../../../shared/types/agentExecutionCheckpoint.js';`. Service-layer call sites continue to import from `middleware/types` and work unchanged.
- `server/db/schema/agentRunSnapshots.ts` (line 3) — change import from `'../../services/middleware/types.js'` to `'../../../shared/types/agentExecutionCheckpoint.js'`. The schema file's only outbound import is now to `shared/`, satisfying the leaf rule.

**§6.2.1 — `ProposeInterventionModal` cluster.** Update interface imports to point at the new `client/src/components/clientpulse/types.ts`. Component implementations stay in their current files; only type definitions migrate.

- `client/src/components/clientpulse/ProposeInterventionModal.tsx`
- `client/src/components/clientpulse/CreateTaskEditor.tsx`
- `client/src/components/clientpulse/EmailAuthoringEditor.tsx`
- `client/src/components/clientpulse/FireAutomationEditor.tsx`
- `client/src/components/clientpulse/OperatorAlertEditor.tsx`
- `client/src/components/clientpulse/SendSmsEditor.tsx`

**§6.2.2 — `SkillAnalyzerWizard` cluster.** Update interface imports to point at the new `client/src/components/skill-analyzer/types.ts` (kebab-case directory; verified at spec authoring time).

- `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx`
- `client/src/components/skill-analyzer/SkillAnalyzerImportStep.tsx`
- `client/src/components/skill-analyzer/SkillAnalyzerExecuteStep.tsx`
- `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx`
- `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx`

### c) Implementation steps

1. **§6.1 — Type extraction.**

   Phase 3 fixes the LARGEST violation of the leaf rule (the 175-cycle cascade driver). Two other schema files also violate the leaf rule today (`agentRuns.ts:3`, `skillAnalyzerJobs.ts:15`) — those are deliberately scoped OUT of Phase 3 and live in Phase 5B (Chunk 8 / spec §8.4). Do not touch them in this chunk.

   **Step 1.1 — Create `shared/types/agentExecutionCheckpoint.ts`.** Move the four type definitions verbatim from `server/services/middleware/types.ts:245`+ (preserving JSDoc). Add the header comment:

   ```ts
   // Persisted in agent_run_snapshots.checkpoint JSONB. Read by server resume path
   // and AgentRunLivePage debug surface. Schema files import this directly; services
   // may import from here OR from server/services/middleware/types (which re-exports).
   ```

   The four types form a closed cluster: `AgentRunCheckpoint` → `SerialisableMiddlewareContext` → `SerialisablePreToolDecision` (alias) → `PreToolDecision` (underlying union). Extracting only `AgentRunCheckpoint` would leave the schema file transitively importing from services. All four move together.

   **Step 1.2 — Update `server/services/middleware/types.ts`.** Replace the four definitions with the re-export shown in the file-modify entry. Existing service call sites are unchanged.

   **Step 1.3 — Update `server/db/schema/agentRunSnapshots.ts:3`.** Change the import per the file-modify entry. The schema file now imports only from `drizzle-orm`, sibling schema files, and `shared/**`.

2. **§6.2.1 — `ProposeInterventionModal` cluster (10 cycles).**

   Identify every interface that BOTH the parent modal AND any of the five sub-editors import. Move those interfaces to the new sibling `client/src/components/clientpulse/types.ts`. Update both sides to import from the new file. Component implementations stay in-place.

3. **§6.2.2 — `SkillAnalyzerWizard` cluster (4 cycles).**

   Same pattern: extract step-level interfaces (`StepProps`, `WizardState`, etc.) to `client/src/components/skill-analyzer/types.ts`. Update wizard + four step components to import from the new file.

4. **Re-run `madge --circular`.**

   ```bash
   npx madge --circular --extensions ts server/ | wc -l
   ```

   Expect ≤ 5. The two remaining cycles will be the §8.4 schema-leaf tail items (`agentRuns.ts:3`, `skillAnalyzerJobs.ts:15`); document them in the PR description and confirm they are routed to Phase 5B.

   ```bash
   npx madge --circular --extensions ts,tsx client/src/ | wc -l
   ```

   Expect ≤ 1. Any residual cycle is documented and routed to Phase 5.

5. **Build + targeted test.**

   ```bash
   npm run build:server
   npm run build:client
   npx tsx server/services/__tests__/agentExecutionServicePure.checkpoint.test.ts
   ```

   The named test exercises checkpoint serialisation; it must continue to pass.

6. **Note on out-of-scope cleanup:** `agentRunSnapshots.ts` also has a `toolCallsLog` column flagged DEPRECATED with a Sprint 3B removal note. **Do NOT remove it in this chunk** — that removal is independent and lives in §8.4 (Phase 5B), gated on Sprint 3B status.

### d) Verification commands

Verbatim from spec §6.3:

```bash
npx madge --circular --extensions ts server/ | wc -l                                # ≤ 5
npx madge --circular --extensions ts,tsx client/src/ | wc -l                        # ≤ 1
npm run build:server                                                                # typecheck passes
npm run build:client                                                                # build passes
npx tsx server/services/__tests__/agentExecutionServicePure.checkpoint.test.ts      # named test passes (run by direct path; scripts/run-all-unit-tests.sh ignores `--` filters)
```

### e) Definition of done (verbatim from spec §13.3)

- [ ] `npx madge --circular --extensions ts server/ | wc -l` ≤ 5.
- [ ] `npx madge --circular --extensions ts,tsx client/src/ | wc -l` ≤ 1.
- [ ] `shared/types/agentExecutionCheckpoint.ts` exists and exports `AgentRunCheckpoint`, `SerialisableMiddlewareContext`, `SerialisablePreToolDecision`, `PreToolDecision`.
- [ ] `server/db/schema/agentRunSnapshots.ts` imports only from `drizzle-orm`, `drizzle-orm/pg-core`, sibling schema files, or `shared/**`. No `server/services/**`, `server/lib/**`, or `server/middleware/**` imports. (Note: the broader leaf-rule guarantee for every schema file is NOT in Phase 3 scope — `agentRuns.ts` and `skillAnalyzerJobs.ts` also violate it today; those are tail items in §8.4. The Phase 3 fix is the cascade-driver only.)
- [ ] `npm run build:server` passes.
- [ ] `npm run build:client` passes.
- [ ] `npm test -- agentExecutionServicePure.checkpoint` passes.

### f) Deferred items (related to this chunk)

From spec §14 / §8.4:
- `agentRuns.ts:3` schema-leaf tail item — extract `AgentRunHandoffV1` to `shared/types/agentRunHandoff.ts`. Lives in Phase 5B.
- `skillAnalyzerJobs.ts:15` schema-leaf tail item — extract `SkillAnalyzerJobStatus` to `shared/types/skillAnalyzerJob.ts`. Lives in Phase 5B.
- `toolCallsLog` column drop on `agentRunSnapshots` — Phase 5B, gated on Sprint 3B status.
- Any residual client cycles after the two cluster extractions — document inline; Phase 5B as needed.

---

## Chunk 4 — Phase 4: System consistency

**Objective.** Skill registry coherence; explicit dependency declarations; YAML gate tooling re-verified; operator-led editorial fix on `docs/capabilities.md`.

**§7.1 and §7.2 are mechanical and ship together. §7.3 is operator-led** — the agent provides the diff; the operator reviews and applies. The §7.3 edit may ship in a separate small operator-led PR but does not block §7.1/§7.2.

### a) Files to create

None.

### b) Files to modify

**§7.1.1 — visibility flips.** Driven by `npx tsx scripts/apply-skill-visibility.ts` (idempotent script).

- `server/skills/smart_skip_from_website.md` — visibility flip from `internal` to `basic`.
- `server/skills/weekly_digest_gather.md` — same.

**§7.1.2 — workflow skills missing YAML frontmatter.** Add a frontmatter block at the very top of each file.

- `server/skills/workflow_estimate_cost.md`
- `server/skills/workflow_propose_save.md`
- `server/skills/workflow_read_existing.md`
- `server/skills/workflow_simulate.md`
- `server/skills/workflow_validate.md`

**§7.2.1 — explicit dependency declarations.**

- `package.json` — add `express-rate-limit`, `zod-to-json-schema`, `docx`, `mammoth` under `dependencies`. (`yaml` is already declared as a devDependency — no edit needed for §7.2.2's dep concern.)
- `package-lock.json` — updated by `npm install`; commit alongside.

**§7.2.2 — `verify-integration-reference` gate triage.** Edits driven by re-running the gate at Phase 4 start.

- `docs/integration-reference.md` — add the integration-block entries for any MCP presets the gate flags as missing (Discord, Twilio, SendGrid, GitHub at spec-authoring time). Mirror the shape of an existing block.

**§7.3 — capabilities editorial fix.**

- `docs/capabilities.md` (line 1001) — replace `"Anthropic-scale distribution isn't the agency play."` with one of three operator-selected options. **Operator-led only — never auto-applied.**

### c) Implementation steps

1. **§7.1.1 — Visibility drift.**

   ```bash
   npx tsx scripts/apply-skill-visibility.ts
   ```

   The script is idempotent — it walks `server/skills/**/*.md`, computes the desired visibility from `scripts/lib/skillClassification.ts`, and rewrites only the out-of-sync files. Expect exactly two files to change: `smart_skip_from_website.md` and `weekly_digest_gather.md`. **If the apply script touches anything outside the two named skills, stop and investigate before committing** — that would indicate an unintended classification-table change.

   Re-run:

   ```bash
   npm run skills:verify-visibility
   ```

   Expect 0 violations.

2. **§7.1.2 — YAML frontmatter for workflow skills.**

   For each of the five `workflow_*` files, add a frontmatter block at the very top of the markdown file (before any heading):

   ```yaml
   ---
   slug: workflow_estimate_cost
   category: workflow
   visibility: internal      # or basic — confirm against scripts/lib/skillClassification.ts
   description: |
     <one-line description>
   ---
   ```

   For each file:
   - Look up the desired `visibility` value in `scripts/lib/skillClassification.ts`.
   - Copy the `description` line from the file's existing first paragraph.

   Re-run `npm run skills:verify-visibility` — count of "missing YAML frontmatter" drops to 0.

3. **§7.2.1 — Add explicit deps.**

   ```bash
   npm install --save express-rate-limit zod-to-json-schema docx mammoth
   ```

   Verify `package.json` lists all four under `dependencies` (not `devDependencies`). Verify `package-lock.json` is updated and committed. Pin exactly using whatever resolved version `npm install` returns — match the existing pin convention in the file (no `^`/`~` if neighbouring entries don't use range pins).

   Verify both builds:

   ```bash
   npm run build:server
   npm run build:client
   ```

4. **§7.2.2 — `verify-integration-reference` triage.**

   Re-run the gate at the start of Phase 4 to capture the current warning set:

   ```bash
   node scripts/verify-integration-reference.mjs 2>&1 | tee /tmp/verify-integration-reference.log
   ```

   The gate should run to completion (no `ERR_MODULE_NOT_FOUND: 'yaml'` crash — `yaml ^2.8.3` is already declared in `package.json` devDependencies as of spec authoring time). Triage warnings:

   - **Capability-naming convention drift** (e.g. `organisation.config.read` not matching `<resource>_read`):
     - Load-bearing in stored data (permission keys) → `# baseline-allow` per spec §2.4 with one-line rationale.
     - Internal only → rename.
   - **MCP preset wired but no integration block** (e.g. `discord`, `twilio`, `sendgrid`, `github`) → add the missing block to `docs/integration-reference.md` (mechanical — copy shape of an existing block).

5. **§7.3 — Capabilities editorial fix.**

   **Operator-led only — agent provides the diff, operator applies.** From spec §7.3:

   The current line 1001 is:

   > *Not a public skill or playbook marketplace. **Anthropic**-scale distribution isn't the agency play.*

   Three replacement options for the operator to choose between:

   | Option | Replacement | Rationale |
   |---|---|---|
   | A (recommended) | "Hyperscaler-scale distribution isn't the agency play." | Same syllable count; same punch; no provider name. |
   | B | "Provider-marketplace-scale distribution isn't the agency play." | More specific to marketplace context; slightly less marketing-ready. |
   | C | "Foundation-model-platform distribution isn't the agency play." | Most neutral; possibly too technical for a Non-goals bullet. |

   **Same-pass scan.** While editing line 1001, scan customer-facing sections (Core Value Proposition, Positioning & Competitive Differentiation, Product Capabilities, Agency Capabilities, Replaces / Consolidates, Non-goals) for any other provider names the audit may have missed. Lines 778, 893, 912–913 are in support-facing sections (Skills Reference, Integrations Reference) and are PERMITTED by editorial rule 2 — do not touch.

   **Process:** the agent does NOT commit `docs/capabilities.md` changes without explicit operator approval in the same session (per spec §2.7). Present the diff with the three options; wait for operator's choice; apply; commit.

6. **Run all four gates plus build:**

   ```bash
   npm run skills:verify-visibility               # 0 violations
   node scripts/verify-integration-reference.mjs  # runs cleanly (no crash)
   npm install                                    # no missing-dep warnings
   npm run build:server && npm run build:client   # both pass
   ```

### d) Verification commands

Verbatim from spec §7.4:

```bash
npm run skills:verify-visibility               # 0 violations
node scripts/verify-integration-reference.mjs  # runs cleanly
npm install                                    # no missing-dep warnings
npm run build:server && npm run build:client   # both pass
```

For §7.3 (capabilities edit), verification is operator-led — the operator confirms the diff applies cleanly and the file no longer references Anthropic in customer-facing sections.

### e) Definition of done (verbatim from spec §13.4)

- [ ] `npm run skills:verify-visibility` returns 0 violations.
- [ ] `node scripts/verify-integration-reference.mjs` runs without crashing — the dependency fix unblocks the gate's execution. Any genuine findings the gate then surfaces (i.e. real violations that were hidden by the pre-fix crash) are out of scope for the dependency fix and are triaged in a separate PR per §7.2.2.
- [ ] `npm install` runs cleanly (no missing-dep warnings; no peer-dep warnings introduced by this phase).
- [ ] `package.json` lists `express-rate-limit`, `zod-to-json-schema`, `docx`, `mammoth` under `dependencies` and `yaml` under `devDependencies`.
- [ ] All five `workflow_*` skill files have YAML frontmatter blocks.
- [ ] `docs/capabilities.md:1001` no longer contains "Anthropic" (or any other specific provider name); operator has applied and committed the edit.
- [ ] `npm run build:server && npm run build:client` both pass.

### f) Deferred items (related to this chunk)

None for this chunk. All §7 items either ship in this chunk (§7.1, §7.2) or in the operator-led companion edit (§7.3).

---

## Chunk 5 — Phase 5A PR 1: Rate limiter shadow mode

**Objective.** Land the multi-process-safe DB-backed rate-limiter primitive (`rateLimitStoreService`) in shadow / dual-evaluate mode. **The legacy in-memory limiter remains authoritative** — every call site invokes BOTH limiters and emits a structured-log line on allow/deny decision divergence. No request behaviour changes in this PR.

**Why two PRs (5 + 6):** even with `pre_production: yes`, the DB-backed rate limiter cannot become authoritative on first deploy. The failure mode the env-flag does not catch is *behavioural divergence under load* — different bucket boundaries, different sliding-window math, different concurrency outcome. Catching that requires running both side-by-side under real traffic before either becomes the source of truth.

### a) Files to create

| File | Purpose |
|---|---|
| `migrations/<NNNN>_rate_limit_buckets.sql` | New `rate_limit_buckets` table (system-scoped — no `organisation_id`). Number assigned at merge time per spec §2.5. |
| `server/services/rateLimitStoreService.ts` | New shared sliding-window primitive. Two pure-friendly functions: `incrementBucket(key, windowStart)` and `sumWindow(keyPrefix, since)`. DB access goes through `withAdminConnection()`. |
| `server/jobs/rateLimitBucketCleanupJob.ts` | Hourly pg-boss cron — `DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '1 hour'`. |
| `server/services/__tests__/rateLimitStoreService.test.ts` | Pure-function tests — sliding-window math (bucket increment, window-sum read, expiry cutoff). Inject in-memory mock for DB handle. Also tests env-flag shim path. |
| `server/lib/__tests__/testRunRateLimit.test.ts` | Pure-function tests preserving test-run rate-limit semantics on top of the shared store. |

### b) Files to modify (shadow-mode dual-evaluate scaffolding)

- `server/lib/testRunRateLimit.ts` — extend to dual-evaluate: invoke BOTH the existing in-memory map AND the new `rateLimitStoreService`. The in-memory return value is what callers see (authoritative). Emit a structured-log line on allow/deny decision divergence: `{event: 'rate_limit_shadow_divergence', surface, key, db_decision, mem_decision}`. The lib file does not import `db` directly — it imports the service.
- `server/routes/agents.ts` — `await` the now-async `checkTestRunRateLimit` call (the dual-evaluate wrapper is async due to the DB write).
- `server/routes/skills.ts` — same.
- `server/routes/subaccountAgents.ts` — same.
- `server/routes/subaccountSkills.ts` — same.
- `server/routes/public/formSubmission.ts` (lines 31, 54) — wrap inline `checkRateLimit` and `rateLimitMiddleware` in dual-evaluate scaffolding. Existing in-memory `Map<string, number[]>` decisions remain authoritative; DB store called as side-effect; divergence logged.
- `server/routes/public/pageTracking.ts` (line 29) — same pattern around inline `checkTrackRateLimit`.
- `server/jobs/index.ts` — register `rateLimitBucketCleanupJob` in the canonical job-export aggregator.
- `server/services/queueService.ts` — register the worker + hourly pg-boss cron schedule alongside existing scheduled jobs.

### c) Implementation steps

1. **Pre-step: `USE_DB_RATE_LIMITER` env-flag shim is mandatory.** `server/services/rateLimitStoreService.ts` MUST check `process.env.USE_DB_RATE_LIMITER` at module load. When the flag is `false` (or unset in a legacy env), the service exports a no-op in-memory shim with identical function signatures. The shim reverts to pre-Phase-5A in-process Map behaviour. This allows the rollback in spec §11.2 without reverting code. Document the toggle in the migration header so operators can find it under incident pressure.

2. **Migration filename rule.** Use a placeholder filename in the PR (`migrations/<NNNN>_rate_limit_buckets.sql`); rebase against latest `main` immediately before merge and rename to claim the next available number against `main` as it stands at that moment (spec §2.5 — concurrent-PR safety). **Do not pre-allocate migration numbers across Phase 5 PRs.**

3. **Migration body (verbatim from spec §8.1):**

   ```sql
   CREATE TABLE rate_limit_buckets (
     bucket_key text NOT NULL,
     window_start timestamptz NOT NULL,
     count integer NOT NULL DEFAULT 0,
     PRIMARY KEY (bucket_key, window_start)
   );
   CREATE INDEX rate_limit_buckets_window_idx ON rate_limit_buckets (window_start);
   ```

   Header comment: `-- System-scoped table — intentionally not tenant-scoped (rate limits are per-public-key / per-user, not per-tenant). NOT in RLS_PROTECTED_TABLES — system rate-limit infrastructure. Rollback: set USE_DB_RATE_LIMITER=false and restart workers; table contents are best-effort.`

4. **Build `rateLimitStoreService.ts`.** Implement `incrementBucket(key, windowStart)` and `sumWindow(keyPrefix, since)` using sliding-window algorithm: bucket the current minute, atomically increment with `INSERT ... ON CONFLICT DO UPDATE`, sum last N minutes' rows for the limit check. DB access goes through `withAdminConnection()` from `server/lib/adminDbConnection.ts`. Pure-function-friendly contract — accepts an injectable DB handle for testing. Implement env-flag shim (step 1).

   **Why a service-tier file (not lib):** `server/lib/**` files MUST NOT import `db` directly (architecture rule + spec §1 boundary 2 + §15.2 invariant). DB-touching primitives belong in `server/services/**`. Existing precedent: `server/services/testRunIdempotency.ts`. `webhookDedupe.ts` is in `lib/` only because it's in-memory.

5. **Wire dual-evaluate scaffolding into `testRunRateLimit.ts`.** Wrap the existing in-memory check with a parallel call to `rateLimitStoreService`. The exported function signature stays the same except now async. Compare allow/deny decisions; emit divergence log on mismatch.

6. **Wire dual-evaluate into the public-route limiters.** In both `formSubmission.ts` and `pageTracking.ts`, wrap each existing inline limit check in the same dual-evaluate pattern. Bucket-key prefixes distinguish surfaces: `form-ip:`, `form-page:`, `track-ip:`. Existing limit thresholds (`IP_LIMIT`, `PAGE_LIMIT`, etc.) stay; the comparison is decision-vs-decision, not threshold-vs-threshold.

7. **Update the four routes that call `checkTestRunRateLimit`** (`agents.ts`, `skills.ts`, `subaccountAgents.ts`, `subaccountSkills.ts`) — add `await`.

8. **Write the cleanup job.** `server/jobs/rateLimitBucketCleanupJob.ts` — pg-boss cron deleting expired rows. Hourly cadence. Register in `server/jobs/index.ts` AND in `server/services/queueService.ts` (verified at spec authoring time as the worker / pg-boss schedule registration site).

9. **Pure-function tests.**
   - `server/services/__tests__/rateLimitStoreService.test.ts` — exercise `incrementBucket`, `sumWindow`, expiry cutoff, env-flag shim path (when `USE_DB_RATE_LIMITER=false`, returns without touching DB).
   - `server/lib/__tests__/testRunRateLimit.test.ts` — preserves existing test-run rate-limit semantics on top of the shared store.

   Run via `npx tsx <path>` (per repo convention; `scripts/run-all-unit-tests.sh` ignores `--` filters).

10. **Divergence definition (precise — from spec §8.1).** A "divergence" is a difference in **allow/deny decision** for the same `(bucket_key, evaluation window)` pair within a single request invocation. Counts: in-memory returns *allow* and DB returns *deny* (or vice versa). Does NOT count: internal counter values that differ but produce the same decision; timing skew; ordering differences across concurrent requests where each call's decision is consistent; rounding at window boundaries where both stores cross the threshold on the same request.

11. **Manual smoke check.** Spin up two processes locally, hammer the public form path and the test-run path, observe the per-process behaviour. The DB store should accumulate buckets; the in-memory limiter should still drive the throttling decision; divergence count should be zero (or every observed divergence should be reproducible and explainable).

12. **PR description (mandatory).** Include the divergence-log volume observed locally. Note: PR 1 must remain on `main` for at least one full operator-observed window — minimum one PR cycle, with the operator confirming divergence-log volume is zero (or every observed divergence has been triaged and explained) before PR 2 (Chunk 6) opens.

### d) Verification commands

```bash
npx tsx server/services/__tests__/rateLimitStoreService.test.ts
npx tsx server/lib/__tests__/testRunRateLimit.test.ts
npm run build:server
```

Manual:
- Apply the migration locally; confirm `rate_limit_buckets` exists.
- Trigger a public form submission and a test-run; confirm DB rows are written AND in-memory throttling still drives the response.
- Confirm `rate_limit_shadow_divergence` log lines appear if/when decisions differ; count is zero under expected traffic.

### e) Definition of done (subset of spec §13.5A — PR-1-specific items)

- [ ] `migrations/<NNNN>_rate_limit_buckets.sql` exists and applies cleanly against a fresh DB.
- [ ] `server/services/rateLimitStoreService.ts` exists, includes the `USE_DB_RATE_LIMITER` env-flag shim path, and runs through `withAdminConnection()`.
- [ ] `server/jobs/rateLimitBucketCleanupJob.ts` exists; registered in `server/jobs/index.ts` and scheduled in `server/services/queueService.ts` (hourly cron).
- [ ] Both pure-function test files pass.
- [ ] Dual-evaluate scaffolding wired into `testRunRateLimit.ts`, `formSubmission.ts`, `pageTracking.ts`. In-memory limiter remains AUTHORITATIVE — no behaviour change in this PR.
- [ ] Structured-log divergence emission verified locally (`{event: 'rate_limit_shadow_divergence', ...}` lines appear when decisions differ; expected count under normal smoke traffic is zero).
- [ ] `npm run build:server` passes.
- [ ] PR description documents the local divergence-log volume observed.

### f) Deferred items (related to this chunk)

None — Chunk 6 is the natural follow-on (authoritative flip). Chunk 7 (silent-failure closure) and Chunk 8 (Phase 5B) are independent.

---

## Chunk 6 — Phase 5A PR 2: Rate limiter authoritative flip

## Chunk 7 — Phase 5A §8.2: Silent-failure path closure

## Chunk 8 — Phase 5B: Optional backlog

## Cross-chunk dependencies

## Executor notes
