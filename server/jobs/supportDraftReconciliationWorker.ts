// supportDraftReconciliationWorker.ts — pg-boss worker for draft reconciliation.
// Spec: tasks/builds/support-desk-canonical/spec.md §8, §11.8, §18 (R5)
//
// Handles the 'support-draft-reconciliation' queue.
// Fired when a canonical_ticket_draft enters needs_reconciliation status.
// Calls decideOutcome and acts on the decision: resolve, surface for manual
// review, or re-enqueue with exponential backoff.

import type PgBoss from 'pg-boss';
import { eq, and, desc } from 'drizzle-orm';
import { createWorker } from '../lib/createWorker.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { decideOutcome } from '../services/supportDraftReconciliationPure.js';
import { canonicalTicketDrafts } from '../db/schema/canonicalTicketDrafts.js';
import { canonicalTicketMessages } from '../db/schema/canonicalTicketMessages.js';
import { logger } from '../lib/logger.js';
import { SUPPORT_LOG_CODES } from '../../shared/types/supportObservability.js';

export interface SupportDraftReconciliationPayload {
  organisationId: string;
  draftId: string;
}

export function registerSupportDraftReconciliationWorker(boss: PgBoss): void {
  createWorker<SupportDraftReconciliationPayload>({
    queue: 'support-draft-reconciliation',
    boss,
    handler: async (job) => {
      const { draftId, organisationId } = job.data;
      const db = getOrgScopedDb('supportDraftReconciliationWorker');

      // 1. Load the draft — idempotent early exit if not found or wrong status.
      // Defence-in-depth: explicit organisationId predicate alongside the
      // org-scoped tx's RLS policy. If a future change relaxes the policy or
      // the GUC is unset, this filter still scopes the read.
      // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
      const [draft] = await db
        .select()
        .from(canonicalTicketDrafts)
        .where(
          and(
            eq(canonicalTicketDrafts.id, draftId),
            eq(canonicalTicketDrafts.organisationId, organisationId),
          ),
        )
        .limit(1);

      if (!draft || draft.status !== 'needs_reconciliation') {
        // Already resolved, failed, or gone — nothing to do
        return;
      }

      // 2. Load recent outbound messages for the draft's ticket (last 20, newest first)
      // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
      const messages = await db
        .select()
        .from(canonicalTicketMessages)
        .where(eq(canonicalTicketMessages.ticketId, draft.ticketId))
        .orderBy(desc(canonicalTicketMessages.createdAtExternal))
        .limit(20);

      // 3. Call decideOutcome (pure function)
      const decision = decideOutcome({
        draft: {
          id: draft.id,
          status: draft.status,
          reconciliationAttemptCount: draft.reconciliationAttemptCount,
          proposedBodyText: draft.proposedBodyText,
          proposedVisibility: draft.proposedVisibility,
          dispatchingStartedAt: draft.dispatchingStartedAt ?? null,
        },
        latestMessages: messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          visibility: m.visibility,
          bodyText: m.bodyText,
          createdAtExternal: m.createdAtExternal,
        })),
        attemptCount: draft.reconciliationAttemptCount,
      });

      // 4. Act on the decision
      const now = new Date();

      switch (decision.kind) {
        case 'resolve_sent': {
          // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
          const sentRows = await db
            .update(canonicalTicketDrafts)
            .set({
              status: 'sent',
              sentMessageId: decision.messageId,
              reconciliationAttemptCount: draft.reconciliationAttemptCount + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(canonicalTicketDrafts.id, draftId),
                eq(canonicalTicketDrafts.status, 'needs_reconciliation'),
              ),
            )
            .returning({ id: canonicalTicketDrafts.id });

          if (sentRows.length === 0) {
            logger.debug('support.draft.reconciliation_cas_miss', { draftId, organisationId });
            break;
          }

          logger.info(SUPPORT_LOG_CODES.DRAFT_SENT, {
            draftId,
            organisationId,
            sentMessageId: decision.messageId,
          });
          break;
        }

        case 'resolve_failed': {
          // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
          const failedRows = await db
            .update(canonicalTicketDrafts)
            .set({
              status: 'failed',
              updatedAt: now,
            })
            .where(
              and(
                eq(canonicalTicketDrafts.id, draftId),
                eq(canonicalTicketDrafts.status, 'needs_reconciliation'),
              ),
            )
            .returning({ id: canonicalTicketDrafts.id });

          if (failedRows.length === 0) {
            logger.debug('support.draft.reconciliation_cas_miss', { draftId, organisationId });
            break;
          }

          logger.warn(SUPPORT_LOG_CODES.DRAFT_FAILED, {
            draftId,
            organisationId,
            reason: decision.reason,
          });
          break;
        }

        case 'surface_manual': {
          // Do NOT change status — operator surface handles it.
          // Increment attempt count and record the reconciliation timestamp.
          // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
          await db
            .update(canonicalTicketDrafts)
            .set({
              reconciliationAttemptCount: draft.reconciliationAttemptCount + 1,
              lastReconciliationAt: now,
              updatedAt: now,
            })
            .where(eq(canonicalTicketDrafts.id, draftId));

          logger.warn('support.draft.reconciliation_surfaced_manual', {
            draftId,
            organisationId,
            reason: decision.reason,
          });
          break;
        }

        case 'retry_after_ms': {
          // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
          await db
            .update(canonicalTicketDrafts)
            .set({
              reconciliationAttemptCount: draft.reconciliationAttemptCount + 1,
              lastReconciliationAt: now,
              updatedAt: now,
            })
            .where(eq(canonicalTicketDrafts.id, draftId));

          const pgBoss = await getPgBoss();
          await pgBoss.send(
            'support-draft-reconciliation',
            { organisationId, draftId },
            { startAfter: new Date(Date.now() + decision.ms) },
          );
          break;
        }
      }
    },
  });
}
