# PR Review Log — support-desk-canonical (round 2, post fix-loop)

**Reviewed:** 2026-05-09T22:02:25Z
**Branch:** `claude/support-ticket-structure-xMcy8` @ `f99a99b0` (post fix-loop `f64cd397`)
**Spec:** `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`
**Reviewer:** pr-reviewer (independent, read-only, round 2 of max-3 fix-loop)
**Verdict:** APPROVED (0 blocking, 2 strong carry-overs, 3 non-blocking + 1 minor type drift)

---

## Round-1 Blocker Verification — all 5 CLOSED

| ID | Status | Evidence |
|---|---|---|
| B1 | ✅ Closed | `InboxConfigPage.tsx:38-100` builds `{ version: 1, mode, collisionWindow, draftExpiry, optIns }`; pre-load uses optional-chaining for old-shape rows |
| B2 | ✅ Closed | `teamworkSupportStatusMap.ts:32-45` adds `mapCanonicalToTeamworkStatus`; wired in `teamworkAdapter.ts:236`; round-trip verified by `__tests__/teamworkSupportStatusMap.test.ts:130-139`; throws on `unknown_provider_status` |
| B3 | ✅ Closed | `integrationAdapter.ts:112` widens `assignedTo?: string | null`; `teamworkAdapter.ts:238` checks `!== undefined`; `supportTicketService.ts:472-474` passes through directly |
| B4 | ✅ Closed | `supportTicketService.ts:310-419` returns `SupportTicketListItem[]` with computed `lastActivityAt` and joined `assigneeExternalId`; consumed by `TicketsListPage.tsx:7-17` |
| B5 | ✅ Closed | `supportTicketService.ts:72-181` returns `SupportThreadMessage[]` with `body` (redaction-aware) and `authorName` (LEFT JOIN on contacts/agents); `TicketDetailPage.tsx:123-131` consumes correctly |

## Round-1 Strong — 3 of 5 CLOSED

| ID | Status | Evidence |
|---|---|---|
| S1 | ✅ Closed | `supportDraftReconciliationWorker.ts:86-89, 114-117` adds CAS guard `eq(status, 'needs_reconciliation')` + `.returning({ id })`; CAS-miss logs at debug |
| S3 | ✅ Closed | Pure `decideOutcome` returns `{ kind: 'resolve_sent'; messageId: string }`; worker reads `decision.messageId` directly (no re-grep) |
| S4 | ✅ Closed | `architecture.md:3543-3551, 3665` cite real files; no remaining stale references |
| S2 | Deferred | `support.find_customer_history` still in `skillExecutor.ts` — convention-only |
| S5 | Deferred | Boot-recovery + worker still untested at orchestration layer |

## New Findings This Round

**N4 (non-blocking, minor type drift)** — `client/src/pages/support/TicketDetailPage.tsx:31` declares `Message.direction: 'inbound' | 'outbound'` but server DTO emits `'inbound' | 'outbound' | 'internal_note'`. Practical rendering correct (visibility carries the load-bearing signal, not direction), but interface drift will surface if a future change switches on direction. Fix: widen client interface OR map server `direction` to UI-direction server-side.

## Other Observations (informational, not blocking)

- **Permission-scope inconsistency** — `architecture.md:3574-3578` documents `support.draft.{approve,reject,override_collision}` + `support.inbox.configure` as **subaccount** scope, but `permissions.ts:113-117` defines them under `ORG_PERMISSIONS` and routes use `requireOrgPermission`. Pre-existing, not a regression. Doc-sync gap to surface at finalisation.
- **`shapeThreadMessage` inlines redaction logic** — `supportTicketService.ts:169-170` inlines `row.redacted ? '[redacted]' : row.bodyText` instead of calling `applyMessageRedactionFilterForAudience`. Pure helper now uncalled — could be deleted or kept for `audit` audience. Non-blocking cleanup.

---

**Verdict:** APPROVED (0 blocking)

All 5 round-1 blockers genuinely closed. 3 strong fixes (S1, S3, S4) land cleanly with no regression. DTO reshapes (B4, B5) correctly consumed by UI. Status map round-trip verified by test suite. Fix-loop introduced no new blockers. S2, S5 deferral acknowledged as operator-acceptable.
