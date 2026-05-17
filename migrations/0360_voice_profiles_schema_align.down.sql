-- Reversal of 0360_voice_profiles_schema_align.sql
-- WARNING: dropping source_config and refresh_config loses all data in those columns.
-- Steps are reversed: drop new index, rename back, drop new columns, re-create old index.
--
-- Idempotent (guarded RENAMEs + IF EXISTS / IF NOT EXISTS) because scripts/migrate.ts:37
-- treats every *.sql in migrations/ as a forward migration to apply in lexical order, and
-- `0360_*.down.sql` sorts BEFORE `0360_*.sql` (the `.` before `down` < the terminating
-- `.sql`). Without guards, fresh-DB CI runs fail on the down migration before the up gets
-- a chance. Convention matches all existing *.down.sql files in this directory; see
-- KNOWLEDGE.md [2026-05-15] entry + migrations/0358_skill_merge_consolidation.down.sql.

-- Step 1: Drop the index that references the new column names (no-op if not yet created)
DROP INDEX IF EXISTS voice_profiles_state_refresh_idx;

-- Step 2: Rename columns back to their original names — guarded so the rename only fires
-- when the renamed-to-new column actually exists (i.e. the up migration has run).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'voice_profiles' AND column_name = 'sample_size') THEN
    ALTER TABLE voice_profiles RENAME COLUMN sample_size TO sample_count;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'voice_profiles' AND column_name = 'last_derived_at') THEN
    ALTER TABLE voice_profiles RENAME COLUMN last_derived_at TO last_refreshed_at;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'voice_profiles' AND column_name = 'opt_out_at') THEN
    ALTER TABLE voice_profiles RENAME COLUMN opt_out_at TO opted_out_at;
  END IF;
END $$;

-- Step 3: Drop the new jsonb columns (data is lost on revert; no-op if columns absent)
ALTER TABLE voice_profiles DROP COLUMN IF EXISTS source_config;
ALTER TABLE voice_profiles DROP COLUMN IF EXISTS refresh_config;

-- Step 4: Re-create the old partial index with the original column names
CREATE INDEX IF NOT EXISTS voice_profiles_state_refresh_idx ON voice_profiles(state, last_refreshed_at) WHERE state IN ('ready', 'pending') AND opted_out_at IS NULL;
