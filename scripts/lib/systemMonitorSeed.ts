// scripts/lib/systemMonitorSeed.ts
//
// Seed data for the System Monitor system agent. Source of truth for the
// 11 system_skills rows that the agent calls (9 read + 2 write) and the
// system principal user that owns system-initiated agent runs.
//
// Previously seeded by migrations 0234/0235/0236; relocated here so all
// system_monitor seed data lives alongside the rest of the seed pipeline.
// Migration 0233 still provides the schema (tables, columns, CHECK widening).
//
// All definitions match the runtime tool surface in
// server/services/systemMonitor/skills/. The write_event enum here is the
// widened set (post-0236-correction) covering every Phase 2 agent-allowed
// event type.

export interface SystemMonitorSkillSeed {
  slug: string;
  handlerKey: string;
  name: string;
  description: string;
  /** Anthropic tool definition (name, description, input_schema). */
  definition: Record<string, unknown>;
  /** read skills = false, write skills = true. */
  sideEffects: boolean;
}

export const SYSTEM_MONITOR_SKILL_SEEDS: SystemMonitorSkillSeed[] = [
  // ─── Read skills ────────────────────────────────────────────────────────
  {
    slug: 'read_incident',
    handlerKey: 'read_incident',
    name: 'Read Incident',
    description: 'Read a system incident and its last 20 events.',
    sideEffects: false,
    definition: {
      name: 'read_incident',
      description: 'Read a system incident row and its last 20 events for diagnosis context.',
      input_schema: {
        type: 'object',
        properties: {
          incidentId: { type: 'string', description: 'UUID of the system_incidents row to read.' },
        },
        required: ['incidentId'],
      },
    },
  },
  {
    slug: 'read_agent_run',
    handlerKey: 'read_agent_run',
    name: 'Read Agent Run',
    description: 'Read an agent run and its message history.',
    sideEffects: false,
    definition: {
      name: 'read_agent_run',
      description: 'Read an agent run and its message history for diagnosis. Capped at 50 messages or 100 KB.',
      input_schema: {
        type: 'object',
        properties: {
          agentRunId: { type: 'string', description: 'UUID of the agent_runs row to read.' },
        },
        required: ['agentRunId'],
      },
    },
  },
  {
    slug: 'read_skill_execution',
    handlerKey: 'read_skill_execution',
    name: 'Read Skill Execution',
    description: 'Read the tool_use/tool_result pair for a skill execution.',
    sideEffects: false,
    definition: {
      name: 'read_skill_execution',
      description: 'Read the tool_use/tool_result message pair for a skill execution by tool call ID.',
      input_schema: {
        type: 'object',
        properties: {
          toolCallId: { type: 'string', description: 'The tool call ID identifying the skill execution.' },
        },
        required: ['toolCallId'],
      },
    },
  },
  {
    slug: 'read_recent_runs_for_agent',
    handlerKey: 'read_recent_runs_for_agent',
    name: 'Read Recent Runs For Agent',
    description: 'Read the last 20 runs for an agent (summary only).',
    sideEffects: false,
    definition: {
      name: 'read_recent_runs_for_agent',
      description: 'Read the last 20 runs for an agent (summary fields only, no messages).',
      input_schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'UUID of the agent. Preferred over agentSlug.' },
          agentSlug: { type: 'string', description: 'Slug of a system-managed agent. Used if agentId is unavailable.' },
        },
        required: [],
      },
    },
  },
  {
    slug: 'read_baseline',
    handlerKey: 'read_baseline',
    name: 'Read Baseline',
    description: 'Read baseline metrics for an entity/metric pair.',
    sideEffects: false,
    definition: {
      name: 'read_baseline',
      description: 'Read the current baseline metrics (p50, p95, p99, mean, stddev) for an entity/metric pair.',
      input_schema: {
        type: 'object',
        properties: {
          entityKind: {
            type: 'string',
            description: 'Entity kind: agent, skill, connector, job_queue, or llm_router.',
            enum: ['agent', 'skill', 'connector', 'job_queue', 'llm_router'],
          },
          entityId: { type: 'string', description: 'Entity identifier (e.g. agent slug, skill slug, connector ID).' },
          metric: { type: 'string', description: 'Metric name (e.g. runtime_ms, output_length_chars, success_rate).' },
        },
        required: ['entityKind', 'entityId', 'metric'],
      },
    },
  },
  {
    slug: 'read_heuristic_fires',
    handlerKey: 'read_heuristic_fires',
    name: 'Read Heuristic Fires',
    description: 'Read recent heuristic fires for an entity.',
    sideEffects: false,
    definition: {
      name: 'read_heuristic_fires',
      description: 'Read recent heuristic fire records for an entity. Capped at 20.',
      input_schema: {
        type: 'object',
        properties: {
          entityKind: { type: 'string', description: 'Entity kind: agent_run, job, skill_execution, connector_poll, or llm_call.' },
          entityId: { type: 'string', description: 'Entity identifier (e.g. agent run UUID).' },
          limit: { type: 'string', description: 'Max results to return (default 20, max 20).' },
        },
        required: ['entityKind', 'entityId'],
      },
    },
  },
  {
    slug: 'read_connector_state',
    handlerKey: 'read_connector_state',
    name: 'Read Connector State',
    description: 'Read connector configuration and current sync state.',
    sideEffects: false,
    definition: {
      name: 'read_connector_state',
      description: 'Read connector configuration and current sync state for diagnosis.',
      input_schema: {
        type: 'object',
        properties: {
          connectorId: { type: 'string', description: 'UUID of the connector_configs row.' },
        },
        required: ['connectorId'],
      },
    },
  },
  {
    slug: 'read_dlq_recent',
    handlerKey: 'read_dlq_recent',
    name: 'Read DLQ Recent',
    description: 'Read recent DLQ jobs from pg-boss.',
    sideEffects: false,
    definition: {
      name: 'read_dlq_recent',
      description: 'Read recent DLQ (dead-letter queue) jobs from pg-boss. Capped at 20 rows.',
      input_schema: {
        type: 'object',
        properties: {
          queueName: { type: 'string', description: 'Optional specific DLQ queue name (e.g. agent-scheduled-run__dlq). Omit to query all DLQs.' },
          limit: { type: 'string', description: 'Max results to return (default 20, max 20).' },
        },
        required: [],
      },
    },
  },
  {
    slug: 'read_logs_for_correlation_id',
    handlerKey: 'read_logs_for_correlation_id',
    name: 'Read Logs For Correlation ID',
    description: 'Read process-local log lines for a correlation ID.',
    sideEffects: false,
    definition: {
      name: 'read_logs_for_correlation_id',
      description: 'Read process-local log lines for a correlation ID. Capped at 200 lines or 100 KB.',
      input_schema: {
        type: 'object',
        properties: {
          correlationId: { type: 'string', description: 'Correlation ID to look up log lines for.' },
        },
        required: ['correlationId'],
      },
    },
  },

  // ─── Write skills ───────────────────────────────────────────────────────
  {
    slug: 'write_diagnosis',
    handlerKey: 'write_diagnosis',
    name: 'Write Diagnosis',
    description: 'Write agent diagnosis and investigate prompt to a system incident.',
    sideEffects: true,
    definition: {
      name: 'write_diagnosis',
      description: 'Write an agent diagnosis and optional investigate_prompt to a system incident. Idempotent on (incidentId, agentRunId).',
      input_schema: {
        type: 'object',
        properties: {
          incidentId: { type: 'string', description: 'UUID of the system incident to annotate.' },
          agentRunId: { type: 'string', description: 'UUID of the agent run producing this diagnosis.' },
          diagnosis: { type: 'object', description: 'Structured diagnosis object written to agent_diagnosis column.' },
          investigatePrompt: { type: 'string', description: 'Optional investigate prompt text (200–6000 chars).' },
        },
        required: ['incidentId', 'agentRunId', 'diagnosis'],
      },
    },
  },
  {
    slug: 'write_event',
    handlerKey: 'write_event',
    name: 'Write Event',
    description: 'Append a system incident event of an agent-allowed type.',
    sideEffects: true,
    definition: {
      name: 'write_event',
      description: 'Append a system incident event of an agent-allowed type. Idempotent on (incidentId, eventType, agentRunId). Lifecycle transitions (status_change, ack, resolve) are not allowed.',
      input_schema: {
        type: 'object',
        properties: {
          incidentId: { type: 'string', description: 'UUID of the incident to append an event to.' },
          eventType: {
            type: 'string',
            description: 'Event type to write. See allowed list in write_event handler.',
            enum: [
              'diagnosis',
              'note',
              'escalation_blocked',
              'agent_diagnosis_added',
              'agent_triage_skipped',
              'agent_triage_failed',
              'heuristic_fired',
              'heuristic_suppressed',
              'sweep_completed',
              'sweep_capped',
              'prompt_generated',
            ],
          },
          agentRunId: { type: 'string', description: 'UUID of the agent run writing this event (used for idempotency).' },
          payload: { type: 'object', description: 'Optional structured payload for the event.' },
        },
        required: ['incidentId', 'eventType'],
      },
    },
  },
];

export const SYSTEM_MONITOR_SKILL_SLUGS: string[] = SYSTEM_MONITOR_SKILL_SEEDS.map((s) => s.slug);

/**
 * The system principal user — owns system-initiated agent runs so audit logs
 * have a valid actor. password_hash is a non-functional placeholder; the
 * system principal never authenticates interactively.
 */
export const SYSTEM_PRINCIPAL_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'system@platform.local',
  passwordHash: '$2b$12$system.principal.placeholder.hash.not.used.for.auth',
  firstName: 'System',
  lastName: 'Principal',
  role: 'system_admin' as const,
  status: 'active' as const,
};
