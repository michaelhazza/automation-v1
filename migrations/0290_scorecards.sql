-- 0290_scorecards.sql
-- Trust & Verification Layer — Chunk 6, spec §6.3, §7, §12.1
--
-- Creates scorecards: evaluation rubrics scoped to system / org / subaccount.
-- System-scope rows are readable cross-tenant (SELECT policy widens) but
-- NEVER writable from an org-context session (INSERT/UPDATE/DELETE are
-- strictly org-isolated). Service layer must filter scope further before
-- returning to callers.

CREATE TABLE IF NOT EXISTS scorecards (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id       uuid        REFERENCES organisations (id),       -- NULL for system scope
  scope_type            text        NOT NULL
    CONSTRAINT scorecards_scope_type_check
      CHECK (scope_type IN ('system', 'org', 'subaccount')),
  scope_id              uuid,                                             -- NULL for system scope
  name                  text        NOT NULL,
  description           text,
  quality_checks        jsonb       NOT NULL DEFAULT '[]',
  share_with_subaccounts boolean    NOT NULL DEFAULT false,
  judge_model_id        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE INDEX scorecards_org_idx   ON scorecards (organisation_id);
CREATE INDEX scorecards_scope_idx ON scorecards (scope_type, scope_id);

-- Partial unique index — one active scorecard name per scope.
-- Cannot live inside CREATE TABLE as a table-level UNIQUE constraint because
-- PostgreSQL does not support a WHERE clause on table-level UNIQUE constraints.
CREATE UNIQUE INDEX scorecards_scope_name_uniq
  ON scorecards (scope_type, scope_id, name)
  NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

-- RLS — FORCE; split policies to prevent org-context mutation of system rows.
ALTER TABLE scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecards FORCE ROW LEVEL SECURITY;

-- SELECT: org-isolated rows + system-scope rows readable by any authenticated context.
DROP POLICY IF EXISTS scorecards_select ON scorecards;
CREATE POLICY scorecards_select ON scorecards
  FOR SELECT
  USING (
    (
      current_setting('app.organisation_id', true) IS NOT NULL
      AND current_setting('app.organisation_id', true) <> ''
      AND organisation_id = current_setting('app.organisation_id', true)::uuid
    )
    OR organisation_id IS NULL
  );

-- INSERT — strictly org-isolated (no system-scope widening).
DROP POLICY IF EXISTS scorecards_insert ON scorecards;
CREATE POLICY scorecards_insert ON scorecards
  FOR INSERT
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- UPDATE — strictly org-isolated.
DROP POLICY IF EXISTS scorecards_update ON scorecards;
CREATE POLICY scorecards_update ON scorecards
  FOR UPDATE
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

-- DELETE — strictly org-isolated.
DROP POLICY IF EXISTS scorecards_delete ON scorecards;
CREATE POLICY scorecards_delete ON scorecards
  FOR DELETE
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
