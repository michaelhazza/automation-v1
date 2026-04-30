CREATE UNIQUE INDEX IF NOT EXISTS audit_events_workspace_identity_action_uniq
  ON audit_events (workspace_actor_id, action, ((metadata->>'identityId')))
  WHERE entity_type = 'workspace_identity'
    AND action IN ('identity.provisioned', 'identity.activated', 'actor.onboarded');
