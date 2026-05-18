import { z } from 'zod';
import type { ActionDefinition } from './types.js';
import { defineConfigWrite } from './factories.js';

export const configurationActions: Record<string, ActionDefinition> = {
  // ---------------------------------------------------------------------------
  // Configuration Assistant — mutation tools (1–15) + restore (28)
  // ---------------------------------------------------------------------------
  config_create_agent: {
    actionType: 'config_create_agent',
    description: 'Create a new org-level agent via the Configuration Assistant',
    actionCategory: 'api',
    topics: ['configuration'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'review',
    riskTier: 3,
    createsBoardTask: false,
    payloadFields: [],
    parameterSchema: z.object({
      name: z.string().describe('Agent name'),
      description: z.string().optional().describe('Agent description'),
      masterPrompt: z.string().describe('Master prompt / system instructions for the agent'),
      modelProvider: z.string().optional().default('anthropic').describe('LLM provider (default: anthropic)'),
      modelId: z.string().optional().default('claude-sonnet-4-6').describe('Model ID (default: claude-sonnet-4-6)'),
      responseMode: z.enum(['balanced', 'focused', 'creative']).optional().describe('Response mode'),
      outputSize: z.enum(['concise', 'standard', 'detailed']).optional().describe('Output size preference'),
      defaultSkillSlugs: z.array(z.string()).optional().describe('Default skill slugs to attach'),
      icon: z.string().optional().describe('Icon identifier for the agent'),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'auth_error'],
    },
    idempotencyStrategy: 'keyed_write',
    // Trust & Verification Layer §6.1 — review-gated config write: HITL approval is the
    // verification boundary; actionService wrapper has no comparable post-check shape.
    verify: null,
    verifyNullJustification:
      'Review-gated config write: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    reversible: true,
    blastRadius: 'tenant',
  },
  config_update_agent: defineConfigWrite({
    slug: 'config_update_agent',
    description: 'Update an existing org agent via the Configuration Assistant',
    parameterSchema: z.object({
      agentId: z.string().describe('ID of the agent to update'),
      name: z.string().optional().describe('Agent name'),
      description: z.string().optional().describe('Agent description'),
      masterPrompt: z.string().optional().describe('Master prompt / system instructions'),
      modelProvider: z.string().optional().describe('LLM provider'),
      modelId: z.string().optional().describe('Model ID'),
      responseMode: z.enum(['balanced', 'focused', 'creative']).optional().describe('Response mode'),
      outputSize: z.enum(['concise', 'standard', 'detailed']).optional().describe('Output size preference'),
      defaultSkillSlugs: z.array(z.string()).optional().describe('Default skill slugs to attach'),
      icon: z.string().optional().describe('Icon identifier for the agent'),
    }),
  }),
  config_activate_agent: defineConfigWrite({
    slug: 'config_activate_agent',
    description: 'Set agent status to active or inactive via the Configuration Assistant',
    parameterSchema: z.object({
      agentId: z.string().describe('ID of the agent'),
      status: z.enum(['active', 'inactive']).describe('Target status'),
    }),
  }),
  config_link_agent: defineConfigWrite({
    slug: 'config_link_agent',
    description: 'Link an org agent to a subaccount via the Configuration Assistant',
    parameterSchema: z.object({
      agentId: z.string().describe('ID of the org agent to link'),
      subaccountId: z.string().describe('ID of the target subaccount'),
      isActive: z.boolean().optional().default(true).describe('Whether the link is active (default: true)'),
    }),
  }),
  config_update_link: defineConfigWrite({
    slug: 'config_update_link',
    description: 'Update a subaccount agent link via the Configuration Assistant',
    parameterSchema: z.object({
      linkId: z.string().describe('ID of the subaccount-agent link'),
      subaccountId: z.string().describe('ID of the subaccount'),
      skillSlugs: z.array(z.string()).optional().describe('Skill slugs to attach'),
      customInstructions: z.string().optional().describe('Custom instructions for this link'),
      tokenBudgetPerRun: z.number().optional().describe('Token budget per run'),
      maxToolCallsPerRun: z.number().optional().describe('Max tool calls per run'),
      timeoutSeconds: z.number().optional().describe('Timeout in seconds'),
      maxCostPerRunCents: z.number().optional().describe('Max cost per run in cents'),
      maxLlmCallsPerRun: z.number().optional().describe('Max LLM calls per run'),
      heartbeatEnabled: z.boolean().optional().describe('Enable heartbeat schedule'),
      heartbeatIntervalHours: z.number().optional().describe('Heartbeat interval in hours'),
      heartbeatOffsetMinutes: z.number().optional().describe('Heartbeat offset in minutes'),
      scheduleCron: z.string().optional().describe('Cron expression for schedule'),
      scheduleEnabled: z.boolean().optional().describe('Enable cron schedule'),
      isActive: z.boolean().optional().describe('Whether the link is active'),
    }),
  }),
  config_set_link_skills: defineConfigWrite({
    slug: 'config_set_link_skills',
    description: 'Set skill slugs on a subaccount agent link via the Configuration Assistant',
    parameterSchema: z.object({
      linkId: z.string().describe('ID of the subaccount-agent link'),
      subaccountId: z.string().describe('ID of the subaccount'),
      skillSlugs: z.array(z.string()).describe('Skill slugs to set on the link'),
    }),
  }),
  config_set_link_instructions: defineConfigWrite({
    slug: 'config_set_link_instructions',
    description: 'Set custom instructions on a subaccount agent link via the Configuration Assistant',
    riskTier: 2,
    parameterSchema: z.object({
      linkId: z.string().describe('ID of the subaccount-agent link'),
      subaccountId: z.string().describe('ID of the subaccount'),
      customInstructions: z.string().describe('Custom instructions text'),
    }),
  }),
  config_set_link_schedule: defineConfigWrite({
    slug: 'config_set_link_schedule',
    description: 'Set schedule on a subaccount agent link via the Configuration Assistant',
    parameterSchema: z.object({
      linkId: z.string().describe('ID of the subaccount-agent link'),
      subaccountId: z.string().describe('ID of the subaccount'),
      heartbeatEnabled: z.boolean().optional().describe('Enable heartbeat schedule'),
      heartbeatIntervalHours: z.number().optional().describe('Heartbeat interval in hours'),
      heartbeatOffsetMinutes: z.number().optional().describe('Heartbeat offset in minutes'),
      scheduleCron: z.string().optional().describe('Cron expression for schedule'),
      scheduleEnabled: z.boolean().optional().describe('Enable cron schedule'),
      scheduleTimezone: z.string().optional().describe('IANA timezone for the schedule'),
    }),
  }),
  config_set_link_limits: defineConfigWrite({
    slug: 'config_set_link_limits',
    description: 'Set execution limits on a subaccount agent link via the Configuration Assistant',
    parameterSchema: z.object({
      linkId: z.string().describe('ID of the subaccount-agent link'),
      subaccountId: z.string().describe('ID of the subaccount'),
      tokenBudgetPerRun: z.number().optional().describe('Token budget per run'),
      maxToolCallsPerRun: z.number().optional().describe('Max tool calls per run'),
      timeoutSeconds: z.number().optional().describe('Timeout in seconds'),
      maxCostPerRunCents: z.number().optional().describe('Max cost per run in cents'),
      maxLlmCallsPerRun: z.number().optional().describe('Max LLM calls per run'),
    }),
  }),
  config_create_subaccount: defineConfigWrite({
    slug: 'config_create_subaccount',
    description: 'Create a new subaccount via the Configuration Assistant',
    parameterSchema: z.object({
      name: z.string().describe('Subaccount name'),
      slug: z.string().optional().describe('URL-friendly slug (auto-generated if omitted)'),
    }),
  }),
  config_create_scheduled_task: defineConfigWrite({
    slug: 'config_create_scheduled_task',
    description: 'Create a scheduled task via the Configuration Assistant',
    parameterSchema: z.object({
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description'),
      brief: z.string().optional().describe('Agent brief / instructions'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('Task priority'),
      assignedAgentId: z.string().optional().describe('Agent ID to assign the task to'),
      subaccountId: z.string().describe('Subaccount ID for the task'),
      rrule: z.string().optional().describe('RRULE recurrence string'),
      timezone: z.string().optional().describe('IANA timezone'),
      scheduleTime: z.string().optional().describe('Time of day for scheduled execution'),
      isActive: z.boolean().optional().describe('Whether the scheduled task is active'),
    }),
  }),
  config_update_scheduled_task: defineConfigWrite({
    slug: 'config_update_scheduled_task',
    description: 'Update a scheduled task via the Configuration Assistant',
    parameterSchema: z.object({
      taskId: z.string().describe('ID of the scheduled task to update'),
      subaccountId: z.string().describe('Subaccount ID for the task'),
      title: z.string().optional().describe('Task title'),
      description: z.string().optional().describe('Task description'),
      brief: z.string().optional().describe('Agent brief / instructions'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('Task priority'),
      assignedAgentId: z.string().optional().describe('Agent ID to assign the task to'),
      rrule: z.string().optional().describe('RRULE recurrence string'),
      timezone: z.string().optional().describe('IANA timezone'),
      scheduleTime: z.string().optional().describe('Time of day for scheduled execution'),
      isActive: z.boolean().optional().describe('Whether the scheduled task is active'),
    }),
  }),
  config_attach_data_source: defineConfigWrite({
    slug: 'config_attach_data_source',
    description: 'Attach a data source to an agent or link via the Configuration Assistant',
    parameterSchema: z.object({
      name: z.string().describe('Data source name'),
      sourceType: z.enum(['http_url', 'file_upload']).describe('Type of data source'),
      sourcePath: z.string().describe('URL or file path for the data source'),
      contentType: z.string().optional().describe('MIME content type'),
      priority: z.number().optional().describe('Loading priority'),
      maxTokenBudget: z.number().optional().describe('Max token budget for this source'),
      cacheMinutes: z.number().optional().describe('Cache duration in minutes'),
      agentId: z.string().optional().describe('Org agent ID to attach to'),
      subaccountAgentId: z.string().optional().describe('Subaccount-agent link ID to attach to'),
      scheduledTaskId: z.string().optional().describe('Scheduled task ID to attach to'),
    }),
  }),
  config_update_data_source: defineConfigWrite({
    slug: 'config_update_data_source',
    description: 'Update a data source via the Configuration Assistant',
    riskTier: 2,
    parameterSchema: z.object({
      dataSourceId: z.string().describe('ID of the data source to update'),
      name: z.string().optional().describe('Data source name'),
      priority: z.number().optional().describe('Loading priority'),
      maxTokenBudget: z.number().optional().describe('Max token budget for this source'),
      cacheMinutes: z.number().optional().describe('Cache duration in minutes'),
      contentType: z.string().optional().describe('MIME content type'),
    }),
  }),
  config_remove_data_source: defineConfigWrite({
    slug: 'config_remove_data_source',
    description: 'Remove a data source via the Configuration Assistant',
    parameterSchema: z.object({
      dataSourceId: z.string().describe('ID of the data source to remove'),
    }),
  }),
  config_restore_version: defineConfigWrite({
    slug: 'config_restore_version',
    description: 'Restore an entity to a previous version via the Configuration Assistant',
    parameterSchema: z.object({
      entityType: z.string().describe('Type of entity to restore (e.g. agent, link, scheduled_task)'),
      entityId: z.string().describe('ID of the entity to restore'),
      version: z.number().describe('Version number to restore to'),
    }),
  }),

  // ── Phase G — portal + email skills (spec §11.6) — action_call only ────────
  // NOT callable from human-initiated Configuration Assistant sessions; only
  // reachable via action_call steps in playbook templates.

  // ── Memory & Briefings Phase 3 — Weekly Digest gather ────────────────────
  config_weekly_digest_gather: {
    actionType: 'config_weekly_digest_gather',
    description: 'Aggregates past 7 days of activity, memory events, KPI deltas, pending items, and next-week scheduled tasks for the Weekly Digest playbook.',
    actionCategory: 'api',
    topics: ['playbook', 'analytics'],
    isExternal: false,
    readPath: 'canonical',
    defaultGateLevel: 'auto',
    riskTier: 0,
    createsBoardTask: false,
    payloadFields: ['subaccountId'],
    parameterSchema: z.object({
      subaccountId: z.string().describe('Target subaccount'),
      organisationId: z.string().describe('Tenant scope'),
      windowDays: z.number().int().positive().max(90).default(7),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    idempotencyStrategy: 'read_only',
  },

  // ── Memory & Briefings Phase 3 — Weekly Digest delivery ──────────────────
  config_deliver_workflow_output: {
    actionType: 'config_deliver_workflow_output',
    description: 'Deliver a playbook artefact via deliveryService: always writes to inbox + dispatches portal/slack per deliveryChannels config.',
    actionCategory: 'api',
    topics: ['playbook', 'delivery'],
    isExternal: false,
    readPath: 'none',
    // defaultGateLevel='auto' is preserved (existing behaviour, INV-8). The
    // tier reflects the audience-impact rule (spec §4.2.3 line 491): when the
    // delivery channel reaches a customer (email, portal), this lands → Tier 6.
    defaultGateLevel: 'auto',
    riskTier: 6,
    createsBoardTask: true,
    payloadFields: ['subaccountId', 'artefactTitle', 'artefactContent'],
    parameterSchema: z.object({
      subaccountId: z.string().describe('Target subaccount'),
      organisationId: z.string().describe('Tenant scope'),
      artefactTitle: z.string().describe('Title of the inbox item / artefact'),
      artefactContent: z.string().describe('Body content (markdown)'),
      deliveryChannels: z.object({
        email: z.boolean().default(true),
        portal: z.boolean().default(true),
        slack: z.boolean().default(false),
      }).optional(),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'auth_error'],
    },
    idempotencyStrategy: 'keyed_write',
  },

  config_publish_workflow_output_to_portal: {
    actionType: 'config_publish_workflow_output_to_portal',
    description: 'Publish a playbook step\'s output to the sub-account portal card. Creates or updates the portal_cards row for this run and marks the run portal-visible.',
    actionCategory: 'api',
    topics: ['portal', 'playbook'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 2,
    createsBoardTask: false,
    payloadFields: ['runId', 'playbookSlug', 'title', 'bullets', 'detailMarkdown'],
    parameterSchema: z.object({
      runId: z.string().optional().describe('The playbook run ID producing this output (injected from context when absent)'),
      playbookSlug: z.string().describe('Slug of the playbook template'),
      title: z.string().describe('Card title shown on the portal'),
      bullets: z.array(z.string()).describe('Headline bullet points'),
      detailMarkdown: z.string().optional().describe('Long-form markdown shown in the run modal'),
    }),
    retryPolicy: {
      maxRetries: 3,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'auth_error'],
    },
    idempotencyStrategy: 'keyed_write',
  },

  // ── Workflow V1 — start a workflow run from within an agent skill ──────────
  'workflow.run.start': {
    actionType: 'workflow.run.start',
    description: 'Start a new workflow run for a published org workflow template. Returns the task_id of the newly created workflow task.',
    actionCategory: 'api',
    topics: ['workflow', 'automation'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'auto',
    riskTier: 3,
    createsBoardTask: true,
    payloadFields: ['workflow_template_id', 'template_version_id', 'initial_inputs'],
    parameterSchema: z.object({
      workflow_template_id: z.string().uuid().describe('UUID of the org workflow template to run'),
      template_version_id: z.string().uuid().optional().describe('Pin to a specific version; omit for latest published'),
      initial_inputs: z.record(z.unknown()).optional().default({}).describe('Initial input values for the workflow'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    idempotencyStrategy: 'keyed_write',
  },

  config_send_workflow_email_digest: {
    actionType: 'config_send_workflow_email_digest',
    description: 'Send a markdown email digest to a list of recipients. Deduplicated per (runId, sorted recipients) so retries never double-send.',
    actionCategory: 'api',
    topics: ['email', 'playbook'],
    isExternal: true,
    readPath: 'none',
    defaultGateLevel: 'review',
    // Spec §4.2.3 line 491: client-messaging that lands in the customer's
    // inbox → Tier 6. defaultGateLevel remains 'review' so existing behaviour
    // is unchanged (INV-8).
    riskTier: 6,
    createsBoardTask: false,
    payloadFields: ['runId', 'to', 'subject', 'bodyMarkdown'],
    parameterSchema: z.object({
      runId: z.string().optional().describe('The playbook run ID issuing this email (injected from context when absent)'),
      to: z.array(z.string().email()).describe('Recipient email addresses'),
      subject: z.string().describe('Email subject line'),
      bodyMarkdown: z.string().describe('Email body in Markdown'),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'auth_error'],
    },
    idempotencyStrategy: 'locked',
  },
};
