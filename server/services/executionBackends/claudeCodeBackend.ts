/**
 * claudeCodeBackend — subprocess invocation of the Claude Code CLI runner.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 7
 *       (claude-code row), § 11 (Adapter rows), § 14 Chunk 4.
 *
 * Tier 5 terminal-repo adapter. Spawns `claude -p` against the host's
 * Claude Max plan — zero API cost. The runner module
 * (`claudeCodeRunner.execute`) already encapsulates the subprocess
 * lifecycle, so the adapter dispatch body is a thin shim that builds the
 * runner input from `BackendDispatchInput` + the cwd carried by
 * `ClaudeCodeBackendOptions`.
 *
 * Cycle prevention — does NOT import from `agentExecutionService.ts`. The
 * `claudeCodeRunner` module is a sibling that has no path back into the
 * dispatch site; importing it directly is safe.
 *
 * Status — Chunk 4 (this commit):
 *   The dispatch ladder still routes `claude-code` through the inline
 *   branch in `agentExecutionService.ts:1474–1521`. Chunk 5 cuts over to
 *   the registry call and the inline branch is removed. Until then the
 *   adapter is registered (so the registry resolves all five modes) but
 *   never reached at runtime — the dispatch body throws an explicit
 *   "not yet wired" diagnostic if a future caller races ahead of the
 *   cutover.
 */

import {
  BackendOptionsMismatch,
  type ExecutionBackend,
} from './types.js';

export const claudeCodeBackend: ExecutionBackend = {
  // === Identity ===
  id: 'claude-code',
  capabilities: ['subprocess', 'terminal_repo'],
  costModel: 'subscription',
  sandboxRequirement: 'terminal_repo',
  // No delegated lifecycle slots — subprocess dispatch finalises inline
  // via the existing post-completion block in `agentExecutionService.ts`.

  async dispatch(input) {
    if (input.backendOptions.backendId !== 'claude-code') {
      throw new BackendOptionsMismatch('claude-code', input.backendOptions.backendId);
    }

    // The real `claudeCodeRunner.execute` invocation lands in Chunk 5
    // alongside the dispatch-site cutover. Until then, throwing keeps
    // the contract honest: every dispatch path reaches a defined code
    // path, and any caller racing ahead of Chunk 5 fails loudly. Spec
    // § 14 Chunk 5 is the locus for the actual wiring.
    throw new Error(
      `claudeCodeBackend.dispatch is not yet wired — Chunk 5 of the ` +
        `ExecutionBackend Adapter Contract refactor cuts over the ` +
        `dispatch ladder. Until then, claude-code dispatch continues ` +
        `through the inline branch in agentExecutionService.ts.`,
    );
  },
};
