-- System Process Linking migration
-- Adds living-link fields so org-level processes can reference system processes
-- without cloning internal config (mirrors the systemAgentId / isSystemManaged pattern on agents)

ALTER TABLE "processes" ADD COLUMN IF NOT EXISTS "system_process_id" uuid REFERENCES "processes"("id");
ALTER TABLE "processes" ADD COLUMN IF NOT EXISTS "is_system_managed" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "processes_system_process_idx" ON "processes" ("system_process_id");
