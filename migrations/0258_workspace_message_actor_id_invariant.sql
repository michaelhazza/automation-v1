-- Migration 0258: DB trigger enforcing workspace_messages.actor_id == workspace_identities.actor_id
-- for the message's identity_id. Ensures the actor FK on messages stays consistent with the
-- actor FK on the identity the message was sent/received through.

BEGIN;

CREATE OR REPLACE FUNCTION check_workspace_message_actor_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM workspace_identities
    WHERE id = NEW.identity_id
      AND actor_id = NEW.actor_id
  ) THEN
    RAISE EXCEPTION
      'workspace_messages.actor_id (%) does not match workspace_identities.actor_id for identity_id (%)',
      NEW.actor_id, NEW.identity_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspace_messages_actor_id_invariant
  BEFORE INSERT OR UPDATE OF actor_id, identity_id ON workspace_messages
  FOR EACH ROW EXECUTE FUNCTION check_workspace_message_actor_id();

COMMIT;
