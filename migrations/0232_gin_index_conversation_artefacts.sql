-- Migration 0232: GIN index on conversation_messages.artefacts
--
-- Enables efficient JSONB containment (@>) queries used by:
--   briefApprovalService (DR3 idempotency pre-check)
--   rules/draft-candidates route (DR1 artefact lookup)
-- Per pre-launch-hardening-spec §4.5.4 corrective index requirement.

CREATE INDEX conv_msgs_artefacts_gin_idx ON conversation_messages USING GIN (artefacts);
