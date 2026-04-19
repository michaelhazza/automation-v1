-- 0172_clientpulse_canonical_tables.sql
-- ClientPulse Phase 1: 8 new tables supporting Staff Activity Pulse (§2.0b),
-- Integration Fingerprint Scanner (§2.0c), signal observations timeseries,
-- and subscription-tier history.
--
-- Spec: tasks/clientpulse-ghl-gap-analysis.md §9.4, §25.1.
--
-- Six canonical tables (CRM-agnostic, populated by adapter ingestion paths):
--   canonical_subaccount_mutations
--   canonical_conversation_providers
--   canonical_workflow_definitions
--   canonical_tag_definitions
--   canonical_custom_field_definitions
--   canonical_contact_sources
--
-- Two derived tables (written by skills):
--   client_pulse_signal_observations
--   subaccount_tier_history
--
-- All tables:
--   - have organisation_id + RLS policy keyed on current_setting('app.organisation_id')
--   - have a canonical_writer bypass for ingestion-time writes without principal context
--   - honour the §25.1 constraint UNIQUE(organisation_id, provider_type, external_id) for
--     canonical tables (using (organisation_id, subaccount_id, external_id) where provider
--     is implicit in subaccount scope).

BEGIN;

-- ===========================================================================
-- canonical_subaccount_mutations — §2.0b Staff Activity Pulse
-- One row per attribution-bearing write observed in a sub-account.
-- ===========================================================================

CREATE TABLE canonical_subaccount_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  provider_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  mutation_type text NOT NULL,
  source_entity text NOT NULL,
  external_user_id text,
  external_user_kind text NOT NULL DEFAULT 'unknown',
  external_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Note: UNIQUE includes subaccount_id because mutation event IDs are
-- location-scoped in GHL (and most CRMs), not globally unique within the
-- provider. Same external_id can legitimately appear in two sub-accounts
-- under the same org (e.g. two locations independently fire ContactCreate
-- with overlapping numeric IDs). Adding subaccount_id prevents false
-- unique-constraint violations. The §25.1 contract is still honoured: for
-- tables whose external_id IS globally unique (contacts, opportunities),
-- the 3-column form applies. Mutation events are the exception.
CREATE UNIQUE INDEX canonical_subaccount_mutations_unique
  ON canonical_subaccount_mutations (organisation_id, subaccount_id, provider_type, external_id);

CREATE INDEX canonical_subaccount_mutations_sub_occurred_idx
  ON canonical_subaccount_mutations (subaccount_id, occurred_at DESC);

CREATE INDEX canonical_subaccount_mutations_user_idx
  ON canonical_subaccount_mutations (subaccount_id, external_user_id, occurred_at DESC)
  WHERE external_user_id IS NOT NULL;

ALTER TABLE canonical_subaccount_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_subaccount_mutations FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_subaccount_mutations_writer_bypass ON canonical_subaccount_mutations
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY canonical_subaccount_mutations_read ON canonical_subaccount_mutations
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ===========================================================================
-- canonical_conversation_providers — §2.0c fingerprint source
-- ===========================================================================

CREATE TABLE canonical_conversation_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  provider_type text NOT NULL,
  external_id text NOT NULL,
  display_name text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX canonical_conversation_providers_unique
  ON canonical_conversation_providers (organisation_id, provider_type, external_id);

ALTER TABLE canonical_conversation_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_conversation_providers FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_conversation_providers_writer_bypass ON canonical_conversation_providers
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY canonical_conversation_providers_read ON canonical_conversation_providers
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ===========================================================================
-- canonical_workflow_definitions — §2.0c fingerprint source
-- ===========================================================================

CREATE TABLE canonical_workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  provider_type text NOT NULL,
  external_id text NOT NULL,
  display_name text,
  action_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  outbound_webhook_targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at_upstream timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX canonical_workflow_definitions_unique
  ON canonical_workflow_definitions (organisation_id, provider_type, external_id);

ALTER TABLE canonical_workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_workflow_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_workflow_definitions_writer_bypass ON canonical_workflow_definitions
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY canonical_workflow_definitions_read ON canonical_workflow_definitions
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ===========================================================================
-- canonical_tag_definitions — §2.0c fingerprint source
-- ===========================================================================

CREATE TABLE canonical_tag_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  provider_type text NOT NULL,
  external_id text NOT NULL,
  tag_name text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX canonical_tag_definitions_unique
  ON canonical_tag_definitions (organisation_id, provider_type, external_id);

ALTER TABLE canonical_tag_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_tag_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_tag_definitions_writer_bypass ON canonical_tag_definitions
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY canonical_tag_definitions_read ON canonical_tag_definitions
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ===========================================================================
-- canonical_custom_field_definitions — §2.0c fingerprint source
-- ===========================================================================

CREATE TABLE canonical_custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  provider_type text NOT NULL,
  external_id text NOT NULL,
  field_key text NOT NULL,
  field_type text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX canonical_custom_field_definitions_unique
  ON canonical_custom_field_definitions (organisation_id, provider_type, external_id);

ALTER TABLE canonical_custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_custom_field_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_custom_field_definitions_writer_bypass ON canonical_custom_field_definitions
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY canonical_custom_field_definitions_read ON canonical_custom_field_definitions
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ===========================================================================
-- canonical_contact_sources — §2.0c fingerprint source
-- ===========================================================================

CREATE TABLE canonical_contact_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  provider_type text NOT NULL,
  external_id text NOT NULL,
  source_value text NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1,
  observed_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX canonical_contact_sources_unique
  ON canonical_contact_sources (organisation_id, provider_type, external_id);

ALTER TABLE canonical_contact_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_contact_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_contact_sources_writer_bypass ON canonical_contact_sources
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY canonical_contact_sources_read ON canonical_contact_sources
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ===========================================================================
-- client_pulse_signal_observations — derived timeseries (§4.3)
-- ===========================================================================

CREATE TABLE client_pulse_signal_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  connector_config_id uuid,
  signal_slug text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  numeric_value double precision,
  json_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_run_id uuid,
  availability text NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX client_pulse_signal_observations_sub_slug_idx
  ON client_pulse_signal_observations (subaccount_id, signal_slug, observed_at DESC);

CREATE INDEX client_pulse_signal_observations_org_slug_idx
  ON client_pulse_signal_observations (organisation_id, signal_slug, observed_at DESC);

ALTER TABLE client_pulse_signal_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_pulse_signal_observations FORCE ROW LEVEL SECURITY;

CREATE POLICY client_pulse_signal_observations_writer_bypass ON client_pulse_signal_observations
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY client_pulse_signal_observations_read ON client_pulse_signal_observations
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ===========================================================================
-- subaccount_tier_history — §2, signal #6 tier migration timeseries
-- ===========================================================================

CREATE TABLE subaccount_tier_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  tier text NOT NULL,
  tier_source text NOT NULL DEFAULT 'api',
  plan_id text,
  active boolean,
  next_billing_date timestamptz,
  source_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subaccount_tier_history_sub_observed_idx
  ON subaccount_tier_history (subaccount_id, observed_at DESC);

ALTER TABLE subaccount_tier_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccount_tier_history FORCE ROW LEVEL SECURITY;

CREATE POLICY subaccount_tier_history_writer_bypass ON subaccount_tier_history
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY subaccount_tier_history_read ON subaccount_tier_history
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

COMMIT;
