-- migrations/0100_priority_feed_claims.sql
CREATE TABLE priority_feed_claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_source    text NOT NULL,
  item_id        text NOT NULL,
  agent_run_id   uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);
CREATE UNIQUE INDEX priority_feed_claims_item_idx ON priority_feed_claims (item_source, item_id);
CREATE INDEX priority_feed_claims_expires_idx ON priority_feed_claims (expires_at);
