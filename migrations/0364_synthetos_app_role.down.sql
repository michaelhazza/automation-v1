-- Down for 0364_synthetos_app_role.sql.

-- Drop default-privilege rules first so the role has no remaining dependents.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM synthetos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM synthetos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM synthetos_app;

-- Revoke existing-object grants.
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM synthetos_app;
REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM synthetos_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM synthetos_app;
REVOKE USAGE ON SCHEMA public FROM synthetos_app;

-- Drop the role itself (no-op if it owns no objects, which is the case here).
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'synthetos_app') THEN
    DROP ROLE synthetos_app;
  END IF;
END $$;
