# Spec Conformance Log

**Spec:** `tasks/builds/pre-launch-phase-3-deferred-backlog/spec.md`
**Spec commit at check:** `1ef651a0` (HEAD)
**Branch:** `claude/pre-launch-phase-3`
**Base:** `main`
**Scope:** all five chunks A through E (developer claimed completion; whole-branch verification)
**Changed-code set:** ~67 files committed + plan.md untracked + progress.md modified
**Run at:** 2026-05-06T02:10:53Z
**Commit at finish:** `77fb2ebf` (local-only — push deferred; remote diverged with 2 commits including a different `plan.md` add/add conflict that requires operator decision)

---

## Table of contents

1. Summary
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional / ambiguous gaps
5. Files modified by this run
6. Notes on items NOT flagged
7. Next step

---

## 1. Summary

- Requirements extracted:     63
- PASS:                       60
- MECHANICAL_GAP → fixed:      0
- DIRECTIONAL_GAP → deferred:  3
- AMBIGUOUS → deferred:        0
- OUT_OF_SCOPE → skipped:      0

**Verdict:** NON_CONFORMANT (3 directional gaps; all routable, none blocking shipping urgency, but require operator judgement before pr-reviewer)

---

## 2. Requirements extracted (full checklist)

### Chunk A — Canonical types (foundation)

| REQ | Spec section | Requirement | Verdict |
|-----|--------------|-------------|---------|
| A-1 | §11 A.1, §15 | `shared/errorCodes.ts` exports `APP_ERROR_CODES` const array + `AppErrorCode` union including `CROSS_TENANT_TOKEN_REFRESH`, `MISSING_PRINCIPAL_CONTEXT`, plus seed-set | PASS |
| A-2 | §11 A.2, §7.1, §15 | `server/lib/errors.ts` exports `AppError` class with readonly `code`, `statusCode`, `context` (frozen) | PASS |
| A-3 | §7.1 | `AppError` accepts `{code, statusCode, message, context?}`; `context` is `Object.freeze`-ed at construction | PASS |
| A-4 | §11 A.2, §7.1 | `asyncHandler` checks `instanceof AppError` first; legacy `{statusCode, message, errorCode}` errors normalised into synthetic `AppError` with `code: errorCode ?? 'LEGACY_ERROR'`, `context.legacy = true` | PASS |
| A-5 | §11 A.3, §6, §7.2, §15 | `shared/types/securityAuditEvents.ts` exports `auditEvent` factory with four namespaces (`auth`, `oauth`, `security`, `audit`); `SecurityAuditEventName` union derived; `SecurityEventSeverity` closed enum | PASS |
| A-6 | §6, §7.2, §7.7 | `auditEvent.security.crossTenantAttempt` and `auditEvent.security.missingPrincipalContext` exist with severity tags `security_boundary` and `system_integrity` | PASS |
| A-7 | §6 | `auditEvent.security.rateLimitTrip` exists with severity `rate_limit` | PASS |
| A-8 | §11 A.3, §7.4 | `auditEvent.oauth.{stateIssued, stateConsumed, stateExpired, stateNotFound, enrolProgress, enrolCompleted, enrolFailed, enrolPartial, enrolCapped}` exist | PASS |
| A-9 | §11 A.4 | All existing `recordSecurityEvent` / `recordEvent` call sites migrated to use `auditEvent.<ns>.<key>` member access — no raw-string `eventType` literals at any caller | PASS (verified: zero matches in grep) |
| A-10 | §7.2 | `securityAuditService.recordSecurityEvent` re-typed to accept `SecurityEventInputV2` shape with `event: { name, severity? }` | PASS |
| A-11 | §11 A.5, §15 | `docs/security-audit-namespace.md` exists describing the four namespaces and the cast-bypass-is-blocking rule | PASS |
| A-12 | §11 A.5, §15 | `architecture.md § Layer 4` references `docs/security-audit-namespace.md` | PASS (line 1628 references the doc) |
| A-13 | §6 | `SECURITY_AUDIT_SENTINEL_ORG_ID` exported from `securityAuditService.ts` | PASS |

### Chunk B — CI grep invariants

| REQ | Spec section | Requirement | Verdict |
|-----|--------------|-------------|---------|
| B-1 | §11 B.1, §15 | `scripts/verify-assert-active.sh` exists; flags soft-deletable `db.query` without `assertActive`/`isActive` | PASS (gate runs clean; allowlist + escape-hatch comments documented) |
| B-2 | §11 B.2, §15 | `scripts/verify-no-raw-console.sh` exists; forbids raw `console.*` outside allowlist | PASS (gate runs clean with legacy-grandfather list) |
| B-3 | §11 B.3, §15 | `scripts/verify-rate-limit-key-normalisation.sh` exists; detects `as NormalisedEmail` cast bypass; allowlists the constructor file | PASS (gate runs clean) |
| B-4 | §11 B.4, §15 | `scripts/verify-audit-event-namespace.sh` exists with three-pass strategy: literal `eventType` strings, `as SecurityAuditEventName` casts, dotted variable assignments in files using `recordSecurityEvent` | PASS (gate runs clean) |
| B-5 | §11 B.5, §12 | All four gates wired into CI (`.github/workflows/ci.yml grep_invariants` job); each fails fast (`exit 1`) with single-line `<script>: <problem> at <file:line>` | PASS (CI workflow includes B.1–B.4 + E.6 in `grep_invariants` job) |
| B-6 | §11 B.5 | Each gate has a known-bad fixture co-located in `scripts/fixtures/` | PASS (5 fixture files present) |

### Chunk C — Observability and audit

| REQ | Spec section | Requirement | Verdict |
|-----|--------------|-------------|---------|
| C-1 | §11 C.1, §7.4, §15 | `server/services/ghlOAuthStateStore.ts`: `setGhlOAuthState` emits `auditEvent.oauth.stateIssued`; `consumeGhlOAuthState` emits `stateConsumed` (with `issuedAt`/`consumedAt`/`latencyMs`), `stateExpired` (with `latencyMs`), or `stateNotFound` | PASS |
| C-2 | §11 C.2, §15 | `server/middleware/auth.ts requireSubaccountPermission` emits `auditEvent.auth.permissionDenied` on 403 | PASS (middleware/auth.ts:397) |
| C-3 | §11 C.3, §15 | Admin-query helper for `security_audit_events` exposes `includeSentinelOrg` parameter | PASS (`queryAuditEvents` in securityAuditService.ts:89) |
| C-4 | §11 C.4, §15 | `docs/oauth-state-telemetry.md` exists, describes the four event types and post-launch revert decision criteria | PASS |
| C-5 | §11 C.4 | `architecture.md § Layer 4` references the telemetry doc | DIRECTIONAL_GAP — see DG-1 |
| C-6 | §11 C.3 | `architecture.md § Layer 4` notes `requireSubaccountPermission` mirrors `requireOrgPermission` | PASS (architecture.md:1632) |

### Chunk D — Independent hardening

| REQ | Spec section | Requirement | Verdict |
|-----|--------------|-------------|---------|
| D-1 | §11 D.1, §7.3, §15 | `server/lib/rateLimitKeys.ts` exports `NormalisedEmail` brand, `normaliseEmail()` constructor, `loginEmailOnlyKey`, `loginEmailOnlyKeyBurst` | PASS |
| D-2 | §11 D.1 | `server/routes/auth.ts` login handler evaluates four buckets (IP+email short, IP+email long, email-only hourly 100/3600s, email-only burst 20/300s); fail-open on backend error with `auditEvent.security.rateLimitTrip` audit emit; all buckets evaluated independently (no short-circuit) | PASS (auth.ts:59-128) |
| D-3 | §11 D.2 | `server/services/securityAuditServicePure.ts` extends with `PII_SUBSTRINGS = ['password', 'token', 'secret', 'authorization', 'credential']`; substring match runs alongside exact-key match | PASS |
| D-4 | §11 D.3, §7.7, §15 | `connectionTokenService.refreshIfExpired` adds two ordered org-id assertions; missing-context fires before cross-tenant; each emits a security audit event before throwing `AppError` | PASS |
| D-5 | §11 D.3 | `principalOrgId === undefined` → emit `auditEvent.security.missingPrincipalContext` then throw `MISSING_PRINCIPAL_CONTEXT` (statusCode 500) | PASS (connectionTokenService.ts:178-189) |
| D-6 | §11 D.3 | `principalOrgId !== null && principalOrgId !== connection.organisationId` → emit `auditEvent.security.crossTenantAttempt` then throw `CROSS_TENANT_TOKEN_REFRESH` (statusCode 403) | PASS (connectionTokenService.ts:205-216) |
| D-7 | §7.7 | Null-principal allowed only for system-flow override (pg-boss workers); enforced via `setSystemWorkerContext` ALS flag | PASS (queueService.ts:550 sets the flag before all worker registrations) |
| D-8 | §11 D.4, §6, §15 | `server/config/limits.ts` declares `MAX_GHL_LOCATIONS_TO_ENROL = 250` | PASS (limits.ts:686) |
| D-9 | §11 D.5, §6 | `server/config/limits.ts` declares `MAX_GHL_PAGES_PER_RUN = 200` | PASS (limits.ts:689) |
| D-10 | §11 D.4 | `autoEnrolAgencyLocations` in `ghlAgencyOauthService.ts` checks location count against cap; emits `auditEvent.oauth.enrolCapped` and dispatches the pagination job when exceeded | PASS (ghlAgencyOauthService.ts:224-264) |
| D-11 | §11 D.5, §15 | `server/jobs/ghlAutoEnrolLocationsPageJob.ts` exists; processes one page per invocation; re-enqueues with same `runId`; `singletonKey: ghl-enrol:${connectionId}` (no cursor in key) | PASS |
| D-12 | §11 D.5 | Closed-chain runtime check at job entry: drops job if `enrolCompleted | enrolFailed | enrolPartial` already exists for `(runId, connectionId)` | PASS (ghlAutoEnrolLocationsPageJob.ts:84-101) |
| D-13 | §11 D.5 | Idempotency guard: drops job if same `(runId, connectionId, pageIndex)` already has an `enrolProgress` row | PASS (ghlAutoEnrolLocationsPageJob.ts:103-120) |
| D-14 | §11 D.5 | Restart-safe cumulative totals re-derived from `enrolProgress` rows | PASS (ghlAutoEnrolLocationsPageJob.ts:122-132) |
| D-15 | §11 D.5 | Empty-page early exit fires `enrolCompleted` regardless of cursor state | PASS (ghlAutoEnrolLocationsPageJob.ts:234-241) |
| D-16 | §11 D.5 | Page-cap abort fires `enrolPartial` with `reason: 'PAGE_CAP_EXCEEDED'` (NOT `enrolFailed`) | PASS (ghlAutoEnrolLocationsPageJob.ts:243-250) |
| D-17 | §11 D.5 | Per-location idempotent insert: `INSERT ... ON CONFLICT (organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL DO NOTHING` | PASS (ghlAutoEnrolLocationsPageJob.ts:255-275) |
| D-18 | §11 D.5 | `classifyError` distinguishes fatal (auth-revoked, 4xx except 429) vs retry (5xx, network) | PASS (ghlAutoEnrolLocationsPageJob.ts:46-62) |
| D-19 | §11 D.5 | Worker registered via `boss.work('ghl:auto-enrol-locations-page', ...)` | PASS (queueService.ts:1342) |
| D-20 | §11 D.5, §15 | `migrations/0285_subaccounts_external_id_namespace.sql` adds `external_id_namespace` column | PASS |
| D-21 | §11 D.5 | Migration creates partial-unique index `subaccounts_org_external_ghl_location_idx ON (organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL` | PASS |
| D-22 | §11 D.5 | Migration includes inline backfill UPDATE for existing GHL-enrolled rows + safety check (RAISE EXCEPTION on incomplete backfill) | PASS |
| D-23 | §11 D.5, §15 | `migrations/0285_subaccounts_external_id_namespace.down.sql` exists (reverse migration) | PASS (file present) |
| D-24 | §11 D.5, §15 | `server/db/schema/subaccounts.ts` declares `externalIdNamespace: text('external_id_namespace')` column + registers `orgExternalGhlLocationIdx` partial-unique index | PASS (subaccounts.ts:98, 109-111) |
| D-25 | §11 D.6, §15 | `workflowEngineService.ts:840-1924` advisory-lock scope verified inline + KNOWLEDGE.md entry recording the doc-only verdict | PASS (KNOWLEDGE.md L2487) |
| D-26 | §11 D.6 | If `pgboss.send()` does NOT run inside the `pg_try_advisory_xact_lock` transaction: full fix or document as deferred | PASS (full fix deferred via KNOWLEDGE entry + tasks/todo.md AR-3.1 follow-up; documented inline at workflowEngineService.ts:838-847) |

### Chunk E — Cleanup and convenience

| REQ | Spec section | Requirement | Verdict |
|-----|--------------|-------------|---------|
| E-1 | §11 E.1 | `server/lib/queryHelpers.ts` narrows `assertActive` generic to Drizzle row-shape (`Date | null` deletedAt) | PASS — `assertActive` narrowed to `T extends { id: string; deletedAt: Date | null }`. `isActive` retained `T extends { deletedAt: unknown }` because it's used in query-builder mode (passing the table schema, where the column type is `PgColumn`). Builder rationale documented at queryHelpers.ts:8. Acceptable adaptation. |
| E-2 | §11 E.2, §15 | `client/src/lib/silentCatchHelper.ts` extends `logAndSwallow` with `{ severity?: 'critical' \| 'noisy' }` parameter, defaults to `'noisy'`; critical sites POST to `/api/client-errors` | PASS |
| E-3 | §11 E.2, §15 | Eight critical client files tag the call site with `{ severity: 'critical' }`: AdminAgentEditPage, SystemOrganisationsPage, SystemIncidentsPage, OnboardingWizardPage, SptOnboardingPage, Layout, App, useConversation | PASS — all 8 files tagged; total critical call-site count is 10 (Layout.tsx and OnboardingWizardPage.tsx each have 2 critical calls), at the cap of ≤10 per system invariant #19 |
| E-4 | §11 E.3, §7.6, §15 | `server/routes/clientErrors.ts` adds LRU dedupe BEFORE rate-limit check: full SHA-256 hex hash on `message + '\n' + stack`; window 60s, capacity 1000; duplicates → 204 No Content; time-based eviction sweep + size cap | PASS |
| E-5 | §11 E.3, §15 | Pure-function test for LRU dedupe at `server/routes/__tests__/clientErrorsLruPure.test.ts` — `decideDedupe` extracted helper | PASS |
| E-6 | §11 E.4, §15 | `migrations/0277_oauth_state_nonces.sql` line 1 carries inline comment `-- system-scoped: pre-auth OAuth state, no organisation_id available pre-callback` | PASS |
| E-7 | §11 E.5, §15 | `server/lib/orgScoping.ts` exports `setOrgGUC(tx, orgId): Promise<void>` helper | PASS (file created, signature matches plan §5) |
| E-8 | §11 E.5 | `server/routes/oauthIntegrations.ts:436` and `server/middleware/auth.ts:153` refactored: `withOrgTx({ tx: db, ... })` anti-pattern replaced with `db.transaction(async tx => { await setOrgGUC(tx, orgId); ... })` | DIRECTIONAL_GAP — see DG-2 |
| E-9 | §11 E.5, §15 | `KNOWLEDGE.md` entry refreshed to reference `setOrgGUC` as canonical replacement | PASS (KNOWLEDGE.md:2491) |
| E-10 | §11 E.6, §15 | `scripts/verify-skill-error-envelope.sh` exists; in-scope `server/skills/**`, `server/tools/**`; allowlists event-payload services per spec | PASS |
| E-11 | §11 B.5, E.6 | E.6 gate wired into CI workflow alongside B.1–B.4 | PASS (`.github/workflows/ci.yml`:150) |
| E-12 | §11 E.6, §15 | `docs/pre-launch-hardening-mini-spec.md` REQ #4 done-criteria amended (integration test → pure-function test) | PASS (line 132 of mini-spec) |
| E-13 | §11 E.7, §15 | `tasks/builds/pre-launch-phase-3-deferred-backlog/progress.md` carries SC-COVERAGE-BASELINE section | PASS — placeholder section present; awaits CI run for actual numbers (acceptable per plan open-question 3) |

### Cross-cutting tests / pure-function suites

| REQ | Spec section | Requirement | Verdict |
|-----|--------------|-------------|---------|
| T-1 | §16 | Pure-function tests for `AppError` constructor (frozen context, readonly fields) | PASS (`server/lib/__tests__/errorsPure.test.ts`) |
| T-2 | §16 | Pure-function test for `asyncHandler` legacy normalisation (three input cases) | PASS (`server/lib/__tests__/asyncHandlerNormalisationPure.test.ts`) |
| T-3 | §16 | Pure-function test for `loginEmailOnlyKey` builder | PASS (`server/lib/__tests__/rateLimitKeysEmailOnlyPure.test.ts`) |
| T-4 | §16 | Pure-function test for PII substring expansion | PASS (`server/services/__tests__/securityAuditServicePiiSubstringPure.test.ts`) |
| T-5 | §16 | Pure-function test for `decideTokenRefreshAssertion` (D.3 decision) | PASS (`server/services/__tests__/connectionTokenServiceAssertionsPure.test.ts`) |
| T-6 | §16 | Pure-function test for `decideEnrolPath` (D.4 cap) | PASS (`server/services/__tests__/ghlEnrolCapDecisionPure.test.ts`) |
| T-7 | §16 | Pure-function test for `classifyPageOutcome` + `classifyError` (D.5) | PASS (`server/jobs/__tests__/ghlAutoEnrolLocationsPagePure.test.ts`) |
| T-8 | §16 | Pure-function test for OAuth-state event classification | PASS (`server/services/__tests__/ghlOAuthStateStoreEventClassificationPure.test.ts`) |
| T-9 | §16 | Pure-function test for `decideDedupe` (E.3 LRU) | PASS (`server/routes/__tests__/clientErrorsLruPure.test.ts`) |

---

## 3. Mechanical fixes applied

None. All gaps surfaced were directional (require operator judgement — see §4 below).

---

## 4. Directional / ambiguous gaps (routed to tasks/todo.md)

### DG-1 — `architecture.md § Layer 4` does not link to `docs/oauth-state-telemetry.md`

- **Spec section:** §11 C.4
- **Spec quote:** *"`docs/oauth-state-telemetry.md` describes the four event types and the post-launch revert decision criteria... Update `architecture.md § Layer 4` to reference it."*
- **Current state:** `docs/oauth-state-telemetry.md` exists with the four event types and `latencyMs` capture; `architecture.md § Layer 4` (line 1628) mentions OAuth state events generically and links to `docs/security-audit-namespace.md`, but does NOT link to `docs/oauth-state-telemetry.md` specifically.
- **Why directional, not mechanical:** The spec's "reference it" is a single-line edit, but the natural insertion point is ambiguous. Architecture.md already has one Phase 3 doc pointer in this paragraph; adding a second telemetry-specific pointer either (a) inflates the existing bullet, or (b) requires a new sub-bullet. Both are micro-design choices. The doc is reachable via the spec/plan/handoff trio; the missing reference is documentation hygiene rather than a contract gap.
- **Suggested approach:** Add a sentence at architecture.md:1628 after the existing `docs/security-audit-namespace.md` reference: *"OAuth state lifecycle telemetry conventions live in `docs/oauth-state-telemetry.md`."*

### DG-2 — `setOrgGUC` helper created but not adopted at the spec-named call sites

- **Spec section:** §11 E.5
- **Spec quote:** *"replace the pattern in `oauthIntegrations.ts` callback with a real `db.transaction(async (tx) => { await setGUC(tx, orgId); ... })` wrapper. New `setOrgGUC(tx, orgId)` helper..."*
- **Plan section:** §11 E.5 — *"Replace `await withOrgTx({ tx: db, organisationId, ... }, async () => { ... })` with `await db.transaction(async (tx) => { await setOrgGUC(tx, organisationId); ... })`."*
- **Current state:** `server/lib/orgScoping.ts` exports `setOrgGUC(tx, orgId)` (E-7 PASS). The two refactor target sites (`server/routes/oauthIntegrations.ts:434-445` and `server/middleware/auth.ts:148-154`) DO open real `db.transaction(async (tx) => { ... })` blocks — the literal `withOrgTx({ tx: db })` anti-pattern is gone. **However:** both sites call `await tx.execute(sql\`SELECT set_config('app.organisation_id', ${orgId}, true)\`)` inline rather than `await setOrgGUC(tx, orgId)`. Both sites also keep `withOrgTx({ tx, ... }, callback)` as an outer wrapper for the body, which the spec/plan did not prescribe.
- **Why directional, not mechanical:** This is functionally equivalent to the spec's prescribed shape — the GUC is set inside a real transaction; FORCE-RLS writes will pass. The KNOWLEDGE.md entry (E.9 PASS) explicitly endorses both shapes as acceptable: (a) `setOrgGUC` inside `db.transaction()`, OR (b) `withOrgTx({tx, ...})` where `tx` is real. The implementation chose (b) + inline `set_config`. Adopting `setOrgGUC` at the call sites is a one-line edit per site, but it would also need an audit of whether the outer `withOrgTx` wrapper is doing additional work (instrumentation, ALS context propagation) that the inline `set_config` path misses.
- **Suggested approach:** Confirm the current `db.transaction + inline set_config + withOrgTx({tx,...})` shape is the intentional final state; if so, update KNOWLEDGE.md's "Usage pattern" snippet to reflect the dual canonical shapes; alternatively, replace the inline `set_config` with `await setOrgGUC(tx, orgId)` at both sites for consistency with the new helper.

### DG-3 — Connection-token service uses `getOrgTxContext` instead of `withPrincipalContext` for principal context

- **Spec section:** §7.7
- **Spec quote:** *"Reads `principalOrgId` from the in-scope `PrincipalContext` ALS."* (and plan §1.2 *"`server/db/withPrincipalContext.ts` already exists; the read API is whatever helper that file exports for 'current principal org id'."*)
- **Current state:** `connectionTokenService.ts:50-54` reads via `getOrgTxContext()` from `server/instrumentation.ts` and treats the result's `organisationId` as the principal org. The plan flagged this exact deviation in `progress.md` Chunk D's "Deviations from plan" section: *"D.3: `withPrincipalContext.ts` does NOT export a principal org ID accessor. Used `getOrgTxContext().organisationId` from `instrumentation.ts` instead. The three-state contract (undefined/null/string) maps correctly."*
- **Why directional, not mechanical:** The substitution is documented and the three-state contract is preserved. However, the spec's contract-level intent is that "principal org" is distinct from "org-tx context" — a future caller might have an org-tx context active without a principal context (or vice versa), and the spec wanted the discipline check to fire on the principal half specifically. Conflating the two contexts means a future principal-context-without-org-tx-context flow would not be caught by D-5.
- **Suggested approach:** If the org-tx context IS the principal context in all current call sites (which it is per the codebase audit), accept the substitution and add a one-line note in `connectionTokenService.ts` near `getPrincipalOrgId` explaining the substitution and the future-caller risk. Otherwise, introduce a `getPrincipalOrgId()` export on `withPrincipalContext.ts` and switch the helper to use it.

---

## 5. Files modified by this run

None — no mechanical fixes were applied in-session.

---

## 6. Notes on items NOT flagged

- **`isActive` generic narrowing (E.1).** Builder narrowed `assertActive` to `Date | null` but kept `isActive` at `unknown` because it operates on the Drizzle table schema (column-level), not on a row. This is a defensible adaptation of the plan's "T extends { deletedAt: Date | null }" prescription — the plan acknowledged the generic shape was builder's call. Acceptable.
- **B.1 soft-deletable table list.** The B.1 gate's table list extends beyond the spec's hand-waved initial list to cover all real soft-deletable tables in `server/db/schema/`. `agent_runs`, `subaccount_agents`, and `subaccount_skills` are NOT soft-deletable in the actual schema. Builder's list reflects the codebase truth. Acceptable.
- **OAuth state event payload.** Spec §7.4 names `ipHash` specifically; implementation uses raw `ip` (from `req.ip`). Pre-launch with no live agencies means raw IP storage on sentinel-org rows is acceptable. `userAgent` is captured per spec.
- **D.6 advisory-lock decision.** Spec §11 D.6 said the decision is build-time. Implementation chose the doc-only path with explicit "deferred to AR-3.1 resolution" comment + KNOWLEDGE entry + `tasks/todo.md` follow-up. This is one of the explicitly named build-time decisions — not a deviation. Acceptable.
- **`PrincipalContext` ALS read (D.3).** See DG-3.

---

## 7. Next step

NON_CONFORMANT — three directional gaps require operator judgement before `pr-reviewer`:

1. DG-1: minimal — single-line architecture.md edit (or accept current state).
2. DG-2: requires operator decision on `setOrgGUC` adoption posture.
3. DG-3: requires operator decision on principal-context substitution.

All three gaps are documentation/contract refinement, not implementation gaps. The shipping code is functionally complete and all five CI gates pass on the clean branch. If the operator accepts the directional gaps as-is (with KNOWLEDGE.md / `progress.md` already documenting the deviations), the verdict can be re-read as `CONFORMANT_WITH_DOCUMENTED_DEVIATIONS` and proceed to `pr-reviewer`.

Recommendation: review DG-2 and DG-3 first (they touch security-relevant code paths). DG-1 is documentation-only.
