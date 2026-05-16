-- 0364_synthetos_app_role
--
-- Creates the `synthetos_app` Postgres login role for application connections
-- and CI integration test runs. Non-superuser, explicit `NOBYPASSRLS` — so
-- when the test runner connects as this role, every RLS policy on every
-- protected table fires for real (vs. silently bypassed by the `postgres`
-- superuser).
--
-- Closes TI-008. Pair with the CI workflow change in `.github/workflows/ci.yml`
-- that points the integration_tests step at DATABASE_URL_TEST built from this
-- role.
--
-- Grants are deliberately broad (SELECT/INSERT/UPDATE/DELETE on existing
-- tables + USAGE on sequences) because the integration suite exercises every
-- domain. RLS, not grants, is what scopes per-tenant access — and that is
-- the contract the suite verifies.
--
-- Idempotent: re-running this migration on a database where the role already
-- exists is a no-op (CREATE ROLE wrapped in DO-block; grants are idempotent).

-- ---------------------------------------------------------------------------
-- Role
-- ---------------------------------------------------------------------------
-- The role is created WITHOUT a password. Test/dev environments set one
-- via `ALTER ROLE synthetos_app WITH PASSWORD '<value>'` from CI scripting
-- or developer setup; production environments must use an out-of-band
-- secrets-management flow (Doppler, AWS Secrets Manager, etc.) to assign a
-- strong password before allowing connections. Shipping a literal password
-- here would create a known credential on every database the migrator
-- touches — pr-reviewer wave-4-session-i-prime blocker.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'synthetos_app') THEN
    -- LOGIN so the role can open connections from the test runner.
    -- NOBYPASSRLS so policies on FORCE ROW LEVEL SECURITY tables apply.
    -- INHERIT so future role-membership-based grants flow through.
    -- NOSUPERUSER NOCREATEDB NOCREATEROLE because the app does not need any
    -- of those, and the more we restrict the role, the better the CI signal:
    -- if a test passes only because the connecting role is too privileged,
    -- a real production tenant would see a 403/permission failure instead.
    CREATE ROLE synthetos_app
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS
      INHERIT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Schema access
-- ---------------------------------------------------------------------------
-- CONNECT privilege is granted to every role via PUBLIC by Postgres default,
-- so an explicit `GRANT CONNECT ON DATABASE …` would be redundant. Future
-- environments that revoke that default will need an environment-specific
-- grant outside this migration.
GRANT USAGE ON SCHEMA public TO synthetos_app;

-- ---------------------------------------------------------------------------
-- Existing-object grants
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO synthetos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO synthetos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO synthetos_app;

-- ---------------------------------------------------------------------------
-- Default privileges (apply to objects created AFTER this migration)
-- ---------------------------------------------------------------------------
-- ALTER DEFAULT PRIVILEGES applies the grant to future tables/sequences/funcs
-- created BY the migration runner (postgres). New tables added by later
-- migrations will automatically grant DML to synthetos_app, so the CI test
-- runner does not need a re-grant step after each migration cycle.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO synthetos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO synthetos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO synthetos_app;

-- Allow synthetos_app to SET LOCAL ROLE admin_role inside transactions so
-- integration test fixture setup (beforeAll/beforeEach) can bypass RLS when
-- seeding data. Test ASSERTIONS still run as synthetos_app (NOBYPASSRLS).
GRANT admin_role TO synthetos_app;
