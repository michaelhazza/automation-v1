ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS suggested_actions JSONB NULL;
COMMENT ON COLUMN agent_messages.suggested_actions IS 'Chip metadata emitted by agent on terminal turns. null or [] = no chips. See shared/types/messageSuggestedActions.ts';
