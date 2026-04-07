// ---------------------------------------------------------------------------
// Git helpers — clone + commit. Spec §7.6.
// SSH and file:// repo URLs are rejected. Push is not in v1.
// ---------------------------------------------------------------------------

import path from 'path';
import { runShellCommand } from './shell.js';
import { SafetyError } from '../../../shared/iee/failureReason.js';
import { env } from '../config/env.js';

export async function gitClone(
  workspaceDir: string,
  repoUrl: string,
  branch: string | undefined,
  ctx: { ieeRunId: string; stepNumber: number },
): Promise<{ path: string; exitCode: number }> {
  if (!/^https:\/\//i.test(repoUrl)) {
    throw new SafetyError(`only https:// repo URLs are allowed, got: ${repoUrl}`, 'denylisted_command');
  }
  const target = path.join(workspaceDir, 'repo');
  const branchFlag = branch ? `--branch ${shellQuote(branch)} ` : '';
  const cmd = `git clone --depth 1 ${branchFlag}${shellQuote(repoUrl)} repo`;
  const result = await runShellCommand(cmd, workspaceDir, ctx);
  return { path: target, exitCode: result.exitCode };
}

export async function gitCommit(
  workspaceDir: string,
  message: string,
  ctx: { ieeRunId: string; stepNumber: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const repoDir = path.join(workspaceDir, 'repo');
  const author = `${env.IEE_GIT_AUTHOR_NAME} <${env.IEE_GIT_AUTHOR_EMAIL}>`;
  const cmd = [
    `cd ${shellQuote(repoDir)}`,
    `git -c user.name=${shellQuote(env.IEE_GIT_AUTHOR_NAME)} -c user.email=${shellQuote(env.IEE_GIT_AUTHOR_EMAIL)} add -A`,
    `git -c user.name=${shellQuote(env.IEE_GIT_AUTHOR_NAME)} -c user.email=${shellQuote(env.IEE_GIT_AUTHOR_EMAIL)} commit -m ${shellQuote(message)} --author=${shellQuote(author)}`,
  ].join(' && ');
  return runShellCommand(cmd, workspaceDir, ctx);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
