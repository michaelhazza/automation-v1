-- Corrective migration: align Support Agent default_system_skill_slugs with
-- spec §5.3.1 / acceptance criterion §9.2 ("11 support.* + ask_clarifying_question").
--
-- Migration 0314 originally seeded `support.set_custom_field` in the 12th slot.
-- The spec calls for the universal `ask_clarifying_question` skill instead.
-- This migration is idempotent — repeated application is a no-op once the row
-- already matches the spec list.

UPDATE system_agents
SET    default_system_skill_slugs = '[
         "support.list_open_tickets",
         "support.read_thread",
         "support.classify_ticket",
         "support.find_customer_history",
         "support.propose_reply",
         "support.add_internal_note",
         "support.approve_draft",
         "support.reject_draft",
         "support.assign",
         "support.set_status",
         "support.tag",
         "ask_clarifying_question"
       ]'::jsonb
WHERE  slug = 'support-agent'
  AND  default_system_skill_slugs::text LIKE '%support.set_custom_field%';
