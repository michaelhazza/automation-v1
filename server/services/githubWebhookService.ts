import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { taskService } from './taskService.js';
import { integrationConnectionService } from './integrationConnectionService.js';
import { logger } from '../lib/logger.js';
import { withOrgTx } from '../instrumentation.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';

// ---------------------------------------------------------------------------
// issues event — action: opened | edited | labeled | closed | reopened
// ---------------------------------------------------------------------------

export async function handleGitHubIssueEvent(payload: Record<string, any>): Promise<void> {
  const action = payload.action as string;
  const issue = payload.issue as Record<string, any>;
  const installation = payload.installation as { id: number } | undefined;

  if (!installation) {
    logger.warn('github_webhook.missing_installation', { event: 'issues' });
    return;
  }

  const context = await integrationConnectionService.resolveSubaccountFromGitHubInstallation(installation.id);
  if (!context) {
    logger.warn('github_webhook.no_subaccount', { installationId: installation.id });
    return;
  }

  const repo = (payload.repository as Record<string, any>)?.full_name ?? 'unknown/repo';

  if (action === 'opened') {
    const labels: string[] = ((issue.labels as any[]) ?? []).map((l: any) => l.name as string);
    const priority = labelsToPriority(labels);

    const title = `[GitHub] ${issue.title}`;
    const description = buildIssueDescription(issue, repo);

    // Unauthenticated path: manually open a db.transaction, set the org GUC,
    // then enter withOrgTx so getOrgScopedDb resolves correctly. This is the
    // same pattern used by agentObservationsPruneJob and correctionPatternDetectorJob
    // for non-HTTP write paths where auth middleware is not available.
    // PTH-CGT-R5-F1: defer task-created side effects until after the tx commits
    // so observers never see events for rolled-back rows.
    const taskInput = {
      organisationId: context.organisationId,
      subaccountId: context.subaccountId,
      data: { title, description, status: 'inbox' as const, priority },
    };
    const task = await db.transaction(async (innerTx) => {
      await innerTx.execute(sql`SELECT set_config('app.organisation_id', ${context.organisationId}, true)`);
      return withOrgTx(
        { tx: innerTx, organisationId: context.organisationId, source: 'service:githubWebhook.issue-opened' },
        async () => {
          const tx = getOrgScopedDb('service:githubWebhook.issue-opened');
          return taskService.createTaskCore(taskInput, tx);
        },
      );
    });

    taskService.emitCreateTaskSideEffects(task, taskInput);

    logger.info('github_webhook.task_created', { issueNumber: issue.number, repo });
  }

  if (action === 'closed') {
    logger.info('github_webhook.issue_closed', { issueNumber: issue.number, repo });
  }
}

// ---------------------------------------------------------------------------
// issue_comment event — action: created
// ---------------------------------------------------------------------------

export async function handleGitHubIssueCommentEvent(payload: Record<string, any>): Promise<void> {
  const action = payload.action as string;
  if (action !== 'created') return;

  const issue = payload.issue as Record<string, any>;
  const comment = payload.comment as Record<string, any>;
  const installation = payload.installation as { id: number } | undefined;

  if (!installation) return;

  const body = (comment.body as string) ?? '';
  if (!body.includes('/task') && !body.includes('@synthetos')) return;

  const context = await integrationConnectionService.resolveSubaccountFromGitHubInstallation(installation.id);
  if (!context) return;

  const repo = (payload.repository as Record<string, any>)?.full_name ?? 'unknown/repo';

  const taskTitle = body.replace(/\/task\s*/, '').replace(/@synthetos\s*/, '').trim().split('\n')[0];
  if (!taskTitle) return;

  // Unauthenticated path: same pattern as handleGitHubIssueEvent above.
  // PTH-CGT-R5-F1: defer task-created side effects until after the tx commits.
  const taskInput = {
    organisationId: context.organisationId,
    subaccountId: context.subaccountId,
    data: {
      title: `[GitHub] ${taskTitle}`,
      description: `Created from comment on issue #${issue.number} in ${repo}\n\n${body}\n\n[View comment](${comment.html_url})`,
      status: 'inbox' as const,
      priority: 'normal' as const,
    },
  };
  const task = await db.transaction(async (innerTx) => {
    await innerTx.execute(sql`SELECT set_config('app.organisation_id', ${context.organisationId}, true)`);
    return withOrgTx(
      { tx: innerTx, organisationId: context.organisationId, source: 'service:githubWebhook.issue-comment' },
      async () => {
        const tx = getOrgScopedDb('service:githubWebhook.issue-comment');
        return taskService.createTaskCore(taskInput, tx);
      },
    );
  });

  taskService.emitCreateTaskSideEffects(task, taskInput);

  logger.info('github_webhook.task_from_comment', { issueNumber: issue.number, repo });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function labelsToPriority(labels: string[]): 'low' | 'normal' | 'high' | 'urgent' {
  if (labels.some(l => ['urgent', 'critical', 'blocker', 'p0'].includes(l.toLowerCase()))) return 'urgent';
  if (labels.some(l => ['high', 'priority', 'p1'].includes(l.toLowerCase()))) return 'high';
  if (labels.some(l => ['low', 'p3', 'nice-to-have'].includes(l.toLowerCase()))) return 'low';
  return 'normal';
}

function buildIssueDescription(issue: Record<string, any>, repo: string): string {
  const lines: string[] = [
    `**GitHub Issue #${issue.number}** in \`${repo}\``,
    `**Author:** ${issue.user?.login ?? 'unknown'}`,
    `**URL:** ${issue.html_url}`,
  ];

  const labels: string[] = ((issue.labels as any[]) ?? []).map((l: any) => l.name as string);
  if (labels.length > 0) {
    lines.push(`**Labels:** ${labels.join(', ')}`);
  }

  if (issue.body) {
    lines.push('', '---', '', issue.body);
  }

  return lines.join('\n');
}
