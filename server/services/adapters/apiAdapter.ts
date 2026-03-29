import type { Action } from '../../db/schema/actions.js';
import type { IntegrationConnection } from '../../db/schema/integrationConnections.js';
import type { ExecutionResult, ExecutionAdapter } from './workerAdapter.js';

// ---------------------------------------------------------------------------
// API Adapter — executes external API calls (send_email, read_inbox, etc.)
// Phase 1B: Implementation will use provider interfaces backed by integration_connections.
// Phase 1A: Stub that returns not-implemented.
// ---------------------------------------------------------------------------

export const apiAdapter: ExecutionAdapter = {
  async execute(action: Action, connection?: unknown): Promise<ExecutionResult> {
    // Phase 1B will implement provider dispatch here.
    // For now, return a clear stub response.
    return {
      success: false,
      resultStatus: 'failed',
      error: `API adapter not yet implemented for action type: ${action.actionType}. This will be available in Phase 1B.`,
      errorCode: 'not_implemented',
    };
  },
};
