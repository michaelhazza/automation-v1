**Status:** LOCKED (chatgpt-plan-review round 2 approved — ready for build)
**Plan date:** 2026-05-08
**Author:** architect (Opus 4.7, 1M context)
**Build slug:** auto-knowledge-retrieval
**Source spec:** `tasks/builds/auto-knowledge-retrieval/spec.md` (frozen at commit `8a44844c`)
**Source brief:** `docs/auto-knowledge-retrieval-dev-brief.md` (Rev 4)
**Mockups:** `prototypes/auto-knowledge-retrieval/` (8 files, operator-approved across 5 rounds)
**Review history:** chatgpt-plan-review round 1 (2026-05-08) — APPROVED WITH TIGHTENINGS. Six high-priority tightenings (F1 transactional boundary, F2 candidate-pool ordering, F3 afterCommit enqueue, F4 last-N-runs window, F5 degraded-mode determinism, F6 migration numbering) and three medium-value improvements (M1 chunk-size config ownership, M2 cosine-only metric, M3 no partial document visibility) applied. Each elevated to a load-bearing invariant in §1.5 (items 9–15) and pinned in the corresponding chunk's contract block; new risks 9–15 added in §3.

# Auto Knowledge Retrieval — Implementation Plan

This plan decomposes the frozen architecture spec into builder-session-sized chunks for Phase 2 of the three-coordinator pipeline. The chunked plan preserves the spec's seven-phase ordering verbatim; no chunk straddles a phase boundary, no chunk forward-references a primitive introduced later.

---

## Contents

- Model-collapse check
- Section 1 — Architecture notes
  - 1.1 Phase-ordering preservation
  - 1.2 Primitives reused (spec §3.1)
  - 1.3 Primitives extended (spec §3.2)
  - 1.4 Primitives invented (spec §3.3)
  - 1.5 Load-bearing invariants the plan must preserve verbatim
  - 1.6 Risks (top-level — see Section 3 for full list)
- Section 2 — Implementation plan, chunked
  - Phase 1 — Schema + RLS foundation (Chunks 1A–1E)
  - Phase 2 — Shared retrieval engine (Chunks 2A–2D)
  - Phase 3 — Document ingestion + re-embedding (Chunks 3A–3E)
  - Phase 4 — Retrieval integration + observability emission (Chunks 4A–4D)
  - Phase 5 — UI: Knowledge tabs + Add-to-Knowledge (Chunks 5A–5E)
  - Phase 6 — UI: Agent Data Sources + Document Detail + Bundles (Chunks 6A–6C)
  - Phase 7 — Retrieval observability surfaces (Chunks 7A–7D)
- Section 3 — Risks-and-mitigations
- Section 4 — Dependency graph
- Executor notes

---

## Model-collapse check

The three frontier-multimodal collapse questions:

1. **Does this feature decompose into ingest -> extract -> transform -> render?** Partly. Document promotion (file -> document) and re-embedding (text -> chunks -> embeddings) look pipeline-shaped. Per-run retrieval is decidedly not — it is a low-latency authorization-then-rank step on the agent run hot path.
2. **Could each step run as a single frontier multimodal call?** No for the ranker (cosine + scope-bonus + threshold + budget cap is deterministic by spec §10.8 and replay-stable; an LLM call would inject non-determinism into a load-bearing invariant). No for chunking-and-embedding (must reuse the existing `text-embedding-3-small` provider per §1.2, and the bounded-payload contract requires byte-identical replays). Maybe for summarisation, which is genuinely a one-shot LLM call — but the spec already names it as a single LLM call (`document:summarise`), so there is nothing to collapse.
3. **Could the whole pipeline collapse to one model call?** Rejected. Retrieval-quality and tenant-isolation invariants (§7.1, §10.8, §11.4, §12, §13.1) are deterministic, replay-stable, and authorization-before-retrieval. None of those are properties a single multimodal call can guarantee. The spec author already considered the obvious extensions and pinned them as load-bearing invariants — collapsing to a single LLM call would violate every one.

**Decision: reject collapse.** The pipeline is not "do five LLM things in sequence", it is "use deterministic ranking on RLS-scoped candidates, with two narrow LLM-bounded steps (summarisation, embedding) that already match the obvious frontier-call boundary". Keep the architecture as specified.

---

## Section 1 — Architecture notes

### 1.1 Phase-ordering preservation

The chunked plan respects the seven-phase dependency graph from spec §9 verbatim. No chunk in Phase N depends on a primitive introduced in Phase N+1. Intra-phase chunks are ordered so each chunk's prerequisites land in an earlier chunk of the same phase.

```
Phase 1  ->  Phase 2  ->  Phase 3  ->  Phase 4  ->  Phase 5  ->  Phase 6  ->  Phase 7
schema       pure         ingest       agent-run    UI tabs       UI agent      observability
+ RLS        ranker       jobs         + emission   + promote     data sources  surfaces
```

Phase 4 is the only cross-cutting phase (agent-run integration). Everything else stages independently after its prerequisites land.

### 1.2 Primitives reused (spec §3.1)

These primitives are consumed without modification. Plan chunks call into them; no chunk extends them:

- `withOrgTx` / `withAdminConnection` (every retrieval read; promotion transaction).
- `withBackoff` (OpenAI embedding calls).
- `createWorker` (all three new pg-boss queues).
- `referenceDocumentVersionsTable` (immutable version chain, retained as-is).
- `documentBundles*` schema (no behaviour change; bundles remain organisational).
- `executionFiles` table (read-only Files tab; durability flip is on the row but column shape unchanged).
- `RLS_PROTECTED_TABLES` manifest (new entries in same migration as new tables).
- `verify-rls-coverage.sh` / `verify-rls-contract-compliance.sh` (CI-side).
- OpenAI `text-embedding-3-small` + pgvector (no new provider).

### 1.3 Primitives extended (spec §3.2)

These primitives gain a column or argument; no chunk introduces a parallel primitive.

- `reference_documents` — new columns: `mode`, `summary`, `summary_stale`, `summary_generated_at`, `last_chunked_at`, `active_embedding_model`, `retrieval_version_id`. Owned by Chunk 1A.
- `memory_blocks` — new nullable column `scheduled_task_id`. Owned by Chunk 1D.
- `agent_data_sources` — `loading_mode` retired in Phase 4 (Chunk 4D).

**Why-not-reuse decisions confirmed during plan decomposition:**

- We considered putting `mode` on the link row (`reference_document_data_sources`) instead of the document. Rejected — spec §6.4 declares mode is a property of the document, not the link, and mode-change semantics (apply across every scope) would be wrong if the column lived on the link.
- We considered using `document_bundle_attachments` as the link table for direct attachment by synthesising a single-document bundle. Rejected — spec §3.3.2 explicitly forbids it; bundles must remain organisational, not retrieval-altering.
- We considered putting the Phase 4 retiring of `loading_mode` into a single migration with the schema additions in Phase 1. Rejected — spec §5.1 requires the drop to land AFTER the read-path cutover ships (Phase 4 cutover Chunks 4B/4C). One migration cannot atomically span both sides of the cutover; two migrations are mandatory.

### 1.4 Primitives invented (spec §3.3)

Three new primitives, each named in the spec with a "why-not-reuse" justification. The plan introduces no fourth primitive.

- `reference_document_chunks` (new table) — Chunk 1B.
- `reference_document_data_sources` (new join table with five-tier scope) — Chunk 1C.
- `retrievalServicePure` (new pure-function ranker, generic over `RetrievalCandidate`) — Chunk 2A.

Plus three supporting primitives the spec names in §5 but treats as scaffolding for the three above:

- `document_promotion_audit` (audit-ledger table, idempotency anchor) — Chunk 5A.
- `retrievalService` (DB-backed surface; consumes `retrievalServicePure`) — Chunk 4A.
- `retrievalObservabilityService` (event emitter + bounded-payload contract + always-available threshold constants) — Chunk 4A (emission), Chunk 7A (read aggregates).

These three are not new primitives in the spec-§3 sense (they are thin wrappers around the named primitive plus existing primitives like `agent_execution_events` and `withOrgTx`); they are listed for plan-clarity only.

### 1.5 Load-bearing invariants the plan must preserve verbatim

The plan was decomposed to keep each invariant in a single chunk wherever possible, so review is local and regressions are obvious.

1. **Ranking determinism comparator chain** (`finalScore DESC, scopeTier DESC, updatedAt DESC, id ASC`) and best-of-chunk document relevance (spec §10.8). Lives in Chunk 2A; pinned by `retrievalServicePure.test.ts`.
2. **Retrieval-version completeness** — chunking job MUST NOT flip `retrieval_version_id` until full chunk set exists for `active_embedding_model` (spec §13.1). Lives in Chunk 3C; pinned by `documentRetrievalServicePure.test.ts` (rejects any tuple whose chunk count is below the version's expected total).
3. **Bounded observability payload contract** — deterministic top-N truncation, constants in `retrievalObservabilityService` (spec §11.4). Lives in Chunk 4A; pinned by a Pure-test that asserts byte-identical payload from two replays of the same input.
4. **Two-pointer split** — `current_version_id` (content) flips on save; `retrieval_version_id` (retrieval) flips after chunking commits (spec §13.1, §6.4). Schema split lands in Chunk 1A; pointer-flip semantics in Chunk 3C; read-side correctness in Chunk 2C.
5. **Authorization-before-retrieval** — candidate pool is RLS-scoped before ranking; the ranker never sees rows it shouldn't have (spec §7.1, §12). Lives in Chunk 4A (`retrievalService.buildCandidatePool` builds the five-tier UNION inside `withOrgTx`); defence-in-depth assertion in Chunk 2A.
6. **Exactly-one scope tier per `reference_document_data_sources` row** — CHECK at table level; organisation tier = all FK columns NULL (spec §4.1). Lives in Chunk 1C.
7. **Exactly-one `retrieval.summary` event per run** — partial unique index `(run_id) WHERE event_type = 'retrieval.summary'` on `agent_execution_events` (spec §10.4). Lives in Chunk 4A (migration `0291b` ships in same chunk as the emitter).
8. **Always-available preventive telemetry constants** — `doc_count >= 30`, `token_cost >= 30000` live in `retrievalObservabilityService` (spec §11.5). Lives in Chunk 4A (constants), surfaced in UI in Chunk 5D (banner) and Chunk 7D.
9. **Embedding provider calls run OUTSIDE `withOrgTx`** — wrapping OpenAI calls inside a long-lived DB transaction causes lock amplification, connection starvation, and retry instability. The chunking job structure is: pure chunking + embedding I/O OUTSIDE the transaction; only persistence + chunk-count verification + atomic pointer flip INSIDE the transaction. Lives in Chunk 3C; same shape applies to Chunk 3D's re-embed sweep.
10. **Candidate-pool deterministic ordering before ranking** — the SQL-side five-tier UNION applies `scope_tier DESC, updated_at DESC, id ASC` before mapping into `RetrievalCandidate[]`. Even though the pure ranker re-sorts, stabilising the upstream pool removes replay ambiguity and prevents future "top-N before rank" optimisations from silently becoming nondeterministic. Lives in Chunk 4A.
11. **`afterCommit`-only job enqueue** — pg-boss enqueueing inside any `withOrgTx` callback is FORBIDDEN. Jobs MUST be queued strictly after the transaction commits. Without this, a rolled-back transaction leaves orphan jobs that run against rows that never existed; a queued promotion-finalise can run before the audit row is visible; retrieval-version pointer flips become unobservable to chained workers. Lives in Chunks 3E (version-write enqueue), 3C (promotion-finalise chain), 5A (promotion enqueue).
12. **Stable "last N runs" replay window** — every aggregate query in `retrievalAggregatesService` MUST: (a) include only terminal runs (status in the closed set `{'succeeded','failed','cancelled'}`); (b) order by `completed_at DESC, id DESC`; (c) count retries as distinct runs unless an explicit superseded-by pointer says otherwise; (d) exclude soft-deleted runs; (e) apply the window BEFORE aggregation (window-then-aggregate, never aggregate-then-window). Without this, "Loaded in N of last 30 runs" drifts across surfaces. Lives in Chunk 7A.
13. **Deterministic degraded-mode `retrieval.summary` shape** — when retrieval fails (pool query, embedding lookup, ranker error), the emitted event MUST carry `loaded: []`, `alwaysAvailable: []`, `referenceOnlyManifest: []`, `degraded: true`, and `degradedReason` from a closed enum (`'pool_query_failed' | 'embedding_provider_failed' | 'rank_failed' | 'unknown'`). This distinguishes "retrieval failed" from "nothing matched" — the difference is analytically load-bearing (downstream metrics treat the two cases differently and cannot recover the distinction post-hoc). Lives in Chunk 2A (type) + Chunk 4A (emission).
14. **Cosine distance is the only embedding similarity metric** — every embedding-related index, query, ranker comparator input, and provider call uses cosine distance. Mixing dot-product / Euclidean / L2 across embedding generations is FORBIDDEN; future embedding-model upgrades MUST preserve cosine semantics. Lives in Chunk 1B (HNSW operator class), Chunk 2A (ranker), Chunk 3A (provider call), Chunk 4A (candidate-pool query).
15. **No partial document visibility in UI** — operator-facing surfaces MUST NOT display document-level retrieval-readiness states (`'embedded' | 'indexed' | 'ready'`) until `retrieval_version_id` is non-null. The operator-visible signal for documents is the same as for files: a "durable" badge backed by audit-row presence (spec §4.6) — that signal reflects the inline-transaction commit, NOT the chunking job's progress. Showing "ready" before the pointer flips creates phantom-ready documents that retrieval will not actually load. Lives in Chunks 5D, 6A, 6B, 6C.

### 1.6 Risks (top-level — see Section 3 for full list with mitigations)

- **Race during version write + chunking**: a content read between save (step 1 of §13.1) and pointer flip (step 6 of §13.1) must not return stale chunks. Mitigated by always reading via `retrieval_version_id`, never via `current_version_id`, for retrieval. Plan keeps the two pointers in separate chunks of code.
- **RLS coverage gap**: the two new tenant-scoped tables (`reference_document_chunks`, `reference_document_data_sources`) require manifest entries in the same migration. Plan keeps manifest edits paired with each table-introducing chunk (1B, 1C).
- **Payload growth**: `retrieval.summary` events written into `agent_execution_events` (canonical storage per §6.7) can bloat the ledger if unbounded. Mitigated by §11.4 deterministic truncation; pinned with a Pure-test in Chunk 4A.
- **Observability emission point fragility**: emission must happen exactly once per run, at run end, even if the run finalisation path retries. Mitigated by the partial unique index in `0291b` (catch `23505`, treat as idempotent hit).
- **Cutover safety on Phase 4 retiring `loading_mode`**: dropping a column the running code might still read causes a hard crash. Mitigated by ordering the drop migration (`0293`) AFTER the read-path cutover commits — Chunk 4D runs only after Chunks 4B/4C land.
- **Three-pointer confusion**: `current_version_id`, `retrieval_version_id`, `active_embedding_model` are three distinct pointers on `reference_documents`. Plan flags this in Chunk 1A's contract block and pins read-path semantics in Chunk 2C tests.

---

## Section 2 — Implementation plan, chunked

> **Global invariant — migration numbering.** Migration numbers in this plan (`0288`–`0293`, plus `0291a` and `0291b`) are illustrative. The builder MUST renumber sequentially against `migrations/` at implementation time; if another branch landed a migration in the interim, the chunk renames the file and references in the same commit. Cross-phase ordering semantics in this plan are LOGICAL (Phase N migrations run before Phase N+1), not tied to the numeric suffixes. Reviewers must NOT treat numeric ordering as architecturally meaningful.

### Phase 1 — Schema + RLS foundation

Phase 1 ships schema, Drizzle types, RLS manifest entries, and CHECK constraints. No service code. Each chunk is ≤2 files of code change plus its migration; review is local.

#### Chunk 1A — `reference_documents` modes + summary + retrieval-version pointer

**Phase:** 1
**spec_sections:** 5.1 (migration `0288`), 4.5, 6.4 (precedence table), 13.1 (two-pointer split)
**Files:**
- `migrations/0288_reference_document_modes_and_summary.sql` (new — verify next-free number against `migrations/` at commit time; today `0287` is the highest landed migration)
- `server/db/schema/referenceDocuments.ts` (modify — add columns)

**Contracts (file-level):**
- Migration adds columns: `mode` (text, NOT NULL, DEFAULT `'auto'`, CHECK in (`'auto'`, `'always_available'`, `'reference_only'`)), `summary` (text, nullable), `summary_stale` (boolean, NOT NULL, DEFAULT `false`), `summary_generated_at` (timestamptz, nullable), `last_chunked_at` (timestamptz, nullable), `active_embedding_model` (text, nullable, will be backfilled by Phase 3), `retrieval_version_id` (uuid, nullable, FK to `reference_document_versions.id`). Closed-enum CHECK on `mode` blocks new values without a spec amendment (per dev-guidelines §8.13 + §8.16).
- Drizzle schema gains the columns; the `ReferenceDocumentMode` type literal union is exported and pinned closed.
- **Three-pointer contract (preserve in code comments, dev-guidelines §8.13):** `current_version_id` is the *content* pointer (flips on save); `retrieval_version_id` is the *retrieval* pointer (flips after chunking commits per spec §13.1); `active_embedding_model` is the *embedding-generation* pointer (flips per-document after re-embed sweep per spec §13.3). Three pointers, three flip sites, three different code paths.

**Dependencies:** none.

**Error-handling strategy:** pure DDL; transactional. No application-layer error handling at this chunk. Migration is reversible (down file drops the same columns).

**Tests (Pure only):** none authored by this chunk (no pure functions added).

#### Chunk 1B — `reference_document_chunks` table + RLS manifest

**Phase:** 1
**spec_sections:** 5.1 (migration `0289`), 4.5, 7 (RLS checklist), 10.6 (unique-constraint mapping)
**Files:**
- `migrations/0289_reference_document_chunks.sql` (new)
- `server/db/schema/referenceDocumentChunks.ts` (new)
- `server/db/schema/index.ts` (modify — re-export the new table)
- `server/config/rlsProtectedTables.ts` (modify — add `reference_document_chunks` entry)

**Contracts (file-level):**
- Table columns: `id` (uuid PK), `organisationId` (uuid NOT NULL, denormalised from parent for RLS-policy locality per spec §12), `document_id` (uuid NOT NULL FK), `version_id` (uuid NOT NULL FK to `reference_document_versions.id`), `chunk_index` (int NOT NULL), `embedding_model` (text NOT NULL), `embedding` (vector(1536)), `content` (text NOT NULL), `token_count` (int NOT NULL), `created_at`, `updated_at` timestamps, `deleted_at` (timestamptz, nullable, soft-delete).
- Unique index: `(version_id, chunk_index, embedding_model)` (idempotency key; matches §10.1 / §10.6 / §13.3 — supports re-embedding sweep without collision).
- HNSW index on `embedding` column (cosine distance operator class — `vector_cosine_ops`), per existing memory-block pattern. **Cosine distance is the ONLY similarity metric used across this build** (spec invariant §1.5 #14): every index, query, ranker comparator input, and provider call uses cosine semantics. Future embedding-model upgrades MUST preserve cosine; introducing dot-product or Euclidean would silently corrupt mixed-generation candidate pools.
- RLS policy: parent-policied (FK-walked through `reference_documents`); FORCE RLS enabled; manifest entry added in same migration.
- Drizzle schema mirrors the migration. Soft-delete via `deletedAt`; reads always filter `isNull(table.deletedAt)` per dev-guidelines §8.27.

**Dependencies:** Chunk 1A (parent table has the new columns).

**Error-handling strategy:** unique-violation `23505` on `(version_id, chunk_index, embedding_model)` is idempotent-hit (200 with `{ noop: true }`) per spec §10.6; never bubbled to operators (job context only).

**Tests (Pure only):** none authored by this chunk.

#### Chunk 1C — `reference_document_data_sources` join table + scope CHECK + RLS manifest

**Phase:** 1
**spec_sections:** 5.1 (migration `0290`), 4.1 (scope CHECK), 7 (RLS checklist), 10.3 (race guard), 10.6 (unique-constraint mapping)
**Files:**
- `migrations/0290_reference_document_data_sources.sql` (new — verify next-free number at plan time, increment if other branches landed)
- `server/db/schema/referenceDocumentDataSources.ts` (new)
- `server/db/schema/index.ts` (modify — re-export)
- `server/config/rlsProtectedTables.ts` (modify — add manifest entry)

**Contracts (file-level):**
- Table columns: `id` (uuid PK), `organisationId` (uuid NOT NULL), `document_id` (uuid NOT NULL FK), four nullable scope FK columns (`subaccount_id`, `agent_id`, `scheduled_task_id`, `task_instance_id`), `created_at`, `updated_at`, `deleted_at`.
- **Scope-tier CHECK constraint** (named explicitly per spec §4.1): exactly zero or one of (`subaccount_id`, `agent_id`, `scheduled_task_id`, `task_instance_id`) is non-NULL. Organisation tier = all four NULL. The CHECK names the four FK columns explicitly so a future tier addition is a deliberate spec amendment, not an emergent shape.
- Unique partial index supporting the §10.6 idempotency posture and the 409 mapping for already-linked. Implementation note: the partial unique should match the spec §10.7 "soft-delete model" — `WHERE deleted_at IS NULL` — and key on `(document_id, subaccount_id, agent_id, scheduled_task_id, task_instance_id)` with NULLs distinct semantics (or per-tier partial uniques if NULLs-distinct gives the wrong shape; choose at migration write time, document the choice in the migration comment).
- Per-tier partial indexes (each tier-specific FK has its own `WHERE col IS NOT NULL` index) to keep query plans small.
- RLS policy: direct org-isolation (organisation_id on every row); FORCE RLS; manifest entry in same migration.

**Dependencies:** Chunk 1A (document FK).

**Error-handling strategy:** unique-violation `23505` -> 409 Conflict with `{ error: "DOCUMENT_ALREADY_LINKED", existingLinkId }` per spec §10.6. Mode-change idempotency is state-based (predicate `WHERE mode <> :new_mode`), classified safe per §10.2.

**Tests (Pure only):** none authored by this chunk.

#### Chunk 1D — `memory_blocks.scheduled_task_id` (recurring-task scope)

**Phase:** 1
**spec_sections:** 5.1 (migration `0291`), 4.2 (four-tier model), 7 (no new RLS work — parent table FORCE RLS covers)
**Files:**
- `migrations/0291_memory_blocks_scheduled_task_scope.sql` (new)
- `server/db/schema/memoryBlocks.ts` (modify — add column)

**Contracts (file-level):**
- Column: `scheduled_task_id` (uuid, nullable, FK to `scheduled_tasks.id`, ON DELETE SET NULL).
- Partial index: `(scheduled_task_id) WHERE scheduled_task_id IS NOT NULL`.
- No RLS work needed (parent table already covered; same policy filters new column).

**Dependencies:** none.

**Error-handling strategy:** none.

**Tests (Pure only):** none authored by this chunk.

#### Chunk 1E — Phase 1 closeout (Drizzle barrel + RLS manifest sweep)

**Phase:** 1
**spec_sections:** 5.2, 7
**Files:**
- `server/db/schema/index.ts` (final pass — confirm 1B + 1C re-exports landed cleanly)
- `server/config/rlsProtectedTables.ts` (final pass — confirm 1B + 1C manifest entries)

**Contracts (file-level):** Defensive consolidation. If 1B and 1C kept their barrel + manifest edits clean, this chunk is a no-op review-only step (drop from plan if so). Default to landing it as a separate review point so the gate `verify-rls-coverage.sh` runs in CI against the consolidated state.

**Dependencies:** Chunks 1B, 1C.

**Error-handling strategy:** none.

**Tests (Pure only):** none.

**Why-not-reuse note:** Not a new primitive — Phase 1 closeout. If 1B / 1C left the barrel and manifest in a clean state already, this chunk drops out at commit time.

---

### Phase 2 — Shared retrieval engine (pure functions)

Phase 2 introduces the generic ranker and the document-side filter logic. All work is pure-function. The existing `memoryBlockRetrievalServicePure` is refactored to delegate ranking; its block-specific filter logic (priority, divergence, ownerAgent) stays.

#### Chunk 2A — `retrievalServicePure` extraction + comparator chain

**Phase:** 2
**spec_sections:** 3.3.3, 6.1, 6.2, 6.3, 10.8 (comparator chain + best-of-chunk), 11.4 (deterministic truncation), 12.5 (defence-in-depth)
**Files:**
- `shared/types/retrieval.ts` (new — `RetrievalCandidate`, `RetrievalResult`, `RetrievalRejectionReason`, `RetrievalMode`)
- `server/services/retrievalServicePure.ts` (new)
- `server/services/retrievalServicePure.test.ts` (new)

**Contracts (file-level):**
- `shared/types/retrieval.ts` exports the four shapes from spec §6.1–§6.3 verbatim. `RetrievalRejectionReason` is closed (`'budget_exhausted' | 'lower_score_in_tie' | 'mode_excluded' | 'authorization_filtered' | 'below_threshold'`); `RetrievalMode` is closed (`'auto' | 'always_available' | 'reference_only'`).
- **Run-level degraded-mode fields on `RetrievalResult` (spec invariant §1.5 #13):** `degraded: boolean` and `degradedReason: RetrievalDegradedReason | null`, where `RetrievalDegradedReason` is a new closed enum exported from this module: `'pool_query_failed' | 'embedding_provider_failed' | 'rank_failed' | 'unknown'`. When `degraded === true` the emitter MUST set `loaded`, `alwaysAvailable`, and `referenceOnlyManifest` to `[]` (Chunk 4A pins the emission contract). When `degraded === false`, `degradedReason` MUST be `null`. This distinguishes "retrieval failed" from "nothing matched" — the two cases are operationally and analytically distinct and cannot be recovered post-hoc.
- `retrievalServicePure.ts` exports a single function: `rankCandidates(input: { candidates: RetrievalCandidate[]; threshold: number; budgetTokens: number; nowMs: number; orgId: string; runContext: { runId: string; agentId: string; subaccountId: string | null; scheduledTaskId: string | null; taskInstanceId: string | null } }): RetrievalResult`. Pure: no DB, no I/O, no `Date.now()` (clock injected via `nowMs`), no random.
- **Comparator chain (spec §10.8 verbatim, named in code constants):** stable sort by `finalScore DESC, scopeTier DESC, updatedAt DESC, id ASC`. The `id ASC` tiebreaker is the determinism anchor (per dev-guidelines §8.17).
- **Best-of-chunk relevance (spec §10.8 verbatim):** when ranking documents alongside memory blocks, `document.finalScore = MAX(chunk.finalScore for chunks of that document)`. Other chunks of the same document carry their own scores but do not contribute additional ranking weight.
- **Defence-in-depth (spec §12.5):** at function entry, filter candidates by `candidate.organisationId === input.orgId`; mismatched candidates are dropped silently as a programmer-error case (matches existing `memoryBlockRetrievalServicePure` posture).
- Truncation values are constants exported from this file: `MAX_REJECTED_ABOVE_THRESHOLD = 50`, `MAX_REJECTED_BELOW_THRESHOLD_SAMPLE = 20`, `MAX_REJECTED_MODE_EXCLUDED = 50`. Lives here so Chunk 4A's `retrievalObservabilityService` re-exports the same constants — single source of truth.

**Dependencies:** none from Phase 2 (Chunk 2A is the seed). Reads schema columns introduced in Phase 1 only via `shared/types/retrieval.ts`; runtime decoupled.

**Error-handling strategy:** pure function; no errors thrown for normal inputs. Programmer-error inputs (mismatched orgId, malformed embedding length) drop the candidate silently and increment a pure counter on the result for the defence-in-depth test to assert.

**Tests (Pure only — `retrievalServicePure.test.ts`):**
- Comparator chain: identical-score-and-updatedAt candidates produce deterministic order by `id` ASC.
- Best-of-chunk: a document with one high-scoring chunk + ten low-scoring chunks does NOT outrank a single high-scoring memory block.
- Threshold filtering: candidates below threshold appear in `rejected.belowThreshold.count` and (when in top-20) in `rejected.belowThreshold.sample`.
- Budget cap: candidates above threshold but past budget appear in `rejected.aboveThreshold` with `reason='budget_exhausted'`.
- Truncation determinism: 100 candidates above threshold produce a 50-item `rejected.aboveThreshold` array with truncation indicator `{ total: 100, retained: 50 }`; two replays of the same input produce byte-identical arrays.
- Defence-in-depth: ranker filters mixed-org candidates by `organisationId` (cross-tenant safety, spec §12.5).
- Closed-enum rejection: a candidate with `kind: 'invalid'` (TS-impossible but JSON-possible) is dropped at runtime per dev-guidelines §8.13.

**Why-not-reuse note:** spec §3.3.3 already names this as a new primitive. The existing `memoryBlockRetrievalServicePure` is memory-block-specific (priority enum, divergence flags, ownerAgent semantics). Extracting the generic part into a polymorphic `RetrievalCandidate` ranker preserves block-specific logic where it belongs (Chunk 2B) and concentrates the comparator chain + best-of-chunk + truncation in one place. Future cross-encoder re-ranking, learned thresholds, and new knowledge primitives all benefit from one ordering, not several.

#### Chunk 2B — `memoryBlockRetrievalServicePure` refactor (delegate to ranker)

**Phase:** 2
**spec_sections:** 3.1 (existing primitive), 3.3.3 (refactor target), 5.4
**Files:**
- `server/services/memoryBlockRetrievalServicePure.ts` (modify — keep block-specific filtering, delegate ranking)
- `server/services/memoryBlockRetrievalServicePure.test.ts` (modify if it exists, or extend — pin existing block-specific behaviour against the new delegation)

**Contracts (file-level):**
- The existing `rankByPrecedencePure(input)` function continues to exist and continues to return the same ranked-blocks shape it returns today (no caller-visible contract change). Internally:
  1. Filter out paused / deprecated blocks (block-specific, kept in this file).
  2. Compute scope-specificity tier per block (block-specific tier semantics, kept in this file).
  3. Map each block to a `RetrievalCandidate` with `kind: 'memory_block'`, mapping `priority` and `isAuthoritative` onto the candidate.
  4. Call `rankCandidates(...)` from `retrievalServicePure.ts` for the comparator chain.
  5. Map the ranked candidates back to the `MemoryBlockRow[]` return shape.

**Dependencies:** Chunk 2A.

**Error-handling strategy:** unchanged from existing function (pure; no errors thrown).

**Tests (Pure only):** existing block-specific test cases continue to pass byte-identically. New test pinning that the comparator chain delegation does not regress paused/deprecated filtering or authoritative-tier-first semantics.

**Why-not-reuse note:** N/A (this is the existing primitive being refactored, not a new one).

#### Chunk 2C — `documentRetrievalServicePure` (mode resolution + version pinning + chunk grouping)

**Phase:** 2
**spec_sections:** 4.3 (mode), 4.5 (chunks), 6.4 (precedence: retrieval-version + active-model), 13.1 (retrieval-version completeness invariant)
**Files:**
- `server/services/documentRetrievalServicePure.ts` (new)
- `server/services/documentRetrievalServicePure.test.ts` (new)

**Contracts (file-level):**
- Exports two functions:
  1. `filterDocumentChunks(input: { chunks: DocumentChunkRow[]; documents: ReferenceDocumentRow[]; activeEmbeddingModelByDocId: Map<string, string>; retrievalVersionByDocId: Map<string, string>; expectedChunkCountByVersionId: Map<string, number> }): DocumentChunkRow[]` — returns chunks where `chunk.versionId === retrievalVersionByDocId.get(chunk.documentId)` AND `chunk.embeddingModel === activeEmbeddingModelByDocId.get(chunk.documentId)`. Mode-excluded documents (`mode === 'reference_only'`) are filtered out at this step.
  2. `groupCandidatesByDocument(rankedCandidates, candidatesByDocumentId): RetrievalResult['loaded']` — collapses chunk-level candidates into document-level result rows (best-of-chunk).
- **Retrieval-version completeness check (spec §13.1 invariant):** the function MUST NOT return any candidate whose document has `retrieval_version_id` pointing at a version where the chunk count for `active_embedding_model` is below the version's `expectedChunkCountByVersionId` total.

**Dependencies:** Chunk 2A.

**Error-handling strategy:** pure function; programmer-error inputs (missing pointer mappings) cause the document to be filtered out (defensive; never throws).

**Tests (Pure only — `documentRetrievalServicePure.test.ts`):**
- Mode resolution: `reference_only` documents excluded; `auto` and `always_available` included.
- Version pinning: chunks with `versionId !== retrievalVersionByDocId.get(documentId)` are dropped.
- Active-model pinning: chunks with `embeddingModel !== activeEmbeddingModelByDocId.get(documentId)` are dropped.
- **Retrieval-version completeness invariant (spec §13.1, hard):** a document whose `retrieval_version_id` points at a version with fewer chunks than the expected total is rejected (zero candidates returned for that document); test asserts the function does NOT return half-embedded generations.
- Best-of-chunk grouping: a document with three chunks scoring `[0.8, 0.7, 0.6]` produces a single document-level row with `finalScore = 0.8`, `chunkIds = [chunk1, chunk2, chunk3]` (all loaded).

**Why-not-reuse note:** N/A (this is a complement to `retrievalServicePure`; both are spec §3.3.3 named primitives).

#### Chunk 2D — `documentChunkingServicePure` (boundary heuristics)

**Phase:** 2
**spec_sections:** 4.5 (chunk semantics), 5.3, 18.1 (default chunk size 512 tokens, 64 overlap — defaultable)
**Files:**
- `server/services/documentChunkingServicePure.ts` (new)
- `server/services/documentChunkingServicePure.test.ts` (new)

**Contracts (file-level):**
- Exports: `chunkDocument(input: { content: string; targetTokens?: number; overlapTokens?: number }): Array<{ chunkIndex: number; content: string; tokenCount: number }>`. Defaults declared as exported constants `DEFAULT_CHUNK_TARGET_TOKENS = 512`, `DEFAULT_CHUNK_OVERLAP_TOKENS = 64` (spec §18 question 1).
- **Chunk-size config ownership:** `documentChunkingServicePure.ts` is the single source of truth for these defaults. Job handlers (Chunk 3C `documentChunkEmbedJob`, Chunk 3D `documentReembedJob`) capture the effective values at job-execution start and treat them as **runtime-immutable per job execution** — a config change mid-job MUST NOT split chunks across two heuristics. The captured values are persisted in the job payload audit trail and surfaced in the `retrieval.summary` event payload (Chunk 4A `chunkConfig: { targetTokens, overlapTokens }`) so replay and debugging can reconstruct the heuristic used. Per-org overrides are explicitly out of scope for v1.
- Boundary detection: paragraph-aligned, then sentence-aligned, then byte-windowed only as last resort (spec §4.5 — "semantically coherent, not byte-windowed").
- Token counting uses the existing token-count helper from the LLM-router area (no new tokeniser primitive).

**Dependencies:** none.

**Error-handling strategy:** pure; degenerate inputs (empty content, content shorter than `targetTokens`) return a single chunk or an empty array deterministically.

**Tests (Pure only — `documentChunkingServicePure.test.ts`):**
- Very short doc (≤ targetTokens): single chunk, `chunkIndex = 0`.
- Very long doc (>> targetTokens): multiple chunks, monotonically increasing `chunkIndex`, total reconstructable.
- Paragraph-aligned boundary preferred over sentence-aligned over byte-windowed.
- Overlap correctness: chunk N+1 starts within the last `overlapTokens` of chunk N.
- Edge case: mixed content (long unbroken text without paragraph markers) falls back gracefully.

---

### Phase 3 — Document ingestion + re-embedding

Phase 3 introduces three pg-boss workers, the embedding wrapper, and the document/data-source CRUD layer. One chunk per worker per spec §3 review-clarity guidance.

#### Chunk 3A — `documentEmbeddingService` (OpenAI embedding wrapper)

**Phase:** 3
**spec_sections:** 5.3, 8 (queued embedding), 8.1 (idempotency `(version_id, chunk_index, embedding_model)`), 13.3 (embedding-model upgrade)
**Files:**
- `server/services/documentEmbeddingService.ts` (new)

**Contracts (file-level):**
- Exports `embedChunks(chunks: Array<{ versionId: string; chunkIndex: number; content: string; embeddingModel: string }>): Promise<Array<{ versionId: string; chunkIndex: number; embeddingModel: string; embedding: number[] }>>`. **`embedChunks` is an I/O-only function — it returns embedding vectors and does NOT write to the database.** Callers (Chunks 3C and 3D) own the persist step inside their own `withOrgTx` transaction, after embedding I/O completes.
- Wraps OpenAI calls in `withBackoff` (existing primitive). Retry classification per dev-guidelines §8.10: external-call ordering preserved — `withBackoff` runs outside the caller's `withOrgTx` (see Chunk 3C transactional-boundary invariant).
- Callers persist the returned embeddings using `INSERT ... ON CONFLICT (version_id, chunk_index, embedding_model) DO NOTHING` inside their own transaction (idempotency-safe per spec §10.1, §10.6).

**Dependencies:** Chunk 1B (chunks table); Chunk 2A (no direct dep, but the candidate shape consumes the embedding column).

**Error-handling strategy:** OpenAI 429 / 5xx routed through `withBackoff`; permanent errors throw `{ statusCode: 502, errorCode: 'EMBEDDING_PROVIDER_ERROR' }`. Unique-violation `23505` on the persist INSERT is handled by the calling worker (Chunks 3C / 3D), not by `embedChunks` itself — the function has no DB contact.

**Tests (Pure only):** none authored by this chunk (the function is I/O-bound; no pure split required).

#### Chunk 3B — `document:summarise` worker

**Phase:** 3
**spec_sections:** 5.3, 5.5, 8 (queued), 8.1 (idempotency `(document_id, version_id)`)
**Files:**
- `server/services/documentSummariseService.ts` (new)
- `server/jobs/documentSummariseJob.ts` (new)

**Contracts (file-level):**
- Worker registered via `createWorker('document:summarise', handler)`.
- Handler: reads the new `reference_document_versions` row, runs cheap-LLM summarisation, writes `reference_documents.summary` + `summary_generated_at` + sets `summary_stale = false` inside `withOrgTx`. Idempotent via `(document_id, version_id)` predicate (job no-ops if `summary_generated_at >= version.created_at`).
- Failure: leave `summary_stale = true` for the next sweep (no retry storm). pg-boss retries with backoff; final failure surfaces in the run trace via existing job-failure telemetry.

**Dependencies:** Chunk 1A (summary columns); Chunk 3A is independent (no embedding dep).

**Error-handling strategy:** LLM provider errors retried via pg-boss backoff (default 3 attempts). Permanent errors logged; the version remains `summary_stale: true` and the next mode-change or sweep re-enqueues.

**Tests (Pure only):** if the summarisation prompt-construction logic is non-trivial enough to warrant pure-extraction, split a `documentSummariseServicePure.ts` and pin the prompt shape there; otherwise no Pure-test (per dev-guidelines §7 `runtime_tests: pure_function_only`, the wet job-handler is gate-only).

#### Chunk 3C — `document:chunk-embed` worker (atomic retrieval-version flip)

**Phase:** 3
**spec_sections:** 5.5, 8 (queued chunking + embedding), 13.1 (atomic retrieval swap), 13.3 (embedding-model active-flip)
**Files:**
- `server/jobs/documentChunkEmbedJob.ts` (new)

**Contracts (file-level):**
- Worker `createWorker('document:chunk-embed', handler)`.
- **Transactional-boundary invariant (spec invariant §1.5 #9 + §1.5 #11):** embedding provider I/O runs OUTSIDE `withOrgTx`. Only persistence + chunk-count verification + the atomic pointer flip run INSIDE the transaction. Job enqueue happens AFTER the transaction commits (`afterCommit`-only, never inside the tx callback). Wrapping OpenAI calls inside the DB transaction is FORBIDDEN — long-lived transactions cause lock amplification, connection-pool starvation, and retry instability.
- Handler steps:
  1. **Pre-transaction (no DB tx held):**
     a. Read the new version's content (read-only query against the parent connection — no transaction needed; row already committed by Chunk 3E's version-write path).
     b. Capture the effective chunking config from `documentChunkingServicePure` constants (Chunk 2D — runtime-immutable per job execution).
     c. Call `documentChunkingServicePure.chunkDocument(...)` (Chunk 2D) — pure, in-memory.
     d. Call `documentEmbeddingService.embedChunks(...)` (Chunk 3A) — I/O against OpenAI; wrapped in `withBackoff`, NOT inside a DB transaction.
  2. **Inside `withOrgTx` (short-lived, no external I/O):**
     a. INSERT chunks via the `referenceDocumentService.persistChunks(...)` extension (Chunk 3E). Idempotent on `(version_id, chunk_index, embedding_model)` per Chunk 1B; replays after partial-success no-op.
     b. SELECT `COUNT(*)` of chunks for `(document_id, version_id, embedding_model)` and assert it equals the expected total computed from step 1c.
     c. **Atomic flip (same transaction):** UPDATE `reference_documents SET retrieval_version_id = :new_version_id, last_chunked_at = now() WHERE id = :document_id`. The count assertion in (b) and the UPDATE in (c) are in the same transaction so the pointer flip is atomic with the completeness check.
  3. **Post-commit (`afterCommit` hook, never inside the tx callback):**
     a. If this chunking job is downstream of a promotion (job payload carries `promotionAuditId`), enqueue `document:promotion-finalise` — chained per spec §8 / §10.1.
- **Retrieval-version completeness invariant (spec §13.1, hard):** the pointer flip MUST NOT happen if step 2b's count check fails. Tested via the Pure-test in Chunk 2C; this chunk's job code uses the same `expectedChunkCountByVersionId` check.

**Dependencies:** Chunks 2C, 2D, 3A, 3E.

**Error-handling strategy:**
- **Embedding step (pre-tx) failure:** if `documentEmbeddingService.embedChunks` raises (provider 5xx exhausting retries, network failure, partial result), no chunks have been persisted yet — the transaction has not opened. pg-boss retries the job; the next attempt re-chunks (deterministic given content + captured config) and re-embeds. No persistence-state cleanup needed because there is none.
- **Persist step (in-tx) collision:** unique-violation `23505` on `(version_id, chunk_index, embedding_model)` is treated as idempotent hit. This handles two cases: (a) a previous attempt's persist step got further than expected before crashing post-embed pre-commit, leaving a few rows behind; (b) two `document:chunk-embed` workers for the same `(document_id, version_id)` race — the loser's INSERTs are absorbed as no-ops, then the count check confirms completeness, then the flip is atomic.
- **Count-check failure (in-tx):** if step 2b finds fewer chunks than expected after step 2a (e.g. concurrent worker raced and lost some inserts to its own collision detection), the transaction rolls back without flipping the pointer. pg-boss retries; the next attempt finds the missing chunks already from the racing worker and the count succeeds. Pointer flip remains all-or-nothing.

**Tests (Pure only):** N/A on the wet job-handler. The retrieval-version completeness invariant is pinned by `documentRetrievalServicePure.test.ts` (Chunk 2C) and the chunking heuristics by `documentChunkingServicePure.test.ts` (Chunk 2D).

#### Chunk 3D — `document:reembed` worker (embedding-model upgrade sweep)

**Phase:** 3
**spec_sections:** 5.5, 8 (queued sweep), 8.1 (idempotency `(version_id, chunk_index, embedding_model)`), 13.3 (per-document active-model flip)
**Files:**
- `server/jobs/documentReembedJob.ts` (new)

**Contracts (file-level):**
- Worker `createWorker('document:reembed', handler)`.
- Handler iterates documents with `active_embedding_model != target_embedding_model`. Per document, follows the same transactional-boundary structure as Chunk 3C (spec invariant §1.5 #9): embedding I/O OUTSIDE `withOrgTx`; persistence + count-check + active-model flip INSIDE the transaction.
  1. **Pre-transaction:** for the target document's `retrieval_version_id`, identify chunks present under `active_embedding_model` but missing under `target_embedding_model`; embed those missing chunks via `documentEmbeddingService.embedChunks` (Chunk 3A — outside any DB transaction).
  2. **Inside `withOrgTx`:**
     a. INSERT new-model chunks via `referenceDocumentService.persistChunks` (idempotent on `(version_id, chunk_index, embedding_model)`).
     b. Count chunks under `(document_id, retrieval_version_id, target_embedding_model)`; assert equals expected total.
     c. **Atomic flip:** UPDATE `reference_documents SET active_embedding_model = :target WHERE id = :document_id`.
- Per-document flip (NOT global) per spec §13.3. Sweep is rate-limited via pg-boss concurrency.

**Dependencies:** Chunks 1B, 2C, 3A, 3C (uses persist path from 3E that 3C also uses).

**Error-handling strategy:** same idempotency posture as Chunk 3C. Sweep is rate-limited via pg-boss concurrency; failure on one document does not block other documents.

**Tests (Pure only):** N/A.

#### Chunk 3E — `documentDataSourceService` + `referenceDocumentService` extensions

**Phase:** 3
**spec_sections:** 3.2 (extend `referenceDocumentService`), 5.3, 5.4, 6.4 (link / scope / mode), 8.1 (idempotency), 10.6 (unique-constraint mapping)
**Files:**
- `server/services/documentDataSourceService.ts` (new)
- `server/services/referenceDocumentService.ts` (modify — chunk-aware version write; mode-update API; trigger summarisation + embedding jobs on version write; expose `persistChunks` helper used by Chunks 3C / 3D)
- `server/routes/referenceDocuments.ts` (modify — add mode-update + scope-link CRUD endpoints)

**Contracts (file-level):**
- `documentDataSourceService.link(input: { documentId, scope, scopeKey, principal })`: inserts a row into `reference_document_data_sources`, validates scope CHECK, validates principal authorization (org-admin-only for `organisation` scope per spec §6.5). Returns the new link row.
- `documentDataSourceService.unlink(linkId, principal)`: soft-delete via `deletedAt`. Re-creating uses a fresh row, never un-deletes (audit-friendly per §10.7).
- `documentDataSourceService.changeMode(documentId, newMode, principal)`: state-based update predicate `WHERE mode <> :new_mode`. Mode is on the document, not the link, per spec §4.3 / §6.6. Emits `retrieval.always_available.mode_changed` event when mode transitions to or from `always_available` (spec §11.5; emission via existing `agent_execution_events` writer; payload `{ organisationId, documentId, oldMode, newMode, actorUserId, occurredAt }`).
- `referenceDocumentService.writeVersion(...)` extension: on version write, sets `summary_stale = true` immediately. **`document:summarise` and `document:chunk-embed` jobs are enqueued via the `afterCommit` hook ONLY (spec invariant §1.5 #11)** — enqueueing inside the `withOrgTx` callback is FORBIDDEN. Without this, a rolled-back version-write leaves orphan jobs that run against a row that never existed. Does NOT flip `retrieval_version_id` (Chunk 3C handles that).
- `referenceDocumentService.persistChunks(...)`: bulk-insert helper used by Chunks 3C and 3D.
- Route layer: `POST /api/reference-documents/:id/mode`, `POST /api/reference-documents/:id/links`, `DELETE /api/reference-documents/:id/links/:linkId`. All routes call services only (architecture rule); all use `asyncHandler`; service errors throw `{ statusCode, errorCode }`.

**Dependencies:** Chunks 1A, 1C, 3B (job enqueue), 3C (job enqueue).

**Error-handling strategy:**
- Unique-violation `23505` on link insert -> 409 Conflict, `{ error: "DOCUMENT_ALREADY_LINKED", existingLinkId }`.
- Mode change on a document the principal lacks `knowledge:write` on -> 403 Forbidden.
- Org-pin attempt by sub-account admin -> 403 Forbidden (spec §7).
- All mutations inside `withOrgTx` (architecture rule).

**Tests (Pure only):** if any helper is genuinely pure (e.g. mode-transition validation predicate, scope-key validation), pin in `documentDataSourceServicePure.ts` + test. Otherwise no Pure-test (the service is I/O-bound).

---

### Phase 4 — Retrieval integration into agent run + observability emission

Phase 4 is the cross-cutting cutover. The eager/lazy code path is replaced; `retrieval.summary` events emit from day one (spec §11.1, brief §9 invariant).

#### Chunk 4A — `retrievalService` (DB-backed) + `retrievalObservabilityService` + `0291b` partial unique index

**Phase:** 4
**spec_sections:** 5.3, 6.7 (canonical storage), 7.1 (auth-before-retrieval), 10.4 (terminal event uniqueness), 11.1 (emission), 11.4 (bounded payload), 11.5 (always-available constants), 12 (tenant isolation)
**Files:**
- `migrations/0291b_agent_execution_events_retrieval_summary_unique.sql` (new — partial unique index `(run_id) WHERE event_type = 'retrieval.summary'`)
- `server/services/retrievalService.ts` (new)
- `server/services/retrievalObservabilityService.ts` (new)
- `server/services/retrievalObservabilityServicePure.ts` + `retrievalObservabilityServicePure.test.ts` (new — bounded-payload truncation as a pure function so it can be tested for byte-identical replay)
- `shared/types/agentExecutionLog.ts` (modify — add `'retrieval.summary'` and `'retrieval.always_available.mode_changed'` event types; add `'observability'` criticality)

**Contracts (file-level):**
- `retrievalService.assembleKnowledgeForRun(runId): Promise<RetrievalResult>` — the only DB-backed entry point. Inside `withOrgTx`:
  1. **Build candidate pool** (spec §12 five-tier UNION): one query per tier with explicit per-tier filters (org / subaccount / agent / scheduled-task / task-instance), each scoped by `withOrgTx` so RLS is in effect.
  2. **Authorization-before-retrieval invariant (spec §7.1):** the candidate pool IS the result of the authorization-scoped query. The ranker never sees rows it shouldn't have.
  3. **Candidate-pool deterministic ordering (spec invariant §1.5 #10):** the SQL UNION applies `ORDER BY scope_tier DESC, updated_at DESC, id ASC` before any LIMIT or mapping into `RetrievalCandidate[]`. The pure ranker re-sorts in step 5, but stabilising the upstream pool removes replay ambiguity and prevents future "top-N before rank" optimisations from silently becoming nondeterministic. Each tier's SELECT carries an explicit `scope_tier` literal column (5 = task_instance, 4 = scheduled_task, 3 = agent, 2 = subaccount, 1 = organisation) so the outer ORDER BY is well-defined across the UNION.
  4. Map document chunks + memory blocks into `RetrievalCandidate[]` preserving the SQL ordering.
  5. Call `retrievalServicePure.rankCandidates(...)` (Chunk 2A) for ranking.
  6. Call `documentRetrievalServicePure.groupCandidatesByDocument(...)` (Chunk 2C) for document-level result shape.
  7. Pass the result through `retrievalObservabilityServicePure.truncateForEmission(...)` (this chunk) for the bounded-payload contract.
  8. Emit `retrieval.summary` event into `agent_execution_events` at run end (the same boundary as the existing emitter). Event payload includes `chunkConfig: { targetTokens, overlapTokens }` recording the effective chunking heuristic from `documentChunkingServicePure` constants (Chunk 2D, spec invariant §1.5 #M1) so replay and debugging can reconstruct the heuristic used at run time.
- `retrievalObservabilityService.emit(runId, result)`: writes the event; on `23505` from the partial unique index, treats as idempotent hit per spec §10.4.
- `retrievalObservabilityServicePure.truncateForEmission(result): RetrievalResult` (pure): applies the spec §11.4 deterministic truncation — top-N by `finalScore DESC` for `rejected.aboveThreshold` (N=50), top-N by `bestChunkScore DESC` for `rejected.belowThreshold.sample` (N=20), top-N by `updated_at DESC` for `rejected.modeExcluded` (N=50), with truncation indicators `{ total, retained }`.
- **Always-available threshold constants (spec §11.5)** exported from `retrievalObservabilityService.ts`: `ALWAYS_AVAILABLE_DOC_COUNT_WARN = 30`, `ALWAYS_AVAILABLE_TOKEN_COST_WARN = 30000`. Single source of truth; UI banner reads from this module via the API. **Spec §17 names a Pure helper `shouldShowAlwaysAvailableWarning({ docCount, tokenCost })` returning `true` when `docCount >= 30` OR `tokenCost >= 30000`** — this lives in `retrievalObservabilityServicePure.ts` and is tested at boundaries (29/29999 -> false; 30/0 -> true; 0/30000 -> true).
- `shared/types/agentExecutionLog.ts` extension: closed-enum addition of `'retrieval.summary'` (carrying the spec §6.2 `RetrievalResult` shape verbatim) and `'retrieval.always_available.mode_changed'` (carrying `{ organisationId, documentId, oldMode, newMode, actorUserId, occurredAt }`). New criticality value `'observability'`.

**Dependencies:** Chunks 2A, 2C; Phase 1 schema.

**Error-handling strategy:**
- Unique-violation `23505` on `(run_id) WHERE event_type = 'retrieval.summary'` -> idempotent hit (spec §10.4); single-writer-per-run preserved.
- **Degraded-mode emission (spec invariant §1.5 #13, hard):** when retrieval fails, the `retrieval.summary` event MUST carry the deterministic degraded shape: `loaded: []`, `alwaysAvailable: []`, `referenceOnlyManifest: []`, `degraded: true`, `degradedReason: <closed enum>`. The closed enum (defined in `shared/types/retrieval.ts` per Chunk 2A): `'pool_query_failed'` (candidate-pool SQL failed), `'embedding_provider_failed'` (query-embedding lookup failed), `'rank_failed'` (pure ranker threw — should be impossible but defended), `'unknown'` (catch-all). The agent run continues with empty knowledge; the prompt assembler treats degraded-mode the same as "nothing matched" but downstream metrics, alerts, and dashboards (Chunk 7A aggregates) discriminate `degraded === true` from `loaded.length === 0 && degraded === false`. **Without this discrimination, "retrieval failed" gets silently rolled into "nothing matched" and the data corruption is permanent and post-hoc unrecoverable.** Operationally: `degradedReason` drives PagerDuty routing (provider errors -> SRE; pool errors -> backend on-call).
- Failure path: `retrievalService.assembleKnowledgeForRun` catches the underlying error, builds the degraded-shape `RetrievalResult`, logs the underlying error code (`{ statusCode: 500, errorCode: 'RETRIEVAL_POOL_QUERY_FAILED' | 'RETRIEVAL_EMBEDDING_FAILED' | 'RETRIEVAL_RANK_FAILED' }`) for observability, and returns the degraded result rather than throwing — the agent run continues. The `retrieval.summary` emitter then writes the degraded payload as a single event per run (idempotency preserved by the partial unique index).

**Tests (Pure only — `retrievalObservabilityServicePure.test.ts`):**
- Bounded-payload truncation: 100 above-threshold rejections truncate to 50 with indicator `{ total: 100, retained: 50 }`; replay produces byte-identical payload.
- `shouldShowAlwaysAvailableWarning` boundary cases (spec §17): exactly 29 docs / 29999 tokens -> `false`; exactly 30 docs -> `true`; exactly 30000 tokens -> `true`; both above -> `true`.
- **Degraded-mode shape determinism (spec invariant §1.5 #13):** a degraded `RetrievalResult` (built via a `buildDegradedResult(reason)` helper exported from `retrievalObservabilityServicePure`) ALWAYS produces `{ loaded: [], alwaysAvailable: [], referenceOnlyManifest: [], degraded: true, degradedReason: <reason> }` byte-identically across replays. Test all four `RetrievalDegradedReason` enum values and assert the non-degraded path (with empty `loaded` but non-failure) produces `{ degraded: false, degradedReason: null }` — i.e. the type discriminator is present and correct in BOTH branches.

#### Chunk 4B — `agentExecutionService` cutover (replace eager/lazy with `retrievalService.assembleKnowledgeForRun`)

**Phase:** 4
**spec_sections:** 5.4, 8 (inline retrieval), 9 (Phase 4 ordering)
**Files:**
- `server/services/agentExecutionService.ts` (modify — call `retrievalService.assembleKnowledgeForRun(runId)`; remove old eager/lazy code path)
- `server/services/agentExecutionServicePure.ts` (modify if a Pure-side helper is involved)
- `server/services/agentRunPromptService.ts` (modify — accept `RetrievalResult` instead of bare data-source rows)

**Contracts (file-level):**
- `agentExecutionService` consumes the new `RetrievalResult` from Chunk 4A; passes to `agentRunPromptService.assemble(...)` which now takes `RetrievalResult` and uses `loaded[]` + `alwaysAvailable[]` + `referenceOnlyManifest[]` to build the prompt.
- The old `loadingMode` consumer is removed entirely from `agentExecutionService` and `agentRunPromptService`. **The schema column is NOT dropped here** — that is Chunk 4D and runs only after this chunk lands.
- Latency budget per spec §8 / brief §16: < 100ms added per run; verified by structured-log timing in `agent_execution_events` (no new timer primitive).

**Dependencies:** Chunk 4A.

**Error-handling strategy:** retrieval failure surfaces as a degraded run (per Chunk 4A); the agent execution path does NOT block on retrieval — it continues with empty knowledge and emits the degraded `retrieval.summary`.

**Tests (Pure only):** if any prompt-assembly helper is pure, pin the assembly logic in `agentRunPromptServicePure.ts` (likely already exists). Otherwise no new Pure-test in this chunk.

#### Chunk 4C — `agentDataSources` route shape change (drop eager/lazy fields)

**Phase:** 4
**spec_sections:** 5.6
**Files:**
- `server/routes/agentDataSources.ts` (modify — drop `loadingMode` from request/response shapes; redirect callers to the new mode-update endpoint)

**Contracts (file-level):**
- Request schemas (Zod): `loadingMode` field removed. Existing callers receive 400 with `{ errorCode: 'LOADING_MODE_DEPRECATED', migrationGuide: '/docs/...' }` if they send the deprecated field.
- Response shapes: `loadingMode` removed.
- The `agent_data_sources` table itself remains for HTTP / CSV / Drive non-document sources (spec §3.2).

**Dependencies:** Chunk 4B (cutover must commit before this — though in practice they ship together since both modify caller contracts).

**Error-handling strategy:** strict Zod validation (per dev-guidelines §8.13 discriminated-union validators).

**Tests (Pure only):** if any Zod schema is exported as a pure module, pin in a Pure-test that asserts the deprecated field is rejected; otherwise N/A.

#### Chunk 4D — Drop `agent_data_sources.loading_mode` column (`0293`)

**Phase:** 4 (post-cutover)
**spec_sections:** 5.1 (migration `0293`), 9.1 (Phase 4 post-cutover)
**Files:**
- `migrations/0293_agent_data_sources_drop_loading_mode.sql` (new)
- `server/db/schema/agentDataSources.ts` (modify — drop the Drizzle column)
- `server/db/schema/index.ts` (consequent re-export sweep, if any)

**Contracts (file-level):**
- Migration drops `loading_mode` column. Down file restores it as nullable text (so a rollback does not re-introduce a NOT-NULL constraint on existing rows).
- Drizzle schema removes the column.

**Dependencies:** **Chunks 4B and 4C MUST be committed and shipped before this chunk runs.** Spec §5.1: drop runs only after the read-path cutover lands. This is the rolling-cutover ordering invariant. The chunk ordering in this plan enforces it; the operator must NOT reorder.

**Error-handling strategy:** N/A (DDL).

**Tests (Pure only):** N/A.

---

### Phase 5 — UI: Knowledge tabs + Add-to-Knowledge

Phase 5 ships the operator-facing surfaces. Mockups at `prototypes/auto-knowledge-retrieval/` are the design source of truth — chunks reference prototype paths verbatim and do NOT regenerate.

#### Chunk 5A — `document_promotion_audit` table + `documentPromotionService` inline transaction (`0291a`)

**Phase:** 5
**spec_sections:** 5.1 (migration `0291a`), 5.3, 6.5 (promotion contract), 8 (inline tx + queued finalise), 8.1 (idempotency `(file_id)`), 10.1, 10.3 (race guard), 10.6 (unique-constraint mapping)
**Files:**
- `migrations/0291a_document_promotion_audit.sql` (new)
- `server/db/schema/documentPromotionAudit.ts` (new — declared in `RLS_PROTECTED_TABLES` in same migration)
- `server/config/rlsProtectedTables.ts` (modify — add manifest entry)
- `server/services/documentPromotionService.ts` (new)
- `server/routes/referenceDocuments.ts` (modify — add `POST /api/reference-documents/promote` endpoint that calls the new service)

**Contracts (file-level):**
- `document_promotion_audit` table: append-only ledger of `(file_id, document_id, organisation_id, principal_id, created_at, deleted_at)` with `UNIQUE (file_id) WHERE deleted_at IS NULL`. RLS via direct org-isolation. Manifest entry added in same migration.
- `documentPromotionService.promoteFile(req: AddToKnowledgeRequest, principal): Promise<{ documentId: string }>` runs the inline transaction inside `withOrgTx`:
  1. Verify principal has `knowledge:write` on the chosen scope. Org-admin-only for `organisation` scope (spec §7).
  2. INSERT into `reference_documents` (mode default `'auto'` per spec §4.3, source `'from_file'` per spec §4.4).
  3. INSERT into `reference_document_versions` (initial version).
  4. INSERT into `reference_document_data_sources` (link row at the chosen scope).
  5. INSERT into `document_promotion_audit` (the idempotency anchor — UNIQUE on `file_id`).
  6. Enqueue `document:summarise` and `document:chunk-embed` jobs (Chunk 3B / 3C); the chunk-embed job payload carries `promotionAuditId` so step 6 of Chunk 3C knows to enqueue `document:promotion-finalise`.
  7. **The `execution_files.expiresAt` flip is NOT in this transaction** — deferred to Chunk 5B.
- Race guard: two simultaneous promotes of the same file collide on `document_promotion_audit_unique_per_file`; the loser receives 409 Conflict per spec §10.3 / §10.6, with `{ error: "FILE_ALREADY_PROMOTED", existingDocumentId }`.

**Dependencies:** Chunks 1A, 1B, 1C, 3B, 3C, 3E.

**Error-handling strategy:**
- 409 Conflict on duplicate promotion (spec §10.3 / §10.6).
- 403 Forbidden on org-pin attempt by sub-account admin (spec §7).
- Inline transaction rollback on any step failure.
- **`afterCommit`-only job enqueue (spec invariant §1.5 #11, hard):** `document:summarise` and `document:chunk-embed` jobs are enqueued strictly via the `afterCommit` hook from the pg-boss helper. Enqueueing inside the `withOrgTx` callback is FORBIDDEN. Without this, a rolled-back promotion (validation failure post-step-2 in step 3, or any rollback) leaves orphan jobs that run against a `documentId` that does not exist, a `promotionAuditId` that was never committed, and a chained `document:promotion-finalise` that flips `expires_at` on a non-existent file. The architectural correctness of the entire promotion path depends on this invariant.

**Tests (Pure only):** if scope-validation is a pure helper, extract to `documentPromotionServicePure.ts` + test. Otherwise N/A.

**Why-not-reuse note:** the audit table is named in spec §5.1 — it is the idempotency anchor for the promotion path. We considered using `(file_id)` UNIQUE on `reference_documents` directly. Rejected — the document might be deleted (soft-delete) and re-created; we need a permanent record of "this file was promoted, here is the resulting document id" for the 409 response body. The audit table is append-only and survives soft-delete on the document.

#### Chunk 5B — `document:promotion-finalise` worker (durable file flip)

**Phase:** 5
**spec_sections:** 4.6, 5.5, 6.5 (deferred durability flip), 8 (queued finalise), 8.1 (idempotency `(document_id, file_id)`)
**Files:**
- `server/jobs/documentPromotionFinaliseJob.ts` (new)

**Contracts (file-level):**
- Worker `createWorker('document:promotion-finalise', handler)`.
- Handler (chained on `document:chunk-embed` success per Chunk 3C step 6):
  1. Verify the document's `retrieval_version_id` is non-null (chunking job has flipped the pointer).
  2. UPDATE `execution_files SET expires_at = NULL WHERE id = :file_id` (durability flip per spec §4.6).
  3. Emit a finalise telemetry event (existing `agent_execution_events` writer).
- Idempotency: `(document_id, file_id)` predicate; if `expires_at IS NULL` already, no-op.

**Dependencies:** Chunks 3C, 5A.

**Error-handling strategy:** if `retrieval_version_id` is still null (chunking job has not finished), pg-boss re-queues with backoff. Final failure leaves the file expirable — the audit row prevents the promotion path from re-running, but the operator-facing UI continues to show "durable" because the audit row is the visible signal (per spec §4.6: "Operator-facing: the file row is marked 'durable' in the UI as soon as the inline transaction completes (audit-row backed); the `expiresAt` flip is invisible to the operator").

**Tests (Pure only):** N/A.

#### Chunk 5C — `files` route + `filesApi` hook (Files tab read surface)

**Phase:** 5
**spec_sections:** 5.6 (new `routes/files.ts`), 5.8 (new `client/src/api/filesApi.ts`), 14.2 (Files tab), 18.5 (default scope filter)
**Files:**
- `server/routes/files.ts` (new — list `execution_files` for a given scope)
- `client/src/api/filesApi.ts` (new)

**Contracts (file-level):**
- Route: `GET /api/files?scope=subaccount|agent|task` returns `execution_files` rows filtered by scope. Read-only. Permission: `knowledge:read`. Default scope: current sub-account, with scope selector for org admins (spec §18.5 recommendation).
- Client hook: `useFilesQuery({ scope })` returns the file list.

**Dependencies:** none from this build (consumes existing `execution_files` table).

**Error-handling strategy:** `asyncHandler` + service throws `{ statusCode, errorCode }` on permission failure; existing pattern.

**Tests (Pure only):** N/A.

#### Chunk 5D — Knowledge page tab strip refresh + Files tab + Documents tab refresh

**Phase:** 5
**spec_sections:** 5.7, 14.1 (tab strip), 14.2 (Files tab), 14.3 (Documents tab), 11.5 (always-available banner)
**Files:**
- `client/src/pages/govern/KnowledgePage.tsx` (modify — tab strip refresh; reference mockup `prototypes/auto-knowledge-retrieval/index.html`)
- `client/src/pages/govern/components/KnowledgeFilesTab.tsx` (new — reference mockup `prototypes/auto-knowledge-retrieval/knowledge-files-tab.html`)
- `client/src/pages/govern/components/KnowledgeDocumentsTab.tsx` (new — reference mockup `prototypes/auto-knowledge-retrieval/knowledge-documents-tab.html`; includes the always-available soft-warning banner per spec §11.5; banner reads `docCount` + `tokenCost` + `shouldWarn` from a new `useAlwaysAvailableCapacity()` hook that hits the endpoint added in Chunk 7A — soft dependency, can stub initially)

**Contracts (file-level):**
- Components consume `PageShell` / `Modal` / `SortableTable` / `EmptyState` / `ErrorState` from PR #270 consolidation-foundation. No new shared primitives.
- Documents tab columns: tier, mode, source provenance (badge only for non-default per spec §4.4), "used by N agents" (computed from `reference_document_data_sources` count). Three-dots menu: Edit, Change mode, Add to bundle, Duplicate, Delete.
- Always-available banner: rendered above the table when `shouldWarn === true`. Copy verbatim from spec §11.5.
- **No partial document visibility (spec invariant §1.5 #15):** the Documents tab MUST NOT expose document-level retrieval-readiness states (`'embedded' | 'indexed' | 'ready'`). The only visible signal for documents is the same as for files — a "durable" badge backed by audit-row presence (spec §4.6) — which reflects the inline-transaction commit, NOT the chunking job's progress. A document with audit-row but null `retrieval_version_id` displays as durable; the retrieval-readiness state is invisible to the operator until retrieval actually loads it (Chunk 7A relevance bar). This prevents the phantom-ready failure mode where the UI claims "ready" before chunking commits and retrieval cannot find chunks.

**Dependencies:** Chunks 4A (constants + Pure helper), 5C (Files tab), 7A (capacity-query endpoint — soft dep; the banner can be implemented with a stub query in 5D and wired to 7A's endpoint when 7A lands).

**Error-handling strategy:** loading / empty / error states rendered per `EmptyState` + `ErrorState` primitives.

**Tests (Pure only):** N/A on UI components per spec §17 (no frontend tests).

#### Chunk 5E — `AddToKnowledgeModal` + `knowledgeApi` extensions

**Phase:** 5
**spec_sections:** 5.7, 5.8, 6.5 (promotion contract), 14.5 (modal)
**Files:**
- `client/src/pages/govern/components/AddToKnowledgeModal.tsx` (new — reference mockup `prototypes/auto-knowledge-retrieval/add-to-knowledge-modal.html`)
- `client/src/api/knowledgeApi.ts` (new — `addToKnowledge`, `changeDocumentMode`, scope-link CRUD; consumes routes from Chunks 3E and 5A)

**Contracts (file-level):**
- Modal fields per spec §6.5: title (pre-filled from filename, editable), content preview, scope (org-admin-only field hidden in DOM for non-org-admins per spec §7 + frontend principles), Advanced expander (Apply to + mode override). Default scope inherited from the surface that originated the request (Manage-Task -> task-instance, etc.).
- API hook: `useAddToKnowledgeMutation()` calls `POST /api/reference-documents/promote`.

**Dependencies:** Chunks 3E, 5A.

**Error-handling strategy:** 409 Conflict ("Already promoted") surfaced inline with link to the existing document. 403 Forbidden ("Cannot promote to organisation scope") never shown — the field is absent from the DOM.

**Tests (Pure only):** N/A.

---

### Phase 6 — UI: Agent Data Sources + Document Detail + Bundles refresh

Phase 6 ships the per-agent view, document detail modal, and the bundle-edit modal mode-chip read-only enforcement.

#### Chunk 6A — `AgentDataSourcesTab` refresh (mode chips, relevance bar)

**Phase:** 6
**spec_sections:** 5.7, 14.7 (Agent Data Sources tab)
**Files:**
- `client/src/pages/agents/components/AgentDataSourcesTab.tsx` (refresh — reference mockup `prototypes/auto-knowledge-retrieval/agent-data-sources.html`)

**Contracts (file-level):**
- Per-agent view of all linked documents across all five tiers. Mode chips read-only. Relevance signal bar (sourced from Chunk 7A aggregate-query endpoint).
- No eager/lazy controls (already removed in Phase 4 cutover at the API layer; this chunk removes the corresponding UI).
- **No partial document visibility (spec invariant §1.5 #15):** does not expose retrieval-readiness states beyond the audit-row "durable" badge. Same posture as Chunk 5D.

**Dependencies:** Chunks 4C (route shape), 5E (knowledgeApi), 7A (relevance aggregate endpoint — soft dep, can stub initially).

**Error-handling strategy:** standard loading / empty / error states.

**Tests (Pure only):** N/A.

#### Chunk 6B — `DocumentDetailModal` (two-column edit modal)

**Phase:** 6
**spec_sections:** 5.7, 14.6 (Document Detail modal)
**Files:**
- `client/src/pages/govern/components/DocumentDetailModal.tsx` (new — reference mockup `prototypes/auto-knowledge-retrieval/document-detail-modal.html`)

**Contracts (file-level):**
- Two-column layout. Main: title, content, mode picker, scope, available-to. Side: tier, qualitative size widget, created info, linked agents with usage bars (usage from Chunk 7A relevance aggregate).
- Mode picker is interactive (writes via `knowledgeApi.changeDocumentMode`); on `always_available <-> *` transitions the UI shows confirmation copy referencing the spec §11.5 capacity guidance.
- **No partial document visibility (spec invariant §1.5 #15):** the side-column metadata MUST NOT include retrieval-readiness states; "durable" badge is the only persistence signal exposed. Same posture as Chunks 5D and 6A.

**Dependencies:** Chunks 5E, 7A (soft dep for usage bars).

**Error-handling strategy:** loading / saving / error states.

**Tests (Pure only):** N/A.

#### Chunk 6C — `BundleEditModal` refresh + `KnowledgeBundlesTab` promotion to top-level tab

**Phase:** 6
**spec_sections:** 5.7, 14.1 (Bundles top-level tab), 14.4 (Bundles tab read-only mode chips), 14.8 (Bundle Edit modal)
**Files:**
- `client/src/pages/govern/components/BundleEditModal.tsx` (refresh — reference mockup `prototypes/auto-knowledge-retrieval/bundle-edit-modal.html`)
- `client/src/pages/govern/components/KnowledgeBundlesTab.tsx` (refresh — reference mockup `prototypes/auto-knowledge-retrieval/knowledge-bundles-tab.html`; promote sub-tab to top-level tab)
- `client/src/pages/govern/KnowledgePage.tsx` (modify — add Bundles to top-level tab strip per spec §14.1)

**Contracts (file-level):**
- Bundle-edit modal: per-document mode chips are **read-only** (brief §5 invariant; mode is on the document, not the link). Editing a mode chip in this modal redirects to the Document Detail modal (Chunk 6B).
- No backend change (spec §14.4: "same data model as today").
- **No partial document visibility (spec invariant §1.5 #15):** retrieval-readiness states are not exposed in this modal. Same posture as Chunks 5D, 6A, 6B.

**Dependencies:** Chunks 5D (KnowledgePage tab strip refresh — extend the same component), 6B (mode editor lives in Document Detail).

**Error-handling strategy:** N/A.

**Tests (Pure only):** N/A.

---

### Phase 7 — Retrieval observability surfaces

Phase 7 ships the operator-facing surfaces consuming the events emitted in Phase 4. All read-only against `agent_execution_events`.

#### Chunk 7A — Aggregate-query helper module + relevance / capacity endpoints

**Phase:** 7
**spec_sections:** 11.2 (aggregate "Loaded in N of last 30 runs"), 11.3 (engineering metrics), 11.5 (always-available capacity metrics)
**Files:**
- `server/services/retrievalAggregatesService.ts` (new — read aggregates over `agent_execution_events`)
- `server/routes/retrievalAggregates.ts` (new — GET endpoints for the three Phase-7 surfaces)

**Contracts (file-level):**
- Exports:
  - `getDocumentRelevance(documentId, lastN: number = 30)`: returns `{ runsLoadedIn: number, lastNRuns: number }` for the relevance bar (spec §11.2 #3).
  - `getDocumentReasonsTooltip(documentId, lastN: number = 30)`: returns plain-language summary string (spec §11.2 #1).
  - `getRunRetrievalSummary(runId)`: returns the full `RetrievalResult` payload from the run's `retrieval.summary` event (spec §11.2 #2).
  - `getAlwaysAvailableCapacity(orgId)`: returns `{ docCount: number, tokenCost: number, shouldWarn: boolean }`. `shouldWarn` is computed via `shouldShowAlwaysAvailableWarning` from Chunk 4A.
- **Stable "last N runs" replay window (spec invariant §1.5 #12, hard):** every aggregate query in this service uses a single shared subquery `recentTerminalRuns(lastN)` that pins the window semantics in one place:
  1. Filter to terminal runs only: `status IN ('succeeded', 'failed', 'cancelled')` (closed enum; new statuses require a deliberate amendment).
  2. Exclude soft-deleted runs: `deleted_at IS NULL`.
  3. Order by `completed_at DESC, id DESC` (the `id` tiebreaker is the determinism anchor; matches dev-guidelines §8.17).
  4. Apply `LIMIT :lastN` BEFORE any aggregation (window-then-aggregate, never aggregate-then-window).
  5. Retries count as distinct runs unless an explicit `superseded_by_run_id` pointer says otherwise (default behaviour: count them; the superseded-by predicate is opt-in per future amendment).
  6. Degraded runs (`retrieval.summary.degraded === true`) are present in the window but excluded from `runsLoadedIn` — degraded does NOT mean "not loaded". `getDocumentRelevance` returns `{ runsLoadedIn, runsDegraded, lastNRuns }` so the UI can distinguish "loaded in 12 of 30 (3 degraded)" from "loaded in 12 of 30".
- Without these pinned semantics, "Loaded in N of last 30 runs" drifts across surfaces (Documents tab vs Agent Data Sources tab vs Document Detail), each surface picks slightly different ordering and filters, and the same document shows three different relevance numbers on three screens.
- All queries inside `withOrgTx` (architecture rule).
- Routes use `asyncHandler`; service errors throw `{ statusCode, errorCode }`.

**Dependencies:** Chunks 4A (events being emitted; constants).

**Error-handling strategy:** standard.

**Tests (Pure only):** extract the `recentTerminalRuns` window construction into a pure helper `buildRecentTerminalRunsQuery(lastN, nowMs): { sql: string; params: unknown[] }` in `retrievalAggregatesServicePure.ts` so the windowing semantics (terminal-only, ordering, limit-before-aggregate) can be pinned by Pure-tests asserting the SQL shape across boundary cases (lastN=1, lastN=30, lastN=0). String-construction for tooltips also extracted if non-trivial.

#### Chunk 7B — "Why was this loaded?" tooltip

**Phase:** 7
**spec_sections:** 11.2 #1 (tooltip on document rows in Agent Data Sources + Documents tabs)
**Files:**
- `client/src/pages/govern/components/DocumentReasonsTooltip.tsx` (new)

**Contracts (file-level):**
- Reusable tooltip component consumed by `KnowledgeDocumentsTab` (Chunk 5D) and `AgentDataSourcesTab` (Chunk 6A). Calls `useDocumentReasonsTooltip(documentId)` which hits `GET /api/retrieval-aggregates/document/:id/reasons` (Chunk 7A).

**Dependencies:** Chunk 7A.

**Error-handling strategy:** loading / error states fall back to "No retrieval data yet".

**Tests (Pure only):** N/A.

#### Chunk 7C — "Why wasn't this loaded?" drill-in

**Phase:** 7
**spec_sections:** 11.2 #2 (per-run trace surface)
**Files:**
- `client/src/pages/runs/components/RetrievalRejectionsDrillIn.tsx` (new — file path approximate; exact location matches the existing run-trace page)
- `client/src/api/runApi.ts` (extend — add `useRunRetrievalSummary(runId)` hook; route mounted in existing run-trace API surface)

**Contracts (file-level):**
- Drill-in renders `RetrievalResult.rejected.aboveThreshold` (top-N truncated per spec §11.4) with reason chips. Truncation indicator surfaced ("showing top 50 of N budget-rejected candidates").
- Mounted on the existing run-trace surface; no new page.

**Dependencies:** Chunk 7A.

**Error-handling strategy:** standard.

**Tests (Pure only):** N/A.

#### Chunk 7D — Relevance bar + doc-sync (architecture.md, capabilities.md, KNOWLEDGE.md)

**Phase:** 7
**spec_sections:** 11.2 #3 (relevance bar), 5.10 (doc-sync at programme end)
**Files:**
- `client/src/pages/govern/components/DocumentRelevanceBar.tsx` (new)
- `architecture.md` (modify — add row to `Key files per domain` for the shared retrieval engine and the document chunk pipeline; per spec §5.10)
- `docs/capabilities.md` (modify — new capability entry under the knowledge domain, vendor-neutral, editorial-rules-compliant; per spec §5.10)
- `KNOWLEDGE.md` (modify — append patterns surfaced during the build; doc-sync gate enforces at finalisation)

**Contracts (file-level):**
- Relevance bar shows "Loaded in N of last 30 runs" — consumed by `KnowledgeDocumentsTab` (Chunk 5D) and `AgentDataSourcesTab` (Chunk 6A) and `DocumentDetailModal` (Chunk 6B).
- `architecture.md`: new entry under §Key files per domain pointing at `server/services/retrievalServicePure.ts`, `server/services/retrievalService.ts`, `server/services/documentRetrievalServicePure.ts`, `server/services/documentChunkingServicePure.ts`, the four queues, and the new tables.
- `docs/capabilities.md`: new capability entry per editorial rules (vendor-neutral, marketing-ready, model-agnostic).
- `KNOWLEDGE.md`: append-only entries for any patterns that surfaced (e.g. "two-pointer split for content vs retrieval version", "audit-row idempotency anchor for inline tx + queued finalise"). Per CLAUDE.md §3 and §11.

**Dependencies:** Chunk 7A (relevance bar data); all prior chunks (doc-sync at programme end).

**Error-handling strategy:** N/A.

**Tests (Pure only):** N/A.

---

## Section 3 — Risks-and-mitigations

The top risks for this build, each with the chunk that owns the mitigation. Risks are ordered roughly by blast radius; #1 and #2 are the load-bearing invariants whose regression would corrupt agent-run behaviour silently.

1. **Stale chunks visible during version write -> chunking window** (race between `current_version_id` flip on save and `retrieval_version_id` flip after chunking commits). Spec §13.1 invariant. **Mitigation:** Chunk 1A introduces both columns with distinct semantics; Chunk 3C is the single code site that flips `retrieval_version_id`, AFTER every chunk for the new version is embedded. Chunk 2C's `documentRetrievalServicePure.test.ts` pins the retrieval-version completeness invariant — any future refactor that breaks the invariant fails the test.

2. **Half-embedded generation visible during embedding-model upgrade** (race between writing chunks under new model and flipping `active_embedding_model`). Spec §13.3 invariant. **Mitigation:** Chunk 3D flips `active_embedding_model` per-document, only after every chunk for `retrieval_version_id` has a row under the new model. Same pure-function invariant test as #1 covers this.

3. **RLS coverage gap on the two new tables** (`reference_document_chunks`, `reference_document_data_sources`). Spec §7. **Mitigation:** Chunks 1B and 1C each pair the table-introducing migration with the manifest entry in the same migration. Chunk 1E is a defensive consolidation pass. CI gate `verify-rls-coverage.sh` blocks merge if a manifest entry is missing.

4. **Observability payload bloat in `agent_execution_events` ledger** (spec §6.7 canonical storage). Unbounded `rejected.aboveThreshold` arrays could DoS the ledger. **Mitigation:** Chunk 4A introduces `retrievalObservabilityServicePure.truncateForEmission` with deterministic top-N truncation per spec §11.4. Pure-test in 4A asserts byte-identical replay. Truncation values are constants in `retrievalObservabilityService` — not per-org configurable in v1.

5. **Cutover crash from dropping `agent_data_sources.loading_mode` while running code still reads it.** **Mitigation:** Chunk 4D (drop migration `0293`) MUST land AFTER Chunks 4B and 4C (read-path cutover). Plan ordering pins this; the operator must not reorder. The drop migration's down file restores the column as nullable text (graceful rollback).

6. **Double-emit of `retrieval.summary` event** during run-finalisation retries. **Mitigation:** Chunk 4A introduces partial unique index `0291b` on `(run_id) WHERE event_type = 'retrieval.summary'`; the emitter catches `23505` and treats as idempotent hit per spec §10.4. Single-writer-per-run preserved.

7. **Two pointers easy to confuse in code review.** `current_version_id` (content), `retrieval_version_id` (retrieval), `active_embedding_model` (embedding generation) — three distinct pointers on `reference_documents`. **Mitigation:** Chunk 1A's contract block pins the semantics with named comments; Chunk 2C's filter function takes both pointers as map arguments (forces explicit threading); Chunk 3C is the single code site that flips `retrieval_version_id`; Chunk 3D is the single site that flips `active_embedding_model`.

8. **Always-available capacity warning regression.** The constants `30` docs / `30000` tokens are first-cut and may need tuning. **Mitigation:** Chunk 4A pins them as constants in one module (`retrievalObservabilityService`), exposed via a Pure helper (`shouldShowAlwaysAvailableWarning`) tested at boundaries (29/29999, 30/0, 0/30000). Configurability is explicitly deferred to a post-launch amendment when per-org overrides land on `organisations` (spec §11.5, §15).

9. **Long-lived transaction operational failure** — wrapping OpenAI embedding I/O inside `withOrgTx` would cause connection-pool starvation and lock amplification at scale. **Mitigation:** spec invariant §1.5 #9 pins the embedding-outside-tx structure; Chunk 3C's handler is split into pre-tx (chunk + embed in memory) and tx-bounded (persist + verify count + atomic flip); same shape applied in Chunk 3D re-embed. Idempotency on `(version_id, chunk_index, embedding_model)` (Chunk 1B) makes the new structure replay-safe.

10. **Orphan jobs from in-tx enqueue** — pg-boss enqueueing inside a `withOrgTx` callback that subsequently rolls back leaves jobs queued against rows that never existed. **Mitigation:** spec invariant §1.5 #11 pins `afterCommit`-only enqueue; Chunks 3E and 5A explicitly forbid in-tx enqueueing.

11. **Replay drift in candidate pool** — UNION query without explicit ordering may produce different candidate orderings on replay (especially under PG planner changes), corrupting determinism even though the pure ranker re-sorts. **Mitigation:** spec invariant §1.5 #10 pins the SQL-side ordering (`scope_tier DESC, updated_at DESC, id ASC`) BEFORE mapping to `RetrievalCandidate[]`. Chunk 4A's candidate-pool query carries an explicit `scope_tier` literal column on each tier's SELECT.

12. **"Retrieval failed" silently rolled into "nothing matched"** — without a degraded-mode flag, downstream metrics treat a provider outage the same as legitimately empty results. The corruption is permanent and post-hoc unrecoverable. **Mitigation:** spec invariant §1.5 #13 pins the deterministic degraded-mode shape on `RetrievalResult`; Chunk 2A adds `degraded: boolean` + `degradedReason: RetrievalDegradedReason | null` (closed enum); Chunk 4A's emitter writes the deterministic shape on every failure path; Pure-test in Chunk 4A asserts byte-identical replay.

13. **"Last N runs" drifts across surfaces** — different aggregate queries pick slightly different ordering / filtering, causing the same document to show three different relevance numbers on Documents tab vs Agent Data Sources tab vs Document Detail. **Mitigation:** spec invariant §1.5 #12 pins the `recentTerminalRuns(lastN)` shared subquery in Chunk 7A; Pure-test on `buildRecentTerminalRunsQuery` covers boundary cases.

14. **Mixed similarity metrics across embedding generations** — a future embedding-model upgrade introducing dot-product or Euclidean would silently corrupt mixed-generation candidate pools (cosine-vs-dot-product ranking is incomparable). **Mitigation:** spec invariant §1.5 #14 pins cosine-only across all index, query, ranker, and provider call sites; Chunk 1B documents the operator class explicitly; future model upgrades MUST preserve cosine.

15. **Phantom-ready document UI** — operator sees "ready" in the UI before chunking commits, expects retrieval to load it, retrieval finds no chunks, operator opens a support ticket. **Mitigation:** spec invariant §1.5 #15 pins no-partial-visibility on UI surfaces; Chunks 5D, 6A, 6B, 6C all document the "durable badge only, no retrieval-readiness states" posture.

---

## Section 4 — Dependency graph

Phase ordering (spec §9 verbatim, mandatory):

```
Phase 1  ->  Phase 2  ->  Phase 3  ->  Phase 4  ->  Phase 5  ->  Phase 6  ->  Phase 7
```

Intra-phase chunk order with dependency arrows:

```
Phase 1  (schema + RLS)
  1A  ->  1B  (chunks needs documents columns)
  1A  ->  1C  (data_sources FKs documents)
  1A  ->  1D  (independent; can land in parallel with 1B/1C)
  1B + 1C ->  1E  (consolidation pass)

Phase 2  (pure ranker)
  2A
  2A  ->  2B  (block ranker delegates to 2A)
  2A  ->  2C  (document filter feeds into ranker output grouping)
  2D  (independent of 2A/B/C)

Phase 3  (ingestion jobs)
  3A
  3E  (depends on 1A, 1C; introduces persistChunks helper used by 3C / 3D)
  3B  (uses 1A summary columns; independent of 3A)
  3C  (uses 2C, 2D, 3A, 3E persist path)
  3D  (uses 1B, 2C, 3A, 3E persist path)

Phase 4  (agent-run integration)
  4A  (uses 2A, 2C; introduces 0291b partial unique index + observability service)
  4B  (cutover; uses 4A)
  4C  (route shape; commits with 4B in practice)
  4D  (drop loading_mode column; MUST land AFTER 4B + 4C ship)

Phase 5  (UI: Knowledge tabs + promotion)
  5A  (audit table + promotion service + promote endpoint)
  5B  (finalise job; depends on 3C + 5A)
  5C  (Files route + API hook)
  5D  (KnowledgePage + Files tab + Documents tab; depends on 4A constants, 5C; soft-dep on 7A)
  5E  (Add-to-Knowledge modal + knowledgeApi; depends on 3E, 5A)

Phase 6  (UI: Agent Data Sources + Document Detail + Bundles)
  6A  (Agent Data Sources tab; depends on 4C, 5E, 7A soft-dep)
  6B  (Document Detail modal; depends on 5E, 7A soft-dep)
  6C  (Bundle Edit modal + Bundles top-level tab; depends on 5D, 6B)

Phase 7  (observability surfaces)
  7A  (aggregate query module + endpoints; depends on 4A)
  7B  (tooltip; depends on 7A)
  7C  (drill-in; depends on 7A)
  7D  (relevance bar + doc-sync; depends on 7A and ALL prior chunks)
```

The dependency arrows above respect the intra-phase rule: every chunk's prerequisites are committed by an earlier chunk in the same or an earlier phase. No forward references.

**Critical hard ordering:**
- `4B + 4C` -> `4D` (do not drop the column until the read path stops reading it).
- `5A` -> `5B` (audit row exists before finalise can run).
- `4A` -> `7A, 7B, 7C, 7D` (events must be emitting before surfaces consume them).

---

## Executor notes

- **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
- Per chunk, the allowed local verification commands are: `npm run lint`, `npm run typecheck` (or `npx tsc --noEmit`), `npm run build:server` / `npm run build:client` when the chunk touches the build surface, and `npx vitest run <path-to-test>` for tests authored in that chunk.
- All Pure tests follow the `*Pure.test.ts` convention (gate-enforced per dev-guidelines §7). Tests use Vitest (`import { test, expect } from 'vitest'`).
- Migration numbers (`0288`–`0293`, plus `0291a` and `0291b`) are placeholders verified at plan-time against `migrations/` (today the highest landed is `0287`). The first task of every Phase 1 / Phase 4 / Phase 5 chunk that owns a migration is to verify the next-free number; if another branch landed a migration in the interim, the chunk renames the file and updates the spec via a brief directional ADR / spec-amendment, not a silent rename.
- Mockups at `prototypes/auto-knowledge-retrieval/` are baseline-locked. UI chunks reference prototype paths verbatim; do NOT regenerate.
- The plan introduces **no new abstractions** beyond the three named in spec §3.3 (`reference_document_chunks`, `reference_document_data_sources`, `retrievalServicePure`). The three supporting items (`document_promotion_audit`, `retrievalService`, `retrievalObservabilityService`) are scaffolding the spec already named in §5; they are not a fourth invented primitive.
- `mode`, `source`, and `RetrievalRejectionReason` enums are closed (spec §10.7, §4.4, §6.3). Adding a value is a spec amendment, not a code change.

> End of plan.
