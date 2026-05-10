# Pre-Test Hardening — Dev Brief

**Slug:** `pre-test-hardening`
**Branch:** `pre-test-hardening`
**Class:** Major (architect first; full review pipeline)
**Migration range reserved:** `0313–0320`

---

## Goal

Close the 9 launch-blocking gaps identified in the 2026-05-10 pre-prod review, plus 5 lower-urgency items that should land before the first production deploy. After this build the system is ready to enter testing lockdown.

## Why

The pre-prod-tenancy spec shipped tenant isolation at the DB and service layer. Pre-launch Phases 1/2/3 closed 77 P0/P1 items. What remains is a tight cluster of webhook hardening, residual write-path tenant gaps, support-domain draft preflight checks, and a handful of input-validation / concurrency / operational items. None of these will be caught by app-level smoke tests — they require explicit hardening work. Until they land, the system has at least three known cross-tenant write paths and one self-DoS surface accessible to any authorised user.

## Scope (in)

### Phase 1 — Webhook auth & isolation

- **W1 (audit row #22)** — `server/services/webhookService.ts:74-77`. Webhook HMAC validation is gated on `WEBHOOK_SECRET` being set; missing secret silently allows unsigned requests. Fix: fail-closed when secret is unset in production; require explicit dev-only opt-out.
- **W2 (todo §1500)** — `server/routes/webhooks/slackWebhook.ts` and `teamworkWebhook.ts`. Inline `res.status(500)` without `recordIncident` — handler failures are invisible to the system-monitoring layer. Apply the GHL/GitHub pattern: route every 5xx through `recordIncident` with a stable `fingerprintOverride`.
- **W3 (SDC-ADV-3)** — `teamworkWebhook.ts:37-67`. Cross-tenant attribution: handler enumerates all active Teamwork connector configs across orgs and breaks at first HMAC match. Two orgs with the same `webhookSecret` cross-attribute. Replay protection (`webhookDedupeStore`) is in-memory; multi-instance bypasses it. Fix: require a per-org webhook URL discriminator (path token or HTTP header) so attribution is unambiguous before HMAC; persist replay protection via DB nonce table.

### Phase 2 — Read/write tenant scoping closures

- **T1 (SDC-ADV-1)** — `server/routes/support/{supportTicketsRoutes.ts:14, supportInboxesRoutes.ts:15, supportDraftsRoutes.ts:21}`. `GET /api/support/{tickets,drafts,inboxes}` pass `subaccountId: null` hardcoded; service queries do not filter by subaccount. Any authenticated org user reads every subaccount's customer email bodies, draft proposed-reply text, and inbox `agent_config`. Fix: resolve `subaccountId` from path (or implement an org-membership-only listing endpoint distinct from the subaccount-scoped one) and propagate it through the service layer.
- **T2 (AKR-ADV-3)** — `POST /api/reference-documents/promote` and `POST /api/reference-documents/:id/links`. Body-supplied `agentId`, `subaccountId`, `scheduledTaskId`, `taskInstanceId` are inserted into `referenceDocumentDataSources` without verifying they belong to `req.orgId!`. Writes corrupt the scope-link table with FK-valid references to other orgs' entities. Fix: org-membership verification on every non-null scope ID before insert.
- **T3 (line 2989)** — `server/services/taskService.ts:158, 185`. `createTask` and `taskActivities` insert use module-level `db`. Under FORCE-RLS on `tasks` and `task_activities`, writes silently no-op or fail policy whenever the caller hasn't already opened a `withOrgTx` context that ALS can read. Pre-existing across the codebase — onboarding chain is the worst-affected. Fix: refactor `taskService.createTask` to require an explicit org-scoped DB client (`getOrgScopedDb` or caller-supplied `tx`); audit and update every caller.

### Phase 3 — Support draft preflight + agent guards

- **S1 (REQ #45)** — `server/services/support/supportDraftDispatchService.ts approveDraft`. Spec §8.1 enumerates seven preflight checks; only 1, 2, 3 (in part) are implemented. Missing checks: (4) ticket-status eligibility, (5) collision-window, (6) customer-match policy, (7) supersession (no newer draft exists). The plumbed `overrideCollision` parameter is inert because the underlying check doesn't exist. Fix: implement the four missing checks per spec §8.1; gate `overrideCollision: true` on `assertScope` and write an `auditEvents` snapshot.
- **S2 (REQ #50)** — same service. Spec §8.6 mandates that `overrideCollision: true` from an agent-run principal (no human user id) be rejected with `403 support.draft.override_collision_human_only`. Currently silently records `reviewerUserId = null`. Fix: explicit principal-type guard in `approveDraft`.

### Phase 4 — Input validation + concurrency hardening

- **V1 (CONSOL-GOV-DEF-19)** — `server/routes/integrationConnections.ts:123 PATCH /api/subaccounts/:subaccountId/connections/:id`. `req.body.connectionStatus` flows straight into the column with no enum validation; a malformed value crashes every subsequent `GET /api/connections` (UnknownEnumValueError). Self-DoS by an authorised CONNECTIONS_MANAGE user. Fix: Zod enum validation at the route layer + Postgres CHECK constraint migration.
- **V2 (CONSOL-GOV-DEF-18)** — `server/services/knowledgeService.ts:766-811 overrideEntry`. Version increment uses `MAX(version) + 1` in a sub-select; concurrent overrides with the same ETag race the `(memoryBlockId, version)` unique constraint and bubble a raw 23505 (constraint name leaked in 500). Fix: `pg_advisory_xact_lock(hashtextextended(blockId, 0))` at tx start to serialise concurrent overrides on the same block.

### Phase 5 — Operational hardening

- **O1** — `server/jobs/workingTimeRollupCompactJob.ts:99`. `DELETE … RETURNING id` against a composite-PK table; first run against non-empty data fails. Retention/compaction policy has never run in production. Fix: drop `RETURNING id` (or return a count) so the DELETE succeeds.
- **O2** — `migrations/0240_conversations_org_scoped_unique.sql`. Single-tx `DROP INDEX` → `CREATE UNIQUE INDEX` takes `ACCESS EXCLUSIVE` for the build duration. Currently fine on a small pre-launch table; becomes an outage at scale. **Decision (DEC-3, locked):** defer the phased migration to post-launch; ship a runbook entry now (`docs/runbooks/migration-0240-phased-swap.md`) so the next operator can act when the trigger condition fires. See spec §6.2.
- **O3** — `scripts/_reseed_drop_create.ts`. Drops the DB unconditionally; production safety relies on operator vigilance. Fix: fail-fast guard on `process.env.NODE_ENV !== 'development'` and pattern-match `DATABASE_URL` against known production hosts.
- **O4** — `scripts/_reseed_restore_users.ts`. Restore inserts users outside an explicit transaction; mid-run interruption leaves partial state. Fix: wrap restore body in `db.transaction`.
- **O5 (CHATGPT-R1-OP-1)** — Branch protection on `main`. Currently zero required status checks; PRs can merge red. Fix: GitHub Settings → Branches → main → require `lint-typecheck`, `Grep invariants (Phase 3 B.1-B.4)`, `Portable framework tests`. **Operator action — not code.** Spec captures the requirement; the operator applies it.

## Scope (out)

- Audit row #21 (in-memory rate limiting) and row #24 (multer 500MB) — owned by `pre-prod-boundary-and-brief-api` sister branch.
- GHL unauthenticated auto-start onboarding RLS issue (todo line 2609) — separate decision; depends on T3 landing first since it shares the `taskService` write path.
- All defense-in-depth, code-quality, and post-launch architectural items called out in the 2026-05-10 backlog summary.

## Acceptance criteria

- All 9 MUST-DO items shipped with targeted tests covering the closed gap.
- Webhook stack: zero inline `res.status(500)` paths missing `recordIncident`; HMAC validation fails closed in production; cross-tenant webhook attribution requires explicit per-org discriminator.
- Support read paths enforce subaccount scoping; promote endpoint rejects cross-org IDs.
- `taskService.createTask` callers all use an explicit org-scoped DB client; `npx tsc --noEmit -p server/tsconfig.json` clean.
- Support `approveDraft` runs all seven preflight checks; agent-run principals cannot set `overrideCollision: true`.
- Connection PATCH rejects unknown `connectionStatus` values at the route layer and the DB layer.
- Knowledge `overrideEntry` serialises concurrent same-block writes; 5xx no longer leaks constraint names.
- `workingTimeRollupCompactJob` runs to completion against seeded data.
- Reseed scripts refuse to run outside development.
- Spec captures the branch-protection requirement; operator applies it.
- Targeted tests pass for every changed service path (org-filter assertions, withOrgTx propagation, principal-type guards, enum validation rejection).

## References

- Source triage: tasks/todo.md (post-pre-prod-tenancy state, 2026-05-10).
- Adversarial review logs: SDC-ADV-1, SDC-ADV-3, AKR-ADV-3, CONSOL-GOV-DEF-18, CONSOL-GOV-DEF-19, AGW-DEF-6, REQ #45, REQ #50.
- Audit log row 22 (`tasks/todo.md:47`).

## Pipeline

1. Author full dev spec from this brief — covers acceptance criteria per item, migration sequence, test matrix.
2. `architect` agent — phase decomposition + sequencing + chunk plan.
3. `chatgpt-spec-review` — manual review rounds.
4. Implement chunked.
5. `spec-conformance` against the spec.
6. `pr-reviewer`.
7. `dual-reviewer` (if Codex available).
8. `adversarial-reviewer` — auto-trigger surface (webhooks + auth + RLS migrations).
