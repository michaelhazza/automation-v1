-- 0311_canonical_ticket_drafts.sql
-- Support Desk canonical: AI-proposed reply drafts with state machine + dispatch history.
-- Spec: tasks/builds/support-desk-canonical/spec.md §5.5, §8, §11, §12, §14.1, §14.7, §18
--
-- Also closes the deferred FK on canonical_ticket_messages.source_draft_id (deferred from C3/0310).

CREATE TABLE canonical_ticket_drafts (
  -- identity
  id                              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                 UUID         NOT NULL REFERENCES organisations(id),
  subaccount_id                   UUID                  REFERENCES subaccounts(id),
  connector_config_id             UUID         NOT NULL REFERENCES connector_configs(id),
  ticket_id                       UUID         NOT NULL REFERENCES canonical_tickets(id),

  -- proposed content
  proposed_body_text              TEXT         NOT NULL,
  proposed_body_html              TEXT,
  proposed_visibility             TEXT         NOT NULL,
  proposed_actions                JSONB,

  -- state machine
  status                          TEXT         NOT NULL,

  -- three-phase dispatch columns
  action_idempotency_key          TEXT,
  dispatching_started_at          TIMESTAMP WITH TIME ZONE,
  last_reconciliation_at          TIMESTAMP WITH TIME ZONE,
  reconciliation_attempt_count    INTEGER      NOT NULL DEFAULT 0,

  -- provenance
  created_by_agent_run_id         UUID                  REFERENCES agent_runs(id),
  model_version                   TEXT,
  prompt_version                  TEXT,

  -- review trail
  reviewer_user_id                UUID                  REFERENCES users(id),
  reviewed_at                     TIMESTAMP WITH TIME ZONE,
  review_notes                    TEXT,

  -- outbound link
  sent_message_id                 UUID                  REFERENCES canonical_ticket_messages(id),

  -- lifecycle
  expires_at                      TIMESTAMP WITH TIME ZONE,
  created_at                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- CHECK: status enum
  CONSTRAINT canonical_ticket_drafts_status_enum
    CHECK (status IN (
      'draft',
      'awaiting_review',
      'dispatching',
      'needs_reconciliation',
      'manually_marked_sent',
      'sent',
      'rejected',
      'failed',
      'expired',
      'superseded'
    )),

  -- CHECK: proposed_visibility enum
  CONSTRAINT canonical_ticket_drafts_proposed_visibility_enum
    CHECK (proposed_visibility IN ('public', 'internal')),

  -- State-invariant: sent => sent_message_id NOT NULL
  CONSTRAINT canonical_ticket_drafts_sent_invariant
    CHECK (
      (status = 'sent' AND sent_message_id IS NOT NULL)
      OR status <> 'sent'
    ),

  -- State-invariant: manually_marked_sent => sent_message_id NULL
  CONSTRAINT canonical_ticket_drafts_manually_marked_sent_invariant
    CHECK (
      (status = 'manually_marked_sent' AND sent_message_id IS NULL)
      OR status <> 'manually_marked_sent'
    )
);

-- Regular index: lookup by ticket + status
CREATE INDEX canonical_ticket_drafts_org_ticket_status_idx
  ON canonical_ticket_drafts (organisation_id, ticket_id, status);

-- Partial index: operator review queue (awaiting action)
CREATE INDEX canonical_ticket_drafts_operator_queue_idx
  ON canonical_ticket_drafts (organisation_id, status, created_at)
  WHERE status IN ('awaiting_review', 'needs_reconciliation', 'manually_marked_sent');

-- Partial UNIQUE: idempotency key uniqueness (NULLs excluded — intentional per spec §14.1)
CREATE UNIQUE INDEX canonical_ticket_drafts_idempotency_key_uniq
  ON canonical_ticket_drafts (connector_config_id, action_idempotency_key)
  WHERE action_idempotency_key IS NOT NULL;

-- Partial index: expiry scanner
CREATE INDEX canonical_ticket_drafts_expiry_scanner_idx
  ON canonical_ticket_drafts (organisation_id, expires_at)
  WHERE status IN ('draft', 'awaiting_review');

-- Partial UNIQUE: soft-uniqueness for same-run proposals (NULLs in created_by_agent_run_id
-- are not equal in Postgres — two rows with NULL agent_run_id do NOT violate this constraint)
CREATE UNIQUE INDEX canonical_ticket_drafts_soft_unique_proposal_idx
  ON canonical_ticket_drafts (organisation_id, ticket_id, created_by_agent_run_id, proposed_visibility)
  WHERE status IN ('draft', 'awaiting_review');

-- RLS: tenant isolation
ALTER TABLE canonical_ticket_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_ticket_drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canonical_ticket_drafts_org_isolation ON canonical_ticket_drafts;
CREATE POLICY canonical_ticket_drafts_org_isolation ON canonical_ticket_drafts
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

-- ─── Deferred FK + index: canonical_ticket_messages.source_draft_id (from C3/0310) ─────────────
--
-- The column exists without a FK since 0310. Now that canonical_ticket_drafts exists, wire it up.

ALTER TABLE canonical_ticket_messages
  ADD CONSTRAINT canonical_ticket_messages_source_draft_id_fkey
  FOREIGN KEY (source_draft_id) REFERENCES canonical_ticket_drafts(id);

CREATE INDEX canonical_ticket_messages_source_draft_idx
  ON canonical_ticket_messages (organisation_id, source_draft_id)
  WHERE source_draft_id IS NOT NULL;
