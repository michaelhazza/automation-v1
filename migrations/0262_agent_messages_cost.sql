-- Migration 0262: add cost/token columns to agent_messages
-- Populated by conversationService.sendMessage() on assistant messages.
-- NULL means the message pre-dates cost tracking (not an error).

ALTER TABLE "agent_messages"
  ADD COLUMN IF NOT EXISTS "cost_cents"  INTEGER,
  ADD COLUMN IF NOT EXISTS "tokens_in"   INTEGER,
  ADD COLUMN IF NOT EXISTS "tokens_out"  INTEGER,
  ADD COLUMN IF NOT EXISTS "model_id"    TEXT;
