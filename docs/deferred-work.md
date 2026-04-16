# Deferred Work

System-wide tracker for work items that have been **explicitly deferred** during a review or implementation cycle. These are not bugs, not blockers, and not in any active spec — they are items where the cost/benefit analysis at the time of decision said "not now, but capture it so we don't lose it."

This file is the single durable home for that class of item. It is **not**:

- A roadmap (see `docs/improvements-roadmap.md` for phased platform plans)
- A bug tracker (use the in-session `triage-agent` and `tasks/todo.md`)
- A future-research log (see `docs/future-proofing-research-brief.md`)
- A perfection list — items here must have a real, concrete trigger condition that would make them worth picking up

## Format

Each item has:

- **Source** — which PR / review / spec surfaced the item
- **Description** — what the change is, in one paragraph
- **Why deferred** — the reason it was not done at surfacing time
- **Trigger to revisit** — the concrete condition that would warrant doing it
- **Rough scope** — file count / migration count / risk level, so the next session can plan
- **Status** — `open` (still deferred), `in progress` (someone is working on it), `done` (link to the PR that closed it), `withdrawn` (no longer relevant — explain why)

Items are appended, never edited in place except to flip status. When closing an item, leave it in the file with `Status: done — <PR ref>` so future readers can audit decisions.

---

## Memory & Briefings — content-hash invalidation review (PR #task-memory-context-retrieval-Mr5Mn)

The following six items came out of the external code review of the content-hash-based embedding invalidation work (commits `dc130d4`, `e7223b8`, `a40a0d7` on branch `claude/task-memory-context-retrieval-Mr5Mn`). All were classified by the reviewer as "approve and merge — these are improvements for a follow-up, not blockers."

### 1. Trust as a continuum (binary `isUnverified` → weighted inclusion)

- **Source:** PR review §2.2
- **Description:** The current schema (`migration 0150`) treats provenance as binary — entries with `is_unverified = true` are filtered out of high-trust paths (synthesis, utility-adjust); everything else is treated equally. Replace this with a continuous trust score derived from `provenance_source_type` + `provenance_confidence` + citation history, and use it as a multiplier in the relevance ranking rather than a hard filter.
- **Why deferred:** The binary version is correct for current callers and is what the spec requires. The continuum is a refinement, not a fix. Doing it now would have meant re-touching every retrieval call site and re-tuning the RRF combined-score weights without a concrete relevance complaint to validate against.
- **Trigger to revisit:** First time we see legitimate-but-unverified entries (e.g. drop-zone uploads with no provenance) being filtered out of synthesis when a user expected them to inform the output. Or: first time the weighted-vs-binary distinction shows up as a relevance-quality gap in evals.
- **Rough scope:** 1 service file (`memoryEntryQualityService.ts` or new `memoryTrustService.ts`), 1 migration if we add a derived `trust_score` column, plus retrieval call-site updates (~3–5 files). Medium risk: changes a ranking signal that downstream behaviour depends on.
- **Status:** open

### 2. Quality + decay coupling into a single `finalScore`

- **Source:** PR review §2.3
- **Description:** Today, `qualityScore`, `freshnessFactor`, and `recency_score` are computed and applied separately at different stages (insert, decay job, RRF combined-score). Collapse them into a single derived `finalScore = qualityScore * freshnessFactor` field, written by the decay/utility jobs and read by retrieval. Removes the multi-stage drift risk and makes the ranking signal inspectable in one place.
- **Why deferred:** This is a refactor, not a behaviour change. The current multi-stage form is correct, just diffuse. Doing it would have collided with the §4.4 invariant work (qualityScore mutation guard) — better to land that boundary first and then refactor on top of a stable boundary.
- **Trigger to revisit:** Any future change that needs to add a third decay-like signal (e.g. an "agent disagreement" penalty). At that point the multi-signal sprawl will become genuinely painful and the refactor pays for itself.
- **Rough scope:** 1 schema change (add `final_score` column), 1 migration, 1 service edit (`memoryEntryQualityService.ts`), retrieval queries updated to read `final_score` instead of computing it (~2 files). Medium risk: ranking change.
- **Status:** open

### 3. HNSW incremental reindex (avoid full table reindex)

- **Source:** PR review §2.6
- **Description:** When the bulk `recomputeStaleEmbeddings` job runs across many entries in one subaccount, the HNSW index on `workspace_memory_entries.embedding` is updated row-by-row. For large stale-batch runs (e.g. after a content-mutation backfill), this can be measurably slower than a `REINDEX CONCURRENTLY` on the partial index when the batch exceeds some threshold. Add an incremental-vs-full reindex strategy guarded by batch-size heuristic.
- **Why deferred:** No production data points yet. The current HNSW config handles per-row updates fine for the batch sizes we've actually run (≤100). Optimising before we've measured the slowdown is premature.
- **Trigger to revisit:** First time a `recomputeStaleEmbeddings` run on a large subaccount exceeds the `statement_timeout` for the bulk job, or first time we see HNSW latency regress after a content-mutation backfill. Add observability first (timing on the job, index-bloat metric), then decide.
- **Rough scope:** 1 job file (`server/jobs/staleEmbeddingRecomputeJob.ts` if we add one, or inline in the existing helper), no migration, possibly a config knob in `limits.ts`. Low-medium risk: ops-only change.
- **Status:** open

### 4. md5 → sha256 (system-wide hash migration)

- **Source:** PR review §3.1
- **Description:** The content-hash invalidation uses md5 (`GENERATED ALWAYS AS (md5(content)) STORED`). Md5 is fine for change-detection (the only property we need is collision-resistance for identical-but-different content, which md5 still gives at this scale), but the codebase uses md5 in several other places too. If we ever standardise on sha256 system-wide for hashing, this column needs to migrate with the rest.
- **Why deferred:** Md5 is sufficient for this use case and the migration is non-trivial because it touches multiple unrelated subsystems (Drizzle migrations, dedup constraints, possibly content-addressed caches). Doing one column in isolation creates inconsistency.
- **Trigger to revisit:** Either (a) a security review flags md5 use as a posture issue, or (b) we encounter a real collision somewhere in the stack. Otherwise: leave it.
- **Rough scope:** Sweep across all md5 call sites (currently includes content_hash, dedup constraint, possibly LLM-cache keys), one migration per affected column with online dual-write strategy. High risk: cross-cutting, requires careful sequencing.
- **Status:** open

### 5. Embedding ↔ memory_block versioning invariant

- **Source:** PR review §3.5
- **Description:** Memory blocks (`memory_blocks` table, Letta pattern) have `content` that agents can mutate at runtime via the `update_memory_block` skill. Memory blocks do not currently have the equivalent of `embedding_content_hash` — if a block is embedded for retrieval (which is not done today, but is a likely Phase 3 addition), the same drift problem will appear. Apply the same content-hash pattern preemptively when memory-block embeddings are introduced.
- **Why deferred:** Memory blocks are not embedded today, so the invariant has no current consumer. Adding the columns now would be dead schema until the embedding feature lands.
- **Trigger to revisit:** The PR / spec that introduces memory-block embeddings. At that point, copy the `workspace_memory_entries` pattern: GENERATED `content_hash`, `embedding_content_hash`, partial index, CAS guard on Phase 2 enrichment writes, and the `reembedEntry` helper shape.
- **Rough scope:** 1 migration (add the two columns + index), 1 service edit (`memoryBlockService.ts`), 1 helper (block-equivalent of `reembedEntry`). Low risk: pattern is now well-validated in `workspace_memory_entries`.
- **Status:** open

### 6. Phase 2 timestamp CAS guard (monotonic-write defence-in-depth)

- **Source:** PR review §4 follow-up (the "anything else?" optional item)
- **Description:** Phase 2 enrichment now uses a content-hash CAS predicate (`AND content_hash = ${snapshotContentHash}`) to prevent overwriting an embedding written by a concurrent Phase 1 path with stale enrichment text. As a belt-and-braces defence, also add a timestamp predicate (`AND embedding_computed_at <= ${snapshotTime}`) so any future writer that *also* uses the latest content but writes a fresher embedding still wins. Pure monotonic-write hardening — no current bug.
- **Why deferred:** The hash CAS already closes the only race the reviewer could construct. The timestamp CAS is purely defence-in-depth against a future writer pattern that doesn't exist yet. Adding it now is over-engineering against a hypothetical caller.
- **Trigger to revisit:** When we introduce a third writer path to `workspace_memory_entries.embedding` (currently only Phase 1 immediate write and Phase 2 enrichment write). At that point the monotonic-write semantics need to be explicit because the call graph stops being trivially analysable.
- **Rough scope:** Single SQL predicate addition in `workspaceMemoryService.ts` Phase 2 enrichment path, plus a snapshot timestamp captured before `generateEmbedding`. No migration. Trivial.
- **Status:** open

---
