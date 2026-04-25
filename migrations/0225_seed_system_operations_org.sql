-- Phase 0: Seed the System Operations org + sentinel subaccount.
--
-- This row is the escalation target for system-level incidents (incidents with
-- organisation_id IS NULL). When a sysadmin escalates such an incident to an
-- agent, the resulting task is scoped to the System Operations subaccount rather
-- than to any tenant org — keeping system-level work isolated from customer boards.
--
-- is_system_org = true triggers the visibility filter in OrganisationService
-- so this org does not appear in tenant-visible org-listing endpoints.
--
-- Both inserts are idempotent (ON CONFLICT DO NOTHING) so re-running migrations
-- (e.g. after rollback + re-apply) is safe.

DO $$
DECLARE
  v_org_id uuid;
  v_subaccount_id uuid;
BEGIN
  -- Insert the org, preserving an existing row if the name/slug already exist.
  INSERT INTO organisations (
    id,
    name,
    slug,
    plan,
    status,
    is_system_org,
    org_execution_enabled,
    require_agent_approval,
    default_currency_code,
    ghl_concurrency_cap,
    clarifying_enabled,
    sparring_enabled,
    agent_persona_label,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    'System Operations',
    'system-ops',
    'agency',
    'active',
    true,
    true,
    false,
    'AUD',
    5,
    true,
    true,
    'COO',
    now(),
    now()
  )
  ON CONFLICT DO NOTHING;

  -- Look up the org (handles both fresh insert and pre-existing row)
  SELECT id INTO v_org_id FROM organisations WHERE slug = 'system-ops' AND deleted_at IS NULL LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'System Operations org not found after seed — this should not happen';
  END IF;

  -- Insert the sentinel subaccount
  INSERT INTO subaccounts (
    id,
    organisation_id,
    name,
    slug,
    status,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_org_id,
    'System Operations',
    'system-ops',
    'active',
    now(),
    now()
  )
  ON CONFLICT DO NOTHING;
END $$;
