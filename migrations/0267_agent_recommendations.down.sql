-- Down migration for 0267_agent_recommendations.sql
-- Reverses: subaccounts.optimiser_enabled column + agent_recommendations table + RLS

ALTER TABLE subaccounts DROP COLUMN IF EXISTS optimiser_enabled;

DROP TABLE IF EXISTS agent_recommendations;
