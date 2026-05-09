# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`
**Spec commit at check:** `d96fb7288a2e767adb278517a0b1f1055a3ccce7`
**Branch:** `claude/support-ticket-structure-xMcy8`
**Base:** `e43ab01d7625996115fe584e0ffe6180ce8efa64` (merge-base with `origin/main`)
**Scope:** all spec — branch represents the full integrated build; caller (`feature-coordinator` Phase 2 branch-level pass) confirmed C1–C15 done. Per spec §22, OQ-1 deferred via operator override (`SDC-OVERRIDE-1`); OQ-2/3/4/5 closed.
**Changed-code set:** 89 files (`git diff origin/main...HEAD`)
**Run at:** 2026-05-09T20:34:30Z

---

## Contents

1. Summary
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional / ambiguous gaps
5. Files modified by this run
6. Next step

---

## 1. Summary

- Requirements extracted:     58
- PASS:                       50
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 7
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     1 (OQ-1 / SDC-OVERRIDE-1 — operator-deferred)

**Verdict:** NON_CONFORMANT (7 directional gaps — see deferred items routed to `tasks/todo.md`)

The build covers most of the spec's surface area faithfully — five canonical schemas, RLS, adapter contract extensions, status map, polling, webhooks, dispatch state machine, services, skills, UI, ADR, doc-sync. Seven gaps need design judgement before merge:

1. **Critical safety gap — collision-window preflight check missing.** `supportDraftDispatchService.approveDraft` accepts the `overrideCollision` parameter but does not perform the underlying collision check it is supposed to override (§8.1 check #5). The bot can dispatch a reply on top of recent human activity. Spec calls this out as a load-bearing brief invariant (§5.4 + §8.1).
2. **§8.1 preflight checks #4, #6, #7 not implemented** (status eligibility, customer-match, superseded). The preflight typed reasons (`ticket_status_ineligible`, `customer_match_required`, `superseded_by_newer_draft`) named in spec §8.1 never fire from the dispatch path.
3. **§8.6 collision-override audit-event write not implemented.** Spec mandates `auditEvents` row with action `support.draft.collision_override`; no `auditEvents` insert exists in the dispatch service.
4. **§8.6 autonomous-agent guard for `overrideCollision: true` missing.** Spec requires explicit rejection if caller principal has no human user id; no such check is wired.
5. **`action_attempts` ledger ships in migration 0312 but is not wired into the dispatch / adapter path.** Per OQ-3 closure (no native idempotency) the spec §14.1 + plan C7 require the ledger lookup-then-insert flow before each adapter `addReply` / `addInternalNote` call. Without it, a duplicate-customer-reply collision relies solely on `canonical_ticket_drafts.action_idempotency_key` UNIQUE, which protects against re-dispatch of the same draft but not against retry paths that recreate the key shape.
6. **`support.set_status` skill enum is wrong.** `actionRegistry.ts` declares `['open', 'pending_internal', 'waiting_on_customer', 'closed']` — missing `resolved`. `resolved` is a first-class lifecycle state in spec §5.1.A.
7. **`support.find_customer_history` skill returns only contacts + tickets**, not the spec-named multi-table join across `canonical_revenue` and `canonical_accounts` (§9 entry).

A few smaller items were checked and are PASS: the `support.message.redacted` webhook handler is intentionally absent (spec §5.2 acknowledges Teamwork may not expose redaction events; defensive columns + read-side filter ship). `architecture.md` § Canonical Support Desk uses different status-enum names than the canonical layer (`pending/solved/quarantine` vs `pending_internal/resolved/unknown_provider_status`) — flagged as a doc-sync issue and routed.

---

## 2. Requirements extracted (full checklist)

Grouped by spec section; numbering matches the per-chunk plan map. Verdicts: PASS, DIRECTIONAL_GAP, OUT_OF_SCOPE.

### §5.1 `canonical_tickets` schema + RLS (chunk C2)

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| 1 | All identity, customer, lifecycle, routing, collision, classification, SLA, tombstone, common columns per spec §5.1 | PASS | `migrations/0309_canonical_tickets.sql:1-105`, `server/db/schema/canonicalTickets.ts:19-87` |
| 2 | Closed-enum CHECK on `status` covers all six values | PASS | `migrations/0309_canonical_tickets.sql:60-61` |
| 3 | Closed-enum CHECK on `priority` and `source_channel` and `deletion_source` | PASS | `migrations/0309_canonical_tickets.sql:62-67` |
| 4 | Asymmetric tombstone CHECK (`provider_deleted=true ⇔ deletion_source NOT NULL`) | PASS | `migrations/0309_canonical_tickets.sql:68-72` |
| 5 | Indexes per spec §5.1 (UNIQUE, org+inbox+status, org+customer_email, org+last_human_activity_at, partial unknown-status, partial sla_due) | PASS | `migrations/0309_canonical_tickets.sql:75-90` |
| 6 | FORCE-RLS + canonical org-isolation policy | PASS | `migrations/0309_canonical_tickets.sql:92-105` |
| 7 | `RLS_PROTECTED_TABLES` entry | PASS | `server/config/rlsProtectedTables.ts:1171-1173` |

### §5.2 `canonical_ticket_messages` schema + RLS (chunk C3)

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| 8 | Identity / direction / visibility / author / content / redaction / timestamps / `source_draft_id` (no FK in 0310) | PASS | `migrations/0310_canonical_ticket_messages.sql:1-65` |
| 9 | Polymorphic-FK CHECK constraint with the asymmetric customer-NULL-allowed shape | PASS | `migrations/0310_canonical_ticket_messages.sql:59-64` |
| 10 | Three-column UNIQUE `(connector_config_id, ticket_external_id, external_id)` and ordered thread-read index | PASS | `migrations/0310_canonical_ticket_messages.sql:42-43, 67-69` |
| 11 | FORCE-RLS + canonical org-isolation policy + manifest entry | PASS | `migrations/0310_canonical_ticket_messages.sql:71-84`, `server/config/rlsProtectedTables.ts:1178-1180` |

### §5.3 `canonical_inboxes` schema + RLS (chunk C1)

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| 12 | All columns per §5.3, including `agent_config jsonb NOT NULL DEFAULT` with the v1 default shape | PASS | `migrations/0307_canonical_inboxes.sql:1-17` |
| 13 | UNIQUE `(connector_config_id, external_id)` + `(organisation_id, is_active)` | PASS | `migrations/0307_canonical_inboxes.sql:16, 19-20` |
| 14 | FORCE-RLS + manifest entry | PASS | `migrations/0307_canonical_inboxes.sql:22-35`, `server/config/rlsProtectedTables.ts:1159-1161` |
| 15 | `SupportInboxAgentConfig` Zod schema in `shared/types/supportInboxAgentConfig.ts` matches spec shape | PASS | `shared/types/supportInboxAgentConfig.ts:1-22` |

### §5.4 `canonical_support_agents` schema + RLS (chunk C1)

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| 16 | All columns per §5.4 + `agent_kind` CHECK in `('human','bot')` | PASS | `migrations/0308_canonical_support_agents.sql:1-18` |
| 17 | UNIQUE `(connector_config_id, external_id)` + `(organisation_id, agent_kind, is_active)` | PASS | `migrations/0308_canonical_support_agents.sql:16, 20-21` |
| 18 | FORCE-RLS + manifest entry | PASS | `migrations/0308_canonical_support_agents.sql:23-36`, `server/config/rlsProtectedTables.ts:1165-1167` |

### §5.5 `canonical_ticket_drafts` schema + state machine + idempotency UNIQUE + ALTER on messages (chunk C4)

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| 19 | All columns per §5.5 (proposed content, state, three-phase, provenance, review, outbound link, lifecycle) | PASS | `migrations/0311_canonical_ticket_drafts.sql:7-46` |
| 20 | Closed-enum CHECK on `status` covering all 10 values | PASS | `migrations/0311_canonical_ticket_drafts.sql:49-61` |
| 21 | State-invariant CHECKs (`sent ⇒ sent_message_id NOT NULL`, `manually_marked_sent ⇒ sent_message_id NULL`) | PASS | `migrations/0311_canonical_ticket_drafts.sql:67-79` |
| 22 | Partial UNIQUE on `(connector_config_id, action_idempotency_key) WHERE NOT NULL` | PASS | `migrations/0311_canonical_ticket_drafts.sql:92-94` |
| 23 | Partial UNIQUE soft-uniqueness `(organisation_id, ticket_id, created_by_agent_run_id, proposed_visibility) WHERE status IN ('draft','awaiting_review')` | PASS | `migrations/0311_canonical_ticket_drafts.sql:103-105` |
| 24 | Operator-queue partial index on `(awaiting_review, needs_reconciliation, manually_marked_sent)` | PASS | `migrations/0311_canonical_ticket_drafts.sql:87-89` |
| 25 | Expiry-scanner partial index on `(draft, awaiting_review)` | PASS | `migrations/0311_canonical_ticket_drafts.sql:97-99` |
| 26 | FORCE-RLS + manifest entry | PASS | `migrations/0311_canonical_ticket_drafts.sql:108-121`, `server/config/rlsProtectedTables.ts:1185-1187` |
| 27 | Deferred FK + partial index on `canonical_ticket_messages.source_draft_id` shipped via 0311 ALTER | PASS | `migrations/0311_canonical_ticket_drafts.sql:127-133` |
| 28 | `SupportProposedActions` Zod schema with `setStatus` excluding `closed` and `unknown_provider_status` | PASS | `shared/types/supportProposedActions.ts:1-25` |

### §6 Adapter contract extensions (chunk C5 + C6 + C7)

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| 29 | New canonical types in `integrationAdapter.ts` (`CanonicalInboxData`, `CanonicalSupportAgentData`, `CanonicalTicketData`, `CanonicalTicketMessageData`, `SupportCanonicalStatus`, `SupportStatusMap`, `FetchSupportResult`) | PASS | `server/adapters/integrationAdapter.ts:236-316` |
| 30 | `ticketing.addInternalNote` + `ticketing.resolveAttachment` + broadened `addReply` `options` | PASS | `server/adapters/integrationAdapter.ts:386-394`, `server/adapters/teamworkAdapter.ts:284-365` |
| 31 | `ingestion.listInboxes/listSupportAgents/fetchTickets/fetchTicketMessages` | PASS | `server/adapters/integrationAdapter.ts:416-419`, `server/adapters/teamworkAdapter.ts:424-705` |
| 32 | `mapTeamworkEventType` extended with `ticket.assigned` + `ticket.status_changed` | PASS | `server/adapters/teamworkAdapter.ts:174-175` |
| 33 | Status-map fail-closed function + table per §11.2 (16 entries: 6 default Teamwork + historical aliases) | PASS | `server/adapters/teamwork/teamworkSupportStatusMap.ts:1-26`, fixture-tested in `server/adapters/teamwork/__tests__/teamworkSupportStatusMap.test.ts` |

### §7 Ingestion flow — poll + webhook convergence (chunks C6 + C8 + C9)

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| 34 | Polling Phase A→B→C→D wired into `connectorPollingService` with the four method calls and upsert keyed on the right unique indexes | PASS | `server/services/connectorPollingService.ts:335-359, 408-691` |
| 35 | Customer-identity resolution via `supportContactResolutionPure.resolveByEmail` (case-insensitive, whitespace-trimmed, `multiple` returns null) | PASS | `server/services/supportContactResolutionPure.ts:1-46`, used at `connectorPollingService.ts:595-606` |
| 36 | Status-mapping fail-closed application: quarantined value preserved in `external_metadata.provider_status_raw`; `support.status.unknown_provider_status` log code emits | PASS | `server/services/connectorPollingService.ts:583-592` |
| 37 | Full-reconciliation pass entry point with all four preconditions for tombstoning (no incremental tombstoning) | PASS | `server/services/connectorPollingService.ts:849-957` (skips tombstone when preconditions fail) |
| 38 | Webhook dispatcher cases for `ticket.created/updated/reopened/completed/deleted/assigned/status_changed/reply.created/note.created` | PASS | `server/services/webhookAdapterService.ts:545-996` |
| 39 | Back-link routine after successful message insert sets `source_draft_id` + `sent_message_id` + transitions `manually_marked_sent → sent`; emits `support.draft.sent` and `support.draft.backlink_ambiguous` for ambiguous matches | PASS | `server/services/webhookAdapterService.ts:907-993` |

### §8 Three-phase dispatch (chunk C11)

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| 40 | Pure transition guard `isValidDraftStatusTransition` covers all valid + forbidden transitions including post-terminal prohibition | PASS | `server/services/supportDraftDispatchServicePure.ts:43-80` |
| 41 | Pure idempotency-key derivation `deriveActionIdempotencyKey` (deterministic SHA-256 of `(connectorConfigId, ticketId, actionType, draftId)`) | PASS | `server/services/supportDraftDispatchServicePure.ts:91-99` |
| 42 | Pure same-run supersession planner | PASS | `server/services/supportDraftDispatchServicePure.ts:138-149` |
| 43 | `proposeReply` uses supersede-then-insert order in same transaction | PASS | `server/services/supportDraftDispatchService.ts:88-126` |
| 44 | Phase 1 preflight checks 1, 2, 3 (valid pre-state, inbox not disabled, ticket not quarantined) | PASS | `server/services/supportDraftDispatchService.ts:152-195` |
| 45 | Phase 1 preflight checks 4, 5, 6, 7 (status eligibility, collision-window, customer match, superseded check) | DIRECTIONAL_GAP | Not implemented in `server/services/supportDraftDispatchService.ts`. No reference to `lastHumanActivityAt`, `min_minutes`, `superseded_by_newer_draft`, `customer_match_required`, or `support.ticket.human_collision_blocked`. |
| 46 | Phase 2 atomic UPDATE with `WHERE status IN ('draft','awaiting_review')` + first-commit-wins | PASS | `server/services/supportDraftDispatchService.ts:209-236` |
| 47 | Phase 3 adapter call with idempotency key, retryable→`needs_reconciliation`+enqueue worker, terminal→`failed`, sync-confirm→`sent` | PASS | `server/services/supportDraftDispatchService.ts:277-337` |
| 48 | `manualResolveDraft` implements `mark_sent` (→`manually_marked_sent`), `mark_failed` (→`failed`), `retry_reconciliation` (resets count, re-enqueues) | PASS | `server/services/supportDraftDispatchService.ts:422-485` |
| 49 | Manual-collision override audit-event write per §8.6 #2 | DIRECTIONAL_GAP | `server/services/supportDraftDispatchService.ts` does not insert into `auditEvents` for `support.draft.collision_override`. |
| 50 | `overrideCollision: true` rejected for autonomous (no human user id) per §8.6 paragraph 5 | DIRECTIONAL_GAP | `server/services/supportDraftDispatchService.ts:206-207` records `reviewerUserId = null` for non-user principals but does not reject `overrideCollision=true`; the autonomous-only guard is missing. |
| 51 | Reconciliation worker (`supportDraftReconciliationWorker`) registered on `support-draft-reconciliation` queue, calls `decideOutcome`, transitions draft accordingly | PASS | `server/jobs/supportDraftReconciliationWorker.ts:25-176`, `server/index.ts:717-720` |
| 52 | Boot-recovery scan for stalled `dispatching` drafts (>60s) | PASS | `server/lib/supportDispatchBootRecovery.ts:1-71`, `server/index.ts:725-728` |
| 52a | `action_attempts` ledger lookup-then-insert wired into adapter / dispatch path per OQ-3 closure + §14.1 + plan C7 | DIRECTIONAL_GAP | Migration `0312_action_attempts.sql` ships, schema + RLS manifest entry present, but `server/services/supportDraftDispatchService.ts` and `server/adapters/teamworkAdapter.ts` never read or write `action_attempts`. The OQ-3-closed lookup-then-insert flow is missing. |

### §9 Skill surface (chunk C12)

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| 53 | Ten skill markdown files under `server/skills/support/` | PASS | `server/skills/support/{list-open-tickets,read-thread,propose-reply,add-internal-note,approve-draft,reject-draft,set-status,assign,tag,find-customer-history}.md` (all present) |
| 54 | `actionRegistry` registers all 10 `support.*` actions with idempotency strategy + parameter schema | PASS | `server/config/actionRegistry.ts:3451-3635` |
| 55 | `support.set_status` skill enum permits `{open, pending_internal, waiting_on_customer, resolved, closed}` per §5.1.A lifecycle states | DIRECTIONAL_GAP | `server/config/actionRegistry.ts:3576` defines `z.enum(['open', 'pending_internal', 'waiting_on_customer', 'closed'])` — missing `resolved`. |
| 56 | `support.find_customer_history` joins `canonical_contacts` → `canonical_tickets` + `canonical_revenue` + `canonical_accounts` | DIRECTIONAL_GAP | `server/services/skillExecutor.ts:2298-2321` only joins contacts + tickets; no `canonical_revenue` or `canonical_accounts` join. |
| 57 | `SKILL_HANDLERS` entries for all 10 skills delegating to the right service | PASS | `server/services/skillExecutor.ts:2202-2322` |
| 58 | Permission keys registered (`support.draft.approve`, `support.draft.reject`, `support.draft.override_collision`, `support.inbox.configure`) | PASS | `server/lib/permissions.ts:114-117, 362-365` |

### §10 + §13 + §14 + §15 (UI / routes / observability — chunks C13 + C14 + C15)

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| 59 | Routes `GET /tickets`, `GET /tickets/:id`, `GET /drafts`, `GET /drafts/:id`, `POST /drafts/:id/{approve,reject,edit,manual-resolve}`, `GET /inboxes`, `PATCH /inboxes/:id` mounted at `/api/support` | PASS | `server/routes/support/{index,supportTicketsRoutes,supportDraftsRoutes,supportInboxesRoutes}.ts`, mounted at `server/index.ts:471` |
| 60 | Permission gating on all mutating routes per §9 + §10 access control | PASS | `server/routes/support/supportDraftsRoutes.ts:37-79`, `server/routes/support/supportInboxesRoutes.ts:25` |
| 61 | Sub-action gating on `/manual-resolve` (`mark_sent` + `retry_reconciliation` → `support.draft.approve`; `mark_failed` → `support.draft.reject`) | PASS | `server/routes/support/supportDraftsRoutes.ts:62-79` |
| 62 | UI pages: `SupportDeskSetupPage`, `TicketsListPage`, `TicketDetailPage`, `DraftReviewQueue`, `InboxConfigPage` | PASS | `client/src/pages/integrations/SupportDeskSetupPage.tsx`, `client/src/pages/support/{TicketsListPage,TicketDetailPage,DraftReviewQueue,InboxConfigPage}.tsx` |
| 63 | UI components per spec: `StatusPill`, `PriorityPill`, `ThreadMessage`, `DraftOverlayMessage`, `CollisionCallout`, `QuarantineBanner`, `BackLinkAwaitingBadge`, `SyncHealthPill` | PASS | `client/src/components/support/*.tsx` (8 files) |
| 64 | Routes registered in `client/src/config/routes.ts` and sidebar in `client/src/config/sidebar.ts` | PASS | `client/src/config/routes.ts:73-78`, `client/src/config/sidebar.ts:471-476` |
| 65 | `SUPPORT_LOG_CODES` const exported from `shared/types/supportObservability.ts` covering all §15 + §14.4 + §5.1/§5.2 codes | PASS | `shared/types/supportObservability.ts:1-37` (22 codes) |

### §18 Tests inventory + docs

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| 66 | Five pure tests authored: status-map, draft-dispatch, reconciliation, ticket-service, contact-resolution | PASS | `server/adapters/teamwork/__tests__/teamworkSupportStatusMap.test.ts`, `server/services/__tests__/{supportDraftDispatchService,supportDraftReconciliation,supportTicketServicePure,supportContactResolutionPure}.test.ts` |
| 67 | ADR `0009-support-desk-canonical-not-conversations.md` covers context, decision, consequences, alternatives, OQ-1 deferral | PASS | `docs/decisions/0009-support-desk-canonical-not-conversations.md` |
| 68 | `architecture.md` § Canonical Support Desk added | PASS (with caveat — see REQ #69) | `architecture.md:3506+` |
| 69 | `architecture.md` § Canonical Support Desk uses canonical status enum names matching spec §5.1.A | DIRECTIONAL_GAP | `architecture.md:3515` lists `(open/pending/solved/closed/spam/quarantine)`. Spec is `(open/pending_internal/waiting_on_customer/resolved/closed/unknown_provider_status)`. Doc-sync drift in a high-visibility doc. |
| 70 | `docs/capabilities.md` Support Desk capability entries | PASS | `docs/capabilities.md:720-723+` (10 capability entries present, vendor-neutral) |
| 71 | `KNOWLEDGE.md` patterns: polymorphic-FK split + deferred-FK + deletion-by-poll | PASS | `KNOWLEDGE.md:3232+, 3250+` (deferred-FK and polymorphic split documented; deletion-by-poll captured under chatgpt-spec-review F1 entry) |

### Out-of-scope

| REQ | Requirement | Verdict | Evidence |
|-----|-------------|---------|----------|
| OQ-1 | Foundry training/runtime ticket-schema parity comparison (§22 OQ-1 / `SDC-OVERRIDE-1`) | OUT_OF_SCOPE | Operator-deferred per `tasks/todo.md § Deferred from feature-coordinator hard-gate override — support-desk-canonical (2026-05-09)`; no agent action required. |

---

## 3. Mechanical fixes applied

None. Every gap detected in this run requires design judgement (which is the conservative DIRECTIONAL_GAP classification per the playbook). No file was modified by this run beyond the log and `tasks/todo.md`.

---

## 4. Directional / ambiguous gaps (routed to tasks/todo.md)

See `tasks/todo.md § Deferred from spec-conformance review — support-desk-canonical (2026-05-09)` (added in this run).

| REQ | Severity | One-liner |
|-----|----------|-----------|
| 45 | Critical | Phase 1 preflight checks 4, 5, 6, 7 missing in `supportDraftDispatchService.approveDraft` (status eligibility, collision-window, customer match, superseded). Bot may dispatch over fresh human activity — direct safety-invariant violation per brief §5.4. |
| 49 | High | Manual collision-override audit-event write per spec §8.6 #2 not implemented. |
| 50 | High | Autonomous-agent guard for `overrideCollision: true` per spec §8.6 paragraph 5 not implemented. |
| 52a | High | `action_attempts` table ships in migration 0312 + RLS manifest, but the ledger lookup-then-insert flow in `supportDraftDispatchService` / `teamworkAdapter` is missing per OQ-3 closure + §14.1 + plan C7 contract. |
| 55 | Medium | `support.set_status` parameter enum missing `resolved`. |
| 56 | Medium | `support.find_customer_history` skill does not join `canonical_revenue` and `canonical_accounts` per spec §9. |
| 69 | Low | `architecture.md` § Canonical Support Desk uses non-canonical status enum names. |

---

## 5. Files modified by this run

- `tasks/todo.md` — appended new section "Deferred from spec-conformance review — support-desk-canonical (2026-05-09)"
- `tasks/review-logs/spec-conformance-log-support-desk-canonical-2026-05-09T20-34-30Z.md` — this log

---

## 6. Next step

**NON_CONFORMANT** — 7 directional gaps must be addressed by the main session before `pr-reviewer` / `finalisation-coordinator` proceed. See `tasks/todo.md § Deferred from spec-conformance review — support-desk-canonical (2026-05-09)`. The most urgent is REQ #45 (collision-window preflight): without it, the brief's load-bearing collision invariant is structurally absent from the dispatch path. The other six are smaller in surface area but each one is a spec-named contract that the implementation does not honour.

Recommended remediation path:

1. Fix REQ #45 + #49 + #50 + #52a (action_attempts ledger wiring) as one focused chunk in `supportDraftDispatchService.ts` + `teamworkAdapter.ts` (tightly coupled — the collision-window check, override audit, autonomous-guard, and ledger insert all live in the dispatch hot path).
2. Add `resolved` to `support.set_status` enum (REQ #55) — one-liner.
3. Extend `support.find_customer_history` join (REQ #56) — extend the existing handler.
4. Update `architecture.md § Canonical Support Desk` to use canonical status enum names (REQ #69) — doc-only.

Once the items are addressed, re-run `spec-conformance` on the expanded changed-code set, then `pr-reviewer`.




