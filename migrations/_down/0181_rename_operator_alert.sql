-- 0181_rename_operator_alert.sql — rollback
--
-- Reverses migration 0181. Rewrites the slugs back + restores the old partial
-- index predicate (matches migration 0178's original predicate).

BEGIN;

-- 1. Rewrite action_type values back to the legacy slug.
UPDATE actions
SET action_type = 'clientpulse.operator_alert'
WHERE action_type = 'notify_operator';

-- 2. Rewrite intervention_outcomes.intervention_type_slug back.
UPDATE intervention_outcomes
SET intervention_type_slug = 'clientpulse.operator_alert'
WHERE intervention_type_slug = 'notify_operator';

-- 3. Rebuild the partial index with the legacy predicate.
DROP INDEX IF EXISTS actions_intervention_outcome_pending_idx;
CREATE INDEX IF NOT EXISTS actions_intervention_outcome_pending_idx
  ON actions (organisation_id, executed_at)
  WHERE action_type IN (
          'crm.fire_automation',
          'crm.send_email',
          'crm.send_sms',
          'crm.create_task',
          'clientpulse.operator_alert'
        )
    AND status IN ('completed', 'failed');

COMMIT;
