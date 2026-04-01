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

export interface ActionDefinition {
  actionType: string;
  actionCategory: 'api' | 'worker' | 'browser' | 'devops';
  isExternal: boolean;
  defaultGateLevel: 'auto' | 'review' | 'block';
  createsBoardTask: boolean;
  payloadFields: string[];
  retryPolicy: RetryPolicy;
  mcp?: { annotations: McpAnnotations };
}

export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  send_email: {
    actionType: 'send_email',
    actionCategory: 'api',
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: true,
    payloadFields: ['to', 'subject', 'body', 'thread_id', 'provider'],
    retryPolicy: {
      maxRetries: 3,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error', 'rate_limit'],
      doNotRetryOn: ['validation_error', 'auth_error', 'recipient_not_found'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  },
  read_inbox: {
    actionType: 'read_inbox',
    actionCategory: 'api',
    isExternal: true,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['provider', 'since'],
    retryPolicy: {
      maxRetries: 3,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['auth_error'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  },
  create_task: {
    actionType: 'create_task',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['title', 'description', 'brief', 'status', 'priority', 'assigned_agent_id'],
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  },
  move_task: {
    actionType: 'move_task',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['task_id', 'status'],
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  },
  reassign_task: {
    actionType: 'reassign_task',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['task_id', 'assigned_agent_id'],
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  },
  add_deliverable: {
    actionType: 'add_deliverable',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['task_id', 'title', 'content', 'deliverable_type'],
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  },
  update_record: {
    actionType: 'update_record',
    actionCategory: 'api',
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['provider', 'record_type', 'record_id', 'fields'],
    retryPolicy: {
      maxRetries: 3,
      strategy: 'exponential_backoff',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error', 'not_found'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  },
  fetch_url: {
    actionType: 'fetch_url',
    actionCategory: 'api',
    isExternal: true,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['url', 'method', 'headers', 'body'],
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  },
  request_approval: {
    actionType: 'request_approval',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['title', 'description', 'context', 'options'],
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  },

  // ── Dev/QA read-only skills (auto-gated, audit trail only) ────────────────

  read_codebase: {
    actionType: 'read_codebase',
    actionCategory: 'devops',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['file_path'],
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout'],
      doNotRetryOn: ['permission_failure', 'validation_failure'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  },

  search_codebase: {
    actionType: 'search_codebase',
    actionCategory: 'devops',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['query', 'search_type', 'file_pattern', 'max_results'],
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout'],
      doNotRetryOn: ['permission_failure', 'validation_failure'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  },

  run_tests: {
    actionType: 'run_tests',
    actionCategory: 'devops',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['test_filter'],
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['permission_failure', 'execution_failure'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  },

  analyze_endpoint: {
    actionType: 'analyze_endpoint',
    actionCategory: 'api',
    isExternal: true,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['url', 'method', 'headers', 'body', 'expected_status'],
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['timeout', 'network_error'],
      doNotRetryOn: ['validation_failure'],
    },
    mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  },

  report_bug: {
    actionType: 'report_bug',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: true,
    payloadFields: ['title', 'description', 'severity', 'confidence', 'steps_to_reproduce', 'expected_behavior', 'actual_behavior'],
    retryPolicy: {
      maxRetries: 2,
      strategy: 'fixed',
      retryOn: ['db_error'],
      doNotRetryOn: [],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  },

  // ── Dev/QA devops actions ──────────────────────────────────────────────────

  write_patch: {
    actionType: 'write_patch',
    actionCategory: 'devops',
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['file', 'diff', 'reasoning', 'base_commit', 'intent'],
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: ['base_commit_mismatch', 'patch_size_exceeded', 'permission_failure'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  },

  run_command: {
    actionType: 'run_command',
    actionCategory: 'devops',
    isExternal: false,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['command'],
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['execution_failure', 'timeout'],
      doNotRetryOn: ['permission_failure', 'validation_failure'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  },

  create_pr: {
    actionType: 'create_pr',
    actionCategory: 'devops',
    isExternal: true,
    defaultGateLevel: 'review',
    createsBoardTask: false,
    payloadFields: ['title', 'description', 'branch'],
    retryPolicy: {
      maxRetries: 2,
      strategy: 'exponential_backoff',
      retryOn: ['execution_failure', 'timeout', 'network_error'],
      doNotRetryOn: ['validation_failure', 'environment_failure'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  },

  // ── Workflow orchestration (Phase 2) ────────────────────────────────────────

  assign_task: {
    actionType: 'assign_task',
    actionCategory: 'worker',
    isExternal: false,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: ['worker_agent_slug', 'task_description', 'context'],
    retryPolicy: {
      maxRetries: 1,
      strategy: 'fixed',
      retryOn: ['execution_failure'],
      doNotRetryOn: ['validation_error'],
    },
    mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
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
