/**
 * GitHub App Webhook handler
 *
 * Receives events from GitHub (issues.opened, issue_comment.created, etc.)
 * and creates tasks on the relevant subaccount board.
 *
 * GitHub sends: POST /api/webhooks/github
 *   Headers: x-github-event, x-hub-signature-256, x-github-delivery
 *   Body: event payload (JSON)
 *
 * Security: HMAC-SHA256 signature verified against GITHUB_APP_WEBHOOK_SECRET.
 * Route is intentionally unauthenticated (GitHub cannot provide a JWT).
 */

import { Router } from 'express';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { integrationConnections, subaccounts } from '../db/schema/index.js';
import { taskService } from '../services/taskService.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { recordIncident } from '../services/incidentIngestor.js';

const router = Router();

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifyGitHubSignature(body: Buffer, signature: string | undefined): boolean {
  const secret = env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) {
    // If no secret configured, skip verification (dev only)
    logger.warn('github_webhook.no_secret_configured');
    return true;
  }
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resolve subaccount from GitHub installation_id
// ---------------------------------------------------------------------------

async function resolveSubaccountFromInstallation(
  installationId: number
): Promise<{ subaccountId: string; organisationId: string } | null> {
  // integrationConnections stores installation_id in configJson
  const connections = await db
    .select({
      subaccountId: integrationConnections.subaccountId,
      organisationId: integrationConnections.organisationId,
      configJson: integrationConnections.configJson,
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.providerType, 'github'));

  for (const conn of connections) {
    const cfg = conn.configJson as { installationId?: number } | null;
    if (cfg?.installationId === installationId) {
      return { subaccountId: conn.subaccountId!, organisationId: conn.organisationId };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/github
// ---------------------------------------------------------------------------

// Express raw body middleware is needed for HMAC verification.
// We use express.raw in the route; the global JSON parser runs first
// so we store the raw body on the request via a custom middleware.

router.post('/api/webhooks/github', (req, res, next) => {
  // Collect raw body for HMAC check
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    (req as any).rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
}, async (req, res) => {
  const event = req.headers['x-github-event'] as string | undefined;
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const delivery = req.headers['x-github-delivery'] as string | undefined;

  const rawBody: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));

  // 1. Verify signature
  if (!verifyGitHubSignature(rawBody, signature)) {
    logger.warn('github_webhook.signature_failed', { delivery });
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // Always ack quickly
  res.status(200).json({ received: true, event, delivery });

  // 2. Route to event handler (fire-and-forget after ack)
  try {
    if (event === 'issues') {
      await handleIssueEvent(payload);
    } else if (event === 'issue_comment') {
      await handleIssueCommentEvent(payload);
    }
    // ping, installation, push etc. are silently ignored
  } catch (err) {
    logger.error('github_webhook.handler_error', { event, delivery, error: err instanceof Error ? err.message : String(err) });

    // The response was already sent at line 112 (early-ack pattern). This
    // emission is purely for observability — it never affects the response.
    recordIncident({
      source: 'route',
      summary: `GitHub webhook handler failed for event ${event}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      errorCode: 'webhook_handler_failed',
      stack: err instanceof Error ? err.stack : undefined,
      fingerprintOverride: 'webhook:github:handler_failed',
      errorDetail: { event, delivery },
    });
  }
});

// ---------------------------------------------------------------------------
// issues event — action: opened | edited | labeled | closed | reopened
// ---------------------------------------------------------------------------

async function handleIssueEvent(payload: Record<string, any>) {
  const action = payload.action as string;
  const issue = payload.issue as Record<string, any>;
  const installation = payload.installation as { id: number } | undefined;

  if (!installation) {
    logger.warn('github_webhook.missing_installation', { event: 'issues' });
    return;
  }

  const context = await resolveSubaccountFromInstallation(installation.id);
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

    await taskService.createTask(
      context.organisationId,
      context.subaccountId,
      {
        title,
        description,
        status: 'inbox',
        priority,
      }
    );

    logger.info('github_webhook.task_created', { issueNumber: issue.number, repo });
  }

  if (action === 'closed') {
    // Future: auto-move the matching task to 'done'. Skip for now.
    logger.info('github_webhook.issue_closed', { issueNumber: issue.number, repo });
  }
}

// ---------------------------------------------------------------------------
// issue_comment event — action: created
// ---------------------------------------------------------------------------

async function handleIssueCommentEvent(payload: Record<string, any>) {
  const action = payload.action as string;
  if (action !== 'created') return;

  const issue = payload.issue as Record<string, any>;
  const comment = payload.comment as Record<string, any>;
  const installation = payload.installation as { id: number } | undefined;

  if (!installation) return;

  // Only act on comments that @mention the bot or contain trigger keywords
  const body = (comment.body as string) ?? '';
  if (!body.includes('/task') && !body.includes('@synthetos')) return;

  const context = await resolveSubaccountFromInstallation(installation.id);
  if (!context) return;

  const repo = (payload.repository as Record<string, any>)?.full_name ?? 'unknown/repo';

  // Strip the trigger keyword and use the rest as the task title
  const taskTitle = body.replace(/\/task\s*/, '').replace(/@synthetos\s*/, '').trim().split('\n')[0];
  if (!taskTitle) return;

  await taskService.createTask(
    context.organisationId,
    context.subaccountId,
    {
      title: `[GitHub] ${taskTitle}`,
      description: `Created from comment on issue #${issue.number} in ${repo}\n\n${body}\n\n[View comment](${comment.html_url})`,
      status: 'inbox',
      priority: 'normal',
    }
  );

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

export default router;
