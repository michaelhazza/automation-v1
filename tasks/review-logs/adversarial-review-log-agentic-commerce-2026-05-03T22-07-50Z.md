# Adversarial Review Log — agentic-commerce

**Branch:** `claude/agentic-commerce-spending`
**Build slug:** `agentic-commerce`
**Reviewer:** `adversarial-reviewer` (read-only Phase 1 advisory)
**Caller:** main session (manual invocation; feature-coordinator was not used in Phase 2)
**Timestamp:** 2026-05-03T22:07:50Z
**Diff scope:** ~140 files vs `origin/main` — 5 migrations (0270–0274), 10+ new schema files, 5 new routes, 15+ new services, 6 new jobs, new SPEND_APPROVER permission, 6 new skills, ~14 new client surfaces.

## Trigger surface

Per CLAUDE.md §5.1.2 the diff hits all five auto-trigger surfaces simultaneously:

- `server/db/schema` — 10 new tables (agent_charges, spending_budgets, spending_policies, etc.)
- `server/routes` — 5 new mounted CRUD route files
- `auth/permission services` — new SPEND_APPROVER key in `server/lib/permissions.ts`
- RLS migrations — 0271 (FORCE-RLS + append-only triggers), 0272 (cost_aggregates RLS retrofit)
- webhook handlers — `server/routes/webhooks/stripeAgentWebhook.ts` (new)

## Reviewer verdict

**HOLES_FOUND** — 2 confirmed-hole, 3 likely-hole, 4 worth-confirming, 4 additional observations.

## Caller triage

| # | Finding | Reviewer severity | Caller verdict | Action |
|---|---|---|---|---|
| 1.1 | `set_config('app.spend_caller', X, true)` in `chargeRouterService.updateChargeStatus` outside a tx | confirmed-hole | **FALSE POSITIVE** | None |
| 1.2 | `cost_aggregates` `WITH CHECK` permits tenant-scoped writes of sentinel-org rows | likely-hole | **BY DESIGN** | None |
| 1.3 | Subaccount budget enumeration within same org via raw `subaccountId` query param | worth-confirming | **PRODUCT QUESTION** | Deferred to `tasks/todo.md` |
| 2.1 | DELETE `/api/approval-channels/:channelId/grants/:grantId` ignores `channelId` | confirmed-hole | **FALSE POSITIVE** (defensive add deferred) | Deferred to `tasks/todo.md` |
| 2.2 | Webhook handler excludes only `revoked`, not other non-active `connectionStatus` (e.g. `error`) | likely-hole | **REAL HOLE — BLOCKER** | Fixed in this branch |
| 3.1 | JSONB-filtered active-approval guard in `approvalChannelService.requestApproval` lacks explicit org filter and supporting index | worth-confirming | Performance/defensibility (RLS protects against cross-org leakage) | Deferred to `tasks/todo.md` |
| 4.1 | `sql.raw` with string-interpolated date in `approvalExpiryJob` | worth-confirming | Hardening (no current vuln; `cutoff` is internal) | Deferred to `tasks/todo.md` |
| 5.1 | In-process Stripe webhook dedupe LRU silently evicts at high volume with 96h TTL | worth-confirming | Advisory (layers 2 + 3 still protect against double-processing) | Deferred to `tasks/todo.md` |
| 6.1 | Cross-tenant data exposure via admin-connection lookup using attacker-supplied `provider_charge_id` | likely-hole | Stripe IDs are globally unique; tenant-match check is correct defence; minor incident-log identifier exposure remains | Deferred to `tasks/todo.md` |
| Obs A | `executionPath` implicit mapping in `agentSpendRequestHandler` (`chargeType → main_app_stripe / worker_hosted_form`) | observation | Code quality / future-proofing | Deferred to `tasks/todo.md` |
| Obs B | `stripeAgentWebhookService` out-of-order re-enqueue silently returns when `_retryCount < 3` (TODO in code) | observation | Reliability concern, not security | Deferred to `tasks/todo.md` |
| Obs C | `spending_budgets` table has no `ON DELETE RESTRICT` on referencing `agent_charges` rows | observation | Hardening | Deferred to `tasks/todo.md` |
| Obs D | PATCH `/api/spending-budgets/:id` accepts `disabledAt` string with no validation; `Invalid Date` produces obscure DB error | observation | Hardening | Deferred to `tasks/todo.md` |

## Caller rationale (false positives + by-design)

**1.1 (set_config in updateChargeStatus):** The reviewer flagged that `set_config(name, value, true)` outside a transaction silently degrades to session-scope, leaking `app.spend_caller` across pooled connections. However, `getOrgScopedDb` in [server/lib/orgScopedDb.ts](../../server/lib/orgScopedDb.ts) guarantees an active org-scoped transaction by throwing `failure('missing_org_context')` when called outside `withOrgTx(...)`. The org-scoped tx is opened by the `orgScoping` HTTP middleware or the `createWorker` pg-boss wrapper — `updateChargeStatus` is therefore always inside an active transaction, and `set_config(..., true)` is correctly transaction-local. The inline comment at [server/services/chargeRouterService.ts:137](../../server/services/chargeRouterService.ts#L137) (`is_local=true matches SET LOCAL`) is accurate. No hole. The stylistic inconsistency between this caller (`SELECT set_config(...)`) and other callers (`SET LOCAL`) is a minor cleanup opportunity — deferred.

**1.2 (cost_aggregates WITH CHECK sentinel-org exemption):** The reviewer flagged that the policy's `WITH CHECK` permits any tenant-scoped principal to INSERT rows with the platform sentinel UUID `00000000-0000-0000-0000-000000000001`. This is intentional and load-bearing. [server/services/costAggregateService.ts:85-141](../../server/services/costAggregateService.ts#L85-L141) writes shared-analytics dimensions (`task_type`, `provider`, `platform`, `source_type`, `feature_tag`, `execution_phase`) under the sentinel org so all tenants see the same shared row via the policy's `USING` clause sentinel-org exemption. The dimension values are hardcoded by the aggregator service (not user-controlled), so there is no exploitable surface for a tenant to inject arbitrary sentinel rows. Tightening `WITH CHECK` would break the platform-analytics aggregation. Documented in the migration header.

**2.1 (DELETE grant ignores channelId):** The reviewer flagged that `revokeGrant` filters only on `grantId + organisationId`, ignoring `channelId` from the URL path. Both POST (add) and DELETE (revoke) routes require `ORG_PERMISSIONS.SETTINGS_EDIT`, which is org-wide by codebase convention — there is no per-channel ACL above SETTINGS_EDIT. Within an org, anyone with SETTINGS_EDIT already has authority over all channels in that org by design. The `channelId` segment is REST resource-hierarchy, not authorisation. UUIDs are not enumerable. Adding the `channelId↔grantId` cross-check is defense-in-depth (deferred to `tasks/todo.md`) but not a security boundary that exists today.

## Caller blocker fix (Finding 2.2)

**File:** `server/routes/webhooks/stripeAgentWebhook.ts:155`
**Fix:** Change `if (connection.connectionStatus === 'revoked')` to a positive allowlist `if (connection.connectionStatus !== 'active')`, with a `recordIncident` call so `error`-state and any future non-active state are observed rather than silently rejected.

## Deferred items (routed to tasks/todo.md)

The following nine items are routed under a new section `Deferred from adversarial-reviewer — agentic-commerce` in `tasks/todo.md`. Each carries the reviewer's file pointer and the caller's rationale.

1. **AC-ADV-1** — Stylistic inconsistency: `updateChargeStatus` uses `SELECT set_config(..., true)` while all other callers use `SET LOCAL`. Convert for consistency.
2. **AC-ADV-2** — Subaccount-level scoping question for `GET /api/spending-budgets?subaccountId=...`. Product decision: should org-level SPEND_APPROVER see all subaccount budgets or only assigned ones?
3. **AC-ADV-3** — DELETE grant route: defensively cross-check that `grantId` belongs to `channelId` even though `SETTINGS_EDIT` is org-wide.
4. **AC-ADV-4** — `requestApproval` JSONB-filtered active-approval guard: add explicit `eq(actions.organisationId, ...)` and a supporting GIN index on `actions.metadataJson`.
5. **AC-ADV-5** — `approvalExpiryJob` `sql.raw` interpolated date → convert to tagged template literal `sql\`...\``.
6. **AC-ADV-6** — Stripe webhook dedupe: instrument LRU eviction event so a high-volume scenario fires an alert before silent eviction degrades the primary dedupe layer.
7. **AC-ADV-7** — Stripe webhook incident log: scrub or redact `webhookOrg` / `rowOrg` UUIDs in cross-org incident reports so per-org incident readers do not see the other org's identifier.
8. **AC-ADV-8** — `agentSpendRequestHandler` `executionPath` mapping: derive from `ActionDefinition.executionPath` rather than implicit `chargeType` switch.
9. **AC-ADV-9** — `stripeAgentWebhookService` out-of-order re-enqueue: replace the silent return with an actual re-enqueue mechanism (the in-code TODO acknowledges this is out of scope for the implementing chunk).
10. **AC-ADV-10** — `spending_budgets` referential integrity: add `ON DELETE RESTRICT` (or `SET NULL` with appropriate audit handling) on `agent_charges.spending_budget_id` to prevent orphaning in-flight charges.
11. **AC-ADV-11** — `PATCH /api/spending-budgets/:id` `disabledAt` input validation: reject malformed date strings with a clean 400 instead of an obscure Drizzle/PG error.

## Outcome

`HOLES_FOUND_TRIAGED` — 1 blocker fixed in branch, 11 items deferred to `tasks/todo.md`, 3 reviewer findings dissolved against codebase contracts (false positives / by-design).
