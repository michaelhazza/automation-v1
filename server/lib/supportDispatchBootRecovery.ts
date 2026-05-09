// supportDispatchBootRecovery.ts — One-shot startup scan for stalled dispatching drafts.
// Spec: tasks/builds/support-desk-canonical/spec.md §18 (R5 mitigation)
//
// On every server boot, finds canonical_ticket_drafts rows that were left in
// 'dispatching' status by a previous process that crashed before completing
// or transitioning to needs_reconciliation. Any such draft whose
// dispatching_started_at is older than 60 seconds is presumed stalled and
// transitioned to needs_reconciliation, then a reconciliation job is enqueued.
//
// The UPDATE WHERE status='dispatching' is atomic: concurrent restarts cannot
// double-transition the same draft (first-write-wins).

import { db } from '../db/index.js'; // guard-ignore: rls-contract-compliance reason="boot-time cross-tenant admin scan; runs once at startup outside any request ALS context before workers are registered"
import { sql as drizzleSql } from 'drizzle-orm';
import { canonicalTicketDrafts } from '../db/schema/canonicalTicketDrafts.js';
import { getPgBoss } from './pgBossInstance.js';
import { logger } from './logger.js';

const STALLED_THRESHOLD_SECONDS = 60;

export async function runSupportDispatchBootRecovery(): Promise<void> {
  // SELECT all rows stuck in 'dispatching' for more than the threshold.
  // We read them first, then do per-row conditional UPDATEs for idempotency.
  const stalledDrafts = await db
    .select({
      id: canonicalTicketDrafts.id,
      organisationId: canonicalTicketDrafts.organisationId,
    })
    .from(canonicalTicketDrafts)
    .where(
      drizzleSql`${canonicalTicketDrafts.status} = 'dispatching'
        AND ${canonicalTicketDrafts.dispatchingStartedAt} < NOW() - INTERVAL '${drizzleSql.raw(String(STALLED_THRESHOLD_SECONDS))} seconds'`,
    );

  if (stalledDrafts.length === 0) {
    logger.info('support.boot_recovery.dispatching_scan', { recovered: 0 });
    return;
  }

  const boss = await getPgBoss();
  let recovered = 0;

  for (const draft of stalledDrafts) {
    // First-write-wins: only transition if still in 'dispatching'
    const result = await db
      .update(canonicalTicketDrafts)
      .set({
        status: 'needs_reconciliation',
        updatedAt: new Date(),
      })
      .where(
        drizzleSql`${canonicalTicketDrafts.id} = ${draft.id}
          AND ${canonicalTicketDrafts.status} = 'dispatching'`,
      )
      .returning({ id: canonicalTicketDrafts.id });

    if (result.length > 0) {
      // Successfully transitioned — enqueue reconciliation job
      await boss.send(
        'support-draft-reconciliation',
        { organisationId: draft.organisationId, draftId: draft.id },
      );
      recovered++;
    }
  }

  logger.info('support.boot_recovery.dispatching_scan', {
    found: stalledDrafts.length,
    recovered,
  });
}
