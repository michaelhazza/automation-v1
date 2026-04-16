-- ---------------------------------------------------------------------------
-- 0134_subaccounts_clarification_routing_config.sql
--
-- Memory & Briefings spec Phase 1 — §5.4 (S8)
--
-- Adds `clarification_routing_config` (nullable jsonb) to `subaccounts`.
-- Null is the documented default sentinel meaning "use the fallback chain
-- defaults" per §5.4: subaccount_manager → agency_owner.
--
-- Phase 1: column lands here so schema is ready.
-- Phase 2: `clarificationService.ts` reads this column to resolve the
-- clarification recipient.
-- ---------------------------------------------------------------------------

ALTER TABLE subaccounts
  ADD COLUMN IF NOT EXISTS clarification_routing_config jsonb;
