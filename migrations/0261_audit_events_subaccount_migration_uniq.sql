-- DE-CR-6: subaccount.migration_completed terminal event must be idempotent
-- on (batchId). Two pg-boss workers can race when both finish their last
-- per-identity job within the same window — the partial unique index lets
-- the second insert hit ON CONFLICT DO NOTHING instead of producing a
-- duplicate "Workspace migration completed" row on the activity feed.

CREATE UNIQUE INDEX IF NOT EXISTS audit_events_subaccount_migration_completed_uniq
  ON audit_events ((metadata->>'batchId'))
  WHERE entity_type = 'subaccount'
    AND action = 'subaccount.migration_completed';
