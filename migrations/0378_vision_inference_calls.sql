-- 0378_vision_inference_calls.sql
-- browser-vision-grounding spec §8.5, §9, §12.6.
--
-- Per-call ledger for browser vision grounding. Harvested by
-- visionGroundingService.harvestVisionCalls() at IEE finalisation; rolled up
-- by visionInferenceCostRollupJob into cost_aggregates.
--
-- RLS: FORCE ROW LEVEL SECURITY with two-argument current_setting form
-- (fails closed when GUC unset — returns no rows instead of throwing).

CREATE TABLE IF NOT EXISTS vision_inference_calls (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES organisations(id),
  subaccount_id      uuid REFERENCES subaccounts(id),
  run_id             uuid NOT NULL REFERENCES agent_runs(id),
  iee_run_id         uuid NOT NULL REFERENCES iee_runs(id),
  model_id           text NOT NULL,
  cost_cents         integer NOT NULL DEFAULT 0,
  latency_ms         integer NOT NULL,
  image_size_bytes   bigint  NOT NULL,
  action_type        text NOT NULL,
  fallback_trigger   boolean NOT NULL DEFAULT false,
  step_index         integer NOT NULL,
  call_index         integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vision_inference_calls_iee_run_step_call_uniq
  ON vision_inference_calls (iee_run_id, step_index, call_index);

CREATE INDEX IF NOT EXISTS vision_inference_calls_org_created_idx
  ON vision_inference_calls (organisation_id, created_at);

CREATE INDEX IF NOT EXISTS vision_inference_calls_run_idx
  ON vision_inference_calls (run_id);

ALTER TABLE vision_inference_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE vision_inference_calls FORCE ROW LEVEL SECURITY;

CREATE POLICY vision_inference_calls_org_isolation ON vision_inference_calls
  FOR ALL
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);
