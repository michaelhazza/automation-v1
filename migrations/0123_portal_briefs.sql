-- Phase G — onboarding-playbooks-spec §11.6.
--
-- `portal_briefs` stores the latest published output from the
-- `config_publish_playbook_output_to_portal` action_call step.
-- The portal card (§9.4) reads the most recent non-retracted brief per
-- (subaccount_id, playbook_slug) to render headline bullets.
--
-- Canonical query (§9.4):
--   SELECT * FROM portal_briefs
--   WHERE subaccount_id = :subaccountId
--     AND playbook_slug = :playbookSlug
--     AND is_portal_visible = true
--     AND retracted_at IS NULL
--   ORDER BY published_at DESC
--   LIMIT 1

CREATE TABLE portal_briefs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid        NOT NULL REFERENCES organisations(id),
  subaccount_id    uuid        NOT NULL REFERENCES subaccounts(id),
  run_id           uuid        NOT NULL REFERENCES playbook_runs(id),
  playbook_slug    text        NOT NULL,
  title            text        NOT NULL DEFAULT '',
  -- Bullet points rendered by the portal card — stored as a text array for
  -- direct SQL iteration without JSON decode overhead.
  bullets          text[]      NOT NULL DEFAULT '{}',
  -- Long-form markdown rendered in the run detail modal.
  detail_markdown  text        NOT NULL DEFAULT '',
  is_portal_visible boolean    NOT NULL DEFAULT true,
  published_at     timestamptz NOT NULL DEFAULT now(),
  retracted_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Unique partial index: at most one visible brief per (subaccount, slug) at a
-- time (upsert_by_run_id idempotency — the skill updates on conflict run_id).
CREATE UNIQUE INDEX portal_briefs_run_id_idx ON portal_briefs (run_id);

-- Fast lookup for the portal card canonical query.
CREATE INDEX portal_briefs_subaccount_slug_idx
  ON portal_briefs (subaccount_id, playbook_slug, published_at DESC)
  WHERE retracted_at IS NULL;
