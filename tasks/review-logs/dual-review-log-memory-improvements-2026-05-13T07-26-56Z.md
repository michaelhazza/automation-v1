# Dual Review Log — memory-improvements

**Files reviewed:** 15-file uncommitted slice on branch `claude/add-memvid-integration-ehAOr` (Phase 2 fix-loop work):

- `client/src/pages/MemoryBlockDetailPage.tsx`
- `client/src/pages/MemoryBlockSourcesTab.tsx`
- `client/src/pages/MemoryUtilityTab.tsx`
- `migrations/0333_memory_block_version_sources.sql`
- `server/routes/memoryBlockSources.ts`
- `server/routes/memoryBlocks.ts`
- `server/services/__tests__/memoryBlockSourcesServicePure.test.ts`
- `server/services/memoryBlockService.ts`
- `server/services/memoryBlockSourcesService.ts`
- `server/services/memoryBlockSourcesServicePure.ts`
- `server/services/memoryBlockSynthesisService.ts`
- `server/services/memoryUtilityQueryService.ts`
- `server/services/retrievalService.ts`
- `tasks/builds/memory-improvements/progress.md`
- `tasks/review-logs/spec-conformance-log-memory-improvements-2026-05-13T05-41-00Z.md`

**Iterations run:** 3/3
**Timestamp:** 2026-05-13T07:26:56Z
**Codex CLI version:** 0.118.0 — default model `gpt-5.5` rejected as too-new-for-CLI; default `gpt-5.4` at capacity; ran on `gpt-5.4-mini` (medium → medium → high reasoning across iterations) — the only available chat-account-compatible model that returned a complete review summary.

---

## Iteration 1 (gpt-5.4-mini, medium reasoning)

Codex output: 3711 lines, completed cleanly (EXIT=0). Single finding:

[REJECT] migrations/0333_memory_block_version_sources.sql:26-35 — "Mutating already-numbered migration 0333 in place; deployments that have already applied 0333 will not receive the new RLS policy / FORCE RLS shape. Add a follow-up migration instead."
  Reason: False premise. Migration 0333 was introduced on this feature branch (commit `a1e87d75`) and has never been merged to main, never been applied to any staging or production database. `git branch -a --contains a1e87d75` shows only `claude/add-memvid-integration-ehAOr` (local + origin). DEVELOPMENT_GUIDELINES.md §6.2 explicitly authorises in-place edits while a migration remains on a feature branch pre-merge: "Use `<NNNN>_<name>.sql` as a placeholder during PR development; rename the file to claim the next available number immediately before merge (after rebasing onto latest `main`)." The first time 0333 (or its post-merge renumber) actually runs on any DB is on a schema where the legacy `tenant_isolation` policy never existed, so the new file's `CREATE POLICY memory_block_version_sources_org_isolation` runs cleanly.

## Iteration 2 (gpt-5.4-mini, medium reasoning)

Codex output: 5875 lines, completed cleanly (EXIT=0). Single finding:

[REJECT] migrations/0333_memory_block_version_sources.sql:27 — "On databases that have already applied this table migration, the existing policy is still named `tenant_isolation`, so `DROP POLICY IF EXISTS memory_block_version_sources_org_isolation` is a no-op. That leaves the legacy policy in place alongside the new one."
  Reason: Same root false premise as iteration 1, probed from a more specific angle (the policy-name mismatch). No database has run the old shape of 0333, so there is no `tenant_isolation` policy in any environment to drop. Iteration 1 rejection applies verbatim.

## Iteration 3 (gpt-5.4-mini, high reasoning)

Codex output: 4990 lines, completed cleanly (EXIT=0). Two findings:

[ACCEPT] server/services/memoryBlockSourcesService.ts:75-78 — "When `latestVersion` is missing, this branch fabricates `blockVersionId: ''` and `capturedAt: new Date()`. The empty-lineage case should return null/omitted version metadata instead."
  Reason: Real correctness concern. The empty-versions early return passes `''` and `new Date()` as positional args to `assembleSourcesPayload`, which the pure helper then serialises to a payload claiming the block has a real-looking version id and a captured-at timestamp equal to the request's wall-clock instant. The path is effectively unreachable for the route's only consumer (the Sources tab only renders for `auto_synthesised` blocks, which always have version rows) — but the API contract is honest only if the type permits null. Fix: widen `MemoryBlockSourcesPayload.blockVersionId` to `string | null` and `capturedAt` to `string | null`, widen `assembleSourcesPayload` to accept nullable inputs, and pass `null, null, null` in the early-return branch instead of fabricated values. Added a test in `memoryBlockSourcesServicePure.test.ts` covering the new null pass-through.

[REJECT] server/services/memoryBlockService.ts:914-922 (Codex meant 1053-1068 — `getBlockById`) — "This lookup now filters out rows with `deletedAt`, so `MemoryBlockDetailPage` loses `blockSource` for a soft-deleted block and hides the Sources tab entirely. The lineage endpoint still serves those rows, so admins revisiting a deleted block can no longer inspect its provenance."
  Reason: The `isNull(memoryBlocks.deletedAt)` filter is consistent with every other `getBlock*` function in this file (`getBlockMeta` at line 1040, plus 18+ other call sites enumerated via grep `isNull\(memoryBlocks\.deletedAt`) and with the entire UI's soft-delete posture — there is no list view that surfaces soft-deleted blocks. The detail page is reachable only by direct URL navigation. Removing the filter would make `getBlockById` an outlier rather than fix a regression — it would BREAK the established convention. The lineage endpoint's tolerance of soft-deleted blocks pre-exists this branch and is a separate (orthogonal) design point; raising it here would be a "consistency unification" decision that needs product input, not a mechanical fix.

---

## Changes Made

- `server/services/memoryBlockSourcesServicePure.ts` — widened `MemoryBlockSourcesPayload.blockVersionId` to `string | null` and `capturedAt` to `string | null`; widened `assembleSourcesPayload`'s positional args (`blockVersionId`, `blockVersionCapturedAt`) to nullable; guarded the `.toISOString()` call against null.
- `server/services/memoryBlockSourcesService.ts` — empty-versions early return now passes `null, null, null` to `assembleSourcesPayload` instead of `'', null, new Date()`; added comment explaining the legacy-block reachability and UI short-circuit.
- `server/services/__tests__/memoryBlockSourcesServicePure.test.ts` — added one new test "no version metadata — blockVersionId and capturedAt pass through as null" covering the new null behavior. Existing 10 tests unchanged; full suite: 11/11 pass.
- `client/src/pages/MemoryBlockSourcesTab.tsx` — widened the client-side `MemoryBlockSourcesPayload` interface to match the server type (`blockVersionId: string | null`, `capturedAt: string | null`). No runtime change — the empty-sources branch short-circuits before these fields are read.

## Rejected Recommendations

1. **migrations/0333 mutation finding (iterations 1 & 2):** Same root false premise — Codex assumed the migration had already been deployed. It has never been on main and exists only on the local + origin feature branch. Per DEVELOPMENT_GUIDELINES.md §6.2, in-place edits while pre-merge are the canonical workflow. Rejection rationale documented inline above and traceable in iteration logs at `/tmp/codex-dual-mi/iter1e.out` and `/tmp/codex-dual-mi/iter2.out`.
2. **`getBlockById` soft-delete filter (iteration 3):** Pattern-conformance vs pattern-break trade-off. The filter is consistent with every other `getBlock*` lookup in `memoryBlockService.ts` and matches the UI's universal "soft-deleted blocks are not navigable from the list views" posture. Removing the filter on this one function would create an inconsistency; preserving it is the senior-engineer call.

---

**Verdict:** APPROVED (3 iterations; 1 of 4 findings accepted and fixed in-branch; 3 rejected with documented rationale)

**Commit at finish:** (to be filled in by auto-commit step)
