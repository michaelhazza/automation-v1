-- 0236_system_monitor_write_event_enum_widen
--
-- Corrective: 0234 registered the `write_event` skill with a narrow enum
-- (["diagnosis","note","escalation_blocked"]) while the runtime handler in
-- server/services/systemMonitor/skills/writeEvent.ts accepts the full Phase 2
-- agent-allowed event-type set. The agent reads its tool definitions from the
-- DB, so without this widen the LLM is told only about the narrow enum and
-- cannot call write_event with agent_diagnosis_added (which the §9.7 system
-- prompt explicitly instructs it to do).
--
-- Spec ref: §9.4 + §12.1 (event registry).

UPDATE system_skills
SET
  definition = '{"name":"write_event","description":"Append a system incident event of an agent-allowed type. Idempotent on (incidentId, eventType, agentRunId). Lifecycle transitions (status_change, ack, resolve) are not allowed.","input_schema":{"type":"object","properties":{"incidentId":{"type":"string","description":"UUID of the incident to append an event to."},"eventType":{"type":"string","description":"Event type to write. See allowed list in write_event handler.","enum":["diagnosis","note","escalation_blocked","agent_diagnosis_added","agent_triage_skipped","agent_triage_failed","heuristic_fired","heuristic_suppressed","sweep_completed","sweep_capped","prompt_generated"]},"agentRunId":{"type":"string","description":"UUID of the agent run writing this event (used for idempotency)."},"payload":{"type":"object","description":"Optional structured payload for the event."}},"required":["incidentId","eventType"]}}'::jsonb,
  updated_at = now()
WHERE slug = 'write_event';
