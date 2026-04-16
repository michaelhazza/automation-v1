-- Migration 0132 — subaccounts.portal_features JSONB
--
-- Per-client feature-level toggles within Collaborative portal mode. Empty
-- object is valid — portalGate falls back to registry defaults.
--
-- Spec: docs/memory-and-briefings-spec.md §6.3 (S17)

ALTER TABLE subaccounts
  ADD COLUMN IF NOT EXISTS portal_features jsonb NOT NULL DEFAULT '{}'::jsonb;
