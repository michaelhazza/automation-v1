-- REQ-C4: Align voice_profiles columns with PA-V1 spec §7.4 + §21.1.
-- Renames: sample_count→sample_size, last_refreshed_at→last_derived_at, opted_out_at→opt_out_at
-- Adds: source_config jsonb NOT NULL DEFAULT '{}', refresh_config jsonb NOT NULL DEFAULT '{}'
--
-- Order: drop partial index that references renamed columns FIRST, then rename, then add, then re-create.

-- Step 1: Drop the partial index that references last_refreshed_at and opted_out_at
DROP INDEX IF EXISTS voice_profiles_state_refresh_idx;

-- Step 2: Rename columns
ALTER TABLE voice_profiles RENAME COLUMN sample_count TO sample_size;
ALTER TABLE voice_profiles RENAME COLUMN last_refreshed_at TO last_derived_at;
ALTER TABLE voice_profiles RENAME COLUMN opted_out_at TO opt_out_at;

-- Step 3: Add new jsonb columns
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS source_config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS refresh_config jsonb NOT NULL DEFAULT '{}';

-- Step 4: Re-create the partial index with the new column names
CREATE INDEX IF NOT EXISTS voice_profiles_state_refresh_idx ON voice_profiles(state, last_derived_at) WHERE state IN ('ready', 'pending') AND opt_out_at IS NULL;
