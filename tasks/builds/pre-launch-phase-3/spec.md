# Pre-Launch Phase 3 — Deferred Backlog Closure (Spec)

**Status:** draft
**Spec date:** 2026-05-05
**Last updated:** 2026-05-05
**Author:** spec-coordinator (Opus, parallel session alongside baseline-capture REVIEWING)
**Build slug:** pre-launch-phase-3
**Source branch:** `claude/pre-launch-phase-3` (forked from `main` at `a7ad66fc`)

---

## Table of contents

1. Goals
2. Non-goals
3. Framing assumptions (confirmed against `docs/spec-context.md`)
4. Present-state verification (per checklist §0)
5. Existing-primitives search (per checklist §1)
6. Domain model deltas
7. Service-contract deltas
8. Permissions / RLS checklist (per checklist §4)
9. Execution model (per checklist §5)
10. Phase sequencing (dependency graph, per checklist §6)
11. Chunk plan
12. Execution-safety contracts (per checklist §10)
13. Deferred items
14. Self-consistency pass
15. File inventory lock
16. Testing posture
17. Open questions

Appendix A — Source-of-finding traceability

---

## 1. Goals

Close the deferred backlog accumulated during Pre-Launch Phases 1 (PR #261) and 2 (PR #264). The backlog is exhaustively enumerated in `tasks/todo.md` and grouped below by source-of-finding. Phase 3 is the final pre-launch hardening pass — after this branch merges, pre-launch hardening is operationally complete and the next workstream is pre-launch UAT / first-agency onboarding.

Each item below carries a verdict: **BUILD**, **DEFER (with target trigger)**, or **WONT-DO (with reason)**. The Phase 3 build chunk plan in §11 enumerates only the BUILD items.

### Success criteria

- All 24 source items have an explicit verdict in this spec.
- BUILD items ship behind grep-gate / lint-rule / structured-log invariants where applicable, so regression is caught at CI not in production.
- The four CI grep-invariant guards (R3-1) trip on a known-bad fixture before they ship.
- No new tenant-scoped tables are introduced (Phase 3 is hardening on existing primitives — RLS checklist applies only to call-site additions on existing tables).
- All BUILD items leave behind a documented mechanism (lint rule, grep gate, structured log event, or schema constraint) — not "remember to do X".

## 2. Non-goals

- **No new product features.** Phase 3 closes deferred hardening items only. Anything that smells like "build a new capability" is out of scope.
- **No dual-stream re-architectures.** R1-4 (audit-stream split lint rule) and R3-2 (canonical error taxonomy) are explicitly scoped to "make the existing thing safer" — neither replaces the underlying pattern.
- **No telemetry instrumentation that requires production traffic to act on.** R1-7 (OAuth state TTL telemetry) ships the metric *emission* but does not commit to the revert decision; that decision is post-launch.
- **No load testing of guards.** R2-6 (pre+post invalidation guards double DB reads) is acknowledged as a deferral with no Phase 3 work — re-evaluation happens after first production traffic.
- **No backfill of the canonical error taxonomy** (R3-2). Phase 3 ships the type and migrates new throw sites only; the existing throw-site sweep is itself a Phase 4 item.
- **No frontend tests, no API contract tests, no E2E tests.** Per `docs/spec-context.md` framing.

## 3. Framing assumptions (confirmed against `docs/spec-context.md`)

- Pre-production, no live users, no live agencies. Commit-and-revert rollout model.
- Testing posture: static gates + pure-function tests only. No vitest/jest/playwright/supertest for own-app.
- Prefer extending existing primitives — `securityAuditService`, `queryHelpers.isActive/assertActive`, `rateLimitKeys`, `withOrgTx`, `withBackoff`, `runStatus.ts`, `recordSecurityEvent` — over inventing new ones.
- Feature flags only for behaviour modes (dev/prod, shadow/active). Not for staged rollout — there's no rollout to stage.
- No new tenant-scoped tables expected. If one becomes necessary, the four-requirement checklist in `docs/spec-authoring-checklist.md §4` applies.

## 4. Present-state verification (per checklist §0)

Each cited deferred item was verified against current `main` HEAD (`a7ad66fc`) before inclusion. Findings:

| Item | Verification | Outcome |
|------|--------------|---------|
| CHATGPT-R1-4 audit-stream split | `scripts/verify-audit-stream-split.sh` exists and is grep-based | open |
| CHATGPT-R1-6 `isActive` constraint | `server/lib/queryHelpers.ts:8` — generic is `<T extends { deletedAt: unknown }>` | open |
| CHATGPT-R1-7 OAuth state TTL | 5min in `ghlOAuthStateStore.ts` / `oauthStateNonces` table; no telemetry emission today | open |
| CHATGPT-R1-8 GHL pagination | `autoEnrolAgencyLocations` in `oauthIntegrations.ts:424` — no cursor, no UI state | open |
| CHATGPT-R2-2 `logAndSwallow` | Helper at `client/src/lib/silentCatchHelper.ts` (client-side, not server — Phase 2 log mis-attributed). Currently emits `console.debug` only | open (correctly framed: client only) |
| CHATGPT-R2-3 client-errors dedupe | `server/routes/clientErrors.ts` — rate-limited + 16kb body cap; no hash dedupe | open |
| CHATGPT-R2-6 invalidation guards | New pre+post checks land in Phase 2 services; no profiling data | DEFER (no work in Phase 3) |
| CHATGPT-R3-1 CI grep invariants | Pattern proven by `verify-audit-stream-split.sh` + `verify-rls-contract-compliance.sh`; three new invariants enumerated | open |
| CHATGPT-R3-2 error taxonomy | No canonical `{code,statusCode,message,context?}` shape across server today | open |
| CHATGPT-R3-6 audit namespace | `securityAuditService` accepts string `eventType`; mixed prefixes in current call sites | open |
| AR-3.1 advisory-lock scope | `workflowEngineService.ts:840, 1897-1924` — `pg_try_advisory_xact_lock` + later `pgboss.send`; verify transaction boundary | open |
| AR-5.1 login RL email-bucket | `rateLimitKeys.ts:24-28` — keys are `ip:email`; no separate per-email bucket | open |
| AR-1.1 sentinel-UUID audit rows | `auth.ts:92` writes login-failure rows with sentinel-org UUID | open |
| AR-2.2 subaccount permission audit | `middleware/auth.ts:349-394` — `requireSubaccountPermission` does not call `recordSecurityEvent` on 403 | open |
| AR-4.1 PII blacklist exact-match | `securityAuditServicePure.ts:31-38` — exact-key blacklist | open |
| AR-6.1 `connectionTokenService` discipline | `connectionTokenService.ts:147-174` — `guard-ignore-next-line` exempted; no service-layer org-id assertion | open |
| Phase-1 residue: migration `0277` header | Allowlisted via `rls-not-applicable-allowlist.txt`; no inline comment | open |
| Phase-1 residue: signup RL email-bucket | Same root cause as AR-5.1; merged with AR-5.1 below | merged |
| Phase-1 residue: GHL enrol cap | No `MAX_GHL_LOCATIONS_TO_ENROL` constant; 15s race timer relied upon | open |
| Phase-1 residue: `withOrgTx({ tx: db })` | KNOWLEDGE.md doc shipped; code refactor still open | open |
| Phase-1 residue: agent-triggered GHL OAuth resume | `pendingRunId` column + `enqueueResumeAfterOAuth` exist; initiation site `routes/ghl.ts:36` does not pass `pendingRunId` | open (defer, see §11) |
| REQ #4 maintenance-job tests | Pure-function tests shipped; integration tests deferred per `feedback_unit-tests-mid-build` posture | DEFER permanent (mini-spec amendment, see §11) |
| REQ #15 skill-envelope CI gate | No gate; mixed shapes in `connectorConfigService.ts`, `ghlAgencyOauthService.ts`, `locationTokenService.ts`, `skillExecutor.ts` | open |
| REQ #29 SC-COVERAGE-BASELINE | Placeholder text in `tasks/builds/pre-launch-phase-2/progress.md` | open (low-effort capture) |

All items verified open or explicitly merged. No item closed by surrounding work since Phase 2.

## 5. Existing-primitives search (per checklist §1)

| Phase 3 work | Existing primitive | Verdict |
|--------------|--------------------|---------|
| Audit-stream lint rule (R1-4) | `scripts/verify-audit-stream-split.sh` (grep gate); no ESLint rule infrastructure exists today | extend grep gate; defer ESLint rule unless trivial |
| `isActive` constraint tightening (R1-6) | `server/lib/queryHelpers.ts` already exposes the helper | extend in place — narrow generic to Drizzle table types |
| OAuth state TTL telemetry (R1-7) | `securityAuditService` and `recordSecurityEvent` already exist | reuse — emit `oauth.state.expired` and `oauth.state.not_found` events through the existing audit stream |
| GHL pagination (R1-8) | pg-boss queue infra (`createWorker`); job-row pattern from `autoStartOnboardingWorkflows`; cursor pattern absent | extend with a new background-job continuation that reuses pg-boss queue |
| `logAndSwallow` observability (R2-2) | Helper at `client/src/lib/silentCatchHelper.ts`; backend `/api/client-errors` route | extend helper; reuse existing endpoint |
| client-errors dedupe (R2-3) | `server/routes/clientErrors.ts` already rate-limits | extend in place — add hash-dedupe before rate-limit |
| CI grep invariants (R3-1) | `verify-audit-stream-split.sh` + `verify-rls-contract-compliance.sh` are the proven patterns | extend pattern — three new sibling scripts |
| Canonical error taxonomy (R3-2) | `server/lib/asyncHandler.ts` already maps `{statusCode, message, errorCode}`; no canonical class | invent new — but minimal: a single `AppError` class with a discriminated `code` enum, sourced from existing throws |
| Audit namespace doc (R3-6) | `securityAuditService` accepts free-form strings | extend — add a typed enum, write convention doc |
| Advisory-lock scope (AR-3.1) | `pg_try_advisory_xact_lock` + `pgboss.send` already in `workflowEngineService.ts` | confirm-or-fix; if dispatch escapes the transaction, restructure |
| Login RL email-bucket (AR-5.1 + Phase-1 residue) | `rateLimitKeys.ts` + DB rate limiter | extend in place — add separate email-keyed bucket alongside existing `ip:email` |
| Sentinel-UUID audit (AR-1.1) | `securityAuditService` already writes sentinel-org rows | document + protect — admin queries on `security_audit_events` must filter `OR organisation_id = SENTINEL_ORG_ID` when login-failure rows are needed |
| Subaccount permission audit (AR-2.2) | `recordSecurityEvent` already exists in `requireOrgPermission` | mirror call into `requireSubaccountPermission` |
| PII blacklist (AR-4.1) | `PII_BLACKLIST` constant in `securityAuditServicePure.ts` | extend — add `PII_SUBSTRINGS` substring check alongside exact-match |
| `connectionTokenService` discipline (AR-6.1) | Existing `guard-ignore-next-line` + service contract | add service-layer assertion — `principalContext.organisationId === connection.organisationId` before refresh |
| Migration `0277` header (Phase-1 residue) | DEVELOPMENT_GUIDELINES §6.3 convention; allowlist file | add inline comment to migration; no infra change |
| GHL enrol cap (Phase-1 residue) | `MAX_WORKFLOW_RUN_DEPTH` is the established constant pattern | mirror — add `MAX_GHL_LOCATIONS_TO_ENROL` |
| `withOrgTx({ tx: db })` refactor (Phase-1 residue) | `db.transaction` + GUC-setter; KNOWLEDGE.md doc already shipped | refactor in place — replace `withOrgTx({ tx: db })` with a real `db.transaction` + GUC wrapper |

No invent-new primitives except `AppError` (R3-2), which is justified inline because no canonical typed-error class exists today and the duck-shape `{statusCode, message, errorCode}` is fragile against typo'd field names. All other work extends existing patterns.

## 6. Domain model deltas

Phase 3 is hardening — no new tenant entities. Deltas:

- **`AppError` class** (R3-2) — new TypeScript class in `server/lib/errors.ts` (or co-located with `asyncHandler.ts`). Single shape `{ code: string, statusCode: number, message: string, context?: Record<string, unknown> }`. Has a discriminated `code` enum sourced from a new `shared/errorCodes.ts` registry.
- **Audit-event-name enum** (R3-6) — new TypeScript union in `shared/types/securityAuditEvents.ts` with the four namespaces (`auth.*`, `oauth.*`, `security.*`, `audit.*`). `securityAuditService.recordEvent` is re-typed to accept this union, not `string`.
- **`MAX_GHL_LOCATIONS_TO_ENROL`** — new constant in `server/config/systemLimits.ts`. Default value pinned in §11.
- **Sentinel-org constant exposure** — `SENTINEL_ORG_ID` (already exists in Phase 2) made an exported constant from `server/services/securityAuditService.ts` so admin-query helpers can OR-filter against it. No new constant — promotion from local to exported.

Schema change scope is intentionally minimal:

- **One new column** on `subaccounts`: `external_id_namespace text` (nullable; default null) — required by D.5 to support the partial-unique index for cross-page idempotent insertion of GHL locations.
- **One new partial-unique index**: `subaccounts_org_external_ghl_location_idx ON (organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL`.
- **One inline backfill UPDATE** in the same migration sets `external_id_namespace = 'ghl_location'` on existing rows whose `external_id` was set by the inline GHL path (identifiable via `connector_config_id` join to a GHL connector). No data risk pre-launch — no live agencies.
- **One migration-header comment fix** on `0277_oauth_state_nonces.sql` (in-file comment edit only — does not bump migration version).

Migration number for the schema change: next sequential number after current head (build-time decision). No other tables modified. No new tables. No RLS policy changes — `subaccounts` already has its policy and is in the manifest.

## 7. Service-contract deltas

Each contract that changes is named here. Producer/consumer pairs explicit per checklist §3.

### 7.1 `AppError` (new)

- **Type:** TypeScript class extending `Error`
- **Shape:** `{ code: AppErrorCode, statusCode: number, message: string, context?: Record<string, unknown> }`
- **Producer:** any service or route that throws a typed error; new throws ONLY in Phase 3 (existing throw-sites not retrofitted)
- **Consumer:** `asyncHandler` in `server/lib/asyncHandler.ts`. Reads `code` and `statusCode` mechanically. Existing fallback to `instanceof Error` retained.
- **Example instance:**
  ```typescript
  throw new AppError({
    code: 'BASELINE_SKIP_PRECONDITION_FAILED',
    statusCode: 409,
    message: 'Cannot skip artefact in current state',
    context: { artefactId, currentStatus }
  });
  ```
- **Nullability:** `context` may be undefined. `code` and `statusCode` are required. `message` is required and human-readable.
- **Source-of-truth precedence:** `AppError.statusCode` > prior `errorCode` mapping > `statusCode` fallback in `asyncHandler`. Existing throw-sites that surface `{statusCode, message, errorCode}` shapes continue to work — `asyncHandler` checks `instanceof AppError` first, falls through to the duck-typed shape second.

### 7.2 Audit event name (re-typed)

- **Type:** Discriminated union — `'auth.login_succeeded' | 'auth.login_failed' | 'auth.signup' | ... | 'oauth.state_issued' | 'oauth.state_expired' | ... | 'security.rate_limit_trip' | ... | 'audit.permission_granted' | ...`. The full list is enumerated in `shared/types/securityAuditEvents.ts` and is closed (any addition requires a spec amendment).
- **Producer:** every call site of `securityAuditService.recordEvent` or `recordSecurityEvent`. Phase 3 migrates ALL existing call sites — this is the rename pass.
- **Consumer:** `securityAuditService` writer + admin query surfaces.
- **Example instance:** `'oauth.state_expired'` (new event added by R1-7).
- **Nullability:** required, non-empty.
- **Source-of-truth precedence:** the union type. The DB stores the string verbatim; type-narrowing happens at write time.

### 7.3 Login rate-limit key (extended)

- **Type:** Two parallel keys. Existing: `rl:v1:auth:login:ip-email:<ip>:<normalised-email>`. New: `rl:v1:auth:login:email:<normalised-email>`.
- **Producer:** `rateLimitKeys.ts` exports two helper functions — existing `loginIpEmailKey(ip, email)` + new `loginEmailOnlyKey(email)`.
- **Consumer:** `routes/auth.ts` login handler — checks both buckets; failure is the union (either bucket trips → reject).
- **Limits:** existing `ip:email` keeps `10/60s` and `50/3600s`. New `email`-only bucket is `100/3600s`. Rationale below.
- **Rationale on the email-only limit:** the email-only bucket targets a single victim email under IP-rotation. 100/hour is generous for a real human user retrying their password (any real user hitting 100 attempts in an hour is themselves the abuser) but tight enough to defeat a 50-node botnet at 1k+ attempts/hr against the same email. Shared-IP organisations (offices, universities) are unaffected because the bucket is keyed on email, not IP — different users have different emails.

### 7.4 OAuth state lifecycle audit (new events)

- **Producer:** `consumeGhlOAuthState` (and any analogous OAuth state consumer) emits one of:
  - `oauth.state_issued` — on `setGhlOAuthState` write (already implicit; now logged)
  - `oauth.state_consumed` — on successful single-use consumption
  - `oauth.state_expired` — when consume finds row but `expires_at < now()`
  - `oauth.state_not_found` — when consume finds no row (could be expired-and-cleaned, never-set, or replay)
- **Consumer:** post-launch dashboard / admin query — Phase 3 only emits; no UI surface ships.
- **Cardinality budget:** all four events are bounded by OAuth callback rate; expected volume is single-digit per hour pre-launch. No sampling required.
- **Context payload:** each event includes `{ provider: 'ghl' | ..., userAgent, ipHash, callerSegment? }` so the post-launch revert decision (R1-7) can be made on segmented data, not aggregate.

### 7.5 `logAndSwallow` (extended observability)

- **Type:** Existing helper at `client/src/lib/silentCatchHelper.ts`. New behaviour: classify call sites by criticality (`critical` vs `noisy`); critical sites also POST to `/api/client-errors` (existing endpoint, dedupe-protected per R2-3).
- **Producer:** updated callers in `client/src/components/**`, `client/src/pages/**`, `client/src/hooks/**` — each call site must declare `{ severity: 'critical' | 'noisy' }`.
- **Consumer:** `console.debug` (always); `/api/client-errors` (only when `severity === 'critical'`).
- **Migration:** existing call sites default to `'noisy'`. The list of `'critical'` sites is enumerated in §11 BUILD chunk and capped at ≤10 — pre-launch only the auth-flow + onboarding-flow paths are tagged critical.

### 7.6 `/api/client-errors` dedupe (extended)

- **Producer:** unchanged — `client/src/lib/silentCatchHelper.ts` POSTs.
- **Consumer:** `server/routes/clientErrors.ts` — adds an in-memory LRU keyed on `hash(message + stack)`. Window: 60s. Capacity: 1000 entries. Duplicates within window: 204 No Content (not rate-limited, not stored, not counted).
- **Idempotency posture:** `key-based` — the LRU IS the idempotency cache. Cache key is `sha256(message + '\n' + stack).slice(0,16)`.

### 7.7 `connectionTokenService.refreshIfExpired` cross-tenant assertion (extended)

- **Producer:** unchanged caller contract — connection object passed in by caller via org-scoped fetch.
- **Consumer:** `connectionTokenService.refreshIfExpired` adds an org-id assertion before the existing UPDATE. Reads `principalOrgId` from the in-scope `PrincipalContext` ALS.
- **New assertion:** `if (principalOrgId !== null && principalOrgId !== connection.organisationId) throw new AppError({code: 'CROSS_TENANT_TOKEN_REFRESH', statusCode: 403, message: '...', context: { connectionOrgId: connection.organisationId, principalOrgId }})`. The `principalOrgId !== null` guard preserves the existing system-admin override path (no PrincipalContext set during boot-time refresh sweeps).
- **Idempotency posture:** unchanged — assertion fires before the existing optimistic predicate.

## 8. Permissions / RLS checklist (per checklist §4)

No new tenant-scoped tables. Phase 3 touches existing tables `security_audit_events`, `oauth_state_nonces`, `integration_connections` — all already in `RLS_PROTECTED_TABLES` per Phase 1/2 manifest entries.

The two new audit-event types (`oauth.state_expired`, `oauth.state_not_found`) write under the sentinel-org UUID — same posture as existing pre-auth events. RLS `WITH CHECK` clause already permits sentinel-org writes per Phase 2 migration `0281`.

The login email-only RL bucket (§7.3) writes to the existing rate-limit storage (DB table or in-process — confirm at build time per existing pattern). No new table; no RLS implication.

The `connectionTokenService` discipline assertion (§7.7) is service-layer defence-in-depth — every existing call site already runs through an org-scoped fetch; the assertion catches the future-caller bug, not a present permission boundary.

## 9. Execution model (per checklist §5)

| Item | Model | Rationale |
|------|-------|-----------|
| AppError throws (R3-2) | Inline / synchronous | Throw-and-catch is by definition sync |
| Audit namespace rename (R3-6) | Inline / synchronous | Type-system change; no runtime cost |
| OAuth state telemetry (R1-7) | Inline / synchronous | `recordSecurityEvent` is already sync within `withOrgTx` |
| `logAndSwallow` critical → endpoint (R2-2) | Async / fire-and-forget | Caller continues; failure swallowed |
| client-errors dedupe (R2-3) | Inline / synchronous | LRU lookup is in-process |
| CI grep invariants (R3-1) | CI-only | Run by GitHub Actions; no runtime cost |
| GHL pagination (R1-8) | Queued / pg-boss | Auto-enrol becomes a job emission, not inline |
| GHL enrol cap (Phase-1 residue) | Inline / synchronous | A constant compared against array length pre-loop |
| Login email-only RL (AR-5.1) | Inline / synchronous | Existing rate-limit middleware path |
| Subaccount audit event (AR-2.2) | Inline / synchronous | Already in middleware path |
| PII substring (AR-4.1) | Inline / synchronous | Pure function in `securityAuditServicePure.ts` |
| Connection-token assertion (AR-6.1) | Inline / synchronous | Refresh path is sync |
| `withOrgTx({tx:db})` refactor (residue) | Inline / synchronous | Replaces existing sync wrapper |
| `isActive` constraint tightening (R1-6) | Compile-time | TypeScript-only |
| Migration header comment | Build-time / advisory | File edit only |

The only async addition is R1-8 GHL pagination (a new pg-boss job). All other items are inline extensions of existing sync paths.

## 10. Phase sequencing (dependency graph, per checklist §6)

Phase 3 is a single shipping unit (one PR, one squash merge). The chunk plan in §11 sequences chunks by dependency, not by phase boundary. Backward-dependency check:

- Chunk A (`AppError` + audit-namespace types) lands before Chunk B (R3-1 grep gates) because two of the gates (audit-namespace consistency, error-shape consistency) reference the types.
- Chunk C (auth observability events: AR-1.1, AR-2.2, OAuth-state telemetry) lands AFTER Chunk A only because the new event names use the namespace types from Chunk A.
- Chunk D (rate-limit + GHL pagination + GHL enrol cap + connection-token assertion + PII substring + advisory-lock scope) is independent of Chunks A/B/C.
- Chunk E (cleanup: migration-header comment, `withOrgTx({tx:db})` refactor, `isActive` constraint tighten, `logAndSwallow` severity tagging, client-errors dedupe, REQ #15 skill-envelope CI gate, REQ #29 baseline capture) — independent chunk; may run in parallel.

No chunk references a primitive built in a later chunk. No orphaned deferrals — every "deferred to Phase 4" item in §13 is named explicitly.

## 11. Chunk plan

The build chunks below are presented in dependency order. Each is sized to fit a single sub-agent build session per `subagent-driven-development` convention. The Phase 2 `feature-coordinator` will decompose further if needed.

### Chunk A — Canonical types (foundation)
- **A.1** New `shared/errorCodes.ts` registry — discriminated union of error codes seeded with codes already used in the codebase (e.g. `ARTEFACT_ALREADY_COMPLETED`, `OPTIMISTIC_LOCK_FAILED`). Initial enum is closed; additions require spec amendment.
- **A.2** New `server/lib/errors.ts` — `AppError` class. `asyncHandler` updated to handle `AppError` first.
- **A.3** New `shared/types/securityAuditEvents.ts` — closed union of audit event names across `auth.* | oauth.* | security.* | audit.*` namespaces. `securityAuditService` re-typed.
- **A.4** Rename pass — every existing `recordSecurityEvent` / `recordEvent` call site updated to use the typed constant. Mechanical fix; CI grep gate from Chunk B will catch regressions.
- **A.5** Convention doc — new `docs/security-audit-namespace.md` describing the four namespaces. Update `architecture.md` § Layer 4 to reference it.

### Chunk B — CI grep invariants (depends on A)
- **B.1** `scripts/verify-assert-active.sh` — grep guard that flags any service-layer fetch on a soft-deletable table that doesn't pass through `assertActive` / `isActive`. Allowlist file co-located.
- **B.2** `scripts/verify-no-raw-console.sh` — grep guard that forbids raw `console.*` calls outside an explicit allowlist (`server/index.ts` boot, `server/lib/logger.ts` internals, `scripts/**`, `server/__tests__/**`).
- **B.3** `scripts/verify-rate-limit-key-normalisation.sh` — grep guard that ensures every call to `loginIpEmailKey` / `loginEmailOnlyKey` (and any future `*Key` helper) receives a normalised email. The gate enforces the value-flow contract by tracing the email argument back to its assignment site and confirming the assignment matches one of: (a) inline `email.trim().toLowerCase()` / `normaliseEmail(email)`, or (b) a function parameter typed as `NormalisedEmail` (a new branded string type from `server/lib/rateLimitKeys.ts` returned only by `normaliseEmail()`). The branded-type approach is the canonical fix — it lets the grep gate compile to a simple "argument must be of type `NormalisedEmail`" check via TypeScript, with the grep-only fallback used only for files outside the type-checked scope. Centralised normalisation into a helper that returns `NormalisedEmail` is the intended pattern, not duplicated inline normalisation.
- **B.4** `scripts/verify-audit-event-namespace.sh` — grep guard that every call to `recordSecurityEvent` / `securityAuditService.recordEvent` uses a value from the `SecurityAuditEventName` union. Bypass-string detection: if `as SecurityAuditEventName` cast appears, fail with reviewer note.
- **B.5** Each gate gets a known-bad fixture file (gitignored, reproduced via shell snippet in the gate script's docstring) that's run in dev to prove the gate trips. Gates wired into the CI workflow alongside existing `verify-*.sh`.

### Chunk C — Observability and audit additions (depends on A)
- **C.1** OAuth state lifecycle telemetry — `consumeGhlOAuthState` emits `oauth.state_consumed` / `oauth.state_expired` / `oauth.state_not_found` per §7.4. `setGhlOAuthState` emits `oauth.state_issued`.
- **C.2** AR-2.2 — `requireSubaccountPermission` emits `auth.permission_denied` event in 403 branch, mirroring `requireOrgPermission`.
- **C.3** AR-1.1 — admin-query helper for `security_audit_events` exposes `includeSentinelOrg: boolean` parameter; doc note added to `architecture.md` Layer 4 section. No data migration.
- **C.4** Documentation: `docs/oauth-state-telemetry.md` describes the four event types and the post-launch revert decision criteria (segment breakdown, mobile vs desktop, IdP type — captured as `context` fields on the audit event so the admin can filter).

### Chunk D — Independent hardening
- **D.1** AR-5.1 — new `loginEmailOnlyKey` helper in `rateLimitKeys.ts`; `routes/auth.ts` login path checks both buckets. Limit: 100/3600s (rationale §7.3). Both buckets fail-open if storage backend errors (existing posture, unchanged).
- **D.2** AR-4.1 — `securityAuditServicePure.ts` extended with `PII_SUBSTRINGS = ['password','token','secret','authorization','credential']`. Substring match runs in addition to exact-key match. Pure-function test added.
- **D.3** AR-6.1 — `connectionTokenService.refreshIfExpired` adds an org-id assertion: `if (principalOrgId !== null && principalOrgId !== connection.organisationId) throw new AppError({code:'CROSS_TENANT_TOKEN_REFRESH', statusCode:403, ...})`. Sourced from the `PrincipalContext` ALS already in scope. Existing `guard-ignore-next-line` retained but augmented with the new assertion.
- **D.4** GHL enrol cap (Phase-1 residue) — `MAX_GHL_LOCATIONS_TO_ENROL = 250` in `server/config/systemLimits.ts`. `oauthIntegrations.ts:424` aborts and emits `oauth.enrol_capped` audit event when the agency exceeds the cap; the response redirects with a "partial-enrol" status flag, and the remaining locations are picked up by the D.5 background job. Cap value rationale: a 250-location agency at ~50ms/location auto-enrol completes in ~12.5s, comfortably under the existing 15s timeout; agencies beyond 250 locations always require the pagination job from R1-8.
- **D.5** R1-8 GHL pagination (background job) — new pg-boss job `ghl:auto-enrol-locations-page` that processes 50 locations per invocation, re-enqueues itself for the next page, and emits `oauth.enrol_progress` / `oauth.enrol_completed` / `oauth.enrol_failed` / `oauth.enrol_partial` audit events. Triggered when the inline path hits the §D.4 cap. Idempotency posture: `key-based`, keyed on each GHL location id (NOT the page cursor — page cursor is just a pagination token, not a stable identifier). The job queries the GHL locations API for the current page (`pageCursor` for the cursor, `limit=50`), then for each returned location performs an `INSERT ... ON CONFLICT (organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL DO NOTHING` on the `subaccounts` table. This makes per-location work idempotent under retry: re-running the same page (or any subset of locations) is a no-op for already-enrolled locations because the partial-unique constraint short-circuits the insert. **Required schema change** (folded into D.5): add `external_id_namespace text` column to `subaccounts` (default `null`, set to `'ghl_location'` for rows the job enrols), plus a partial-unique index `subaccounts_org_external_ghl_location_idx ON (organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL`. Backfill: existing GHL-enrolled subaccounts already have `external_id` populated by the inline path; a one-row-per-existing-row backfill UPDATE in the same migration sets `external_id_namespace = 'ghl_location'` for them. UI consumes the audit-event stream (the workflow runs page tab is the existing surface — no new UI).
- **D.6** AR-3.1 advisory-lock scope verification — read `workflowEngineService.ts:840-1924` and confirm whether `pgboss.send()` runs inside the same transaction as `pg_try_advisory_xact_lock`. If yes (xact lock holds across send): document via inline code comment + `architecture.md` note, no code change. If no (lock released before send): wrap the send in the same transaction, document in same comment + KNOWLEDGE.md entry. Decision routed to build-time after `feature-coordinator`'s `architect` invocation.

### Chunk E — Cleanup and convenience
- **E.1** R1-6 — narrow `isActive` and `assertActive` generics in `server/lib/queryHelpers.ts` to Drizzle `PgTable`-derived types. No behaviour change. CI typecheck + `verify-assert-active.sh` from B.1 catch new misuse.
- **E.2** R2-2 — `logAndSwallow` accepts `{ severity: 'critical' | 'noisy' }`. Default `'noisy'`. Critical sites (≤10) enumerated:
  - `client/src/pages/AdminAgentEditPage.tsx` — agent save catch
  - `client/src/pages/SystemOrganisationsPage.tsx` — org-load catch
  - `client/src/pages/SystemIncidentsPage.tsx` — incident-load catch
  - `client/src/pages/OnboardingWizardPage.tsx` — wizard step catch
  - `client/src/pages/SptOnboardingPage.tsx` — SPT step catch
  - `client/src/components/Layout.tsx` — top-level error boundary fallback
  - `client/src/App.tsx` — auth-token refresh catch
  - `client/src/hooks/useConversation.ts` — websocket failure catch
  - All other 11 call sites stay `'noisy'`. Critical sites POST to `/api/client-errors`.
- **E.3** R2-3 — LRU dedupe in `server/routes/clientErrors.ts` per §7.6.
- **E.4** Phase-1 residue: migration `0277_oauth_state_nonces.sql` — add inline `-- system-scoped: pre-auth OAuth state, no organisation_id available pre-callback` comment. File edit only; migration version unchanged.
- **E.5** Phase-1 residue: `withOrgTx({ tx: db })` refactor — replace the pattern in `oauthIntegrations.ts` callback with a real `db.transaction(async (tx) => { await setGUC(tx, orgId); ... })` wrapper. New `setOrgGUC(tx, orgId)` helper in `server/middleware/orgScoping.ts`. KNOWLEDGE.md "Gotcha" entry refreshed to reference the now-canonical helper.
- **E.6** REQ #15 — `scripts/verify-skill-error-envelope.sh`. In-scope paths: `server/skills/**/*.ts`, `server/tools/**/*.ts`, `server/services/skillExecutor.ts` `SKILL_HANDLERS`. Out-of-scope: `connectorConfigService.ts`, `ghlAgencyOauthService.ts`, `locationTokenService.ts` — these emit event payloads, not skill envelopes. The gate enforces the flat-string envelope shape: every return path matches `{ ok: true, ... } | { ok: false, error: string, errorCode?: string }` per the C4a-6-RETSHAPE contract. Mixed-shape allowlist (event-payload services) declared inline in the gate script.
- **E.7** REQ #29 — capture actual SC-COVERAGE-BASELINE numbers from the next CI run on `claude/pre-launch-phase-3` and write into `tasks/builds/pre-launch-phase-3/progress.md`. (Not `pre-launch-phase-2/progress.md` — that file is sealed; Phase 3 captures its own baseline against post-Phase-2 main.)

### Verdicts not in chunk plan (recorded for completeness)

| Item | Verdict | Reason |
|------|---------|--------|
| CHATGPT-R2-6 invalidation guards double-read | **DEFER (Phase 4 / post-launch)** | No profiling data; re-evaluate after first production traffic |
| CHATGPT-R1-7 OAuth TTL revert decision | **DEFER (post-launch)** | Telemetry emission ships in C.1 but the revert decision waits on baseline data |
| Phase-1 residue: agent-triggered GHL OAuth resume wiring | **DEFER (until agent-triggered GHL OAuth path is built)** | The wiring requires the consumer (an agent run that triggers OAuth) to exist. None today. The infrastructure (`pendingRunId` column, `enqueueResumeAfterOAuth` function) is ready; wiring is a one-line change at the future call site |
| REQ #4 maintenance-job tests | **WONT-DO (mini-spec amendment)** | Operator-locked decision per `feedback_unit-tests-mid-build` memory. Phase 3 amends the mini-spec done criteria to match pure-function tests as canonical |

## 12. Execution-safety contracts (per checklist §10)

Phase 3 introduces a small number of new write paths and one new state machine. Each is pinned below.

### 12.1 New write paths

| Path | Idempotency | Retry | Concurrency guard | Terminal event |
|------|-------------|-------|-------------------|----------------|
| `recordSecurityEvent` for new `oauth.*` events (C.1) | non-idempotent (intentional — append-only audit log) | safe (write retries are duplicate audit rows; admin queries deduplicate at read time if needed) | none required (append-only) | n/a (no chain) |
| `auth.permission_denied` from `requireSubaccountPermission` (C.2) | non-idempotent (intentional) | safe | none required | n/a |
| Login email-only RL bucket increment (D.1) | non-idempotent — race-tolerant counter | safe | atomic INCR / DB-row UPDATE per existing pattern | n/a |
| GHL enrol-locations-page job (D.5) | key-based — `INSERT ... ON CONFLICT (organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL DO NOTHING` per location returned by the GHL API | guarded — partial-unique index short-circuits already-enrolled locations under retry | pg-boss `singletonKey: ghl-enrol:${connectionId}:${pageCursor}` collapses concurrent invocations of the same page; per-location partial uniqueness handles cross-page retries | `oauth.enrol_completed` (success) `oauth.enrol_failed` (failure) `oauth.enrol_partial` (cap hit, more pages remain). Mutually exclusive — exactly one terminal event per `(connectionId, runId)` chain. |
| `connectionTokenService.refreshIfExpired` cross-tenant assertion (D.3) | n/a — read assertion before existing write | safe — assertion failure throws before the UPDATE | existing optimistic predicate retained | n/a |

### 12.2 State machine — GHL enrolment (D.5)

States: `pending → in_progress → completed | failed | partial`.

- Valid transitions: `pending → in_progress`, `in_progress → completed`, `in_progress → failed`, `in_progress → partial`.
- Forbidden: any backward transition (no `completed → in_progress`); no transition from terminal (`completed | failed | partial`) except via a fresh `(connectionId, newRunId)` chain — i.e. a re-trigger creates a new run, not a re-open of the old terminal.
- Status set is **closed** — adding a new status (e.g. `cancelled`) requires spec amendment.
- Pre-terminal state: an `in_progress` execution record (`oauth.enrol_progress` events) MUST exist before any terminal event is emitted.
- `partial`: emitted when the job hits `MAX_GHL_LOCATIONS_TO_ENROL` cap AND the operator-facing message includes a "resume" hint pointing at the manual re-trigger path.
- `failed`: emitted on unrecoverable error (auth-token revoked mid-page, GHL API 5xx beyond `withBackoff` retry budget).
- `completed`: emitted only after the last page returns 0 unprocessed locations.

### 12.3 DB unique constraints

One new partial-unique index in Phase 3 (D.5): `subaccounts_org_external_ghl_location_idx ON (organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL`. HTTP-mapping for `23505 unique_violation` raised through this index: catch in the D.5 job handler and short-circuit to "already enrolled" (this is the intended ON CONFLICT path). The route layer never surfaces this error — it's job-internal. No HTTP status-code mapping needed. The `AppError` class supports a `code: 'UNIQUE_VIOLATION_*'` prefix for the route-layer catch-and-rethrow pattern in general; the D.5 job uses ON CONFLICT directly to suppress the violation in the SQL layer.

Existing constraints (e.g. `agent_run_prompts (run_id, assembly_number)`) are unchanged.

## 13. Deferred items

- **OAuth state TTL revert decision (R1-7).** Phase 3 emits the four `oauth.state_*` events. The decision to keep 5min or revert to 10min waits on post-launch telemetry — minimum two weeks of staging traffic with mobile/desktop and IdP-type segment breakdown.
- **Invalidation-guards double-read profiling (R2-6).** Phase 3 ships no work. Re-evaluate after first production traffic spike OR after pre-launch load-testing run, whichever comes first.
- **Agent-triggered GHL OAuth resume wiring** (Phase-1 residue). The `pendingRunId` column + `enqueueResumeAfterOAuth` are infrastructure for a future feature where an agent run triggers an OAuth connection. No such consumer exists today; wiring is one line at the future call site. Not Phase 4 either — wired when the consumer is built.
- **Canonical error taxonomy backfill (R3-2 Phase 4).** Phase 3 ships the `AppError` class and `shared/errorCodes.ts` registry. Existing throw sites are NOT retrofitted — that's a Phase 4 sweep. New throws in Phase 3 use `AppError`; old throws continue to use `{statusCode, message, errorCode}` duck shape.
- **Audit namespace rename Phase 4 sweep.** Phase 3 renames every existing call site (Chunk A.4) — there is no Phase 4 sweep needed for this. Recorded here for completeness so the absence is intentional, not forgotten.
- **REQ #4 integration tests.** Permanently DEFER — pure-function tests are canonical per `feedback_unit-tests-mid-build`. The mini-spec text is amended in Chunk E (one-line edit to `docs/pre-launch-hardening-mini-spec.md`) to reflect this.
- **AR-3.1 advisory-lock scope** — if Chunk D.6 confirms the dispatch is outside the lock's transaction, the fix lands in Phase 3. If the lock + send are correctly co-located, no code change ships and the verification is documented inline. The decision is an artefact of the build, not a deferral.

## 14. Self-consistency pass

| Question | Verdict |
|----------|---------|
| Goals (close 24 deferred items with explicit verdicts) match Implementation (chunks A-E + verdicts table)? | yes |
| Every "single source of truth" claim survives? `AppError` is the canonical typed error (asyncHandler reads it first); `SecurityAuditEventName` union is the canonical event-name source; `MAX_GHL_LOCATIONS_TO_ENROL` is the canonical cap | yes |
| Non-functional claims match execution model? No latency/throughput claims made; cardinality budget for OAuth events explicitly bounded; GHL pagination explicitly async | yes |
| Every "must" / "guarantees" backed by mechanism? Audit-namespace rename gated by B.4 grep; `assertActive` adoption gated by B.1; raw-console regression gated by B.2; rate-limit normalisation gated by B.3 | yes |
| File inventory? Every file mentioned in §5–§11 is enumerated below | see §15 |

## 15. File inventory lock

### Files to create
- `shared/errorCodes.ts` — error-code registry (A.1)
- `shared/types/securityAuditEvents.ts` — audit event-name union (A.3)
- `server/lib/errors.ts` — `AppError` class (A.2)
- `docs/security-audit-namespace.md` — convention doc (A.5)
- `docs/oauth-state-telemetry.md` — telemetry doc (C.4)
- `scripts/verify-assert-active.sh` (B.1)
- `scripts/verify-no-raw-console.sh` (B.2)
- `scripts/verify-rate-limit-key-normalisation.sh` (B.3)
- `scripts/verify-audit-event-namespace.sh` (B.4)
- `scripts/verify-skill-error-envelope.sh` (E.6)
- `server/jobs/ghlAutoEnrolLocationsPageJob.ts` — pagination job (D.5)
- `migrations/<next-sequential>_subaccounts_external_id_namespace.sql` — adds `external_id_namespace` column + partial-unique index + backfill UPDATE (D.5)

### Files to modify
- `server/lib/asyncHandler.ts` — handle `AppError` first (A.2)
- `server/services/securityAuditService.ts` — re-typed `eventType` parameter (A.3)
- All existing call sites of `recordSecurityEvent` / `securityAuditService.recordEvent` — rename to use union constants (A.4); enumerated at build time, expected ~30 sites
- `architecture.md` § Layer 4 — namespace + telemetry references (A.5, C.4)
- `server/lib/queryHelpers.ts` — narrow `isActive` / `assertActive` generics (E.1)
- `client/src/lib/silentCatchHelper.ts` — accept `severity` param (E.2)
- `client/src/pages/{AdminAgentEditPage,SystemOrganisationsPage,SystemIncidentsPage,OnboardingWizardPage,SptOnboardingPage}.tsx` — tag critical (E.2)
- `client/src/components/Layout.tsx` — tag critical (E.2)
- `client/src/App.tsx` — tag critical (E.2)
- `client/src/hooks/useConversation.ts` — tag critical (E.2)
- `server/routes/clientErrors.ts` — LRU dedupe (E.3)
- `migrations/0277_oauth_state_nonces.sql` — inline header comment (E.4)
- `server/middleware/orgScoping.ts` — `setOrgGUC(tx, orgId)` helper (E.5)
- `server/routes/oauthIntegrations.ts` — replace `withOrgTx({tx:db})` pattern (E.5); enrol cap (D.4)
- `server/services/ghlAgencyOauthService.ts` — emit OAuth state lifecycle events (C.1); enrol-page job dispatch (D.5)
- `server/services/ghlOAuthStateStore.ts` — emit `oauth.state_consumed` / `oauth.state_expired` / `oauth.state_not_found` (C.1)
- `server/middleware/auth.ts` — `requireSubaccountPermission` emits `auth.permission_denied` (C.2)
- `server/lib/rateLimitKeys.ts` — `loginEmailOnlyKey` helper (D.1)
- `server/routes/auth.ts` — login checks both RL buckets (D.1)
- `server/services/securityAuditServicePure.ts` — `PII_SUBSTRINGS` extension (D.2)
- `server/services/connectionTokenService.ts` — cross-tenant assertion (D.3)
- `server/config/systemLimits.ts` — `MAX_GHL_LOCATIONS_TO_ENROL = 250` (D.4)
- `server/services/workflowEngineService.ts` — advisory-lock scope verification (D.6, may or may not change code)
- `server/db/schema/subaccounts.ts` — add `externalIdNamespace: text('external_id_namespace')` column + register the partial-unique index in the table builder (D.5)
- `KNOWLEDGE.md` — refresh `withOrgTx({tx:db})` gotcha entry (E.5)
- `docs/pre-launch-hardening-mini-spec.md` — amend REQ #4 done-criteria text (E.6 verdict)
- `tasks/builds/pre-launch-phase-3/progress.md` — capture SC-COVERAGE-BASELINE numbers (E.7)

### Files NOT to modify (scope guardrail)
- Existing throw-sites that surface `{statusCode, message, errorCode}` duck shape — Phase 4 sweep, not Phase 3
- Pre-existing `verify-*.sh` scripts other than wiring four new gates into the umbrella runner
- The `agent-triggered GHL OAuth resume` initiation site — deferred until consumer exists
- Any UI for GHL pagination status — re-uses the workflow-runs surface

## 16. Testing posture

Per `docs/spec-context.md` framing:

- **Static gates**: 5 new gates ship in Chunk B + E (B.1–B.4, E.6). Each gate has a known-bad fixture proven to trip it before merge.
- **Pure-function tests**: PII substring expansion (D.2), AppError-shape sanity, `loginEmailOnlyKey` builder, OAuth state event emission. All written as `*.Pure.test.ts` next to the source file. Run via `npx tsx <file>` per CLAUDE.md.
- **No vitest/jest/playwright**. No supertest. No frontend tests. No API contract tests.
- **No runtime integration tests** for GHL pagination — pre-production, no live agencies. The state machine is validated by the gate scripts + structured-log assertions in adjacent pure tests.
- **Test gates are CI-only** per `references/test-gate-policy.md`. Local dev runs lint + typecheck + targeted pure tests.

## 17. Open questions

These are resolved at build time by the `architect` sub-agent or escalated by `builder`:

1. **AppError code-enum scope.** Initial seed-set: which existing error codes are migrated into the typed union vs left as raw strings? Architect to enumerate from `git grep "errorCode:" server/`.
2. **D.6 advisory-lock decision.** Read of `workflowEngineService.ts:840-1924` will resolve whether code change is needed. Build-time decision.
3. **REQ #29 baseline numbers.** Captured from CI on first push to `claude/pre-launch-phase-3`. Requires CI to run, then operator update of `progress.md`.
4. **`logAndSwallow` critical sites — final list.** §11 E.2 enumerates 8 critical sites; build-time review of the remaining 11 may upgrade one or two more to critical. Cap at ≤10 stays.

---

## Appendix A — Source-of-finding traceability

Every Phase 3 chunk traces back to a source-of-finding, for audit:

| Chunk | Source | Finding ID |
|-------|--------|-----------|
| A.1, A.2 | chatgpt-pr-review R3 | R3-2 |
| A.3, A.4, A.5 | chatgpt-pr-review R3 | R3-6 |
| B.1 | chatgpt-pr-review R3 | R3-1 (sub-1 — assertActive) |
| B.2 | chatgpt-pr-review R3 | R3-1 (sub-2 — raw console) |
| B.3 | chatgpt-pr-review R3 | R3-1 (sub-3 — RL key normalisation) |
| B.4 | chatgpt-pr-review R3 | R3-1 (sub-4 — namespace consistency) — also R1-4 (audit-stream split tightening, since the namespace gate enforces routing) |
| C.1 | chatgpt-pr-review R1 | R1-7 (telemetry side) |
| C.2 | adversarial-reviewer R2 | AR-2.2 |
| C.3 | adversarial-reviewer R2 | AR-1.1 |
| C.4 | chatgpt-pr-review R1 | R1-7 (doc side) |
| D.1 | adversarial-reviewer R2 + Phase-1 residue | AR-5.1, signup-RL email-bucket |
| D.2 | adversarial-reviewer R2 | AR-4.1 |
| D.3 | adversarial-reviewer R2 | AR-6.1 |
| D.4 | Phase-1 residue | GHL enrol cap |
| D.5 | chatgpt-pr-review R1 | R1-8 |
| D.6 | adversarial-reviewer R2 | AR-3.1 |
| E.1 | chatgpt-pr-review R1 | R1-6 |
| E.2 | chatgpt-pr-review R2 | R2-2 |
| E.3 | chatgpt-pr-review R2 | R2-3 |
| E.4 | Phase-1 residue | migration 0277 header |
| E.5 | Phase-1 residue | `withOrgTx({tx:db})` refactor |
| E.6 | spec-conformance Phase 2 | REQ #15 |
| E.7 | spec-conformance Phase 2 | REQ #29 |

24 source items → 5 chunks (A-E) + 4 explicit verdicts (deferred / wont-do). Every source item accounted for.

---

**Status:** draft. Next: spec-reviewer (Codex) → chatgpt-spec-review (manual ChatGPT-web) → handoff to feature-coordinator.
