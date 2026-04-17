import type { FeatureRequest } from '../db/schema/featureRequests.js';
import { systemSettingsService, SETTING_KEYS } from './systemSettingsService.js';
import { env } from '../lib/env.js';

// ---------------------------------------------------------------------------
// Feature Request Notification Service
//
// Delivers a filed feature request across three channels: Slack, email, and
// a task in the Synthetos-internal subaccount. All three are best-effort —
// the durable record is always the feature_requests row.
//
// See docs/orchestrator-capability-routing-spec.md §5.3, §5.3.1, §5.6.
//
// Slack delivery uses an incoming webhook configured via the env var
// SYNTHETOS_INTERNAL_SLACK_WEBHOOK (optional). This keeps the dependency
// surface tiny — no direct coupling to the OAuth-based Slack integration,
// which is meant for tenant traffic rather than internal Synthetos ops.
// ---------------------------------------------------------------------------

export type ChannelStatus = 'sent' | 'created' | 'skipped' | 'failed';

export interface ChannelResult {
  status: ChannelStatus;
  detail?: string;
}

export interface SynthetosTaskResult extends ChannelResult {
  task_id?: string;
}

export interface NotificationResult {
  slack: ChannelResult;
  email: ChannelResult;
  synthetos_task: SynthetosTaskResult;
}

export interface NotificationContext {
  orgName: string;
  subaccountName: string | null;
  userEmail: string;
  userDisplayName: string | null;
}

export function buildNotificationBody(req: FeatureRequest, ctx: NotificationContext): string {
  const lines: string[] = [];
  lines.push(`[Feature Request] ${req.summary}`);
  lines.push('');
  lines.push(`Category: ${req.category}`);
  lines.push(`Org: ${ctx.orgName}${ctx.subaccountName ? ` | Subaccount: ${ctx.subaccountName}` : ''}`);
  lines.push(`User: ${ctx.userDisplayName ? `${ctx.userDisplayName} <${ctx.userEmail}>` : ctx.userEmail}`);
  if (req.sourceTaskId) lines.push(`Source task: ${req.sourceTaskId}`);
  lines.push('');
  lines.push('User intent (verbatim):');
  lines.push(req.userIntent);
  lines.push('');
  const reqCaps = Array.isArray(req.requiredCapabilities) ? req.requiredCapabilities : [];
  const missCaps = Array.isArray(req.missingCapabilities) ? req.missingCapabilities : [];
  lines.push(`Required capabilities: ${reqCaps.map((c) => `${c.kind}:${c.slug}`).join(', ')}`);
  lines.push(`Missing: ${missCaps.map((c) => `${c.kind}:${c.slug}`).join(', ')}`);
  if (req.orchestratorReasoning) {
    lines.push('');
    lines.push('Orchestrator reasoning:');
    lines.push(req.orchestratorReasoning);
  }
  lines.push('');
  lines.push(`Feature request ID: ${req.id}`);
  lines.push(`Dedupe group count: ${req.dedupeGroupCount}`);
  return lines.join('\n');
}

async function sendSlack(req: FeatureRequest, ctx: NotificationContext): Promise<ChannelResult> {
  const webhookUrl = (env as unknown as Record<string, string | undefined>).SYNTHETOS_INTERNAL_SLACK_WEBHOOK;
  const channelSetting = await systemSettingsService.get(SETTING_KEYS.FEATURE_REQUEST_SLACK_CHANNEL);
  if (!webhookUrl && !channelSetting) {
    return { status: 'skipped', detail: 'Neither SYNTHETOS_INTERNAL_SLACK_WEBHOOK env nor feature_request_slack_channel setting configured' };
  }
  if (!webhookUrl) {
    return { status: 'skipped', detail: 'feature_request_slack_channel set but SYNTHETOS_INTERNAL_SLACK_WEBHOOK env not configured' };
  }

  try {
    const body = buildNotificationBody(req, ctx);
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: body,
        ...(channelSetting ? { channel: channelSetting } : {}),
      }),
    });
    if (!resp.ok) {
      return { status: 'failed', detail: `Slack webhook returned ${resp.status}` };
    }
    return { status: 'sent' };
  } catch (err) {
    return { status: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

async function sendEmail(req: FeatureRequest, ctx: NotificationContext): Promise<ChannelResult> {
  const to = await systemSettingsService.get(SETTING_KEYS.FEATURE_REQUEST_EMAIL_ADDRESS);
  if (!to) return { status: 'skipped', detail: 'feature_request_email_address not configured' };

  // Reuse the existing email service via a thin wrapper. Feature requests
  // are internal ops mail, not branded customer mail, so we post via the
  // default transport with the rendered body as text/plain.
  try {
    const { emailService } = await import('./emailService.js');
    await emailService.sendGenericEmail(to, `[${req.category}] ${req.summary}`, buildNotificationBody(req, ctx));
    return { status: 'sent' };
  } catch (err) {
    // Missing transport or runtime failure — swallow; the row is still written.
    const detail = err instanceof Error ? err.message : String(err);
    return { status: 'failed', detail };
  }
}

async function createSynthetosTask(
  req: FeatureRequest,
  ctx: NotificationContext,
  orchestratorAgentId: string | null,
): Promise<SynthetosTaskResult> {
  const subaccountId = await systemSettingsService.get(SETTING_KEYS.SYNTHETOS_INTERNAL_SUBACCOUNT_ID);
  if (!subaccountId) return { status: 'skipped', detail: 'synthetos_internal_subaccount_id not configured' };

  // This is a cross-org system operation — the Synthetos internal subaccount
  // belongs to the Synthetos ops org, which is different from the caller's
  // org. The lookup + insert must bypass RLS via withAdminConnection (see
  // server/lib/adminDbConnection.ts).
  try {
    const { withAdminConnection } = await import('../lib/adminDbConnection.js');
    const { tasks, subaccounts } = await import('../db/schema/index.js');
    const { eq, sql } = await import('drizzle-orm');

    return await withAdminConnection(
      { source: 'featureRequestNotificationService.createSynthetosTask', reason: 'cross-org feature request signal task creation' },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        // guard-ignore-next-line: org-scoped-writes reason="cross-org admin-bypass lookup: synthetos_internal_subaccount_id is a system-wide setting pointing to the Synthetos ops org's internal subaccount, not the caller's org. Running under admin_role to satisfy RLS."
        const [sa] = await tx.select().from(subaccounts).where(eq(subaccounts.id, subaccountId));
        if (!sa) {
          return {
            status: 'failed' as const,
            detail: `synthetos_internal_subaccount_id '${subaccountId}' does not reference an existing subaccount`,
          };
        }

        const body = buildNotificationBody(req, ctx);
        const [inserted] = await tx
          .insert(tasks)
          .values({
            organisationId: sa.organisationId,
            subaccountId: sa.id,
            title: `[${req.category}] ${req.summary}`,
            description: body,
            status: 'inbox',
            priority: req.category === 'system_promotion_candidate' ? 'normal' : 'low',
            assignedAgentId: null,
            // createdByAgentId set to the Orchestrator so the org_task_created
            // trigger handler (§7.3) drops the event — feature request tasks
            // are not auto-routed, a human reviews first.
            createdByAgentId: orchestratorAgentId ?? undefined,
          })
          .returning({ id: tasks.id });

        return { status: 'created' as const, task_id: inserted?.id };
      },
    );
  } catch (err) {
    return { status: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function dispatchFeatureRequestNotifications(
  req: FeatureRequest,
  ctx: NotificationContext,
  orchestratorAgentId: string | null,
): Promise<NotificationResult> {
  const [slack, email, synthetosTask] = await Promise.all([
    sendSlack(req, ctx),
    sendEmail(req, ctx),
    createSynthetosTask(req, ctx, orchestratorAgentId),
  ]);
  return { slack, email, synthetos_task: synthetosTask };
}
