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
CREATE POLICY service_principals_org_write ON service_principals
  FOR ALL USING (
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

-- ---------------------------------------------------------------------------
-- team_members: org-scoped read
-- ---------------------------------------------------------------------------
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members FORCE ROW LEVEL SECURITY;
CREATE POLICY team_members_org_read ON team_members
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- ---------------------------------------------------------------------------
-- delegation_grants: only the grantor or the grantee can see their own grants
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

-- ---------------------------------------------------------------------------
-- canonical_row_subaccount_scopes: org-scoped (rows are system-managed)
-- ---------------------------------------------------------------------------
ALTER TABLE canonical_row_subaccount_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_row_subaccount_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY crss_org_read ON canonical_row_subaccount_scopes
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );
