-- Fixture: tenant table missing FORCE ROW LEVEL SECURITY
-- This is a test fixture — not a real migration.
CREATE TABLE fixture_missing_rls_tenant (
  id SERIAL PRIMARY KEY,
  organisation_id TEXT NOT NULL
);
-- Intentionally omits: ALTER TABLE fixture_missing_rls_tenant FORCE ROW LEVEL SECURITY;
