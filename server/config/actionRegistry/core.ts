import { z } from 'zod';
import type { ActionDefinition } from './types.js';
import {
  defineInternalRead,
  defineExternalRead,
  defineInternalStateWrite,
  defineExternalWrite,
  defineCustomerMessagingWrite,
} from './factories.js';

export const coreActions: Record<string, ActionDefinition> = {
  // ── Capability discovery (Orchestrator capability-aware routing spec §4) ──
  list_platform_capabilities: defineInternalRead({
    slug: 'list_platform_capabilities',
    description:
      'Return the platform integration catalogue as structured data — which integrations exist, ' +
      'what capabilities each enables, current status and confidence. Sourced from ' +
      'docs/integration-reference.md. Read-only; supports filter by provider_type, status, or slug.',
    topics: ['capability_discovery'],
    readPath: 'none',
    riskTier: 0,
    payloadFields: ['filter', 'include_schema_meta'],
    parameterSchema: z.object({
      filter: z
        .object({
          provider_type: z.string().optional().describe('Narrow by provider type (oauth, mcp, webhook, native, hybrid)'),
          status: z.string().optional().describe('Narrow by status (fully_supported, partial, stub, planned)'),
          slug: z.string().optional().describe('Fetch a single integration by slug'),
        })
        .optional()
        .describe('Optional filter to narrow the returned integration list'),
      include_schema_meta: z.boolean().optional().describe('When true, include the reference doc schema version and last_updated'),
    }),
  }),
  list_connections: defineInternalRead({
    slug: 'list_connections',
    description:
      'Return the live integration connections active for the caller\'s org or a specific subaccount. ' +
      'Returns provider slug, scopes granted, status, and connection age — never secrets.',
    topics: ['capability_discovery'],
    readPath: 'none',
    riskTier: 0,
    payloadFields: ['scope', 'orgId', 'subaccountId', 'include_inactive'],
    parameterSchema: z.object({
      scope: z.enum(['org', 'subaccount']).describe('Resolution scope for the query'),
      orgId: z.string().describe('Organisation ID (must match caller org)'),
      subaccountId: z.string().optional().describe('Subaccount ID — required when scope=subaccount'),
      include_inactive: z.boolean().optional().describe('Include revoked/expired/error connections'),
    }),
  }),
  check_capability_gap: defineInternalRead({
    slug: 'check_capability_gap',
    description:
      'Given a list of required capabilities, return whether they are configured (an agent has them, ' +
      'with active connections and required scopes), configurable (platform supports but not yet set up), ' +
      'or unsupported (platform does not provide). The Orchestrator uses this to classify tasks into ' +
      'routing paths A, B, C, D per the capability-aware routing spec.',
    topics: ['capability_discovery'],
    readPath: 'none',
    riskTier: 0,
    payloadFields: ['orgId', 'subaccountId', 'required_capabilities'],
    parameterSchema: z.object({
      orgId: z.string().describe('Organisation ID (must match caller org)'),
      subaccountId: z.string().optional().describe('Subaccount ID (optional — inferred from context if not provided)'),
      required_capabilities: z
        .array(
          z.object({
            kind: z.enum(['integration', 'read_capability', 'write_capability', 'skill', 'primitive'])
              .describe('Capability kind'),
            slug: z.string().describe('Capability slug — may be a canonical form or a taxonomy alias'),
          }),
        )
        .min(1)
        .describe('The list of capabilities a task needs to proceed'),
    }),
  }),
  request_feature: defineInternalStateWrite({
    slug: 'request_feature',
    description:
      'File a feature request against the platform. Writes a durable feature_requests row with per-org ' +
      'dedupe (30-day window, canonical slug hash) and fires best-effort Slack/email/Synthetos-task ' +
      'notifications. Used by the Orchestrator on Path C (system-promotion candidate) and Path D ' +
      '(unsupported capability) per the capability-aware routing spec.',
    topics: ['capability_discovery', 'feature_request'],
    riskTier: 1,
    payloadFields: [
      'category', 'summary', 'user_intent', 'required_capabilities', 'missing_capabilities',
      'orchestrator_reasoning', 'source_task_id', 'orgId', 'subaccountId', 'requested_by_user_id',
    ],
    parameterSchema: z.object({
      category: z.enum(['new_capability', 'system_promotion_candidate', 'infrastructure_alert']),
      summary: z.string().min(1).max(200).describe('Short title for the request'),
      user_intent: z.string().min(1).describe('Verbatim user task text or intent'),
      required_capabilities: z
        .array(
          z.object({
            kind: z.enum(['integration', 'read_capability', 'write_capability', 'skill', 'primitive']),
            slug: z.string(),
          }),
        )
        .describe('The Orchestrator\'s decomposed capability list (post-normalisation)'),
      missing_capabilities: z
        .array(
          z.object({
            kind: z.enum(['integration', 'read_capability', 'write_capability', 'skill', 'primitive']),
            slug: z.string(),
          }),
        )
        .describe('Subset of required_capabilities that the platform does not have'),
      orchestrator_reasoning: z.string().optional().describe('Paragraph explaining the classification'),
      source_task_id: z.string().optional().describe('Originating task, when filed from the task board'),
      orgId: z.string().describe('Organisation ID (must match caller)'),
      subaccountId: z.string().optional(),
      requested_by_user_id: z.string().describe('User the request is attributed to'),
    }),
    idempotencyStrategy: 'keyed_write',
  }),
  // Spec §4.2.3 line 491: client-messaging actions that land in a customer
  // inbox/feed → Tier 6 (max-tier rule §4.2.3 line 493). defaultGateLevel
  // remains 'review' so existing-org behaviour is unchanged (INV-8).
  // Trust & Verification Layer §6.1 — review-gated send: HITL approval is the verification
  // boundary. The actionService wrapper (`{ status: 'pending_approval' | 'approved' | ... }`)
  // is not a raw provider response, so api_status_2xx would always evaluate inconclusive.
  send_email: {
    ...defineCustomerMessagingWrite({
      slug: 'send_email',
      description: 'Send an email via a connected email provider. Requires human approval before sending.',
      topics: ['email'],
      riskTier: 6,
      verifyActionNoun: 'send',
      payloadFields: ['to', 'subject', 'body', 'thread_id', 'provider'],
      parameterSchema: z.object({
        to: z.string().describe('Recipient email address'),
        subject: z.string().describe('Email subject line'),
        body: z.string().describe('Email body content (plain text or HTML)'),
        thread_id: z.string().optional().describe('Thread ID to reply within an existing conversation (optional)'),
        provider: z.string().optional().describe('Email provider to use (e.g. "gmail", "outlook"). Defaults to the configured default.'),
      }),
      retryPolicy: {
        maxRetries: 3,
        strategy: 'exponential_backoff',
        retryOn: ['timeout', 'network_error', 'rate_limit'],
        doNotRetryOn: ['validation_error', 'auth_error', 'recipient_not_found'],
      },
      requiredIntegration: 'gmail',
      idempotencyStrategy: 'locked',
    }),
    createsBoardTask: true,
    requiresCritiqueGate: true,
  },
  // Spec §4.2.3 line 487: external API reads → Tier 2.
  read_inbox: defineExternalRead({
    slug: 'read_inbox',
    description: 'Read recent emails from a connected email provider inbox.',
    topics: ['email'],
    riskTier: 2,
    liveFetchRationale: 'Provider API — email inbox data not yet migrated to canonical',
    payloadFields: ['provider', 'since'],
    parameterSchema: z.object({
      provider: z.string().describe('Email provider to read from (e.g. "gmail", "outlook")'),
      since: z.string().optional().describe('ISO 8601 timestamp — only return emails after this date'),
    }),
    retryPolicy: {
      maxRetries: 3,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['auth_error'],
    },
    requiredIntegration: 'gmail',
  }),
  // Trust & Verification Layer §6.1 — auto-gated internal write; the action service
  // returns a `{ status: 'completed' | ... }` wrapper, not a raw row. A concrete
  // `row_exists` check would need to read `result.actionId` and join to `actions`
  // before reaching `tasks` — that bridge is deferred to a follow-on. Internal
  // writes are covered by RLS audit + service tests in the meantime.
  create_task: {
    ...defineInternalStateWrite({
      slug: 'create_task',
      description: 'Create a new task on the board with title, description, and optional agent assignment.',
      topics: ['task'],
      riskTier: 2,
      payloadFields: ['title', 'description', 'brief', 'status', 'priority', 'assigned_agent_id'],
      parameterSchema: z.object({
        title: z.string().describe('Short title for the work item'),
        description: z.string().optional().describe('Human-readable description visible in the task card'),
        brief: z.string().optional().describe('Self-contained instructions for the agent picking up this task'),
        status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done']).optional().describe('Initial status (default: todo)'),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('Task priority (default: normal)'),
        assigned_agent_id: z.string().optional().describe('Agent ID to assign the task to'),
      }),
      retryPolicy: { maxRetries: 2, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
      idempotencyStrategy: 'keyed_write',
    }),
    verify: null,
    verifyNullJustification:
      'Auto-gated internal write — backfill candidate; current actionService wrapper does not directly expose tasks.id post-write',
    reversible: true,
    blastRadius: 'tenant',
  },
  triage_intake: defineInternalStateWrite({
    slug: 'triage_intake',
    riskTier: 1,
    description:
      "Capture and route incoming ideas, feature requests, or bugs into the task board. " +
      "Two modes: 'capture' creates a single structured task in the 'inbox' (untriaged) column " +
      "from raw text — fast, judgement-free intake used by the Orchestrator and Business Analyst " +
      "when items arrive outside normal channels. 'triage' scans the existing inbox for items " +
      "lacking a triage decision and returns a structured proposal list (duplicate check, " +
      "rough relevance, suggested disposition) for human or Orchestrator review.",
    topics: ['task'],
    payloadFields: ['mode', 'raw_input', 'input_type', 'source', 'related_task_id', 'scope'],
    parameterSchema: z.object({
      mode: z.enum(['capture', 'triage']).describe(
        "'capture' for fast intake of a single idea/bug; 'triage' to assess and route the inbox queue"
      ),
      raw_input: z
        .string()
        .optional()
        .describe('Raw text of the idea, bug, or feature request. Required in capture mode.'),
      input_type: z
        .enum(['idea', 'bug', 'chore'])
        .optional()
        .describe('Classification of the input. Required in capture mode.'),
      source: z
        .string()
        .optional()
        .describe(
          "Where this came from: human, support-agent, ba-agent, orchestrator, etc. " +
            'Required in capture mode.'
        ),
      related_task_id: z
        .string()
        .optional()
        .describe(
          'Optional reference to an existing board task this is related to (capture mode), ' +
            'or the specific task to triage (triage mode with scope=single).'
        ),
      scope: z
        .enum(['all', 'single'])
        .optional()
        .describe(
          "Triage mode only. 'all' processes the full untriaged inbox; 'single' (with " +
            'related_task_id) processes one item. Defaults to all.'
        ),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: ['validation_error'],
    },
    idempotencyStrategy: 'keyed_write',
  }),
  move_task: defineInternalStateWrite({
    slug: 'move_task',
    description: 'Move a task to a different status column on the board.',
    topics: ['task'],
    riskTier: 2,
    payloadFields: ['task_id', 'status'],
    parameterSchema: z.object({
      task_id: z.string().describe('The ID of the task to move'),
      status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done']).describe('Target status column'),
    }),
    retryPolicy: { maxRetries: 2, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  }),
  read_data_source: defineInternalRead({
    slug: 'read_data_source',
    description:
      'Query the run-scoped cascading context data sources. Two ops: `list` ' +
      'returns the manifest of all active sources visible to this run; `read` ' +
      'returns a slice of a specific source by id with offset/limit pagination. ' +
      'Enforces per-run call count and per-call token limits. Suppressed ' +
      'sources are invisible per spec §3.6.',
    topics: ['workspace'],
    readPath: 'none',
    riskTier: 0,
    payloadFields: ['op', 'id', 'offset', 'limit'],
    parameterSchema: z.object({
      op: z
        .enum(['list', 'read'])
        .describe(
          "'list' returns the manifest of active sources; 'read' returns a content slice for a specific source id",
        ),
      id: z
        .string()
        .optional()
        .describe("Source id (required when op='read')"),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Character offset into the source content (read op only; default 0)",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Maximum tokens to return in this call (read op only; clamped to MAX_READ_DATA_SOURCE_TOKENS_PER_CALL regardless of caller value)",
        ),
    }),
  }),
  reassign_task: defineInternalStateWrite({
    slug: 'reassign_task',
    description: 'Reassign a task to a different agent.',
    topics: ['task'],
    riskTier: 2,
    payloadFields: ['task_id', 'assigned_agent_id'],
    parameterSchema: z.object({
      task_id: z.string().describe('The ID of the task to reassign'),
      assigned_agent_id: z.string().describe('The agent ID to assign the task to'),
    }),
    retryPolicy: { maxRetries: 2, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  }),
  add_deliverable: defineInternalStateWrite({
    slug: 'add_deliverable',
    description: 'Attach a deliverable (document, artifact, output) to a task.',
    topics: ['task'],
    riskTier: 1,
    payloadFields: ['task_id', 'title', 'content', 'deliverable_type'],
    parameterSchema: z.object({
      task_id: z.string().describe('The ID of the task to attach the deliverable to'),
      title: z.string().describe('Title of the deliverable'),
      content: z.string().describe('Content of the deliverable (text, markdown, or JSON)'),
      deliverable_type: z.enum(['file', 'url', 'artifact']).optional().describe('Type of deliverable'),
    }),
    retryPolicy: { maxRetries: 2, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    idempotencyStrategy: 'keyed_write',
  }),
  // Trust & Verification Layer §6.1 — review-gated external write: HITL approval is the
  // verification boundary; actionService wrapper has no comparable post-check shape.
  update_record: {
    ...defineExternalWrite({
      slug: 'update_record',
      description: 'Update a record in an external system (CRM, database, etc.) via a connected provider.',
      topics: ['gh-integration'],
      riskTier: 3,
      payloadFields: ['provider', 'record_type', 'record_id', 'fields'],
      parameterSchema: z.object({
        provider: z.string().describe('Integration provider (e.g. "hubspot", "salesforce")'),
        record_type: z.string().describe('Type of record to update (e.g. "contact", "deal")'),
        record_id: z.string().describe('The ID of the record to update'),
        fields: z.record(z.string(), z.unknown()).describe('Key-value pairs of fields to update'),
      }),
      retryPolicy: {
        maxRetries: 3,
        strategy: 'exponential_backoff',
        retryOn: ['timeout', 'network_error'],
        doNotRetryOn: ['validation_error', 'not_found'],
      },
    }),
    verify: null,
    verifyNullJustification:
      'Review-gated external write: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    reversible: true,
    blastRadius: 'external',
  },
  // Spec §4.2.3 line 487: external API reads → Tier 2.
  // Trust & Verification Layer §6.1 — backfill candidate. The handler returns
  // through executeWithActionAudit, which wraps the response in the action
  // service envelope. A concrete api_status_2xx would need the runtime-check
  // dispatcher to unwrap `result` before evaluation; that bridge is deferred.
  fetch_url: {
    ...defineExternalRead({
      slug: 'fetch_url',
      description: 'Fetch content from a URL via HTTP request.',
      riskTier: 2,
      liveFetchRationale: 'Generic HTTP fetch — inherently live, not canonical data',
      payloadFields: ['url', 'method', 'headers', 'body'],
      parameterSchema: z.object({
        url: z.string().describe('The URL to fetch'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().describe('HTTP method (default: GET)'),
        headers: z.record(z.string(), z.unknown()).optional().describe('Optional HTTP headers as key-value pairs'),
        body: z.string().optional().describe('Optional request body (for POST/PUT/PATCH)'),
      }),
      retryPolicy: {
        maxRetries: 2,
        strategy: 'fixed',
        retryOn: ['timeout', 'network_error'],
        doNotRetryOn: ['validation_error'],
      },
    }),
    verify: null,
    verifyNullJustification:
      'External read — backfill candidate; current actionService wrapper hides the raw HTTP status from the runtime-check dispatcher',
    reversible: true,
    blastRadius: 'external',
  },
  // Spec §4.2.3 line 487-488: external scrape reads/extraction → Tier 2.
  // Trust & Verification Layer §6.1 — backfill candidate; field_match on `content`
  // would need the runtime-check dispatcher to walk through the action service
  // wrapper. Deferred until the wrapper-aware evaluator lands.
  scrape_url: {
    ...defineExternalRead({
      slug: 'scrape_url',
      description: 'Scrape content from a web page with automatic tier escalation and content extraction.',
      topics: ['research', 'competitive_intelligence', 'data_gathering'],
      riskTier: 2,
      liveFetchRationale: 'Web scraping — inherently live, not canonical data',
      payloadFields: ['url', 'extract', 'output_format', 'css_selectors'],
      parameterSchema: z.object({
        url: z.string().url().describe('The URL to scrape'),
        extract: z.string().optional().describe('What to extract (natural language)'),
        output_format: z.enum(['text', 'markdown', 'json']).optional().default('markdown').describe('Output format'),
        css_selectors: z.array(z.string()).optional().describe('Specific CSS selectors to extract'),
      }),
      retryPolicy: {
        maxRetries: 2,
        strategy: 'exponential_backoff',
        retryOn: ['timeout', 'network_error'],
        doNotRetryOn: ['validation_error'],
      },
    }),
    verify: null,
    verifyNullJustification:
      'External read — backfill candidate; current actionService wrapper hides the inner content field from the runtime-check dispatcher',
    reversible: true,
    blastRadius: 'external',
  },
  // Spec §4.2.3 line 487-488: external structured-data extraction → Tier 2.
  // idempotentHint:false and idempotencyStrategy:'keyed_write' because selector learning writes state.
  scrape_structured: {
    ...defineExternalRead({
      slug: 'scrape_structured',
      description: 'Extract structured data from a web page with adaptive selectors that self-heal across site redesigns.',
      topics: ['research', 'competitive_intelligence', 'data_gathering', 'monitoring'],
      riskTier: 2,
      liveFetchRationale: 'Web scraping — inherently live, not canonical data',
      payloadFields: ['url', 'fields', 'remember', 'selector_group'],
      parameterSchema: z.object({
        url: z.string().url().describe('The URL to scrape'),
        fields: z.string().describe('Fields to extract (natural language)'),
        remember: z.boolean().optional().default(true).describe('Learn selectors for future runs'),
        selector_group: z.string().optional().describe('Named selector group for persistence'),
      }),
      retryPolicy: {
        maxRetries: 2,
        strategy: 'exponential_backoff',
        retryOn: ['timeout', 'network_error'],
        doNotRetryOn: ['validation_error'],
      },
    }),
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },
  monitor_webpage: {
    ...defineExternalRead({
      slug: 'monitor_webpage',
      description: 'Set up recurring web page monitoring with change detection and automatic alerts.',
      topics: ['monitoring', 'competitive_intelligence'],
      riskTier: 3,
      liveFetchRationale: 'Web monitoring — inherently live, not canonical data',
      payloadFields: ['url', 'watch_for', 'frequency', 'fields'],
      parameterSchema: z.object({
        url: z.string().url().describe('The URL to monitor'),
        watch_for: z.string().describe('What changes to watch for'),
        frequency: z.string().describe('Check frequency (e.g., "daily", "weekly")'),
        fields: z.string().optional().describe('Specific fields to track for change detection'),
      }),
      retryPolicy: {
        maxRetries: 1,
        strategy: 'fixed',
        retryOn: ['timeout'],
        doNotRetryOn: ['validation_error', 'network_error'],
      },
    }),
    defaultGateLevel: 'review',
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },
  // Trust & Verification Layer §6.1 — meta-action that requests HITL review;
  // the request itself IS the verification path. No deterministic post-check.
  request_approval: {
    ...defineInternalStateWrite({
      slug: 'request_approval',
      description: 'Request human approval for a decision or action. Routes to the HITL review queue.',
      riskTier: 3,
      defaultGateLevel: 'review',
      payloadFields: ['title', 'description', 'context', 'options'],
      parameterSchema: z.object({
        title: z.string().describe('Short title for the approval request'),
        description: z.string().describe('What needs to be approved and why'),
        context: z.string().optional().describe('Additional context for the reviewer'),
        options: z.array(z.string()).optional().describe('List of options for the reviewer to choose from'),
      }),
      retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
      idempotencyStrategy: 'keyed_write',
    }),
    verify: null,
    verifyNullJustification:
      'Meta-action — requests HITL review; the review queue itself is the verification path',
    reversible: true,
    blastRadius: 'tenant',
  },

  // ── BA Spec submission — review-gated, writes approved spec to workspace memory ──

  write_spec: defineInternalStateWrite({
    slug: 'write_spec',
    description: 'Submit a requirements specification to the HITL review queue. On approval, writes the spec to workspace memory and marks the task spec-approved.',
    riskTier: 3,
    defaultGateLevel: 'review',
    payloadFields: ['task_id', 'spec_content', 'user_stories_count', 'ac_count', 'has_high_risk_questions', 'reasoning'],
    parameterSchema: z.object({
      task_id: z.string().describe('The board task ID this spec belongs to'),
      spec_content: z.string().describe('The full requirements spec from draft_requirements'),
      user_stories_count: z.number().describe('Number of user stories in the spec'),
      ac_count: z.number().describe('Total number of acceptance criteria'),
      open_questions_count: z.number().optional().describe('Number of open questions'),
      has_high_risk_questions: z.boolean().optional().describe('Whether the spec contains HIGH-risk open questions'),
      reasoning: z.string().describe('Scope decisions and assumptions — shown to the human reviewer'),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: ['validation_error'] },
    idempotencyStrategy: 'keyed_write',
  }),

  // ── Dev/QA read-only skills (auto-gated, audit trail only) ────────────────

  read_codebase: {
    ...defineInternalRead({
      slug: 'read_codebase',
      description: 'Read the contents of a file from the project codebase.',
      topics: ['dev'],
      readPath: 'none',
      riskTier: 0,
      payloadFields: ['file_path'],
      parameterSchema: z.object({
        file_path: z.string().describe('Path to the file to read, relative to project root'),
      }),
      retryPolicy: {
        maxRetries: 1,
        strategy: 'fixed',
        retryOn: ['timeout'],
        doNotRetryOn: ['permission_failure', 'validation_failure'],
      },
      isUniversal: true,
    }),
    actionCategory: 'devops',
  },

  search_codebase: {
    ...defineInternalRead({
      slug: 'search_codebase',
      description: 'Search the project codebase for files or content matching a query.',
      topics: ['dev'],
      readPath: 'none',
      riskTier: 0,
      payloadFields: ['query', 'search_type', 'file_pattern', 'max_results'],
      parameterSchema: z.object({
        query: z.string().describe('Search query — text to find in the codebase'),
        search_type: z.enum(['content', 'filename']).optional().describe('Search by file content or filename (default: content)'),
        file_pattern: z.string().optional().describe('Glob pattern to filter files (e.g. "**/*.ts")'),
        max_results: z.number().optional().describe('Maximum results to return (default: 20)'),
      }),
      retryPolicy: {
        maxRetries: 1,
        strategy: 'fixed',
        retryOn: ['timeout'],
        doNotRetryOn: ['permission_failure', 'validation_failure'],
      },
      isUniversal: true,
    }),
    actionCategory: 'devops',
  },

  run_tests: {
    ...defineInternalRead({
      slug: 'run_tests',
      description: 'Run the project test suite, optionally filtered to specific tests.',
      topics: ['dev'],
      readPath: 'none',
      riskTier: 1,
      payloadFields: ['test_filter'],
      parameterSchema: z.object({
        test_filter: z.string().optional().describe('Filter to run specific tests (e.g. test name pattern or file path)'),
      }),
      retryPolicy: {
        maxRetries: 0,
        strategy: 'none',
        retryOn: [],
        doNotRetryOn: ['permission_failure', 'execution_failure'],
      },
    }),
    actionCategory: 'devops',
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  },

  // Spec §4.2.3 line 487: external API read → Tier 2.
  analyze_endpoint: defineExternalRead({
    slug: 'analyze_endpoint',
    description: 'Make an HTTP request to an API endpoint and analyze the response.',
    riskTier: 2,
    liveFetchRationale: 'Generic HTTP endpoint analysis — inherently live',
    payloadFields: ['url', 'method', 'headers', 'body', 'expected_status'],
    parameterSchema: z.object({
      url: z.string().describe('The endpoint URL to test'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().describe('HTTP method (default: GET)'),
      headers: z.record(z.string(), z.unknown()).optional().describe('HTTP headers as key-value pairs'),
      body: z.string().optional().describe('Request body (for POST/PUT/PATCH)'),
      expected_status: z.number().optional().describe('Expected HTTP status code for validation'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_failure'],
    },
  }),

  report_bug: defineInternalStateWrite({
    slug: 'report_bug',
    description: 'File a bug report with severity, reproduction steps, and expected vs actual behavior.',
    topics: ['dev'],
    riskTier: 1,
    createsBoardTask: true,
    payloadFields: ['title', 'description', 'severity', 'confidence', 'steps_to_reproduce', 'expected_behavior', 'actual_behavior'],
    parameterSchema: z.object({
      title: z.string().describe('Short, descriptive bug title'),
      description: z.string().describe('Detailed description of the bug'),
      severity: z.enum(['low', 'medium', 'high', 'critical']).describe('Bug severity'),
      confidence: z.enum(['low', 'medium', 'high']).optional().describe('Confidence that this is a real bug'),
      steps_to_reproduce: z.string().optional().describe('Step-by-step reproduction instructions'),
      expected_behavior: z.string().optional().describe('What should happen'),
      actual_behavior: z.string().optional().describe('What actually happens'),
    }),
    retryPolicy: { maxRetries: 2, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    idempotencyStrategy: 'keyed_write',
  }),

  // ── Dev/QA devops actions ──────────────────────────────────────────────────

  write_patch: {
    actionType: 'write_patch',
    description: 'Propose a code change as a unified diff. Review-gated — requires human approval before execution.',
    actionCategory: 'devops',
    topics: ['dev'],
    requiresCritiqueGate: true,
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'review',
    riskTier: 3,
    createsBoardTask: false,
    payloadFields: ['file', 'diff', 'reasoning', 'base_commit', 'intent'],
    parameterSchema: z.object({
      file: z.string().describe('Path to the file to modify, relative to projectRoot'),
      diff: z.string().describe('Unified diff (--- / +++ / @@ format). Must be minimal and targeted.'),
      base_commit: z.string().describe('The git commit hash this diff is based on'),
      intent: z.enum(['feature', 'bugfix', 'refactor', 'test', 'config']).optional().describe('Type of change'),
      reasoning: z.string().describe('Why this change is needed. The reviewer sees this field and the diff.'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['base_commit_mismatch', 'patch_size_exceeded', 'permission_failure'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'locked',
  },

  run_command: {
    actionType: 'run_command',
    description: 'Execute a shell command in the project environment. Review-gated for safety.',
    actionCategory: 'devops',
    topics: ['dev'],
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'review',
    riskTier: 4,
    createsBoardTask: false,
    payloadFields: ['command'],
    parameterSchema: z.object({
      command: z.string().describe('The shell command to execute'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['execution_failure', 'timeout'],
      doNotRetryOn: ['permission_failure', 'validation_failure'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'locked',
  },

  create_pr: {
    ...defineExternalWrite({
      slug: 'create_pr',
      description: 'Create a pull request on GitHub from the current working branch.',
      topics: ['dev'],
      riskTier: 3,
      payloadFields: ['title', 'description', 'branch'],
      parameterSchema: z.object({
        title: z.string().describe('Pull request title'),
        description: z.string().optional().describe('Pull request body/description (markdown)'),
        branch: z.string().describe('Source branch name'),
      }),
      retryPolicy: {
        maxRetries: 2,
        strategy: 'exponential_backoff',
        retryOn: ['execution_failure', 'timeout', 'network_error'],
        doNotRetryOn: ['validation_failure', 'environment_failure'],
      },
      requiresCritiqueGate: true,
      idempotencyStrategy: 'locked',
    }),
    actionCategory: 'devops',
  },

  // ── Workflow orchestration (Phase 2) ────────────────────────────────────────

  assign_task: defineInternalStateWrite({
    slug: 'assign_task',
    description: 'Assign a task to a worker agent for autonomous execution.',
    riskTier: 2,
    payloadFields: ['worker_agent_slug', 'task_description', 'context'],
    parameterSchema: z.object({
      worker_agent_slug: z.string().describe('Slug of the worker agent to assign the task to'),
      task_description: z.string().describe('Description of the task for the worker agent'),
      context: z.string().optional().describe('Additional context or instructions for the worker'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['execution_failure'],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  }),

  // ── Page management actions ─────────────────────────────────────────────────

  // Trust & Verification Layer §6.1 — review-gated page create: HITL approval is the
  // verification boundary; actionService wrapper has no comparable post-check shape.
  create_page: {
    ...defineInternalStateWrite({
      slug: 'create_page',
      description: 'Create a new page in a page project. The page is created in draft status. HTML is sanitised before storage. Returns a preview URL for HITL review.',
      riskTier: 3,
      defaultGateLevel: 'review',
      createsBoardTask: true,
      payloadFields: ['projectId', 'slug', 'pageType', 'title', 'html', 'meta', 'formConfig'],
      parameterSchema: z.object({
        projectId: z.string().describe('ID of the page project to create the page in'),
        slug: z.string().describe('URL slug for the page (must be unique within the project)'),
        pageType: z.enum(['website', 'landing']).describe('Type of page — website or landing page'),
        title: z.string().optional().describe('Page title'),
        html: z.string().describe('HTML content for the page (max 1 MB). Will be sanitised before storage.'),
        meta: z.record(z.string(), z.unknown()).optional().describe('SEO and social meta fields'),
        formConfig: z.record(z.string(), z.unknown()).optional().describe('Optional form configuration for the page'),
      }),
      retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
      idempotencyStrategy: 'keyed_write',
    }),
    verify: null,
    verifyNullJustification:
      'Review-gated page create: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    reversible: true,
    blastRadius: 'tenant',
  },

  // Trust & Verification Layer §6.1 — review-gated page update: HITL approval is the
  // verification boundary; actionService wrapper has no comparable post-check shape.
  update_page: {
    ...defineInternalStateWrite({
      slug: 'update_page',
      description: 'Update an existing page HTML, meta, or formConfig. Saves a version snapshot before updating. Returns a preview URL.',
      riskTier: 3,
      defaultGateLevel: 'review',
      createsBoardTask: true,
      payloadFields: ['pageId', 'projectId', 'html', 'meta', 'formConfig', 'changeNote'],
      parameterSchema: z.object({
        pageId: z.string().describe('ID of the page to update'),
        projectId: z.string().describe('ID of the project the page belongs to'),
        html: z.string().optional().describe('Updated HTML content (max 1 MB). Will be sanitised before storage.'),
        meta: z.record(z.string(), z.unknown()).optional().describe('Updated SEO and social meta fields'),
        formConfig: z.record(z.string(), z.unknown()).optional().describe('Updated form configuration'),
        changeNote: z.string().optional().describe('Brief note describing the change (stored with the version snapshot)'),
      }),
      retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
      mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      idempotencyStrategy: 'keyed_write',
    }),
    verify: null,
    verifyNullJustification:
      'Review-gated page update: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    reversible: true,
    blastRadius: 'tenant',
  },

  publish_page: defineInternalStateWrite({
    slug: 'publish_page',
    description: 'Publish a page — flips status from draft to published, sets publishedAt, and invalidates cache. Default gate is review so a human can preview before going live.',
    riskTier: 3,
    defaultGateLevel: 'review',
    createsBoardTask: true,
    payloadFields: ['pageId', 'projectId'],
    parameterSchema: z.object({
      pageId: z.string().describe('ID of the page to publish'),
      projectId: z.string().describe('ID of the project the page belongs to'),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  }),

  // ── Cross-owner delegation — PA-V2-operator spec §7.4 ──────────────────────
  // System-generated action created by crossOwnerApprovalTimeoutSweep when a
  // cross-owner sub-step times out and the timeout_policy is 'ask_initiator'.
  // The initiator sees this in listPendingApprovalsForUser and must approve or
  // reject the delegation continuation. Not an LLM-callable tool.
  'cross_owner.ask_initiator_decision': {
    actionType: 'cross_owner.ask_initiator_decision',
    description: 'A cross-owner delegation sub-step has timed out. The run initiator must decide whether to continue, approve retrospectively, or abandon the sub-step.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'review',
    riskTier: 2,
    createsBoardTask: false,
    readPath: 'none',
    payloadFields: ['substepId', 'parentRunId'],
    parameterSchema: z.object({
      substepId: z.string().describe('delegation_outcomes row ID for this sub-step'),
      parentRunId: z.string().describe('Parent agent run ID that owns this delegation'),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    idempotencyStrategy: 'keyed_write',
    sideEffectClass: 'write',
    verify: null,
    verifyNullJustification: 'System-generated delegation decision request — outcome is a human decision, not a deterministic side effect; no post-action check is possible.',
    reversible: true,
    blastRadius: 'tenant',
  },
};
