// ---------------------------------------------------------------------------
// Shell command runner. Spec §7.4, §7.5, §13.5, §13.6.1.c.
// ---------------------------------------------------------------------------

import { spawn } from 'child_process';
import { env } from '../config/env.js';
import { assertCommandAllowed } from './denylist.js';
import { TimeoutError } from '../../../shared/iee/failureReason.js';
import { logger, truncateMiddle, truncate } from '../logger.js';

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const STDOUT_RING_CAP = 65_536;

function buildSanitisedEnv(workspaceDir: string): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: workspaceDir,
    LANG: 'C.UTF-8',
    CI: 'true',
  };
}

export async function runShellCommand(
  command: string,
  workspaceDir: string,
  ctx: { ieeRunId: string; stepNumber: number },
): Promise<ShellResult> {
  assertCommandAllowed(command);

  const start = Date.now();
  // §13.5 — wrap in bash -lc 'set -euo pipefail; <cmd>' for safer execution
  const child = spawn('bash', ['-lc', `set -euo pipefail; ${command}`], {
    cwd: workspaceDir,
    env: buildSanitisedEnv(workspaceDir),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  let stdout = '';
  let stderr = '';
  let stdoutTrunc = false;
  let stderrTrunc = false;

  child.stdout.on('data', (chunk: Buffer) => {
    if (stdout.length >= STDOUT_RING_CAP) { stdoutTrunc = true; return; }
    stdout += chunk.toString('utf8');
    if (stdout.length > STDOUT_RING_CAP) {
      stdout = stdout.slice(0, STDOUT_RING_CAP);
      stdoutTrunc = true;
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length >= STDOUT_RING_CAP) { stderrTrunc = true; return; }
    stderr += chunk.toString('utf8');
    if (stderr.length > STDOUT_RING_CAP) {
      stderr = stderr.slice(0, STDOUT_RING_CAP);
      stderrTrunc = true;
    }
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* swallow */ }
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* swallow */ }
      }, 2000);
    }, env.MAX_COMMAND_TIME_MS);

    child.on('error', (err) => {
      clearTimeout(killTimer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (timedOut) {
        reject(new TimeoutError(`command exceeded MAX_COMMAND_TIME_MS=${env.MAX_COMMAND_TIME_MS}`));
        return;
      }
      resolve(code ?? -1);
    });
  });

  const durationMs = Date.now() - start;
  if (stdoutTrunc) stdout += '\n[truncated]';
  if (stderrTrunc) stderr += '\n[truncated]';

  // §13.6.1.c — per-command audit log
  logger.info('iee.dev.command', {
    ieeRunId: ctx.ieeRunId,
    stepNumber: ctx.stepNumber,
    command: truncate(command, 500),
    exitCode,
    durationMs,
    stdout: truncateMiddle(stdout, 1500),
    stderr: truncateMiddle(stderr, 1500),
  });

  return { exitCode, stdout, stderr, durationMs };
}
