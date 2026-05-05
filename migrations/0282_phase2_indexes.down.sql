ALTER TABLE users DROP COLUMN IF EXISTS password_changed_at;
DROP INDEX IF EXISTS idx_review_items_org_status;
DROP INDEX IF EXISTS idx_review_items_org;
DROP INDEX IF EXISTS idx_processed_resources_org;
DROP INDEX IF EXISTS idx_agent_triggers_org;
