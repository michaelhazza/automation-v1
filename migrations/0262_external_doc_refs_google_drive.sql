-- 0262_external_doc_refs_google_drive.sql
-- Adds Google Drive as a live external document reference provider.

BEGIN;

-- 1. New columns on reference_documents ---------------------------------------
ALTER TABLE reference_documents
  ADD COLUMN IF NOT EXISTS external_provider         varchar(64),
  ADD COLUMN IF NOT EXISTS external_connection_id    uuid REFERENCES integration_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_file_id          varchar(1024),
  ADD COLUMN IF NOT EXISTS external_file_name        varchar(512),
  ADD COLUMN IF NOT EXISTS external_file_mime_type   varchar(256),
  ADD COLUMN IF NOT EXISTS attached_by_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attachment_order          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_state          varchar(32);

-- CHECK constraint: google_drive rows must have all external fields populated.
ALTER TABLE reference_documents
  ADD CONSTRAINT reference_documents_google_drive_required_fields
  CHECK (
    source_type <> 'google_drive'
    OR (
      external_connection_id  IS NOT NULL
      AND external_file_id    IS NOT NULL
      AND external_file_mime_type IS NOT NULL
      AND attachment_state    IS NOT NULL
    )
  );

-- Idempotency for attach: a Drive file may only be attached once per connection.
CREATE UNIQUE INDEX IF NOT EXISTS reference_documents_external_uniq
  ON reference_documents (external_file_id, external_connection_id)
  WHERE source_type = 'google_drive';

-- 2. New column on document_bundle_attachments --------------------------------
ALTER TABLE document_bundle_attachments
  ADD COLUMN IF NOT EXISTS fetch_failure_policy varchar(32) NOT NULL DEFAULT 'tolerant';

ALTER TABLE document_bundle_attachments
  ADD CONSTRAINT document_bundle_attachments_fetch_failure_policy_valid
  CHECK (fetch_failure_policy IN ('tolerant', 'strict', 'best_effort'));

-- 3. New column on agent_data_sources -----------------------------------------
ALTER TABLE agent_data_sources
  ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES integration_connections(id) ON DELETE SET NULL;

-- google_drive rows require a connection_id; other source types must not have one.
ALTER TABLE agent_data_sources
  ADD CONSTRAINT agent_data_sources_google_drive_connection_required
  CHECK (
    (source_type = 'google_drive' AND connection_id IS NOT NULL)
    OR (source_type <> 'google_drive')
  );

-- 4. document_cache table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS document_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id       uuid NOT NULL REFERENCES subaccounts(id)   ON DELETE CASCADE,
  provider            varchar(64)   NOT NULL,
  file_id             varchar(1024) NOT NULL,
  connection_id       uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  content             text NOT NULL,
  revision_id         varchar(512),
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  content_size_tokens integer NOT NULL,
  content_hash        varchar(64) NOT NULL,
  resolver_version    integer NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, file_id, connection_id)
);

CREATE INDEX IF NOT EXISTS document_cache_subaccount_idx
  ON document_cache (subaccount_id);

ALTER TABLE document_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_cache_isolation ON document_cache
  USING (subaccount_id = current_setting('app.current_subaccount_id')::uuid);

-- 5. document_fetch_events table ---------------------------------------------
CREATE TABLE IF NOT EXISTS document_fetch_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id            uuid NOT NULL REFERENCES subaccounts(id)   ON DELETE CASCADE,
  reference_id             uuid,
  reference_type           varchar(32) NOT NULL,
  run_id                   uuid,
  fetched_at               timestamptz NOT NULL DEFAULT now(),
  cache_hit                boolean NOT NULL,
  provider                 varchar(64) NOT NULL,
  doc_name                 varchar(512),
  revision_id              varchar(512),
  tokens_used              integer NOT NULL,
  tokens_before_truncation integer,
  resolver_version         integer NOT NULL,
  failure_reason           varchar(64),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_fetch_events_subaccount_idx
  ON document_fetch_events (subaccount_id);
CREATE INDEX IF NOT EXISTS document_fetch_events_reference_idx
  ON document_fetch_events (reference_id, reference_type);
CREATE INDEX IF NOT EXISTS document_fetch_events_run_idx
  ON document_fetch_events (run_id);

-- Idempotent failure writes (invariant #12): a (reference, run, failure_reason) triple
-- writes at most one row. Allows tight retry loops in runContextLoader without
-- polluting observability. Only applies to failure rows tied to a run.
CREATE UNIQUE INDEX IF NOT EXISTS document_fetch_events_failure_idem_uniq
  ON document_fetch_events (reference_id, run_id, failure_reason)
  WHERE run_id IS NOT NULL AND failure_reason IS NOT NULL;

ALTER TABLE document_fetch_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_fetch_events_isolation ON document_fetch_events
  USING (subaccount_id = current_setting('app.current_subaccount_id')::uuid);

COMMIT;
