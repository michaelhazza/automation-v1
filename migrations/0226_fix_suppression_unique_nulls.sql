-- Fix system_incident_suppressions unique index so that two global suppressions
-- (organisation_id IS NULL) for the same fingerprint are treated as a conflict.
-- PostgreSQL treats NULL != NULL in standard unique indexes, which means
-- ON CONFLICT (fingerprint, organisation_id) never fires when org_id IS NULL.
-- NULLS NOT DISTINCT (PG 15+) makes NULL == NULL for uniqueness purposes.

-- Step 1: De-duplicate existing rows before recreating the unique index.
-- Under the old (NULLS DISTINCT) index, suppressIncident() could insert
-- multiple global-suppression rows for the same fingerprint because
-- ON CONFLICT never matched. The NULLS NOT DISTINCT CREATE UNIQUE INDEX
-- below would fail on such dev/staging DBs without this cleanup step.
--
-- Survivor selection: keep the NEWEST row per (fingerprint, organisation_id)
-- group. suppressIncident() overwrites reason/expires_at on conflict, so the
-- newest row carries the operator's most recent intent (e.g. a 24h rule
-- later renewed to `permanent`). Keeping the oldest row would silently
-- revert that renewal.
--
-- Metadata rollup into the survivor:
--   suppressed_count   = SUM over the group so feedback counters are preserved.
--   last_suppressed_at = MAX over the group, treating NULL as "never hit"
--                        (NULL stays NULL if every row in the group was NULL).
WITH ranked AS (
  SELECT
    id,
    fingerprint,
    organisation_id,
    suppressed_count,
    last_suppressed_at,
    ROW_NUMBER() OVER (
      PARTITION BY fingerprint, organisation_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM system_incident_suppressions
),
rollup AS (
  -- Aggregate across ALL rows in the group (including the survivor) so the
  -- UPDATE below fully replaces the survivor's counter + timestamp rather
  -- than double-counting the survivor's existing suppressed_count.
  SELECT fingerprint, organisation_id,
         SUM(suppressed_count)::int AS total_suppressed,
         MAX(last_suppressed_at) AS max_last_suppressed
  FROM ranked
  GROUP BY fingerprint, organisation_id
  HAVING COUNT(*) > 1
)
UPDATE system_incident_suppressions AS s
SET suppressed_count   = r.total_suppressed,
    last_suppressed_at = r.max_last_suppressed
FROM rollup r, ranked k
WHERE k.fingerprint = r.fingerprint
  AND k.organisation_id IS NOT DISTINCT FROM r.organisation_id
  AND k.rn = 1
  AND s.id = k.id;

DELETE FROM system_incident_suppressions
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY fingerprint, organisation_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM system_incident_suppressions
  ) sub WHERE rn > 1
);

-- Step 2: Recreate the unique index with NULLS NOT DISTINCT semantics.
DROP INDEX IF EXISTS system_incident_suppressions_fp_org_unique;

CREATE UNIQUE INDEX system_incident_suppressions_fp_org_unique
  ON system_incident_suppressions (fingerprint, organisation_id)
  NULLS NOT DISTINCT;
