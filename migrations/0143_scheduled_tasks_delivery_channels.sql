-- ---------------------------------------------------------------------------
-- 0143_scheduled_tasks_delivery_channels.sql
--
-- Memory & Briefings spec Phase 1 — §10.4 (S22)
--
-- Adds `delivery_channels` (nullable jsonb) to `scheduled_tasks`.
-- Null means "use the playbook default delivery channel configuration".
-- When present, this column overrides the playbook default for this specific
-- scheduled task.
--
-- Phase 1: column lands here so the DeliveryChannels UI component (Task 29)
-- and deliveryService (Task 33) have a stable storage target.
-- Phase 3 reads this column when dispatching playbook runs.
-- ---------------------------------------------------------------------------

ALTER TABLE scheduled_tasks
  ADD COLUMN IF NOT EXISTS delivery_channels jsonb;
