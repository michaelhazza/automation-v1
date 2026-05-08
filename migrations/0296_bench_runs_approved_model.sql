-- 0296_bench_runs_approved_model.sql
-- Extends bench_runs with approved_model_id and summary (spec §6.6 schema gap from 0293).
-- Adds 'partial' to the state enum check constraint for partial completion.

-- approved_model_id: set atomically during F5 approval (benchRunService.approve)
ALTER TABLE bench_runs ADD COLUMN IF NOT EXISTS approved_model_id text;

-- summary: JSONB snapshot of BenchSummary (recommendedModelId + reason) written
-- by benchExecuteJob after all results are computed.
ALTER TABLE bench_runs ADD COLUMN IF NOT EXISTS summary jsonb;

-- Widen state CHECK to include 'partial' (bench completed some but not all samples).
ALTER TABLE bench_runs DROP CONSTRAINT IF EXISTS bench_runs_state_check;
ALTER TABLE bench_runs
  ADD CONSTRAINT bench_runs_state_check
    CHECK (state IN ('pending', 'running', 'completed', 'partial', 'failed', 'cancelled'));
