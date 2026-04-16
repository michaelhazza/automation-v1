-- Migration 0133 — subaccounts.client_upload_trust_state JSONB
--
-- Trust-builds-over-time counter for client portal drop-zone uploads.
-- After 5 approvals, subsequent uploads auto-file with notification (not
-- approval gate). Any rejection resets the counter.
--
-- Shape (per §5.5):
--   { "approvedCount": number, "trustedAt": string | null, "resetAt": string | null }
--
-- Spec: docs/memory-and-briefings-spec.md §5.5 (S9)

ALTER TABLE subaccounts
  ADD COLUMN IF NOT EXISTS client_upload_trust_state jsonb NOT NULL
    DEFAULT '{"approvedCount":0,"trustedAt":null,"resetAt":null}'::jsonb;
