-- Add projects table
CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id" uuid NOT NULL REFERENCES "subaccounts"("id"),
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'active',
  "color" text NOT NULL DEFAULT '#6366f1',
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "projects_subaccount_idx" ON "projects" ("subaccount_id");
CREATE INDEX IF NOT EXISTS "projects_org_idx" ON "projects" ("organisation_id");
CREATE INDEX IF NOT EXISTS "projects_subaccount_status_idx" ON "projects" ("subaccount_id", "status");
