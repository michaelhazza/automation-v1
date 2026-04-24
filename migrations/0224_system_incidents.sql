-- Phase 0: System Incidents monitoring foundation.
-- Creates three tables: system_incidents, system_incident_events,
-- system_incident_suppressions.
--
-- RLS: These tables intentionally BYPASS the normal RLS row-level policy
-- framework (Option A per spec §7.4). Access is gated at the route and service
-- layers by requireSystemAdmin. No per-row RLS policies are added.
-- IMPORTANT: any code that reads these tables MUST either be sysadmin-gated
-- at the route layer OR perform explicit service-layer filtering — there is no
-- RLS safety net below.

-- ─── system_incidents ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_incidents (
  id                      uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Identity & dedupe
  fingerprint             text          NOT NULL,
  source                  text          NOT NULL,   -- route|job|agent|connector|skill|llm|synthetic|self
  severity                text          NOT NULL DEFAULT 'medium',  -- low|medium|high|critical
  classification          text          NOT NULL DEFAULT 'system_fault',  -- user_fault|system_fault|persistent_defect

  -- Status lifecycle
  status                  text          NOT NULL DEFAULT 'open',  -- open|investigating|remediating|resolved|suppressed|escalated

  -- Counts & timestamps
  first_seen_at           timestamptz   NOT NULL DEFAULT now(),
  last_seen_at            timestamptz   NOT NULL DEFAULT now(),
  occurrence_count        integer       NOT NULL DEFAULT 1,

  -- Scope (nullable — system-level incidents have no org)
  organisation_id         uuid          REFERENCES organisations(id),
  subaccount_id           uuid          REFERENCES subaccounts(id),

  -- Resource linkage
  affected_resource_kind  text,    -- e.g. 'agent_run', 'flow_run', 'integration_connection'
  affected_resource_id    text,    -- UUID or other string identifier

  -- Error content (snapshot of the most recent occurrence)
  error_code              text,
  summary                 text          NOT NULL,   -- max 240 chars
  latest_error_detail     jsonb,
  latest_stack            text,
  latest_correlation_id   text,

  -- Human lifecycle metadata
  acknowledged_at         timestamptz,
  acknowledged_by_user_id uuid          REFERENCES users(id),
  resolved_at             timestamptz,
  resolved_by_user_id     uuid          REFERENCES users(id),
  resolution_note         text,
  linked_pr_url           text,

  -- Escalation metadata
  escalated_at            timestamptz,
  escalated_task_id       uuid          REFERENCES tasks(id),
  escalation_count        integer       NOT NULL DEFAULT 0,
  previous_task_ids       uuid[]        NOT NULL DEFAULT '{}',

  -- Test-incident flag — set by admin UI test-trigger; hidden from default list
  is_test_incident        boolean       NOT NULL DEFAULT false,

  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);

-- One active incident per fingerprint. Resolved/suppressed rows stay in the
-- table but do not block new 'open' rows on the same fingerprint.
CREATE UNIQUE INDEX IF NOT EXISTS system_incidents_active_fingerprint_idx
  ON system_incidents (fingerprint)
  WHERE status IN ('open', 'investigating', 'remediating', 'escalated');

-- List-view composite: status + severity + last_seen_at covers the default sort
CREATE INDEX IF NOT EXISTS system_incidents_status_severity_idx
  ON system_incidents (status, severity, last_seen_at);

CREATE INDEX IF NOT EXISTS system_incidents_source_idx
  ON system_incidents (source, status);

CREATE INDEX IF NOT EXISTS system_incidents_org_idx
  ON system_incidents (organisation_id, status)
  WHERE organisation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS system_incidents_classification_idx
  ON system_incidents (classification, status);

-- ─── system_incident_events ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_incident_events (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  incident_id         uuid        NOT NULL REFERENCES system_incidents(id) ON DELETE CASCADE,

  event_type          text        NOT NULL,
  -- occurrence | status_change | ack | resolve | suppress | unsuppress
  -- escalation | escalation_blocked | resolution_linked_to_task
  -- notification_surfaced | remediation_attempt | remediation_outcome
  -- diagnosis | note

  actor_kind          text        NOT NULL,  -- system|user|agent
  actor_user_id       uuid        REFERENCES users(id),
  actor_agent_run_id  uuid        REFERENCES agent_runs(id),

  payload             jsonb,           -- event-type-specific structured data
  correlation_id      text,

  occurred_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_incident_events_incident_time_idx
  ON system_incident_events (incident_id, occurred_at);

CREATE INDEX IF NOT EXISTS system_incident_events_event_type_idx
  ON system_incident_events (event_type, occurred_at);

-- ─── system_incident_suppressions ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_incident_suppressions (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fingerprint           text        NOT NULL,
  organisation_id       uuid        REFERENCES organisations(id),  -- null = suppress everywhere
  reason                text        NOT NULL,   -- mandatory rationale
  expires_at            timestamptz,            -- null = permanent suppression

  -- Visibility feedback counters (v3)
  suppressed_count      integer     NOT NULL DEFAULT 0,
  last_suppressed_at    timestamptz,

  created_by_user_id    uuid        NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_incident_suppressions_fingerprint_idx
  ON system_incident_suppressions (fingerprint, expires_at);

-- One suppression rule per fingerprint per org-or-global scope
CREATE UNIQUE INDEX IF NOT EXISTS system_incident_suppressions_fp_org_unique
  ON system_incident_suppressions (fingerprint, organisation_id);
