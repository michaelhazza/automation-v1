-- migrations/0150_pr_review_hardening.sql
-- Items 1–7: lifecycle timestamps, provenance columns, processing log,
-- clarification flag, active version pointer, quality_score trigger guard.
-- Single migration — no prior migrations from this branch have been applied.

-- ============================================================
-- Items 1 & 2 & 7: workspace_memory_entries additions
-- ============================================================
ALTER TABLE workspace_memory_entries
  ADD COLUMN embedding_computed_at  TIMESTAMPTZ,
  ADD COLUMN quality_computed_at    TIMESTAMPTZ,
  ADD COLUMN decay_computed_at      TIMESTAMPTZ,
  ADD COLUMN provenance_source_type TEXT
    CHECK (provenance_source_type IN
      ('agent_run','manual','playbook','drop_zone','synthesis')),
  ADD COLUMN provenance_source_id   UUID,
  ADD COLUMN provenance_confidence  REAL
    CHECK (provenance_confidence IS NULL
        OR (provenance_confidence >= 0 AND provenance_confidence <= 1)),
  ADD COLUMN is_unverified          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN quality_score_updater  TEXT
    CHECK (quality_score_updater IS NULL
        OR quality_score_updater IN
           ('initial_score','system_decay_job','system_utility_job'));

-- Backfill: tag all pre-existing rows so the trigger allows future job updates.
UPDATE workspace_memory_entries
   SET quality_score_updater = 'initial_score'
 WHERE quality_score_updater IS NULL;

-- ============================================================
-- Item 3: drop_zone_processing_log
-- ============================================================
CREATE TABLE drop_zone_processing_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_audit_id UUID        NOT NULL
    REFERENCES drop_zone_upload_audit(id) ON DELETE CASCADE,
  step            TEXT        NOT NULL
    CHECK (step IN ('parse','synthesize','index')),
  status          TEXT        NOT NULL
    CHECK (status IN ('started','completed','failed')),
  error_code      TEXT,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX drop_zone_processing_log_upload_idx
  ON drop_zone_processing_log(upload_audit_id, created_at);

-- ============================================================
-- Item 4: memory_review_queue — requires_clarification
-- ============================================================
ALTER TABLE memory_review_queue
  ADD COLUMN requires_clarification BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- Item 6: memory_blocks — active_version_id pointer
-- ============================================================
ALTER TABLE memory_blocks
  ADD COLUMN active_version_id UUID
    REFERENCES memory_block_versions(id) ON DELETE SET NULL;

CREATE INDEX memory_blocks_active_version_idx
  ON memory_blocks(active_version_id)
  WHERE active_version_id IS NOT NULL;

-- ============================================================
-- Item 7: quality_score trigger guard
-- Fires BEFORE UPDATE; raises if quality_score changes but
-- quality_score_updater is not an allowed value.
-- ============================================================
CREATE OR REPLACE FUNCTION check_quality_score_updater()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.quality_score IS DISTINCT FROM NEW.quality_score THEN
    IF NEW.quality_score_updater IS NULL
    OR NEW.quality_score_updater NOT IN
         ('initial_score','system_decay_job','system_utility_job')
    THEN
      RAISE EXCEPTION
        'quality_score update requires quality_score_updater '
        'to be initial_score, system_decay_job, or system_utility_job '
        '(got: %)',
        COALESCE(NEW.quality_score_updater, 'NULL');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: this trigger fires on UPDATE only. INSERTs are intentionally excluded
-- because the application layer (workspaceMemoryService.ts) always sets
-- quality_score_updater = 'initial_score' at insert time (Task 4 of the
-- 2026-04-16 PR review hardening plan). The backfill UPDATE above covers all
-- pre-existing rows so the trigger will never see a NULL updater on update.
CREATE TRIGGER quality_score_guard
  BEFORE UPDATE ON workspace_memory_entries
  FOR EACH ROW EXECUTE FUNCTION check_quality_score_updater();
