-- 0179_clientpulse_intervention_defensive_cooldown.sql
-- ClientPulse Phase 4 — defensive DB-level cooldown enforcement.
--
-- Application-layer cooldown logic in proposeClientPulseInterventionsJob is
-- correct, but any future code path (new job, backfill, manual insert,
-- migration script) could bypass it. This partial unique index pins the
-- invariant at the DB layer:
--
--   At most one intervention proposal per (organisation, subaccount, template
--   slug, calendar day) — for any action carrying triggerTemplateSlug on
--   metadata_json.
--
-- Bucketing by calendar day matches the most common cooldownHours = 24
-- default. Templates with finer-grained cooldowns are still enforced at the
-- application layer (proposeClientPulseInterventionsJob); the DB index is
-- the safety net, not the primary gate.
--
-- For org-scoped actions (subaccount_id IS NULL) the index does not apply,
-- because intervention proposals are always subaccount-scoped (per locked
-- contract (b) — config_update_hierarchy_template is the only org-scoped
-- ClientPulse action and is covered by actions_org_idempotency_idx from 0178).

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS actions_intervention_cooldown_day_idx
  ON actions (
    organisation_id,
    subaccount_id,
    (metadata_json->>'triggerTemplateSlug'),
    (date_trunc('day', created_at))
  )
  WHERE subaccount_id IS NOT NULL
    AND metadata_json ? 'triggerTemplateSlug';

COMMIT;
