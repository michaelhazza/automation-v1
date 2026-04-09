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
  parameterSchema: ParameterSchema;
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
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: true,
    payloadFields: ['to', 'subject', 'body', 'thread_id', 'provider'],
    parameterSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content (plain text or HTML)' },
        thread_id: { type: 'string', description: 'Thread ID to reply within an existing conversation (optional)' },
        provider: { type: 'string', description: 'Email provider to use (e.g. "gmail", "outlook"). Defaults to the configured default.' },
      },
      required: ['to', 'subject', 'body'],
    },
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
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['provider', 'since'],
    parameterSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Email provider to read from (e.g. "gmail", "outlook")' },
        since: { type: 'string', description: 'ISO 8601 timestamp — only return emails after this date' },
      },
      required: ['provider'],
    },
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
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['title', 'description', 'brief', 'status', 'priority', 'assigned_agent_id'],
    parameterSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title for the work item' },
        description: { type: 'string', description: 'Human-readable description visible in the task card' },
        brief: { type: 'string', description: 'Self-contained instructions for the agent picking up this task' },
        status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'review', 'done'], description: 'Initial status (default: todo)' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Task priority (default: normal)' },
        assigned_agent_id: { type: 'string', description: 'Agent ID to assign the task to' },
      },
      required: ['title'],
    },
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },
  move_task: {
    actionType: 'move_task',
    description: 'Move a task to a different status column on the board.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['task_id', 'status'],
    parameterSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The ID of the task to move' },
        status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'review', 'done'], description: 'Target status column' },
      },
      required: ['task_id', 'status'],
    },
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },
  reassign_task: {
    actionType: 'reassign_task',
    description: 'Reassign a task to a different agent.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['task_id', 'assigned_agent_id'],
    parameterSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The ID of the task to reassign' },
        assigned_agent_id: { type: 'string', description: 'The agent ID to assign the task to' },
      },
      required: ['task_id', 'assigned_agent_id'],
    },
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
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['task_id', 'title', 'content', 'deliverable_type'],
    parameterSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The ID of the task to attach the deliverable to' },
        title: { type: 'string', description: 'Title of the deliverable' },
        content: { type: 'string', description: 'Content of the deliverable (text, markdown, or JSON)' },
        deliverable_type: { type: 'string', enum: ['document', 'code', 'report', 'screenshot', 'other'], description: 'Type of deliverable' },
      },
      required: ['task_id', 'title', 'content'],
    },
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
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['provider', 'record_type', 'record_id', 'fields'],
    parameterSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Integration provider (e.g. "hubspot", "salesforce")' },
        record_type: { type: 'string', description: 'Type of record to update (e.g. "contact", "deal")' },
        record_id: { type: 'string', description: 'The ID of the record to update' },
        fields: { type: 'object', description: 'Key-value pairs of fields to update' },
      },
      required: ['provider', 'record_type', 'record_id', 'fields'],
    },
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
    parameterSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method (default: GET)' },
        headers: { type: 'object', description: 'Optional HTTP headers as key-value pairs' },
        body: { type: 'string', description: 'Optional request body (for POST/PUT/PATCH)' },
      },
      required: ['url'],
    },
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
    parameterSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title for the approval request' },
        description: { type: 'string', description: 'What needs to be approved and why' },
        context: { type: 'string', description: 'Additional context for the reviewer' },
        options: { type: 'array', description: 'List of options for the reviewer to choose from', items: { type: 'string' } },
      },
      required: ['title', 'description'],
    },
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  // ── Dev/QA read-only skills (auto-gated, audit trail only) ────────────────

  read_codebase: {
    actionType: 'read_codebase',
    description: 'Read the contents of a file from the project codebase.',
    actionCategory: 'devops',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['file_path'],
    parameterSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to read, relative to project root' },
      },
      required: ['file_path'],
    },
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
    parameterSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — text to find in the codebase' },
        search_type: { type: 'string', enum: ['content', 'filename'], description: 'Search by file content or filename (default: content)' },
        file_pattern: { type: 'string', description: 'Glob pattern to filter files (e.g. "**/*.ts")' },
        max_results: { type: 'number', description: 'Maximum results to return (default: 20)' },
      },
      required: ['query'],
    },
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout'],
      doNotRetryOn: ['permission_failure', 'validation_failure'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  run_tests: {
    actionType: 'run_tests',
    description: 'Run the project test suite, optionally filtered to specific tests.',
    actionCategory: 'devops',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['test_filter'],
    parameterSchema: {
      type: 'object',
      properties: {
        test_filter: { type: 'string', description: 'Filter to run specific tests (e.g. test name pattern or file path)' },
      },
      required: [],
    },
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
    parameterSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The endpoint URL to test' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method (default: GET)' },
        headers: { type: 'object', description: 'HTTP headers as key-value pairs' },
        body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
        expected_status: { type: 'number', description: 'Expected HTTP status code for validation' },
      },
      required: ['url'],
    },
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
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: true,
    payloadFields: ['title', 'description', 'severity', 'confidence', 'steps_to_reproduce', 'expected_behavior', 'actual_behavior'],
    parameterSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, descriptive bug title' },
        description: { type: 'string', description: 'Detailed description of the bug' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Bug severity' },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Confidence that this is a real bug' },
        steps_to_reproduce: { type: 'string', description: 'Step-by-step reproduction instructions' },
        expected_behavior: { type: 'string', description: 'What should happen' },
        actual_behavior: { type: 'string', description: 'What actually happens' },
      },
      required: ['title', 'description', 'severity'],
    },
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
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['file', 'diff', 'reasoning', 'base_commit', 'intent'],
    parameterSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to the file to modify, relative to projectRoot' },
        diff: { type: 'string', description: 'Unified diff (--- / +++ / @@ format). Must be minimal and targeted.' },
        base_commit: { type: 'string', description: 'The git commit hash this diff is based on' },
        intent: { type: 'string', enum: ['feature', 'bugfix', 'refactor', 'test', 'config'], description: 'Type of change' },
        reasoning: { type: 'string', description: 'Why this change is needed. The reviewer sees this field and the diff.' },
      },
      required: ['file', 'diff', 'base_commit', 'reasoning'],
    },
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
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['command'],
    parameterSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
      },
      required: ['command'],
    },
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
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['title', 'description', 'branch'],
    parameterSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Pull request title' },
        description: { type: 'string', description: 'Pull request body/description (markdown)' },
        branch: { type: 'string', description: 'Source branch name' },
      },
      required: ['title', 'branch'],
    },
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
    parameterSchema: {
      type: 'object',
      properties: {
        worker_agent_slug: { type: 'string', description: 'Slug of the worker agent to assign the task to' },
        task_description: { type: 'string', description: 'Description of the task for the worker agent' },
        context: { type: 'string', description: 'Additional context or instructions for the worker' },
      },
      required: ['worker_agent_slug', 'task_description'],
    },
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
    parameterSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID of the page project to create the page in' },
        slug: { type: 'string', description: 'URL slug for the page (must be unique within the project)' },
        pageType: { type: 'string', enum: ['website', 'landing'], description: 'Type of page — website or landing page' },
        title: { type: 'string', description: 'Page title' },
        html: { type: 'string', description: 'HTML content for the page (max 1 MB). Will be sanitised before storage.' },
        meta: { type: 'object', properties: { title: {}, description: {}, ogImage: {}, canonicalUrl: {}, noIndex: {} }, description: 'SEO and social meta fields' },
        formConfig: { type: 'object', description: 'Optional form configuration for the page' },
      },
      required: ['projectId', 'slug', 'pageType', 'html'],
    },
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
    parameterSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'ID of the page to update' },
        projectId: { type: 'string', description: 'ID of the project the page belongs to' },
        html: { type: 'string', description: 'Updated HTML content (max 1 MB). Will be sanitised before storage.' },
        meta: { type: 'object', description: 'Updated SEO and social meta fields' },
        formConfig: { type: 'object', description: 'Updated form configuration' },
        changeNote: { type: 'string', description: 'Brief note describing the change (stored with the version snapshot)' },
      },
      required: ['pageId', 'projectId'],
    },
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
    parameterSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'ID of the page to publish' },
        projectId: { type: 'string', description: 'ID of the project the page belongs to' },
      },
      required: ['pageId', 'projectId'],
    },
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
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['tag_filters'],
    parameterSchema: { type: 'object', properties: { tag_filters: { type: 'string', description: 'Tag filters JSON' } }, required: [] },
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
    parameterSchema: { type: 'object', properties: { semantic_query: { type: 'string', description: 'Semantic search query' } }, required: [] },
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
    parameterSchema: { type: 'object', properties: { content: { type: 'string', description: 'Insight content' }, entry_type: { type: 'string', description: 'Insight type' } }, required: ['content', 'entry_type'] },
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'keyed_write',
  },

  compute_health_score: {
    actionType: 'compute_health_score',
    description: 'Calculate a composite health score (0-100) for a subaccount based on normalised metrics.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['account_id'],
    parameterSchema: { type: 'object', properties: { account_id: { type: 'string', description: 'Canonical account ID' } }, required: ['account_id'] },
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  detect_anomaly: {
    actionType: 'detect_anomaly',
    description: 'Compare current metrics against historical baseline and flag significant deviations.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['account_id', 'metric_name', 'current_value'],
    parameterSchema: { type: 'object', properties: { account_id: { type: 'string', description: 'Canonical account ID' }, metric_name: { type: 'string', description: 'Metric name' }, current_value: { type: 'string', description: 'Current metric value' } }, required: ['account_id', 'metric_name', 'current_value'] },
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  compute_churn_risk: {
    actionType: 'compute_churn_risk',
    description: 'Evaluate churn risk signals for a subaccount and produce a risk score with intervention recommendation.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['account_id'],
    parameterSchema: { type: 'object', properties: { account_id: { type: 'string', description: 'Canonical account ID' } }, required: ['account_id'] },
    retryPolicy: { maxRetries: 1, strategy: 'fixed', retryOn: ['db_error'], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    idempotencyStrategy: 'read_only',
  },

  generate_portfolio_report: {
    actionType: 'generate_portfolio_report',
    description: 'Generate a structured portfolio intelligence briefing across the entire organisation.',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: [],
    parameterSchema: { type: 'object', properties: { reporting_period_days: { type: 'string', description: 'Days to cover' }, format: { type: 'string', description: 'Output format' } }, required: [] },
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
    parameterSchema: { type: 'object', properties: { account_id: { type: 'string', description: 'Canonical account ID' }, intervention_type: { type: 'string', description: 'Intervention type' }, evidence_summary: { type: 'string', description: 'Evidence justification' } }, required: ['account_id', 'intervention_type', 'evidence_summary'] },
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
    idempotencyStrategy: 'locked',
  },
};

/** Check if an action type is known */
export function getActionDefinition(actionType: string): ActionDefinition | undefined {
  return ACTION_REGISTRY[actionType];
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
