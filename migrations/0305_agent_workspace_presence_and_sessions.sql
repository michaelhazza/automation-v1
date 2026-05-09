CREATE TABLE agent_observations (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  subaccount_id               UUID         REFERENCES subaccounts(id),
  agent_id                    UUID         NOT NULL REFERENCES agents(id),
  -- ON DELETE SET NULL: nullable pointer to the run that produced this
  -- observation. Observation outlives the run via its own retention TTL.
  run_id                      UUID         REFERENCES agent_runs(id) ON DELETE SET NULL,
  event_id                    UUID         NOT NULL REFERENCES agent_execution_events(id),
  observation_type            TEXT         NOT NULL,
  body                        TEXT         NOT NULL,
  body_truncated              BOOLEAN      NOT NULL DEFAULT FALSE,
  metadata                    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  supersedes_observation_id   UUID         REFERENCES agent_observations(id),
  is_pinned                   BOOLEAN      NOT NULL DEFAULT FALSE,
  pinned_by                   UUID         REFERENCES users(id),
  pinned_at                   TIMESTAMP WITH TIME ZONE,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  idempotency_key             TEXT         NOT NULL,
  CONSTRAINT agent_observations_type_enum
    CHECK (observation_type IN ('learned','detected','decided','flagged','produced')),
  CONSTRAINT agent_observations_body_size_cap
    CHECK (octet_length(body) <= 8192),
  CONSTRAINT agent_observations_dedupe UNIQUE (idempotency_key)
);

CREATE INDEX agent_observations_agent_created_idx
  ON agent_observations (agent_id, created_at DESC);
CREATE INDEX agent_observations_run_idx
  ON agent_observations (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX agent_observations_event_idx
  ON agent_observations (event_id);
CREATE INDEX agent_observations_pinned_idx
  ON agent_observations (agent_id, created_at DESC) WHERE is_pinned = TRUE;
CREATE INDEX agent_observations_supersedes_idx
  ON agent_observations (supersedes_observation_id) WHERE supersedes_observation_id IS NOT NULL;

ALTER TABLE agent_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_observations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_observations_org_isolation ON agent_observations;
CREATE POLICY agent_observations_org_isolation ON agent_observations
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE OR REPLACE FUNCTION agent_observations_immutability_guard()
  RETURNS TRIGGER AS $$
DECLARE
  mode TEXT := current_setting('app.allow_observation_mutation', true);
BEGIN
  IF mode IS NULL OR mode = '' THEN
    RAISE EXCEPTION 'agent_observations is append-only; create a superseding row instead'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF mode <> 'retention_prune' THEN
      RAISE EXCEPTION 'agent_observations DELETE forbidden outside retention_prune mode'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF mode = 'pin' THEN
      IF (OLD.body IS DISTINCT FROM NEW.body)
         OR (OLD.observation_type IS DISTINCT FROM NEW.observation_type)
         OR (OLD.event_id IS DISTINCT FROM NEW.event_id)
         OR (OLD.run_id IS DISTINCT FROM NEW.run_id)
         OR (OLD.metadata IS DISTINCT FROM NEW.metadata)
         OR (OLD.supersedes_observation_id IS DISTINCT FROM NEW.supersedes_observation_id)
         OR (OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key)
         OR (OLD.created_at IS DISTINCT FROM NEW.created_at)
      THEN
        RAISE EXCEPTION 'agent_observations pin mode only allows is_pinned, pinned_by, pinned_at columns'
          USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'agent_observations UPDATE forbidden in mode %', mode
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_observations_immutability
  BEFORE UPDATE OR DELETE ON agent_observations
  FOR EACH ROW EXECUTE FUNCTION agent_observations_immutability_guard();

CREATE TABLE iee_sessions (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  subaccount_id               UUID         REFERENCES subaccounts(id),
  agent_id                    UUID         NOT NULL REFERENCES agents(id),
  -- ON DELETE CASCADE: an iee_session belongs to its run. If the run is
  -- deleted (retention prune, integration-test cleanup), the session row
  -- has no anchor and should be removed too.
  run_id                      UUID         NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL: parent_run_id is a nullable sub-agent delegation
  -- pointer. If the parent run is pruned, the child session retains its own
  -- lifecycle.
  parent_run_id               UUID         REFERENCES agent_runs(id) ON DELETE SET NULL,
  container_handle            TEXT,
  status                      TEXT         NOT NULL,
  idle_timeout_seconds        INTEGER      NOT NULL DEFAULT 300,
  last_heartbeat_at           TIMESTAMP WITH TIME ZONE,
  started_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  released_at                 TIMESTAMP WITH TIME ZONE,
  release_reason              TEXT,
  summary                     JSONB,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT iee_sessions_status_enum
    CHECK (status IN ('active','idle','torn_down','failed')),
  CONSTRAINT iee_sessions_release_reason_enum
    CHECK (release_reason IS NULL OR release_reason IN ('run_completed','idle_timeout','orphan_cleanup','failed','operator_cancelled'))
);

CREATE INDEX iee_sessions_agent_started_idx ON iee_sessions (agent_id, started_at DESC);
CREATE INDEX iee_sessions_status_active_idx ON iee_sessions (status) WHERE status IN ('active','idle');
CREATE INDEX iee_sessions_orphan_scan_idx
  ON iee_sessions (last_heartbeat_at) WHERE status IN ('active','idle');

ALTER TABLE iee_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE iee_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS iee_sessions_org_isolation ON iee_sessions;
CREATE POLICY iee_sessions_org_isolation ON iee_sessions
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE TABLE agent_presence_projections (
  agent_id                    UUID         PRIMARY KEY REFERENCES agents(id),
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  subaccount_id               UUID         REFERENCES subaccounts(id),
  presence_state              TEXT         NOT NULL,
  presence_subtitle           TEXT,
  -- ON DELETE SET NULL on every nullable pointer column below — projections
  -- are derived current-state views; if a referenced row is gone, the pointer
  -- nulls out so the projection survives. Without these clauses, deleting a
  -- run or event blocks on the projection's dangling pointer.
  active_run_id               UUID         REFERENCES agent_runs(id) ON DELETE SET NULL,
  current_focus_text          TEXT,
  current_focus_event_id      UUID         REFERENCES agent_execution_events(id) ON DELETE SET NULL,
  last_event_id               UUID         REFERENCES agent_execution_events(id) ON DELETE SET NULL,
  last_event_run_id           UUID         REFERENCES agent_runs(id) ON DELETE SET NULL,
  last_event_run_seq          INTEGER      NOT NULL DEFAULT 0,
  last_event_timestamp        TIMESTAMP WITH TIME ZONE,
  next_run_at                 TIMESTAMP WITH TIME ZONE,
  scheduled_label             TEXT,
  degraded_reason             TEXT,
  degraded_base_state         TEXT,
  degraded_entered_at         TIMESTAMP WITH TIME ZONE,
  degraded_oscillation_count  INTEGER      NOT NULL DEFAULT 0,
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_presence_state_enum
    CHECK (presence_state IN ('idle','running','waiting_on_human','waiting_on_dependency','scheduled','degraded','failed')),
  CONSTRAINT agent_presence_degraded_reason_enum
    CHECK (degraded_reason IS NULL
           OR degraded_reason IN ('event_stream_delayed','worker_heartbeat_stale','focus_source_unavailable')),
  CONSTRAINT agent_presence_degraded_base_state_enum
    CHECK (degraded_base_state IS NULL
           OR degraded_base_state IN ('idle','running','waiting_on_human','waiting_on_dependency','scheduled')),
  CONSTRAINT agent_presence_degraded_reason_consistency
    CHECK ((presence_state = 'degraded') = (degraded_reason IS NOT NULL)),
  CONSTRAINT agent_presence_degraded_base_state_consistency
    CHECK ((presence_state = 'degraded') = (degraded_base_state IS NOT NULL))
);

CREATE INDEX agent_presence_projections_subaccount_idx
  ON agent_presence_projections (subaccount_id, presence_state, updated_at DESC);
CREATE INDEX agent_presence_projections_workspace_widget_idx
  ON agent_presence_projections (organisation_id, presence_state) WHERE presence_state IN ('waiting_on_human','running','failed','scheduled');

ALTER TABLE agent_presence_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_presence_projections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_presence_projections_org_isolation ON agent_presence_projections;
CREATE POLICY agent_presence_projections_org_isolation ON agent_presence_projections
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE TABLE agent_working_time_rollups (
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  subaccount_id               UUID         REFERENCES subaccounts(id),
  agent_id                    UUID         NOT NULL REFERENCES agents(id),
  bucket_date                 DATE         NOT NULL,
  working_time_seconds        BIGINT       NOT NULL DEFAULT 0,
  successful_runs             INTEGER      NOT NULL DEFAULT 0,
  failed_runs                 INTEGER      NOT NULL DEFAULT 0,
  partial_runs                INTEGER      NOT NULL DEFAULT 0,
  total_run_count             INTEGER      NOT NULL DEFAULT 0,
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organisation_id, agent_id, bucket_date)
);

ALTER TABLE agent_working_time_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_working_time_rollups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_working_time_rollups_org_isolation ON agent_working_time_rollups;
CREATE POLICY agent_working_time_rollups_org_isolation ON agent_working_time_rollups
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE TABLE agent_working_time_event_ledger (
  -- ON DELETE CASCADE: this row is the derived "I processed this event"
  -- idempotency marker for the working-time pipeline. If the source event is
  -- deleted (retention prune, integration-test cleanup), the marker must go
  -- too — it has no meaning without its anchor.
  event_id                    UUID         PRIMARY KEY REFERENCES agent_execution_events(id) ON DELETE CASCADE,
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  agent_id                    UUID         NOT NULL REFERENCES agents(id),
  applied_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_working_time_event_ledger_agent_idx
  ON agent_working_time_event_ledger (agent_id, applied_at DESC);

ALTER TABLE agent_working_time_event_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_working_time_event_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_working_time_event_ledger_org_isolation ON agent_working_time_event_ledger;
CREATE POLICY agent_working_time_event_ledger_org_isolation ON agent_working_time_event_ledger
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

ALTER TABLE iee_artifacts
  -- ON DELETE SET NULL: agent_run_id is a nullable pointer ("the run that
  -- produced this artifact"). The artifact itself can outlive the run.
  ADD COLUMN agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  -- ON DELETE SET NULL: producing_event_id is a nullable pointer ("the event
  -- that produced this artifact"). If the source event is pruned, the artifact
  -- itself outlives it — null out the pointer instead of cascading.
  ADD COLUMN producing_event_id UUID REFERENCES agent_execution_events(id) ON DELETE SET NULL,
  ADD COLUMN produced_version_id UUID;

CREATE INDEX iee_artifacts_agent_run_idx ON iee_artifacts (agent_run_id) WHERE agent_run_id IS NOT NULL;
CREATE INDEX iee_artifacts_event_idx     ON iee_artifacts (producing_event_id) WHERE producing_event_id IS NOT NULL;
CREATE INDEX iee_artifacts_version_idx   ON iee_artifacts (produced_version_id) WHERE produced_version_id IS NOT NULL;
