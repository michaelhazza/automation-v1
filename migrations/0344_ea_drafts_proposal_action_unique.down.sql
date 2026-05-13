-- 0344 down — restore the pre-amendment non-unique index on
-- ea_drafts.proposal_action_id.

DROP INDEX IF EXISTS ea_drafts_proposal_action_unique;
CREATE INDEX IF NOT EXISTS ea_drafts_proposal_action_idx
  ON ea_drafts (proposal_action_id);
