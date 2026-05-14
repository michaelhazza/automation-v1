-- Down: revert the Support Agent default_system_skill_slugs swap (12th slot
-- back to support.set_custom_field). Idempotent — applies only when the
-- current value contains ask_clarifying_question.

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
         "support.set_custom_field"
       ]'::jsonb
WHERE  slug = 'support-agent'
  AND  default_system_skill_slugs::text LIKE '%ask_clarifying_question%';
