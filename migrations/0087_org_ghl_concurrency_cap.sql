-- Sprint 4 P3.2 — GHL concurrency cap for bulk-mode playbook dispatch.
-- Limits how many bulk children can run in parallel against GHL rate limits.

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS ghl_concurrency_cap integer NOT NULL DEFAULT 5;
