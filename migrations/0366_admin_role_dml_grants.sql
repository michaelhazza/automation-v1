-- 0366_admin_role_dml_grants
--
-- Grants DML (SELECT/INSERT/UPDATE/DELETE) on all public-schema tables to
-- admin_role, plus USAGE/SELECT on sequences and EXECUTE on functions.
--
-- Why this is needed:
--   admin_role was created in migration 0079 with BYPASSRLS NOLOGIN. The
--   intent was that admin tooling (migrations, GC jobs, retention pruners)
--   could `SET LOCAL ROLE admin_role` inside a transaction to bypass RLS
--   policies on FORCE-RLS tables. In production this works because the
--   application connects as `postgres` (the database owner) — postgres has
--   implicit privileges on owned tables and SET ROLE flips the active role
--   to admin_role, keeping BYPASSRLS while postgres ownership covers DML.
--
--   In CI integration tests (migration 0364), the connection user is
--   `synthetos_app` (NOBYPASSRLS, NOT the table owner). When test fixture
--   setup tries `SET LOCAL ROLE admin_role` to seed FORCE-RLS tables, the
--   role switch succeeds (synthetos_app is a member of admin_role per 0364),
--   BYPASSRLS applies, BUT the subsequent INSERT fails with
--   `permission denied for table <name>` (SQLSTATE 42501) because admin_role
--   itself has no DML grants on the tables — and the prior synthetos_app
--   grants do not flow through SET ROLE.
--
--   This migration grants DML to admin_role directly, mirroring the grants
--   migration 0364 already gives to synthetos_app. Production is unaffected
--   (postgres remains the owner and has full privileges either way); CI
--   integration tests can now use the documented `SET LOCAL ROLE admin_role`
--   pattern to seed RLS-protected tables.
--
-- Idempotent: GRANT statements are no-ops if the privilege already exists.

-- ---------------------------------------------------------------------------
-- Schema access
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO admin_role;

-- ---------------------------------------------------------------------------
-- Existing-object grants
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO admin_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO admin_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO admin_role;

-- ---------------------------------------------------------------------------
-- Default privileges (apply to objects created AFTER this migration)
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO admin_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO admin_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO admin_role;
