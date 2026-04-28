/**
 * config.ts
 *
 * Env-driven configuration for the Mission Control server. All paths are
 * resolved relative to MISSION_CONTROL_REPO_ROOT, defaulting to process.cwd().
 *
 * Config is read once at server startup; the result is immutable.
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

export interface Config {
  repoRoot: string;
  port: number;
  githubRepo: string | null;
  githubToken: string | null;
  reviewLogsDir: string;
  buildsDir: string;
  currentFocusPath: string;
}

const DEFAULT_PORT = 5050;

/**
 * Try to infer the GitHub repo from `git remote get-url origin`.
 * Returns null if git or the remote isn't available.
 */
function inferGithubRepo(repoRoot: string): string | null {
  try {
    const url = execSync('git remote get-url origin', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // git@github.com:owner/repo.git
    // https://github.com/owner/repo.git
    // http://host/owner/repo
    const m = url.match(/[/:]([^/:]+\/[^/]+?)(?:\.git)?\s*$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function loadConfig(): Config {
  const repoRoot = resolve(process.env.MISSION_CONTROL_REPO_ROOT ?? process.cwd());
  const port = Number(process.env.MISSION_CONTROL_PORT ?? DEFAULT_PORT);
  const githubRepo =
    process.env.MISSION_CONTROL_GITHUB_REPO ?? inferGithubRepo(repoRoot);
  const githubToken = process.env.GITHUB_TOKEN ?? null;

  return {
    repoRoot,
    port,
    githubRepo,
    githubToken,
    reviewLogsDir: resolve(repoRoot, 'tasks/review-logs'),
    buildsDir: resolve(repoRoot, 'tasks/builds'),
    currentFocusPath: resolve(repoRoot, 'tasks/current-focus.md'),
  };
}
