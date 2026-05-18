CREATE TABLE IF NOT EXISTS workspace_memory_entry_tier_transitions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  subaccount_id uuid NOT NULL,
  old_tier text NOT NULL,
  new_tier text NOT NULL,
  config_version integer NOT NULL,
  signal_contributions jsonb NOT NULL,
  promotion_mode text NOT NULL,
  approved_by_user_id uuid NULL,
  job_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_memory_entry_tier_transitions_promotion_mode_check
    CHECK (promotion_mode IN ('auto', 'operator-approved'))
);

ALTER TABLE workspace_memory_entry_tier_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memory_entry_tier_transitions FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_memory_entry_tier_transitions_organisation_isolation ON workspace_memory_entry_tier_transitions
  FOR ALL
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE INDEX workspace_memory_entry_tier_transitions_lookup_idx
  ON workspace_memory_entry_tier_transitions (organisation_id, subaccount_id, entry_id, created_at DESC);
