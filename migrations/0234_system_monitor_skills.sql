-- 0234_system_monitor_skills
--
-- Inserts the 11 system_monitor skill rows into system_skills and wires them
-- to the system_monitor system agent. All skills have:
--   visibility = 'none'   — not surfaced in the org UI
--   handler_key = slug    — matches SKILL_HANDLERS in skillExecutor.ts
-- Read skills: side_effects = false. Write skills: side_effects = true.

-- ─── Read skills ─────────────────────────────────────────────────────────────

INSERT INTO system_skills (id, slug, handler_key, name, description, definition, visibility, side_effects, is_active, created_at, updated_at)
VALUES

(gen_random_uuid(), 'read_incident', 'read_incident', 'Read Incident', 'Read a system incident and its last 20 events.',
  '{"name":"read_incident","description":"Read a system incident row and its last 20 events for diagnosis context.","input_schema":{"type":"object","properties":{"incidentId":{"type":"string","description":"UUID of the system_incidents row to read."}},"required":["incidentId"]}}'::jsonb,
  'none', false, true, now(), now()),

(gen_random_uuid(), 'read_agent_run', 'read_agent_run', 'Read Agent Run', 'Read an agent run and its message history.',
  '{"name":"read_agent_run","description":"Read an agent run and its message history for diagnosis. Capped at 50 messages or 100 KB.","input_schema":{"type":"object","properties":{"agentRunId":{"type":"string","description":"UUID of the agent_runs row to read."}},"required":["agentRunId"]}}'::jsonb,
  'none', false, true, now(), now()),

(gen_random_uuid(), 'read_skill_execution', 'read_skill_execution', 'Read Skill Execution', 'Read the tool_use/tool_result pair for a skill execution.',
  '{"name":"read_skill_execution","description":"Read the tool_use/tool_result message pair for a skill execution by tool call ID.","input_schema":{"type":"object","properties":{"toolCallId":{"type":"string","description":"The tool call ID identifying the skill execution."}},"required":["toolCallId"]}}'::jsonb,
  'none', false, true, now(), now()),

(gen_random_uuid(), 'read_recent_runs_for_agent', 'read_recent_runs_for_agent', 'Read Recent Runs For Agent', 'Read the last 20 runs for an agent (summary only).',
  '{"name":"read_recent_runs_for_agent","description":"Read the last 20 runs for an agent (summary fields only, no messages).","input_schema":{"type":"object","properties":{"agentId":{"type":"string","description":"UUID of the agent. Preferred over agentSlug."},"agentSlug":{"type":"string","description":"Slug of a system-managed agent. Used if agentId is unavailable."}},"required":[]}}'::jsonb,
  'none', false, true, now(), now()),

(gen_random_uuid(), 'read_baseline', 'read_baseline', 'Read Baseline', 'Read baseline metrics for an entity/metric pair.',
  '{"name":"read_baseline","description":"Read the current baseline metrics (p50, p95, p99, mean, stddev) for an entity/metric pair.","input_schema":{"type":"object","properties":{"entityKind":{"type":"string","description":"Entity kind: agent, skill, connector, job_queue, or llm_router.","enum":["agent","skill","connector","job_queue","llm_router"]},"entityId":{"type":"string","description":"Entity identifier (e.g. agent slug, skill slug, connector ID)."},"metric":{"type":"string","description":"Metric name (e.g. runtime_ms, output_length_chars, success_rate)."}},"required":["entityKind","entityId","metric"]}}'::jsonb,
  'none', false, true, now(), now()),

(gen_random_uuid(), 'read_heuristic_fires', 'read_heuristic_fires', 'Read Heuristic Fires', 'Read recent heuristic fires for an entity.',
  '{"name":"read_heuristic_fires","description":"Read recent heuristic fire records for an entity. Capped at 20.","input_schema":{"type":"object","properties":{"entityKind":{"type":"string","description":"Entity kind: agent_run, job, skill_execution, connector_poll, or llm_call."},"entityId":{"type":"string","description":"Entity identifier (e.g. agent run UUID)."},"limit":{"type":"string","description":"Max results to return (default 20, max 20)."}},"required":["entityKind","entityId"]}}'::jsonb,
  'none', false, true, now(), now()),

(gen_random_uuid(), 'read_connector_state', 'read_connector_state', 'Read Connector State', 'Read connector configuration and current sync state.',
  '{"name":"read_connector_state","description":"Read connector configuration and current sync state for diagnosis.","input_schema":{"type":"object","properties":{"connectorId":{"type":"string","description":"UUID of the connector_configs row."}},"required":["connectorId"]}}'::jsonb,
  'none', false, true, now(), now()),

(gen_random_uuid(), 'read_dlq_recent', 'read_dlq_recent', 'Read DLQ Recent', 'Read recent DLQ jobs from pg-boss.',
  '{"name":"read_dlq_recent","description":"Read recent DLQ (dead-letter queue) jobs from pg-boss. Capped at 20 rows.","input_schema":{"type":"object","properties":{"queueName":{"type":"string","description":"Optional specific DLQ queue name (e.g. agent-scheduled-run__dlq). Omit to query all DLQs."},"limit":{"type":"string","description":"Max results to return (default 20, max 20)."}},"required":[]}}'::jsonb,
  'none', false, true, now(), now()),

(gen_random_uuid(), 'read_logs_for_correlation_id', 'read_logs_for_correlation_id', 'Read Logs For Correlation ID', 'Read process-local log lines for a correlation ID.',
  '{"name":"read_logs_for_correlation_id","description":"Read process-local log lines for a correlation ID. Capped at 200 lines or 100 KB.","input_schema":{"type":"object","properties":{"correlationId":{"type":"string","description":"Correlation ID to look up log lines for."}},"required":["correlationId"]}}'::jsonb,
  'none', false, true, now(), now()),

-- ─── Write skills ─────────────────────────────────────────────────────────────

(gen_random_uuid(), 'write_diagnosis', 'write_diagnosis', 'Write Diagnosis', 'Write agent diagnosis and investigate prompt to a system incident.',
  '{"name":"write_diagnosis","description":"Write an agent diagnosis and optional investigate_prompt to a system incident. Idempotent on (incidentId, agentRunId).","input_schema":{"type":"object","properties":{"incidentId":{"type":"string","description":"UUID of the system incident to annotate."},"agentRunId":{"type":"string","description":"UUID of the agent run producing this diagnosis."},"diagnosis":{"type":"object","description":"Structured diagnosis object written to agent_diagnosis column."},"investigatePrompt":{"type":"string","description":"Optional investigate prompt text (200–6000 chars)."}},"required":["incidentId","agentRunId","diagnosis"]}}'::jsonb,
  'none', true, true, now(), now()),

(gen_random_uuid(), 'write_event', 'write_event', 'Write Event', 'Append a system incident event of an allowed type.',
  '{"name":"write_event","description":"Append a system incident event of an allowed type (diagnosis, note, escalation_blocked). Idempotent on (incidentId, eventType, agentRunId).","input_schema":{"type":"object","properties":{"incidentId":{"type":"string","description":"UUID of the incident to append an event to."},"eventType":{"type":"string","description":"Event type to write.","enum":["diagnosis","note","escalation_blocked"]},"agentRunId":{"type":"string","description":"UUID of the agent run writing this event (used for idempotency)."},"payload":{"type":"object","description":"Optional structured payload for the event."}},"required":["incidentId","eventType"]}}'::jsonb,
  'none', true, true, now(), now())

ON CONFLICT (slug) DO NOTHING;

-- ─── Wire skills to system_monitor agent ─────────────────────────────────────

UPDATE system_agents
SET
  default_system_skill_slugs = '["read_incident","read_agent_run","read_skill_execution","read_recent_runs_for_agent","read_baseline","read_heuristic_fires","read_connector_state","read_dlq_recent","read_logs_for_correlation_id","write_diagnosis","write_event"]'::jsonb,
  updated_at = now()
WHERE slug = 'system_monitor';
