-- Migration 0343: 30-day memory-utility materialised view + null-stable unique
-- index + initial refresh. Numbered 0343 (after main's 0335-0342 from PR #288)
-- so the file is single-purpose and applies independently from migration 0334.
-- Spec §4 Phase 2. MV is multi-tenant by design; defended at the route layer
-- in server/routes/memoryUtility.ts (path-org / session-org 403 check).

CREATE MATERIALIZED VIEW mv_memory_utility_30d AS
  WITH per_run AS (
    SELECT
      r.id AS run_id,
      r.organisation_id,
      r.subaccount_id,
      r.agent_id,
      r.created_at,
      -- Guarded jsonb_array_length: legacy or malformed rows (non-array
      -- JSONB values) would otherwise throw and brick the nightly refresh.
      -- Per ChatGPT plan-review R2 F2.
      CASE
        WHEN r.injected_entry_ids IS NULL THEN NULL
        WHEN jsonb_typeof(r.injected_entry_ids) = 'array' THEN jsonb_array_length(r.injected_entry_ids)
        ELSE 0
      END AS injected_entry_count,
      CASE
        WHEN jsonb_typeof(r.cited_entry_ids) = 'array' THEN jsonb_array_length(r.cited_entry_ids)
        ELSE 0
      END AS cited_entry_count,
      CASE
        WHEN jsonb_typeof(r.applied_memory_block_ids) = 'array' THEN jsonb_array_length(r.applied_memory_block_ids)
        ELSE 0
      END AS injected_block_count,
      CASE
        WHEN jsonb_typeof(r.applied_memory_block_citations) = 'array' THEN jsonb_array_length(r.applied_memory_block_citations)
        ELSE 0
      END AS cited_block_count,
      -- Per R3 T2: only true JSONB arrays count as "measured". NULL or any
      -- malformed non-array value falls into the unmeasured bucket so the
      -- semantic distinction stays clean:
      --   NULL / malformed  = unmeasured / not trustworthy
      --   []                = measured empty
      --   [ids...]          = measured with entries
      (jsonb_typeof(r.injected_entry_ids) = 'array') AS measured_entries
    FROM agent_runs r
    WHERE r.created_at > now() - interval '30 days'
  ),
  -- Aggregate sums, COALESCEd to 0 to preserve the count vs ratio semantic
  -- distinction: a NULL aggregate from SUM-on-empty-filter would blur "no
  -- measured runs" (which should be 0 count + NULL ratio) with "no data
  -- whatsoever". Per ChatGPT plan-review R2 F1.
  per_agent_sums AS (
    SELECT
      organisation_id, subaccount_id, agent_id,
      COUNT(*) FILTER (WHERE measured_entries) AS runs_measured_entries,
      COUNT(*) FILTER (WHERE NOT measured_entries) AS runs_unmeasured_entries,
      COALESCE(SUM(injected_entry_count) FILTER (WHERE measured_entries), 0) AS total_injected_entries,
      COALESCE(SUM(cited_entry_count) FILTER (WHERE measured_entries), 0) AS total_cited_entries,
      COALESCE(SUM(injected_block_count), 0) AS total_injected_blocks,
      COALESCE(SUM(cited_block_count), 0) AS total_cited_blocks
    FROM per_run
    GROUP BY organisation_id, subaccount_id, agent_id
  )
  SELECT
    organisation_id, subaccount_id, agent_id,
    runs_measured_entries,
    runs_unmeasured_entries,
    total_injected_entries,
    total_cited_entries,
    total_injected_blocks,
    total_cited_blocks,
    -- Ratios stay NULL when their denominator is zero — UI renders gaps,
    -- never zeros. Per spec §6.6 NULL-vs-zero convention.
    CASE WHEN total_injected_entries > 0
         THEN total_cited_entries::numeric / total_injected_entries
         ELSE NULL END AS entry_utility_30d,
    CASE WHEN total_injected_blocks > 0
         THEN total_cited_blocks::numeric / total_injected_blocks
         ELSE NULL END AS block_utility_30d
  FROM per_agent_sums;

-- Null-stable unique index for REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- PostgreSQL treats NULL != NULL in plain unique indexes, so two rows with
-- the same (org, agent) but NULL subaccount_id would collide on uniqueness
-- at refresh-time. COALESCE collapses NULL to a deterministic sentinel
-- (UUID nil) so every row in the MV has a unique key. The CASE expressions
-- in the SELECT mean every aggregate group is independent of NULL-handling
-- in the index.
CREATE UNIQUE INDEX idx_mv_memory_utility_30d
  ON mv_memory_utility_30d (
    organisation_id,
    COALESCE(subaccount_id, '00000000-0000-0000-0000-000000000000'::uuid),
    agent_id
  );

-- Initial population (likely 0 rows on a fresh DB; expected per spec R10).
-- Plain REFRESH (not CONCURRENTLY) on first run is required — CONCURRENTLY
-- needs at least one prior population.
REFRESH MATERIALIZED VIEW mv_memory_utility_30d;
