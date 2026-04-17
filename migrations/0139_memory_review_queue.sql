-- ---------------------------------------------------------------------------
-- 0139_memory_review_queue.sql
--
-- Memory & Briefings spec Phase 1 — §5.3 (S3, S7, S11)
--
-- New table `memory_review_queue` — the unified HITL queue for items that
-- require human review before being applied to the workspace.
--
-- Three item types:
--   belief_conflict     — two agents hold contradicting beliefs; reviewer
--                         chooses which belief to keep (or both)
--   block_proposal      — auto-synthesised block awaiting activation
--   clarification_pending — agent asked for clarification (audit trail only;
--                           not resolvable from this table)
--
-- Five statuses:
--   pending       — awaiting human decision
--   approved      — human approved; downstream service applies the change
--   rejected      — human rejected
--   auto_applied  — confidence was > threshold; applied without review
--   expired       — expires_at passed without a decision
--
-- RLS: tenant-scoped on organisation_id via policy added below.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_review_queue (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  organisation_id     uuid        NOT NULL REFERENCES organisations(id),
  subaccount_id       uuid        NOT NULL REFERENCES subaccounts(id),
  item_type           text        NOT NULL,
  payload             jsonb       NOT NULL,
  confidence          real        NOT NULL,
  status              text        NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz,
  created_by_agent_id uuid,
  resolved_at         timestamptz,
  resolved_by_user_id uuid,

  CONSTRAINT memory_review_queue_pkey PRIMARY KEY (id),
  CONSTRAINT memory_review_queue_item_type_check
    CHECK (item_type IN ('belief_conflict', 'block_proposal', 'clarification_pending')),
  CONSTRAINT memory_review_queue_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'auto_applied', 'expired'))
);

-- Per-subaccount queue view sorted by recency (primary query path)
CREATE INDEX IF NOT EXISTS memory_review_queue_subaccount_status_idx
  ON memory_review_queue (subaccount_id, status, created_at DESC);

-- Org-level rollup counts
CREATE INDEX IF NOT EXISTS memory_review_queue_org_status_idx
  ON memory_review_queue (organisation_id, status);

-- RLS policy — tenant isolation on organisation_id
ALTER TABLE memory_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_review_queue_org_isolation
  ON memory_review_queue
  USING (
    organisation_id::text = current_setting('app.organisation_id', true)
  );
