-- Add concurrency policy defaults to agents table (org-level defaults inherited by subaccount agents)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS concurrency_policy text NOT NULL DEFAULT 'skip_if_active';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS catch_up_policy text NOT NULL DEFAULT 'skip_missed';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS catch_up_cap integer NOT NULL DEFAULT 3;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_concurrent_runs integer NOT NULL DEFAULT 1;

-- Add constraints matching the subaccount_agents table
ALTER TABLE agents ADD CONSTRAINT agents_concurrency_policy_check
  CHECK (concurrency_policy IN ('skip_if_active', 'coalesce_if_active', 'always_enqueue'));
ALTER TABLE agents ADD CONSTRAINT agents_catch_up_policy_check
  CHECK (catch_up_policy IN ('skip_missed', 'enqueue_missed_with_cap'));
ALTER TABLE agents ADD CONSTRAINT agents_max_concurrent_runs_check
  CHECK (max_concurrent_runs BETWEEN 1 AND 10);
