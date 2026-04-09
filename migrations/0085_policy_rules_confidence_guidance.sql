-- 0085_policy_rules_confidence_guidance.sql
--
-- Sprint 3 — P2.3 confidence scoring + decision-time guidance.
-- Extends the existing `policy_rules` table with two nullable columns
-- that drive the new features:
--
--   1. `confidence_threshold real` — per-rule override for
--      `CONFIDENCE_GATE_THRESHOLD` in server/config/limits.ts. When the
--      rule matches and an agent's tool_intent confidence is below this
--      value, an `auto` decision is upgraded to `review`. NULL falls
--      back to the global default.
--
--   2. `guidance_text text` — situational instructions injected as a
--      <system-reminder> block by `decisionTimeGuidanceMiddleware` at
--      the moment a matching tool is about to be called. Replaces the
--      "front-load everything into the master prompt" anti-pattern
--      with targeted, context-aware guidance.
--
-- Additive, nullable columns — no default, no backfill, no behaviour
-- change for existing rows. Orgs that never populate the columns see
-- identical behaviour to Sprint 2.
--
-- Contract: docs/improvements-roadmap-spec.md §P2.3.

ALTER TABLE policy_rules
  ADD COLUMN IF NOT EXISTS confidence_threshold real;

ALTER TABLE policy_rules
  ADD COLUMN IF NOT EXISTS guidance_text text;
