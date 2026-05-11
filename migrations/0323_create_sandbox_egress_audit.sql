-- Migration 0323: Create sandbox_egress_audit table
-- Spec §20.6, §9.1. Per-egress-decision rows; written only when
-- policy.network is non-'none'. Full payload logging is explicitly prohibited.
-- Retention: 180 days (spec §17.3).

CREATE TABLE sandbox_egress_audit (
  id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sandbox_execution_id    UUID        NOT NULL REFERENCES sandbox_executions(id) ON DELETE CASCADE,
  organisation_id         UUID        NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id           UUID        NOT NULL,
  run_id                  UUID        NOT NULL,

  -- Egress decision metadata
  destination_class       TEXT        NOT NULL CHECK (destination_class IN ('internal', 'customer', 'vendor', 'unknown')),
  destination_host        TEXT        NOT NULL,
  destination_port        INTEGER     NOT NULL,
  destination_protocol    TEXT        NOT NULL CHECK (destination_protocol IN ('http', 'https', 'tcp', 'other')),

  -- Which issued credential alias was on the call path.
  -- Never the credential value — alias only (spec §9.1).
  credential_context_alias TEXT,

  outcome                 TEXT        NOT NULL CHECK (outcome IN ('allow', 'deny')),
  decision_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Which allow-list entry matched, if any (spec §20.6)
  policy_rule_id          TEXT
);

CREATE INDEX sandbox_egress_audit_org_decision_at_idx
  ON sandbox_egress_audit (organisation_id, decision_at DESC);
CREATE INDEX sandbox_egress_audit_execution_id_idx
  ON sandbox_egress_audit (sandbox_execution_id);

ALTER TABLE sandbox_egress_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_egress_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY sandbox_egress_audit_org_isolation ON sandbox_egress_audit
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
