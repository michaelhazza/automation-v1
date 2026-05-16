-- Down for 0364_synthetos_app_role.sql.
--
-- Idempotent against a fresh DB: the migrate runner picks up *.down.sql in lex
-- order before *.sql, so the entire body is guarded on role existence. If the
-- role is absent (fresh DB applying down before up, or already torn down), all
-- REVOKE / ALTER DEFAULT PRIVILEGES / DROP ROLE operations are skipped.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'synthetos_app') THEN
    RETURN;
  END IF;

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

  DROP ROLE synthetos_app;
END $$;
