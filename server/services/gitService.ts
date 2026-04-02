import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { integrationConnections } from '../db/schema/index.js';
import { devContextService, type DevContext } from './devContextService.js';
import { connectionTokenService } from './connectionTokenService.js';
import { getInstallationAccessToken } from '../routes/githubApp.js';
import { logger } from '../lib/logger.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Git Abstraction Service
// Wraps all git operations. Skills call service methods; the service enforces
// DEC git config. Agents never construct raw git commands.
//
// Supports both GitHub App installations (preferred) and legacy OAuth tokens.
// ---------------------------------------------------------------------------

export interface PROptions {
  title: string;
  description: string;
  branch: string;
  baseBranch?: string;
}

export interface GitHubCredentials {
  token: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetch wrapper for GitHub API calls with retry + rate-limit handling.
 *
 * Retries on 429 (rate limit), 502, 503, and network errors.
 * Respects Retry-After header when present. Max 3 attempts with
 * exponential backoff (1s, 2s, 4s).
 */
async function githubFetch(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
  maxAttempts = 3
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(15000),
      });

      // Rate limited — wait and retry
      if (res.status === 429 || res.status === 403) {
        const retryAfter = res.headers.get('retry-after');
        const remaining = res.headers.get('x-ratelimit-remaining');

        // Only retry 403 if it's actually a rate limit (remaining === '0')
        if (res.status === 403 && remaining !== '0') {
          return res; // Real 403, don't retry
        }

        const waitSec = retryAfter ? parseInt(retryAfter, 10) : Math.pow(2, attempt);
        const waitMs = Math.min(waitSec * 1000, 30000); // cap at 30s

        logger.warn('github.rate_limited', {
          url,
          status: res.status,
          attempt: attempt + 1,
          retryAfterSec: waitSec,
          rateLimitRemaining: remaining,
        });

        if (attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        return res; // Out of retries, return the 429
      }

      // Server errors — retry with backoff
      if (res.status === 502 || res.status === 503) {
        logger.warn('github.server_error', {
          url,
          status: res.status,
          attempt: attempt + 1,
        });

        if (attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
          continue;
        }
        return res; // Out of retries
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Network errors — retry with backoff
      const isRetryable = lastError.message.includes('ECONNRESET')
        || lastError.message.includes('ECONNREFUSED')
        || lastError.message.includes('ETIMEDOUT')
        || lastError.message.includes('fetch failed')
        || lastError.name === 'AbortError';

      logger.warn('github.fetch_error', {
        url,
        error: lastError.message,
        attempt: attempt + 1,
        retryable: isRetryable,
      });

      if (!isRetryable || attempt >= maxAttempts - 1) {
        throw lastError;
      }

      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }

  throw lastError ?? new Error('GitHub API request failed after retries');
}

async function git(args: string[], cwd: string, timeout = 30000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = e.stderr?.trim() || e.message || String(err);
    throw { errorCode: 'execution_failure', message: `git ${args[0]} failed: ${detail}` };
  }
}

/**
 * Get GitHub credentials for a subaccount.
 * Supports both GitHub App (installation tokens) and legacy OAuth connections.
 * If connectionId is provided, uses that specific connection; otherwise finds the first active one.
 */
async function getGitHubCredentials(subaccountId: string, connectionId?: string): Promise<GitHubCredentials> {
  const conditions = [
    eq(integrationConnections.subaccountId, subaccountId),
    eq(integrationConnections.providerType, 'github'),
    eq(integrationConnections.connectionStatus, 'active'),
  ];

  if (connectionId) {
    conditions.push(eq(integrationConnections.id, connectionId));
  }

  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(and(...conditions))
    .limit(1);

  if (!conn) {
    throw {
      statusCode: 400,
      message: connectionId
        ? `GitHub connection ${connectionId} not found or inactive.`
        : 'No active GitHub integration found for this subaccount. Connect GitHub in integrations.',
      errorCode: 'environment_failure',
    };
  }

  // GitHub App installation — mint a fresh installation access token
  if (conn.authType === 'github_app') {
    const config = conn.configJson as { installationId?: number } | null;
    if (!config?.installationId) {
      throw {
        statusCode: 400,
        message: 'GitHub App connection has no installation ID. Re-install the GitHub App.',
        errorCode: 'environment_failure',
      };
    }
    const token = await getInstallationAccessToken(config.installationId);
    return { token };
  }

  // Legacy OAuth — decrypt stored access token
  if (!conn.accessToken) {
    throw {
      statusCode: 400,
      message: 'GitHub integration is connected but has no access token. Re-connect GitHub.',
      errorCode: 'environment_failure',
    };
  }

  return { token: connectionTokenService.decryptToken(conn.accessToken) };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const gitService = {
  async createBranch(subaccountId: string, branchName: string): Promise<string> {
    const { context } = await devContextService.getContext(subaccountId);
    await git(['checkout', '-b', branchName], context.projectRoot);
    return branchName;
  },

  async checkoutBranch(subaccountId: string, branch: string): Promise<void> {
    const { context } = await devContextService.getContext(subaccountId);
    await git(['checkout', branch], context.projectRoot);
  },

  async getCurrentBranch(subaccountId: string): Promise<string> {
    const { context } = await devContextService.getContext(subaccountId);
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], context.projectRoot);
  },

  async getBaseCommit(subaccountId: string): Promise<string> {
    const { context } = await devContextService.getContext(subaccountId);
    return git(['rev-parse', 'HEAD'], context.projectRoot);
  },

  /**
   * Apply a unified diff to a file. Verifies HEAD matches baseCommit before applying.
   * Idempotent: skips if a commit with the same diff hash already exists on this branch.
   */
  async applyPatch(
    subaccountId: string,
    file: string,
    diff: string,
    baseCommit: string
  ): Promise<string> {
    const { context } = await devContextService.getContext(subaccountId);
    const root = context.projectRoot;

    // 1. Verify HEAD matches baseCommit
    const currentHead = await git(['rev-parse', 'HEAD'], root);
    if (currentHead !== baseCommit) {
      throw {
        errorCode: 'base_commit_mismatch',
        message: `Expected HEAD at ${baseCommit}, found ${currentHead}. Patch cannot be applied safely. Re-read the current state and re-propose.`,
      };
    }

    // 2. Idempotency check: see if a commit with this diff hash already exists
    const diffHash = createHash('sha256').update(diff).digest('hex').slice(0, 12);
    const commitMsg = `agent-patch:${diffHash}`;
    const existing = await git(['log', '--oneline', '--grep', commitMsg, '-1'], root).catch(() => '');
    if (existing) {
      // Already applied — return the commit hash
      const commitHash = existing.split(' ')[0];
      return commitHash;
    }

    // 3. Apply the diff via git apply
    const { writeFile, unlink } = await import('fs/promises');
    const { join } = await import('path');
    const tmpFile = join(root, `.agent-patch-${Date.now()}.diff`);

    try {
      await writeFile(tmpFile, diff, 'utf8');
      await git(['apply', '--whitespace=nowarn', tmpFile], root);
      await unlink(tmpFile).catch(() => undefined);
    } catch (err) {
      await unlink(tmpFile).catch(() => undefined);
      throw err;
    }

    // 4. Stage and commit the changed file
    await git(['add', file], root);
    const commitHash = await this.commitChanges(
      subaccountId,
      `${commitMsg}\n\nApplied by Dev agent`,
      [file]
    );

    return commitHash;
  },

  async commitChanges(subaccountId: string, message: string, files: string[]): Promise<string> {
    const { context } = await devContextService.getContext(subaccountId);
    const root = context.projectRoot;

    if (files.length > 0) {
      await git(['add', ...files], root);
    }

    await git(['commit', '-m', message], root);
    return git(['rev-parse', 'HEAD'], root);
  },

  async pushBranch(subaccountId: string, branch: string): Promise<void> {
    const { context } = await devContextService.getContext(subaccountId);
    const remote = context.gitConfig.remote;
    await git(['push', remote, branch], context.projectRoot, 60000);
  },

  async revertCommit(subaccountId: string, commitHash: string): Promise<void> {
    const { context } = await devContextService.getContext(subaccountId);
    await git(['revert', '--no-edit', commitHash], context.projectRoot);
  },

  async closeBranch(subaccountId: string, branch: string): Promise<void> {
    const { context } = await devContextService.getContext(subaccountId);
    const defaultBranch = context.gitConfig.defaultBranch;
    await git(['checkout', defaultBranch], context.projectRoot);
    await git(['branch', '-D', branch], context.projectRoot);
  },

  /**
   * Create a GitHub PR via the GitHub REST API.
   * Idempotent: returns the existing PR URL if one is already open for this branch.
   */
  async createPullRequest(subaccountId: string, opts: PROptions): Promise<string> {
    const { context } = await devContextService.getContext(subaccountId);
    const { repoOwner, repoName, defaultBranch, githubConnectionId } = context.gitConfig;
    const { token } = await getGitHubCredentials(subaccountId, githubConnectionId);
    const baseBranch = opts.baseBranch ?? defaultBranch;

    // Idempotency: check for existing open PR on this branch
    const listRes = await githubFetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/pulls?state=open&head=${repoOwner}:${opts.branch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (listRes.ok) {
      const existing = await listRes.json() as Array<{ html_url: string }>;
      if (existing.length > 0) {
        return existing[0].html_url;
      }
    }

    // Push branch first
    await this.pushBranch(subaccountId, opts.branch);

    // Create new PR
    const createRes = await githubFetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/pulls`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: opts.title,
          body: opts.description,
          head: opts.branch,
          base: baseBranch,
        }),
      }
    );

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => createRes.statusText);
      throw {
        errorCode: 'execution_failure',
        message: `Failed to create GitHub PR: ${errText}`,
      };
    }

    const pr = await createRes.json() as { html_url: string };
    return pr.html_url;
  },

  /**
   * Get or create the agent branch for a task.
   * When reuseBranchPerTask is true, all patches for a task accumulate on one branch.
   */
  async getOrCreateTaskBranch(subaccountId: string, taskSlug: string): Promise<string> {
    const { context } = await devContextService.getContext(subaccountId);
    const branchName = `${context.gitConfig.branchPrefix}${taskSlug}`;

    if (context.gitConfig.reuseBranchPerTask) {
      // Check if branch already exists
      const existing = await git(['branch', '--list', branchName], context.projectRoot).catch(() => '');
      if (existing.includes(branchName)) {
        await this.checkoutBranch(subaccountId, branchName);
        return branchName;
      }
    }

    await this.createBranch(subaccountId, branchName);
    return branchName;
  },
};
