/**
 * Workflow Studio GitHub PR helper.
 *
 * Spec: tasks/Workflows-spec.md §10.8.6 — the trust boundary.
 *
 * Creates a new branch + commits a single Workflow file + opens a PR
 * against the platform's own repo using the GitHub REST API directly.
 * No local git working tree required.
 *
 * Configuration:
 *   WORKFLOW_STUDIO_GITHUB_TOKEN  — PAT or installation token with repo scope
 *   WORKFLOW_STUDIO_REPO          — owner/repo (defaults to michaelhazza/automation-v1)
 *   WORKFLOW_STUDIO_BASE_BRANCH   — base branch for PRs (defaults to main)
 *
 * If WORKFLOW_STUDIO_GITHUB_TOKEN is unset, throws a structured error
 * explaining how to configure it. The Studio's Save & Open PR endpoint
 * returns this as a 422 to the caller.
 *
 * Why a dedicated helper instead of reusing gitService.createPullRequest:
 * gitService is built around per-subaccount git working trees + per-
 * subaccount integration_connections rows. Workflow Studio writes to the
 * platform's own repo, where the running app's source code lives, so it
 * needs platform-level credentials and operates entirely via the REST API.
 */

import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

export interface CreateWorkflowPrInput {
  /** kebab-case slug — used to derive the filename and the branch name. */
  slug: string;
  /** Full TypeScript file contents (the defineWorkflow(...) call). */
  fileContents: string;
  /** Author identifier for the PR description / audit trail. */
  authorEmail?: string;
  authorName?: string;
}

export interface CreateWorkflowPrResult {
  prUrl: string;
  branch: string;
  commitSha: string;
}

const GITHUB_API = 'https://api.github.com';
const WorkflowS_PATH_PREFIX = 'server/Workflows';

function ghHeaders(): Record<string, string> {
  if (!env.WORKFLOW_STUDIO_GITHUB_TOKEN) {
    throw {
      statusCode: 422,
      message:
        'Workflow Studio is not configured for PR creation. Set WORKFLOW_STUDIO_GITHUB_TOKEN in the environment to enable Save & Open PR.',
      errorCode: 'workflow_studio_pr_disabled',
    };
  }
  return {
    Authorization: `Bearer ${env.WORKFLOW_STUDIO_GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
}

async function ghFetch(
  path: string,
  init: { method?: string; body?: unknown }
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: ghHeaders(),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return res;
}

async function getDefaultBranchSha(repo: string, branch: string): Promise<string> {
  const res = await ghFetch(`/repos/${repo}/git/ref/heads/${branch}`, {});
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw {
      statusCode: 502,
      message: `GitHub API error fetching base branch: ${text}`,
    };
  }
  const data = (await res.json()) as { object: { sha: string } };
  return data.object.sha;
}

async function createBranch(
  repo: string,
  branchName: string,
  sha: string
): Promise<void> {
  const res = await ghFetch(`/repos/${repo}/git/refs`, {
    method: 'POST',
    body: {
      ref: `refs/heads/${branchName}`,
      sha,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw {
      statusCode: 502,
      message: `GitHub API error creating branch: ${text}`,
    };
  }
}

async function createOrUpdateFile(
  repo: string,
  branchName: string,
  filePath: string,
  contents: string,
  message: string,
  author?: { name: string; email: string }
): Promise<{ commitSha: string }> {
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(contents, 'utf8').toString('base64'),
    branch: branchName,
  };
  if (author) {
    body.author = author;
    body.committer = author;
  }
  const res = await ghFetch(`/repos/${repo}/contents/${filePath}`, {
    method: 'PUT',
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw {
      statusCode: 502,
      message: `GitHub API error writing file: ${text}`,
    };
  }
  const data = (await res.json()) as { commit: { sha: string } };
  return { commitSha: data.commit.sha };
}

async function openPr(
  repo: string,
  title: string,
  body: string,
  branch: string,
  baseBranch: string
): Promise<{ prUrl: string }> {
  const res = await ghFetch(`/repos/${repo}/pulls`, {
    method: 'POST',
    body: { title, body, head: branch, base: baseBranch },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw {
      statusCode: 502,
      message: `GitHub API error opening PR: ${text}`,
    };
  }
  const data = (await res.json()) as { html_url: string };
  return { prUrl: data.html_url };
}

/**
 * Creates a new branch + commits the Workflow file + opens a PR. Idempotent
 * branch naming: includes a timestamp so re-saving the same session creates
 * a new branch rather than colliding.
 */
export async function createWorkflowPr(
  input: CreateWorkflowPrInput
): Promise<CreateWorkflowPrResult> {
  const repo = env.WORKFLOW_STUDIO_REPO;
  const baseBranch = env.WORKFLOW_STUDIO_BASE_BRANCH;
  const safeSlug = input.slug.replace(/[^a-z0-9_-]/g, '');
  if (!safeSlug) {
    throw { statusCode: 400, message: 'invalid slug for PR' };
  }
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const branchName = `Workflow-studio/${safeSlug}-${ts}`;
  const filePath = `${WorkflowS_PATH_PREFIX}/${safeSlug}.Workflow.ts`;
  const commitMessage = `Workflow Studio: add ${safeSlug}.Workflow.ts`;
  const prTitle = `Workflow Studio: ${safeSlug}`;
  const prBody = [
    `Authored via Workflow Studio.`,
    ``,
    `**File**: \`${filePath}\``,
    `**Branch**: \`${branchName}\``,
    ``,
    `## Reviewer checklist (per spec §10.7)`,
    ``,
    `- [ ] Every step has \`sideEffectType\` declared`,
    `- [ ] \`irreversible\` steps are correctly classified`,
    `- [ ] \`humanReviewRequired\` set on tweakable outputs`,
    `- [ ] \`dependsOn\` graph matches intended flow`,
    `- [ ] Template expressions only reference declared dependencies`,
    `- [ ] \`outputSchema\` is appropriately tight`,
    `- [ ] No secrets, customer data, or hardcoded org-specific values`,
    `- [ ] CI \`npm run Workflows:validate\` passes`,
  ].join('\n');

  logger.info('workflow_studio_pr_creating', { repo, branchName, filePath });

  // 1. Get base branch SHA
  const baseSha = await getDefaultBranchSha(repo, baseBranch);

  // 2. Create new branch from base SHA
  await createBranch(repo, branchName, baseSha);

  // 3. Create the file on the new branch
  const { commitSha } = await createOrUpdateFile(
    repo,
    branchName,
    filePath,
    input.fileContents,
    commitMessage,
    input.authorName && input.authorEmail
      ? { name: input.authorName, email: input.authorEmail }
      : undefined
  );

  // 4. Open the PR
  const { prUrl } = await openPr(repo, prTitle, prBody, branchName, baseBranch);

  logger.info('workflow_studio_pr_created', { prUrl, branch: branchName, commitSha });

  return { prUrl, branch: branchName, commitSha };
}
