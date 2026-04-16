/**
 * portfolioRollupService — agency-level cross-client rollups (§11 S23)
 *
 * Two artefact types:
 *   - Portfolio Briefing (Mon morning) — cross-client forward-looking summary
 *   - Portfolio Digest   (Fri evening) — cross-client backward-looking summary
 *
 * Both deliver via `deliveryService.deliver(artefact, config, orgSubaccountId)`
 * — the same enforcement boundary used by every other playbook delivery. The
 * org subaccount is located via `isOrgSubaccount=true AND organisationId=?`
 * (unique per org).
 *
 * Auto-enable threshold: orgs with ≥ 3 subaccounts are opted-in by default;
 * below threshold, the rollup requires explicit opt-in.
 *
 * Invariant: this service NEVER emits artefacts to non-org subaccount inboxes.
 * Cross-tenant leakage is prevented by scoping every DB query to
 * `organisationId = input.orgId`.
 *
 * Spec: docs/memory-and-briefings-spec.md §11 (S23)
 */

import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  subaccounts,
  playbookRuns,
  memoryReviewQueue,
} from '../db/schema/index.js';
import { deliveryService, type DeliveryChannelConfig } from './deliveryService.js';
import { logger } from '../lib/logger.js';

export const PORTFOLIO_AUTO_ENABLE_THRESHOLD = 3;

export type RollupKind = 'briefing' | 'digest';

export interface RunRollupInput {
  organisationId: string;
  kind: RollupKind;
  /** Delivery config for the org subaccount inbox (inbox always-on regardless). */
  deliveryConfig?: DeliveryChannelConfig;
  /** Explicit opt-in flag for orgs below the auto-enable threshold. */
  forceOptIn?: boolean;
}

export interface RunRollupResult {
  /** Inbox task ID (null if skipped due to opt-out / below threshold). */
  taskId: string | null;
  /** Human-readable reason when taskId is null. */
  skippedReason?: string;
  /** Number of subaccounts aggregated. */
  subaccountCount: number;
  /** Title of the delivered artefact. */
  title?: string;
}

export async function runPortfolioRollup(input: RunRollupInput): Promise<RunRollupResult> {
  // 1. Gather subaccounts in scope
  const subs = await db
    .select({
      id: subaccounts.id,
      name: subaccounts.name,
      isOrgSubaccount: subaccounts.isOrgSubaccount,
    })
    .from(subaccounts)
    .where(
      and(
        eq(subaccounts.organisationId, input.organisationId),
        isNull(subaccounts.deletedAt),
      ),
    );

  const clientSubs = subs.filter((s) => !s.isOrgSubaccount);
  const orgSub = subs.find((s) => s.isOrgSubaccount);

  if (!orgSub) {
    return {
      taskId: null,
      skippedReason: 'Org subaccount not found — cannot deliver rollup',
      subaccountCount: 0,
    };
  }

  // 2. Auto-enable threshold check
  if (clientSubs.length < PORTFOLIO_AUTO_ENABLE_THRESHOLD && !input.forceOptIn) {
    return {
      taskId: null,
      skippedReason: `subaccount count ${clientSubs.length} below auto-enable threshold ${PORTFOLIO_AUTO_ENABLE_THRESHOLD}`,
      subaccountCount: clientSubs.length,
    };
  }

  // 3. Aggregate per-subaccount data (past 7 days)
  const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const slug = input.kind === 'briefing' ? 'intelligence-briefing' : 'weekly-digest';

  const rollupRows: Array<{
    subaccountId: string;
    name: string;
    latestRunAt: Date | null;
    status: string | null;
  }> = [];

  for (const sub of clientSubs) {
    const [run] = await db
      .select({
        id: playbookRuns.id,
        completedAt: playbookRuns.completedAt,
        status: playbookRuns.status,
      })
      .from(playbookRuns)
      .where(
        and(
          eq(playbookRuns.subaccountId, sub.id),
          eq(playbookRuns.organisationId, input.organisationId),
          eq(playbookRuns.playbookSlug, slug),
          gte(playbookRuns.createdAt, windowStart),
        ),
      )
      .orderBy(desc(playbookRuns.createdAt))
      .limit(1);

    rollupRows.push({
      subaccountId: sub.id,
      name: sub.name ?? 'Unnamed',
      latestRunAt: run?.completedAt ?? null,
      status: run?.status ?? 'no_run',
    });
  }

  // 4. Aggregate org-wide review queue counts
  const queueRows = await db
    .select({
      subaccountId: memoryReviewQueue.subaccountId,
      status: memoryReviewQueue.status,
      itemType: memoryReviewQueue.itemType,
    })
    .from(memoryReviewQueue)
    .where(
      and(
        eq(memoryReviewQueue.organisationId, input.organisationId),
        gte(memoryReviewQueue.createdAt, windowStart),
      ),
    );

  const queuePending = queueRows.filter((r) => r.status === 'pending').length;
  const queueAutoApplied = queueRows.filter((r) => r.status === 'auto_applied').length;
  const queueRejected = queueRows.filter((r) => r.status === 'rejected').length;

  // 5. Draft the rollup artefact (structured markdown)
  const title = input.kind === 'briefing'
    ? `Portfolio Briefing — ${new Date().toLocaleDateString()}`
    : `Portfolio Digest — ${new Date().toLocaleDateString()}`;

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`Covering ${clientSubs.length} client subaccount${clientSubs.length === 1 ? '' : 's'}`);
  lines.push('');

  if (input.kind === 'briefing') {
    lines.push('## Portfolio health overview');
  } else {
    lines.push('## Week in numbers');
  }
  const completed = rollupRows.filter((r) => r.status === 'completed').length;
  const failed = rollupRows.filter((r) => r.status === 'failed').length;
  const missing = rollupRows.filter((r) => r.status === 'no_run').length;
  lines.push(`- ${completed} completed / ${failed} failed / ${missing} no run`);
  lines.push('');

  lines.push('## Client drill-through');
  for (const row of rollupRows) {
    const link = `/admin/subaccounts/${row.subaccountId}`;
    const when = row.latestRunAt ? row.latestRunAt.toISOString().slice(0, 10) : 'no run';
    lines.push(`- [${row.name}](${link}) — ${row.status} (${when})`);
  }
  lines.push('');

  lines.push('## Memory review queue summary');
  lines.push(`- ${queuePending} pending · ${queueAutoApplied} auto-resolved · ${queueRejected} rejected`);
  lines.push('');

  const content = lines.join('\n');

  // 6. Deliver via deliveryService — scoped to the org subaccount only.
  // Cross-tenant leakage guard: the inbox write is targeted at orgSub.id,
  // which we resolved via `isOrgSubaccount=true AND organisationId=input.orgId`.
  const config: DeliveryChannelConfig = input.deliveryConfig ?? {
    email: true,
    portal: false,
    slack: false,
  };

  const result = await deliveryService.deliver(
    {
      title,
      content,
    },
    config,
    orgSub.id,
    input.organisationId,
  );

  logger.info('portfolioRollupService.delivered', {
    organisationId: input.organisationId,
    kind: input.kind,
    taskId: result.taskId,
    subaccountCount: clientSubs.length,
  });

  return {
    taskId: result.taskId,
    subaccountCount: clientSubs.length,
    title,
  };
}
