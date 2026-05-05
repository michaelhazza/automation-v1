-- Phase 2 — index coverage for hot org-scoped tables (audit finding #12)

CREATE INDEX IF NOT EXISTS idx_agent_triggers_org      ON agent_triggers (organisation_id);
CREATE INDEX IF NOT EXISTS idx_processed_resources_org ON processed_resources (organisation_id);

-- Compound index for the most common review_items query (org + review_status + created_at DESC)
CREATE INDEX IF NOT EXISTS idx_review_items_org        ON review_items (organisation_id);
CREATE INDEX IF NOT EXISTS idx_review_items_org_status ON review_items (organisation_id, review_status, created_at DESC);

-- password_changed_at on users (for JWT forced-logout — Task 4.4)
-- Backfill existing rows to epoch sentinel so active JWTs are not revoked on deploy.
-- The column only advances to now() when the user actually changes their password.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
UPDATE users SET password_changed_at = '1970-01-01'::timestamptz WHERE password_changed_at IS NULL;
ALTER TABLE users ALTER COLUMN password_changed_at SET NOT NULL;
ALTER TABLE users ALTER COLUMN password_changed_at SET DEFAULT now();
