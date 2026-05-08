# PR Review Log — auto-knowledge-retrieval

**Branch:** `auto-knowledge-retrieval`
**Baseline:** `origin/main` (4 commits ahead of local main per caller note)
**HEAD at review:** `9535d59c` (after adversarial-reviewer fixes)
**Reviewer:** pr-reviewer (Opus 4.7, 1M context)
**Reviewed at:** 2026-05-08T12:30:00Z

**Verdict:** CHANGES_REQUESTED (3 blocking, 7 strong, 4 non-blocking)

## Contents

1. Files reviewed
2. Existing review state acknowledged
3. Blocking issues (B1, B2, B3)
4. Strong recommendations (S1–S7)
5. Non-blocking improvements (N1–N4)
6. Multi-tenant safety checklist
7. Verification expected
8. Verdict

## Files reviewed

- `migrations/0288–0294` (7 forward + 7 down)
- `server/db/schema/referenceDocuments.ts`, `referenceDocumentChunks.ts`, `referenceDocumentDataSources.ts`, `documentPromotionAudit.ts`, `memoryBlocks.ts`, `agentExecutionEvents.ts`, `index.ts`
- `server/config/rlsProtectedTables.ts`
- `server/services/retrievalService.ts`, `retrievalServicePure.ts`, `retrievalObservabilityService.ts`, `retrievalObservabilityServicePure.ts`
- `server/services/documentRetrievalServicePure.ts`, `documentChunkingServicePure.ts`, `documentEmbeddingService.ts`, `documentSummariseService.ts`, `documentDataSourceService.ts`, `documentPromotionService.ts`
- `server/jobs/documentChunkEmbedJob.ts`, `documentReembedJob.ts`, `documentPromotionFinaliseJob.ts`, `documentSummariseJob.ts`
- `server/routes/files.ts`, `referenceDocuments.ts`, `agents.ts` (relevant hunks)
- `server/services/agentExecutionService.ts` (retrieval consumption + emission sites)
- `shared/types/retrieval.ts`, `shared/types/agentExecutionLog.ts`
- `client/src/api/filesApi.ts`, `client/src/pages/govern/components/KnowledgeFilesTab.tsx`

## Existing review state acknowledged

`tasks/review-logs/spec-conformance-log-…2026-05-08T10-41-22Z.md` (14 directional gaps as AKR-CONF-*) and `tasks/review-logs/adversarial-reviewer-…2026-05-08T11-30-00Z.md` (3 fixed inline as AKR-ADV-1/4/6, 5 routed as AKR-ADV-2/3/5/W1/W2). Items already routed are not re-litigated; everything below is NEW.

---

## Blocking issues (must fix before merge)

### B1 — `emitRetrievalSummary` violates log-and-swallow pattern (DEVELOPMENT_GUIDELINES §2, architecture pattern 5)

**File:** `server/services/retrievalObservabilityService.ts:27-29`

`const db = getOrgScopedDb('…')` is at line 27 — OUTSIDE the `try { … }` block at line 29. Per architecture.md pattern 5: "`getOrgScopedDb()` must be the first line **inside** the `try` block, never above it. Placing it above the catch turns a missing-org-context throw into a hard failure that escapes the error boundary."

The caller (`agentExecutionService.ts:1681-1691`) treats the call as fire-and-forget with a `.catch(...)`. If retrieval-summary emission is reached without an active org-scoped tx (a future refactor moves the call site, or a partial-success path completes outside `withOrgTx`), the throw from `getOrgScopedDb` would propagate up the async boundary instead of being swallowed.

**STATUS:** FIXED inline (commit follows). Moved `const db = getOrgScopedDb(...)` to the first line inside the try block.

---

### B2 — `groupCandidatesByDocument` is called for side effects only; return value discarded

**File:** `server/services/retrievalService.ts:319-335`

The function is purely transformational (returns `DocumentLevelResult[]`); the result is never assigned, used, or written. The trailing `return truncateForEmission(ranked)` returns the chunk-level result unchanged. The spec's load-bearing best-of-chunk document relevance invariant (§10.8, §1.5 #1) is therefore not delivered at runtime.

**STATUS:** Routed to `tasks/todo.md` as PR-REV-B2. Tied to AKR-CONF-1 / AKR-CONF-2 — these are facets of the same simplified-ranker design decision that needs a spec amendment vs. ranker-refactor call.

---

### B3 — Spec §13.1 retrieval-version-completeness invariant is not enforced at the production read path

**Files:** `server/services/retrievalService.ts:180-187`, `server/services/documentRetrievalServicePure.ts:27` (`filterDocumentChunks`)

The pure helper `filterDocumentChunks` exists, exports the `expectedChunkCountByVersionId` parameter, and is tested for the completeness reject. **However, `retrievalService.ts` does not call `filterDocumentChunks`.** Instead it implements its own inline filter (lines 180-187) that checks pointer alignment but NOT the completeness count. If `retrieval_version_id` is ever flipped before all chunks are written, this read path will happily return a partial chunk set and the agent will see mutilated context.

**STATUS:** Routed to `tasks/todo.md` as PR-REV-B3. Tied to AKR-CONF-1 contract-shape design decision. Currently the test is dead — running green without exercising the production path. Either route `retrievalService.buildCandidatePool` through `filterDocumentChunks` OR amend the spec to clarify the invariant lives in the chunk-embed write-side guard only.

---

## Strong recommendations

### S1 — `embedChunks` silently truncates chunk content to 8192 characters before embedding

**File:** `server/services/documentEmbeddingService.ts:58`

```ts
input: texts.map((t) => t.slice(0, 8192)),
```

Chunk row is persisted with full content; embedding represents only the first 8192 characters. At default `DEFAULT_CHUNK_TARGET_TOKENS = 512` (≈2k chars) this is comfortable, but a sentence-resistant or non-Latin chunk can hit `splitByByteWindow` and produce content >8192 chars. Result: vector search against truncated text, agent sees full chunk. Silent quality regression.

**STATUS:** FIXED inline (commit follows). Promoted the magic 8192 to an exported `EMBEDDING_INPUT_BYTE_LIMIT` constant and added a structured `logger.warn('document.embed.input_truncated', { chunkIndex, originalLength, truncatedLength })` when truncation actually fires.

---

### S2 — `referenceOnlyManifest` is dead infrastructure

**Files:** `server/services/agentExecutionService.ts:659`, `shared/types/retrieval.ts:64`, `server/services/retrievalServicePure.ts:108`

The pure ranker returns `referenceOnlyManifest` with `{ id, documentId? }` only — no title, no summary. `agentExecutionService.ts` consumes `retrievalResult.loaded` only; the manifest is never written to the prompt. No tool-call surface exists for "fetch reference_only document by id". A document with `mode = 'reference_only'` is invisible to the agent at runtime.

**STATUS:** Routed to `tasks/todo.md` as PR-REV-S2. Tied to AKR-CONF-1 contract-shape design decision plus a missing tool-call surface. Either implement title+summary on the manifest and a fetch-by-id tool, OR amend spec §15 to mark `reference_only` mode as deferred.

---

### S3 — `KnowledgeFilesTab` does not consume `hasMore`/cursor; >50 files silently truncate

**File:** `client/src/pages/govern/components/KnowledgeFilesTab.tsx`

Operators with >50 files in a subaccount see the first 50 with no indication that more exist.

**STATUS:** Routed to `tasks/todo.md` as PR-REV-S3.

---

### S4 — `KnowledgeFilesTab` displays raw `subaccountId` UUID under "Agent" column

**File:** `client/src/pages/govern/components/KnowledgeFilesTab.tsx:115-118, 139-147`

Two issues: (1) header label says "Agent" but data is `subaccountId` (mislabelling), (2) raw UUID rendered.

**STATUS:** Routed to `tasks/todo.md` as PR-REV-S4.

---

### S5 — `truncateForEmission` mutates its input array via in-place `Array.sort()`

**File:** `server/services/retrievalObservabilityServicePure.ts:28-30, 34-35`

`Array.prototype.sort` mutates in place. Output is deterministic; side effect on input violates the "no side effects" expectation of `Pure.ts`.

**STATUS:** FIXED inline (commit follows). Cloned both arrays with spread before sort.

---

### S6 — Agent prompt sees raw chunk/document UUIDs as the data-source name

**File:** `server/services/agentExecutionService.ts:660-665`

Agent prompt receives `name: '550e8400-...'` instead of the document's actual `name`. Degrades retrieval signal quality — LLM uses the source name to reason about provenance.

**STATUS:** Routed to `tasks/todo.md` as PR-REV-S6. Needs a name-lookup pass in `retrievalService` to surface human-readable identifiers on each candidate.

---

### S7 — `linkDocumentToScope` does not catch CHECK-constraint violations (23514)

**File:** `server/services/documentDataSourceService.ts:39-45`

The catch handles `23505` (unique violation → 409 DOCUMENT_ALREADY_LINKED) but not `23514` — the scope-tier CHECK on `reference_document_data_sources` (migration 0290) fires when a caller passes more than one non-null scope FK, bubbling up as a 500.

**STATUS:** FIXED inline (commit follows). Added `23514 → 400 INVALID_SCOPE_TIER_COMBINATION` mapping alongside the existing 23505 handler.

---

## Non-blocking improvements

- **N1** — `documentChunkingServicePure.flushChunk()` declared but logic duplicated inline at L145-150. → routed as PR-REV-N1.
- **N2** — `0291_memory_blocks_scheduled_task_scope.sql` index lacks `WHERE deleted_at IS NULL`. → routed as PR-REV-N2.
- **N3** — `ReferenceDocumentSourceType` does not include `auto_memory_approved` per spec §4.4. → routed as PR-REV-N3 (spec amendment vs. enum widening — design decision).
- **N4** — `migrations/0294_document_promotion_audit.sql` uses two-condition RLS form. Already routed as AKR-ADV-W1; no separate todo entry needed.

---

## Multi-tenant safety checklist

- [x] Org-scoped at the table level — all four new tables carry `organisation_id NOT NULL` (or inherit) and have RLS_PROTECTED_TABLES entries.
- [~] Org-scoped at the query level — most paths comply after AKR-ADV-1/-6 fixes; `server/routes/files.ts` still imports `db` directly (AKR-ADV-2).
- [~] Service-layer mediated — `server/routes/files.ts` violates this contract (AKR-ADV-2).
- [x] Subaccount-resolved — no new `:subaccountId` routes.
- [x] Background jobs follow admin/org tx pattern — three new chunk/reembed/promotion-finalise workers opt-out of auto-org-tx and explicitly carry `organisationId` in payload + `withOrgTx` per tenant.
- [~] Log-and-swallow `getOrgScopedDb` inside try — VIOLATED by `retrievalObservabilityService.emitRetrievalSummary`. FIXED in B1 commit.
- [~] Cross-entity ID verified — AKR-ADV-3 already routed.

## Verdict

**CHANGES_REQUESTED at original review** → **post-fix disposition**:

- **3 blocking:** B1 FIXED inline; B2, B3 routed as PR-REV-* (tied to deferred AKR-CONF-1/-2 design decisions).
- **7 strong:** S1, S5, S7 FIXED inline; S2, S3, S4, S6 routed as PR-REV-*.
- **4 non-blocking:** N1, N2, N3 routed as PR-REV-*; N4 already covered by AKR-ADV-W1.

Mechanical fixes applied in main session: 4 (B1, S1, S5, S7).

The blocking design-decision items (B2, B3, S2) are facets of the same simplified-ranker / contract-shape question already deferred via AKR-CONF-1 and AKR-CONF-2. Re-running pr-reviewer after the mechanical fixes is expected to surface only the deferred-design items.

---

## Re-check 2026-05-08T12:50:00Z

**Commit re-verified:** `384bd7cd`
**Scope:** B1, S1, S5, S7 only (other findings routed to `tasks/todo.md`)

- **B1** — `server/services/retrievalObservabilityService.ts:32` — CLOSED. `getOrgScopedDb()` now lives as the first line inside `try`; comment cites architecture pattern 5 and PR-REV-B1.
- **S1** — `server/services/documentEmbeddingService.ts:23,128–141` — CLOSED. `EMBEDDING_INPUT_BYTE_LIMIT = 8192` exported; truncation moved upstream into `embedChunks` with a structured `documentEmbeddingService.input_truncated` warn-log carrying `versionId`, `chunkIndex`, `originalLength`, `truncatedLength`; the inline `.slice(0, 8192)` inside `callEmbeddingApi` is removed.
- **S5** — `server/services/retrievalObservabilityServicePure.ts:30,36` — CLOSED. `aboveThreshold.items` and `belowThreshold.sample` spread-cloned before `.sort()`. `modeExcluded.items` correctly left unspread because it is only sliced (slice does not mutate).
- **S7** — `server/services/documentDataSourceService.ts:47–49` — CLOSED. `23514` → `{ statusCode: 400, errorCode: 'INVALID_SCOPE_TIER_COMBINATION' }` added alongside `23505 → 409`; comment references migration 0290 CHECK constraint and PR-REV-S7.

**Verdict:** APPROVED (all four mechanical fixes correctly close their findings; no regressions)
