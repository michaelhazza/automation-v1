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
      deliverable_type: z.enum(['document', 'code', 'report', 'screenshot', 'other']).optional().describe('Type of deliverable'),
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
export { UNIVERSAL_SKILL_NAMES } from './universalSkills.js';
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
