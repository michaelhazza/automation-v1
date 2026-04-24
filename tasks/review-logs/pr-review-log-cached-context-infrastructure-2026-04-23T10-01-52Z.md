# PR Review — Cached Context Infrastructure

**Feature:** cached-context-infrastructure
**Branch:** `claude/implementation-plan-Y622C`
**Commits reviewed:** `d6bfd45f..HEAD` (~59 files, ~5.7K insertions)
**Reviewed:** 2026-04-23T11:08:00Z UTC
**Files reviewed (primary):**
- `migrations/0202_reference_documents.sql` through `0212_bundle_suggestion_dismissals.sql`
- `server/db/schema/{referenceDocuments,referenceDocumentVersions,documentBundles,documentBundleMembers,documentBundleAttachments,bundleResolutionSnapshots,modelTierBudgetPolicies,bundleSuggestionDismissals}.ts`
- `server/services/{bundleResolutionService,bundleResolutionServicePure,cachedContextOrchestrator,contextAssemblyEngine,contextAssemblyEnginePure,documentBundleService,documentBundleServicePure,executionBudgetResolver,executionBudgetResolverPure,referenceDocumentService,referenceDocumentServicePure}.ts`
- `server/services/llmRouter.ts` (cache-attribution write-through)
- `server/routes/{referenceDocuments,documentBundles}.ts`
- `server/jobs/bundleUtilizationJob.ts`
- `server/config/rlsProtectedTables.ts`
- `shared/types/cachedContext.ts`
- `server/services/__tests__/contextAssemblyEnginePure.test.ts`

---

## Blocking Issues

### B1 — RLS policies use the wrong session variable, reintroducing the exact bug migration 0200 was written to fix

**Severity:** Critical — cross-tenant isolation is broken on eight new tables.

**Files:**
- `migrations/0202_reference_documents.sql` lines 59–66
- `migrations/0203_reference_document_versions.sql` lines 56–63
- `migrations/0204_document_bundles.sql` lines 63–70
- `migrations/0205_document_bundle_members.sql` lines 39–46
- `migrations/0206_document_bundle_attachments.sql` lines 42–49
- `migrations/0207_bundle_resolution_snapshots.sql` lines 49–56
- `migrations/0208_model_tier_budget_policies.sql` lines 48–60
- `migrations/0212_bundle_suggestion_dismissals.sql` lines 27–31

**What's wrong.** Every new RLS policy references `current_setting('app.current_organisation_id', true)`. The canonical session variable in this codebase is `app.organisation_id`. This is documented explicitly in the header of migration 0200_fix_universal_brief_rls.sql:

> The original policies referenced `app.current_organisation_id`, a session variable that is never set in this codebase. The canonical variable is `app.organisation_id` (see migrations 0079-0081 and server/middleware/auth.ts + server/lib/createWorker.ts).

`server/middleware/auth.ts` line 108 sets `app.organisation_id` via `set_config`. `rlsProtectedTables.ts` lines 3–6 state the manifest is keyed on `current_setting('app.organisation_id', true)`. All 30+ canonical migrations use `app.organisation_id`. The new migrations use `app.current_organisation_id`, which is never set anywhere in the app.

**Why it's a security bug (not a fail-closed symptom).** These migrations additionally omit `FORCE ROW LEVEL SECURITY`. Without FORCE, Postgres bypasses RLS for the table owner — and migrations run as the same role the application connects as. The net effect is that for authenticated API traffic, RLS is fully bypassed on all eight new tables. Combined with the fact that every route handler in `server/routes/referenceDocuments.ts` and `server/routes/documentBundles.ts` calls service methods that take a bare `documentId` or `bundleId` without any `organisationId` scoping (every service method relies on RLS as its sole tenant boundary), this produces a hard cross-tenant read + write leak: an authenticated user in Org A who knows (or guesses, UUIDs notwithstanding) a document/bundle ID in Org B can GET, PATCH, DELETE, pause/resume/deprecate it; can add members into another org's bundles; can detach or attach bundles across org boundaries.

**Additional defects in the same policies.** Each new policy is also missing:
1. **`FORCE ROW LEVEL SECURITY`** — required so table owners (migration runner ≈ application role) cannot bypass RLS. Every single canonical tenant-scoped migration sets this; these eight do not.
2. **`WITH CHECK` clause** — required so INSERT/UPDATE/DELETE cannot write outside the tenant boundary. Every canonical migration mirrors the USING clause with WITH CHECK. These eight only set USING.
3. **IS NOT NULL / non-empty guards** — canonical policies explicitly guard `current_setting(..., true) IS NOT NULL AND <> ''` before the equality comparison, ensuring a truly unset var returns zero rows rather than relying on NULL-cast behaviour.

`model_tier_budget_policies_write` (0208 line 57–60) does include `WITH CHECK` but still uses the wrong variable name and lacks FORCE.

**Also missing on `bundle_suggestion_dismissals`:** no `WITH CHECK` (only `USING` on line 29). No `subaccount_isolation` policy either, though the column exists.

**Fix.** Rewrite every new RLS policy using the canonical pattern from `migrations/0200_fix_universal_brief_rls.sql` / `0079_rls_tasks_actions_runs.sql`. Example for `reference_documents`:

```sql
ALTER TABLE reference_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reference_documents_org_isolation ON reference_documents;
CREATE POLICY reference_documents_org_isolation ON reference_documents
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

Do this for all eight new tenant-scoped tables. For the two tables that inherit org scope via a parent (`reference_document_versions`, `document_bundle_members`), the EXISTS subquery must also read `app.organisation_id` and include the same guard. `model_tier_budget_policies` retains its two-policy shape (SELECT permits platform-default rows, write narrows to matching org) but with the corrected variable name + FORCE + IS NOT NULL guards. The fix must land as a new repair migration (matching the 0200 precedent), not by editing 0202–0212 in place — those are already committed and may have been applied in any dev DB.

**Note to spec authors.** The spec (`docs/cached-context-infrastructure-spec.md` lines 2191, 2216, 2221, 2222) also contains `app.current_organisation_id`. That text needs to be corrected so the next feature doesn't perpetuate this again — this is the second time the wrong variable has shipped into production migrations (first was Universal Brief / 0194 / 0195, fixed by 0200). The spec-conformance log treats this as a self-consistent implementation of the spec, which it is — the bug is in the spec.

---

### B2 — New services call raw `db` directly instead of `getOrgScopedDb()`

**Severity:** Blocking — even if B1's RLS is fixed, the service layer fails closed in the wrong direction.

**Files (every new service except `bundleUtilizationJob`):**
- `server/services/referenceDocumentService.ts` line 1 — `import { db } from '../db/index.js'`, then uses `db` everywhere (25+ call sites)
- `server/services/documentBundleService.ts` line 1 — same pattern
- `server/services/bundleResolutionService.ts` line 1 — same
- `server/services/contextAssemblyEngine.ts` line 2 — same
- `server/services/executionBudgetResolver.ts` line 1 — same
- `server/services/cachedContextOrchestrator.ts` line 1 — same

**What's wrong.** `server/lib/orgScopedDb.ts` is explicit (lines 1–22) that every service-layer DB access MUST go through `getOrgScopedDb(source)` so queries run inside the org-scoped transaction opened by auth middleware. Services that call the top-level `db` singleton take a fresh pool connection on every query, on which `app.organisation_id` has never been set — meaning even after B1 is fixed, RLS will fail-close and every read will return zero rows.

The canonical pattern (see `memoryBlockService.ts` / `workspaceMemoryService.ts` etc.): services import `getOrgScopedDb` and call it once per top-level method to get the tx handle, then use that handle for every query. The handle has the same Drizzle API as the `db` singleton, so this is a drop-in swap.

**Fix.** Replace `import { db } from '../db/index.js'` with `import { getOrgScopedDb } from '../lib/orgScopedDb.js'` in every affected service file, and within each public method do:

```ts
export async function create(input: {...}): Promise<ReferenceDocument> {
  const db = getOrgScopedDb('referenceDocumentService.create');
  // ... rest unchanged
}
```

The sole exception is `bundleUtilizationJob.ts` which correctly uses `withAdminConnection` for its cross-org sweep.

---

### B3 — Service methods take bare IDs with no organisationId filter

**Severity:** Blocking defence-in-depth gap. Independent of B1/B2 — after they're fixed, a broken RLS policy or a future service called from an admin-role path (without RLS enforcement) will still leak because the services have no second line of defence.

**Files:**
- `server/services/referenceDocumentService.ts` — `getDoc`, `getByIdWithCurrentVersion`, `listVersions`, `getVersion`, `rename`, `pause`, `resume`, `deprecate`, `softDelete`, `updateContent` all accept a bare `documentId` and never include `organisationId` in the WHERE clause.
- `server/services/documentBundleService.ts` — `getBundleWithMembers`, `softDelete`, `addMember`, `removeMember`, `detach`, `listAttachmentsForSubject`, `promoteToNamedBundle` all accept a bare `bundleId` or subject id and never include `organisationId`. `findOrCreateUnnamedBundle` + `attach` do include org context for *new* rows but the lookup side of `attach` joins the ID directly.

**Why it matters beyond RLS.** RLS is the third layer of the defence-in-depth model described in `architecture.md §Row-Level Security (RLS)` — not the only one. The documented layers are: (1) `getOrgScopedDb` → queries fail if not in a tenant tx; (2) service-layer org-scoped filters on every query; (3) Postgres RLS as the silent backstop. This implementation relies entirely on layer 3 and skips layers 1 and 2. That makes every future bug in the RLS config (as B1 just demonstrated) a silent data leak instead of a caught failure.

**Fix.** Thread `organisationId: string` into every service method that takes an ID, and add it to the WHERE clause. Where routes already have `req.orgId!`, pass it through. Where services are called from internal paths (orchestrator, resolver), the caller already has the `organisationId` in scope — pass it through. This matches the pattern in `memoryBlockService`, `workspaceMemoryService`, `taskService`, and every other service in the codebase.

---

### B4 — `HitlBudgetBlockPayload.intendedPrefixHashComponents` is persisted as `null`

**Severity:** Blocking contract violation.

**Files:**
- `server/services/contextAssemblyEnginePure.ts` line 216 — `intendedPrefixHashComponents: null as any, // populated by the stateful engine wrapper`
- `server/services/contextAssemblyEngine.ts` lines 122–123 — the stateful wrapper returns `{ kind: 'budget_breach', blockPayload: validationResult.payload }` *without populating the field*.

**Why.** Spec §4.5 declares `intendedPrefixHashComponents: PrefixHashComponents` as a required (non-nullable) field of the payload. The pure validator sets it to null with a `// populated by the stateful engine wrapper` comment, but the stateful wrapper never populates it. Result: the HITL action row's `payloadJson` ships with a null where a PrefixHashComponents object is required.

**Fix.** Populate `intendedPrefixHashComponents` in `contextAssemblyEngine.assembleAndValidate` when the validator returns `kind: 'breach'`. Compose a `PrefixHashComponents` from the union of the resolved snapshot rows' `orderedDocumentVersions` + `resolvedBudget.modelFamily` + `ASSEMBLY_VERSION`.

---

### B5 — Orchestrator's timeout vs rejection classification is string-matched against an implementation-internal comment

**Severity:** Blocking correctness bug — likely rare in practice but wrong-by-construction.

**Files:**
- `server/services/cachedContextOrchestrator.ts` line 208 — `const failureReason = decision.comment?.includes('timeout') ? 'hitl_timeout' : 'hitl_rejected';`

**What's wrong.** The orchestrator decides between `hitl_timeout` and `hitl_rejected` by sniffing for the substring `'timeout'` in `decision.comment`. Any human rejection whose free-text comment happens to mention the word "timeout" (e.g. *"budget timeout policy — reject for now"*) will be silently misclassified as a timeout.

**Fix.** Add an explicit `timedOut: boolean` field to `HitlDecision` in `hitlService.ts` and set it true only on the timeout path. The orchestrator then reads `decision.timedOut` instead of substring-matching.

---

## Strong Recommendations

### S1 — `cacheTtl` is accepted by the router but never passed to the adapter — silent no-op

**Files:**
- `server/services/llmRouter.ts` line 146 declares `cacheTtl?: '5m' | '1h'`.
- `server/services/cachedContextOrchestrator.ts` line 268 passes `cacheTtl: ttl ?? '1h'`.
- `server/services/providers/anthropicAdapter.ts` line 42 hardcodes `cache_control: { type: 'ephemeral' }` with no TTL field forwarded.

Per spec §6.6 and §12.15, v1 treats `cacheTtl` as a pass-through caller hint to the adapter. Currently it flows into `routeCall`, is never used for routing or cost accounting, and is dropped before reaching the adapter — a silent drop rather than a visible TODO.

**Fix.** Either (a) wire `cacheTtl` through `ProviderCallParams` and into the Anthropic adapter's `cache_control` object, or (b) remove the `cacheTtl` parameter from `routeCall` and from the orchestrator's call until it's actually honoured.

### S2 — `serializeDocument` is defined in two modules with identical implementations

**Files:**
- `server/services/referenceDocumentServicePure.ts` lines 43–49 — `serializeDocument` used by the write path to compute `serializedBytesHash` at version-write time.
- `server/services/contextAssemblyEnginePure.ts` lines 35–41 — `serializeDocument` used by the assembly path + the integrity check in `contextAssemblyEngine.ts` line 69.

The two implementations are currently identical, but they will drift. The moment they do, the integrity check on line 71 of `contextAssemblyEngine.ts` will reject every assembled context from prior snapshot rows with `CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION`.

**Fix.** Collapse to one canonical `serializeDocument` (plus its two delimiter constants) in one module and import it from the other.

### S3 — `findOrCreateUnnamedBundle`'s description-sentinel scheme is brittle

**Files:** `server/services/documentBundleService.ts` lines 110–164.

The implementation encodes the doc-set hash as `description: 'doc_set_hash:<hash>'` on unnamed bundles. Two issues:
1. The `description` column is user-visible and shared with named bundles. No DB constraint prevents collision.
2. No index on description for the lookup — sequential scan of all bundles in the org.

**Fix.** Add a dedicated `doc_set_hash text` column on `document_bundles` (nullable, set only for `is_auto_created=true` rows) with a partial unique index `(organisation_id, subaccount_id, doc_set_hash) WHERE is_auto_created = true AND deleted_at IS NULL`.

### S4 — `suggestBundle` is O(N+1) queries per call

**Files:** `server/services/documentBundleService.ts` lines 266–291.

For an org with N named bundles, this is N+1 queries per `suggestBundle` call. The spec (§6.2 invariant #9) explicitly calls for indexed lookup.

**Fix.** Once the `doc_set_hash` column from S3 lands, named-bundle lookup becomes a single indexed query.

### S5 — Missing integration test (§11.2) and concurrency test (§11.3)

**Files searched:** `server/services/__tests__/*{bundle,context,reference,cached}*.test.ts`.

Only `contextAssemblyEnginePure.test.ts` and `referenceDocumentServicePure.test.ts` exist. The spec §11.2 + §11.3 explicitly carves out TWO runtime tests from the pure-only rule:
- An end-to-end integration test for `cachedContextOrchestrator` asserting cache attribution + HITL flow.
- A concurrency test for `bundleResolutionService.resolveAtRunStart` asserting `UNIQUE(bundle_id, prefix_hash)` dedup under two-writers-same-bundle burst.

### S6 — `topContributors.documentName` is populated with UUID not name

**Files:**
- `server/services/contextAssemblyEngine.ts` lines 91–100 — `documentName: dv.documentId` (literally putting the UUID where the name should be).
- Spec §4.5 topContributors requires `{ documentId, documentName, tokens, percentOfBudget }`.

**Fix.** Issue one `SELECT id, name FROM reference_documents WHERE id IN (...)` query and thread the name map into `assembleAndValidate`.

### S7 — `getByIdWithCurrentVersion` smuggles null through an `as unknown as` cast

**Files:** `server/services/referenceDocumentService.ts` lines 275, 283.

```ts
if (!doc.currentVersionId) return { doc, version: null as unknown as ReferenceDocumentVersion };
return { doc, version: version ?? null as unknown as ReferenceDocumentVersion };
```

The return type claims non-null version, but the implementation smuggles null. Every consumer will dereference `.version.content` and crash at runtime.

**Fix.** Change the return type to `{ doc: ReferenceDocument; version: ReferenceDocumentVersion | null }` and remove the casts.

---

## Non-Blocking Improvements

### N1 — Routes return hand-rolled error shapes instead of using the service-error envelope
### N2 — `documentBundleService.attach` does not verify document set belongs to caller's org
### N3 — Orchestrator `failureReason` does not distinguish provider 4xx from router validation
### N4 — Two spurious unused locals
### N5 — Double-filter in `orderDocumentsDeterministically`
### N6 — `writeTerminalOutcome` passes `undefined` to Drizzle `.set()`
### N7 — Spec-side cleanup (wrong variable name in spec text)

---

## Summary

**Blocking:** 5
- B1: Wrong RLS session variable + missing FORCE + missing WITH CHECK on eight new tables → cross-tenant read/write leak.
- B2: Services use `db` directly instead of `getOrgScopedDb()` → Layer 1B fail-closed is bypassed.
- B3: Services accept bare IDs with no organisationId filter → Layer 2 defence-in-depth missing.
- B4: HITL block payload `intendedPrefixHashComponents` persisted as null → §4.5 contract violated.
- B5: HITL timeout vs reject classification via substring match on operator free-text comment.

**Strong Recommendations:** 7 (S1–S7).

**Non-Blocking:** 7 (N1–N7).

**Verdict:** REQUEST CHANGES — B1/B2/B3 together mean the feature currently ships with a cross-tenant data leak. Must not merge without repair.
