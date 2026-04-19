-- 0178_clientpulse_interventions_phase_4.sql
-- ClientPulse Phase 4 — intervention pipeline indexes.
--
-- Per locked contract (b), interventions are `actions` rows + intervention_outcomes
-- rows; no new tables. This migration adds two indexes on actions.metadata_json
-- to keep the proposer + outcome-measurement queries cheap at scale:
--
--   1. actions_metadata_template_slug_idx — expression index on
--      metadata_json->>'triggerTemplateSlug' so the proposer can quickly check
--      "has this template been proposed for this subaccount in the cooldown
--      window?".
--
--   2. actions_intervention_outcome_pending_idx — partial composite index on
--      (organisation_id, executed_at) filtered to completed rows of the 5
--      intervention primitive types. Drives the hourly measureInterventionOutcomeJob
--      query without a bitmap scan on a hot table.

BEGIN;

-- 0. Extend intervention_outcomes with band-change attribution (B2 ship gate).
ALTER TABLE intervention_outcomes
  ADD COLUMN IF NOT EXISTS band_before text,
  ADD COLUMN IF NOT EXISTS band_after text,
  ADD COLUMN IF NOT EXISTS band_changed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS execution_failed boolean NOT NULL DEFAULT false;

-- 1. Proposer query — template-cooldown check
CREATE INDEX IF NOT EXISTS actions_metadata_template_slug_idx
  ON actions ((metadata_json->>'triggerTemplateSlug'))
  WHERE metadata_json ? 'triggerTemplateSlug';

-- 2. Outcome-measurement query — pending interventions older than 1h, younger than 14d
CREATE INDEX IF NOT EXISTS actions_intervention_outcome_pending_idx
  ON actions (organisation_id, executed_at)
  WHERE action_type IN (
          'crm.fire_automation',
          'crm.send_email',
          'crm.send_sms',
          'crm.create_task',
          'clientpulse.operator_alert'
        )
    AND status = 'completed';

COMMIT;
