-- Phase G / §10.3 (G10.3) — subaccount_onboarding_state.
--
-- Tracks onboarding-playbook completion per (subaccount, playbook_slug).
--
-- Written by the playbook engine when an onboarding run transitions to
-- `completed` or `failed`. The Onboarding tab (§9.3) reads this table to
-- render status, last-run timestamp, and a Start/Resume affordance without
-- having to scan `playbook_runs` for every card.
--
-- status values:
--   'not_started'  — row does not exist (implicit default; never persisted)
--   'in_progress'  — an active run exists (pending | running | awaiting_*)
--   'completed'    — most recent run reached `completed`
--   'failed'       — most recent run reached `failed` or `cancelled`
--
-- (subaccount_id, playbook_slug) is the natural key. The row is upserted on
-- every terminal transition. `last_run_id` always points at the most recent
-- run regardless of outcome.

CREATE TABLE subaccount_onboarding_state (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid        NOT NULL REFERENCES organisations(id),
  subaccount_id    uuid        NOT NULL REFERENCES subaccounts(id),
  playbook_slug    text        NOT NULL,
  status           text        NOT NULL,
  last_run_id      uuid        REFERENCES playbook_runs(id),
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subaccount_onboarding_state_status_chk
    CHECK (status IN ('in_progress', 'completed', 'failed'))
);

-- One row per (subaccount, slug). Upsert target for the engine hook.
CREATE UNIQUE INDEX subaccount_onboarding_state_subaccount_slug_uniq
  ON subaccount_onboarding_state (subaccount_id, playbook_slug);

-- Look-ups by org for the portal Daily-Brief card (§10.4) which joins on
-- completion state per subaccount.
CREATE INDEX subaccount_onboarding_state_org_idx
  ON subaccount_onboarding_state (organisation_id, playbook_slug, status);
