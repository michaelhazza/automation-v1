# Adversarial Review Log — support-desk-canonical

**Build slug:** support-desk-canonical
**Branch:** claude/support-ticket-structure-xMcy8
**Branch HEAD at review:** `62f9a28e` (post REQ #72 fix)
**Reviewed by:** adversarial-reviewer (Phase 1 advisory, non-blocking)
**Timestamp:** 2026-05-09T21:28:46Z
**Caller:** feature-coordinator Phase 2 §8.2 (auto-trigger surface matched)

**Verdict:** HOLES_FOUND (2 confirmed-holes, 2 likely-holes, 3 worth-confirming)

**Coordinator response summary:**

- **2 confirmed-holes** are partially contradicted by spec design decision (chatgpt-spec-review R2: "Read-pathway permissions: No `support.tickets.read` permission key; read access is implicit in org membership + sub-account scoping"). However, the spec-mandated **sub-account scoping** is NOT enforced in the route handlers (all three pass `subaccountId: null` hard-coded). Routed to `tasks/todo.md` as `SDC-ADV-1` for operator triage on whether to add subaccount filtering or read-permission gates.
- **2 likely-holes** routed to `tasks/todo.md` as `SDC-ADV-2` and `SDC-ADV-3` for operator triage with the open question on Teamwork Desk provider-side idempotency behavior.
- **3 worth-confirming** routed to `tasks/todo.md` as `SDC-ADV-4`, `SDC-ADV-5`, `SDC-ADV-6`.

---

## Files reviewed

- migrations/0307_canonical_inboxes.sql
- migrations/0308_canonical_support_agents.sql
- migrations/0309_canonical_tickets.sql
- migrations/0310_canonical_ticket_messages.sql
- migrations/0311_canonical_ticket_drafts.sql
- migrations/0312_action_attempts.sql
- server/config/rlsProtectedTables.ts
- server/routes/support/index.ts
- server/routes/support/supportTicketsRoutes.ts
- server/routes/support/supportInboxesRoutes.ts
- server/routes/support/supportDraftsRoutes.ts
- server/services/supportInboxService.ts
- server/services/supportTicketService.ts
- server/services/supportDraftDispatchService.ts
- server/services/supportDraftDispatchServicePure.ts
- server/services/supportDraftDispatchPreflightPure.ts
- server/lib/supportDispatchBootRecovery.ts
- server/routes/webhooks/teamworkWebhook.ts
- server/lib/webhookDedupe.ts
- server/lib/permissions.ts
- server/config/actionRegistry.ts (support action block)
- server/services/skillExecutor.ts (support skill block, lines 2187-2341)
- server/skills/support/*.md (10 skill definitions)

---

## 1. RLS / Tenant Isolation

No confirmed RLS holes. All six new tables ship `ENABLE` + `FORCE ROW LEVEL SECURITY` with the canonical `current_setting('app.organisation_id', true)` policy. All six are registered in `rlsProtectedTables.ts`. Service-layer reads use `getOrgScopedDb()`. The `authenticate` middleware sets the org session variable.

**worth-confirming (SDC-ADV-4)** — Multiple UPDATE statements in `supportDraftDispatchService.ts` (`approveDraft`) omit `organisationId` from the WHERE clause: lines 295-312 (Phase 2 transition), 339-341, 346-350 (integrationConnections fetch), 381-384, 443-446, 455-458, 470-473, 478-481. RLS provides the backstop, but `DEVELOPMENT_GUIDELINES.md §1` requires explicit application-layer org filtering for defence-in-depth. Pattern violation — not exploitable in isolation.

## 2. Auth & Permissions

**confirmed-hole (SDC-ADV-1)** — `GET /api/support/tickets`, `GET /api/support/tickets/:id`, `GET /api/support/drafts`, `GET /api/support/drafts/:id`, `GET /api/support/inboxes` are gated only by `authenticate`. Any authenticated org user can read all support drafts (including `proposedBodyText`, `reviewNotes`), all ticket message threads (customer email bodies), and all inbox `agent_config` JSONB (mode, collision-window thresholds, opt-ins).

**Spec context — partial contradiction:**
> chatgpt-spec-review R2: "No `support.tickets.read` permission key; read access is implicit in org membership + sub-account scoping. Mutating operations gated by `support.draft.approve` / `support.draft.reject` / `support.draft.override_collision` / `support.inbox.configure`."

The spec design is "read = org membership + sub-account scoping". The implementation enforces "read = org membership" only. The three route handlers pass `subaccountId: null` hardcoded:
- `supportTicketsRoutes.ts:14`
- `supportInboxesRoutes.ts:15`
- `supportDraftsRoutes.ts:21`

**Operator triage:** the gap is sub-account scoping, not the absence of permission keys. Two valid resolutions:
1. Implement subaccount scoping by extracting `req.subaccountId` (or equivalent) from the auth middleware and passing through to the service layer's RLS-aware query. The service-layer queries would then add `eq(table.subaccountId, principal.subaccountId)`.
2. Override the spec decision and add `support.ticket.view` / `support.draft.view` / `support.inbox.view` read permissions to gate these routes (spec amendment required).

## 3. Race Conditions

**likely-hole (SDC-ADV-2)** — `supportDraftDispatchService.ts:367-402` action_attempts TOCTOU on the crash-recovery path. Two concurrent `approveDraft` calls are serialized by the Phase 2 CAS (the `inArray(status, ['draft', 'awaiting_review'])` UPDATE). If process A wins Phase 2 and crashes before inserting the `action_attempts` `in_flight` row but after calling the adapter, the boot-recovery worker re-enqueues. The retry runs fresh, finds no `action_attempts` row, inserts one, and calls the adapter again — duplicate provider send.

**Confirmation needed:** does the Teamwork Desk `addReply()` adapter's `idempotencyKey` parameter get honored as provider-side idempotent? If yes → not exploitable. If no or partially → confirmed duplicate-send hole.

**Operator action:** add a Teamwork Desk API smoke test in C7 follow-up that submits two `addReply` calls with the same `idempotencyKey` and verifies provider behavior. Document in spec §14.1 next to OQ-3.

## 4. Injection

No SQL injection. All Drizzle queries use parameterized expressions.

**worth-confirming (SDC-ADV-5)** — `supportDispatchBootRecovery.ts:32` uses `drizzleSql.raw(String(STALLED_THRESHOLD_SECONDS))`. The constant is module-level (`= 60`), so safe today. Pattern is fragile — replacing with a config-sourced value would create direct injection. Replace with hardcoded literal in the SQL template tag.

## 5. Resource Abuse

No per-tenant rate limiting on the four new support route files. The Phase 2 CAS bounds duplicate adapter invocations for the same draft. No recursive agent paths, no unbounded LLM context, bounded job payloads. Informational only.

## 6. Cross-Tenant Data Leakage

**likely-hole (SDC-ADV-3)** — `teamworkWebhook.ts:37-67` cross-tenant attribution. `connectorConfigService.findAllActiveByType('teamwork')` retrieves all active configs across all orgs. The HMAC match loop iterates in DB-order and breaks at first match. If two orgs have the same `webhookSecret` (no platform-side uniqueness enforcement), webhook events from org A can be attributed to org B.

Currently the post-processing is a no-op (`Future: publish to event bus`). When canonical mutations are wired up, this becomes a cross-tenant data injection vector.

Replay protection: `webhookDedupeStore` is in-memory (10-min TTL). Multi-instance deployments have independent stores. Manual replay against a different instance bypasses dedup.

**Operator action:**
1. Add a unique constraint or platform-side check that `connector_configs.config->>'webhookSecret'` cannot collide across orgs for the same connector type.
2. Persist webhook dedup in a shared store (Postgres `webhook_dedup_keys` table with TTL cleanup, or Redis with TTL).

## Additional observations

**worth-confirming (SDC-ADV-6 — correctness, not security)** — `supportDraftDispatchService.ts:442-445`. `const messageId = replyId || draft.id` assigns the provider response string (e.g. `"12345"`) to `sentMessageId`, which is a `uuid()` column with FK to `canonical_ticket_messages(id)`. Postgres rejects non-UUID strings on INSERT. Per spec §8.2 the back-link routine resolves provider `replyId → canonical message id` after ingestion — `sentMessageId` should be set to NULL on the `sent` transition and back-filled by the back-link routine. Routed for pr-reviewer focus.

- `supportDraftsRoutes.ts:62-78` — `manual-resolve` permission check has no `else` branch for unknown actions; the call falls through to `manualResolveDraft` which throws 422. No unauthorised state change — layering oddity only.
- `skillExecutor.ts:2251-2258` — `support.approve_draft` skill correctly does not forward `overrideCollision`; service-type principal triggers the autonomous-agent guard. No hole.
- `skillExecutor.ts:2317` — `contacts.map((c) => c.accountId)` safe (column is `NOT NULL`).

---

## Routing summary

| ID | Severity | Title | Route |
|---|---|---|---|
| SDC-ADV-1 | confirmed-hole (partial spec-contradiction) | Read-pathway sub-account scoping not enforced | tasks/todo.md |
| SDC-ADV-2 | likely-hole | action_attempts TOCTOU on crash-recovery (provider idempotency dependent) | tasks/todo.md |
| SDC-ADV-3 | likely-hole | Teamwork webhook cross-tenant attribution + in-memory dedup | tasks/todo.md |
| SDC-ADV-4 | worth-confirming | Multiple UPDATEs in approveDraft omit organisationId predicate | tasks/todo.md |
| SDC-ADV-5 | worth-confirming | drizzleSql.raw() in boot-recovery (safe today, fragile) | tasks/todo.md |
| SDC-ADV-6 | worth-confirming (correctness) | sentMessageId UUID type mismatch with provider replyId | tasks/todo.md |

All 6 items deferred to operator triage per playbook §8.2 (non-blocking advisory).
