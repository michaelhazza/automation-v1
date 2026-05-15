-- Reversal of 0360_voice_profiles_schema_align.sql
-- WARNING: dropping source_config and refresh_config loses all data in those columns.
-- Steps are reversed: drop new index, rename back, drop new columns, re-create old index.

-- Step 1: Drop the index that references the new column names
DROP INDEX IF EXISTS voice_profiles_state_refresh_idx;

-- Step 2: Rename columns back to their original names
ALTER TABLE voice_profiles RENAME COLUMN sample_size TO sample_count;
ALTER TABLE voice_profiles RENAME COLUMN last_derived_at TO last_refreshed_at;
ALTER TABLE voice_profiles RENAME COLUMN opt_out_at TO opted_out_at;

-- Step 3: Drop the new jsonb columns (data is lost on revert)
ALTER TABLE voice_profiles DROP COLUMN IF EXISTS source_config;
ALTER TABLE voice_profiles DROP COLUMN IF EXISTS refresh_config;

-- Step 4: Re-create the old partial index with the original column names
CREATE INDEX IF NOT EXISTS voice_profiles_state_refresh_idx ON voice_profiles(state, last_refreshed_at) WHERE state IN ('ready', 'pending') AND opted_out_at IS NULL;
