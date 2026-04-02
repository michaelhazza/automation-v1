/**
 * Claude Code Runner — spawns the Claude Code CLI to execute agent tasks.
 *
 * This is the bridge between AutomationOS agent definitions and the Claude Code
 * CLI. It allows agents to explore codebases, write files, run tests, and
 * self-correct — all powered by the user's Claude Max plan (zero API cost).
 *
 * Execution flow:
 *   1. Build a prompt from the agent's system prompt + task context
 *   2. Spawn `claude -p <prompt>` with structured JSON output
 *   3. Capture and parse the result
 *   4. Return structured data for storage in agent_runs
 *
 * This service is designed to be swapped for Docker-based execution later
 * without changing the interface.
 */

import { spawn } from 'child_process';
import { emitAgentRunUpdate } from '../websocket/emitters.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeCodeRequest {
  /** The full system prompt (3-layer assembled) */
  systemPrompt: string;
  /** The task/user prompt — what the agent should do this run */
  taskPrompt: string;
  /** Working directory for Claude Code to operate in */
  cwd: string;
  /** Tools Claude Code is allowed to use */
  allowedTools?: string[];
  /** Max agentic turns before stopping */
  maxTurns?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Run ID for progress updates */
  runId?: string;
}

export interface ClaudeCodeResult {
  success: boolean;
  /** The text result from Claude Code */
  result: string;
  /** Session ID for resumption */
  sessionId: string | null;
  /** Total cost in USD (may be 0 for Max plan) */
  costUsd: number;
  /** Total input tokens */
  inputTokens: number;
  /** Total output tokens */
  outputTokens: number;
  /** Total tokens */
  totalTokens: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Number of tool calls made */
  numTurns: number;
  /** Raw stderr output (for debugging) */
  stderr: string;
  /** Whether the process timed out */
  timedOut: boolean;
}

// ---------------------------------------------------------------------------
// Default allowed tools for agent execution
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export const claudeCodeRunner = {
  /**
   * Execute a task via Claude Code CLI.
   * Returns structured results for storage in agent_runs.
   */
  async execute(request: ClaudeCodeRequest): Promise<ClaudeCodeResult> {
    const startTime = Date.now();
    const allowedTools = request.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
    const maxTurns = request.maxTurns ?? 50;
    const timeoutMs = request.timeoutMs ?? 600_000; // 10 minutes default

    // Build the full prompt: system context + task
    const fullPrompt = [
      request.systemPrompt,
      '\n\n---\n## Your Task\n',
      request.taskPrompt,
      '\n\nWhen you are done, provide a clear summary of what you accomplished, what tests you wrote/ran, and any issues found.',
    ].join('');

    const args = [
      '-p', fullPrompt,
      '--output-format', 'json',
      '--allowedTools', allowedTools.join(','),
      '--max-turns', String(maxTurns),
      '--verbose',
    ];

    return new Promise<ClaudeCodeResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const proc = spawn('claude', args, {
        cwd: request.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Ensure non-interactive mode
          CI: '1',
        },
      });

      // Timeout handling
      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        // Give it 5s to clean up, then force kill
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 5000);
      }, timeoutMs);

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;

        // Emit progress updates if we have a runId
        if (request.runId && chunk.trim()) {
          emitAgentRunUpdate(request.runId, 'agent:run:progress', {
            type: 'claude_code_stderr',
            message: chunk.trim().slice(0, 500),
          });
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        // Try to parse JSON output
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          // stdout may not be valid JSON if the process was killed or errored
        }

        if (parsed) {
          resolve({
            success: code === 0,
            result: String(parsed.result ?? parsed.error ?? stdout),
            sessionId: parsed.session_id as string | null ?? null,
            costUsd: Number(parsed.cost_usd ?? 0),
            inputTokens: (parsed.usage as Record<string, number>)?.input_tokens ?? 0,
            outputTokens: (parsed.usage as Record<string, number>)?.output_tokens ?? 0,
            totalTokens: ((parsed.usage as Record<string, number>)?.input_tokens ?? 0) +
                         ((parsed.usage as Record<string, number>)?.output_tokens ?? 0),
            durationMs,
            numTurns: Number(parsed.num_turns ?? 0),
            stderr,
            timedOut: killed,
          });
        } else {
          // Fallback: non-JSON output or process failure
          resolve({
            success: false,
            result: killed
              ? `Claude Code timed out after ${Math.round(timeoutMs / 1000)}s. Partial output:\n${stdout.slice(0, 2000)}`
              : `Claude Code exited with code ${code}.\nStdout: ${stdout.slice(0, 2000)}\nStderr: ${stderr.slice(0, 2000)}`,
            sessionId: null,
            costUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            durationMs,
            numTurns: 0,
            stderr,
            timedOut: killed,
          });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          result: `Failed to spawn Claude Code CLI: ${err.message}. Is it installed? Run: npm install -g @anthropic-ai/claude-code`,
          sessionId: null,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          durationMs: Date.now() - startTime,
          numTurns: 0,
          stderr: err.message,
          timedOut: false,
        });
      });
    });
  },

  /**
   * Check if Claude Code CLI is available on this machine.
   */
  async isAvailable(): Promise<{ available: boolean; version: string | null }> {
    return new Promise((resolve) => {
      const proc = spawn('claude', ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });

      proc.on('close', (code) => {
        resolve({
          available: code === 0,
          version: code === 0 ? stdout.trim() : null,
        });
      });

      proc.on('error', () => {
        resolve({ available: false, version: null });
      });

      // Don't wait forever
      setTimeout(() => {
        proc.kill();
        resolve({ available: false, version: null });
      }, 5000);
    });
  },
};
