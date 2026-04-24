# Dual Review Log — cached-context-infrastructure

**Files reviewed:**
- `migrations/0213_fix_cached_context_rls.sql` (new)
- `server/config/rlsProtectedTables.ts`
- `server/routes/referenceDocuments.ts`
- `server/routes/documentBundles.ts`
- `server/services/referenceDocumentService.ts`
- `server/services/documentBundleService.ts`
- `server/services/bundleResolutionService.ts`
- `server/services/contextAssemblyEngine.ts`
- `server/services/executionBudgetResolver.ts`
- `server/services/cachedContextOrchestrator.ts`
- `server/services/hitlService.ts`
- `docs/cached-context-infrastructure-spec.md` (§8.1 only)

**Iterations run:** 2/3
**Timestamp:** 2026-04-23T11:40:35Z UTC
**Branch:** `claude/implementation-plan-Y622C`
**Source PR-review log:** `tasks/review-logs/pr-review-log-cached-context-infrastructure-2026-04-23T10-01-52Z.md`
**Codex CLI:** OpenAI Codex v0.118.0 (gpt-5.4)
**Commit at finish:** 55c741dc

---

## Iteration 1

Codex surfaced two findings on the uncommitted fix pass:

### P1 — Set `current_subaccount_id` before enforcing subaccount RLS
**File:** `migrations/0213_fix_cached_context_rls.sql` lines 46–52 (and mirror blocks for the other 4 subaccount-scoped tables).

**Codex's claim.** The repair migration adds FORCE ROW LEVEL SECURITY + WITH CHECK + IS NOT NULL guards to every subaccount isolation policy. The canonical subaccount session variable is `app.current_subaccount_id`, but the normal request path (`server/middleware/auth.ts:108` — only sets `app.organisation_id`) and the worker path (`server/lib/createWorker.ts:123-128` — same) never initialise it. Only `withPrincipalContext` sets it, and that wrapper is only invoked from the CRM query planner. Result: every INSERT/UPDATE of a row with `subaccount_id IS NOT NULL` would fail WITH CHECK, and every SELECT would return zero rows. Legitimate API and worker traffic is broken for subaccount-scoped reference documents, bundles, attachments, snapshots, and dismissals.

**Adjudication — ACCEPT.** Confirmed by reading:
- `server/middleware/auth.ts` lines 107–128 — only `set_config('app.organisation_id', ...)`, no subaccount variable.
- `server/lib/createWorker.ts` lines 120–128 — same.
- `server/db/withPrincipalContext.ts` — only caller that sets `app.current_subaccount_id`.
- `server/services/crmQueryPlanner/crmQueryPlannerService.ts:192` — the only invocation of `withPrincipalContext` in the application code.
- `server/routes/referenceDocuments.ts` and `server/routes/documentBundles.ts` both accept `subaccountId` from query/body and never wrap the handler in `withPrincipalContext`.

Before the repair migration, the `*_subaccount_isolation` policies in 0202–0207 + 0212 were latent — they lacked FORCE so Postgres bypassed RLS for the application role that owns the tables. Turning FORCE on without also initialising the subaccount variable would have turned a latent dead policy into a hard correctness regression.

Checked the precedent at `migrations/0200_fix_universal_brief_rls.sql`: it only enforces ORG-level isolation and does not define subaccount policies. Matches the posture of `memory_blocks`, `workspace_memories`, and every other non-CRM tenant-scoped table in the codebase. Subaccount scoping is an app-layer concern there — service methods explicitly filter on `subaccount_id` (`referenceDocumentService.listByOrg` lines 281–286 is the reference example).

**Fix applied.** Rewrote `migrations/0213_fix_cached_context_rls.sql`:
- Kept all org-level isolation policies (with FORCE + WITH CHECK + IS NOT NULL guards) — the security-critical fix from the PR-review B1.
- Dropped every `*_subaccount_isolation` policy in the 5 affected tables (reference_documents, document_bundles, document_bundle_attachments, bundle_resolution_snapshots, bundle_suggestion_dismissals). The drops are unconditional so the broken predecessor policies from 0202–0207/0212 are removed.
- Added a header note documenting why the subaccount policies are dropped and referencing the 0200 precedent, so a future session doesn't recreate them without first initialising `app.current_subaccount_id` in the auth / worker middleware.

### P2 — Preserve duplicate documents in `intendedPrefixHashComponents`
**File:** `server/services/contextAssemblyEngine.ts` lines 150–156.

**Codex's claim.** When the same document is attached through multiple bundles on one run, the assembled prefix includes that document twice, but the new loop drops later occurrences by `documentId`. The stored `intendedPrefixHashComponents` no longer matches the prefix bytes the engine was about to send; arrays are shorter and lose bundle-sorted occurrence order; the HITL breach payload becomes an inaccurate diagnostic record.

**Adjudication — ACCEPT MODIFIED.** Partial accept. Codex correctly identifies the order/shape issue but proposes "preserve duplicates in bundle-sorted order" as the remedy. I reject that framing in favor of **spec-alignment** for these reasons:

- Spec §4.4 lines 565–568 (`shared/types/cachedContext.ts` + the spec text) defines `orderedDocumentIds` with the explicit inline comment `document_id ascending`. Both the current implementation (bundle-id-sorted, then within-bundle) AND Codex's proposed fix (bundle-id-sorted, duplicates preserved) violate this contract. Neither sorts ascending by documentId.
- Spec §4.4 example instance lines 582–590 shows `includedFlags` with one entry per unique documentId. The `PrefixHashComponents` interface was designed for the per-bundle hash, where duplicates are impossible by schema (`document_bundle_members_bundle_doc_uq` enforces uniqueness per bundle). The HITL payload reuses the same type at §4.5 line 74 without redefining the aggregation semantics, so the shape contract stays: one entry per documentId.
- Codex is right that the field is labelled "for diagnosis" (spec line 628), but diagnostic fidelity is a per-bundle concern — `agent_runs.bundle_snapshot_ids` already indexes into each bundle's per-bundle `prefix_hash_components` for finer-grained diagnosis (see spec §4.4 diagnosis path + line 1164).

**Fix applied.** Refactored the loop in `contextAssemblyEngine.ts` lines 143–177:
- Build a `Map<documentId, serializedBytesHash>` keeping the first occurrence of each documentId (iteration order: bundle-id-sorted, then within-bundle — doesn't matter since we sort the final output).
- Sort the map keys ascending by documentId (localeCompare, matches the spec contract comment).
- Emit `orderedDocumentIds`, `documentSerializedBytesHashes`, and `includedFlags` parallel to the sorted key list.

Added an inline comment cross-referencing spec §4.4 so a future maintainer understands the aggregation semantic.

### Decision log — iteration 1

```
[ACCEPT] migrations/0213_fix_cached_context_rls.sql:46-52 (and four mirror blocks) — P1 subaccount RLS blocks normal traffic
  Reason: FORCE + WITH CHECK on subaccount_isolation policies without initialising app.current_subaccount_id
  in auth/worker middleware breaks every insert/read of subaccount-scoped rows. Matches 0200 precedent:
  drop subaccount policies; rely on org-level RLS + app-layer subaccount filter.

[ACCEPT-MODIFIED] server/services/contextAssemblyEngine.ts:150-156 — P2 intendedPrefixHashComponents order
  Reason: Current code violates spec §4.4 line 566 `document_id ascending` contract. Sort the dedup'd
  list ascending by documentId. Reject Codex's "preserve duplicates" proposal because the PrefixHashComponents
  shape (single entry per documentId, mirrored in includedFlags) is defined for per-bundle use where
  duplicates cannot occur; the HITL payload reuses the same shape at §4.5 without redefining it.
```

## Iteration 2

Codex surfaced one new finding on the updated tree:

### P2 (iter 2) — Cross-org write conflict on `bundle_suggestion_dismissals`
**File:** `server/services/documentBundleService.ts` lines 260–270 (read side) + 369–381 (write side).

**Codex's claim.** The PR-review B3 fix pass added `eq(bundleSuggestionDismissals.organisationId, input.organisationId)` to the dismissal existence check in `suggestBundle`. But `dismissBundleSuggestion` still upserts on the global unique key `(user_id, doc_set_hash)`. If the same user dismisses the same doc set in Org A and then Org B, the second upsert hits `ON CONFLICT (user_id, doc_set_hash)` on the Org A row. With the repaired RLS on (FORCE + org-scoped WITH CHECK), the DO UPDATE either rejects (the Org A row's `organisation_id` doesn't match the Org B session variable — WITH CHECK fails) or silently touches the Org A row only; either way, the Org B user never gets a visible dismissal, and `suggestBundle` keeps firing.

**Adjudication — REJECT for in-session fix, DEFER to `tasks/todo.md`.** Spec-level issue, pre-existing, out of scope for this dual-review pass:

- The unique index `(user_id, doc_set_hash)` is the shipping design from `migrations/0212_bundle_suggestion_dismissals.sql` line 18 AND from the spec at §5.12 lines 1247–1248 AND from the Drizzle schema in `server/db/schema/bundleSuggestionDismissals.ts`. The pr-review B3 fix didn't introduce it.
- The spec is internally inconsistent on multi-org semantics. Line 1258 says "Scoping: per-user, not per-org... dismissals are the personal preference of the user who did the dismissing" — implying cross-org dismissal is by design. Line 1261 says "The table is org-scoped via organisation_id" — implying the opposite. The multi-org scenario Codex describes surfaces the inconsistency, it doesn't resolve it.
- Resolution needs either (a) a new migration extending the unique index to `(organisation_id, user_id, doc_set_hash)` with matching conflict-target change in the service, or (b) dropping `organisation_id` + its RLS policy on this specific table. Either path requires a spec amendment first.
- Severity is low — only triggers for cross-org users, which in v1 is system_admin holding `X-Organisation-Id` header. Regular users have a single org per JWT.

**Action.** Logged to `tasks/todo.md` under a new `## Deferred from dual-reviewer — cached-context-infrastructure` section so the item is picked up when cached-context §5.12 is revisited. Source-log reference recorded for traceability. No in-session code change.

### Decision log — iteration 2

```
[REJECT] server/services/documentBundleService.ts:265 (read) + :377-378 (write) — P2 cross-org dismissal conflict
  Reason: Pre-existing architectural issue in spec §5.12 — the unique key (user_id, doc_set_hash) is
  self-inconsistent with the org-scoped RLS policy on the same table. Fix requires either a new
  migration + spec amendment (option a: per-org unique key) or removing org scoping entirely
  (option b: cross-org dismissals). Out of scope for this fix pass. Logged to tasks/todo.md.
```

Zero findings accepted for in-session implementation in iteration 2. Per the dual-reviewer agent spec: "If zero findings were accepted this iteration → break." Loop terminates at iteration 2.

---

## Changes Made

- `migrations/0213_fix_cached_context_rls.sql` — dropped the broken `*_subaccount_isolation` policies on the 5 affected tables (replaces the rewritten-but-broken versions); kept all `*_org_isolation` policies with FORCE + WITH CHECK + IS NOT NULL guards. Added a header note explaining the scope choice and referencing the 0200 precedent.
- `server/services/contextAssemblyEngine.ts` — rewrote the `intendedPrefixHashComponents` construction loop to produce `orderedDocumentIds` sorted ascending by documentId (per spec §4.4 line 566), dedup'd by documentId, with parallel `documentSerializedBytesHashes` and `includedFlags` arrays.
- `tasks/todo.md` — appended a dated `## Deferred from dual-reviewer — cached-context-infrastructure` section logging the iter-2 P2 finding as a pre-existing spec-level architectural item.

## Rejected Recommendations

- **Iteration 2 P2 — cross-org dismissal conflict.** Pre-existing spec inconsistency; not a regression introduced by this fix pass. Requires either a migration + spec amendment or a spec-level semantic change. Routed to `tasks/todo.md` per the architectural-findings-go-to-deferred convention.
- **Iteration 1 P2 — Codex's "preserve duplicates" framing of the prefix-hash components bug.** Accepted the bug identification but rejected the proposed shape. The spec defines `PrefixHashComponents` for per-bundle use where duplicates are impossible; the HITL payload reuses the same type without redefining semantics. Sort-ascending-dedup matches both the explicit spec contract comment (`document_id ascending`) and the example-instance shape (`includedFlags` with one entry per documentId).

---

**Commit at finish:** `55c741dc` — pushed to `origin/claude/implementation-plan-Y622C`

**Verdict:** PR ready. All critical and important issues resolved. One architectural item (cross-org dismissal conflict) deferred to `tasks/todo.md` as a pre-existing spec-level inconsistency — not a regression of this fix pass.
