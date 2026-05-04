-- Down migration for 0271_agentic_commerce_schema.sql
-- Reverses all changes in the exact reverse order.

-- 9. Remove organisations column
ALTER TABLE organisations DROP COLUMN IF EXISTS shadow_charge_retention_days;

-- 8. Drop spending_budget_approvers
DROP TABLE IF EXISTS spending_budget_approvers;

-- 7. Drop org_subaccount_channel_grants
DROP TABLE IF EXISTS org_subaccount_channel_grants;

-- 6. Drop org_approval_channels
DROP TABLE IF EXISTS org_approval_channels;

-- 5. Drop subaccount_approval_channels
DROP TABLE IF EXISTS subaccount_approval_channels;

-- 4. Drop agent_charges (triggers cascade with table drop)
DROP TRIGGER IF EXISTS agent_charges_validate_update ON agent_charges;
DROP TRIGGER IF EXISTS agent_charges_validate_delete ON agent_charges;
DROP FUNCTION IF EXISTS agent_charges_validate_update();
DROP FUNCTION IF EXISTS agent_charges_validate_delete();
DROP TABLE IF EXISTS agent_charges;

-- 3. Drop spending_policies
DROP TABLE IF EXISTS spending_policies;

-- 2. Drop spending_budgets
DROP TABLE IF EXISTS spending_budgets;

-- 1. Drop ENUM types
DROP TYPE IF EXISTS agent_charge_transition_caller;
DROP TYPE IF EXISTS agent_charge_kind;
DROP TYPE IF EXISTS agent_charge_mode;
DROP TYPE IF EXISTS agent_charge_status;
