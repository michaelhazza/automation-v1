-- Migration 0345: Flip EA subaccount_agents rows to 'native_and_operator'
--
-- Enables operator-mode dispatch for every existing Executive Assistant
-- instance. Idempotent: the WHERE predicate `controller_style_allowed = 'native_only'`
-- means a re-run is a no-op.
--
-- Scope: only rows where the linked agent has slug = 'executive-assistant'
-- AND controller_style_allowed is still 'native_only'. Rows already flipped
-- (e.g. manually by an org admin) are not touched.
--
-- Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md
-- §4.1 (migration 0345), §6.1, §7 (EA seed flip row)

UPDATE subaccount_agents sa
SET
  controller_style_allowed = 'native_and_operator',
  updated_at               = NOW()
FROM agents a
WHERE sa.agent_id                  = a.id
  AND a.slug                       = 'executive-assistant'
  AND a.deleted_at                 IS NULL
  AND sa.controller_style_allowed  = 'native_only';
