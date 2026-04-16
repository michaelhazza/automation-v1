-- ---------------------------------------------------------------------------
-- 0131_subaccounts_portal_mode.sql
--
-- Memory & Briefings spec Phase 1 — §6.2 (S15, S16)
--
-- Adds `portal_mode` to `subaccounts`.  Three modes correspond to the three
-- client-portal visibility tiers defined in §6.2:
--
--   hidden         — portal exists but no memory/clarification surfaces shown
--   transparency   — read-only memory views visible to client contacts
--   collaborative  — client contacts can submit requests, upload files, etc.
--
-- Default is 'hidden' per §6.2: "default mode is off / hidden".
-- All existing subaccounts silently inherit the safe non-breaking default.
-- ---------------------------------------------------------------------------

ALTER TABLE subaccounts
  ADD COLUMN IF NOT EXISTS portal_mode text NOT NULL DEFAULT 'hidden';

ALTER TABLE subaccounts
  ADD CONSTRAINT subaccounts_portal_mode_check
    CHECK (portal_mode IN ('hidden', 'transparency', 'collaborative'));
