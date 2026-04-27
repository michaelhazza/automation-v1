-- Fixture: a tenant table NOT registered in rlsProtectedTables.ts and NOT in
-- the allowlist. Drop this into `migrations/9999_fixture.sql` (DO NOT COMMIT)
-- and run `bash scripts/verify-rls-protected-tables.sh` — the gate must fail
-- with `Table 'sample_tenant_widget' has organisation_id but is not in
-- rlsProtectedTables.ts and not in rls-not-applicable-allowlist.txt.`

CREATE TABLE "sample_tenant_widget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
