-- Migration 0178 — skill_analyzer execution-lock ownership token
-- v2 §11.11.3 hardening: scope the lock release to the specific Execute run
-- that acquired it, so a late-finishing process cannot clear a fresh owner's
-- lock after a stale-lock unlock has reassigned ownership.
--
-- Without this token, the release UPDATE matches on
-- (id, execution_lock=true) alone, and the classic stale-owner race reopens
-- any time /execute/unlock is used.

ALTER TABLE skill_analyzer_jobs
  ADD COLUMN IF NOT EXISTS execution_lock_token uuid;
-- Populated in the same atomic UPDATE that takes the lock. Cleared (along
-- with executionStartedAt) whenever the lock is released — normal finish,
-- error, or manual unlock.
