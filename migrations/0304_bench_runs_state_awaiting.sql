-- 0304_bench_runs_state_awaiting.sql
-- Extends bench_runs state CHECK to include 'awaiting_confirm' and 'awaiting_approval'.
-- Trust & Verification Layer spec §12.4 (F5 atomicity, estimate → confirm → run flow).
--
-- awaiting_confirm: bench created by estimate(), waiting for operator to call run()
-- awaiting_approval: bench completed, waiting for operator to approve a candidate model

ALTER TABLE bench_runs DROP CONSTRAINT IF EXISTS bench_runs_state_check;
ALTER TABLE bench_runs
  ADD CONSTRAINT bench_runs_state_check
    CHECK (state IN (
      'pending',
      'awaiting_confirm',
      'running',
      'awaiting_approval',
      'completed',
      'partial',
      'failed',
      'cancelled'
    ));
