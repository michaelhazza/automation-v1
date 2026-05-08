-- 0297_bench_runs_state_awaiting.down.sql

ALTER TABLE bench_runs DROP CONSTRAINT IF EXISTS bench_runs_state_check;
ALTER TABLE bench_runs
  ADD CONSTRAINT bench_runs_state_check
    CHECK (state IN ('pending', 'running', 'completed', 'partial', 'failed', 'cancelled'));
