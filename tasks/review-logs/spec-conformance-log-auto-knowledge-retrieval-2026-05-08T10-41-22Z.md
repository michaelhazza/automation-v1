# Spec Conformance Log

**Spec:** `tasks/builds/auto-knowledge-retrieval/spec.md`
**Spec commit at check:** `8a44844c` (frozen)
**Branch:** `auto-knowledge-retrieval`
**HEAD:** `05ecb2bf`
**Base:** `origin/main` @ `ac20aa2f`
**Scope:** Phases 1-4 + Chunks 5A-5D
**Run at:** 2026-05-08T10:41:22Z

---

## Contents

1. Summary
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Notes
7. Next step

---

## 1. Summary

| Status | Count |
|--------|------:|
| Requirements extracted | 60 (across 21 in-scope chunks) |
| PASS (full) | 46 |
| PASS (with minor note) | 6 |
| MECHANICAL_GAP → fixed | 0 |
| DIRECTIONAL_GAP → deferred | 14 |
| AMBIGUOUS → deferred | 0 |
| OUT_OF_SCOPE | Chunk 5E + Phases 6-7 (11 chunks) |

**Verdict:** **NON_CONFORMANT (14 directional gaps — see deferred items)**

The branch implements the spec's surface area faithfully — schema, RLS, ranker scaffolding, jobs, observability ledger, promotion pipeline, and Files/Documents tabs — but several spec invariants are not enforced and several spec-named contracts diverged in shape. Each gap requires a design decision (amend spec or refactor implementation), so none qualify as a mechanical fix.

---

## 2. Requirements extracted (full checklist)

### Phase 1 — Schema + RLS foundation

- **1A.1-1A.4** (`reference_documents` columns + Drizzle): PASS
- **1B.1-1B.6** (`reference_document_chunks` table + RLS + manifest + Drizzle + barrel): PASS
- **1C.1-1C.7** (`reference_document_data_sources` join table + scope CHECK + RLS + manifest + Drizzle + barrel): PASS
- **1D.1-1D.3** (`memory_blocks.scheduled_task_id` column + index + Drizzle): PASS
- **1E.1** (Phase 1 closeout — barrel + manifest sweep clean): PASS

### Phase 2 — Shared retrieval engine

- **2A.1** (Type exports `RetrievalCandidate`, `RetrievalResult`, `RetrievalRejectionReason`, `RetrievalMode`): DIRECTIONAL_GAP — shape diverges from spec §6.1/§6.2
- **2A.2** (Closed enums `RetrievalRejectionReason`, `RetrievalMode`): PASS
- **2A.3** (`RetrievalDegradedReason` closed enum + `degraded` + `degradedReason` fields on result): PASS
- **2A.4** (`rankCandidates` pure with named comparator chain): DIRECTIONAL_GAP — no relevance / scope / recency / pin bonuses
- **2A.5** (Comparator chain `finalScore DESC, scopeTier DESC, updatedAt DESC, id ASC`): PASS
- **2A.6** (Best-of-chunk in same ranking pass): DIRECTIONAL_GAP — chunks compete individually
- **2A.7** (Defence-in-depth org-id filter at ranker entry): PASS
- **2A.8** (Truncation constants `MAX_REJECTED_*` exported): PASS
- **2B.1-2B.3** (`memoryBlockRetrievalServicePure` refactored to delegate ranking): PASS
- **2C.1-2C.3** (`documentRetrievalServicePure.filterDocumentChunks` + `groupCandidatesByDocument` + retrieval-version completeness invariant): PASS
- **2D.1-2D.4** (`documentChunkingServicePure.chunkDocument` + paragraph→sentence→byte-window heuristic + 512/64 default constants + reuses existing tokeniser): PASS

### Phase 3 — Document ingestion + re-embedding

- **3A.1-3A.3** (`documentEmbeddingService.embedChunks` I/O-only, `withBackoff` wrapper, 502 / EMBEDDING_PROVIDER_ERROR on permanent failure): PASS
- **3B.1-3B.3** (`document:summarise` worker registered, writes summary fields, idempotent via `summary_generated_at` predicate): PASS
- **3C.1-3C.7** (`document:chunk-embed` worker — pre-tx I/O, in-tx persist + count-check + atomic flip, post-commit chained enqueue, idempotency on (version_id, chunk_index, embedding_model)): PASS
- **3D.1-3D.4** (`document:reembed` worker — same transactional shape as 3C, per-document `active_embedding_model` flip): PASS
- **3E.1-3E.2** (`linkDocumentToScope` + `unlinkDocumentFromScope` with 23505→409 mapping and soft-delete): PASS
- **3E.3** (`changeDocumentMode` state-based predicate `WHERE mode <> :new_mode`): DIRECTIONAL_GAP — predicate missing
- **3E.4** (`retrieval.always_available.mode_changed` event emitted on transitions): DIRECTIONAL_GAP — emission missing entirely
- **3E.5-3E.7** (`writeVersionAndEnqueueJobs` afterCommit, `persistChunks`, mode + scope-link CRUD routes): PASS

### Phase 4 — Retrieval integration + observability emission

- **4A.1** (`0292` partial unique index `(run_id) WHERE event_type='retrieval.summary'`): PASS
- **4A.2** (`assembleKnowledgeForRun(runId): Promise<RetrievalResult>` is the single DB-backed entry point): PASS
- **4A.3** (Candidate-pool runs RLS-scoped via `getOrgScopedDb`): PASS
- **4A.4** (Five-tier UNION pool with SQL-side deterministic ordering): DIRECTIONAL_GAP — only 3 tiers; sort happens in JS post-fetch
- **4A.5** (Authorization-before-retrieval invariant): PASS
- **4A.6** (`emitRetrievalSummary` writes event; 23505 idempotent hit): PASS
- **4A.7** (`truncateForEmission` deterministic top-N truncation): PASS
- **4A.8** (Always-available threshold constants + `shouldShowAlwaysAvailableWarning` pure helper): PASS
- **4A.9** (`shared/types/agentExecutionLog.ts` extended with two new event types): PASS
- **4A.10** (New `'observability'` criticality entry): DIRECTIONAL_GAP — clashes with boolean criticality scheme
- **4A.11** (`buildDegradedResult` with closed enum reasons, deterministic shape): PASS
- **4A.12** (Failure paths emit degraded result, log error code, do not throw): DIRECTIONAL_GAP — `embedding_provider_failed` branch unreachable in v1
- **4A.13** (`chunkConfig: { targetTokens, overlapTokens }` in event payload): PASS
- **4B.1** (`agentExecutionService` calls `assembleKnowledgeForRun` and consumes loaded chunks): PASS
- **4B.2** (Removes `loadingMode` consumer code): PASS
- **4B.3** (`agentRunPromptService` accepts `RetrievalResult`): DIRECTIONAL_GAP — no diff to that file
- **4B.4** (Emit `retrieval.summary` at run end): PASS
- **4C.1** (Drop `loadingMode` from request/response shapes): PASS
- **4C.2** (400 `LOADING_MODE_DEPRECATED` if deprecated field is sent): DIRECTIONAL_GAP — guard missing on `scheduledTasks.ts`
- **4D.1-4D.3** (Migration `0293` drops column + Drizzle drops + down file restores column): PASS

### Phase 5 — Promotion pipeline + Knowledge tabs (5A-5D in scope)

- **5A.1-5A.9** (Migration `0294` audit table, append-only ledger, unique-per-file partial index, RLS + manifest, Drizzle, `promoteFile` inline transaction with all six steps, race guard 23505→409, afterCommit-only enqueue, POST `/api/reference-documents/promote` route): PASS
- **5B.1-5B.4** (`document:promotion-finalise` worker — verifies retrieval pointer, durability flip, idempotent): PASS
- **5C.1** (`GET /api/files?scope=...`): DIRECTIONAL_GAP — param shape diverges
- **5C.2** (Permission `knowledge:read`): DIRECTIONAL_GAP — uses existing `REFERENCE_DOCUMENTS_READ`
- **5C.3** (Default scope for files-tab read): DIRECTIONAL_GAP — default-scope behaviour determined client-side
- **5C.4** (`useFilesQuery` hook): PASS partial (exports `listFiles` function)
- **5D.1** (Tab strip with five tabs): PASS
- **5D.2** (`KnowledgeFilesTab.tsx` new file): PASS
- **5D.3** (`KnowledgeDocumentsTab.tsx` with mode chips, source labels, three-dots menu): DIRECTIONAL_GAP — three-dots menu not implemented
- **5D.4** (Always-available banner per spec §11.5): DIRECTIONAL_GAP — deferred to Chunk 7A
- **5D.5** (No partial document visibility): PASS

### Out of scope

- Chunk 5E (AddToKnowledgeModal, knowledgeApi extensions)
- Phase 6 (chunks 6A-6C)
- Phase 7 (chunks 7A-7D)

---

## 3. Mechanical fixes applied

None. Every gap requires a design decision (contract shape, ranking algorithm, telemetry storage boundary, permission model, or scope semantics) and is therefore directional. Mechanical fixes would have extended scope into design choices the spec does not unambiguously prescribe.

---

## 4. Directional gaps (routed to tasks/todo.md)

All 14 deferred items are appended to `tasks/todo.md` under the section *"Deferred from spec-conformance review — auto-knowledge-retrieval (2026-05-08)"*. Cross-reference IDs:

- AKR-CONF-1 — Retrieval contract shape diverges from spec §6.1/§6.2
- AKR-CONF-2 — Ranker omits bonuses + per-chunk vs best-of-chunk competition
- AKR-CONF-3 — `changeDocumentMode` not state-based
- AKR-CONF-4 — `retrieval.always_available.mode_changed` event emission missing
- AKR-CONF-5 — Five-tier candidate pool reduced to three tiers
- AKR-CONF-6 — Candidate-pool ordering is post-fetch JS sort, not SQL ORDER BY
- AKR-CONF-7 — `'observability'` criticality entry conflicts with boolean scheme
- AKR-CONF-8 — `embedding_provider_failed` degraded reason unreachable in v1
- AKR-CONF-9 — `agentRunPromptService` not refactored for `RetrievalResult`
- AKR-CONF-10 — `LOADING_MODE_DEPRECATED` guard missing on scheduledTasks routes
- AKR-CONF-11 — Files route param shape diverges from spec §5.6
- AKR-CONF-12 — Files-tab uses `REFERENCE_DOCUMENTS_READ` not new `knowledge:read`
- AKR-CONF-13 — Documents-tab three-dots menu not implemented
- AKR-CONF-14 — Always-available capacity banner deferred (spec §11.5 vs plan §5D)

---

## 5. Files modified by this run

- `tasks/todo.md` (appended deferred items section)
- `tasks/review-logs/spec-conformance-log-auto-knowledge-retrieval-2026-05-08T10-41-22Z.md` (this log)

No source code or schema files modified — every gap is directional.

---

## 6. Notes

- **Migration numbering deviation is acceptable.** Spec calls 0288/0289/0290/0291/0291a/0291b/0292/0293; implementation uses 0288/0289/0290/0291/0292/0293/0294. The plan's executor note authorises sequential renumbering against `migrations/`, and the original logical phase ordering is preserved (Phase 1 schema before Phase 4 cutover; promotion-audit lands with Phase 5A). Not flagged.
- **Spec source enum reservation.** Spec §4.4 names `auto_memory_approved` and `synthesised_by_agent` as reserved/future source values. Schema does not include them. Per spec §15 *Deferred items*, this is an explicit deferral. Not flagged.
- **Pure-test coverage matches the plan.** All four named pure-test files exist (`retrievalServicePure.test.ts`, `documentRetrievalServicePure.test.ts`, `documentChunkingServicePure.test.ts`, `retrievalObservabilityServicePure.test.ts`), including the spec §17 `shouldShowAlwaysAvailableWarning` boundary cases (29/29999/30/0/30000).
- **`getOrgScopedDb` vs `withOrgTx`.** Implementation uses request-scoped `getOrgScopedDb` rather than the explicit `withOrgTx` callback wrapper named in plan §1.5 #5. The two are RLS-equivalent in request context; behaviour outside requests (jobs invoking `assembleKnowledgeForRun`) would surface a missing org-id GUC. v1 only calls retrieval from `agentExecutionService` (request-scoped), so this is not flagged but could matter for future job-driven retrieval.
- **Step 0 TodoWrite list deferred to scratch.** This session has no `TodoWrite` tool exposed. Per-subcomponent verdicts are itemised in section 2 of this log; the per-chunk audit was performed serially.

---

## 7. Next step

**NON_CONFORMANT — 14 directional gaps must be addressed by the main session before `pr-reviewer`.** See `tasks/todo.md` § *Deferred from spec-conformance review — auto-knowledge-retrieval (2026-05-08)*.

The implementation is functionally cohesive and ships a working v1 — but the gaps materially diverge from spec §6.1/§6.2 contracts, §10.8 ranking semantics, §11.5 telemetry, §12 tenant model (5-tier vs 3-tier), and §7 permission model. Many are reasonable v1 simplifications that should be ratified by spec amendment rather than refactor; a few (AKR-CONF-3, AKR-CONF-10) are surgical fixes that would land cleanly. Before any of them is acted on, the main session should pick "amend spec vs change code" per item.

When that triage is complete, re-run `pr-reviewer` on the reconciled state.
