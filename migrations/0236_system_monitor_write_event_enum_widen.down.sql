-- Down migration for 0236_system_monitor_write_event_enum_widen.sql
-- Restores the narrow enum from 0234.

UPDATE system_skills
SET
  definition = '{"name":"write_event","description":"Append a system incident event of an allowed type (diagnosis, note, escalation_blocked). Idempotent on (incidentId, eventType, agentRunId).","input_schema":{"type":"object","properties":{"incidentId":{"type":"string","description":"UUID of the incident to append an event to."},"eventType":{"type":"string","description":"Event type to write.","enum":["diagnosis","note","escalation_blocked"]},"agentRunId":{"type":"string","description":"UUID of the agent run writing this event (used for idempotency)."},"payload":{"type":"object","description":"Optional structured payload for the event."}},"required":["incidentId","eventType"]}}'::jsonb,
  updated_at = now()
WHERE slug = 'write_event';
