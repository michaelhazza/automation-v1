-- Migration: 0307_subaccount_agents_governance
-- Adds four governance columns to subaccount_agents (spec §5.2.9).
-- All columns ship with conservative defaults so existing rows are unaffected.
-- The text[] closure (allowed_environments) is enforced at app-layer via Zod (spec §3.6);
-- the two text columns have DB-level CHECK constraints on the closed enum.

ALTER TABLE subaccount_agents
  ADD COLUMN controller_style_allowed text NOT NULL DEFAULT 'native_only'
    CHECK (controller_style_allowed IN ('native_only', 'native_and_operator')),
  ADD COLUMN allowed_environments text[] NOT NULL DEFAULT ARRAY['api_tool', 'headless', 'browser'],
  ADD COLUMN max_risk_tier integer NOT NULL DEFAULT 3
    CHECK (max_risk_tier BETWEEN 0 AND 6),
  ADD COLUMN require_approval_at_tier integer NOT NULL DEFAULT 4
    CHECK (require_approval_at_tier BETWEEN 0 AND 6);
