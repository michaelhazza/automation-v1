-- Down migration for 0307_subaccount_agents_governance
-- Removes the four governance columns added in the up migration.
-- Sibling file in migrations/ (not under migrations/_down/ — repo convention).

ALTER TABLE subaccount_agents
  DROP COLUMN controller_style_allowed,
  DROP COLUMN allowed_environments,
  DROP COLUMN max_risk_tier,
  DROP COLUMN require_approval_at_tier;
