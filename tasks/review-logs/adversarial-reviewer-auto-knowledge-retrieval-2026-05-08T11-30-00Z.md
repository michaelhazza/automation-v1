# Adversarial Review Log — auto-knowledge-retrieval

**Branch:** auto-knowledge-retrieval
**Reviewed against:** origin/main
**Timestamp:** 2026-05-08T11:30:00Z
**Reviewer:** adversarial-reviewer (Claude Sonnet 4.6)
**Trigger:** manual invocation; path-check matched `server/routes/files.ts`, `server/routes/referenceDocuments.ts`, `server/routes/agents.ts`, `server/routes/scheduledTasks.ts`, `migrations/0288–0294`, `server/config/rlsProtectedTables.ts`

**Verdict:** HOLES_FOUND (3 confirmed-holes, 3 likely-holes)

## Contents

1. RLS / Tenant Isolation — AKR-ADV-1, AKR-ADV-W1
2. Auth & Permissions — AKR-ADV-2, AKR-ADV-3
3. Race Conditions — none
4. Injection — AKR-ADV-4
5. Resource Abuse — AKR-ADV-5
6. Cross-Tenant Data Leakage — AKR-ADV-6, AKR-ADV-W2
7. Additional observations
8. Verdict + disposition

## Files reviewed

- `server/routes/files.ts`
- `server/routes/referenceDocuments.ts`
- `server/services/documentPromotionService.ts`
- `server/services/documentSummariseService.ts`
- `server/services/documentDataSourceService.ts`
- `server/services/retrievalService.ts`
- `server/services/retrievalServicePure.ts`
- `server/services/documentRetrievalServicePure.ts`
- `server/services/memoryBlockRetrievalServicePure.ts`
- `server/services/documentEmbeddingService.ts`
- `server/services/documentChunkingServicePure.ts`
- `server/jobs/documentChunkEmbedJob.ts`
- `server/jobs/documentPromotionFinaliseJob.ts`
- `server/jobs/documentReembedJob.ts`
- `server/jobs/documentSummariseJob.ts`
- `server/services/runContextLoader.ts`
- `server/config/rlsProtectedTables.ts`
- `server/config/jobConfig.ts`
- `server/lib/orgScopedDb.ts`
- `server/lib/adminDbConnection.ts`
- `server/lib/createWorker.ts`
- `server/middleware/auth.ts`
- `server/db/index.ts`
- `server/db/schema/executionFiles.ts`
- `migrations/0288_reference_document_modes_and_summary.sql`
- `migrations/0289_reference_document_chunks.sql`
- `migrations/0290_reference_document_data_sources.sql`
- `migrations/0291_memory_blocks_scheduled_task_scope.sql`
- `migrations/0292_agent_execution_events_retrieval_summary_unique.sql`
- `migrations/0294_document_promotion_audit.sql`

---

## 1. RLS / Tenant Isolation

### confirmed-hole AKR-ADV-1 — `documentSummariseService.ts`: all three DB queries missing explicit `organisationId` filter

**File:line:** `server/services/documentSummariseService.ts:14` (SELECT referenceDocumentVersions), `:24` (SELECT referenceDocuments), `:54` (UPDATE referenceDocuments)

**Attack scenario:** Every query uses only the primary-key `id` column in its WHERE clause — no `eq(referenceDocuments.organisationId, organisationId)` or equivalent. The UPDATE at line 54 issues `WHERE eq(referenceDocuments.id, documentId)` with no org guard, writing `summary`, `summaryStale`, and `summaryGeneratedAt` to any matching UUID. DEVELOPMENT_GUIDELINES.md §1 explicitly requires "Always filter by `organisationId` in application code, even with RLS." The job runs through `createWorker` with no `resolveOrgContext` override, so `app.organisation_id` is set for normal operation. However, the function is callable as a plain service function (the `documentSummariseJob` handler calls it directly, and future callers or test harnesses can too). Any call path that bypasses `createWorker`'s auto-tx — e.g., a future job refactor that opts out, or a test that calls `summariseDocumentVersion` directly — would have no DB-layer guard against cross-tenant UPDATE. The two SELECT queries would also return rows from any org if the session var is unset and the DB role has BYPASSRLS.

**Suggested fix:** Add `eq(referenceDocumentVersions.documentId, documentId)` plus `eq(referenceDocuments.organisationId, organisationId)` to all three WHERE clauses. The `organisationId` parameter is already present in the function signature.

**STATUS:** FIXED inline (this commit). All three queries now carry org filters; SELECT-version uses an inner-join with `referenceDocuments` to enforce the boundary via the parent row.

---

### worth-confirming AKR-ADV-W1 — `document_promotion_audit` RLS uses the two-condition form (migration 0294) rather than the canonical three-condition form

**File:line:** `migrations/0294_document_promotion_audit.sql:24–27`

The policy is `USING (organisation_id = current_setting('app.organisation_id', true)::uuid)` without the IS NOT NULL and `<> ''` guards from the canonical three-condition form used in migrations 0245, 0284, 0289. Functionally safe under PostgreSQL null semantics: when `app.organisation_id` is not set, `current_setting` returns NULL and `NULL::uuid` is NULL, making `organisation_id = NULL` evaluate to NULL (fail-closed). The empty-string case throws a cast error (not a bypass). However the form diverges from the canonical pattern enforced by `scripts/verify-rls-coverage.sh` and may produce a gate warning.

**STATUS:** Routed to `tasks/todo.md` as AKR-ADV-W1.

---

## 2. Auth & Permissions

### likely-hole AKR-ADV-2 — `server/routes/files.ts` imports `db` directly; `/api/files` GET runs on a plain connection outside the ALS org-scoped transaction

**File:line:** `server/routes/files.ts:8` (import), `:110` (query start)

**Attack scenario:** Architecture.md and DEVELOPMENT_GUIDELINES §2 state "Routes never import `db` directly." The `authenticate` middleware wraps each request in `db.transaction()` and binds `app.organisation_id` into AsyncLocalStorage. The `db.select(...)` call at line 110 creates a new connection from the pool that is NOT the ALS-tracked transaction — it runs without `app.organisation_id` set. Tenant isolation for the `executionFiles`/`executions` JOIN relies solely on the explicit `eq(executions.organisationId, req.orgId!)` at line 88. The `documentPromotionAudit` LEFT JOIN similarly relies only on `eq(documentPromotionAudit.organisationId, req.orgId!)` at line 106. If the `DATABASE_URL` role has BYPASSRLS or is a superuser, RLS is transparent and the explicit `req.orgId!` filter is the sole tenant guard. An implementation bug in how `req.orgId` is derived or a future change to that middleware chain could expose cross-tenant data with no DB-layer fail-closed protection.

**What would confirm:** Verify whether the `DATABASE_URL` Postgres role has BYPASSRLS or is a superuser. If yes, the guard is solely application-level.

**Suggested fix:** Extract the query into a service function (e.g., `fileService.listFiles(orgId, options)`) that uses `getOrgScopedDb()`.

**STATUS:** Routed to `tasks/todo.md` as AKR-ADV-2.

---

### likely-hole AKR-ADV-3 — Promote endpoint accepts `agentId`, `subaccountId`, `scheduledTaskId`, `taskInstanceId` from request body without org-membership verification

**File:line:** `server/routes/referenceDocuments.ts:218–244` (promote route); `server/services/documentPromotionService.ts:152–162` (data source insert)

**Attack scenario:** The promote route at `POST /api/reference-documents/promote` accepts scope-narrowing IDs from the request body and passes them directly to `promoteFile`, which inserts them into `reference_document_data_sources` without verifying they belong to `req.orgId!`. An authenticated user in Org A with `REFERENCE_DOCUMENTS_WRITE` can supply an `agentId` belonging to Org B. The FK constraint on `agents(id)` succeeds because the target agent row exists. The resulting row has `organisation_id = Org A`, `agent_id = Org B's agent`. During retrieval, the `referenceDocumentDataSources` query scopes by both `organisationId = Org A` AND `agentId = run's agentId`, so Org B's agent UUID would never match an Org A run's `agentId` in practice — direct data access exploitation is low. However, the write inserts FK-valid references to another org's entities, violates DEVELOPMENT_GUIDELINES §9 ("Cross-entity ID verified"), and creates corrupted scope-link rows.

The same gap applies to `POST /api/reference-documents/:id/links` → `documentDataSourceService.linkDocumentToScope` (`referenceDocuments.ts:439–448`).

**Suggested fix:** Before inserting, verify each non-null scope ID belongs to the calling org: `resolveSubaccount` for `subaccountId`; query `agents WHERE id = agentId AND organisationId = orgId` for `agentId`; equivalent checks for `scheduledTaskId` and `taskInstanceId`.

**STATUS:** Routed to `tasks/todo.md` as AKR-ADV-3.

---

## 3. Race Conditions

No confirmed or likely holes found.

The `document:chunk-embed` job uses pre-check + unique-index idempotency (ON CONFLICT DO NOTHING) + count verification before pointer flip. The `document:promotion-finalise` job uses a `DURABLE_THRESHOLD` idempotency guard before the UPDATE. The multi-step promote transaction is atomic within the `authenticate` middleware's ambient `db.transaction()`. The pg-boss retry backoff series for `document:promotion-finalise` (retryLimit 5, retryBackoff true, retryDelay 30 → ~930s total window) is sufficient to wait for `document:chunk-embed` to complete.

---

## 4. Injection

### confirmed-hole AKR-ADV-4 — `documentSummariseService.ts`: unbounded user-controlled `version.content` injected into LLM prompt without truncation

**File:line:** `server/services/documentSummariseService.ts:37`

**Attack scenario:** The LLM prompt is assembled as `Summarise the following document in 2-3 sentences for use as a retrieval hint:\n\n${version.content}`. `version.content` is the full content of a promoted execution file, which can reach the upload size limit (`systemSettingsService.getMaxUploadSizeBytes()` — configurable per org). No truncation is applied. Prompt-injection attack: an org user uploads a document containing adversarial instructions designed to manipulate the LLM into producing a misleading or harmful `summary` string. The summary is stored in `reference_documents.summary` and injected into agent context assembly at runtime. The attack stays within the same org (no cross-tenant reach), but a malicious actor could craft a summary that causes agent misbehaviour. Additionally, a very large document (e.g., the full upload limit in text form) will overflow most LLM context windows; `maxTokens: 256` caps output but not the input, resulting in billing amplification: the platform pays for a large input tokens bill to receive a 256-token response.

**Suggested fix:** Truncate `version.content` to a reasonable token budget (e.g., 4000 tokens) before injection. The `estimateTokenCount` helper from `documentChunkingServicePure.ts` and `truncateContentToTokenBudget` from `externalDocumentResolverPure.ts` are already available in the codebase.

**STATUS:** FIXED inline (this commit). Constant `SUMMARISE_INPUT_TOKEN_BUDGET = 4000`; truncation applied via `truncateContentToTokenBudget` before prompt assembly.

---

## 5. Resource Abuse

### likely-hole AKR-ADV-5 — No per-org chunk-count cap or embedding cost quota in `documentChunkEmbedJob`

**File:line:** `server/jobs/documentChunkEmbedJob.ts:60–77`; `server/services/documentChunkingServicePure.ts` (no MAX_CHUNKS constant); `server/services/documentEmbeddingService.ts:119–158`

**Attack scenario:** `chunkDocument` has no maximum chunk count. At `DEFAULT_CHUNK_TARGET_TOKENS = 512` and `BATCH_SIZE = 100` per OpenAI embedding call, a text document near the configurable upload size limit could produce hundreds of chunks and many API batches. The job's `expireInSeconds: 300` timeout is the only backstop — and it fires after API calls have already been made and billed. There is no per-org daily embedding token quota, no per-document chunk count cap, and no `singletonKey`-based rate limit on `document:chunk-embed` submissions. A user with `REFERENCE_DOCUMENTS_WRITE` can upload and promote multiple large documents rapidly, each triggering a full embedding sweep. The OpenAI API cost is borne by the platform, not the org. Under the current design, a single user could exhaust the platform's embedding quota or incur unexpected billing.

**Suggested fix:** Add a `MAX_CHUNKS_PER_DOCUMENT = 500` constant in `documentChunkingServicePure.ts` and return a truncated chunk list (with a warning log) if exceeded. Add a per-org `document:chunk-embed` queue rate limit or daily embedding token counter.

**STATUS:** Routed to `tasks/todo.md` as AKR-ADV-5.

---

## 6. Cross-Tenant Data Leakage

### confirmed-hole AKR-ADV-6 — `documentPromotionFinaliseJob` reads `referenceDocuments` and `documentPromotionAudit` with no `organisationId` filter and no org-scoped transaction

**File:line:** `server/jobs/documentPromotionFinaliseJob.ts:43–75` (Steps 1 and 2)

**Attack scenario:** The job opts out of `createWorker`'s auto-org-transaction (`resolveOrgContext: () => null`), which per `createWorker.ts` documentation means "the handler is responsible for using `withAdminConnection` for any DB access." The handler instead uses plain `db` directly.

Step 1 (line 43–52): `db.select({ retrievalVersionId }).from(referenceDocuments).where(eq(referenceDocuments.id, documentId))` — queries `referenceDocuments` by UUID alone with no `organisationId` filter and no `app.organisation_id` session variable set. FORCE RLS is enabled on this table (migration 0229). If the `DATABASE_URL` Postgres role has BYPASSRLS or is a superuser, this query returns the `retrievalVersionId` of any org's document given only the UUID.

Step 2 (line 59–74): `db.select({ fileId }).from(documentPromotionAudit).where(eq(documentPromotionAudit.id, promotionAuditId))` — same pattern on `documentPromotionAudit`, reading `fileId` across all orgs.

Job payloads are server-generated (not HTTP-user-controlled), so a direct exploit requires compromising the job queue. However, the implementation violates the documented contract for `resolveOrgContext: () => null`, does not use `withAdminConnection`, produces no audit log, and has no `organisationId` guard on either read. If the DB role has BYPASSRLS, this is a cross-org data-read path for any document or audit row UUID that happens to be known.

The `executionFiles` UPDATE at lines 101–109 correctly guards with `eq(executionFiles.id, fileId)` and `lt(executionFiles.expiresAt, DURABLE_THRESHOLD)`, but `fileId` was derived from the unguarded Step 2 read.

**Suggested fix:** Add `eq(referenceDocuments.organisationId, organisationId)` at line 45 and `eq(documentPromotionAudit.organisationId, organisationId)` at line 60 (both `organisationId` values come from `job.data`). Alternatively, switch to `withAdminConnection` with `SET LOCAL ROLE admin_role` and audit logging if admin-bypass semantics are genuinely required.

**STATUS:** FIXED inline (this commit). Both reads now include `organisationId = job.data.organisationId` predicates; the chained `executionFiles` UPDATE is now implicitly org-safe because `fileId` is derived from an org-filtered audit row.

---

### worth-confirming AKR-ADV-W2 — Memory blocks from out-of-scope subaccounts (same org, different subaccount) are not pre-filtered before the ranker

**File:line:** `server/services/retrievalService.ts:222–254`

The DB query loads ALL active memory blocks for the org without filtering by `subaccountId` or `ownerAgentId`. `rankByPrecedencePure` assigns `scopeTier = 0` to blocks owned by a different subaccount's agent. `rankCandidates` then includes these tier-0 candidates in the ranked output — they appear after org-scoped tier-1 blocks but are not excluded. Subaccount-B's agent-scoped memory block can surface in subaccount-A's agent run if the budget permits. Whether this is intentional (spec-permitted cross-subaccount org visibility) or a leakage is unclear. The comment at `memoryBlockRetrievalServicePure.ts:51` says "out-of-scope (should have been filtered by caller's DB query)" — confirming the caller was supposed to pre-filter.

**STATUS:** Routed to `tasks/todo.md` as AKR-ADV-W2.

---

## 7. Additional observations

- `documentChunkEmbedJob.ts:45` and `documentReembedJob.ts:108,137` — pre-transaction reads on `referenceDocumentVersions` and `referenceDocumentChunks` use plain `db` without setting `app.organisation_id`. Under FORCE RLS with a non-superuser role these return zero rows, silently aborting the job. If the DB role has BYPASSRLS, these are cross-org readable by version/chunk UUID. Verify DB role BYPASSRLS status.
- `GET /api/files/:fileId/download` (`files.ts:70–72`) — gated by `authenticate` only, no `requireOrgPermission`. `fileService.downloadFile` enforces org ownership via JOIN but any authenticated org user can download any execution file belonging to their org.
- `retrievalService.ts:115` — the `dsConditions.reduce((a, b) => sql\`${a} OR ${b}\`, dsConditions[0])` pattern is correct but fragile. Replace with `sql.join(dsConditions, sql\` OR \`)` for clarity and to prevent future double-accumulation bugs if the initialValue is accidentally changed.
- `migrations/0291_memory_blocks_scheduled_task_scope.sql` — `scheduled_task_id` column added with `ON DELETE SET NULL`, not CASCADE. This is intentional (recurring tasks can be deleted without losing memory blocks), but retrieval queries that filter by `scheduledTaskId IS NOT NULL` will not find blocks whose scheduled task has been deleted. Verify spec §4.2 intent.

---

## 8. Verdict + disposition

**Verdict:** HOLES_FOUND (3 confirmed-holes, 3 likely-holes)

**Disposition:** 3 confirmed holes (AKR-ADV-1, AKR-ADV-4, AKR-ADV-6) FIXED inline in main session. 5 likely-holes / worth-confirming findings (AKR-ADV-2, AKR-ADV-3, AKR-ADV-5, AKR-ADV-W1, AKR-ADV-W2) routed to `tasks/todo.md` for triage post-merge.
