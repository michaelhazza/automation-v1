-- 0345 down — revert EA subaccount_agents rows back to 'native_only'
--
-- Hard-revert: pauses operator-mode runs for EA instances. Only flips rows
-- that are currently 'native_and_operator' and linked to an EA agent.

UPDATE subaccount_agents sa
SET
  controller_style_allowed = 'native_only',
  updated_at               = NOW()
FROM agents a
WHERE sa.agent_id                  = a.id
  AND a.slug                       = 'executive-assistant'
  AND a.deleted_at                 IS NULL
  AND sa.controller_style_allowed  = 'native_and_operator';
