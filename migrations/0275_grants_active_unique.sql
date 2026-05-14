-- ----------------------------------------------------------------------------
-- 0275_grants_active_unique.sql
--
-- chatgpt-pr-review (PR #255, agentic-commerce, round 1) Finding 2:
-- POST /api/approval-channels/:channelId/grants is missing a DB-level
-- idempotency guard. Add a partial UNIQUE index on (org_channel_id,
-- subaccount_id) constrained to active rows so:
--
--   - re-granting the same (channel, subaccount) pair is a no-op
--   - revoked rows are preserved (audit trail) and not blocked by the index
--   - concurrent double-clicks / network replays cannot create duplicates
--
-- The corresponding service-layer change in
-- server/services/approvalChannelService.ts::addGrant treats a unique-
-- violation conflict as success (returns the existing active grant id).
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS org_subaccount_channel_grants_active_unique
  ON org_subaccount_channel_grants(org_channel_id, subaccount_id)
  WHERE active = TRUE;
