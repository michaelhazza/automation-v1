-- Migration 0198 — Universal Brief Phase 7 / W3b: user_settings table
--
-- Creates the user_settings table for per-user preference settings.
-- Initial columns: approval-gate suggestion frequency + backoff state.

CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  suggestion_frequency text NOT NULL DEFAULT 'occasional'
    CHECK (suggestion_frequency IN ('off', 'occasional', 'frequent')),
  suggestion_backoff_until timestamp with time zone,
  skip_streak_count text NOT NULL DEFAULT '0',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_settings_user_idx ON user_settings (user_id);

-- No RLS: user_settings are personal data accessed only via authenticated user routes.
-- Auth middleware ensures users can only read/write their own row.
