-- 3-run throughput comparison: ON CONFLICT DO NOTHING vs pg_advisory_xact_lock
-- Uses the 200 seeded actions (2 orgs x 100).
-- Each run: seed -> time -> clean -> repeat.

\timing off

-- ============================================================
-- PATH A: ON CONFLICT DO NOTHING (new path) — 3 runs
-- ============================================================

\echo '--- NEW PATH: ON CONFLICT DO NOTHING ---'

DO $$
DECLARE
  t_start timestamptz; t_end timestamptz; elapsed_ms numeric; rows_written int;
  run int;
BEGIN
  FOR run IN 1..3 LOOP
    -- Clean before each run
    DELETE FROM intervention_outcomes WHERE intervention_type_slug = 'perf-test';

    t_start := clock_timestamp();

    INSERT INTO intervention_outcomes (
      organisation_id, intervention_id, account_id, intervention_type_slug,
      measured_after_hours, band_changed, execution_failed
    )
    SELECT
      a.organisation_id,
      a.id,
      CASE
        WHEN a.organisation_id = 'bde54a4f-7e21-418a-8741-4a5f2a143a00'
          THEN '22200001-0000-0000-0000-000000000001'::uuid
        ELSE '22200001-0000-0000-0000-000000000002'::uuid
      END,
      'perf-test', 24, false, false
    FROM actions a
    WHERE a.idempotency_key LIKE 'perf-test-%'
    ON CONFLICT (intervention_id) DO NOTHING;

    GET DIAGNOSTICS rows_written = ROW_COUNT;
    t_end := clock_timestamp();
    elapsed_ms := extract(epoch from (t_end - t_start)) * 1000;

    RAISE NOTICE '[NEW] Run %: % rows written in %.2f ms (%.0f rows/sec total, %.0f rows/sec/org)',
      run, rows_written, elapsed_ms,
      rows_written / (elapsed_ms / 1000.0),
      (rows_written / 2.0) / (elapsed_ms / 1000.0);
  END LOOP;
END $$;

-- Final clean
DELETE FROM intervention_outcomes WHERE intervention_type_slug = 'perf-test';

-- ============================================================
-- PATH B: pg_advisory_xact_lock row-by-row (legacy path) — 3 runs
-- ============================================================

\echo '--- LEGACY PATH: pg_advisory_xact_lock row-by-row ---'

DO $$
DECLARE
  t_start timestamptz; t_end timestamptz; elapsed_ms numeric; rows_written int;
  run int; r record;
BEGIN
  FOR run IN 1..3 LOOP
    -- Clean before each run
    DELETE FROM intervention_outcomes WHERE intervention_type_slug = 'perf-test';

    rows_written := 0;
    t_start := clock_timestamp();

    FOR r IN
      SELECT
        a.id as action_id, a.organisation_id,
        CASE
          WHEN a.organisation_id = 'bde54a4f-7e21-418a-8741-4a5f2a143a00'
            THEN '22200001-0000-0000-0000-000000000001'::uuid
          ELSE '22200001-0000-0000-0000-000000000002'::uuid
        END as account_id
      FROM actions a
      WHERE a.idempotency_key LIKE 'perf-test-%'
      ORDER BY a.organisation_id, a.executed_at
    LOOP
      -- Advisory lock per org (same logic as legacy job)
      PERFORM pg_advisory_xact_lock(
        hashtext(r.organisation_id::text || '::measureInterventionOutcomes')::bigint
      );

      -- Claim-verify: NOT EXISTS check
      IF NOT EXISTS (
        SELECT 1 FROM intervention_outcomes WHERE intervention_id = r.action_id
      ) THEN
        INSERT INTO intervention_outcomes (
          organisation_id, intervention_id, account_id, intervention_type_slug,
          measured_after_hours, band_changed, execution_failed
        ) VALUES (
          r.organisation_id, r.action_id, r.account_id,
          'perf-test', 24, false, false
        );
        rows_written := rows_written + 1;
      END IF;
    END LOOP;

    t_end := clock_timestamp();
    elapsed_ms := extract(epoch from (t_end - t_start)) * 1000;

    RAISE NOTICE '[LEGACY] Run %: % rows written in %.2f ms (%.0f rows/sec total, %.0f rows/sec/org)',
      run, rows_written, elapsed_ms,
      rows_written / (elapsed_ms / 1000.0),
      (rows_written / 2.0) / (elapsed_ms / 1000.0);
  END LOOP;
END $$;

-- Final clean
DELETE FROM intervention_outcomes WHERE intervention_type_slug = 'perf-test';

-- ============================================================
-- Concurrency check: insert 200 rows, then check for duplicates
-- ============================================================
\echo '--- CONCURRENCY CHECK: no duplicate intervention_id rows ---'

INSERT INTO intervention_outcomes (
  organisation_id, intervention_id, account_id, intervention_type_slug,
  measured_after_hours, band_changed, execution_failed
)
SELECT
  a.organisation_id, a.id,
  CASE
    WHEN a.organisation_id = 'bde54a4f-7e21-418a-8741-4a5f2a143a00'
      THEN '22200001-0000-0000-0000-000000000001'::uuid
    ELSE '22200001-0000-0000-0000-000000000002'::uuid
  END,
  'perf-test', 24, false, false
FROM actions a
WHERE a.idempotency_key LIKE 'perf-test-%'
ON CONFLICT (intervention_id) DO NOTHING;

-- Try to insert duplicates (should be silently ignored)
INSERT INTO intervention_outcomes (
  organisation_id, intervention_id, account_id, intervention_type_slug,
  measured_after_hours, band_changed, execution_failed
)
SELECT
  a.organisation_id, a.id,
  CASE
    WHEN a.organisation_id = 'bde54a4f-7e21-418a-8741-4a5f2a143a00'
      THEN '22200001-0000-0000-0000-000000000001'::uuid
    ELSE '22200001-0000-0000-0000-000000000002'::uuid
  END,
  'perf-test', 24, false, false
FROM actions a
WHERE a.idempotency_key LIKE 'perf-test-%'
ON CONFLICT (intervention_id) DO NOTHING;

SELECT
  'total_rows' as check_name,
  count(*) as value,
  CASE WHEN count(*) = 200 THEN 'PASS' ELSE 'FAIL' END as result
FROM intervention_outcomes WHERE intervention_type_slug = 'perf-test'
UNION ALL
SELECT
  'duplicate_intervention_ids',
  count(*),
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM (
  SELECT intervention_id, COUNT(*) as cnt
  FROM intervention_outcomes
  WHERE intervention_type_slug = 'perf-test'
  GROUP BY intervention_id
  HAVING COUNT(*) > 1
) dups;

-- Cleanup
DELETE FROM intervention_outcomes WHERE intervention_type_slug = 'perf-test';

\echo 'Done.'
