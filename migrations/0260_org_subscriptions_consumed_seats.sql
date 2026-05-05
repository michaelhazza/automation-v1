ALTER TABLE org_subscriptions
  ADD COLUMN IF NOT EXISTS consumed_seats integer NOT NULL DEFAULT 0;
