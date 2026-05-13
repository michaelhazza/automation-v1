# Memory Improvements — Spec

**Status:** reviewing
**Spec date:** 2026-05-13
**Last updated:** 2026-05-13 (spec-reviewer iteration 1)
**Author:** spec-coordinator (inline)
**Build slug:** `memory-improvements`
**Source brief:** [`tasks/builds/memory-improvements/brief.md`](../../../tasks/builds/memory-improvements/brief.md) (Rev 6.3, LOCKED 2026-05-12)
**Branch:** `claude/add-memvid-integration-ehAOr`

---

## Table of contents

1. Goals and non-goals
2. Framing assumptions
3. Brief-level invariants carried forward
4. Phase plan
5. File inventory lock
6. Contracts
7. Permissions / RLS checklist
8. Execution model
9. Phase sequencing — dependency graph
10. Deferred items
11. Self-consistency pass result
12. Testing posture
13. Execution-safety contracts
14. UI section
15. Open questions for Phase 2

---

## 1. Goals and non-goals

### 1.1 Goals

Three additive improvements to the existing memory system, scoped to be complementary to the work already shipped by `auto-knowledge-retrieval` (PR #274, 2026-05-08) and `trust-verification-layer` (PR #275, 2026-05-09):

- **Proposal A — Synthesis lineage.** Make every auto-synthesised memory block answerably traceable to its source workspace-memory entries and the run that produced them. Closes the dead-end behind the Trust & Verification Layer's `Source: Auto` pill.
- **Proposal B — Citation-rate utility.** Make memory-injection utility (% of injected memory the agent actually cited) measurable. Split into a backend substrate (B1) and an operator dashboard (B2).
- **Proposal D — Semantic ranker for AKR.** Replace the explicit `finalScore: 0` v1 simplification at `retrievalService.ts:197,276` with cosine ranking against a query embedding, behind an env on/off flag. Completes a deliberate v1 simplification AKR's spec deferred.

### 1.2 Non-goals

- **No SPO entity graph.** Rejected in brief §6 with reasoning the spec inherits verbatim.
- **No single consolidated memory surface (Mnemo MNEMO-CONTEXT pattern).** Rejected in brief §6 with cache-boundary + injection-defence reasoning.
- **No four-mode staged rollout for D.** Dropped in Rev 6 of the brief. D ships behind a single env flag. The Off/Shadow/Sampled/On machinery is deferred until live-user readiness is reached.
- **No re-ranking layer (Cohere or LLM) on AKR.** Pure cosine, consistent with AKR spec §1.2. Re-rank decision deferred until B1 utility data exists.
- **No version-aware retrieval change.** AKR continues to retrieve the latest version of each document per its §1.2.
- **No backfill of historical lineage rows.** Cluster membership was never persisted; A's lineage starts from migration forward. Brief-accepted constraint.
- **No new agent-facing prompt content.** Lineage is operator-facing only. The agent prompt does not change in v1.
- **No new top-level pages.** All UI is a new tab on an existing page (`MemoryBlockDetailPage`, `UsagePage`). Brief §5.
- **No customer-facing UI changes.** Operator and admin tooling only. End users see only the resulting retrieval quality from D.

### 1.3 Why now

- A's trigger is the Trust & Verification Layer pill. Without lineage, the `Auto` case becomes a dead-end UX. Cheaper to add lineage in the same migration window than to retrofit when operators start clicking and find nothing.
- B1's trigger is D's enablement. Without a utility signal, D's rollout is unfalsifiable — any regression is invisible.
- D's trigger is AKR's deferred ranker becoming production behaviour. The shipped scaffolding (chunked embeddings, observability, modes, ingestion jobs, pure ranker, threshold parameter) is wasted until the query embedding wires in.

---

## 2. Framing assumptions

Inherited verbatim from [`docs/spec-context.md`](../../spec-context.md):

- `pre_production: yes`, `live_users: no`, `feature_stability: low`.
- `rollout_model: commit_and_revert`, `staged_rollout: never_for_this_codebase_yet`.
- `feature_flags: only_for_behaviour_modes` — D's env flag is a behaviour-mode flag (semantic ranker on vs legacy), not a rollout gate.
- `testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`.
- `prefer_existing_primitives_over_new_ones: yes` — see §5.4 "Existing primitives reused vs invented" for the per-proposal accounting.

These framing assumptions justify D's Rev 6 simplification (single env flag, no shadow telemetry, no per-subaccount sampling), and the testing posture in §12 (pure-function tests only for new helper modules).

---

## 3. Brief-level invariants carried forward

These invariants emerged from brief Rev 5-6 review rounds and are load-bearing for downstream phases. They are reproduced here verbatim so the build phase has a single canonical reference.

### 3.1 A-Lineage decision

The lineage storage shape is a **join table** (`memory_block_version_sources`). `uuid[]` was considered and rejected (brief F4): if the audit UX ever needs to answer "where else did this source entry contribute?" or "which auto-synthesised blocks came from this run?", a `uuid[]` shape forces a second migration. A join table is queryable, indexable, and naturally extensible with per-source metadata.

### 3.2 A-Deletion invariant

Lineage rows must remain audit-useful even after source loss. Required snapshot metadata when `source_entry_id` becomes NULL (soft-delete or hard-delete):

- `source_entry_id_hash` (hex digest, deterministic from source UUID)
- `content_hash` (SHA-256 of the source entry content at capture time)
- `source_type` (text — e.g. `'workspace_memory'`, `'agent_belief'`, `'correction'`)
- `captured_at` (timestamptz)
- `quality_score_at_capture` (numeric — value of the source's quality score at synthesis time)
- `contribution_rank` (integer — rank within the cluster at synthesis time)

`snapshot_excerpt` is **out of scope for v1**. Re-evaluation requires privacy-review approval.

### 3.3 A-Run-provenance invariant

Lineage rows must capture deletion-safe run provenance when the originating run is available at synthesis time:

- `source_run_id` (nullable FK to `agent_runs`, `ON DELETE SET NULL`)
- `source_run_id_hash` (hex digest, deterministic from run UUID)
- `source_run_label_at_capture` (text — denormalised display label, captured at synthesis time, e.g. `"Marketing Research Agent · 2026-05-12 09:14"`)

If the run row is later purged, the admin route falls back to the captured label so "produced by run X on date Y" still renders on the Sources tab.

### 3.4 B-D dependency

Proposal D depends on **B1** (the measurement substrate), not on B2's polished dashboard. B1 gives engineering the post-enablement quality signal needed to verify the ranker is helping. B2's dashboard is the durability layer and may follow.

### 3.5 B1 denominator invariant

For workspace-memory entry utility:

- Numerator: `agent_runs.cited_entry_ids` (jsonb string[], **NOT NULL DEFAULT `[]`**, migration 0137 — present today). The numerator has no NULL state; `[]` is the canonical "no citations" value.
- Denominator: **does not exist today**. The brief verified there is no `injected_entry_ids` column. B1 must add it as **nullable** (no DEFAULT) so NULL distinguishes pre-migration / unwired runs from runs with an empty injection set. This asymmetry between numerator (NOT NULL) and denominator (nullable) is intentional and load-bearing for the §3.6 invariant.

For memory-block utility:

- Numerator: `agent_runs.applied_memory_block_citations` (jsonb, NOT NULL DEFAULT `[]`, migration 0199 — present today).
- Denominator: `agent_runs.applied_memory_block_ids` (jsonb string[], NOT NULL DEFAULT `[]`, migration 0199 — present today). **No NULL discriminator on the block side.** The block-side denominator cannot distinguish "pre-migration" from "measured empty" because the column always had a default; aggregate queries treat all rows as measured. The build phase must not add a NULL-discriminator migration to `applied_memory_block_ids` — historical rows are accepted as measured.

B1 cannot be purely derivative — it must add `agent_runs.injected_entry_ids` plus a write site at the workspace-memory composition point in `agentExecutionService.ts`.

### 3.6 B1 "not measured" vs "0% utility" invariant

Aggregate queries must distinguish runs that have no injection manifest (pre-migration or where the manifest was not yet wired) from runs that genuinely had an empty injection set. Surface the distinction in the substrate via NULL vs `[]` discriminator on `injected_entry_ids` and propagate to dashboard annotations.

**Scope of the discriminator.** The NULL-discriminator is applied to the entry-side denominator (`agent_runs.injected_entry_ids`, the new column in §4 Phase 2) only. The block-side denominator (`agent_runs.applied_memory_block_ids`, migration 0199) remains NOT NULL DEFAULT `[]` — see §3.5. Block-side dashboard rows treat every historical run as measured.

### 3.7 D-Recall invariant

If semantic filtering at the configured threshold would reduce a previously non-empty eligible candidate set to zero **for a given category** (document chunks, memory blocks), the ranker must fall back to top-N legacy ordering (scope-tier → recency) for that category and emit a `retrieval.empty_after_semantic` event on the run trace. This is an algorithm safety property, mandatory regardless of feature-flag state.

### 3.8 D-Embedding-failure invariant

OpenAI embedding failures (5xx, timeout, network error) must **fail open to legacy retrieval behaviour** (scope-tier + recency, `finalScore = 0`, threshold = 0) and emit a `retrieval.embedding_failed` degraded reason on the run trace. Must not block agent execution.

### 3.9 D-Rollout simplicity (Rev 6)

Single env flag `AKR_SEMANTIC_RANKER_ENABLED` (boolean) plus `AKR_RETRIEVAL_THRESHOLD` (numeric, default 0.30). No per-subaccount UI, no shadow telemetry, no per-subaccount sampling, no four-mode rollout. The recall and embedding-failure invariants are algorithm safety properties and remain mandatory.

---

## 4. Phase plan

Four buildable phases, each landable independently per brief §7. The sequencing constraint is B1 must land before D's flag is enabled in any environment.

### Phase 1 — Proposal A: Synthesis lineage

**Migration:** `0333_memory_block_version_sources.sql`. New table `memory_block_version_sources` per A-Deletion + A-Run-provenance invariants. RLS policy + manifest entry. (Next free number at spec-review iteration 1 — verified against `migrations/`, where `0330–0332` are taken.)

**Schema:**

```sql
CREATE TABLE memory_block_version_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  block_version_id uuid NOT NULL REFERENCES memory_block_versions(id) ON DELETE CASCADE,

  -- Source entry linkage (deletion-safe)
  source_entry_id uuid REFERENCES workspace_memory_entries(id) ON DELETE SET NULL,
  source_entry_id_hash text NOT NULL,
  content_hash text NOT NULL,
  source_type text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  quality_score_at_capture numeric,
  contribution_rank integer NOT NULL,

  -- Run provenance (deletion-safe, nullable when not available at synthesis time)
  source_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  source_run_id_hash text,
  source_run_label_at_capture text,

  CONSTRAINT memory_block_version_sources_unique_per_version_source
    UNIQUE (block_version_id, source_entry_id_hash)
);

ALTER TABLE memory_block_version_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_block_version_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON memory_block_version_sources
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE INDEX idx_mbvs_block_version ON memory_block_version_sources(block_version_id);
CREATE INDEX idx_mbvs_source_entry ON memory_block_version_sources(source_entry_id);
CREATE INDEX idx_mbvs_source_entry_hash ON memory_block_version_sources(source_entry_id_hash);
CREATE INDEX idx_mbvs_source_run ON memory_block_version_sources(source_run_id);
```

**Write site:** `server/services/memoryBlockSynthesisService.ts:195-206` (verified anchor). Inside the loop that inserts a synthesised memory block, also insert one `memory_block_version_sources` row per cluster entry. Cluster entries (`cluster: WorkspaceMemoryEntry[]`) and quality scores (`avgQuality`, plus per-entry quality from upstream cluster scoring) are in scope at that line.

**Read site:** new admin route `GET /api/memory-blocks/:id/sources?version=<n>`. Joins `memory_block_version_sources` → `workspace_memory_entries` (LEFT JOIN, may be NULL) and `agent_runs` (LEFT JOIN, may be NULL). Falls back to captured columns when the FK target is NULL. Returns the payload defined in §6.1.

**UI:** new "Sources" tab on `client/src/pages/MemoryBlockDetailPage.tsx` per the mockup `prototypes/memory-improvements/memory-block-detail.html`. Tab visible only when the block is `source: 'auto_synthesised'`. Version selector allows inspecting historical synthesis versions. Soft-deleted source rows render with strikethrough + reduced opacity. Bidirectional lineage expander (P2 — optional UI chrome): per-row toggle that reveals "this entry also contributed to N other blocks" derived from the same table.

**Scope (LOC):** ~150 LOC. One migration, one route, one service module (`memoryBlockSourcesService.ts` for the read path), one React tab component.

### Phase 2 — Proposal B1: Measurement substrate

**Migration:** `0334_injected_entry_manifest.sql`. New column `agent_runs.injected_entry_ids` jsonb default `NULL` (NULL distinguishes pre-migration runs from runs with empty injection). Backward-compatible. (Next free number after Phase 1's `0333`.)

**Materialised view:** `mv_memory_utility_30d` exposing per-run raw counts and a 30-day rolling aggregate per agent and per workspace. Schema:

```sql
ALTER TABLE agent_runs
  ADD COLUMN injected_entry_ids jsonb;  -- NULL = not measured; [] = measured empty; [...] = measured

CREATE MATERIALIZED VIEW mv_memory_utility_30d AS
WITH per_run AS (
  SELECT
    r.id AS run_id,
    r.organisation_id,
    r.subaccount_id,
    r.agent_id,
    r.created_at,
    CASE WHEN r.injected_entry_ids IS NULL THEN NULL
         ELSE jsonb_array_length(r.injected_entry_ids) END AS injected_entry_count,
    jsonb_array_length(r.cited_entry_ids) AS cited_entry_count,
    jsonb_array_length(r.applied_memory_block_ids) AS injected_block_count,
    jsonb_array_length(r.applied_memory_block_citations) AS cited_block_count,
    (r.injected_entry_ids IS NOT NULL) AS measured_entries
  FROM agent_runs r
  WHERE r.created_at > now() - interval '30 days'
)
SELECT
  organisation_id,
  subaccount_id,
  agent_id,
  COUNT(*) FILTER (WHERE measured_entries) AS runs_measured_entries,
  COUNT(*) FILTER (WHERE NOT measured_entries) AS runs_unmeasured_entries,
  SUM(injected_entry_count) FILTER (WHERE measured_entries) AS total_injected_entries,
  SUM(cited_entry_count) FILTER (WHERE measured_entries) AS total_cited_entries,
  SUM(injected_block_count) AS total_injected_blocks,
  SUM(cited_block_count) AS total_cited_blocks,
  CASE WHEN SUM(injected_entry_count) FILTER (WHERE measured_entries) > 0
       THEN SUM(cited_entry_count) FILTER (WHERE measured_entries)::numeric
            / SUM(injected_entry_count) FILTER (WHERE measured_entries)
       ELSE NULL END AS entry_utility_30d,
  CASE WHEN SUM(injected_block_count) > 0
       THEN SUM(cited_block_count)::numeric / SUM(injected_block_count)
       ELSE NULL END AS block_utility_30d
FROM per_run
GROUP BY organisation_id, subaccount_id, agent_id;

CREATE UNIQUE INDEX idx_mv_memory_utility_30d ON mv_memory_utility_30d
  (organisation_id, subaccount_id, agent_id);
```

**Refresh job:** `server/jobs/refreshMemoryUtility30dJob.ts`. pg-boss schedule, nightly at 03:00 UTC. Wraps `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_memory_utility_30d` in a `withAdminConnection` call (the view is multi-tenant by design).

**Write site:** `server/services/agentExecutionService.ts:1349-1356`. After `memoryWithTracking = await workspaceMemoryService.getMemoryForPromptWithTracking(...)` resolves at line 1349, `memoryWithTracking.injectedEntries: Array<{ id: string; content: string }>` is bound at line 1356. Insert the persistence step there: `agent_runs.injected_entry_ids = memoryWithTracking.injectedEntries.map(e => e.id)`. The persistence call lands inside the existing run-state write path; no new transactional boundary required. (Anchor verified at spec-review iteration 1; build phase confirms a final time before commit if the file has drifted.)

**Pure helper:** new `server/services/memoryUtilityAggregatorPure.ts` exposing the per-run aggregation math + the `measured` discriminator logic. Unit-tested with vitest pure-function tests.

**Scope (LOC):** ~120 LOC. One migration, one job, one helper module, one write-site change.

### Phase 3 — Proposal D: Semantic ranker (env-flagged)

**Three code changes, no new tables:**

1. **Query construction.** At `assembleKnowledgeForRun(runId)` entry, when `AKR_SEMANTIC_RANKER_ENABLED` is true, load the run's task description and embed it via the same path workspace-memory retrieval uses today (`text-embedding-3-small`, 1536 dims). The brief documents the choice: task description, not master prompt or conversation history. The build phase must validate this against a sample of dev-environment runs.
2. **Cosine score wiring.** Replace `finalScore: 0` literals at `retrievalService.ts:197` (document chunks) and `:276` (memory blocks) with cosine similarity between the query embedding and each candidate's chunk/block embedding. The downstream `rankCandidates` / `rankByPrecedencePure` functions already accept a `threshold` parameter and emit rejection reasons; they need only a real score to filter on.
3. **Threshold + flag.** New env vars: `AKR_SEMANTIC_RANKER_ENABLED` (boolean, default `false`) and `AKR_RETRIEVAL_THRESHOLD` (numeric, default `0.30`). When the flag is off, behaviour is unchanged (`finalScore = 0`, threshold = 0, scope-tier + recency).

**Recall + embedding-failure fallback path** (D-Recall + D-Embedding-failure invariants):

```
function assembleKnowledgeForRun(runId):
  load run
  if AKR_SEMANTIC_RANKER_ENABLED:
    try: query_embedding = embed(run.task_description)
    catch: emit 'retrieval.embedding_failed'; fallback to legacy (threshold=0)
  else:
    fallback to legacy (threshold=0)

  for each candidate category (chunks, blocks):
    if query_embedding is available:
      score candidates by cosine; filter by AKR_RETRIEVAL_THRESHOLD
      if filtered_set is empty AND original_set is non-empty:
        emit 'retrieval.empty_after_semantic' for this category
        fallback to top-N legacy ordering for this category
    else:
      use legacy ordering

  apply token budget; return result
```

**Observability:** new event types `retrieval.embedding_failed` and `retrieval.empty_after_semantic` are added to the existing `retrievalObservabilityService` and `retrievalObservabilityServicePure`. They follow the existing "degraded reason" emission shape.

**Scope (LOC):** ~100 LOC. Three site edits in `retrievalService.ts`, two new event types in `retrievalObservabilityServicePure.ts`, one env resolver, one pure scoring helper if cosine-on-vector math isn't already centralised (verify in build phase).

### Phase 4 — Proposal B2: Dashboard

**UI only.** New "Memory Utility" tab on `client/src/pages/UsagePage.tsx` per the mockup `prototypes/memory-improvements/citation-utility-dashboard.html`.

**Surfaces:**
- Two canvas-drawn line charts: entry utility (30d rolling), block utility (30d rolling).
- Per-agent breakdown table with inline utility bars, percentage labels, `<10 runs` suppression.
- One-sentence dismissable banner: *"Runs predating the entry-manifest migration are excluded from utility calculations. Citation detection is heuristic — figures are directional, not absolute."*

**Read path:** new admin route `GET /api/orgs/:orgId/usage/memory-utility` behind `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW)`. Pattern verified against `server/routes/llmUsage.ts:27-30` (`/api/orgs/:orgId/usage/summary` uses this exact guard pair). Organisation comes from the URL path segment, not a query param, to stay consistent with neighbouring usage routes.

**No new chart components.** Reuse the canvas-chart pattern from `prototypes/auto-knowledge-retrieval/agent-data-sources.html` and the `.data-table` convention from `prototypes/consolidation-2026-05-06/_shared.css`. Confirmed in mockup-log Round 1.

**Scope (LOC):** ~120 LOC. One route, one query helper, one tab component, one table + two chart sub-components.

### Opportunistic cleanup (§9 of brief)

Promote `MEMORY_BLOCK_TOP_K = 5` and the `* 3` multiplier in `server/services/memoryBlockService.ts:177` to env-overridable constants (`MEMORY_BLOCK_POOL_MULTIPLIER`, default `3`) in `server/config/limits.ts`. Default unchanged. No migration, no UI.

**Scope (LOC):** ~20 LOC. Treated as a Standard-class follow-up, not a phase. Ship opportunistically alongside Phase 2 or Phase 3, or as a standalone tiny PR. Not required for the spec to land.

---

## 5. File inventory lock

Every file the build phase touches. Cascade-edited from this section; prose-level references outside this table indicate inventory drift.

### 5.1 New files

| Phase | Path | Purpose |
|-------|------|---------|
| 1 | `migrations/0333_memory_block_version_sources.sql` | Schema + RLS policy for lineage join table |
| 1 | `migrations/0333_memory_block_version_sources.down.sql` | Matching `.down.sql` per the repo convention (every migration in `migrations/` has a sibling `.down.sql`) |
| 1 | `server/services/memoryBlockSourcesService.ts` | Read path for admin route + lineage payload builder |
| 1 | `server/services/memoryBlockSourcesServicePure.ts` | Pure helper for assembling the deletion-safe payload from join rows |
| 1 | `server/routes/memoryBlockSources.ts` | `GET /api/memory-blocks/:id/sources` |
| 1 | `server/db/schema/memoryBlockVersionSources.ts` | Drizzle schema for the new table |
| 1 | `client/src/pages/MemoryBlockSourcesTab.tsx` | New tab component (rendered conditionally inside `MemoryBlockDetailPage`) |
| 1 | `server/services/__tests__/memoryBlockSourcesServicePure.test.ts` | Pure-function tests for the payload assembler |
| 2 | `migrations/0334_injected_entry_manifest.sql` | Adds `agent_runs.injected_entry_ids` column + materialised view + unique index |
| 2 | `migrations/0334_injected_entry_manifest.down.sql` | Matching `.down.sql` per the repo convention |
| 2 | `server/jobs/refreshMemoryUtility30dJob.ts` | Nightly view refresh job |
| 2 | `server/services/memoryUtilityAggregatorPure.ts` | Pure aggregation helper (denominator discriminator, ratio math) |
| 2 | `server/services/__tests__/memoryUtilityAggregatorPure.test.ts` | Pure-function tests |
| 3 | `server/services/retrievalQueryEmbedderPure.ts` | Pure helper: cosine similarity + threshold filter + empty-after-semantic predicate |
| 3 | `server/services/__tests__/retrievalQueryEmbedderPure.test.ts` | Pure-function tests for the scoring + fallback |
| 4 | `client/src/pages/MemoryUtilityTab.tsx` | New tab inside `UsagePage` |
| 4 | `server/routes/memoryUtility.ts` | `GET /api/orgs/:orgId/usage/memory-utility` (matches `llmUsage.ts` convention) |
| 4 | `server/services/memoryUtilityQueryService.ts` | Org-scoped read against the materialised view |

### 5.2 Modified files

| Phase | Path | Change |
|-------|------|--------|
| 1 | `server/services/memoryBlockSynthesisService.ts` | Insert lineage rows alongside block insert at lines 195–206 (verified anchor) |
| 1 | `server/db/schema/index.ts` | Export new schema file |
| 1 | `server/config/rlsProtectedTables.ts` | Add `memory_block_version_sources` entry (RLS manifest invariant) |
| 1 | `client/src/pages/MemoryBlockDetailPage.tsx` | Add Sources tab to tab strip (rendered when `source === 'auto_synthesised'`) |
| 1 | `server/routes/index.ts` | Wire `memoryBlockSources` router |
| 2 | `server/services/agentExecutionService.ts` | Persist injected entry IDs to `agent_runs.injected_entry_ids` at the memory-composition write site (brief anchor: lines 1156–1375; exact line confirmed during build) |
| 2 | `server/db/schema/agentRuns.ts` | Add `injectedEntryIds: jsonb('injected_entry_ids').$type<string[] \| null>()` field |
| 2 | `server/jobs/index.ts` | Register the refresh job |
| 3 | `server/services/retrievalService.ts` | Replace `finalScore: 0` literals at lines 197 and 276 with cosine-from-query-embedding; add env resolver + recall fallback path; emit two new degraded reasons |
| 3 | `server/services/retrievalObservabilityServicePure.ts` | Extend degraded-reason enum: add `retrieval.embedding_failed` and `retrieval.empty_after_semantic` |
| 3 | `server/services/retrievalObservabilityService.ts` | Wire the two new event emission sites |
| 4 | `client/src/pages/UsagePage.tsx` | Add "Memory Utility" tab to existing tab strip |
| 4 | `server/routes/index.ts` | Wire `memoryUtility` router |
| Opp. | `server/services/memoryBlockService.ts` | Replace hardcoded `topK * 3` with `topK * MEMORY_BLOCK_POOL_MULTIPLIER` |
| Opp. | `server/config/limits.ts` | Add `MEMORY_BLOCK_POOL_MULTIPLIER` and `MEMORY_BLOCK_TOP_K` env-overridable constants |

### 5.3 Docs and reference updates (doc-sync rule)

| Phase | Path | Change |
|-------|------|--------|
| 1 | `architecture.md` § Source provenance / Document Retrieval Pipeline | Note the lineage join table and the deletion-safe pattern |
| 1 | `architecture.md` § Key files per domain | Add memory-block-sources route + service + tab |
| 2 | `architecture.md` § Document Retrieval Pipeline → Always-available telemetry | Note the utility metric substrate + measured-vs-unmeasured discriminator |
| 2 | `docs/capabilities.md` | Add operator-facing utility-metric capability under Observability if it's currently catalogued; vendor-neutral phrasing |
| 3 | `architecture.md` § Document Retrieval Pipeline → Modes | Note D's env flag, query-embedding source, and recall fallback |
| 3 | `docs/spec-context.md` | No update needed (flag is behaviour-mode, allowed); add a line to `accepted_primitives` if `retrievalQueryEmbedderPure` proves reusable |
| 3 | `KNOWLEDGE.md` | Append after merge — recall fallback + embedding-failure pattern; D enablement playbook |
| 4 | `architecture.md` § Key files per domain | Add memory-utility route + tab + query service |

### 5.4 Existing primitives reused vs invented

| New thing | Reused / Extended / Invented | Why |
|-----------|------------------------------|-----|
| Lineage join table | Invented | No existing join table from memory blocks to source artefacts. `memory_block_versions` exists (per `memoryBlockSynthesisService`); a join from version to source entries is genuinely new. |
| Admin route for sources | Reused (route pattern) | Follows existing memory-block admin route conventions; no new router primitive. |
| `injected_entry_ids` column | Extended | Mirrors `cited_entry_ids` (migration 0137) and `applied_memory_block_ids` (migration 0199). New column on an existing table is the standard pattern. |
| Materialised view + refresh job | Reused | `mv_optimiser_peer_medians` (migration 0277) + `refreshOptimiserPeerMedians.ts` establish the pattern: materialised view, nightly refresh job, `withAdminConnection` wrapper, `rlsExclusions` entry. |
| Query embedding | Reused | `workspaceMemoryService` already embeds queries with `text-embedding-3-small`. D reuses the same model + path. |
| Cosine score + threshold filter | Extended | `retrievalServicePure.rankCandidates` and `memoryBlockServicePure.rankByPrecedencePure` already accept `threshold` and emit rejection reasons; D supplies a non-zero score. |
| Degraded-reason events | Extended | `retrievalObservabilityService` already emits truncation + capacity warnings; D adds two new reason codes. |
| Pool multiplier env knob | Extended | `server/config/limits.ts` already centralises tunables; promotion is consistent with existing pattern. |
| Sources tab UI | Extended | `MemoryBlockDetailPage` already has a tab strip (Version History / Diff vs Canonical). Adding a third tab is the conventional extension point. |
| Memory Utility tab UI | Extended | `UsagePage` already has a tab strip (Overview / Agents / Models / Runs / Routing / IEE Execution per mockup-log Round 3 correction). Adding a tab is the conventional extension. |

No `accepted_primitives` entries are required to be added on Phase 1 ship. If `retrievalQueryEmbedderPure` becomes a clear reusable primitive across other retrieval surfaces (memory blocks, beliefs), append it on next spec-context.md revision.

---

## 6. Contracts

### 6.1 `MemoryBlockSourcesPayload` (admin route response)

**Type:** JSON (TypeScript discriminated union over source row variants).

**Producer:** `memoryBlockSourcesService.getSourcesForBlock(blockId, versionNumber?)`.

**Consumer:** `client/src/pages/MemoryBlockSourcesTab.tsx`.

**Shape:**

```typescript
type MemoryBlockSourcesPayload = {
  blockId: string;
  blockVersionId: string;
  versionNumber: number;
  capturedAt: string; // ISO timestamp
  sources: Array<{
    rowId: string;
    sourceType: 'workspace_memory' | 'agent_belief' | 'correction' | string;
    contributionRank: number;
    capturedAt: string;
    qualityScoreAtCapture: number | null;

    // Source entry — present if the source still exists
    sourceEntry: {
      id: string;
      content: string;
      isDeleted: boolean; // strikethrough indicator in UI
    } | null;

    // Source-entry deletion-safe fallback metadata (always present)
    sourceEntryIdHash: string;
    contentHash: string;

    // Run provenance — populated when synthesis time captured a run
    sourceRun: {
      id: string;
      label: string;
      isDeleted: boolean;
    } | null;
    sourceRunLabelAtCapture: string | null; // fallback when sourceRun is null
  }>;

  // Reverse-lineage option (P2): for each source entry, the count of other
  // block versions it also contributed to. Computed by COUNT(*) GROUP BY
  // source_entry_id_hash. Returned only if the request includes
  // `?include_reverse=true` to avoid a per-page join on every render.
  reverseLineageByEntry?: Record<string /* sourceEntryIdHash */, number>;
};
```

**Example instance:**

```json
{
  "blockId": "5fb3...",
  "blockVersionId": "a1c2...",
  "versionNumber": 3,
  "capturedAt": "2026-05-12T09:14:33Z",
  "sources": [
    {
      "rowId": "8e91...",
      "sourceType": "workspace_memory",
      "contributionRank": 1,
      "capturedAt": "2026-05-12T09:14:33Z",
      "qualityScoreAtCapture": 0.82,
      "sourceEntry": { "id": "f3a8...", "content": "Lead noted that...", "isDeleted": false },
      "sourceEntryIdHash": "a3b4c5...",
      "contentHash": "9e8d7c...",
      "sourceRun": { "id": "1234...", "label": "Marketing Research Agent · 2026-05-12 09:14", "isDeleted": false },
      "sourceRunLabelAtCapture": "Marketing Research Agent · 2026-05-12 09:14"
    }
  ]
}
```

**Nullability:** `sourceEntry`, `sourceRun`, `sourceRunLabelAtCapture`, `qualityScoreAtCapture` may all be null per the A-Deletion + A-Run-provenance invariants. The UI's strikethrough state is driven by `sourceEntry.isDeleted` (when the entry still exists but is soft-deleted) and by `sourceEntry === null` (when it's hard-deleted or never persisted).

**Source-of-truth precedence:** join-table row is canonical; FK joins to `workspace_memory_entries` and `agent_runs` are best-effort enrichments. The captured columns (`source_entry_id_hash`, `content_hash`, `source_type`, `captured_at`, `quality_score_at_capture`, `contribution_rank`, `source_run_label_at_capture`) survive FK loss.

### 6.2 `InjectedEntryManifest`

**Type:** JSONB column value on `agent_runs.injected_entry_ids`.

**Producer:** `agentExecutionService` at the memory-composition site.

**Consumer:** `mv_memory_utility_30d` (numerator-denominator computation); future per-run inspection routes (e.g. existing run-trace surfaces if they choose to render injected memory).

**Shape:** `null | string[]`. `null` = pre-migration / not-yet-wired run (excluded from aggregate). `[]` = run with empty injection (measured). `[uuid, uuid, ...]` = run with N injected entries.

**Example instances:**

```jsonb
NULL                       -- pre-migration run, excluded
[]                         -- measured: no entries were injected
["f3a8...", "b2c1..."]     -- measured: two entries injected
```

**Source-of-truth precedence:** prompt content is the canonical write; `injected_entry_ids` is the audit projection. Mismatches (entry IDs without matching prompt content) are a write-site bug and produce dashboard noise — caught by the build-phase write-site correctness check.

**Bounded growth:** the existing per-run memory token cap (32k for chunks; brief and workspace-memory caps elsewhere) bounds the injected-entry count. No unbounded array risk.

### 6.3 `mv_memory_utility_30d` row

**Type:** Postgres materialised view row.

**Producer:** nightly `REFRESH MATERIALIZED VIEW CONCURRENTLY` job.

**Consumer:** `server/services/memoryUtilityQueryService.ts` (read path); B2 UI.

**Shape:** as defined in §4 Phase 2 schema. Key fields:

- `(organisation_id, subaccount_id, agent_id)` — uniqueness key for `CONCURRENTLY` refresh.
- `runs_measured_entries`, `runs_unmeasured_entries` — discriminator for the "not measured vs 0%" banner.
- `entry_utility_30d`, `block_utility_30d` — `NULL` when denominator is zero or measured-runs count is zero; never `0/0`.

**Source-of-truth precedence:** materialised view rows ARE the dashboard contract. Raw `agent_runs` rows are the canonical underlying truth. The build phase verifies that materialised-view aggregates match a spot-check SQL against raw rows during the first refresh.

### 6.4 `AssembleKnowledgeForRunInputs` (extended)

**Type:** TypeScript function input.

**Existing signature:** `assembleKnowledgeForRun(runId: string): Promise<RetrievalResult>`.

**New signature:** unchanged at the call site. Internal change: an optional `queryEmbedding: number[] | null` is computed inside `assembleKnowledgeForRun` when the env flag is enabled.

**Producer:** `agentExecutionService.ts:921-922` (the call site, unchanged).

**Consumer:** `rankCandidates` + `rankByPrecedencePure` (existing functions, receive a non-zero `finalScore` when the embedding is available).

**Nullability:** `queryEmbedding` is null when (a) the flag is off, or (b) embedding fetch failed. Both paths trigger the legacy fallback per the D invariants.

**Behaviour mode:** the env flag is the sole branching primitive. No per-run, per-org, or per-subaccount override in v1.

### 6.5 `RetrievalDegradedReason` (extended enum)

**Type:** TypeScript string-literal union, exported from `retrievalObservabilityServicePure.ts`.

**New values added:**

- `'retrieval.embedding_failed'` — emitted when the query embedding throws or times out.
- `'retrieval.empty_after_semantic'` — emitted when semantic filtering reduces a non-empty pool to zero for a category and the legacy fallback is applied.

**Producer:** `retrievalService.assembleKnowledgeForRun` (two emission sites).

**Consumer:** `retrievalObservabilityService` (which surfaces degraded reasons on the run trace).

---

## 7. Permissions / RLS checklist

### 7.1 `memory_block_version_sources` (new tenant-scoped table — Phase 1)

| Requirement | Status |
|-------------|--------|
| RLS policy in the same migration | ✓ migration `0333` |
| `RLS_PROTECTED_TABLES` manifest entry | ✓ |
| Route guard | ✓ `GET /api/memory-blocks/:id/sources` behind `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` (verified pattern in `server/routes/memoryBlocks.ts:46-49`) |
| Principal-scoped context | n/a — admin/operator route only, not an agent execution path |

The policy uses the canonical three-layer pattern: `current_setting('app.organisation_id', true)::uuid`. `FORCE ROW LEVEL SECURITY` applied for defence-in-depth.

### 7.2 `agent_runs.injected_entry_ids` (new column — Phase 2)

| Requirement | Status |
|-------------|--------|
| RLS posture | inherited from `agent_runs` (already RLS-protected; column addition does not change posture) |
| Manifest entry | n/a — column, not table |
| Route guard | n/a — column read via existing run-detail routes (which are already guarded) |
| Principal-scoped context | inherited |

### 7.3 `mv_memory_utility_30d` (new materialised view — Phase 2)

| Requirement | Status |
|-------------|--------|
| RLS posture | **Materialised views do not enforce RLS by themselves.** The read service `memoryUtilityQueryService.ts` MUST filter rows by `current_setting('app.organisation_id')` in the WHERE clause, or call the view via `withAdminConnection` only from server-side aggregations that are not user-facing. The B2 admin route filters by org before returning. |
| Manifest entry | The view is added to a new `RLS_EXCLUDED_VIEWS` registry if one exists; if not, the convention is `rlsExclusions` in `server/middleware/orgScoping.ts` (per `mv_optimiser_peer_medians` precedent — migration 0277). |
| Route guard | ✓ `GET /api/orgs/:orgId/usage/memory-utility` behind `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW)` (verified pattern in `server/routes/llmUsage.ts:27-30`). |
| Refresh-job posture | The refresh job runs in `withAdminConnection` (multi-tenant refresh in a single transaction). |

### 7.4 Cross-tenant leak class — explicit risks and mitigations

- **Lineage row exposure across organisations.** `memory_block_version_sources.organisation_id` is the RLS predicate. Migrations verify `FORCE RLS`. The route resolves `organisation_id` from the authenticated user's session, not from path params, before joining.
- **Materialised view cross-tenant rows.** The view aggregates per `(organisation_id, subaccount_id, agent_id)`. The read query filters by the session's `organisation_id`. The view itself is not RLS-protected — protection is at the read service.
- **Injected entry IDs across organisations.** `injected_entry_ids` is a column on `agent_runs`, which is already RLS-protected. No new exposure.

---

## 8. Execution model

### 8.1 Phase-by-phase model

| Phase | Operation | Model | Justification |
|-------|-----------|-------|---------------|
| 1 | Lineage row insert at synthesis | Inline / synchronous, inside the same transaction as block-version insert | Cluster array is in scope at the call site; atomicity (block version + lineage rows commit together) is a correctness requirement, not a performance optimisation |
| 1 | `GET /api/memory-blocks/:id/sources` | Inline / synchronous request | Standard admin route; no batch processing |
| 2 | `injected_entry_ids` write | Inline / synchronous, alongside other `agent_runs` writes at run-end / memory-injection time | Already part of the existing run-state write path; adding a column write is not a new transactional boundary |
| 2 | Materialised-view refresh | Queued / asynchronous (pg-boss) — nightly at 03:00 UTC | View must refresh during low-traffic; `REFRESH CONCURRENTLY` requires the view to have a unique index (provided in migration) |
| 3 | Query embedding + cosine score | Inline / synchronous, per agent run | Result must be available before retrieval result is returned to the caller (`agentExecutionService.ts:921-922`) |
| 3 | Degraded-reason event emission | Inline / synchronous, via existing observability service | Mirrors existing degraded-reason emission |
| 4 | `GET /api/orgs/:orgId/usage/memory-utility` | Inline / synchronous request | Standard usage route |

### 8.2 Cache-boundary impact

- Phase 1 lineage inserts and Phase 2 manifest writes do not change the prompt content or the assembly pipeline → no cache boundary impact.
- Phase 3 changes the **selection** of retrieved chunks/blocks but not the rendered shape, so the existing `stablePrefix` / `dynamicSuffix` boundaries at `agentExecutionService.ts:1277` (stablePrefix assignment) and `:1394` (dynamicSuffix assignment) are unaffected. The agent prompt format is unchanged.
- D's selection change does cache-invalidate the `dynamicSuffix` partition when the retrieved set differs run-to-run, which it already does today (recency-ordered). No regression.

### 8.3 Latency budget

- Query embedding adds one OpenAI call per run (when flag is on). Brief estimates ~$0.00002 per call (`text-embedding-3-small`) and ~50–150ms RTT. The brief flags this as negligible cost; latency impact is bounded by the existing run-orchestration timeout envelope.
- Materialised-view refresh runs out-of-band (nightly cron), no inline impact.

---

## 9. Phase sequencing — dependency graph

| Phase | Depends on | Why |
|-------|-----------|-----|
| 1 (A) | — | Independent. Migration + write site + read route + UI tab. |
| 2 (B1) | — | Independent of A. Migration + materialised view + refresh job + write site. |
| 3 (D) | **B1 substrate present and queryable** | The D-Recall and D-Embedding-failure invariants are independent of B1, but the rollout-safety rationale (per brief §7.3 and D-Rollout simplicity) is that the env flag should not flip on until B1 utility numbers are observable. Mechanical dependency: none. Operational dependency: must run after B1 lands. |
| 4 (B2) | **Phase 2 (B1) materialised view present** | Dashboard reads `mv_memory_utility_30d`. Cannot ship before the view exists. May ship in parallel with or after D. |
| Opp. | — | Standalone. May ship alongside any phase or as its own PR. |

### 9.1 No backward dependencies

- Phase 2's `agent_runs.injected_entry_ids` is referenced only by Phase 4's view aggregation and is added in Phase 2 itself.
- Phase 3's cosine-score wiring is internal to `retrievalService.ts` and `retrievalObservabilityServicePure.ts`, both of which exist today.
- Phase 4's read service references the materialised view from Phase 2 — same-phase precondition.

### 9.2 No orphaned deferrals

Every "deferred" item in this spec appears in §10 below. Cross-checked.

### 9.3 No phase-boundary contradictions

- Phase 1 introduces one migration (`0333`); the lineage table is created and used in Phase 1 only.
- Phase 2 introduces one migration (`0334`); the column and view are created and used in Phase 2 and forward.
- Phase 3 introduces no schema changes; pure code edits + new env vars.
- Phase 4 introduces no schema changes; pure UI + read service.

---

## 10. Deferred items

These items are mentioned in prose above (or in the brief) and are intentionally out of v1 scope. Listed here as the single source of truth.

- **`snapshot_excerpt` column on `memory_block_version_sources`.** Defer until privacy review approves a non-sensitive truncation policy. Brief §4 A-Deletion invariant locks v1 to the required metadata only.
- **"Regenerate this block" action on the Sources tab.** Brief explicitly defers in Rev 6.1. Operators correct via existing Diff vs Canonical edit path or by editing source entries and waiting for next weekly synthesis.
- **"View source entry" cross-navigation from Sources tab rows.** Brief Rev 6.1 defers; operators navigate via existing workspace-memory admin page.
- **Bidirectional lineage expander as a hard contract.** Brief P2 makes it optional UI chrome. The join table data supports the reverse query; the UI may ship with the per-row expander disabled if costs aren't trivial. Reverse query is exposed via the optional `?include_reverse=true` payload field per §6.1.
- **Backfill of historical synthesis lineage.** Not possible — clusters were never persisted. Accepted constraint.
- **Per-document utility coverage metric ("loaded in N of last 30 runs").** Described in AKR spec §11 but never built. Out of scope for this spec; tracked separately if reprioritised.
- **7-day / shorter rolling windows on the dashboard.** Brief Rev 6.1 defers; raw per-run rows are queryable via SQL during the dev period.
- **Per-agent dashboard toggle / shadow-mode comparison view.** Brief Rev 6.1 defers; B2 stays focused on utility.
- **Citation-detector accuracy audit.** Brief Rev 6.1 defers; metric is explicitly directional. Re-evaluate when dashboards expose anomalies.
- **Cohere or LLM re-rank on AKR retrieval.** Brief §3 D defers; revisit when B1 utility data is observable.
- **`cite_sources` tool call surfacing source entries to the agent.** Brief §3 A flags as a future agent-facing decision; v1 lineage is operator-only.
- **Multi-hop / SPO entity graph.** Rejected (brief §6) with revisit-criteria documented.
- **Single consolidated memory surface (Mnemo pattern).** Rejected (brief §6).
- **Four-mode staged rollout machinery for D.** Brief D-Rollout simplicity (Rev 6) defers; revisit when codebase approaches live-user readiness.

---

## 11. Self-consistency pass result

Cross-check completed against §2 (framing) and §1 (goals).

- **Goals match implementation.** Each goal in §1.1 maps to exactly one phase in §4 and one set of file changes in §5.
- **Every phase item has a verdict.** Build / Defer / Won't Do — see §10 for the deferred set.
- **Single-source-of-truth claims survive grep.** §6.1 (lineage-row canonical), §6.2 (prompt content canonical for injection), §6.3 (materialised view canonical for dashboard) are pinned.
- **Non-functional claims match the execution model.** D's "negligible cost" is bounded by §8.3 (one embedding call per run). Brief mentions "cosine on chunk embedding"; spec confirms cosine is computed against the existing 1536-dim embeddings without extra storage. No cache-efficiency contradiction.
- **Load-bearing "must" claims all have named mechanisms.** D-Recall invariant → recall fallback path in §4 Phase 3 (named control flow). D-Embedding-failure invariant → try/catch wrapping the embed call in §4 Phase 3. A-Deletion invariant → required columns in §4 Phase 1 schema. A-Run-provenance invariant → required run-provenance columns in §4 Phase 1 schema. B1 denominator invariant → `injected_entry_ids` column + materialised-view discriminator in §4 Phase 2. B1 "not measured vs 0%" → `measured_entries` boolean computed in the view aggregation in §4 Phase 2.

No contradictions identified at author time.

> *Spec-reviewer iteration-1 note (2026-05-13):* the mechanical edits applied during iteration 1 renumbered migrations (`0330→0333`, `0331→0334`), pinned the workspace-memory write-site anchor (`agentExecutionService.ts:1349-1356`), pinned the Sources route guard (`requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`), aligned the Usage route to the existing `/api/orgs/:orgId/usage/<surface>` convention, added the reverse-lineage hash index, and made the NULL-discriminator asymmetry between entry side and block side explicit. The author's self-consistency assertion remains valid post-edit; no contradictions were introduced.

---

## 12. Testing posture

Per `docs/spec-context.md`: `testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`, `frontend_tests: none_for_now`, `api_contract_tests: none_for_now`. The spec adheres.

### 12.1 What gets tested

- **Pure-function vitest tests** for:
  - `memoryBlockSourcesServicePure.test.ts` — payload assembler. Test cases: source entry present, source entry soft-deleted (`isDeleted: true`), source entry hard-deleted (`sourceEntry: null` with captured metadata), source run present, source run absent, both absent, reverse-lineage map population.
  - `memoryUtilityAggregatorPure.test.ts` — ratio math, denominator-zero handling (returns null), measured-vs-unmeasured run partition, edge case of all-pre-migration runs (returns null + non-zero `runs_unmeasured_entries`).
  - `retrievalQueryEmbedderPure.test.ts` — cosine math against fixed test vectors, threshold filter at boundary values (exact match, just below, just above), empty-after-semantic predicate (non-empty pool → empty filtered set), embedding-null fallback, mixed-category fallback (chunks empty → fallback, blocks non-empty → keep).

### 12.2 What does NOT get tested

- **No supertest / API contract tests.** `convention_rejections` in `spec-context.md` forbids these.
- **No frontend tests.** `frontend_tests: none_for_now`.
- **No E2E tests.** `e2e_tests_of_own_app: none_for_now`.
- **No migration safety tests.** `migration_safety_tests: defer_until_live_data_exists`.

### 12.3 Verification beyond unit tests

- `npm run lint`, `npm run typecheck`, `npm run build:client` (when client surfaces touched), `npm run build:server` per per-chunk gate after build.
- RLS coverage gate (`verify-rls-coverage.sh`) verifies the new manifest entry has a matching `CREATE POLICY` in migration 0333.
- RLS contract gate (`verify-rls-contract-compliance.sh`) verifies the new read paths use `getOrgScopedDb()` or `withAdminConnection()` rather than direct `db` imports.
- Test-quality gate (`verify-test-quality.sh`) rejects any `node:test`/`node:assert`/handwritten harness — all new tests use vitest's `expect()` API.

---

## 13. Execution-safety contracts

Per `docs/spec-authoring-checklist.md` §10. Every new write path must declare its idempotency posture, retry classification, and concurrency guard.

### 13.1 Phase 1 — lineage row insert

- **Operation:** insert one row into `memory_block_version_sources` per source entry, alongside the `memory_block_versions` insert in `memoryBlockSynthesisService.ts:195-206`.
- **Idempotency posture:** **key-based.** Unique constraint `(block_version_id, source_entry_id_hash)` enforces exactly-once. Hash is deterministic from the source entry UUID.
- **Retry classification:** **guarded.** Synthesis job is the only producer; retries of the same synthesis run for the same block-version would trip the unique constraint.
- **Concurrency guard:** unique constraint at the DB level catches `23505`. Mapped to **HTTP 200 idempotent hit** on the producer side (no caller — synthesis is internal). If the job itself retries after a partial commit, the second attempt inserts no new rows.
- **Unique constraint → HTTP mapping:** n/a (no external caller path). Internally logged at INFO level: `synthesis.lineage_row_already_exists`.

### 13.2 Phase 1 — GET /api/memory-blocks/:id/sources

- **Operation:** read-only. No idempotency posture or concurrency guard required.
- **Retry classification:** **safe.**

### 13.3 Phase 2 — `injected_entry_ids` column write

- **Operation:** update `agent_runs.injected_entry_ids = <array>` at the memory-composition write site, alongside other per-run writes.
- **Idempotency posture:** **state-based.** The write is a column update on a single run row; the run's lifecycle is already idempotent per the existing run-state state machine (one composition pass per run). Repeat writes during a retry produce the same value.
- **Retry classification:** **safe** (when the run-state machine allows the retry — its existing constraints apply).
- **Concurrency guard:** none required at this layer — the run row's state machine guards against parallel writes from agent execution paths.

### 13.4 Phase 2 — materialised-view refresh

- **Operation:** `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_memory_utility_30d` inside a pg-boss job.
- **Idempotency posture:** **non-idempotent (intentional).** Each refresh fully recomputes the view; consecutive refreshes are equivalent in outcome but non-trivial in compute cost. The job is scheduled, not externally triggered.
- **Retry classification:** **safe.** Re-running produces the same result.
- **Concurrency guard:** `REFRESH CONCURRENTLY` itself serialises with other refreshes on the same view (Postgres-enforced).
- **Terminal event:** job emits `memory_utility.refresh.completed` (success) or `memory_utility.refresh.failed` (terminal failure). Exactly one terminal event per scheduled invocation.

### 13.5 Phase 3 — query embedding fetch

- **Operation:** call `openai.embeddings.create({ model: 'text-embedding-3-small', input: task_description })`.
- **Idempotency posture:** **safe** — embedding is stateless and deterministic per input.
- **Retry classification:** **safe.** Network retries inside the OpenAI client are bounded; outer fallback path emits `retrieval.embedding_failed` on terminal failure.
- **Concurrency guard:** n/a — each run is independent.
- **Terminal event:** retrieval observability emits exactly one of `retrieval.embedding_failed` OR `retrieval.empty_after_semantic` OR (when all goes well) no degraded reason. They are not mutually exclusive: an embedding failure precludes the semantic-empty case for that run.
- **No-silent-partial-success rule:** when one category (chunks) returns empty after semantic filtering and falls back, but the other category (blocks) returns a non-empty filtered set, the run completes successfully and emits `retrieval.empty_after_semantic` with a `category: 'chunks'` field. The result is NOT marked failed; the fallback is the success path.

### 13.6 Phase 3 — `retrievalService.ts` cosine score wiring

- **Operation:** replace `finalScore: 0` literal with `cosineSimilarity(queryEmbedding, candidate.embedding)`.
- **Idempotency posture:** **safe** — pure computation per candidate.
- **Retry classification:** **safe.**
- **Concurrency guard:** n/a.

### 13.7 Phase 4 — `GET /api/orgs/:orgId/usage/memory-utility`

- **Operation:** read-only against the materialised view.
- **Retry classification:** **safe.**

### 13.8 State-machine closure

This spec does not introduce or modify a state machine. No run-state transitions, no approval boundaries, no status enum changes. The `agent_runs` lifecycle is unchanged. The `memory_blocks` status enum is unchanged. The synthesis-job lifecycle is unchanged.

### 13.9 Terminal event audit

The only new emitter is Phase 2's refresh job (`memory_utility.refresh.completed` | `.refresh.failed`) and Phase 3's degraded reasons (`retrieval.embedding_failed`, `retrieval.empty_after_semantic`). All other writes are idempotent column/row writes inside existing transactional boundaries; no new terminal events.

---

## 14. UI section

UI surfaces are advisory at this spec stage. The build phase finalises exact shapes against the mockups.

### 14.1 Sources tab — `MemoryBlockDetailPage`

**Mockup:** [`prototypes/memory-improvements/memory-block-detail.html`](../../../prototypes/memory-improvements/memory-block-detail.html).

**Extension point:** existing tab strip at `client/src/pages/MemoryBlockDetailPage.tsx`. The page currently renders **two** tabs (`Version History`, `Diff vs Canonical` — verified at lines 123-138; the file-header comment at line 4 lists a stale "Content" tab that is not rendered, ignore it). The Sources tab is the **third** tab. Tab IS visible (not just enabled) only when block `source === 'auto_synthesised'`. For all other source types, the tab is hidden — not greyed out.

**Component:** new `MemoryBlockSourcesTab.tsx`. Renders the payload from §6.1. Soft-deleted source rows use strikethrough + reduced opacity (existing CSS conventions per mockup-log Round 1). Bidirectional lineage expander is per-row, collapsed by default.

**Version selector:** dropdown above the source list. Defaults to the latest version. Hitting a historical version re-fetches `/api/memory-blocks/:id/sources?version=N`.

### 14.2 Memory Utility tab — `UsagePage`

**Mockup:** [`prototypes/memory-improvements/citation-utility-dashboard.html`](../../../prototypes/memory-improvements/citation-utility-dashboard.html).

**Extension point:** existing tab strip at `client/src/pages/UsagePage.tsx` lines 220-225. New "Memory Utility" tab alongside the current six tabs: Overview / Agents / Models / Runs / Routing / IEE Execution. (Labels verified against the live page at spec-review iteration 1; the build phase does not need to re-confirm unless the page changes before build.)

**Components:**
- Two canvas-drawn line charts (entry utility, block utility, 30-day rolling). Canvas pattern reused from `prototypes/auto-knowledge-retrieval/agent-data-sources.html`.
- Per-agent breakdown table with inline utility bars, percentage labels, `<10 runs` suppression note.
- One-sentence dismissable banner combining the two caveats: "Runs predating the entry-manifest migration are excluded from utility calculations. Citation detection is heuristic — figures are directional, not absolute."

**No new chart library, no new table primitive, no new canvas component.** Confirmed in mockup-log.

### 14.3 No UI for Phase 3 (D)

D is a backend-only algorithm change. No subaccount-admin settings page, no shadow-comparison panel, no per-run inspection of "what the ranker would have selected." Engineering controls the env flag (`AKR_SEMANTIC_RANKER_ENABLED` + `AKR_RETRIEVAL_THRESHOLD`); operators see only the resulting retrieval quality reflected in B2's dashboard.

The retired mockup `prototypes/memory-improvements/akr-ranker-settings.html` (removed in mockup-log Round 3) is preserved in git history at `ea1fc78` for future re-evaluation if staged rollout becomes relevant.

### 14.4 Design rationale

[`prototypes/memory-improvements/rationale.html`](../../../prototypes/memory-improvements/rationale.html) — operator-facing prose explaining who clicks each surface, why, and whether each is required v1 or has a cheaper non-UI alternative. Not a screen; not in the build inventory. Useful as a Phase 2 review artefact.

---

## 15. Open questions for Phase 2

These are the surviving questions from brief §3 and §4 that the spec deliberately leaves to the build phase. Each is bounded — the build phase decides locally without needing to re-spec.

1. **Query definition for D.** Brief §3 Proposal D names "task description" as the embedding source. The build phase validates this against a sample of dev-environment runs before committing to `text-embedding-3-small` over the task description specifically. If results suggest "task description + master prompt summary" or "task description + recent turn summary" produces materially better cosine matches, the build phase may extend the query construction — but only after recording the alternative in the implementation plan with evidence.
2. **Threshold starting value for D.** `AKR_RETRIEVAL_THRESHOLD = 0.30` is the brief's recommended starting point based on `text-embedding-3-small` cosine-distance norms. Build phase tunes this against a sample of dev-environment runs and B1's measured utility before enabling the flag in any environment. Default may be revised in the implementation plan.
3. **Exact `injected_entry_ids` write site in `agentExecutionService.ts`.** Resolved at spec-review iteration 1: `server/services/agentExecutionService.ts:1349-1356` (immediately after `memoryWithTracking.injectedEntries` is bound). Build phase confirms the file has not drifted before committing the change. No re-spec needed.
4. **Exact permission key for the Sources route.** Resolved at spec-review iteration 1: `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`, matching the pattern at `server/routes/memoryBlocks.ts:46-49`. No build-phase action.
5. **Materialised-view refresh window.** Spec defaults to nightly at 03:00 UTC. Build phase confirms 03:00 doesn't collide with the existing optimiser refresh and other admin-connection jobs; reschedules if conflict.
6. **Reverse-lineage payload performance.** §6.1's `?include_reverse=true` adds a `COUNT(*) GROUP BY source_entry_id_hash` query. Migration `0333` indexes `source_entry_id_hash` via `idx_mbvs_source_entry_hash` (added at spec-review iteration 1) so the reverse query is index-covered. Build phase confirms via EXPLAIN against a sample dataset and ships enabled by default; falls back to a per-row "Expand" affordance only if the EXPLAIN cost is materially worse than expected.
7. **Coverage metric (the AKR-spec §11 item).** Brief §2.2 lists this as never-built. Out of scope here, but the build phase notes whether the materialised-view rows trivially expose coverage (per-document loaded count) — if yes, exposing it via the existing `retrievalObservabilityService` is a small follow-up; if no, defer.
