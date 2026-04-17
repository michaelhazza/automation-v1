-- P3B: RLS policies for principal tables (from P3A migration 0162)
-- These policies enforce org-scoped reads and restrict writes to user principals.

-- ---------------------------------------------------------------------------
-- service_principals: org-scoped, readable by any authenticated principal in
-- the org; writes restricted to user principals.
-- ---------------------------------------------------------------------------
ALTER TABLE service_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_principals FORCE ROW LEVEL SECURITY;
CREATE POLICY service_principals_org_read ON service_principals
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );
-- Split into per-command policies so the USING clause does not leak into SELECT.
-- (FOR ALL permissive policies are OR'd with other permissive policies for reads,
--  which would otherwise bypass any tighter SELECT-only restriction.)
CREATE POLICY service_principals_insert ON service_principals
  FOR INSERT WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND current_setting('app.current_principal_type', true) = 'user'
  );
CREATE POLICY service_principals_update ON service_principals
  FOR UPDATE USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND current_setting('app.current_principal_type', true) = 'user'
  ) WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND current_setting('app.current_principal_type', true) = 'user'
  );
CREATE POLICY service_principals_delete ON service_principals
  FOR DELETE USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND current_setting('app.current_principal_type', true) = 'user'
  );

-- ---------------------------------------------------------------------------
-- teams: org-scoped read
-- ---------------------------------------------------------------------------
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams FORCE ROW LEVEL SECURITY;
CREATE POLICY teams_org_read ON teams
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );
CREATE POLICY teams_org_write ON teams
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- team_members: org-scoped read + write
-- ---------------------------------------------------------------------------
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members FORCE ROW LEVEL SECURITY;
CREATE POLICY team_members_org_read ON team_members
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );
CREATE POLICY team_members_org_write ON team_members
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- delegation_grants: grantor/grantee read, org-scoped write
-- ---------------------------------------------------------------------------
ALTER TABLE delegation_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY delegation_grants_principal_read ON delegation_grants
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      grantor_user_id::text = current_setting('app.current_principal_id', true)
      OR grantee_id = current_setting('app.current_principal_id', true)
    )
  );
-- Split into per-command policies so `delegation_grants_principal_read` (FOR SELECT)
-- is the only policy that governs reads. A FOR ALL USING here would OR with the
-- principal_read policy and leak ALL org grants to any org member, regardless of
-- grantor/grantee match.
CREATE POLICY delegation_grants_insert ON delegation_grants
  FOR INSERT WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );
CREATE POLICY delegation_grants_update ON delegation_grants
  FOR UPDATE USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  ) WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );
CREATE POLICY delegation_grants_delete ON delegation_grants
  FOR DELETE USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- canonical_row_subaccount_scopes: org-scoped read + write (system-managed)
-- ---------------------------------------------------------------------------
ALTER TABLE canonical_row_subaccount_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_row_subaccount_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY crss_org_read ON canonical_row_subaccount_scopes
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );
CREATE POLICY crss_org_write ON canonical_row_subaccount_scopes
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );
