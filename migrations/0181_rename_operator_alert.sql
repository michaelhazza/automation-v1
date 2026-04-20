-- 0181_rename_operator_alert.sql
-- Session 1 / Chunk A.1 — rename the platform primitive slug.
--
-- Per spec §3 (tasks/builds/clientpulse/session-1-foundation-spec.md) +
-- contract (i) in §1.3: platform primitives are module-agnostic. The operator
-- notification primitive (writes a notification row + fans out to in-app /
-- email / slack) is not ClientPulse-specific and moves to the un-namespaced
-- canonical slug 'notify_operator' alongside peers like 'send_email' and
-- 'create_task'.
--
-- Step 3 rebuilds actions_intervention_outcome_pending_idx to reference the
-- new slug in its partial-index predicate (replaces migration 0178's definition).

BEGIN;

-- 1. Rewrite all existing action_type values.
UPDATE actions
SET action_type = 'notify_operator'
WHERE action_type = 'clientpulse.operator_alert';

-- 2. Rewrite intervention_outcomes.intervention_type_slug the same way.
UPDATE intervention_outcomes
SET intervention_type_slug = 'notify_operator'
WHERE intervention_type_slug = 'clientpulse.operator_alert';

-- 3. Rewrite the partial index predicate that lists the 5 intervention action types.
DROP INDEX IF EXISTS actions_intervention_outcome_pending_idx;
CREATE INDEX IF NOT EXISTS actions_intervention_outcome_pending_idx
  ON actions (organisation_id, executed_at)
  WHERE action_type IN (
          'crm.fire_automation',
          'crm.send_email',
          'crm.send_sms',
          'crm.create_task',
          'notify_operator'
        )
    AND status IN ('completed', 'failed');

COMMIT;
