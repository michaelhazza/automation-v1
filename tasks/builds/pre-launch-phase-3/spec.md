**Status:** draft
**Spec date:** 2026-05-05
**Last updated:** 2026-05-05
**Author:** Michael
**Build slug:** pre-launch-phase-3

# Pre-Launch Phase 3 — Closing the Last Gaps Before Test Lockdown

## Why this spec exists

Phase 1 (PR #261) closed the P0 hardening list. Phase 2 (PR #264) closed the P1 list. This phase closes the small set of items that remain real after a present-state verification pass and that are cheaper-to-fix-now than post-launch:

- One launch-boundary item where misconfigured env can disable a control silently.
- Four mid-priority security/correctness items flagged by the pre-launch-phase-2 review pipeline that were operator-deferred at the time but warrant closing before a real customer touches the system.
- A hygiene pass on five stale `[OPEN]` / unresolved markers in `tasks/todo.md` (audit-summary items 21, 22, 24; REQ 14b-extra; Hermes §6.8) — four of which were already closed by surrounding code and one (item 22) which closes when L1 ships in this spec.
- A forward-looking operator runbook capturing conditional re-evaluation triggers for items correctly deferred but whose preconditions will fire post-launch.

After this ships, development is locked down for the test pass. Deferred items not in this spec stay deferred — see §13.

## Table of contents

1. Goals and non-goals
2. Verification log (present-state evidence)
3. File inventory
4. Items in detail
5. Permissions / RLS checklist
6. Execution model
7. Phase sequencing
8. Contracts
9. Execution-safety contracts (idempotency, retry, concurrency)
10. Testing posture
11. Doc-sync impact
12. Done definition
13. Deferred Items
14. Pre-review checklist

---

## 1. Goals and non-goals

### Goals

- Eliminate the webhook fail-open path so `WEBHOOK_SECRET` misconfiguration cannot silently disable HMAC verification.
- Bring `requireSubaccountPermission` to parity with `requireOrgPermission` for security-audit emission.
- Add a credential-stuffing belt against IP rotation for the login flow.
- Move the optimiser cost invariant from "documented and skipped" to "measured by CI on every relevant change".
- Lock the `measureInterventionOutcomeJob` decision-layer ordering invariant in a pure-function test (the comment exists; the test will catch regressions in `decideOutcomeMeasurement`'s read-before-write contract).
- Confirm Hermes §6.8 errorMessage closure in present state and flip the stale `[OPEN]` marker. The fix already shipped via HERMES-S1 — this spec only does marker hygiene.
- Clean up stale `[OPEN]` markers and one closed-but-still-listed scope item in `tasks/todo.md`.

### Non-goals

- No new tables, no new services, no new routes. Every change extends an existing primitive or removes a foot-gun on one.
- No production-baseline / staging-telemetry instrumentation. Items deferred for "we don't have telemetry yet" stay deferred.
- No second-channel OAuth provider, no multi-tab admin race fix, no audit-stream lint-rule replacement (CHATGPT-R1-4). Those remain in deferred-items sections of `tasks/todo.md`.

### Framing alignment (`docs/spec-context.md`)

- `pre_production: yes` — all changes commit-and-revert.
- `testing_posture: static_gates_primary` + `runtime_tests: pure_function_only` — every test added in this spec is pure-function (covered with `npx tsx`) or a CI gate. No new vitest/playwright/supertest.
- `feature_flags: only_for_behaviour_modes` — none introduced here.
- `prefer_existing_primitives_over_new_ones: yes` — every fix extends `inboundRateLimiter`, `recordSecurityEvent`, `env`, `validateEncryptionKeyOrThrow`'s validator pattern, or an existing test file. The one exception is L5, which adds a new CI workflow (`optimiser-cost-gate.yml`) because the existing optimiser test was deferred to CI gating; this is captured as a new static gate, consistent with the `static_gates_primary` posture.

---

## 2. Verification log (present-state evidence)

Per the spec-authoring checklist §0, every cited deferred item was re-verified against the working tree before this spec was authored. Items listed as `verified closed` are removed from scope and only carry a hygiene action in §4.H.

| Triage call | Item | Present-state verdict | Evidence |
|---|---|---|---|
| §1 / launch-blocker | Webhook fail-open on missing `WEBHOOK_SECRET` | **verified open** | `server/services/webhookService.ts:77-88` — `verifyCallbackToken` returns `true` when secret unset; one-shot warn log only |
| §1 / launch-blocker | `ghlOAuthStateStore` process-local Map | **verified closed** | `server/services/ghlOAuthStateStore.ts` is DB-backed via `oauth_state_nonces` (migration 0277, S-P0-1). Triage memory was stale. |
| §2 / strong-rec | AR-2.2 — `requireSubaccountPermission` no `auth.permission_denied` emit | **verified open** | `server/middleware/auth.ts:355-400`. Compare with `requireOrgPermission` lines 322-335 which already emits via `recordSecurityEvent` |
| §2 / strong-rec | AC-ADV-10 — `agent_charges.spending_budget_id` missing FK | **verified closed** | `migrations/0271_agentic_commerce_schema.sql:200` declares `spending_budget_id UUID NOT NULL REFERENCES spending_budgets(id)`. Drizzle `.references()` confirmed at `server/db/schema/agentCharges.ts:60-61`. No action — the closure is already encoded in code; no `[OPEN]` marker exists in `tasks/todo.md` for this item. |
| §2 / strong-rec | AR-5.1 — login rate-limit per-email bucket | **verified open** | `server/lib/rateLimitKeys.ts:21-28` — both `authLogin` and `authLoginLong` key on `${ip}:${email}`. No standalone email bucket exists |
| §2 / strong-rec | DG-6 — optimiser cost-gate not measured | **verified open** | `server/services/optimiser/__tests__/verificationMatrix.test.ts:836-840` is `describe.skip`; no CI run has produced a `<$0.02/sa/day` measurement record |
| §2 / strong-rec | F2b — `measureInterventionOutcomeJob` idempotency invariant comment-only | **verified open** | `tasks/todo.md:1585`. Comment is in place; no test asserts the invariant |
| §2 / strong-rec | D15 — `verify-workspace-actor-coverage.ts` CI wiring | **verified closed** | `.github/workflows/workspace-actor-coverage.yml` exists and runs `npx tsx scripts/verify-workspace-actor-coverage.ts` on every PR + push to main. No action — the wiring is already on main; no `[OPEN]` marker to flip. |
| §4 / hygiene | Audit summary item 21 (in-memory rate limit) | **verified closed** | `server/lib/inboundRateLimiter.ts` is the DB-backed primitive (Phase 2D). Marker at `tasks/todo.md:46` is stale |
| §4 / hygiene | Audit summary item 24 (Multer 500MB OOM) | **verified closed** | `server/middleware/validate.ts:21` shows 25MB cap (S-P0-8). Marker at `tasks/todo.md:49` is stale |
| §4 / hygiene | REQ 14b-extra (`workflow_drafts` subaccount scope) | **verified closed** | `server/routes/workflowDrafts.ts:38-51` performs the subaccount scope check. Marker at `tasks/todo.md:2844` is stale |
| §4 / hygiene | Hermes §6.8 errorMessage gap | **verified closed** | `server/services/agentExecutionService.ts:1836-1840` (HERMES-S1) already threads `preFinalizeRow.errorMessage` into `extractionOutcome.errorMessage` when `derivedRunResultStatus === 'failed'`; `server/services/workspaceMemoryService.ts:731-742` consumes via `hasStructuredError` so short-summary failed runs with a non-null `errorMessage` proceed. Closed by prior commit; only the `tasks/todo.md` marker is stale. |
| §4 / hygiene | AC-CGPT-R3-3 / AR-CGPT-R3-1 — onboarding triggers | **verified open** (advisory only) | These are conditional triggers, not gaps. Action: capture in operator runbook so onboarding a second OAuth provider or enabling multi-tab admin work re-opens them |

This log lives at this spec's `verification-log.md` for the spec-reviewer trail. Action items derived from it are in §4.

---

## 3. File inventory

Every file the spec touches. New files are marked `[NEW]`; everything else is an extension.

### Code

| File | Change |
|---|---|
| `server/lib/env.ts` | Add a new exported validator function `validateWebhookSecretOrThrow()` that throws when `NODE_ENV === 'production'` and `WEBHOOK_SECRET` is missing or its length < 32. Call it from the existing prod boot validation chain (alongside `validateEncryptionKeyOrThrow`). The validator function is a pure boundary-check on `process.env`; mirrors the shape of `validateEncryptionKeyOrThrow` so the test pattern at `server/lib/__tests__/encryptionKeyValidator.test.ts` can be applied directly. |
| `server/services/webhookService.ts` | Remove the `if (!secret) return true` (fail-open) branch. In dev / non-prod, when no secret is configured, `verifyCallbackToken` returns `false` (fail-closed) and emits a one-shot `logger.warn` — preserves the security invariant (no path silently passes verification) while keeping the dev `curl` loop unblocked. The `webhookOpenModeWarned` flag is repurposed to keep the warn one-shot. In prod, the boot validator from step 1 makes this branch unreachable. See §4.L1. |
| `server/services/securityAuditService.ts` | One-line addition in the catch branch (`securityAuditService.ts:40-46`): emit `security.audit.write_failed` structured log with `{ eventType, organisationId, errorMessage, timestampIso }` to `server/lib/logger.ts` before returning. No retry, no queue. See §4.L2 audit-write-failure observability. |
| `server/middleware/auth.ts` | `requireSubaccountPermission` 403-branch now calls `recordSecurityEvent({ eventType: 'auth.permission_denied', ... })` with `subaccountId` populated, mirroring `requireOrgPermission`. Resolves `organisationId` via `req.orgId ?? req.user.organisationId` and asserts the result is non-null before emitting (see §4.L2). |
| `server/lib/rateLimitKeys.ts` | Add two email-only builders: `authLoginEmailOnly` (sustained / hourly) and `authLoginEmailOnlyBurst` (micro-burst / 5-min window). Both keyed on lowercased email; namespace and shape inherit the existing convention. |
| `server/routes/auth.ts` | `/login` handler runs the two new email-only buckets after the existing `ip:email` short and long buckets. On deny, returns 429 with `Retry-After` and `RateLimit-*` headers selected from the **most-restrictive** bucket across all four (shorter `Retry-After`, lower `RateLimit-Remaining`); the three `RateLimit-*` headers describe a single coherent bucket. See §4.L3. |
| `server/services/optimiser/__tests__/verificationMatrix.test.ts` | Remove `.skip` on the cost-gate test. Add CI guard: skip locally if `LIVE_LLM_COST_GATE !== '1'`. |
| `.github/workflows/optimiser-cost-gate.yml` `[NEW]` | New workflow runs the unblocked test against a seeded fixture with `LIVE_LLM_COST_GATE=1`. Fails the workflow if measured `>= $0.02/sa/day`. Fixture is seeded for determinism — variance is a fixture bug, not a gate-tuning problem. |

### Tests

| File | Change |
|---|---|
| `server/jobs/__tests__/measureInterventionOutcomeJob.idempotency.test.ts` | Extend the existing dotted file (already wired to `npx tsx`) with new pure-function assertions against `decideOutcomeMeasurement` covering the read-before-decide contract — see §4.L4. The existing file's docstring already documents that the race-safe single-outcome property needs a real Postgres harness; that property moves to §13 deferred. |
| `server/services/__tests__/rateLimitKeysPure.test.ts` | Extend the existing pure-test file (vitest `expect`/`test` shape, runnable via `npx tsx`) with cases for both new builders: `authLoginEmailOnly` and `authLoginEmailOnlyBurst` — same email different case → same key per builder; different emails → different keys; burst and sustained keys are distinct from each other and from the existing `authLogin` / `authLoginLong`. |
| `server/lib/__tests__/webhookSecretValidatorPure.test.ts` `[NEW]` | Pure-function test of `validateWebhookSecretOrThrow()` mirroring the existing `encryptionKeyValidator.test.ts` shape (vitest `describe`/`it`/`expect`, runnable via `npx tsx`). Covers: prod + missing → throws; prod + length < 32 → throws; prod + length ≥ 32 → does not throw; non-prod (`NODE_ENV !== 'production'`) → does not throw regardless of secret value. Restores `process.env.NODE_ENV` and `process.env.WEBHOOK_SECRET` after each case. |
| `server/lib/__tests__/requireSubaccountPermissionPure.test.ts` `[NEW]` | Pure-function test of a new `decidePermissionDenialEvent({ user, orgId, subaccountId, permissionKey, reqPath, reqMethod, ip, userAgent })` helper extracted from the middleware (see §4.L2 below). The helper builds the `recordSecurityEvent` payload deterministically; the test asserts that (a) it returns the expected payload shape, (b) it throws when `orgId` and `user.organisationId` are both null/undefined (the codified invariant). Uses vitest `expect`/`test`, runnable via `npx tsx`. The middleware itself wires the helper via a single function call and emits `recordSecurityEvent(decidePermissionDenialEvent(...))` — keeps the impure I/O at the boundary and the decision logic in pure code, consistent with the codebase's `*Pure.ts` + `*.test.ts` convention. |
| `server/services/__tests__/securityAuditServiceWriteFailureLogPure.test.ts` `[NEW]` | Pure-function test of the new `security.audit.write_failed` structured log on `recordSecurityEvent`'s catch branch. Mocks the DB writer to throw; asserts the logger receives exactly one structured line with `{ eventType, organisationId, errorMessage, timestampIso }` before the function returns. Uses vitest `expect`/`test`, runnable via `npx tsx`. Covers the L2 audit-write-failure observability invariant. |

### Docs

| File | Change |
|---|---|
| `tasks/todo.md` | Update items 21, 22, 24 to `[CLOSED 2026-05-05 — pre-launch-phase-3]` with one-line evidence each. Item 22 (`WEBHOOK_SECRET` fail-open) closes when L1 ships. Mark REQ 14b-extra closed in its section. Mark Hermes §6.8 closed (pre-existing closure surfaced by this spec's verification log). |
| `architecture.md` | One line in §Layer 4 Security audit stream: `requireSubaccountPermission` now emits `auth.permission_denied` (parity with org-level). |
| `DEVELOPMENT_GUIDELINES.md` | New §8.30 — `WEBHOOK_SECRET` is a required prod env var (length ≥ 32); do not introduce new fail-open code paths in security primitives. |
| `KNOWLEDGE.md` | Append three patterns: (1) "no fail-open on missing security secrets — fail boot fast"; (2) "credential-stuffing defence needs identity-only buckets at two windows (burst + sustained), independent of network identity"; (3) "`[OPEN]` audit-summary markers must be re-verified against code before being trusted — stale markers caused false-positive scope items in this phase". |
| `tasks/builds/pre-launch-phase-3/operator-runbook.md` `[NEW]` | Capture conditional re-evaluation triggers for items correctly deferred today: AC-CGPT-R3-3, AR-CGPT-R3-1, CHATGPT-R1-7, F3, DG-4, CHATGPT-R1-4, plus the L5 cost-gate proactive 80% trigger. Each entry names the precondition and the action when it fires. |
| `tasks/current-focus.md` | After merge, update the sprint-pointer to reflect that `pre-launch-phase-3` shipped and development is locked down for test pass. |

---

## 4. Items in detail

### L1 — Webhook secret enforcement

**Source:** Audit Summary item 22 (`tasks/todo.md:47`); confirmed open in §2.

**Problem.** `verifyCallbackToken` (`server/services/webhookService.ts:77-88`) returns `true` when no secret is configured, with only a one-shot `logger.warn`. A misconfigured prod env therefore disables HMAC verification on inbound webhooks silently — the warning fires once and never again. The fail-open path is justified in the comment as "open mode" but no production deploy should ever land in open mode.

**Fix.**

1. `server/lib/env.ts` — extend the prod env validator to require `WEBHOOK_SECRET` length ≥ 32. Boot fails fast on missing/short secret in `NODE_ENV === 'production'`. Mirror the pattern at `validateEncryptionKeyOrThrow`.
2. `server/services/webhookService.ts` — remove the `if (!secret) return true` (fail-open) branch. In `NODE_ENV !== 'production'`, when no secret is configured, `verifyCallbackToken` returns `false` (fail-closed) and emits a one-shot `logger.warn` so a developer doing manual `curl` testing sees an explicit log line and is not blocked by an exception in their dev loop. The security invariant — *no path silently passes verification when no secret is configured* — is preserved by the fail-closed return; the previous "throw in dev" added dev-loop friction without strengthening the invariant. The `webhookOpenModeWarned` flag is repurposed (not removed) to keep the warn log one-shot in dev. In production, the boot-time validator from step 1 has already hard-failed the process before any webhook can hit this path, so the runtime branch is unreachable in prod.

**Idempotency posture.** N/A — env validation runs at boot.

**Concurrency guard.** N/A — no shared state.

**Verification.** Manual local boot in prod-mode without `WEBHOOK_SECRET` should refuse to start. Existing webhook integration test continues to pass with a configured secret.

### L2 — AR-2.2: subaccount permission denial emits security event

**Source:** Adversarial reviewer pass on PR #264 (`tasks/todo.md:3069-3071`); confirmed open in §2.

**Problem.** `requireOrgPermission` records `auth.permission_denied` to `security_audit_events` on every 403. `requireSubaccountPermission` does not — denials at the subaccount layer leave no audit trail, which is a forensic gap the moment a real customer touches a subaccount route.

**Fix.** Two-part change so the decision logic stays in pure code (testable without a request mock) and the impure boundary stays as small as possible:

1. **New pure helper** `decidePermissionDenialEvent` exported from `server/middleware/auth.ts` (or a sibling `*Pure.ts` module if the maintainer prefers — implementation choice, the spec only requires the helper exists). Inputs: `{ user, orgId, subaccountId, permissionKey, path, method, ip, userAgent }`. Behaviour:
   - Compute `organisationId = orgId ?? user.organisationId`.
   - If `organisationId == null`, throw `Error('requireSubaccountPermission: organisationId unresolved post-auth')` — the invariant is that authenticated subaccount paths always carry an org context, and a null here means an upstream invariant has broken (not a denial worth auditing). Failing loud beats emitting a partially-orphaned audit event.
   - Otherwise return a `SecurityEventInput` object with `eventType: 'auth.permission_denied'`, the resolved `organisationId`, the `subaccountId`, `actorUserId: user.id`, `actorRole: user.role`, `ip`, `userAgent`, and `meta: { route: path, method, requiredPermission: permissionKey }`.
2. **Wire the helper** into the existing middleware at `server/middleware/auth.ts:355-400`: before `res.status(403).json({ error: 'Forbidden' })`, call `void recordSecurityEvent(decidePermissionDenialEvent({ user: req.user, orgId: req.orgId, subaccountId, permissionKey, path: req.path, method: req.method, ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null }))`.

The `subaccountId` field is already on `recordSecurityEvent`'s input shape (see `securityAuditService.ts:28`). No schema change.

**Invariant declared.** `organisationId` for any authenticated subaccount-path request resolves non-null. The pure helper codifies this and prevents future drift toward partially-orphaned audit events under impersonation or system-actor flows.

**Idempotency posture.** Inherits `recordSecurityEvent` — write is fire-and-forget, errors are logged not thrown (current behaviour at `securityAuditService.ts:40-46`).

**Audit write-failure observability (L2 sub-fix).** Phase 3 expands the set of `recordSecurityEvent` call sites (this section, plus existing call sites unchanged). To avoid silently losing forensic signal under a sustained audit-DB outage, `recordSecurityEvent`'s catch branch (`securityAuditService.ts:40-46`) is extended to emit a structured log entry `security.audit.write_failed` with `{ eventType, organisationId, errorMessage, timestampIso }` to `server/lib/logger.ts` before returning. No retry, no queue, no escalation — pure observability so the failure is visible in the log stream rather than being a silent void. Single-line change in `securityAuditService.ts`. Pure-function test added at `server/services/__tests__/securityAuditServiceWriteFailureLogPure.test.ts` `[NEW]`: mock the DB writer to throw; assert the logger receives exactly one structured `security.audit.write_failed` line carrying the four context fields.

**Concurrency guard.** N/A — append-only log.

**Test.** Pure-function test against `decidePermissionDenialEvent` (see §3 — `server/lib/__tests__/requireSubaccountPermissionPure.test.ts` `[NEW]`). Asserts the returned payload has the expected shape, and the helper throws when both `orgId` and `user.organisationId` are absent. Middleware wiring itself is verified by manual smoke test (the spec follows the codebase's `*Pure.ts` + `*.test.ts` convention; introducing a middleware-level vitest harness is out of scope per `runtime_tests: pure_function_only`).

### L3 — AR-5.1: per-email-only login rate-limit bucket

**Source:** Adversarial reviewer pass on PR #264 (`tasks/todo.md:3059-3061`); confirmed open in §2.

**Problem.** Both login buckets in `server/lib/rateLimitKeys.ts:24-28` key on `${ip}:${email}`. A botnet rotating through many IPs can each contribute a small share to a target email's brute-force load while the per-`ip:email` cap stays under threshold. Credential stuffing across IP rotation is the canonical failure mode this gap allows.

**Fix.** Add **two** new buckets keyed on `email` only — sustained (hourly) plus a micro-burst window. The hourly cap alone would still allow 100 attempts in two minutes, which is exactly the burst pattern we want to deny; pairing the windows closes that without new primitives.

```ts
// Sustained: long-horizon credential-stuffing defence across IP rotation.
authLoginEmailOnly: (email: string): string =>
  `rl:${KEY_VERSION}:auth:login:email:${email.toLowerCase()}`,
// Burst: prevents a high-rate spike inside the sustained window.
authLoginEmailOnlyBurst: (email: string): string =>
  `rl:${KEY_VERSION}:auth:login:email:burst:${email.toLowerCase()}`,
```

Wire both in `server/routes/auth.ts` `/login` after the existing two `ip:email` buckets:

| Bucket | Limit | Window | Rationale |
|---|---|---|---|
| `authLoginEmailOnly` | 100 | 3600s | Bounds a single-email attack across rotated IPs to ≤ 100 attempts/hour. Higher than the per-`ip:email` long bucket (50) by design — multiple legitimate IPs may legitimately share one email (mobile + desktop + work). |
| `authLoginEmailOnlyBurst` | 10 | 300s | Denies high-rate spikes inside the hourly window. A single user fails password 1-3 times before resetting; 10 in 5 minutes is unambiguously not human. |

On deny, return 429 with `Retry-After` and `RateLimit-*` headers selected from the **most-restrictive** bucket across all four (existing `ip:email` short + long, plus new `email`-only burst + sustained) — i.e. the shorter `Retry-After` value and the lower `RateLimit-Remaining` value, taken bucket-independently. Rationale: a single bucket's headers can mislead the caller into retrying against a constraint that is not actually the binding one, triggering an immediate second 429. The most-restrictive read tells the caller the real wait. Implementation: the `/login` handler computes all four bucket states for the union-trip decision regardless of which trips first; from those four states it selects `min(retryAfterSeconds)` for `Retry-After` and `min(remainingQuota)` for `RateLimit-Remaining`. The `RateLimit-Limit` and `RateLimit-Reset` headers follow the bucket whose `retryAfterSeconds` was selected (so the three `RateLimit-*` headers describe a single coherent bucket).

**Limit choice rationale.** Without the burst bucket, an attacker can do 100 attempts inside 2 minutes and stay under the hourly cap — defeats the purpose. The buckets are evaluated independently — either tripping returns 429 (per §8). Limits are picked so that legitimate traffic does not trip either: 10 attempts in 5 minutes is well above what a real user does (1–3 password attempts before reset), and 100 attempts in an hour is well above what any human or shared-mailbox cohort produces. A botnet rotating through hundreds of IPs against one email is bounded by whichever bucket trips first — at 10 attempts per 5 minutes (burst) or 100 per hour (sustained), regardless of network distribution.

**Idempotency posture.** Both buckets inherit `inboundRateLimiter.check` — atomic upsert per call, every call increments. Same pattern as the existing two buckets.

**Concurrency guard.** Inherits the DB-canonical sliding-window primitive (`inboundRateLimiter.ts:89-165`).

**Test.** Add cases to the existing `server/services/__tests__/rateLimitKeysPure.test.ts` confirming both new builders normalise email case, produce keys distinct from each other, and distinct from `authLogin` / `authLoginLong`.

### L4 — F2b: idempotency-invariant test for `measureInterventionOutcomeJob`

**Source:** PR #235 pre-prod-tenancy (`tasks/todo.md:1585`); confirmed open in §2.

**Problem.** A comment at the call site documents the invariant — all reads happen before `recordOutcome`, and two parallel invocations against the same row produce exactly one outcome row. There is no test asserting either property. A future refactor that re-orders the read/write path or weakens the unique-key constraint would not be caught.

**Scoping note.** The race-safe single-outcome property genuinely needs transactional semantics (`db.transaction` + `pg_advisory_xact_lock` + claim-verify NOT-EXISTS re-check). The existing `measureInterventionOutcomeJob.idempotency.test.ts` docstring explicitly documents this — the parallel-invocation assertion cannot be made meaningful with an in-memory shim that fakes transactional semantics. Per the framing's `runtime_tests: pure_function_only` constraint, that property is deferred to §13 with a clear re-evaluation trigger. This spec asserts only what is purely-testable.

**Fix.** Extend the existing `server/jobs/__tests__/measureInterventionOutcomeJob.idempotency.test.ts` with one new pure-function assertion against `decideOutcomeMeasurement` (the existing pure decider exercised by `measureInterventionOutcomeJobPure.test.ts`). The decider's actual signature (`server/jobs/measureInterventionOutcomeJobPure.ts:62-69`) takes `{ action, accountId, postSnapshot?, postAssessment?, now }` — the assertion exercises *the inputs the decider actually has*, not a hypothetical pre-snapshot field:

- **Window-not-yet-elapsed gate.** `now < executedAt + windowHours` → returns `too_early` regardless of snapshot/assessment presence. Codifies that the time-window read precedes the snapshot read.
- **Account-or-snapshot precondition gate.** `accountId === null` → returns `no_post_snapshot`. `accountId` set but `postSnapshot` absent and `actionType !== 'notify_operator'` → returns `no_post_snapshot`. Codifies that both the account row and the post-window snapshot must be in hand before the decider can emit `recordArgs`.
- **Operator-alert exception path.** `actionType === 'notify_operator'` with `postSnapshot` absent but `accountId` set → returns `measure` with `healthScoreAfter` undefined. Codifies the documented operator-alert carve-out so a refactor cannot accidentally drop it.
- **Full-input happy path.** `now ≥ window`, `accountId` set, `postSnapshot` set → returns `measure` with `recordArgs.healthScoreAfter === postSnapshot.score` and `recordArgs.bandAfter === postAssessment?.band` (or `undefined` if `postAssessment` absent — the field is optional by design).

This locks the contract that `recordOutcome` cannot be reached on partial input — which is the read-before-write invariant in pure form, scoped to the inputs that actually exist on the function. The race-safe single-outcome property under parallel invocation remains deferred to §13.

**Test-file naming clarification.** The file is named `measureInterventionOutcomeJob.idempotency.test.ts` for historical reasons (matches the call-site comment that documents the idempotency invariant), but the new assertions added in this spec test **decision ordering**, not DB-level idempotency. To keep future readers from assuming idempotency is asserted here, the spec requires a leading docstring on the new `describe` block: `// This block asserts decideOutcomeMeasurement's read-before-decide ordering. DB-level single-outcome idempotency under parallel invocation is deferred — see §13.` The file rename is rejected (the file is wired to `npx tsx <path>` invocations and a rename ripples through CI / docs / KNOWLEDGE.md without proportionate value); the docstring is the canonical clarification.

**Idempotency posture.** State-based — the unique key + `ON CONFLICT DO NOTHING` (or equivalent) enforces single-outcome at the DB layer. This spec does not assert that property; §13 captures it as deferred.

**Concurrency guard.** Same unique key, same deferral note.

### L5 — DG-6: optimiser cost-gate measured in CI

**Source:** spec-conformance log on PR #262 (`tasks/todo.md:2407`); confirmed open in §2.

**Problem.** Optimiser spec §11 done definition: "Cost stays under $0.02 per sub-account per day in measured production runs." Plan invariant 30: "Phase 4 measures actual token usage on a 5-subaccount × 7-day fixture. < $0.02/subaccount/day or the build does not ship." The verification test exists (`server/services/optimiser/__tests__/verificationMatrix.test.ts:836-840`) but is `describe.skip` and `progress.md` says "deferred to CI with live DB + LLM access." No CI run has produced a measurement.

**Fix.**

The current `describe.skip(...)` block at `verificationMatrix.test.ts:836-840` is a placeholder — only an `it` title with no body. L5 *implements* the test, not just unskips it. The work breakdown:

1. **Replace** the `describe.skip` block with a `describe(...)` block (no `.skip`) containing one `it(...)` with a real body. Wrap the body in `if (process.env.LIVE_LLM_COST_GATE !== '1') { return; }` so local `npx tsx` invocations exit cleanly.
2. **Test body — fixture seeding.** Use the same in-test seeding helper that the existing optimiser pure-tests use to construct the 5-subaccount × 7-day telemetry input. The fixture lives inline in the test file (single source of seeded shape; no separate fixture asset). Determinism: the fixture is hand-tuned so the LLM is exercised on a representative recommendation surface, not data variance. Variance in cost across runs > ±10% is a fixture bug, not a tuning problem.
3. **Test body — cost measurement.** Run `runOptimiserScan` against the seeded fixture with live LLM credentials. The optimiser already emits `optimiser.render.tokens_used` log events on each `renderRecommendation` call; capture them in-test via a logger spy and aggregate to a per-run total. Convert to dollars using the model's published per-token rate (a constant in the test, not a config — the gate is calibrated to one specific model and re-tuning means re-tuning the gate explicitly). The logger spy retains the per-call records (not just the running total) so step 4's diagnostic output can break the total down.
4. **Test body — assertion + diagnostic logging.** Compute `dollarsPerSubaccountPerDay = totalCost / (5 subaccounts × 7 days)`. Assert `dollarsPerSubaccountPerDay < 0.02`. On every run (pass and fail), the test logs four diagnostic numbers — `totalTokens`, `numberOfRenderCalls`, `averageTokensPerRecommendation = totalTokens / numberOfRenderCalls`, `totalCostDollars` — to stdout in a single structured line so a future cost-gate failure can be diagnosed without re-running with extra instrumentation. The four numbers also appear in the GitHub `::notice::` annotation on success and `::error::` annotation on failure, so reviewers see the breakdown on the PR check page. Rationale: the gate guards against drift, but the *cause* of drift (model-rate change, prompt-length change, call-count change) is invisible from a single PASS/FAIL number; the breakdown attributes drift to the right vector immediately.
5. **CI workflow `.github/workflows/optimiser-cost-gate.yml` `[NEW]`.** Triggers: `pull_request` paths matching `server/services/optimiser/**`, plus `workflow_dispatch`. Job sets `LIVE_LLM_COST_GATE=1`, provides DB + LLM credentials via repo secrets, runs `npx tsx server/services/optimiser/__tests__/verificationMatrix.test.ts`. Job fails the run on assertion failure.
6. **Workflow annotation.** The test prints the measured value to stdout in `::notice::` GitHub annotation form (`echo "::notice title=Optimiser cost::$X /sa/day"`). The annotation surfaces on the PR check page so reviewers see the measured number, not just PASS/FAIL.
7. **Secret-absence behaviour.** If LLM/DB secrets are unavailable on the PR event (e.g. PR from a fork), the workflow exits early with `::warning::Cost gate skipped — secrets unavailable on this event`. The exit-early path does NOT mark the workflow successful in a way that satisfies a required-status-check; it explicitly fails with an exit code that the branch-protection rule treats as "not satisfied" if branch protection is configured to require this gate. Branch-protection configuration is operator action — see §13.

**Branch protection.** The workflow itself fails the run on cost overrun, which surfaces as a failed PR check. *Whether* the failed check blocks merge is a branch-protection setting in the GitHub repo admin, not a file in this PR. Capturing the protection rule for `optimiser-cost-gate` is operator action, deferred to §13.

**Idempotency posture.** N/A — measurement only.

**Concurrency guard.** N/A — single workflow instance per PR.

**Cost note.** This workflow burns LLM budget on every optimiser-touching PR. That is the intended cost — running it less often defeats the gate. Restrict path filter to `server/services/optimiser/**` and explicit manual dispatch so unrelated PRs do not pay the bill.

### L6 — Hermes §6.8: errorMessage threading (already closed; marker hygiene only)

**Source:** Hermes Tier 1 deferred S1 (`tasks/todo.md:68-81`).

**Status.** Verified **closed** in §2 against the present working tree:

- `server/services/agentExecutionService.ts:1836-1840` already threads `preFinalizeRow.errorMessage` into `extractionOutcome.errorMessage` when `derivedRunResultStatus === 'failed'`. The HERMES-S1 inline comment documents the fix.
- `server/services/workspaceMemoryService.ts:731-742` already consumes `outcome.errorMessage` via `hasStructuredError`, allowing extraction to proceed on short-summary failed runs when a structured error is present.

The original triage cited line range `1350-1368`, which now contains session-linking logic — the citation was stale, not the implementation. No code change in this spec.

**Action.** Marker-only — see §4.H3.

**Out of scope (deferred).** A `MIN_MEANINGFUL_ERROR_LENGTH` guard on `errorMessage` (to avoid memory pollution from low-signal strings like `"Error"` / `"Failed"`) would be a sensible follow-up against existing code, but is a Hermes-hardening item, not a pre-launch closure. Captured in §13.

### H1 — Stale `[OPEN]` markers in `tasks/todo.md` audit summary

**Action.** Update lines 46 and 49 of `tasks/todo.md`:

- Item 21 (in-memory rate limit) → `[CLOSED 2026-05-05 — pre-launch-phase-3 verification]` with one-line evidence pointing at `server/lib/inboundRateLimiter.ts`.
- Item 24 (Multer 500MB OOM) → `[CLOSED 2026-05-05 — pre-launch-phase-3 verification]` with one-line evidence pointing at `server/middleware/validate.ts:21`.

These are bookkeeping only — both items have been closed for weeks; the markers are misleading future sessions into thinking they are open.

### H2 — REQ 14b-extra closure marker

**Action.** At `tasks/todo.md:2844`, mark REQ 14b-extra (`workflow_drafts` subaccount scope) as `[CLOSED 2026-05-05 — verified at server/routes/workflowDrafts.ts:38-51]`. Same shape as H1.

### H3 — Hermes §6.8 closure marker

**Action.** Mark `tasks/todo.md:68-81` as `[CLOSED 2026-05-05 — pre-launch-phase-3 verification; HERMES-S1 already shipped]` with one-line evidence pointing at `server/services/agentExecutionService.ts:1836-1840` and `server/services/workspaceMemoryService.ts:731-742`. No code change pairs with this marker — the closure is pre-existing and surfaced by §2's verification log.

### H4 — Operator runbook for conditional re-evaluation triggers

**Action.** New `tasks/builds/pre-launch-phase-3/operator-runbook.md` capturing six conditional re-evaluation triggers:

- **AC-CGPT-R3-3** — re-open when a second OAuth-style channel is added to the platform. Multi-channel display ambiguity only manifests with channel count > 1.
- **AR-CGPT-R3-1** — re-open when multi-tab admin work is enabled or first observed. The grant-race only manifests with two concurrent admin tabs.
- **CHATGPT-R1-7 (OAuth state TTL revert)** — re-open after staging telemetry exists. The 5-minute window may be too tight for mobile / SSO flows; the revert decision needs `expired-on-callback` rate data.
- **F3 (`@rls-allowlist-bypass` runtime enforcement)** — re-open on a new admin-bypass call site without the annotation, OR a discovered bypass abuse, OR the first agency client request to audit cross-tenant access patterns.
- **DG-4 (optimiser timezone column)** — re-open on first customer feedback that 06:00 UTC stagger is wrong for them, OR the first agency operating in a timezone where local 06:00 differs materially from UTC 06:00.
- **CHATGPT-R1-4 (audit-stream split lint rule)** — re-open when `scripts/verify-audit-stream-split.sh` flags drift in a real PR.
- **L5 cost-gate proactive-trigger** — re-open when the optimiser cost-gate workflow's measured `dollarsPerSubaccountPerDay` reaches 80% of the $0.02 threshold (i.e. ≥ $0.016/sa/day) on **two consecutive runs** of the workflow. The proactive trigger complements L5's reactive fail-on-overrun: at 80% the gate has not failed yet, so the build still ships, but the trend signals model/prompt/batching drift that should be reviewed before it crosses the threshold under load. Action when triggered: review the diagnostic-logging output (totalTokens, numberOfRenderCalls, averageTokensPerRecommendation) from the last two runs; identify whether drift is from per-call token count (prompt change), call count (batching change), or rate (model change); apply the appropriate fix.

This runbook is intentionally short. It is the durable handoff for items that are correctly deferred but whose triggers will fire post-launch.

---

## 5. Permissions / RLS checklist

No new tables, no new tenant-scoped storage. The four-requirement checklist applies trivially:

- L2 writes to `security_audit_events` via `recordSecurityEvent`. That table already has RLS, manifest entry, and the sentinel-org boot invariant from PR #264. The write inherits the existing posture — no new RLS work.
- L3 writes to `rate_limit_buckets` via `inboundRateLimiter.check`. Same — that table is intentionally non-tenant-scoped (rate buckets are keyed by IP/email/window, not by org); see the existing `guard-ignore` comment at `server/lib/inboundRateLimiter.ts:15`.
- L1 / L5 / L6 / H* — no DB writes introduced by this spec.

---

## 6. Execution model

Every change is **synchronous / inline** within an existing call path:

- L1 — boot-time env validation; throws.
- L2 — middleware emits a fire-and-forget `recordSecurityEvent` (existing pattern).
- L3 — additional `inboundRateLimiter.check` call inside the existing `/login` handler.
- L4 — pure-function test only.
- L5 — CI workflow; not application code.
- L6 — no code change (marker-only via H3).

No new pg-boss jobs. No prompt partitions. No cached-vs-dynamic decisions.

---

## 7. Phase sequencing

This spec ships as **one chunk**. The items are independent — no dependency graph to enforce — and each is small enough that batching them into a single PR keeps the review surface manageable while avoiding seven separate review cycles.

If the operator wishes to split, the natural seams are:

- **Chunk A (security primitives):** L1 + L2 + L3.
- **Chunk B (correctness):** L4.
- **Chunk C (CI gate):** L5.
- **Chunk D (hygiene):** H1 + H2 + H3 + H4 (L6 marker-only folds into H3).

Default: ship as one. Split only if review is taking >2 rounds.

---

## 8. Contracts

The only data shape that crosses a boundary is the new rate-limit key, which extends an existing typed builder:

### `RATE_LIMIT_KEY_AUTH_LOGIN_EMAIL_ONLY` (sustained)

- **Producer:** `rateLimitKeys.authLoginEmailOnly(email)` in `server/lib/rateLimitKeys.ts`.
- **Consumer:** `inboundRateLimiter.check(key, 100, 3600)` in `server/routes/auth.ts` `/login` handler.
- **Shape:** `string` of form `rl:v1:auth:login:email:<lowercased-email>`.
- **Example:** `rl:v1:auth:login:email:user@example.com`.
- **Producer/consumer agreement:** the limit (100) and window (3600s) are encoded by the caller, not the key. Convention from `inboundRateLimiter.ts:80-84` is followed.

### `RATE_LIMIT_KEY_AUTH_LOGIN_EMAIL_ONLY_BURST` (micro-burst)

- **Producer:** `rateLimitKeys.authLoginEmailOnlyBurst(email)` in `server/lib/rateLimitKeys.ts`.
- **Consumer:** `inboundRateLimiter.check(key, 10, 300)` in `server/routes/auth.ts` `/login` handler, run alongside the sustained bucket. Either trip → 429.
- **Shape:** `string` of form `rl:v1:auth:login:email:burst:<lowercased-email>`.
- **Example:** `rl:v1:auth:login:email:burst:user@example.com`.
- **Producer/consumer agreement:** distinct namespace segment (`:burst:`) so the burst and sustained windows never collide on the same DB row. Limit (10) and window (300s) are caller-encoded.

No other new contracts.

---

## 9. Execution-safety contracts

### Idempotency

- **L1:** N/A (boot-time check).
- **L2:** inherits `recordSecurityEvent` — append-only, no idempotency key needed; duplicate emits on the same denial would be benign but cannot occur because the middleware path returns immediately after.
- **L3:** state-based via the atomic UPSERT in `inboundRateLimiter.check`. Every call increments both the sustained and the burst bucket. Duplicate calls (e.g. retry by a misbehaving client) consume bucket budget — by design.
- **L4:** the pure-function test on `decideOutcomeMeasurement` is deterministic. The state-based idempotency at the DB layer (unique key + claim-verify) is unchanged by this spec.
- **L5:** workflow-level — re-running the workflow on the same SHA produces the same measurement; no shared state to corrupt.
- **L6:** N/A — no code change in this spec.

### Retry classification

- **L2 / L3:** `safe`. Both writes are append-only with the existing primitive's retry semantics.
- **L1 / L4 / L5 / L6:** N/A — no externally-triggered writes introduced.

### Concurrency guard

- **L3:** the existing DB-canonical sliding-window primitive. Two concurrent denials write the bucket atomically; effective-count math is consistent. Both buckets share the primitive — independent rows, independent atomic writes.
- **L4:** the production code path's concurrency guard (DB unique key + advisory lock + claim-verify) is unchanged. This spec does not assert that property — see §13.

### Terminal event guarantee

- **L2:** `auth.permission_denied` is the terminal event for a denied request. Mirrors `auth.permission_denied` already emitted by `requireOrgPermission`. No post-terminal events.

### Unique-constraint handling (job-level — no HTTP boundary)

- **L4:** `23505` from the `intervention_outcomes` unique key is caught at the job layer and treated as no-op. There is no HTTP boundary — `measureInterventionOutcomeJob` is a pg-boss worker, not a route. Behaviour unchanged by this spec.

### State machine closure

No state machines introduced or modified.

---

## 10. Testing posture

Per `docs/spec-context.md`:

- **L1:** boot-time check, plus a pure-function test of the new `validateWebhookSecretOrThrow()` helper at `server/lib/__tests__/webhookSecretValidatorPure.test.ts` `[NEW]`, mirroring `encryptionKeyValidator.test.ts`. Required, not optional — L1 is launch-boundary security and the validator is a static-gate-friendly pure boundary check on `process.env`.
- **L2:** two pure-function tests — (a) `server/lib/__tests__/requireSubaccountPermissionPure.test.ts` `[NEW]` of `decidePermissionDenialEvent` — asserts the returned payload shape and the throw-on-null-organisationId invariant; (b) `server/services/__tests__/securityAuditServiceWriteFailureLogPure.test.ts` `[NEW]` covering the `security.audit.write_failed` structured-log emission when `recordSecurityEvent`'s catch branch fires.
- **L3:** pure-function test cases added to the existing `server/services/__tests__/rateLimitKeysPure.test.ts` covering both new builders.
- **L4:** pure-function test cases added to the existing `server/jobs/__tests__/measureInterventionOutcomeJob.idempotency.test.ts` covering `decideOutcomeMeasurement`'s read-before-decide ordering.
- **L5:** CI gate (workflow), not local test.
- **L6:** N/A — no code change.

No vitest/playwright/supertest/frontend tests added. No E2E. No API contract tests. All consistent with `runtime_tests: pure_function_only`.

---

## 11. Doc-sync impact

Per `docs/doc-sync.md`:

- `architecture.md` — one line in §Layer 4 Security audit stream noting `requireSubaccountPermission` parity with `requireOrgPermission`.
- `DEVELOPMENT_GUIDELINES.md` — new §8.30: `WEBHOOK_SECRET` required in prod (length ≥ 32); no fail-open paths in security primitives.
- `KNOWLEDGE.md` — append three patterns: (1) no fail-open on missing secrets; (2) identity-only rate buckets defend credential stuffing across IP rotation, paired burst + sustained windows defend the spike inside the sustained window; (3) `[OPEN]` audit-summary markers must be re-verified against code before being trusted — stale markers caused false-positive scope items in this phase.
- `tasks/todo.md` — H1 / H2 / H3 marker updates plus item 22 closure when L1 ships.
- `tasks/current-focus.md` — update at end of build.

No `docs/capabilities.md` change (no customer-visible capability shifts).

---

## 12. Done definition

This spec ships when:

- L1: prod boot fails fast on missing/short (< 32 char) `WEBHOOK_SECRET`; the runtime fail-open branch in `verifyCallbackToken` is replaced by a fail-closed return + one-shot warn log in non-prod (prod is unreachable post-boot-fail); `tasks/todo.md` item 22 marker flipped to closed.
- L2: subaccount permission denials emit `auth.permission_denied` to `security_audit_events`, with the non-null `organisationId` invariant codified by an explicit assertion. `recordSecurityEvent` write failures emit `security.audit.write_failed` structured-log entries (single source of truth for audit-write-failure observability).
- L3: a botnet rotating IPs against a single email is capped at 10 attempts/5 minutes (burst) AND 100 attempts/hour (sustained). On a 429, the response selects `Retry-After` and `RateLimit-*` headers from the most-restrictive bucket across all four buckets so the caller's retry strategy aims at the binding constraint, not an incidental one.
- L4: the read-before-decide ordering invariant on `decideOutcomeMeasurement` is asserted by a pure-function test in the existing dotted file. Race-safe single-outcome property tracked as deferred (§13).
- L5: every optimiser-touching PR runs the cost-gate workflow against a seeded fixture; the workflow fails the run when the measured cost is ≥ $0.02/sa/day, and on every run (pass and fail) emits diagnostic numbers (`totalTokens`, `numberOfRenderCalls`, `averageTokensPerRecommendation`, `totalCostDollars`) in a structured log line + GitHub annotation so the cause of any drift is immediately visible. Branch-protection configuration that elevates this failed run into a merge block is operator action — see §13.
- L6: no code change. H3 marker flipped to closed with present-state evidence.
- H1 / H2 / H3: stale `[OPEN]` and unresolved markers in `tasks/todo.md` are corrected.
- H4: `operator-runbook.md` captures conditional re-evaluation triggers, including the L5 cost-gate proactive 80% trigger.
- All doc-sync items in §11 are landed in the same PR.

After merge, `tasks/current-focus.md` is updated and development is locked down for test pass.

---

## 13. Deferred Items

This section lists items considered for inclusion in this spec and explicitly left out, with their re-evaluation trigger.

**Inclusion rule.** This spec scopes to the *security/correctness* shortlist that surfaced in the pre-launch-phase-2 review pipeline plus the audit-summary hygiene markers. Items from the same `chatgpt-pr-review` cluster that are *non-security* in nature (architecture decisions, UX polish, generic-constraint tightening) stay in `tasks/todo.md` under their own `[ ]` markers and are not re-listed here. Specifically: CHATGPT-R1-6 (`isActive` generic constraint — architecture call) and CHATGPT-R1-8 (GHL auto-enrol pagination / partial-onboarding UX — design call) are open in `tasks/todo.md:3094` and `tasks/todo.md:3103` respectively, do not match the pre-launch shortlist criteria, and are not in this spec's deferred set. They remain owned by their own future spec/build.

Items considered for inclusion in this spec and explicitly left out, with their re-evaluation trigger:

- **AR-3.1 (advisory lock scope ambiguity for pg-boss dispatch).** Verification-only — the existing `singletonKey` defence at the pg-boss layer prevents double-execution even if the advisory lock scope is too narrow. Re-evaluation trigger: any pg-boss dispatch behaviour change in `workflowEngineService.ts`. (Source: `tasks/todo.md:3055`)
- **AR-1.1 (sentinel-UUID admin awareness).** The sentinel pattern is intentional; admin queries are the only consumers and they currently scope to real org UUIDs. Re-evaluation trigger: addition of any admin UI/query that needs to surface pre-auth events. The sentinel comment is already in `securityAuditService.ts:9-15`. (Source: `tasks/todo.md:3065`)
- **AR-4.1 (PII substring blacklist).** Current callers are safe — none store credential material. Re-evaluation trigger: any new caller of `recordSecurityEvent` that passes a `meta` object built from arbitrary input. (Source: `tasks/todo.md:3073`)
- **AR-6.1 (`refreshIfExpired` org scoping caller discipline).** All current call sites are org-scoped by construction. Re-evaluation trigger: addition of any admin-path caller of `getAccessToken`. (Source: `tasks/todo.md:3077`)
- **CHATGPT-R1-4 (audit-stream lint rule).** Architecture call required (API vs lint rule); non-trivial refactor. Re-evaluation trigger: drift detected by the existing grep gate. (Source: `tasks/todo.md:3090`)
- **CHATGPT-R1-7 (OAuth state TTL revert).** Needs telemetry that does not exist pre-launch. Re-evaluation trigger: one week of staging `expired-on-callback` data. Captured in `operator-runbook.md` per H4. (Source: `tasks/todo.md:3098`)
- **DG-4 (optimiser timezone column).** Schema decision; UTC is acceptable for v1. Re-evaluation trigger: customer feedback that 06:00 UTC stagger is wrong for them. (Source: `tasks/todo.md:2402`)
- **F3 (`@rls-allowlist-bypass` runtime enforcement).** Architectural — touches every annotated call site. Re-evaluation trigger: any new admin-bypass call site or a discovered bypass abuse. (Source: `tasks/todo.md:1586`)
- **L4 race-safe single-outcome property under parallel invocation.** The transactional guarantee (`db.transaction` + advisory lock + claim-verify NOT-EXISTS re-check) cannot be asserted with a pure-function shim. The existing `measureInterventionOutcomeJob.idempotency.test.ts` docstring already documents this constraint. Re-evaluation trigger: any change to `measureInterventionOutcomeJob`'s claim/commit path, OR a real-Postgres CI harness landing for any other reason. (Source: this spec §4.L4)
- **Hermes `MIN_MEANINGFUL_ERROR_LENGTH` guard on `errorMessage`.** A short low-signal `errorMessage` (e.g. `"Error"`, `"Failed"`) currently allows extraction to proceed via `hasStructuredError`. Re-evaluation trigger: observed memory pollution from low-signal errors after staging telemetry exists, OR any other Hermes hardening pass. (Source: this spec §4.L6 out-of-scope note)
- **L5 branch-protection rule for `optimiser-cost-gate`.** The workflow itself fails the run on cost overrun; whether that failed run *blocks merge* depends on a branch-protection rule in the GitHub repo admin, which is operator action, not a file in this PR. Re-evaluation trigger: when this spec merges, the operator configures the `optimiser-cost-gate` workflow as a required status check on `main`. If left unconfigured, L5's "merge block" is degraded to "merge advisory." (Source: this spec §4.L5)
- **All workflows-v1 / agentic-commerce / pre-test-* deferred sections.** Out of scope for the pre-launch hardening sweep; their own spec/build owns re-evaluation. (Source: `tasks/todo.md` various — see §13 of the original triage report)

---

## 14. Pre-review checklist

Per the spec-authoring checklist Appendix:

- [x] §0 Verification log — every cited item verified open or closed; closed items dropped to hygiene only
- [x] No new application primitives — every code change extends an existing one. Net-new artifacts are limited to: one CI workflow (L5), one new pure-function test file (L2), and extensions to two existing test files (L3, L4).
- [x] File inventory — all new and changed files listed in §3
- [x] Contracts — two data shapes introduced (§8: sustained + burst email-only rate-limit keys); existing primitives produce/consume them
- [x] No new tenant-scoped tables — RLS checklist trivially satisfied (§5)
- [x] Execution model — synchronous / inline; no queues, no caches (§6)
- [x] Phase graph — single chunk; optional split documented (§7)
- [x] Deferred items section present (§13)
- [x] Goals ↔ Implementation match — no Goals contradicted by §4
- [x] Testing plan consistent with `docs/spec-context.md` — pure-function and CI-gate only (§10)
- [x] Idempotency / retry / concurrency for every write — declared in §9
- [x] Terminal events — declared for L2 (§9)
- [x] Unique-constraint handling — L4's `23505` is job-level no-op (§9). No HTTP unique-constraint mapping introduced because no new routes are added.
- [x] No state machines introduced — declared in §9
- [x] Frontmatter present at top of file

Ready for `spec-reviewer`.
