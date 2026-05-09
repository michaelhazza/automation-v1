// Shared types for Execution Environment (spec §4.2.8).
// Pure types and pure mapping function only — no DB access.

export const EXECUTION_ENVIRONMENTS = [
  'api_tool',
  'headless',
  'browser',
  'terminal_repo',
] as const;

export type ExecutionEnvironment = (typeof EXECUTION_ENVIRONMENTS)[number];

// ExecutionMode mirrors agent_runs.execution_mode column type.
// Source of truth: server/db/schema/agentRuns.ts line 39.
export type ExecutionMode = 'api' | 'headless' | 'claude-code' | 'iee_browser' | 'iee_dev';

// Maps each ExecutionMode value to its ExecutionEnvironment (spec §4.2.8).
// The exhaustiveness guard (const _exhaustive: never = mode) ensures that
// adding a new ExecutionMode value without updating this function is a
// compile-time error.
export function executionModeToEnvironment(mode: ExecutionMode): ExecutionEnvironment {
  switch (mode) {
    case 'api':
      return 'api_tool';
    case 'headless':
      return 'headless';
    case 'claude-code':
      return 'terminal_repo';
    case 'iee_browser':
      return 'browser';
    case 'iee_dev':
      return 'terminal_repo';
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unhandled ExecutionMode: ${_exhaustive}`);
    }
  }
}
