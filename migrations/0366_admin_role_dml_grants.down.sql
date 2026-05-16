-- 0366_admin_role_dml_grants.down
--
-- Revokes the DML grants given to admin_role in 0366. Idempotent: REVOKE on
-- a privilege that does not exist is a no-op.

-- ---------------------------------------------------------------------------
-- Default privileges
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM admin_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM admin_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM admin_role;

-- ---------------------------------------------------------------------------
-- Existing-object grants
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM admin_role;
REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM admin_role;
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM admin_role;

REVOKE USAGE ON SCHEMA public FROM admin_role;
