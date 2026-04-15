-- Phase E — onboarding-playbooks-spec §9.2 / §9.3 / §9.4.
--
-- Adds the UI-facing boolean flags + denormalised slug column on
-- playbook_runs that the run modal, onboarding tab and portal card
-- depend on:
--
--   is_portal_visible   — default FALSE. Only flipped TRUE on runs whose
--                         template declares a portalPresentation block and
--                         the admin has enabled the run in the portal.
--   is_onboarding_run   — default FALSE. TRUE for runs started via the
--                         Onboarding tab's "Start now" button or by the
--                         auto-start-on-sub-account-creation hook (§10.5).
--                         Drives the Onboarding tab's progress view.
--   playbook_slug       — denormalised slug of the template whose locked
--                         version the run executes. Required so the tab
--                         can filter runs by the union of slugs in the
--                         sub-account's enabled modules. Backfilled below.
--
-- Partial indexes on the two booleans keep the tab + portal queries fast.
--
-- Backfill for playbook_slug joins through
-- playbook_template_versions → playbook_templates on the org side and
-- system_playbook_template_versions → system_playbook_templates on the
-- system side. Both branches are needed because a run may be executed
-- against either template type.

ALTER TABLE playbook_runs
  ADD COLUMN is_portal_visible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN is_onboarding_run BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN playbook_slug     TEXT;

-- Backfill: resolve slug for existing rows from the two template sides.
UPDATE playbook_runs pr
SET playbook_slug = pt.slug
FROM playbook_template_versions v
JOIN playbook_templates pt ON pt.id = v.template_id
WHERE pr.template_version_id = v.id
  AND pr.playbook_slug IS NULL;

UPDATE playbook_runs pr
SET playbook_slug = spt.slug
FROM system_playbook_template_versions sv
JOIN system_playbook_templates spt ON spt.id = sv.system_template_id
WHERE pr.template_version_id = sv.id
  AND pr.playbook_slug IS NULL;

-- Indexes used by §9.3 Onboarding tab filter and §9.4 Portal card lookup.
CREATE INDEX playbook_runs_onboarding_slug_idx
  ON playbook_runs (subaccount_id, playbook_slug)
  WHERE is_onboarding_run = TRUE;

CREATE INDEX playbook_runs_portal_visible_idx
  ON playbook_runs (subaccount_id, playbook_slug)
  WHERE is_portal_visible = TRUE;
