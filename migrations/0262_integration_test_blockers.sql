-- 0262_integration_test_blockers.sql
--
-- Consolidates two unblockers surfaced when the integration_tests CI job was
-- flipped to load-bearing (TI-005 closeout, branch
-- claude/integration-tests-fix-2026-04-30):
--
-- 1. Drop the set_updated_at_review_items trigger.
--    review_items has no `updated_at` column, but migration 0032 wired the
--    generic update_updated_at_column() trigger over every UPDATE. Every
--    UPDATE on review_items fails with "record \"new\" has no field
--    \"updated_at\"" — reviewService.approveItem / rejectItem can never
--    commit. The repro chain that surfaced this is reviewServiceIdempotency
--    timing out at 30 s on every concurrent-decision case.
--
-- 2. Extend playbook_step_runs_step_type_chk to allow the modern step types.
--    The constraint was authored in 0076 with the original five types
--    (`prompt`, `agent_call`, `user_input`, `approval`, `conditional`).
--    Three more were added to the workflow type system since (`agent_decision`,
--    `action_call`, `invoke_automation` — see server/lib/workflow/types.ts)
--    but the DB constraint was never extended. The repro chain that surfaced
--    this is workflowEngineApprovalResumeDispatch failing all three tests
--    with `playbook_step_runs_step_type_chk` violation on `invoke_automation`
--    inserts.

BEGIN;

-- =============================================================================
-- 1. review_items has no updated_at column → drop the misconfigured trigger.
-- =============================================================================

DROP TRIGGER IF EXISTS set_updated_at_review_items ON review_items;

-- =============================================================================
-- 2. workflow_step_runs.step_type — add the three modern types.
-- =============================================================================

ALTER TABLE workflow_step_runs
  DROP CONSTRAINT IF EXISTS playbook_step_runs_step_type_chk;

ALTER TABLE workflow_step_runs
  ADD CONSTRAINT playbook_step_runs_step_type_chk CHECK (step_type IN (
    'prompt',
    'agent_call',
    'user_input',
    'approval',
    'conditional',
    'agent_decision',
    'action_call',
    'invoke_automation'
  ));

COMMIT;
