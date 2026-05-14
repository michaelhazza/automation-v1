# PR Review Log — support-desk-canonical (round 1)

**Reviewed:** 2026-05-09T21:41:38Z
**Branch:** `claude/support-ticket-structure-xMcy8` @ `62f9a28e`
**Spec:** `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`
**Reviewer:** pr-reviewer (independent, read-only)
**Verdict:** CHANGES_REQUESTED (5 blocking, 5 strong, 3 non-blocking)

---

## Blocking Issues

**B1. `InboxConfigPage` posts an `agentConfig` shape the Zod schema rejects — Save is non-functional.** `client/src/pages/support/InboxConfigPage.tsx:1-191`. UI sends `{ mode: 'disabled'|'draft_only'|'auto_send', collisionDetectionEnabled?, draftExpiryHours? }` but `SupportInboxAgentConfigSchema` requires `{ version: 1, mode: 'autonomous'|'assisted'|'disabled', collisionWindow: {...}, draftExpiry: {...}, optIns: {...} }`. Every save 422-fails. Fix: rewrite controls to match canonical schema; pre-load from `inbox.agentConfig`.

**B2. `support.set_status` sends canonical statuses straight to Teamwork — outbound mapping missing.** `server/services/supportTicketService.ts:288-309` + `server/adapters/teamworkAdapter.ts:224-250`. `applyStatusChange` passes `{ status: newStatus }` directly. `TEAMWORK_SUPPORT_STATUS_MAP` is inbound-only. Provider receives canonical strings (`'pending_internal'` etc.) instead of provider-native (`'on hold'`, `'waiting on customer'`). Fix: add `TEAMWORK_OUTBOUND_STATUS_MAP` co-located with the inbound map; translate inside `teamworkAdapter.ts::updateTicket` or in `applyStatusChange` before the adapter call.

**B3. `support.assign` cannot unassign — `null` collapses to a no-op at the adapter.** `server/services/supportTicketService.ts:315-334` + `server/adapters/teamworkAdapter.ts:237`. Service passes `assignedTo: assigneeAgentExternalId ?? undefined`; adapter guards with `if (fields.assignedTo)`. `null` becomes `undefined`, field omitted, Teamwork never told to clear. Fix: widen `TicketUpdateInput.assignedTo` to `string | null`, send unconditionally on unassign intent.

**B4. `TicketsListPage` reads two server fields that don't exist.** `client/src/pages/support/TicketsListPage.tsx:7-17, 174-176`. UI declares `Ticket.lastActivityAt` and `Ticket.assigneeExternalId`, but route returns raw `canonicalTickets.$inferSelect` with `lastCustomerMessageAt`/`lastAgentMessageAt`/`assigneeAgentId`. "Last activity" always renders `-`; assignee never displays. Fix: server-side DTO mapper in `listOpenTickets` that emits `lastActivityAt = max(lastCustomerMessageAt, lastAgentMessageAt) ?? openedAt` and resolves `assigneeExternalId` via join to `canonical_support_agents.externalId`.

**B5. `TicketDetailPage` reads `msg.body` but server returns `msg.bodyText`.** `client/src/pages/support/TicketDetailPage.tsx:29-37, 123-131`. `readThreadForHumanUi` returns raw `CanonicalTicketMessage[]` with `bodyText`. UI also references `authorName` which doesn't exist as a column. Every message body renders empty; author falls back to "Agent" or "Customer". Fix: reshape `readThreadForHumanUi` (and `readThreadForAgent`) to emit `{ id, direction, visibility, body, authorName, createdAtExternal, attachments }` with `authorName` resolved via `authorContactId`/`authorSupportAgentId` joins.

---

## Strong Recommendations

**S1. Reconciliation worker UPDATE lacks `status = 'needs_reconciliation'` guard.** `server/jobs/supportDraftReconciliationWorker.ts:100-108, 119-125`. Concurrent webhook back-link or boot recovery flipping the same draft to `sent` between worker load (line 34) and write can be overwritten. Fix: add `WHERE id = ${draftId} AND status = 'needs_reconciliation'` to both UPDATEs.

**S2. `support.find_customer_history` does direct DB access in `skillExecutor.ts`.** `server/services/skillExecutor.ts:2298-2341`. Other 9 support skills delegate to services. Fix: move into `findCustomerHistory(email, principalCtx)` export in `supportTicketService.ts`.

**S3. `decideOutcome` returns `messageData` but the worker re-greps the message list.** `server/services/supportDraftReconciliationPure.ts:71-78` + `server/jobs/supportDraftReconciliationWorker.ts:75-98`. Two divergent matchers — future change to matching rule will silently regress. Fix: include `messageId` in pure decision and have worker read it.

**S4. Architecture.md references three Teamwork files that don't exist.** `architecture.md:3543-3547, 3665-3666` cites `teamworkSupportIngestAdapter.ts`, `teamworkSupportWebhookHandler.ts`, `teamworkProviderRegistration.ts`. Actual locations: `connectorPollingService.ts`, `webhookAdapterService.ts`. Doc-sync gap.

**S5. No tests for boot recovery scan or impure reconciliation worker.** `server/lib/supportDispatchBootRecovery.ts`, `server/jobs/supportDraftReconciliationWorker.ts`. Pure pieces are covered; orchestrating layers are not. Fix: author Vitest test for boot-recovery enqueue-once invariant.

---

## Non-Blocking

**N1.** `TICKET_HUMAN_COLLISION_BLOCKED` logged at `info` (`supportDraftDispatchService.ts:249-258`) — consider `warn`.
**N2.** Adapter `addReply` / `addInternalNote` accept `idempotencyKey` but ignore it (`teamworkAdapter.ts:252-313`) — add inline comment that `action_attempts` is the sole idempotency boundary.
**N3.** `TicketDetailPage.tsx:58, 74-82, 100` — `hasOverrideCollisionPerm` fetched then discarded with `void hasOverrideCollisionPerm`. Either wire up or delete.

---

**Verdict:** CHANGES_REQUESTED (5 blocking, 5 strong, 3 non-blocking)
