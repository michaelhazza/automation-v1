import { z } from 'zod';
// ---------------------------------------------------------------------------
// Action Type Registry — central definition of all action types
// Phase 1: TypeScript config object. Phase 2: promotes to DB table.
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  maxRetries: number;
  strategy: 'exponential_backoff' | 'fixed' | 'none';
  retryOn: string[];
  doNotRetryOn: string[];
}

/** MCP ToolAnnotations — maps to the MCP specification's ToolAnnotations type */
export interface McpAnnotations {
  readOnlyHint: boolean;    // true = does not modify external state
  destructiveHint: boolean; // true = may be irreversible
  idempotentHint: boolean;  // true = same args = same effect
  openWorldHint: boolean;   // true = reaches external systems
}

/** JSON Schema describing the tool's input parameters */
export interface ParameterSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    properties?: Record<string, unknown>;
    items?: Record<string, unknown>;
  }>;
  required: string[];
  additionalProperties?: boolean;
}

/**
 * Execution-model contract for an action handler — declares how the handler
 * stays safe under retry given the at-least-once execution guarantee. See
 * docs/improvements-roadmap-spec.md → "Execution model — at-least-once,
 * idempotent handlers" for the full rationale.
 *
 *   - 'read_only'   — no side effects; safe to re-run without any coordination.
 *   - 'keyed_write' — writes are deduplicated by the caller-supplied
 *                     idempotencyKey at the DB or external provider layer
 *                     (INSERT ... ON CONFLICT DO NOTHING, Idempotency-Key
 *                     header, etc.).
 *   - 'locked'      — handler takes a pg advisory lock keyed on the
 *                     idempotencyKey before the call and releases on exit.
 *                     Used for irreversible side effects to third parties
 *                     that have no native dedupe story.
 */
export type IdempotencyStrategy = 'read_only' | 'keyed_write' | 'locked';

export interface ActionDefinition {
  actionType: string;
  description: string;
  actionCategory: 'api' | 'worker' | 'browser' | 'devops' | 'mcp';
  isExternal: boolean;
  defaultGateLevel: 'auto' | 'review' | 'block';
  createsBoardTask: boolean;
  /** @deprecated Use parameterSchema instead. Kept for backward compat. */
  payloadFields: string[];
  parameterSchema: z.ZodObject<z.ZodRawShape>;
  retryPolicy: RetryPolicy;
  mcp?: { annotations: McpAnnotations };

  /**
   * P0.2 Slice B — required on every entry from Sprint 1 landing onward.
   * Enforced by verify-idempotency-strategy-declared.sh.
   */
  idempotencyStrategy: IdempotencyStrategy;

  /**
   * P1.1 Layer 3 — declarative scope metadata consumed by the before-tool
   * authorisation hook. See P1.1 Layer 3 validateScope() for the check
   * implementation. Optional — only actions that operate on tenant-scoped
   * resources need to declare scope requirements.
   */
  scopeRequirements?: {
    /** Names of arg fields that must be subaccount IDs the current tenant owns. */
    validateSubaccountFields?: string[];
    /** Names of arg fields that must be GHL location IDs the current tenant owns. */
    validateGhlLocationFields?: string[];
    /** If true, run requires `userId` in execution context (no system runs). */
    requiresUserContext?: boolean;
  };

  /** P4.1 — topic tags for intent-based filtering. */
  topics?: string[];

  /** P4.4 — opt-in to the semantic critique gate when run via economy tier. */
  requiresCritiqueGate?: boolean;

  /**
   * P0.2 Slice C — extended retry behaviour. Overrides retryPolicy's
   * default fail-the-run semantics:
   *   - 'retry'    — use withBackoff per retryPolicy (default, matches
   *                  existing behaviour).
   *   - 'skip'     — log the failure, return
   *                  { success: false, skipped: true, reason } to the LLM,
   *                  and let the agent loop continue.
   *   - 'fail_run' — terminate the entire agent run via failure() from
   *                  shared/iee/failure.ts.
   *   - 'fallback' — return fallbackValue as the result instead of failing.
   */
  onFailure?: 'retry' | 'skip' | 'fail_run' | 'fallback';
  fallbackValue?: unknown;

  /**
   * P1.1 Layer 3 — flag to mark methodology skills (pure prompt scaffolds,
   * no side effects). When true, the preTool middleware bypasses
   * actionService.proposeAction and writes a single audit row with
   * reason='methodology_skill'. Distinct from read-only skills because
   * methodology skills do not even read from external systems.
   */
  isMethodology?: boolean;

  /**
   * P4.1 — universal skills are always merged into every agent's effective
   * allowlist and always preserved through the topic filter. See the
   * universal-skill contract in docs/improvements-roadmap-spec.md P4.1.
   */
  isUniversal?: boolean;
}

export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  send_email: {
    actionType: 'send_email',
    description: 'Send an email via a connected email provider. Requires human approval before sending.',
    actionCategory: 'api',
    topics: ['email'],
    requiresCritiqueGate: true,
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: true,
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
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
  },
  read_inbox: {
    actionType: 'read_inbox',
    description: 'Read recent emails from a connected email provider inbox.',
    actionCategory: 'api',
    isExternal: true,
    topics: ['email'],
    defaultGateLevel: 'auto',
    createsBoardTask: false,
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
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'read_only',
  },
  create_task: {
    actionType: 'create_task',
    description: 'Create a new task on the board with title, description, and optional agent assignment.',
    actionCategory: 'worker',
    topics: ['task'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['title', 'description', 'brief', 'status', 'priority', 'assigned_agent_id'],
    parameterSchema: z.object({
      title: z.string().describe('Short title for the work item'),
      description: z.string().optional().describe('Human-readable description visible in the task card'),
      brief: z.string().optional().describe('Self-contained instructions for the agent picking up this task'),
      status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done']).optional().describe('Initial status (default: todo)'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('Task priority (default: normal)'),
      assigned_agent_id: z.string().optional().describe('Agent ID to assign the task to'),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },
  triage_intake: {
    actionType: 'triage_intake',
    description:
      "Capture and route incoming ideas, feature requests, or bugs into the task board. " +
      "Two modes: 'capture' creates a single structured task in the 'inbox' (untriaged) column " +
      "from raw text — fast, judgement-free intake used by the Orchestrator and Business Analyst " +
      "when items arrive outside normal channels. 'triage' scans the existing inbox for items " +
      "lacking a triage decision and returns a structured proposal list (duplicate check, " +
      "rough relevance, suggested disposition) for human or Orchestrator review.",
    actionCategory: 'worker',
    topics: ['task'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
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
    mcp: {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    idempotencyStrategy: 'keyed_write',
  },
  move_task: {
    actionType: 'move_task',
    description: 'Move a task to a different status column on the board.',
    actionCategory: 'worker',
    topics: ['task'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['task_id', 'status'],
    parameterSchema: z.object({
      task_id: z.string().describe('The ID of the task to move'),
      status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done']).describe('Target status column'),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },
  read_data_source: {
    actionType: 'read_data_source',
    description:
      'Query the run-scoped cascading context data sources. Two ops: `list` ' +
      'returns the manifest of all active sources visible to this run; `read` ' +
      'returns a slice of a specific source by id with offset/limit pagination. ' +
      'Enforces per-run call count and per-call token limits. Suppressed ' +
      'sources are invisible per spec §3.6.',
    actionCategory: 'worker',
    topics: ['workspace'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
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
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    mcp: {
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    idempotencyStrategy: 'read_only',
  },
  reassign_task: {
    actionType: 'reassign_task',
    description: 'Reassign a task to a different agent.',
    actionCategory: 'worker',
    topics: ['task'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['task_id', 'assigned_agent_id'],
    parameterSchema: z.object({
      task_id: z.string().describe('The ID of the task to reassign'),
      assigned_agent_id: z.string().describe('The agent ID to assign the task to'),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },
  add_deliverable: {
    actionType: 'add_deliverable',
    description: 'Attach a deliverable (document, artifact, output) to a task.',
    actionCategory: 'worker',
    topics: ['task'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['task_id', 'title', 'content', 'deliverable_type'],
    parameterSchema: z.object({
      task_id: z.string().describe('The ID of the task to attach the deliverable to'),
      title: z.string().describe('Title of the deliverable'),
      content: z.string().describe('Content of the deliverable (text, markdown, or JSON)'),
      deliverable_type: z.enum(['file', 'url', 'artifact']).optional().describe('Type of deliverable'),
    }),
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },
  update_record: {
    actionType: 'update_record',
    description: 'Update a record in an external system (CRM, database, etc.) via a connected provider.',
    actionCategory: 'api',
    topics: ['gh-integration'],
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
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
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },
  fetch_url: {
    actionType: 'fetch_url',
    description: 'Fetch content from a URL via HTTP request.',
    actionCategory: 'api',
    isExternal: true,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
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
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'read_only',
  },
  request_approval: {
    actionType: 'request_approval',
    description: 'Request human approval for a decision or action. Routes to the HITL review queue.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['title', 'description', 'context', 'options'],
    parameterSchema: z.object({
      title: z.string().describe('Short title for the approval request'),
      description: z.string().describe('What needs to be approved and why'),
      context: z.string().optional().describe('Additional context for the reviewer'),
      options: z.array(z.string()).optional().describe('List of options for the reviewer to choose from'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  // ── BA Spec submission — review-gated, writes approved spec to workspace memory ──

  write_spec: {
    actionType: 'write_spec',
    description: 'Submit a requirements specification to the HITL review queue. On approval, writes the spec to workspace memory and marks the task spec-approved.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
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
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  // ── Dev/QA read-only skills (auto-gated, audit trail only) ────────────────

  read_codebase: {
    actionType: 'read_codebase',
    description: 'Read the contents of a file from the project codebase.',
    actionCategory: 'devops',
    topics: ['dev'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
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
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  search_codebase: {
    actionType: 'search_codebase',
    description: 'Search the project codebase for files or content matching a query.',
    actionCategory: 'devops',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
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
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
    isUniversal: true,
    topics: ['dev'],
  },

  run_tests: {
    actionType: 'run_tests',
    description: 'Run the project test suite, optionally filtered to specific tests.',
    actionCategory: 'devops',
    topics: ['dev'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
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
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  analyze_endpoint: {
    actionType: 'analyze_endpoint',
    description: 'Make an HTTP request to an API endpoint and analyze the response.',
    actionCategory: 'api',
    isExternal: true,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
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
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'read_only',
  },

  report_bug: {
    actionType: 'report_bug',
    description: 'File a bug report with severity, reproduction steps, and expected vs actual behavior.',
    actionCategory: 'worker',
    topics: ['dev'],
    isExternal: false,
    defaultGateLevel: 'auto',
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
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  // ── Dev/QA devops actions ──────────────────────────────────────────────────

  write_patch: {
    actionType: 'write_patch',
    description: 'Propose a code change as a unified diff. Review-gated — requires human approval before execution.',
    actionCategory: 'devops',
    topics: ['dev'],
    requiresCritiqueGate: true,
    isExternal: false,
    defaultGateLevel: 'review',
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
    defaultGateLevel: 'review',
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
    actionType: 'create_pr',
    description: 'Create a pull request on GitHub from the current working branch.',
    actionCategory: 'devops',
    topics: ['dev'],
    requiresCritiqueGate: true,
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
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
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
  },

  // ── Workflow orchestration (Phase 2) ────────────────────────────────────────

  assign_task: {
    actionType: 'assign_task',
    description: 'Assign a task to a worker agent for autonomous execution.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
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
  },

  // ── Page management actions ─────────────────────────────────────────────────

  create_page: {
    actionType: 'create_page',
    description: 'Create a new page in a page project. The page is created in draft status. HTML is sanitised before storage. Returns a preview URL for HITL review.',
    actionCategory: 'worker',
    isExternal: false,
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
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  update_page: {
    actionType: 'update_page',
    description: 'Update an existing page HTML, meta, or formConfig. Saves a version snapshot before updating. Returns a preview URL.',
    actionCategory: 'worker',
    isExternal: false,
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
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  publish_page: {
    actionType: 'publish_page',
    description: 'Publish a page — flips status from draft to published, sets publishedAt, and invalidates cache. Default gate is review so a human can preview before going live.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: true,
    payloadFields: ['pageId', 'projectId'],
    parameterSchema: z.object({
      pageId: z.string().describe('ID of the page to publish'),
      projectId: z.string().describe('ID of the project the page belongs to'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  // ── Cross-Subaccount Intelligence Skills (Phase 3) ──────────────────────

  query_subaccount_cohort: {
    actionType: 'query_subaccount_cohort',
    description: 'Read aggregated board health and memory summaries across multiple subaccounts, filtered by tags.',
    actionCategory: 'worker',
    topics: ['reporting'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['tag_filters'],
    parameterSchema: z.object({
      tag_filters: z.string().optional().describe('Tag filters JSON'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  read_org_insights: {
    actionType: 'read_org_insights',
    description: 'Query cross-subaccount insights stored in org-level memory.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: [],
    parameterSchema: z.object({
      semantic_query: z.string().optional().describe('Semantic search query'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  write_org_insight: {
    actionType: 'write_org_insight',
    description: 'Store a cross-subaccount pattern or insight in org-level memory.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['content', 'entry_type'],
    parameterSchema: z.object({
      content: z.string().describe('Insight content'),
      entry_type: z.string().describe('Insight type'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  compute_health_score: {
    actionType: 'compute_health_score',
    description: 'Calculate a composite health score (0-100) for a subaccount based on normalised metrics.',
    actionCategory: 'worker',
    topics: ['reporting'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['account_id'],
    parameterSchema: z.object({
      account_id: z.string().describe('Canonical account ID'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  detect_anomaly: {
    actionType: 'detect_anomaly',
    description: 'Compare current metrics against historical baseline and flag significant deviations.',
    actionCategory: 'worker',
    topics: ['reporting'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['account_id', 'metric_name', 'current_value'],
    parameterSchema: z.object({
      account_id: z.string().describe('Canonical account ID'),
      metric_name: z.string().describe('Metric name'),
      current_value: z.string().describe('Current metric value'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  compute_churn_risk: {
    actionType: 'compute_churn_risk',
    description: 'Evaluate churn risk signals for a subaccount and produce a risk score with intervention recommendation.',
    actionCategory: 'worker',
    topics: ['reporting'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['account_id'],
    parameterSchema: z.object({
      account_id: z.string().describe('Canonical account ID'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  generate_portfolio_report: {
    actionType: 'generate_portfolio_report',
    description: 'Generate a structured portfolio intelligence briefing across the entire organisation.',
    actionCategory: 'worker',
    topics: ['reporting'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: [],
    parameterSchema: z.object({
      reporting_period_days: z.string().optional().describe('Days to cover'),
      format: z.string().optional().describe('Output format'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  trigger_account_intervention: {
    actionType: 'trigger_account_intervention',
    description: 'Propose an intervention for a subaccount — always HITL-gated, requires human approval.',
    actionCategory: 'worker',
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['account_id', 'intervention_type', 'evidence_summary'],
    parameterSchema: z.object({
      account_id: z.string().describe('Canonical account ID'),
      intervention_type: z.string().describe('Intervention type'),
      evidence_summary: z.string().describe('Evidence justification'),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
    topics: ['gh-integration'],
    requiresCritiqueGate: true,
  },

  // ── Sprint 5 P4.1: Universal skills ─────────────────────────────────────
  // These are always available to every agent regardless of allowlist.

  ask_clarifying_question: {
    actionType: 'ask_clarifying_question',
    description: 'Ask the user a clarifying question when the agent is unsure how to proceed. Pauses the run until the user responds.',
    actionCategory: 'api',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['question'],
    parameterSchema: z.object({
      question: z.string().min(10).max(2000).describe('The clarifying question to ask the user'),
      blocked_by: z.enum(['topic_filter', 'scope_check', 'no_relevant_tool', 'low_confidence']).optional()
        .describe('Why clarification is needed'),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
    isUniversal: true,
    isMethodology: false,
    topics: [],
  },

  read_workspace: {
    actionType: 'read_workspace',
    description: 'Read workspace memories for a subaccount. Universal context access.',
    actionCategory: 'api',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['key'],
    parameterSchema: z.object({
      key: z.string().optional().describe('Memory key to read'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
    isUniversal: true,
    topics: ['workspace'],
  },

  // Sprint 5 P4.2: Shared memory block write
  update_memory_block: {
    actionType: 'update_memory_block',
    description: 'Update a shared memory block. Requires write permission and block ownership.',
    actionCategory: 'worker',
    topics: ['workspace'],
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['block_name', 'new_content'],
    parameterSchema: z.object({
      block_name: z.string().describe('Name of the memory block to update'),
      new_content: z.string().max(50000).describe('New content for the block'),
    }),
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  web_search: {
    actionType: 'web_search',
    description: 'Search the web for information. Universal read-only retrieval.',
    actionCategory: 'api',
    isExternal: true,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['query'],
    parameterSchema: z.object({
      query: z.string().describe('Search query'),
    }),
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['transient_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'read_only',
    isUniversal: true,
    topics: [],
  },

  // ── Support Agent — auto-gated stubs ────────────────────────────────────────

  search_knowledge_base: {
    actionType: 'search_knowledge_base',
    description: 'Search the workspace knowledge base for articles and FAQs relevant to a query. Returns ranked results with excerpts.',
    actionCategory: 'api',
    topics: ['support'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['query', 'intent_category', 'max_results'],
    parameterSchema: z.object({
      query: z.string().describe('The search query in natural language'),
      intent_category: z.string().optional().describe('Email intent category from classify_email to narrow search scope'),
      max_results: z.number().optional().describe('Maximum results to return (default 5, max 10)'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  // ── Social Media Agent — review-gated publish + auto-gated analytics ────────

  publish_post: {
    actionType: 'publish_post',
    description: 'Submit an approved social media post for publishing or scheduling. Review-gated — requires human approval before the post goes live.',
    actionCategory: 'api',
    topics: ['social'],
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['platform', 'post_content', 'schedule_at', 'campaign_tag', 'reasoning'],
    parameterSchema: z.object({
      platform: z.enum(['twitter', 'linkedin', 'instagram', 'facebook']).describe('Target publishing platform'),
      post_content: z.string().describe('The final approved post copy'),
      schedule_at: z.string().optional().describe('ISO 8601 datetime to schedule the post. If omitted, publishes immediately upon approval.'),
      media_urls: z.array(z.string()).optional().describe('Optional media attachment URLs'),
      hashtags_in_comment: z.boolean().optional().describe('Instagram: post hashtags in first comment'),
      campaign_tag: z.string().optional().describe('Campaign identifier for analytics grouping'),
      reasoning: z.string().describe('Timing rationale and campaign context — shown to the human reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error', 'platform_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
  },

  read_analytics: {
    actionType: 'read_analytics',
    description: 'Retrieve social media performance metrics for one or more platforms and a specified time period.',
    actionCategory: 'api',
    topics: ['social'],
    isExternal: true,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['platforms', 'date_from', 'date_to', 'metrics', 'campaign_tag'],
    parameterSchema: z.object({
      platforms: z.array(z.enum(['twitter', 'linkedin', 'instagram', 'facebook'])).describe('Platforms to retrieve analytics for'),
      date_from: z.string().describe('Start date in ISO 8601 format (YYYY-MM-DD)'),
      date_to: z.string().optional().describe('End date in ISO 8601 format. Defaults to today.'),
      metrics: z.array(z.enum(['impressions', 'reach', 'engagement_rate', 'clicks', 'follower_growth', 'top_posts', 'post_count'])).optional().describe('Specific metrics to retrieve. Omit for all.'),
      campaign_tag: z.string().optional().describe('Filter results to posts with this campaign tag'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'platform_not_configured'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'read_only',
  },

  // ── Ads Management Agent — auto-gated stubs + block-gated + review-gated ──

  read_campaigns: {
    actionType: 'read_campaigns',
    description: 'Retrieve current campaign data from the connected ads platform — campaign names, status, budget, spend, and performance summary.',
    actionCategory: 'api',
    topics: ['ads'],
    isExternal: true,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['platform', 'campaign_ids', 'include_ad_groups', 'date_from', 'date_to'],
    parameterSchema: z.object({
      platform: z.enum(['google_ads', 'meta_ads', 'linkedin_ads']).describe('The ads platform to read campaigns from'),
      campaign_ids: z.array(z.string()).optional().describe('Specific campaign IDs to retrieve. If omitted, returns all active campaigns.'),
      include_ad_groups: z.boolean().optional().describe('Include ad group breakdown. Default false.'),
      date_from: z.string().optional().describe('Start date for metrics (ISO 8601 YYYY-MM-DD)'),
      date_to: z.string().optional().describe('End date for metrics (ISO 8601 YYYY-MM-DD)'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'platform_not_configured'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'read_only',
  },

  update_bid: {
    actionType: 'update_bid',
    description: 'Propose a bid adjustment for a campaign or ad group. Review-gated — requires human approval before the change is applied.',
    actionCategory: 'api',
    topics: ['ads'],
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['platform', 'campaign_id', 'campaign_name', 'current_bid', 'proposed_bid', 'change_direction', 'change_percentage', 'reasoning'],
    parameterSchema: z.object({
      platform: z.enum(['google_ads', 'meta_ads', 'linkedin_ads']).describe('The ads platform'),
      campaign_id: z.string().describe('Campaign ID to adjust the bid for'),
      campaign_name: z.string().describe('Human-readable campaign name'),
      ad_group_id: z.string().optional().describe('Ad group ID if adjusting at ad group level'),
      current_bid: z.string().describe('Current bid or target CPA/ROAS value'),
      proposed_bid: z.string().describe('Proposed new bid or target value'),
      change_direction: z.enum(['increase', 'decrease']).describe('Whether this is an increase or decrease'),
      change_percentage: z.number().describe('Percentage change'),
      reasoning: z.string().describe('Data-driven rationale from analyse_performance'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error', 'platform_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },

  update_copy: {
    actionType: 'update_copy',
    description: 'Upload approved ad copy to the connected ads platform. Review-gated — requires human approval before the copy change goes live.',
    actionCategory: 'api',
    topics: ['ads'],
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['platform', 'campaign_id', 'campaign_name', 'ad_format', 'copy_content', 'reasoning'],
    parameterSchema: z.object({
      platform: z.enum(['google_ads', 'meta_ads', 'linkedin_ads']).describe('The ads platform'),
      campaign_id: z.string().describe('Campaign ID to update copy for'),
      campaign_name: z.string().describe('Human-readable campaign name'),
      ad_group_id: z.string().optional().describe('Ad group ID if updating at ad group level'),
      ad_format: z.enum(['responsive_search_ad', 'display_ad', 'social_feed_ad', 'sponsored_content']).describe('The ad format being updated'),
      copy_content: z.record(z.unknown()).describe('Approved copy fields to upload'),
      replace_existing: z.boolean().optional().describe('If true, replaces all existing copy. Default false.'),
      reasoning: z.string().describe('Test hypothesis or performance issue being addressed'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error', 'platform_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },

  pause_campaign: {
    actionType: 'pause_campaign',
    description: 'Propose pausing a campaign on the connected ads platform. Review-gated — requires human approval before execution.',
    actionCategory: 'api',
    topics: ['ads'],
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['platform', 'campaign_id', 'campaign_name', 'pause_reason', 'performance_evidence', 'reasoning'],
    parameterSchema: z.object({
      platform: z.enum(['google_ads', 'meta_ads', 'linkedin_ads']).describe('The ads platform'),
      campaign_id: z.string().describe('Campaign ID to pause'),
      campaign_name: z.string().describe('Human-readable campaign name'),
      pause_reason: z.enum(['underperformance', 'budget_exhausted', 'campaign_ended', 'manual_override']).describe('The reason for pausing'),
      performance_evidence: z.string().describe('Data from analyse_performance justifying the pause'),
      reasoning: z.string().describe('Full reasoning for the pause recommendation'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
  },

  increase_budget: {
    actionType: 'increase_budget',
    description: 'Propose a budget increase for a high-performing campaign. Review-gated — requires human approval before execution.',
    actionCategory: 'api',
    topics: ['ads'],
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['platform', 'campaign_id', 'campaign_name', 'current_daily_budget', 'proposed_daily_budget', 'change_percentage', 'performance_evidence', 'reasoning'],
    parameterSchema: z.object({
      platform: z.enum(['google_ads', 'meta_ads', 'linkedin_ads']).describe('The ads platform'),
      campaign_id: z.string().describe('Campaign ID to increase budget for'),
      campaign_name: z.string().describe('Human-readable campaign name'),
      current_daily_budget: z.string().describe('Current daily budget'),
      proposed_daily_budget: z.string().describe('Proposed new daily budget'),
      change_percentage: z.number().describe('Percentage increase'),
      performance_evidence: z.string().describe('Data justifying the increase'),
      reasoning: z.string().describe('Full reasoning for the budget increase recommendation'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
  },

  // ── Email Outreach Agent — auto-gated stub + review-gated ───────────────

  enrich_contact: {
    actionType: 'enrich_contact',
    description: 'Retrieve enrichment data for a contact from the connected data enrichment provider and write it to the CRM.',
    actionCategory: 'api',
    topics: ['outreach'],
    isExternal: true,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['contact_email', 'contact_name', 'company_name', 'crm_contact_id', 'fields_requested'],
    parameterSchema: z.object({
      contact_email: z.string().describe('Contact email address to enrich'),
      contact_name: z.string().optional().describe('Contact full name'),
      company_name: z.string().optional().describe('Company name'),
      crm_contact_id: z.string().optional().describe('CRM contact ID to write enriched data back to'),
      fields_requested: z.array(z.enum(['job_title', 'seniority', 'company', 'industry', 'company_size', 'linkedin_url', 'phone', 'location'])).optional().describe('Specific fields to enrich'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'contact_not_found'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    idempotencyStrategy: 'keyed_write',
  },

  update_crm: {
    actionType: 'update_crm',
    description: 'Write contact or deal updates to the connected CRM. Review-gated — requires human approval before any data is written.',
    actionCategory: 'api',
    topics: ['outreach', 'crm'],
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['record_type', 'record_id', 'record_identifier', 'updates', 'update_reason', 'reasoning'],
    parameterSchema: z.object({
      record_type: z.enum(['contact', 'deal', 'company']).describe('The type of CRM record to update'),
      record_id: z.string().describe('The CRM record ID to update'),
      record_identifier: z.string().describe('Human-readable identifier (email, deal name, company name)'),
      updates: z.record(z.unknown()).describe('Key-value pairs of CRM fields to update'),
      update_reason: z.string().describe('Why these fields are being updated'),
      reasoning: z.string().describe('Full reasoning — shown to the human reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  // ── Finance Agent — auto-gated stubs + review-gated ─────────────────────

  read_revenue: {
    actionType: 'read_revenue',
    description: 'Retrieve revenue data from the connected accounting or billing system for a specified period.',
    actionCategory: 'api',
    topics: ['finance'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['date_from', 'date_to', 'breakdown_by', 'include_comparison', 'currency'],
    parameterSchema: z.object({
      date_from: z.string().describe('Start date in ISO 8601 format (YYYY-MM-DD)'),
      date_to: z.string().optional().describe('End date in ISO 8601 format. Defaults to today.'),
      breakdown_by: z.enum(['product', 'customer', 'channel', 'geography', 'none']).optional().describe('Revenue breakdown dimension'),
      include_comparison: z.boolean().optional().describe('Include period-over-period comparison'),
      currency: z.string().optional().describe('ISO 4217 currency code'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  read_expenses: {
    actionType: 'read_expenses',
    description: 'Retrieve expense data from the connected accounting system for a specified period.',
    actionCategory: 'api',
    topics: ['finance'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['date_from', 'date_to', 'categories', 'include_comparison', 'currency'],
    parameterSchema: z.object({
      date_from: z.string().describe('Start date in ISO 8601 format (YYYY-MM-DD)'),
      date_to: z.string().optional().describe('End date in ISO 8601 format. Defaults to today.'),
      categories: z.array(z.string()).optional().describe('Expense categories to filter by'),
      include_comparison: z.boolean().optional().describe('Include period-over-period comparison'),
      currency: z.string().optional().describe('ISO 4217 currency code'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  update_financial_record: {
    actionType: 'update_financial_record',
    description: 'Write a financial record update to the connected accounting system. Review-gated — requires human approval before execution.',
    actionCategory: 'api',
    topics: ['finance'],
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['record_type', 'record_description', 'updates', 'period', 'reasoning'],
    parameterSchema: z.object({
      record_type: z.enum(['budget_entry', 'forecast_adjustment', 'expense_note', 'revenue_note']).describe('Type of financial record to update'),
      record_id: z.string().optional().describe('ID of the record to update in the accounting system'),
      record_description: z.string().describe('Human-readable description of what is being updated'),
      updates: z.record(z.unknown()).describe('Fields to write: amounts, notes, dates, category assignments'),
      period: z.string().optional().describe('The financial period this update applies to'),
      reasoning: z.string().describe('Why this record is being updated — shown to the reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  // ── Content/SEO + Client Reporting — review-gated ────────────────────────

  create_lead_magnet: {
    actionType: 'create_lead_magnet',
    description: 'Produce a complete lead magnet asset (checklist, template, mini-guide, scorecard). Review-gated — requires human approval before use in campaigns.',
    actionCategory: 'worker',
    topics: ['content'],
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['asset_type', 'topic', 'target_audience', 'value_promise', 'reasoning'],
    parameterSchema: z.object({
      asset_type: z.enum(['checklist', 'template', 'mini_guide', 'scorecard', 'swipe_file']).describe('The type of lead magnet to produce'),
      topic: z.string().describe('The topic or problem the lead magnet addresses'),
      target_audience: z.string().describe('Who this lead magnet is for'),
      value_promise: z.string().describe('The specific outcome the reader gets'),
      brand_voice: z.string().optional().describe('Brand voice guidelines'),
      campaign_context: z.string().optional().describe('The campaign this lead magnet supports'),
      workspace_context: z.string().optional().describe('Workspace context'),
      reasoning: z.string().describe('Why this asset is being created — shown to the reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  deliver_report: {
    actionType: 'deliver_report',
    description: 'Deliver an approved client report via the configured delivery channel. Review-gated — requires human approval before the report is sent to the client.',
    actionCategory: 'api',
    topics: ['reporting'],
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['report_title', 'client_name', 'client_email', 'report_content', 'delivery_channel', 'reasoning'],
    parameterSchema: z.object({
      report_title: z.string().describe('Title of the report being delivered'),
      client_name: z.string().describe('Client name'),
      client_email: z.string().describe('Client email address'),
      report_content: z.string().describe('The full approved report content'),
      delivery_channel: z.enum(['email', 'shared_link', 'portal']).describe('How to deliver the report'),
      cover_message: z.string().optional().describe('Optional cover email message'),
      reporting_period: z.string().optional().describe('The reporting period for the email subject'),
      reasoning: z.string().describe('Context for the reviewer — NOT sent to the client'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
  },

  // ── Onboarding Agent — review-gated ─────────────────────────────────────

  configure_integration: {
    actionType: 'configure_integration',
    description: 'Guide configuration of a workspace integration and submit for human approval. Review-gated — never stores credentials without approval.',
    actionCategory: 'worker',
    topics: ['onboarding'],
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['integration_type', 'provider_name', 'configuration', 'reasoning'],
    parameterSchema: z.object({
      integration_type: z.enum(['crm', 'email_provider', 'google_ads', 'meta_ads', 'linkedin_ads', 'accounting', 'knowledge_base', 'social_media']).describe('The type of integration to configure'),
      provider_name: z.string().describe('The specific provider name'),
      configuration: z.record(z.unknown()).describe('Integration settings — sensitive fields masked in review'),
      validation_checks: z.array(z.string()).optional().describe('Pre-submission validation checks to run'),
      reasoning: z.string().describe('Why this integration is being configured — shown to the reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  // ── CRM/Pipeline Agent — auto-gated stub ─────────────────────────────────

  read_crm: {
    actionType: 'read_crm',
    description: 'Retrieve contact, deal, or pipeline data from the connected CRM for analysis.',
    actionCategory: 'api',
    topics: ['crm'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['query_type', 'filters', 'limit', 'include_activity_history'],
    parameterSchema: z.object({
      query_type: z.enum(['contacts', 'deals', 'pipeline_summary', 'churned_accounts', 'stale_deals']).describe('The type of CRM data to retrieve'),
      filters: z.record(z.unknown()).optional().describe('Filter criteria: stage, owner, date_range, deal_value_min, deal_value_max, last_activity_days'),
      limit: z.number().optional().describe('Maximum records to return (default 50, max 200)'),
      include_activity_history: z.boolean().optional().describe('Include recent activity history per record'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  // ── Knowledge Management Agent — auto-gated stub + review-gated ──────────

  read_docs: {
    actionType: 'read_docs',
    description: 'Retrieve documentation pages or sections from the connected documentation source.',
    actionCategory: 'api',
    topics: ['knowledge'],
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['page_id', 'page_title', 'section', 'include_metadata'],
    parameterSchema: z.object({
      page_id: z.string().optional().describe('The ID or path of the documentation page to retrieve'),
      page_title: z.string().optional().describe('Human-readable page title for search-based retrieval'),
      section: z.string().optional().describe('Specific section or heading to retrieve'),
      include_metadata: z.boolean().optional().describe('Include page metadata. Default true.'),
    }),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'page_not_found'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  propose_doc_update: {
    actionType: 'propose_doc_update',
    description: 'Propose a specific change to an existing documentation page. Review-gated — requires human approval before write_docs is invoked.',
    actionCategory: 'worker',
    topics: ['knowledge'],
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['page_title', 'current_content', 'proposed_changes', 'change_type', 'reasoning'],
    parameterSchema: z.object({
      page_id: z.string().optional().describe('The ID of the documentation page to update'),
      page_title: z.string().describe('Human-readable page title'),
      current_content: z.string().describe('Current page content from read_docs'),
      proposed_changes: z.array(z.object({
        section: z.string(),
        current_text: z.string(),
        proposed_text: z.string(),
        change_reason: z.string(),
      })).describe('List of specific changes'),
      change_type: z.enum(['correction', 'update', 'addition', 'removal', 'restructure']).describe('The type of change'),
      reasoning: z.string().describe('Why this update is needed — shown to the reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  write_docs: {
    actionType: 'write_docs',
    description: 'Apply an approved documentation update to the connected documentation system. Review-gated — requires human approval before any content is written.',
    actionCategory: 'api',
    topics: ['knowledge'],
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['page_title', 'full_updated_content', 'change_summary', 'reasoning'],
    parameterSchema: z.object({
      page_id: z.string().optional().describe('The ID of the documentation page to update'),
      page_title: z.string().describe('Human-readable page title'),
      full_updated_content: z.string().describe('The complete updated page content'),
      change_summary: z.string().describe('Brief summary of what changed'),
      source_proposal_id: z.string().optional().describe('ID of the approved propose_doc_update action'),
      reasoning: z.string().describe('Why this update is being applied — shown to the reviewer'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  // ── Cross-Agent Memory Search (Feature 5) ──────────────────────────────────

  search_agent_history: {
    actionType: 'search_agent_history',
    description: 'Search memories and learnings across all agents in the workspace via semantic vector search.',
    actionCategory: 'worker',
    topics: ['workspace'],
    isExternal: false,
    isUniversal: true,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['op', 'query', 'memoryId'],
    parameterSchema: z.discriminatedUnion('op', [
      z.object({
        op: z.literal('search'),
        query: z.string().min(1).max(1000),
        includeOtherSubaccounts: z.boolean().optional(),
        topK: z.number().int().min(1).max(50).optional(),
      }),
      z.object({
        op: z.literal('read'),
        memoryId: z.string().uuid(),
      }),
    ]),
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout'],
      doNotRetryOn: ['validation_failure'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  // ── Methodology skills (pure prompt scaffolds, no side effects) ──────────
  // These entries enable the isMethodology fast-path in the preTool middleware,
  // which bypasses full action proposal and writes a lightweight audit row.

  ...Object.fromEntries(([
    ['draft_architecture_plan', 'Produce a structured architecture plan for a feature or subsystem.', ['dev']],
    ['draft_tech_spec', 'Produce a structured technical specification for a feature.', ['dev']],
    ['review_ux', 'Review a UI flow for usability issues and produce recommendations.', ['dev']],
    ['review_code', 'Review code for bugs, quality issues, and adherence to conventions.', ['dev']],
    ['write_tests', 'Generate test cases and test code for a given implementation.', ['dev']],
    ['draft_requirements', 'Draft structured requirements from a feature description.', ['dev']],
    ['derive_test_cases', 'Derive test cases from a requirements specification.', ['dev']],
    ['classify_email', 'Classify an inbound email by intent, urgency, and routing action.', ['support']],
    ['draft_reply', 'Draft a reply to a classified inbound email.', ['support']],
    ['draft_post', 'Draft social media post variants for one or more platforms.', ['social']],
    ['analyse_performance', 'Analyse ads campaign performance and produce ranked recommendations.', ['ads']],
    ['draft_ad_copy', 'Draft ad copy variants for a given campaign and platform.', ['ads']],
    ['draft_sequence', 'Draft a multi-step email outreach sequence.', ['email']],
    ['analyse_financials', 'Analyse revenue and expense data to produce a financial summary.', ['finance']],
    ['generate_competitor_brief', 'Research and produce a structured competitor intelligence brief.', ['strategy']],
    ['synthesise_voc', 'Synthesise voice-of-customer themes from collected feedback.', ['strategy']],
    ['draft_content', 'Draft long-form content (blog post, landing page, guide).', ['content']],
    ['audit_seo', 'Audit a page for on-page SEO issues and produce prioritised recommendations.', ['content']],
    ['draft_report', 'Draft a structured client-facing report from data sections.', ['reporting']],
    ['analyse_pipeline', 'Analyse CRM pipeline data for velocity, conversion, and stale deals.', ['crm']],
    ['draft_followup', 'Draft a follow-up email for a CRM deal or contact.', ['crm']],
    ['detect_churn_risk', 'Score accounts for churn risk based on engagement and commercial signals.', ['crm']],
    ['analyse_42macro_transcript', 'Analyse a 42 Macro transcript into a structured research report.', ['analysis']],
  ] as [string, string, string[]][]).map(([name, desc, topics]) => [name, {
    actionType: name,
    description: desc,
    actionCategory: 'worker' as const,
    topics,
    isExternal: false,
    isMethodology: true,
    defaultGateLevel: 'auto' as const,
    createsBoardTask: false,
    payloadFields: [],
    parameterSchema: z.object({}),
    retryPolicy: { maxRetries: 0, strategy: 'none' as const, retryOn: [] as string[], doNotRetryOn: [] as string[] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only' as const,
  }])),
};

/** Check if an action type is known */
export function getActionDefinition(actionType: string): ActionDefinition | undefined {
  return ACTION_REGISTRY[actionType];
}

/**
 * Sprint 5 P4.1 — returns the action types of all universal skills.
 * Re-exports from the dependency-free universalSkills.ts so callers
 * that already import from actionRegistry don't need to change.
 */
import { UNIVERSAL_SKILL_NAMES } from './universalSkills.js';
export { UNIVERSAL_SKILL_NAMES };
export function getUniversalSkillNames(): string[] {
  return [...UNIVERSAL_SKILL_NAMES];
}

/** Valid action statuses for state machine enforcement */
export const VALID_ACTION_STATUSES = [
  'proposed', 'pending_approval', 'approved', 'executing',
  'completed', 'failed', 'rejected', 'blocked', 'skipped',
] as const;

export type ActionStatus = typeof VALID_ACTION_STATUSES[number];

/** Legal state transitions */
export const LEGAL_TRANSITIONS: Record<string, string[]> = {
  proposed: ['pending_approval', 'approved', 'blocked', 'skipped', 'failed'],
  pending_approval: ['approved', 'rejected'],
  approved: ['executing'],
  executing: ['completed', 'failed'],
  // Terminal states: completed, failed, rejected, blocked, skipped — no transitions out
};
