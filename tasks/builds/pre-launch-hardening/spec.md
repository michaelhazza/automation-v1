# Pre-Launch Hardening Spec

**Build slug:** `pre-launch-hardening`
**Date:** 2026-05-04
**Status:** Draft (pending plan-gate review)
**Source:** Triage of `tasks/todo.md` (2,907 lines) — every deferred item judged launch-relevant pulled into one bundled spec ahead of development freeze and first production launch.

---

## Table of contents

1. Context, goals, non-goals, success criteria
2. Phase plan and sequencing
3. Bucket 1 — Security and multi-tenant isolation
4. Bucket 2 — Data integrity and correctness
5. Bucket 3 — Scalability blockers
6. Bucket 4 — Operational readiness
7. Bucket 5 — Customer-facing correctness
8. Bucket 6 — Compliance and legal
9. Cross-cutting concerns and dependencies
10. Acceptance criteria and verification plan per phase
11. Out of scope / explicitly deferred to post-launch
12. Appendix — full traceability table to `todo.md` line numbers

---

## 1. Context, goals, non-goals, success criteria

### 1.1 Context

Automation OS has completed its initial round of feature builds (four to five major features shipped against the three-coordinator pipeline). The deferred-items queue at `tasks/todo.md` has grown to 2,907 lines as items were intentionally pushed out of feature scope. The product is approaching a development freeze, after which a dedicated testing push precedes first production launch with paying customers.

This spec is the consolidated pre-freeze hardening pass. Every item listed here was triaged as either a launch blocker (P0), a freeze blocker (P1), or a strong-recommend (P2). Out-of-scope items (polish, refactors, post-launch features) are explicitly listed in §11 so they remain visible without bloating this work package.

### 1.2 Goals

- Close every confirmed multi-tenant security hole before any paying customer is onboarded.
- Replace dead-on-arrival customer features (UI wired but backend no-ops) with working implementations or remove the surface entirely.
- Eliminate silent data-integrity gaps on hot paths: agent runs, workflow events, billing, webhooks.
- Establish minimum operational readiness: error boundaries, request timeouts, audit trails, runbooks for foreseeable incidents.
- Remove low-cost scalability landmines that bite at launch-day load (missing indexes, inline bulk loops in webhooks, N+1s on hot paths).
- Produce a single bundled spec the team can execute in three sequenced phases with clear acceptance gates.

### 1.3 Non-goals

- Refactors that don't close a launch-relevant gap.
- Feature additions beyond what a wired-but-broken surface already promises.
- Performance work targeting scale we will not reach pre-launch.
- Doc/spec polish, agent-fleet improvements, internal tooling.
- The `agent_runs` schema split, Workflows-v2 versioning primitives, marketplace work — explicitly post-launch (see §11).

### 1.4 Success criteria

The freeze gate is met when all of the following are true:

1. **Security:** Adversarial reviewer finds no P0 cross-tenant or auth holes against the post-spec branch. CI verifies tenant scoping on every route in scope.
2. **Customer correctness:** Every primary action surface listed in §7 either works end-to-end or is hidden behind a feature flag with a planned removal window.
3. **Data integrity:** Every event/run/charge path listed in §4 is durable across reload, atomic across partial failures, and idempotent under retry.
4. **Operational readiness:** Error boundary present, axios timeouts present, central audit log writing on auth/permission events, backup/restore runbook checked into the repo, multer body-cap reduced.
5. **Scalability:** All org-id indexes from §5 in place; OAuth bulk-onboarding moved off the inline webhook path; verified hot-path N+1s eliminated.
6. **Verification:** CI runs the full gate suite green; spec-conformance + pr-reviewer + adversarial-reviewer all pass on the merged branch.

---

## 2. Phase plan and sequencing

This work splits into three phases. Phase 1 and 2 are mandatory before launch. Phase 3 is strong-recommend, deferrable to immediately post-launch if calendar pressure forces a cut.

### Phase 1 — Stop-the-bleed (target: ~2 weeks)

Scope: every P0 in §3, §4, §6, §7. These are the items where shipping without them either leaks customer data, double-charges, or presents broken primary buttons to a paying customer.

Sequencing inside Phase 1:
1. **Security P0s first** (Bucket 1). These block any onboarding rollout. OAuth state binding, OAuth state store, `workflow_drafts` scope check, in-memory rate limiters, webhook HMAC, multer body cap.
2. **Auto-start onboarding fix** (Bucket 1 + 2 + 3, multi-bucket). Webhook GUC propagation + pg-boss enqueue — gates GHL onboarding, scalability landmine, and security boundary all in one item.
3. **Customer-facing P0s** (Bucket 5). OAuth resume restart wiring, Universal Brief approve/reject, integration-block service implementation, email-channel tile, soft-delete sweep.
4. **Data-integrity P0s** (Bucket 4). Thread-context injection, durable task event emission, concurrency-guard version predicate, `step.approval_resolved`, direct-INSERT 23505→409 conversion.
5. **Op-readiness P0s** (Bucket 4). CI wiring for `verify-workspace-actor-coverage`, reseed-script env guard, transaction wrapping for restore-users script.

Phase 1 exit gate: adversarial-reviewer returns no P0 findings; primary action surfaces verified by manual smoke test across one full agency-onboarding flow; pr-reviewer green.

### Phase 2 — Launch hardening (target: ~2-3 weeks)

Scope: every P1 in all six buckets. These are the items that prevent a tractable launch-week support burden — silent error swallowing, missing error boundary, no axios timeout, no audit log, missing webhook incident coverage, missing org-id indexes, soft-delete sweeps not in P0, PDF dependency, observability counters.

Sequencing inside Phase 2:
1. **Cross-cutting client foundations** — React `ErrorBoundary`, axios request timeout, centralised silent-catch sweep. These touch many surfaces; do them first to land the ground floor.
2. **Centralised audit log** — auth/permission events. Required for compliance and incident triage.
3. **Webhook incident coverage** — Slack and Teamwork webhook 5xx handlers must call `recordIncident` like the GHL pattern.
4. **Soft-delete sweep** — every join not covered in Phase 1's P0 set.
5. **Schema indexes + migration staging** — org-id indexes on the four named tables; restage migration 0276 with nullable→backfill→NOT NULL.
6. **Customer-correctness P1s** — modal/UX gaps, template defaults, calendar invite delivery, etc.

Phase 2 exit gate: full CI gate suite green; spec-conformance verifies every spec-driven item closed; manual flight-check of the launch path covering signup, onboarding, agent run, OAuth pause/resume, billing.

### Phase 3 — Strong-recommend, deferrable (target: ~1 week, can slip to post-launch)

Scope: P2 items. Workflows-v1 page simplification (Mock 08/09), prom-style observability counters, JobResult discriminated union, hybrid executor live-fetch ID-scoped, migration CONCURRENTLY pre-deploy prep, three N+1 hot-path parallelisations. None of these are launch blockers; all are scheduled for the first sprint after launch if Phase 2 runs over.

Phase 3 exit gate: items closed or formally re-deferred to post-launch with explicit owner + ETA in `tasks/todo.md`.

### Inter-phase rules

- **No cross-phase work-in-progress.** Phase 1 must hit its exit gate before Phase 2 work starts. This forces the team to actually verify Phase 1 closed before adding new surface.
- **Each phase builds on the prior.** Phase 2 audit log assumes Phase 1 OAuth security fixes are landed; Phase 3 observability counters assume Phase 2 webhook incident coverage is in place.
- **Re-triage at every phase exit.** Each phase exit re-reads `tasks/todo.md` for any items added during execution; new P0s pull back into the current phase, not the next one.

---

## 3. Bucket 1 — Security and multi-tenant isolation

Each item below is a security or tenancy gap. Item format: ID, title, severity, phase, scope, source line in `todo.md`, problem, expected behaviour, acceptance test.

### 3.1 P0 — Phase 1 — must close before any onboarding rollout

#### S-P0-1 OAuth callback session-org verification (state-nonce binding)

- **Source:** `tasks/todo.md:2520`
- **Problem:** OAuth callback does not verify the session-org matches the state nonce. Adversarial reviewer confirmed cross-org install hijack vector: cross-site delivery of an Org-A nonce to an Org-B user could leak Org-B's GHL credentials into Org-A's namespace.
- **Expected behaviour:** State nonce stores the originating `organisationId` at issue time; on callback, the decrypted session must match the bound org or the request is rejected with `403 cross_org_state_mismatch` and audited.
- **Acceptance test:** Unit test issues a state for Org-A, posts back authenticated as Org-B, asserts 403 + audit row. Integration test confirms happy path (same-org) still completes.
- **Scope:** S (1 day)

#### S-P0-2 Cluster-safe OAuth state store

- **Source:** `tasks/todo.md:2524`
- **Problem:** `ghlOAuthStateStore` is a process-local in-memory `Map`. Multi-instance deploy fails nondeterministically — state issued on instance A is not findable on instance B.
- **Expected behaviour:** State persisted to either Redis (TTL-keyed) or a `oauth_state_nonces` Postgres table with TTL cleanup job. Production startup asserts the backend is configured (no silent fallback to in-memory).
- **Acceptance test:** Two-instance smoke test (issue on A, callback on B) succeeds. Boot fails fast with explicit error if backing store missing in production.
- **Scope:** S (1-2 days)

#### S-P0-3 `workflow_drafts` route subaccount-scope check

- **Source:** `tasks/todo.md:2792`
- **Problem:** The `workflow_drafts` route is missing the `subaccount_id = resolvedSubaccount.id` check (REQ 14b-extra). Same-org cross-subaccount read by ID will leak draft contents.
- **Expected behaviour:** Every read path for `workflow_drafts` filters on the resolved subaccount, returning 404 (not 403) on miss to avoid existence disclosure.
- **Acceptance test:** Unit test: same-org user with subaccount A requests draft owned by subaccount B → 404. RLS migration verifies row-level enforcement.
- **Scope:** XS (hours)

#### S-P0-4 Auto-start onboarding GUC propagation under FORCE RLS

- **Source:** `tasks/todo.md:2534`
- **Problem:** GHL-installed subaccounts never auto-start their onboarding workflows because unauthenticated webhook/OAuth-callback paths don't set `app.organisation_id`. Customers complete the OAuth install and then nothing happens — onboarding silently skipped.
- **Expected behaviour:** Webhook + OAuth callback paths resolve and set `app.organisation_id` (and `app.subaccount_id` where relevant) before invoking any FORCE-RLS-touching service. All such paths annotated with `withOrgTx` or equivalent.
- **Acceptance test:** Integration test: simulate INSTALL_company webhook end-to-end, assert onboarding workflow row inserted under correct org, run begins.
- **Scope:** S (1 day, plus dependencies on S-P0-5)

#### S-P0-5 In-memory rate limiting on auth must move to DB-backed primitive

- **Source:** `tasks/todo.md:38`
- **Problem:** `express-rate-limit` is in-memory. Lost on restart, bypassed in multi-process. Listed as OPEN against the pre-prod-boundary spec (item 21).
- **Expected behaviour:** Use the existing `rate_limit_buckets` table primitive (or Redis if introduced) for auth, password-reset, and forgot-password endpoints. Verify `window_sec` namespacing convention.
- **Acceptance test:** Two-process load test: 11 attempts to a 10/minute endpoint distributed across processes returns 429 on the 11th regardless of routing. Restart mid-test does not reset the counter.
- **Scope:** S (1 day)

#### S-P0-6 Webhook HMAC validation must be mandatory

- **Source:** `tasks/todo.md:39`
- **Problem:** Webhook auth is optional today. If `WEBHOOK_SECRET` unset, webhooks accept any payload. (Item 22.)
- **Expected behaviour:** Production startup fails fast if `WEBHOOK_SECRET` unset. All inbound webhook handlers verify HMAC, reject with 401 on mismatch.
- **Acceptance test:** Unit test per webhook route: missing/invalid signature → 401, valid → 200. Boot fails in production env if secret not configured.
- **Scope:** XS (hours)

#### S-P0-7 OAuth `useOAuthPopup` postMessage origin allowlist

- **Source:** `tasks/todo.md:396`
- **Problem:** Origin check uses `window.location.origin`, which fails on split-origin deploys (api host different from app host). Will silently break legit OAuth in production.
- **Expected behaviour:** Configured `VITE_API_ORIGIN` allowlist; postMessage events from non-allowlisted origins ignored.
- **Acceptance test:** Unit test: non-allowlisted origin event → ignored. Allowlisted origin event → handled.
- **Scope:** XS (hours)

#### S-P0-8 Multer body-size cap

- **Source:** `tasks/todo.md:41`
- **Problem:** Multer memory storage accepts 500MB uploads. OOM DoS surface. (Item 24.)
- **Expected behaviour:** Cap reduced to 25MB (or per-route caps where known requirements differ); reject with 413 on oversize.
- **Acceptance test:** Upload 26MB → 413; upload 1MB → 200.
- **Scope:** XS (hours)

#### S-P0-9 Forgot/reset-password rate limiting on DB primitive

- **Source:** `tasks/todo.md:50`
- **Problem:** Currently `express-rate-limit` (in-memory). OPEN per pre-prod-boundary Phase 2.
- **Expected behaviour:** Same DB-backed bucket as S-P0-5 covers the password-reset and forgot-password endpoints. Per-IP and per-account limits both enforced.
- **Acceptance test:** Brute-force simulation across processes triggers 429 at expected threshold.
- **Scope:** XS (hours, after S-P0-5)

### 3.2 P1 — Phase 2 — must close before launch

#### S-P1-1 Pool-membership / authz CI gate

- **Source:** `tasks/todo.md:2476`
- **Problem:** Manual reviewer is the only gate against authz holes today. Pool-membership and permission-scope checks are not covered by any CI gate.
- **Expected behaviour:** A `verify-permission-scope.sh` (or equivalent) script runs in CI and fails on any new route handler that touches pool-scoped data without invoking the pool-membership predicate.
- **Acceptance test:** Adding a fixture route that bypasses the predicate makes CI red.
- **Scope:** S (1 day)

#### S-P1-2 Token-refresh / revocation cascade for location-token soft-delete

- **Source:** `tasks/todo.md:2546`
- **Problem:** On agency revoke, location-tokens linger after permanent 401. Stale rows complicate incident response.
- **Expected behaviour:** Agency revoke triggers cascading soft-delete on all child location-tokens; subsequent reads exclude soft-deleted rows.
- **Acceptance test:** Revoke agency in test, assert all child location-tokens marked deleted within the same transaction.
- **Scope:** XS (hours)

#### S-P1-3 Operator kill-switch for connector configs

- **Source:** `tasks/todo.md:2550`
- **Problem:** No one-click operator path exists to disable a misbehaving partner integration. First production incident response will require code-deploy.
- **Expected behaviour:** `POST /api/admin/connector-configs/:id/disable` toggles a `disabled_at` column; running and queued executions short-circuit on disabled connectors with explicit error code.
- **Acceptance test:** Disable a config in test, attempt to start a run that uses it, assert deterministic failure with `connector_disabled` code.
- **Scope:** S (1 day)

#### S-P1-4 Mode-aware execute role for maintenance jobs (B10)

- **Source:** `tasks/todo.md:451`
- **Problem:** Maintenance jobs run under `admin_role` (bypasses RLS) per-org. Defence-in-depth gap; a bug in a maintenance job could touch any org.
- **Expected behaviour:** Maintenance jobs run under per-org `withOrgTx` with execute role scoped to the iteration's organisation; admin-role retained only for cross-org cleanup tasks documented in an explicit allowlist.
- **Acceptance test:** Per-org maintenance task fixture confirms RLS enforcement; cross-org cleanup task (allowlisted) confirms admin escalation logged.
- **Scope:** S (1-2 days)

#### S-P1-5 `@rls-allowlist-bypass` runtime audit

- **Source:** `tasks/todo.md:1586`
- **Problem:** RLS allowlist bypass is enforced at lint time but not at runtime. A future code path could bypass without surfacing.
- **Expected behaviour:** Runtime audit log entry on every bypass read, capturing caller + route + reason; or hard-assert if bypass invoked outside the documented allowlist.
- **Acceptance test:** Trigger an allowlisted bypass in test, assert audit row written. Trigger a non-allowlisted bypass, assert hard error.
- **Scope:** S (1 day)

#### S-P1-6 `assignableUsers` email-enumeration mitigation (W1-F3)

- **Source:** `tasks/todo.md:2434`
- **Problem:** Org admin can enumerate users across subaccounts via the assignable-users endpoint.
- **Expected behaviour:** Either rate-limit per-caller-per-day, scope results to admin's subaccounts, or return obfuscated identifiers until the user is in scope.
- **Acceptance test:** Cross-subaccount enumeration returns 0 rows or rate-limited 429 after threshold.
- **Scope:** XS (hours)

#### S-P1-7 Permission guards on Drive picker-token + verify-access (REQ #C4)

- **Source:** `tasks/todo.md:1923`
- **Problem:** Anyone authenticated can mint Drive picker tokens for any connection in the org.
- **Expected behaviour:** Guard requires the caller to own the connection or have an explicit `connection.read` permission on it.
- **Acceptance test:** Cross-connection mint attempt → 403; owner mint → 200.
- **Scope:** XS (hours)

#### S-P1-8 Subaccount-scope check on per-task `connection_id` (REQ #C5)

- **Source:** `tasks/todo.md:1928`
- **Problem:** Tasks can reference a connection from a different subaccount within the same org.
- **Expected behaviour:** On task create/update, validate the connection belongs to the same subaccount; reject otherwise.
- **Acceptance test:** Cross-subaccount connection_id submission rejected with 422.
- **Scope:** XS (hours)

#### S-P1-9 `streamEventsByTask` explicit org filter (adv F4)

- **Source:** `tasks/todo.md:2833`
- **Problem:** Relies on RLS only. Defence-in-depth: also filter explicitly at the application layer.
- **Expected behaviour:** Query includes `organisationId = ctx.org` predicate in addition to RLS.
- **Acceptance test:** Code review verifies predicate; integration test confirms cross-org event invisibility holds even with RLS disabled in test mode.
- **Scope:** XS (hours)

#### S-P1-10 Convert bare-`db` services to `getOrgScopedDb` (adv F2)

- **Source:** `tasks/todo.md:2831`
- **Problem:** `workflowDraftService`, `teamsService`, `assignableUsersService` use bare `db` on FORCE-RLS tables. Convention violation.
- **Expected behaviour:** All three switched to `getOrgScopedDb`. Lint rule blocks regression.
- **Acceptance test:** Static check verifies no bare `db` usage on FORCE-RLS tables in `server/services/**`.
- **Scope:** S (1 day)

#### S-P1-11 Migration 0227 over-scope follow-up (GATES-2026-04-26-1)

- **Source:** `tasks/todo.md:1070`
- **Problem:** `reference_documents` and `reference_document_versions` parent-EXISTS RLS partially closed. Need to verify FORCE RLS is applied.
- **Expected behaviour:** Both tables have FORCE RLS verified by automated migration test; parent-EXISTS clause confirmed in policy text.
- **Acceptance test:** Migration test asserts `relforcerowsecurity = true` for both tables.
- **Scope:** S (1 day)

---

## 4. Bucket 2 — Data integrity and correctness

### 4.1 P0 — Phase 1

#### D-P0-1 Auto-start onboarding via pg-boss (REQ #25)

- **Source:** `tasks/todo.md:2496`
- **Problem:** Auto-start onboarding executes inline inside the OAuth callback. A 500-location burst serialises 500 round-trips before the callback returns — request times out, state inconsistent.
- **Expected behaviour:** OAuth callback enqueues one pg-boss job per location with idempotency key `onboard:{org}:{location}`. Worker drains the queue with bounded concurrency. Callback returns within 2s on any location count.
- **Acceptance test:** Simulate 500-location install: callback returns ≤ 2s; queue drains; every location has exactly one onboarding workflow row.
- **Scope:** M (2-4 days)

#### D-P0-2 `step.approval_resolved` event emission (REQ 9-12)

- **Source:** `tasks/todo.md:2767`
- **Problem:** Workflows engine never emits `step.approval_resolved`. Spend-approval cards in the UI never see a resolution event and stay in pending state until manual refresh.
- **Expected behaviour:** Engine emits `step.approval_resolved` with `{ stepId, decision, decidedBy, decidedAt }` whenever an approval transitions out of pending. Both approve and reject paths emit. Bulk paths emit per-step.
- **Acceptance test:** Approve a step in test, assert event published in same transaction as state transition. UI subscriber receives event.
- **Scope:** S (1 day)

#### D-P0-3 Direct INSERTs into `workflow_runs` must convert 23505 → 409 (REQ P1-8)

- **Source:** `tasks/todo.md:2747`
- **Problem:** Bulk-child fanout and replay paths INSERT directly, bypassing the helper that converts duplicate-key violations into clean `TaskAlreadyHasActiveRunError` (409). Raw 5xx returned today.
- **Expected behaviour:** All `workflow_runs` writes go through the helper. Lint rule blocks direct `INSERT INTO workflow_runs` outside the helper file.
- **Acceptance test:** Concurrent run-start attempt on same task returns 409 with explicit error code, not 500.
- **Scope:** XS (hours)

#### D-P0-4 Concurrency guard `version` predicate on patch update (A-D2)

- **Source:** `tasks/todo.md:1850`
- **Problem:** Two concurrent writers on an existing thread-context row produce a silent lost write. Patch update lacks `version = ?` predicate.
- **Expected behaviour:** Update statement includes `version = expectedVersion` predicate; on zero rows affected, throw `OptimisticLockError` and let the caller retry.
- **Acceptance test:** Concurrent-writer test: both writers race; one succeeds, one retries; final state contains both writes' merged content.
- **Scope:** S (1 day)

#### D-P0-5 Durable `appendAndEmitTaskEvent` (pr-S1)

- **Source:** `tasks/todo.md:2817`
- **Problem:** Task events emitted only via socket, not persisted with sequence allocation. User opening the task view N seconds after `run.paused`, `ask.submitted`, `file.edited`, `chat.message`, `agent.milestone`, `step.awaiting_approval` sees stale state until manual refresh.
- **Expected behaviour:** Event row written to `task_events` table in the same transaction that allocates the sequence number. Socket emit is a notification; durable replay via projection rebuild always returns the full ordered stream.
- **Acceptance test:** Emit event, force socket disconnect immediately, reload task view, assert event visible. Reconciliation projection from durable log matches socket-observed state.
- **Scope:** M (2-4 days)

#### D-P0-6 Resolver write atomicity contract (REQ #C2)

- **Source:** `tasks/todo.md:1913`
- **Problem:** External-document resolver writes the cache upsert in a transaction, but audit and state transition rows are written separately. Cache vs audit drift on partial failure.
- **Expected behaviour:** All three writes (cache upsert, audit, state transition) in one transaction. Either all commit or none.
- **Acceptance test:** Inject failure between writes, assert no partial state visible after rollback.
- **Scope:** S (1 day)

#### D-P0-7 Workflow run depth fail-fast at every entry point (REQ 15-7, adv F6)

- **Source:** `tasks/todo.md:2797`, `tasks/todo.md:2835`
- **Problem:** Run-depth limit enforced only at the skill layer. HTTP `startRun` lacks the baseline check. A future caller catching the skill error could allow unbounded recursion.
- **Expected behaviour:** Depth check enforced at every run-entry point: HTTP, queue worker, skill dispatcher. Single helper called from each.
- **Acceptance test:** Deep-recursion fixture rejected with consistent error code at every entry point.
- **Scope:** S (1 day)

### 4.2 P1 — Phase 2

#### D-P1-1 Cached-context dismissal RLS / unique-key alignment

- **Source:** `tasks/todo.md:582`
- **Problem:** `bundle_suggestion_dismissals` has cross-org user (today only system_admin) failing the second dismiss silently due to unique-key vs RLS mismatch.
- **Expected behaviour:** Composite unique key includes `organisation_id`; dismissal scoped per-org-per-user-per-bundle.
- **Acceptance test:** Same user dismisses bundle in Org A and Org B in test, both succeed.
- **Scope:** XS (hours)

#### D-P1-2 `approverPoolSnapshot` UUID normalisation (REQ 9-9)

- **Source:** `tasks/todo.md:2752`
- **Problem:** Uppercase UUIDs from author input bypass the equality check; legitimate approvers may be rejected.
- **Expected behaviour:** All UUIDs normalised to lowercase before snapshot write and at the membership-check call site. Existing snapshots backfilled by migration.
- **Acceptance test:** Approver listed in mixed-case UUID matches lowercase membership check.
- **Scope:** XS (hours)

#### D-P1-3 Stripe out-of-order webhook re-enqueue (AC-ADV-9)

- **Source:** `tasks/todo.md:2646`
- **Problem:** After three retries, out-of-order Stripe webhooks silently return; the charge sits stuck until reconciliation poll.
- **Expected behaviour:** On out-of-order detection, push to a delayed retry queue with backoff; do not silently drop.
- **Acceptance test:** Inject out-of-order sequence, assert charge eventually reaches expected state without manual intervention.
- **Scope:** S (1 day)

#### D-P1-4 `spending_budgets` FK ON DELETE RESTRICT (AC-ADV-10)

- **Source:** `tasks/todo.md:2649`
- **Problem:** `SETTINGS_EDIT` admin can hard-delete a budget while in-flight `agent_charges` reference it, orphaning charges.
- **Expected behaviour:** FK constraint with `ON DELETE RESTRICT`; admin must reassign or wait for in-flight charges to settle before deletion.
- **Acceptance test:** Attempt to delete budget with active charge fails with FK error; settled charges allow deletion.
- **Scope:** XS (hours)

#### D-P1-5 `PATCH /api/spending-budgets/:id` `disabledAt` validation (AC-ADV-11)

- **Source:** `tasks/todo.md:2652`
- **Problem:** `Invalid Date` becomes `NaN` in storage path, surfaces as obscure DB error rather than a clean 400.
- **Expected behaviour:** Zod schema validates `disabledAt` as ISO date; reject 400 on parse failure.
- **Acceptance test:** Invalid string → 400 with explicit validation message.
- **Scope:** XS (hours)

#### D-P1-6 `upsertRecommendation` 23505-race / advisory-lock concurrency tests (PR #250 F9)

- **Source:** `tasks/todo.md:382`
- **Problem:** Hot path tests cover deterministic skips; the race-loser path is untested.
- **Expected behaviour:** Add concurrent-test fixture (two awaiters racing the same recommendation key) and assert exactly one inserts, one observes the existing row.
- **Acceptance test:** Test green; coverage report shows race-loser branch hit.
- **Scope:** S (1 day)

#### D-P1-7 Workflow run depth metadata path drift (REQ 15-8)

- **Source:** `tasks/todo.md:2797`
- **Problem:** Stored at `_meta.workflowRunDepth`; spec calls for `metadata.workflow_run_depth`. Downstream consumers will diverge.
- **Expected behaviour:** Single canonical path `metadata.workflow_run_depth`. Migration backfills existing rows; producer/consumer code aligned.
- **Acceptance test:** Both old and new rows readable from new path post-migration.
- **Scope:** XS (hours)

#### D-P1-8 Engine-not-found dispatcher emits canonical event code (REQ W1-38)

- **Source:** `tasks/todo.md:732`
- **Problem:** Emits a non-vocabulary `automation_execution_error` code; harder to triage in incidents.
- **Expected behaviour:** Use `engine_not_found` from §5.7 vocabulary.
- **Acceptance test:** Force missing engine, assert canonical code in emitted event.
- **Scope:** XS (hours)

#### D-P1-9 Pool-fingerprint algorithm + `approval.queued`/`ask.queued` emission (REQ 9-11)

- **Source:** `tasks/todo.md:2762`
- **Problem:** FNV vs SHA-256 algorithm divergence. Open Approval cards have no signal to refresh because queued events not emitted.
- **Expected behaviour:** Single algorithm (SHA-256) used consistently; emit `approval.queued` and `ask.queued` events in the engine.
- **Acceptance test:** UI receives queued event on enqueue and updates without polling.
- **Scope:** S (1 day)

#### D-P1-10 `file.created` task event producer (REQ 13-9)

- **Source:** `tasks/todo.md:2787`
- **Problem:** No producer emits `file.created`. Files tab can't react in real time; auto-select-latest broken.
- **Expected behaviour:** File-creation paths emit `file.created` via `appendAndEmitTaskEvent`.
- **Acceptance test:** Create file in test, assert event observed by Files tab subscriber.
- **Scope:** XS (hours)

#### D-P1-11 `task.degraded` server emit (REQ 11-extra)

- **Source:** `tasks/todo.md:2776`
- **Problem:** Client expects `task.degraded` for projection rebuild on consumer-gap; server never emits it. Column unused.
- **Expected behaviour:** Server detects gap (consumer sequence behind producer by threshold) and emits `task.degraded`. Client triggers full rebuild.
- **Acceptance test:** Inject sequence gap, assert event emitted, client rebuilds.
- **Scope:** XS (hours)

#### D-P1-12 `rate_limit_buckets` PK includes `window_sec` or namespacing convention

- **Source:** `tasks/todo.md:1567`
- **Problem:** If the same key is reused with two different window sizes, sliding window corrupts.
- **Expected behaviour:** Either add `window_sec` to PK, or document and enforce a namespacing convention (`{purpose}:{window}:{key}`).
- **Acceptance test:** Mixed-window writes against same key handled deterministically.
- **Scope:** XS (hours)

#### D-P1-13 Migration 0275 grant-management UNIQUE verified

- **Source:** `tasks/todo.md:2700`
- **Problem:** Multi-tab race on grant management mitigated by DB UNIQUE; verify migration 0275 in place.
- **Expected behaviour:** Migration present and applied in all environments; integration test confirms two simultaneous grants → one succeeds, one returns 409.
- **Acceptance test:** Concurrent-grant test green.
- **Scope:** XS (hours)

#### D-P1-14 REQ §1.1 Gap E payload-insert post-commit invariant verification

- **Source:** `tasks/todo.md:1267`
- **Problem:** Now superseded by tx wrap; verify no regression in contested-key DELETE path.
- **Expected behaviour:** Existing test exercises the contested-key path; passes.
- **Acceptance test:** Test green.
- **Scope:** XS (hours)

---

## 5. Bucket 3 — Scalability blockers

### 5.1 P1 — Phase 2

#### SC-P1-1 Org-id indexes on hot tables (item 12)

- **Source:** `tasks/todo.md:33`
- **Problem:** Schema lacks `organisationId` indexes on `agentTriggers`, `processConnectionMappings`, `processedResources`, `reviewItems`. Every per-org query scans the full table.
- **Expected behaviour:** Migration adds B-tree index on `organisation_id` for each table. Where natural composite makes sense (`organisation_id, created_at`), prefer composite.
- **Acceptance test:** `EXPLAIN ANALYZE` of a representative per-org query on each table shows index scan, not seq scan.
- **Scope:** XS (hours)

#### SC-P1-2 `scopeResolutionService.findEntitiesMatching` ILIKE protection

- **Source:** `tasks/todo.md:417`
- **Problem:** ILIKE `%hint%` produces full table scans on short queries. No min-length guard, no trigram index.
- **Expected behaviour:** Either enforce min-length 3 on hints (return empty result faster), or add `pg_trgm` GIN index on the searched columns. Pick whichever requires the smaller migration.
- **Acceptance test:** Single-character hint either short-circuits to empty result or completes ≤ 50ms on representative dataset.
- **Scope:** S (1 day)

#### SC-P1-3 `enumerateAgencyLocations` cap and circuit breaker

- **Source:** `tasks/todo.md:2526`
- **Problem:** Up to ~160s wall-clock under sustained 5xx with no breaker. INSTALL_company webhook caller has no timeout wrapper.
- **Expected behaviour:** Hard cap on total wall-clock per call (30s); per-org circuit breaker opens after N consecutive 5xx and short-circuits subsequent calls for cooldown window.
- **Acceptance test:** Force sustained 5xx in test, assert breaker opens and call returns within 30s.
- **Scope:** S (1 day)

#### SC-P1-4 Hybrid executor live-fetch ID-scoped (chatgpt finding #1 — remainder)

- **Source:** `tasks/todo.md:539`
- **Problem:** Hybrid query silently drops matching rows beyond the provider's first page of 50.
- **Expected behaviour:** Live-fetch path requests by ID set rather than first page, or paginates to completion before merging with cached set.
- **Acceptance test:** Test with > 50 matching rows returns the full set, not the first 50.
- **Scope:** M (2-4 days)

### 5.2 P2 — Phase 3

#### SC-P2-1 Migration 0240 / large-table CONCURRENTLY index swap pre-deploy prep

- **Source:** `tasks/todo.md:1328`
- **Problem:** Single-tx `CREATE UNIQUE INDEX` takes ACCESS EXCLUSIVE lock. Fine pre-launch with empty tables; plan the CONCURRENTLY phased migration before first prod deploy.
- **Expected behaviour:** Phased migration: create index CONCURRENTLY in one statement, then add the constraint USING INDEX in a follow-up statement. Document in deploy runbook.
- **Acceptance test:** Deploy runbook entry exists; migration applied without exclusive lock against a populated test table.
- **Scope:** S (1 day)

#### SC-P2-2 Migration 0276 `workflow_runs.task_id NOT NULL` staging

- **Source:** `tasks/todo.md:2839`
- **Problem:** Single ALTER fails on apply if rows exist. Restage as nullable→backfill→NOT NULL before first prod deploy.
- **Expected behaviour:** Three-step migration: add column nullable, backfill with deterministic value or default, alter to NOT NULL. Each step verified in staging.
- **Acceptance test:** Migration applies cleanly against a populated staging dataset.
- **Scope:** XS (hours)

#### SC-P2-3 `clientPulseHighRiskService.getPrioritisedClients` parallelisation (N7)

- **Source:** `tasks/todo.md:861`
- **Problem:** Six sequential round-trips on a hot path.
- **Expected behaviour:** Parallelise with `Promise.all`; latency drops to slowest single round-trip.
- **Acceptance test:** Latency comparison: post-change p50 < pre-change p50 / 4 on representative dataset.
- **Scope:** XS (hours)

---

## 6. Bucket 4 — Operational readiness

### 6.1 P0 — Phase 1

#### O-P0-1 Wire `verify-workspace-actor-coverage.ts` into CI (D15)

- **Source:** `tasks/todo.md:1723`
- **Problem:** Spec acceptance criterion can't be evaluated; CI workflows directory absent for this verifier.
- **Expected behaviour:** GitHub Actions workflow runs the verifier on every PR; failure blocks merge.
- **Acceptance test:** Intentional regression in fixture file makes CI red.
- **Scope:** S (1 day)

#### O-P0-2 Sweep input-validation + permission-scope verifier warnings (P3-M13/M14)

- **Source:** `tasks/todo.md:934`, `tasks/todo.md:935`
- **Problem:** `verify-input-validation.sh` and `verify-permission-scope.sh` warn on routes lacking Zod / permission checks. Manual sweep needed before launch.
- **Expected behaviour:** Every warning either resolved (validation + permission added) or explicitly waived with comment justifying the waiver. CI gate flips from warning to failure on completion.
- **Acceptance test:** CI runs both verifiers as failures, not warnings; both pass.
- **Scope:** S (1-2 days)

#### O-P0-3 Backup/restore runbook + reseed-script env guard

- **Source:** `tasks/todo.md:1372`
- **Problem:** No backup/restore runbook anywhere. `_reseed_drop_create.ts` lacks env guard against running outside development. Production safety relies on operator vigilance.
- **Expected behaviour:** Runbook checked into `docs/runbooks/backup-restore.md` covering point-in-time recovery, verified restore drill, RPO/RTO targets. Script asserts `NODE_ENV !== 'production'` at top; fails fast otherwise.
- **Acceptance test:** Manual restore drill executed against staging from a recent prod-like snapshot; runbook updated with any gaps. Attempt to run reseed in production-env shell exits non-zero.
- **Scope:** S (1 day)

#### O-P0-4 Wrap `scripts/_reseed_restore_users.ts` in transaction

- **Source:** `tasks/todo.md:1367`
- **Problem:** Runs outside transaction; partial state on Ctrl-C / DB blip.
- **Expected behaviour:** Wrap in `db.transaction`; on error, full rollback.
- **Acceptance test:** Inject mid-script error, assert no partial state in DB.
- **Scope:** XS (hours)

#### O-P0-5 Skill-analyzer pipeline observability fixes (R3/F11)

- **Source:** `tasks/todo.md:400`
- **Problem:** `conversationId: ''` TODO markers; race-retry path doesn't log retry count. Resume + patch paths blind to operators.
- **Expected behaviour:** Every log line in the pipeline carries the conversation id. Retry count logged at each retry. TODOs removed.
- **Acceptance test:** Run a fixture conversation through the pipeline; logs trace resume + patch with consistent conversationId and retry counts.
- **Scope:** XS (hours)

### 6.2 P1 — Phase 2

#### O-P1-1 React `ErrorBoundary` component

- **Source:** `tasks/todo.md:58`
- **Problem:** A single component throw whitescreens the whole app.
- **Expected behaviour:** Top-level `ErrorBoundary` wraps the app shell; falls back to a friendly error UI with reload + report link. Per-route boundaries on heavy pages prevent cross-route blast.
- **Acceptance test:** Force a render error in a leaf component; surrounding UI remains usable; error logged to monitoring.
- **Scope:** XS (hours)

#### O-P1-2 Axios request timeout

- **Source:** `tasks/todo.md:27`
- **Problem:** No timeout on the axios instance. Hanging requests freeze pages indefinitely.
- **Expected behaviour:** 15s default timeout on the shared axios instance; per-call override available for known long endpoints.
- **Acceptance test:** Request that hangs 16s rejects client-side with timeout error.
- **Scope:** XS (hours)

#### O-P1-3 Silent-catch sweep across client API calls (item 16, CR-237-3)

- **Source:** `tasks/todo.md:28`, `tasks/todo.md:1751`
- **Problem:** 12+ client API calls swallow errors with `.catch(() => {})`. Users see blank states when fetches fail.
- **Expected behaviour:** Every silent catch reviewed; classified as either intentional (with explanatory comment) or replaced with proper error handling that surfaces a toast / error UI.
- **Acceptance test:** Static check enforces no `.catch(() => {})` outside explicitly-allowlisted call sites with comment justification.
- **Scope:** M (2-4 days)

#### O-P1-4 Centralised audit log for auth/permission events (item 27)

- **Source:** `tasks/todo.md:52`
- **Problem:** No central audit trail for auth/permission events. (Compliance + incident triage gap.)
- **Expected behaviour:** `audit_events` table receives a row for every login, logout, permission grant/revoke, password change, role change, OAuth install, OAuth revoke, cross-org bypass, and impersonation event. Retention policy documented.
- **Acceptance test:** Each event type triggered in test produces exactly one audit row with the expected schema.
- **Scope:** M (2-4 days)

#### O-P1-5 Webhook 5xx incident coverage on Slack + Teamwork webhooks

- **Source:** `tasks/todo.md:1495`
- **Problem:** `slackWebhook.ts` and `teamworkWebhook.ts` 5xx paths don't call `recordIncident`. GHL pattern not mirrored.
- **Expected behaviour:** Both handlers wrap their 5xx paths in the same `recordIncident` envelope as GHL.
- **Acceptance test:** Force 5xx in test, assert incident row written for each handler.
- **Scope:** XS (hours)

#### O-P1-6 `PULSE_CURSOR_SECRET` startup assertion (S2)

- **Source:** `tasks/todo.md:831`
- **Problem:** Fallback warning fires per request in production today. Noise hides real issues.
- **Expected behaviour:** Production startup fails fast if secret unset, OR one-shot warning logged at boot rather than per request.
- **Acceptance test:** Boot-time assertion test; secret-missing run fails fast.
- **Scope:** XS (hours)

#### O-P1-7 Verify Dashboard / ClientPulseDashboard error states (S3)

- **Source:** `tasks/todo.md:835`
- **Problem:** Marked DONE in todo; verify in branch as part of P1 sweep.
- **Expected behaviour:** Both pages handle fetch failures with explicit error UI, not silent blanks.
- **Acceptance test:** Force fetch failure, assert visible error UI.
- **Scope:** XS (hours)

#### O-P1-8 `testRunRateLimit.ts` multi-process safety (P3-M1)

- **Source:** `tasks/todo.md:959`
- **Problem:** In-memory rate limiter not safe for multi-process. Affects `routes/public/formSubmission.ts` and `pageTracking.ts`.
- **Expected behaviour:** Replace with the same DB-backed bucket primitive as S-P0-5.
- **Acceptance test:** Multi-process test confirms enforcement.
- **Scope:** S (1 day)

#### O-P1-9 GHL slug-collision UUID third tier

- **Source:** `tasks/todo.md:2542`
- **Problem:** Without it, an operator runbook entry is required at every slug collision.
- **Expected behaviour:** Slug-collision resolution falls back to UUID suffix as a final tier; no operator intervention required.
- **Acceptance test:** Inject collision, assert UUID-suffixed slug allocated automatically.
- **Scope:** XS (hours)

#### O-P1-10 Centralise GHL retry classification

- **Source:** `tasks/todo.md:2540`
- **Problem:** `isRetryable` predicate inlined at every `withBackoff` call site; helper prevents drift.
- **Expected behaviour:** Single helper exported and consumed at every call site.
- **Acceptance test:** Static check verifies no inline `isRetryable` outside helper.
- **Scope:** XS (hours)

#### O-P1-11 GHL agency-level canonical mutations need carrier subaccount

- **Source:** `tasks/todo.md:2522`
- **Problem:** Staff Activity Pulse short-circuits to `skipped_no_subaccount` because agency-scope rows have no carrier subaccount.
- **Expected behaviour:** Either provision an agency-root subaccount, or make `subaccount_id` nullable on canonical mutations and update consumers to handle null as agency-scope.
- **Acceptance test:** Staff Activity Pulse processes agency-scope mutation without skip.
- **Scope:** M (2-4 days)

#### O-P1-12 System-monitoring agent idempotency + per-fingerprint backpressure

- **Source:** `tasks/todo.md:887`, `tasks/todo.md:889`
- **Problem:** `recordIncident` lacks idempotency guard; tight-loop failure could blow up the event log.
- **Expected behaviour:** Idempotency key (fingerprint + window) deduplicates rapid duplicate incidents. Per-fingerprint throttle caps writes per minute.
- **Acceptance test:** Tight loop emits 1000 identical incidents in 10s; event log shows ≤ N rows where N is the throttle ceiling.
- **Scope:** S (1 day)

#### O-P1-13 Verify cross-org `auditService.log` is firing in production (item 23)

- **Source:** `tasks/todo.md:40`
- **Problem:** Marked CLOSED; verify behaviour in production.
- **Expected behaviour:** Production smoke trigger of cross-org access produces audit row.
- **Acceptance test:** Manual smoke test or synthetic monitor.
- **Scope:** XS (hours)

### 6.3 P2 — Phase 3

#### O-P2-1 Workflows-v1 observability counters (REQ 9-14)

- **Source:** `tasks/todo.md:2772`
- **Problem:** Ten prom-style counters named in the plan but not implemented.
- **Expected behaviour:** Counters implemented and exposed via the existing metrics endpoint.
- **Acceptance test:** Triggering each named workflow event increments the corresponding counter.
- **Scope:** S (1 day)

#### O-P2-2 Centralise `JobResult` discriminated union (CHATGPT-PR203-BONUS)

- **Source:** `tasks/todo.md:1100`
- **Problem:** System-thinking / observability hygiene; useful for partial-success reporting across job types.
- **Expected behaviour:** Single `JobResult` discriminated union consumed by every job type and the monitoring layer.
- **Acceptance test:** Type-check across all job consumers; monitoring layer handles every variant explicitly.
- **Scope:** M (2-4 days)

---

## 7. Bucket 5 — Customer-facing correctness

### 7.1 P0 — Phase 1

#### C-P0-1 Implement `integrationBlockService.checkRequiredIntegration` (E-D3 stub)

- **Source:** `tasks/todo.md:1870`
- **Problem:** Stub returns `shouldBlock: false`. The "agent pauses for missing integration → user reconnects → run resumes" feature is dead code today. Customers see runs fail instead of pausing for OAuth.
- **Expected behaviour:** Service inspects the agent's required-integrations against the resolved subaccount's connection set; returns `{ shouldBlock: true, missing: [...] }` when any required integration is missing, expired, or revoked.
- **Acceptance test:** Run an agent with a missing integration; assert run pauses with a `requires_integration` event and visible UI card. Reconnect; assert run resumes (depends on C-P0-2).
- **Scope:** M (2-4 days)

#### C-P0-2 OAuth resume restart wiring (R4/F1, R5/F5, Sprint 3B)

- **Source:** `tasks/todo.md:397`, `tasks/todo.md:394`
- **Problem:** Connect flow shows "Connected! Continuing execution…" but execution restart isn't wired. Run never continues.
- **Expected behaviour:** On successful OAuth callback for a paused run, server enqueues a resume job for that run; client toast reflects actual resume state. UI copy changes only after resume is wired.
- **Acceptance test:** End-to-end: agent pauses on missing integration, user completes OAuth, run reaches a terminal state without manual nudge.
- **Scope:** M (2-4 days)

#### C-P0-3 Universal Brief: wire approve/reject + draft-candidates routes (DR1, DR3)

- **Source:** `tasks/todo.md:471`, `tasks/todo.md:473`
- **Problem:** `BriefApprovalCard` renders Approve/Reject buttons but click silently no-ops (404). Primary write path dark.
- **Expected behaviour:** `/api/rules/draft-candidates` returns the candidate list; `/api/rules/draft-candidates/:id/approve` and `/reject` mutate state and emit events. UI reflects state transition.
- **Acceptance test:** Click Approve; row transitions to approved; event observed; UI updates.
- **Scope:** M (2-4 days)

#### C-P0-4 Plan-vs-impl: thread context injection at run start + resume (A-D1)

- **Source:** `tasks/todo.md:1845`
- **Problem:** Right-pane context UI works but the LLM never sees conversation tasks/decisions during execution. Re-injection on resume also missing.
- **Expected behaviour:** Run start packs thread-context tasks/decisions into the system prompt; resume re-packs current snapshot before continuing.
- **Acceptance test:** Start run referencing a context-managed task; LLM trace shows the task in the prompt. Resume after context update; trace shows updated snapshot.
- **Scope:** S (1-2 days)

#### C-P0-5 Email tile renders config UI (D-D1)

- **Source:** `tasks/todo.md:1890`
- **Problem:** Email-channel tile is a placeholder. Users can't configure per-agent email or see the editor.
- **Expected behaviour:** Tile renders the existing email-config editor when present; hides the tile entirely if email channel not part of agent definition (do not ship a half-built surface).
- **Acceptance test:** Configure agent email through the tile; settings persist; agent uses them at runtime.
- **Scope:** S (1-2 days)

#### C-P0-6 Soft-delete join sweep across operational + org-chart paths

- **Source:** `tasks/todo.md:1543`
- **Problem:** 17 paths missing soft-delete filtering. Deleted agents/subaccounts reappear in routing, hierarchy, workspace health. Routing may target deleted agents.
- **Expected behaviour:** Every join referenced in the audit-tagged list filters `deleted_at IS NULL` (or equivalent). Lint rule blocks future regressions.
- **Acceptance test:** Soft-delete an agent; run the routing path; deleted agent is not selected. Repeat for each of the 17 paths.
- **Scope:** M (2-4 days)

#### C-P0-7 `AgentMailboxPage` / `AgentCalendarPage` shape mismatches (D7, D8)

- **Source:** `tasks/todo.md:1647`, `tasks/todo.md:1652`
- **Problem:** Page expects `toAddress`; route returns `toAddresses`. Page renders empty.
- **Expected behaviour:** Either route returns the expected shape, or page consumes the new shape. Pick the representation aligned with backend storage (likely `toAddresses`); update consumers.
- **Acceptance test:** Both pages render expected data end-to-end.
- **Scope:** XS (hours)

#### C-P0-8 Per-row "Onboard to workplace" CTA conditional (D10)

- **Source:** `tasks/todo.md:1662`
- **Problem:** CTA renders for every row regardless of identity status.
- **Expected behaviour:** CTA only renders when row is in an onboardable state (no identity, identity pending, etc.). Verify Phase E routing closed this.
- **Acceptance test:** Already-onboarded row shows no CTA; pending row shows CTA.
- **Scope:** XS (hours)

### 7.2 P1 — Phase 2

#### C-P1-1 Resume path 500ms thread-context build timeout (R1/F3a)

- **Source:** `tasks/todo.md:387`
- **Problem:** Slow context build during resume delays the run.
- **Expected behaviour:** Extract a helper with 500ms timeout; on timeout, resume with last-known-good snapshot and log the slow path.
- **Acceptance test:** Inject 1s artificial delay; resume completes in ≤ 600ms with degraded-snapshot log.
- **Scope:** XS (hours)

#### C-P1-2 `OnboardAgentModal` deep-link to identity tab on success (D9)

- **Source:** `tasks/todo.md:1657`
- **Problem:** New agent lands on wrong tab post-onboard. Mostly closed; verify.
- **Expected behaviour:** Modal close transitions to identity tab; URL updates.
- **Acceptance test:** Complete onboard flow; assert correct tab + URL.
- **Scope:** XS (hours)

#### C-P1-3 Calendar invite iCal attachment delivery (D4)

- **Source:** `tasks/todo.md:1632`
- **Problem:** Transactional email provider drops attachments. Closed; verify.
- **Expected behaviour:** Provider sends attachments; recipient client renders calendar invite.
- **Acceptance test:** Send invite to test inbox; assert ICS file attached.
- **Scope:** XS (hours)

#### C-P1-4 Native rate-limit caps match spec (D5)

- **Source:** `tasks/todo.md:1637`
- **Problem:** Per-identity caps deviated from spec (60/hour vs 60/min,1000/hour,5000/day). Closed; verify.
- **Expected behaviour:** Three-tier window enforced per identity.
- **Acceptance test:** Burst test confirms each tier triggers at the right threshold.
- **Scope:** XS (hours)

#### C-P1-5 `signature` template defaults (D11)

- **Source:** `tasks/todo.md:1667`
- **Problem:** Signatures use raw UUIDs as subaccount name. Routed to Phase E; verify.
- **Expected behaviour:** Signature template substitutes the subaccount display name; falls back to a friendly default if name absent.
- **Acceptance test:** Generated signature reads expected human-readable name.
- **Scope:** S (1 day)

#### C-P1-6 `ConfirmName` checks display name vs UI-shown name (D14)

- **Source:** `tasks/todo.md:1682`
- **Problem:** Revoke dialog rejects valid input if name was edited. Closed; verify.
- **Expected behaviour:** Confirm dialog compares against the actual UI-rendered string.
- **Acceptance test:** Edit name, attempt revoke with the visible name → accepted.
- **Scope:** XS (hours)

#### C-P1-7 `ExternalDocumentRebindModal` "Remove reference instead" button (REQ #C7)

- **Source:** `tasks/todo.md:1938`
- **Problem:** UX dead-end; user can't remove a broken reference, only rebind it.
- **Expected behaviour:** Add explicit Remove button; confirmation; deletes the reference and closes modal.
- **Acceptance test:** Click Remove on broken reference; reference removed; modal closes.
- **Scope:** XS (hours)

#### C-P1-8 `cache_minutes` / TTL fallback for null revisionId (REQ #C8)

- **Source:** `tasks/todo.md:1943`
- **Problem:** Permanent cache-miss loop for any provider/file with no revisionId.
- **Expected behaviour:** Time-based TTL (e.g., 30 minutes) used when revisionId absent. After TTL, refetch.
- **Acceptance test:** Force null revisionId; second access within TTL hits cache; access after TTL refetches.
- **Scope:** S (1 day)

#### C-P1-9 External-doc placeholder format + budget-exceeded write-events (REQ #C10, #C11)

- **Source:** `tasks/todo.md:1953`, `tasks/todo.md:1958`
- **Problem:** Provenance shape inconsistent; budget-exceeded reference produces no audit row.
- **Expected behaviour:** Single canonical placeholder format; every budget-exceeded path writes an audit row.
- **Acceptance test:** Force budget-exceeded; audit row written; placeholder shape matches spec.
- **Scope:** XS (hours)

#### C-P1-10 PDF support requires `pdf-parse` dependency

- **Source:** `tasks/todo.md:1968`
- **Problem:** Every PDF attachment lands as `unsupported_content`; reference marked broken.
- **Expected behaviour:** Add `pdf-parse` to deps; wire into the document-extraction path; PDFs produce parsed text.
- **Acceptance test:** Attach PDF; reference resolves with text content.
- **Scope:** XS (hours)

#### C-P1-11 Unify `/api/briefs` and `/api/session/message` response envelopes

- **Source:** `tasks/todo.md:414`
- **Problem:** Two parallel entry points return different shapes; bug surface for future divergence.
- **Expected behaviour:** Both routes return the same envelope `{ data, errors, meta }`. Existing consumers updated.
- **Acceptance test:** Schema test asserts identical envelope shape.
- **Scope:** S (1 day)

#### C-P1-12 Path C `organisationName` / `subaccountName` non-null (F15)

- **Source:** `tasks/todo.md:419`
- **Problem:** Always null today; tighten contract.
- **Expected behaviour:** Both fields populated from resolved org/subaccount; consumers updated.
- **Acceptance test:** Path C response carries non-null values.
- **Scope:** XS (hours)

#### C-P1-13 `useTaskProjection` full-rebuild pagination (pr-S6)

- **Source:** `tasks/todo.md:2825`
- **Problem:** Server caps at 1000 silently; client doesn't paginate.
- **Expected behaviour:** Server returns `hasMore`; client loops until exhausted.
- **Acceptance test:** Task with > 1000 events fully rebuilt.
- **Scope:** XS (hours)

#### C-P1-14 Mailbox client pagination (CR-237-2)

- **Source:** `tasks/todo.md:1746`
- **Problem:** Half-built pagination; today bounded under 50/agent.
- **Expected behaviour:** Either complete the pagination or remove the half-built UI affordance.
- **Acceptance test:** Mailbox with > 50 messages renders without truncation, with pagination control or infinite scroll.
- **Scope:** XS (hours)

#### C-P1-15 `InlineIntegrationCard` dismissed state persistence (E-D6, R5/F9)

- **Source:** `tasks/todo.md:1885`, `tasks/todo.md:395`
- **Problem:** Card reappears after reload; PATCH route missing.
- **Expected behaviour:** Dismiss persists via PATCH to user-preferences (or per-agent state); reload preserves.
- **Acceptance test:** Dismiss; reload; card stays dismissed.
- **Scope:** XS (hours)

#### C-P1-16 AC subaccount budget enumeration mitigation (AC-ADV-2)

- **Source:** `tasks/todo.md:2626`
- **Problem:** Same-org callers can guess subaccount IDs to read budget summaries.
- **Expected behaviour:** Caller must have explicit `budget.read` on the target subaccount; otherwise 404 (not 403, to avoid existence disclosure).
- **Acceptance test:** Cross-subaccount read attempt → 404.
- **Scope:** XS (hours)

### 7.3 P2 — Phase 3

#### C-P2-1 Riley Workflows / Automations library pages simplification (REQ W1-52/53)

- **Source:** `tasks/todo.md:731`
- **Problem:** Pages still show pre-rename templates UI. UI/UX simplification per Mock 08/09.
- **Expected behaviour:** Pages match Mock 08/09 layouts. Frontend Design Principles applied (one primary action per screen, defaults hidden).
- **Acceptance test:** Visual comparison to mocks; primary task completable by non-technical operator without training.
- **Scope:** M (2-4 days)

#### C-P2-2 Bulk approve/reject `subaccountId` emit (verify CLOSED)

- **Source:** `tasks/todo.md:1169`
- **Problem:** Marked CLOSED; verify single emit no longer carries `subaccountId: null`.
- **Expected behaviour:** Bulk emit carries the resolved subaccountId.
- **Acceptance test:** Bulk fixture; assert emit shape.
- **Scope:** XS (hours)

---

## 8. Bucket 6 — Compliance and legal

### 8.1 P1 — Phase 2

#### CL-P1-1 Centralised security audit log (cross-reference O-P1-4)

- **Source:** `tasks/todo.md:52`
- **Problem:** Re-listed for compliance traceability. Logging auth/permission events is also a compliance baseline.
- **Expected behaviour:** Same as O-P1-4 — single shared implementation. Compliance-side requirements: retention policy documented, immutable append-only schema, exportable for audit.
- **Acceptance test:** Same as O-P1-4 plus retention-policy doc reviewed.
- **Scope:** Tracked under O-P1-4 — no separate scope.

#### CL-P1-2 Data deletion / erasure runbook

- **Source:** Inferred from absence in `todo.md`
- **Problem:** Soft-delete is in place but no spec or runbook for hard-delete or purge in response to a deletion request.
- **Expected behaviour:** Runbook in `docs/runbooks/data-deletion.md` covering: identification of all rows tied to a subject, hard-delete order respecting FK constraints, audit-trail of the deletion operation itself, and provider-side deletion (e.g., Stripe customer, SendGrid contact) where applicable. SLA target documented.
- **Acceptance test:** Tabletop walkthrough against staging dataset; runbook tracks all subject rows.
- **Scope:** M (2-4 days)

#### CL-P1-3 Audit trail for retry attempts on non-idempotent endpoints (R2-5)

- **Source:** `tasks/todo.md:746`
- **Problem:** When the retry endpoint is built, it must include audit log entry per attempt.
- **Expected behaviour:** Every retry attempt produces an `audit_events` row with the original request ID, retry count, outcome.
- **Acceptance test:** Force three retries; assert three audit rows.
- **Scope:** S (1 day)

---

## 9. Cross-cutting concerns and dependencies between items

### 9.1 Dependency chain map

Several items unblock or constrain others. Build sequence must respect this chain:

- **S-P0-5 (DB-backed rate limit primitive)** unblocks **S-P0-9** (forgot/reset password) and **O-P1-8** (testRunRateLimit). Build the primitive once; consume three times.
- **S-P0-2 (cluster-safe OAuth state store)** unblocks **S-P0-1 (state-nonce binding)**. Verify them together; binding without cluster-safe storage is half-secure.
- **S-P0-4 (auto-start onboarding GUC propagation)** is a precondition for **D-P0-1 (pg-boss enqueue)**. The GUC must be set on the worker too, not just the webhook.
- **D-P0-5 (durable task event emission)** is a precondition for **D-P1-9 (`approval.queued`/`ask.queued`)**, **D-P1-10 (`file.created`)**, and **D-P1-11 (`task.degraded`)**. All four use the same `appendAndEmitTaskEvent` API.
- **C-P0-1 (`integrationBlockService` implementation)** is a precondition for **C-P0-2 (OAuth resume restart)**. The block service must report `shouldBlock: true` before there's a paused run to resume.
- **O-P1-4 (centralised audit log)** is a precondition for **CL-P1-3 (retry-attempt audit)** and is the same line item as **CL-P1-1**. Build once; consume from compliance and ops sides.
- **O-P0-2 (verifier sweep) + O-P0-1 (CI wiring)** must land before any P1 work begins or the team will accumulate fresh debt under the new gates.

### 9.2 Shared building blocks

The following primitives appear across multiple items. Build each once and use everywhere:

1. **DB-backed rate-limit primitive** — `rate_limit_buckets` (already partially present). Used by S-P0-5, S-P0-9, O-P1-8.
2. **Cluster-safe state store** — for OAuth state, possibly other ephemeral cross-instance data. Used by S-P0-2; consider for any future similar need.
3. **Audit-events table + writer** — used by O-P1-4, CL-P1-1, CL-P1-3, parts of S-P0-1, S-P1-5.
4. **`appendAndEmitTaskEvent` durable API** — used by D-P0-5, D-P0-2, D-P1-9, D-P1-10, D-P1-11, plus any new task event in scope.
5. **Soft-delete-aware lint rule** — used to enforce C-P0-6 sweep going forward.
6. **`getOrgScopedDb` enforcement** — used by S-P1-10; lint rule prevents regression on FORCE-RLS tables.

### 9.3 Coordination notes

- **Migration ordering matters.** D-P1-7 (workflow run depth metadata path), D-P1-13 (grant management UNIQUE), SC-P2-2 (`workflow_runs.task_id NOT NULL` staging), SC-P1-1 (org-id indexes), and the audit-log table from O-P1-4 should all be ordered before they're consumed. Pre-flight every migration against a populated staging copy.
- **Webhook + worker GUC discipline.** Any code path that runs without an authenticated session and touches FORCE-RLS tables must explicitly set `app.organisation_id`. S-P0-4 fixes this for auto-start onboarding; sweep all webhook + queue-worker entry points to ensure no other path is missing the same pattern.
- **Linting + CI enforcement before merging in scope.** O-P0-1 and O-P0-2 land first so subsequent work cannot regress the verifiers.
- **Feature-flag posture.** Per `docs/spec-context.md` framing: pre-production, no feature flags. Half-built customer surfaces (C-P0-5 email tile) are either completed or hidden. Do not introduce a flag to ship partial work.

### 9.4 Rollout & merge strategy

- Each phase tracked on its own branch off main: `claude/pre-launch-phase-1`, `-phase-2`, `-phase-3`.
- Phase 1 chunked into ~6-8 PRs, scoped by bucket. Phase 2 chunked similarly.
- Branch-level review pass at end of each phase: `spec-conformance` → `pr-reviewer` → `adversarial-reviewer` → `dual-reviewer` (if local Codex available) → `chatgpt-pr-review`.
- No phase merges to main until its exit gate is met.

---

## 10. Acceptance criteria and verification plan per phase

### 10.1 Phase 1 exit gate

All of the following must be true before Phase 1 PR merges and Phase 2 work begins:

**Functional verification**
- One full agency-onboarding smoke test passes end-to-end on staging (signup → OAuth install → auto-start onboarding → first agent run → OAuth pause → reconnect → resume → completion).
- Universal Brief: approve and reject paths exercised on a real fixture; events observed; UI updates.
- Soft-delete sweep: at least three of the seventeen identified paths exercised manually with deleted entities; deleted entity not selected.

**Security verification**
- `adversarial-reviewer` returns no P0 findings against the Phase 1 branch diff.
- Cross-org state-nonce hijack test (S-P0-1) green.
- Cross-instance OAuth state read (S-P0-2) green.
- Cross-subaccount `workflow_drafts` read returns 404 (S-P0-3).
- Multi-process rate-limit test (S-P0-5) green.
- Webhook with missing/invalid HMAC returns 401 (S-P0-6); production startup fails fast on missing secret.
- 26MB upload returns 413 (S-P0-8).

**Data integrity verification**
- Concurrent thread-context patch test (D-P0-4) green.
- Durable task event reload test (D-P0-5) green for all six listed event types.
- Resolver atomicity test (D-P0-6) green.
- Run-depth fail-fast test (D-P0-7) green at every entry point.
- Direct `workflow_runs` INSERT 23505→409 conversion (D-P0-3) green.
- `step.approval_resolved` event emitted in same transaction as state transition (D-P0-2).

**Operational verification**
- `verify-workspace-actor-coverage` runs in CI (O-P0-1).
- `verify-input-validation` and `verify-permission-scope` run as failures (not warnings) in CI (O-P0-2).
- Backup/restore drill executed against staging snapshot (O-P0-3).
- Reseed script env-guard rejects production env (O-P0-3).
- Restore-users script wrapped in transaction (O-P0-4).

**Static checks**
- `npm run lint` clean.
- `npm run typecheck` clean.
- `npm run build:server` and `npm run build:client` clean.

**Review pass**
- `spec-conformance` returns CONFORMANT against this spec.
- `pr-reviewer` returns no must-fix findings.
- `adversarial-reviewer` invoked; no P0.
- `dual-reviewer` invoked if Codex available locally.

### 10.2 Phase 2 exit gate

All Phase 1 conditions remain true. Additionally:

**Cross-cutting client foundations**
- `ErrorBoundary` rendered in app shell; force-error fixture proves recovery (O-P1-1).
- Axios timeout enforced (O-P1-2); 16s hang test rejects.
- Silent-catch sweep complete; static check enforces no unjustified `.catch(() => {})` (O-P1-3).

**Audit + observability**
- Centralised audit log (O-P1-4 / CL-P1-1) producing rows for every documented event type.
- Webhook 5xx incident rows written for Slack and Teamwork (O-P1-5).
- System-monitoring agent throttle + idempotency green (O-P1-12).

**Customer-correctness P1s**
- All P1 items in §7.2 marked closed or explicitly waived in `tasks/todo.md` with reasoning.
- PDF attachment fixture resolves with text content (C-P1-10).
- Brief and session-message envelopes match by schema test (C-P1-11).
- Cross-subaccount budget read returns 404 (C-P1-16).

**Schema + scalability**
- Org-id indexes verified by `EXPLAIN` on each (SC-P1-1).
- ILIKE protection in place (SC-P1-2).
- `enumerateAgencyLocations` breaker green (SC-P1-3).
- Hybrid executor returns full result set on > 50 matches (SC-P1-4).

**Compliance**
- Data-deletion runbook reviewed and committed (CL-P1-2).
- Retry-attempt audit rows confirmed (CL-P1-3).

**Review pass**
- Full `spec-conformance` + `pr-reviewer` + `adversarial-reviewer` + `chatgpt-pr-review` pass.
- CI gate suite green (CI runs full suite; local agents do not).

### 10.3 Phase 3 exit gate

All Phase 2 conditions remain true. Additionally:

- Workflows v1 pages match Mock 08/09 (C-P2-1).
- Observability counters increment as expected (O-P2-1).
- `JobResult` discriminated union consumed everywhere (O-P2-2).
- Migration CONCURRENTLY prep documented (SC-P2-1, SC-P2-2).
- N+1 parallelisation latency improved per spec (SC-P2-3).

OR: each unfinished P2 explicitly re-deferred to post-launch with owner + ETA in `tasks/todo.md`. Re-deferral is an acceptable Phase 3 exit; partial completion is not — every item is either closed or explicitly re-deferred.

### 10.4 Pre-merge checklist (any phase)

- All chunks built; all unit tests green for newly authored pure functions.
- Doc sync: `architecture.md`, `KNOWLEDGE.md`, `DEVELOPMENT_GUIDELINES.md`, `docs/capabilities.md`, runbooks under `docs/runbooks/` updated as required by `docs/doc-sync.md`.
- `tasks/todo.md` updated: every item closed in the phase removed; new items added during execution triaged into the right bucket.
- `tasks/current-focus.md` reflects current phase.
- `tasks/builds/pre-launch-hardening/progress.md` carries final session summary.

---

## 11. Out of scope / explicitly deferred to post-launch

The following items were judged in the triage and explicitly deferred. They are listed here so they remain visible during launch planning without inflating the work in scope.

### 11.1 Architectural refactors

- **`agent_runs` schema split into core/context/delegation** (`tasks/todo.md:433`). Reviewer flagged as "soon, not now" — weeks of refactor; appears 3+ times in the file. **Verify pre-launch:** confirm no current customer feature is blocked. If blocked, escalate.
- **Workflow versioning / marketplace primitives + execution-version pinning** (`tasks/todo.md:273`). Explicitly v2/post-partner. **Verify pre-launch:** if agency partners are onboarded faster than expected, this trigger may fire — re-evaluate at first agency-partner deal.
- **Test-mode integration test conventions (TI-005 family)** (`tasks/todo.md:407`). Architectural test cleanups deferred.

### 11.2 UX polish that doesn't block primary task

- Refactors of the agent-fleet, doc cleanups, framework polish, internal tooling improvements not surfaced in this spec.
- Performance work targeting scale we will not reach pre-launch.
- Aesthetic redesigns of pages where the primary task already works.

### 11.3 Items the operator should sanity-check before final freeze

These were judged out-of-scope but are flagged here because reasonable people might disagree:

- **Cross-tenant rejection integration tests at `/api/session/message`** (`tasks/todo.md:418`). Coverage gap at the most security-sensitive endpoint. **CEO call:** if launching with paying customers on a shared host, consider promoting to P1.
- **`agentSpendRequestHandler` derives `executionPath` from a switch instead of `ActionDefinition.executionPath`** (`tasks/todo.md:2643`). Silent mis-routing class on adding a new chargeType. Easy fix; flagging because billing mis-routing is famously expensive to detect after the fact.
- **Riley Workflows / Automations library pages simplification** (`tasks/todo.md:731`). P2 in this spec, but if these pages are the operator's day-one surface, ugly UI may hurt activation more than expected. **CEO call:** if these pages are part of the activation funnel, promote to P1.
- **JobResult discriminated union** (`tasks/todo.md:1100`). Listed P2; high-leverage system-thinking improvement. **CEO call:** if observability gaps surface during testing push, consider promoting.

### 11.4 Items already closed; no further action

Several items in the source todo.md are marked DONE / CLOSED. They appear in this spec only as verification checkpoints (e.g., O-P1-7, C-P1-2, C-P1-3, C-P1-4, C-P1-6, C-P2-2). If verification confirms closure, the item collapses to a no-op.

---

## 12. Appendix — full traceability table

Every spec item maps back to a `tasks/todo.md` line. This table allows a reviewer to walk every item to its source for full context.

| Spec ID | Title | Bucket | Severity | Phase | todo.md line |
|---------|-------|--------|----------|-------|--------------|
| S-P0-1 | OAuth callback session-org verification | Security | P0 | 1 | 2520 |
| S-P0-2 | Cluster-safe OAuth state store | Security | P0 | 1 | 2524 |
| S-P0-3 | `workflow_drafts` subaccount-scope check | Security | P0 | 1 | 2792 |
| S-P0-4 | Auto-start onboarding GUC propagation | Security | P0 | 1 | 2534 |
| S-P0-5 | Auth rate limit on DB primitive | Security | P0 | 1 | 38 |
| S-P0-6 | Webhook HMAC mandatory | Security | P0 | 1 | 39 |
| S-P0-7 | OAuth postMessage origin allowlist | Security | P0 | 1 | 396 |
| S-P0-8 | Multer body-size cap | Security | P0 | 1 | 41 |
| S-P0-9 | Forgot/reset password rate limit on DB | Security | P0 | 1 | 50 |
| S-P1-1 | Pool-membership / authz CI gate | Security | P1 | 2 | 2476 |
| S-P1-2 | Token-refresh / revocation cascade | Security | P1 | 2 | 2546 |
| S-P1-3 | Connector-config kill-switch | Security | P1 | 2 | 2550 |
| S-P1-4 | Mode-aware execute role for jobs | Security | P1 | 2 | 451 |
| S-P1-5 | RLS allowlist-bypass runtime audit | Security | P1 | 2 | 1586 |
| S-P1-6 | `assignableUsers` enumeration mitigation | Security | P1 | 2 | 2434 |
| S-P1-7 | Picker-token / verify-access guards | Security | P1 | 2 | 1923 |
| S-P1-8 | Subaccount scope on per-task connection_id | Security | P1 | 2 | 1928 |
| S-P1-9 | `streamEventsByTask` explicit org filter | Security | P1 | 2 | 2833 |
| S-P1-10 | Bare-`db` services to `getOrgScopedDb` | Security | P1 | 2 | 2831 |
| S-P1-11 | Migration 0227 over-scope follow-up | Security | P1 | 2 | 1070 |
| D-P0-1 | Auto-start onboarding via pg-boss | Data integrity | P0 | 1 | 2496 |
| D-P0-2 | `step.approval_resolved` event emission | Data integrity | P0 | 1 | 2767 |
| D-P0-3 | `workflow_runs` 23505→409 on direct INSERT | Data integrity | P0 | 1 | 2747 |
| D-P0-4 | Concurrency guard `version` predicate | Data integrity | P0 | 1 | 1850 |
| D-P0-5 | Durable `appendAndEmitTaskEvent` | Data integrity | P0 | 1 | 2817 |
| D-P0-6 | Resolver write atomicity contract | Data integrity | P0 | 1 | 1913 |
| D-P0-7 | Run depth fail-fast at every entry | Data integrity | P0 | 1 | 2797, 2835 |
| D-P1-1 | Cached-context dismissal RLS alignment | Data integrity | P1 | 2 | 582 |
| D-P1-2 | `approverPoolSnapshot` UUID normalisation | Data integrity | P1 | 2 | 2752 |
| D-P1-3 | Stripe out-of-order webhook re-enqueue | Data integrity | P1 | 2 | 2646 |
| D-P1-4 | `spending_budgets` FK ON DELETE RESTRICT | Data integrity | P1 | 2 | 2649 |
| D-P1-5 | `spending-budgets` PATCH validation | Data integrity | P1 | 2 | 2652 |
| D-P1-6 | `upsertRecommendation` race coverage | Data integrity | P1 | 2 | 382 |
| D-P1-7 | Workflow run depth metadata path | Data integrity | P1 | 2 | 2797 |
| D-P1-8 | Engine-not-found canonical event code | Data integrity | P1 | 2 | 732 |
| D-P1-9 | Pool-fingerprint algorithm + queued events | Data integrity | P1 | 2 | 2762 |
| D-P1-10 | `file.created` task event producer | Data integrity | P1 | 2 | 2787 |
| D-P1-11 | `task.degraded` server emit | Data integrity | P1 | 2 | 2776 |
| D-P1-12 | `rate_limit_buckets` window namespacing | Data integrity | P1 | 2 | 1567 |
| D-P1-13 | Migration 0275 grant UNIQUE verification | Data integrity | P1 | 2 | 2700 |
| D-P1-14 | REQ §1.1 Gap E payload-insert verification | Data integrity | P1 | 2 | 1267 |
| SC-P1-1 | Org-id indexes on hot tables | Scalability | P1 | 2 | 33 |
| SC-P1-2 | `findEntitiesMatching` ILIKE protection | Scalability | P1 | 2 | 417 |
| SC-P1-3 | `enumerateAgencyLocations` cap + breaker | Scalability | P1 | 2 | 2526 |
| SC-P1-4 | Hybrid executor live-fetch ID-scoped | Scalability | P1 | 2 | 539 |
| SC-P2-1 | Migration 0240 CONCURRENTLY prep | Scalability | P2 | 3 | 1328 |
| SC-P2-2 | Migration 0276 staging | Scalability | P2 | 3 | 2839 |
| SC-P2-3 | `clientPulseHighRiskService` parallelisation | Scalability | P2 | 3 | 861 |
| O-P0-1 | CI: workspace-actor-coverage | Op-readiness | P0 | 1 | 1723 |
| O-P0-2 | Verifier sweep: input + permission scope | Op-readiness | P0 | 1 | 934, 935 |
| O-P0-3 | Backup/restore runbook + reseed env-guard | Op-readiness | P0 | 1 | 1372 |
| O-P0-4 | `_reseed_restore_users` transaction wrap | Op-readiness | P0 | 1 | 1367 |
| O-P0-5 | Skill-analyzer pipeline observability | Op-readiness | P0 | 1 | 400 |
| O-P1-1 | React `ErrorBoundary` | Op-readiness | P1 | 2 | 58 |
| O-P1-2 | Axios request timeout | Op-readiness | P1 | 2 | 27 |
| O-P1-3 | Silent-catch sweep | Op-readiness | P1 | 2 | 28, 1751 |
| O-P1-4 | Centralised audit log | Op-readiness | P1 | 2 | 52 |
| O-P1-5 | Slack + Teamwork webhook incident coverage | Op-readiness | P1 | 2 | 1495 |
| O-P1-6 | `PULSE_CURSOR_SECRET` startup assertion | Op-readiness | P1 | 2 | 831 |
| O-P1-7 | Dashboard / ClientPulseDashboard error states | Op-readiness | P1 | 2 | 835 |
| O-P1-8 | `testRunRateLimit` multi-process safety | Op-readiness | P1 | 2 | 959 |
| O-P1-9 | GHL slug-collision UUID third tier | Op-readiness | P1 | 2 | 2542 |
| O-P1-10 | Centralise GHL retry classification | Op-readiness | P1 | 2 | 2540 |
| O-P1-11 | Agency-level mutations carrier subaccount | Op-readiness | P1 | 2 | 2522 |
| O-P1-12 | System-monitoring idempotency + throttle | Op-readiness | P1 | 2 | 887, 889 |
| O-P1-13 | Cross-org `auditService.log` verification | Op-readiness | P1 | 2 | 40 |
| O-P2-1 | Workflows-v1 observability counters | Op-readiness | P2 | 3 | 2772 |
| O-P2-2 | Centralise `JobResult` discriminated union | Op-readiness | P2 | 3 | 1100 |
| C-P0-1 | `integrationBlockService.checkRequiredIntegration` | Customer | P0 | 1 | 1870 |
| C-P0-2 | OAuth resume restart wiring | Customer | P0 | 1 | 397, 394 |
| C-P0-3 | Universal Brief approve/reject + draft-candidates | Customer | P0 | 1 | 471, 473 |
| C-P0-4 | Plan-vs-impl thread-context injection | Customer | P0 | 1 | 1845 |
| C-P0-5 | Email tile config UI | Customer | P0 | 1 | 1890 |
| C-P0-6 | Soft-delete sweep across paths | Customer | P0 | 1 | 1543 |
| C-P0-7 | AgentMailbox / AgentCalendar shape mismatches | Customer | P0 | 1 | 1647, 1652 |
| C-P0-8 | Conditional onboard CTA | Customer | P0 | 1 | 1662 |
| C-P1-1 | Resume thread-context build timeout | Customer | P1 | 2 | 387 |
| C-P1-2 | OnboardAgentModal deep-link | Customer | P1 | 2 | 1657 |
| C-P1-3 | Calendar invite iCal delivery | Customer | P1 | 2 | 1632 |
| C-P1-4 | Native rate-limit caps match spec | Customer | P1 | 2 | 1637 |
| C-P1-5 | Signature template defaults | Customer | P1 | 2 | 1667 |
| C-P1-6 | ConfirmName UI-shown name match | Customer | P1 | 2 | 1682 |
| C-P1-7 | ExternalDocumentRebindModal Remove button | Customer | P1 | 2 | 1938 |
| C-P1-8 | TTL fallback for null revisionId | Customer | P1 | 2 | 1943 |
| C-P1-9 | External-doc placeholder + budget audit | Customer | P1 | 2 | 1953, 1958 |
| C-P1-10 | PDF support `pdf-parse` dependency | Customer | P1 | 2 | 1968 |
| C-P1-11 | Unify briefs / session-message envelopes | Customer | P1 | 2 | 414 |
| C-P1-12 | Path C org/subaccount name population | Customer | P1 | 2 | 419 |
| C-P1-13 | `useTaskProjection` pagination | Customer | P1 | 2 | 2825 |
| C-P1-14 | Mailbox client pagination | Customer | P1 | 2 | 1746 |
| C-P1-15 | InlineIntegrationCard dismissed persistence | Customer | P1 | 2 | 1885, 395 |
| C-P1-16 | AC subaccount budget enumeration | Customer | P1 | 2 | 2626 |
| C-P2-1 | Riley Workflows / Automations simplification | Customer | P2 | 3 | 731 |
| C-P2-2 | Bulk approve/reject subaccountId emit | Customer | P2 | 3 | 1169 |
| CL-P1-1 | Centralised security audit log (= O-P1-4) | Compliance | P1 | 2 | 52 |
| CL-P1-2 | Data deletion / erasure runbook | Compliance | P1 | 2 | (gap) |
| CL-P1-3 | Retry-attempt audit trail | Compliance | P1 | 2 | 746 |

### 12.1 Item count summary

| Phase | P0 | P1 | P2 | Total |
|-------|----|----|----|-------|
| Phase 1 | 25 | – | – | 25 |
| Phase 2 | – | 50 | – | 50 |
| Phase 3 | – | – | 7 | 7 |
| **Total** | **25** | **50** | **7** | **82** |

(`CL-P1-1` shares scope with `O-P1-4` so the total of distinct work-items is 81; the table double-lists for compliance traceability.)

---

**End of spec.**













