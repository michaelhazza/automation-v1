-- 0208_model_tier_budget_policies.sql
--
-- Cached Context Infrastructure Phase 1: model_tier_budget_policies table.
-- Per-model-family execution budget defaults. Seed rows for Sonnet / Opus / Haiku
-- are inserted in this same migration (not deferred to a backfill).
--
-- organisation_id IS NULL = platform default. Non-null = per-org override.
--
-- See docs/cached-context-infrastructure-spec.md §5.7

CREATE TABLE model_tier_budget_policies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         uuid REFERENCES organisations(id),

  model_family            text NOT NULL,
  model_context_window    integer NOT NULL,

  max_input_tokens        integer NOT NULL,
  max_output_tokens       integer NOT NULL,
  reserve_output_tokens   integer NOT NULL,
  max_total_cost_usd_cents integer NOT NULL,
  per_document_max_tokens integer NOT NULL,

  soft_warn_ratio         numeric(4, 3) NOT NULL DEFAULT 0.700,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- One policy per org per model family. NULL org = platform default.
CREATE UNIQUE INDEX model_tier_budget_policies_org_model_uq
  ON model_tier_budget_policies (organisation_id, model_family);

CREATE INDEX model_tier_budget_policies_model_idx
  ON model_tier_budget_policies (model_family);

-- Capacity invariant: max_input_tokens + reserve_output_tokens must fit in the
-- model context window. Enforced here so no invalid policy row can be inserted.
ALTER TABLE model_tier_budget_policies
  ADD CONSTRAINT model_tier_budget_policies_capacity_ck
  CHECK (max_input_tokens + reserve_output_tokens <= model_context_window);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Custom policy shape: SELECT allows platform-default rows (org IS NULL) for
-- all orgs; INSERT/UPDATE/DELETE scopes to matching org only (admin-role writes
-- handled via admin_role connection, not RLS override).

ALTER TABLE model_tier_budget_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY model_tier_budget_policies_read ON model_tier_budget_policies
  FOR SELECT
  USING (
    organisation_id IS NULL
    OR organisation_id = current_setting('app.current_organisation_id', true)::uuid
  );

CREATE POLICY model_tier_budget_policies_write ON model_tier_budget_policies
  FOR ALL
  USING (organisation_id = current_setting('app.current_organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.current_organisation_id', true)::uuid);

-- ── Seed rows (platform defaults) ─────────────────────────────────────────

INSERT INTO model_tier_budget_policies
  (organisation_id, model_family, model_context_window, max_input_tokens, max_output_tokens, reserve_output_tokens, max_total_cost_usd_cents, per_document_max_tokens, soft_warn_ratio)
VALUES
  (NULL, 'anthropic.claude-sonnet-4-6', 1000000, 800000, 16000, 16000, 500,  100000, 0.700),
  (NULL, 'anthropic.claude-opus-4-7',   1000000, 800000, 16000, 16000, 1000, 100000, 0.700),
  (NULL, 'anthropic.claude-haiku-4-5',  200000,  150000,  8000,  8000, 100,   50000, 0.700);
