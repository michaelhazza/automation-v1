# Handoff — pre-launch-phase-3-deferred-backlog

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** `tasks/builds/pre-launch-phase-3-deferred-backlog/spec.md`
**Branch:** `claude/pre-launch-phase-3` (forked from `main` at `a7ad66fc`)
**Build slug:** `pre-launch-phase-3-deferred-backlog`
**UI-touching:** no
**Mockup paths:** n/a
**Spec-reviewer iterations used:** 3 / 5 (READY_FOR_BUILD; 2 rounds remain available if a major edit triggers re-review)
**ChatGPT spec review log:** `tasks/review-logs/chatgpt-spec-review-pre-launch-phase-3-deferred-backlog-2026-05-05T10-50-30Z.md` (5 rounds, APPROVED FINAL)
**Spec-reviewer log:** `tasks/review-logs/spec-reviewer-log-pre-launch-phase-3-deferred-backlog-2026-05-05T10-41-20Z.md`

---

## Table of contents

1. Build charter
2. Chunk plan
3. Schema change scope
4. Decisions made in Phase 1 — architecture / framing
5. Source-of-finding traceability
6. Spec-reviewer (Codex) autonomous decisions
7. chatgpt-spec-review summary (5 rounds)
8. Open questions for Phase 2
9. Deferred items (routed to `tasks/todo.md`)
10. Doc-sync footprint pre-flagged for Phase 3 build
11. Next-session entry pointer

---

(sections appended below)

---

## 1. Build charter (one-line)

Close the 24-item deferred backlog accumulated across Pre-Launch Phases 1 (PR #261) and 2 (PR #264) — final pre-launch hardening pass before UAT / first-agency onboarding. Hardening only; no new product features.

## 2. Chunk plan (5 chunks, dependency-ordered)

The spec's §11 chunk plan is the canonical decomposition. Summary for `feature-coordinator`:

- **Chunk A — Canonical types (foundation).** `shared/errorCodes.ts` registry, `server/lib/errors.ts` (`AppError` class with `readonly` + `Object.freeze` immutability), `shared/types/securityAuditEvents.ts` (`auditEvent` factory + derived `SecurityAuditEventName` union + `SecurityEventSeverity` closed enum), call-site rename pass (~30 sites), `docs/security-audit-namespace.md` convention doc. asyncHandler normalises legacy duck-shape errors into synthetic `AppError`.
- **Chunk B — CI grep invariants (depends on A).** `verify-assert-active.sh`, `verify-no-raw-console.sh`, `verify-rate-limit-key-normalisation.sh` (cast-bypass detection only — type system is canonical), `verify-audit-event-namespace.sh`. Each gate ships with a known-bad fixture proven to trip it. Gate failure posture meta-rule: fail-fast `exit 1` + single-line actionable error `<script>: <problem> at <file:line>`.
- **Chunk C — Observability and audit (depends on A).** OAuth state lifecycle telemetry (4 events: `stateIssued`/`stateConsumed`/`stateExpired`/`stateNotFound` — `stateConsumed`/`stateExpired` carry `issuedAt`/`consumedAt`/`latencyMs` for the §13 deferred TTL revert decision). `requireSubaccountPermission` emits `auditEvent.auth.permissionDenied`. Sentinel-org admin-query helper. `docs/oauth-state-telemetry.md`.
- **Chunk D — Independent hardening.** Email-only login RL bucket (`100/3600s`, branded `NormalisedEmail` constructor-only, fail-open with `BACKEND_UNAVAILABLE` audit event), PII substring blacklist extension, `connectionTokenService.refreshIfExpired` two ordered assertions (`MISSING_PRINCIPAL_CONTEXT` for `=== undefined`, `CROSS_TENANT_TOKEN_REFRESH` for cross-tenant) — each emits `auditEvent.security.*` BEFORE throwing. GHL enrol cap (`MAX_GHL_LOCATIONS_TO_ENROL = 250`). GHL pagination job (`MAX_GHL_PAGES_PER_RUN = 200`, single-writer per connection, runId chain identity, opaque cursor, ON CONFLICT idempotency on partial-unique index). Advisory-lock scope verification.
- **Chunk E — Cleanup and convenience.** `isActive`/`assertActive` generic narrowing, `logAndSwallow` severity tagging (≤10 critical sites enumerated), client-errors LRU dedupe with full SHA-256 (256 bits, in-memory, process-bound, best-effort), migration `0277` header comment, `withOrgTx({tx:db})` refactor + `setOrgGUC` helper, REQ #15 skill-envelope CI gate, REQ #29 SC-COVERAGE-BASELINE capture.

Dependency order: A → B (gates reference A's types), A → C (events use A's namespace), D and E independent of A/B/C.

## 3. Schema change scope (intentionally minimal)

- **One new column:** `subaccounts.external_id_namespace text` (nullable, default null) — required by D.5 partial-unique index.
- **One new partial-unique index:** `subaccounts_org_external_ghl_location_idx ON (organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL`.
- **One inline backfill UPDATE** in the same migration sets `external_id_namespace = 'ghl_location'` for existing GHL-enrolled rows. No data risk pre-launch — no live agencies.
- **One in-file comment edit** on `migrations/0277_oauth_state_nonces.sql` (no version bump).

Migration number is build-time decision (next sequential after current head). No new tables. No RLS policy changes — `subaccounts` already in manifest.

## 4. Decisions made in Phase 1 — architecture / framing

- **Single canonical typed-error class.** `AppError` is the sole new error primitive. Existing duck-typed `{statusCode, message, errorCode}` throws are normalised by `asyncHandler` into synthetic `AppError` shapes — Phase 3 does NOT backfill existing throw sites (Phase 4 sweep). Unifies downstream wire shape with zero behaviour change.
- **Audit-event factory IS the union.** `shared/types/securityAuditEvents.ts` exports a const-object factory `auditEvent` with four namespaces (`auth`, `oauth`, `security`, `audit`). The `SecurityAuditEventName` union is derived via `typeof` — there is no separate raw-string source. Producers use member access; raw strings AND `as SecurityAuditEventName` casts both fail B.4 grep gate.
- **Severity bound at factory entry, never call-site.** `SecurityEventSeverity` is a closed enum `'system_integrity' | 'security_boundary' | 'rate_limit' | 'configuration'`. Each `auditEvent.security.*` event ships with its severity declared at factory registration; `recordSecurityEvent` reads severity from the factory entry. Call-site overrides fail at the type level.
- **`NormalisedEmail` branded type as canonical RL key constructor.** Compile-time guarantee replaces fragile data-flow grep tracing. Single constructor: `normaliseEmail(input: string): NormalisedEmail`. B.3 grep gate scoped to `as NormalisedEmail` cast-bypass detection only.
- **GHL pagination concurrency: single-writer per connection.** pg-boss `singletonKey: ghl-enrol:${connectionId}` (NOT cursor-suffixed). Cursor lives in job payload `{ connectionId, runId, pageCursor, pageIndex }`. Eliminates the duplicate-progress-event class.
- **`runId` chain identity (monotonic + globally unique).** Every job in a chain shares the same `runId`; re-enqueue copies it verbatim. Fresh chain (re-trigger / post-partial / post-failed / initial dispatch) mints `crypto.randomUUID()`. Globally unique across all `connectionId`s. Crash recovery preserves the SAME `runId`.
- **Three-state event taxonomy: terminal vs non-terminal checkpoint.** Terminals are `enrolCompleted` (success) and `enrolFailed` (unrecoverable error — auth-token revoked, GHL 5xx beyond `withBackoff`, schema constraint violations not absorbed by ON CONFLICT). `enrolPartial` is **non-terminal** — chain ends at safe boundary; resume requires fresh chain with new `runId`. Page-cap exceeded → `enrolPartial + reason='PAGE_CAP_EXCEEDED'` (safety abort, NOT failure).
- **Post-terminal silence invariant.** Once `enrolCompleted` / `enrolFailed` / `enrolPartial` fires for `(connectionId, runId)`, NO further events of any type may be emitted for that chain. Late retries dropped at handler — runtime check, not just doc rule.
- **Cursor trust boundary.** `pageCursor` is opaque from upstream GHL API; MUST NOT be validated/parsed/interpreted. Safety nets (empty-page early exit + page-cap abort) handle invalid/stale/looping cursors. Future "validate the cursor" attempts are blocking findings.
- **Per-location idempotency on partial-unique index.** `INSERT ... ON CONFLICT (organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL DO NOTHING`. Soft-delete interaction intentional: tombstoned rows do NOT block re-insertion (soft-delete is operator-view tombstone, not uniqueness reservation).
- **Empty-page early exit.** Page returns 0 locations → `enrolCompleted` regardless of cursor state. Fires before page-cap check. Handles upstream-API-bug class (valid-looking cursor that never advances). No reconciliation against agency documented totals — explicit non-assumption; future reconciliation is separate spec.
- **Connection-token assertions emit-then-throw.** Both `MISSING_PRINCIPAL_CONTEXT` (statusCode 500) and `CROSS_TENANT_TOKEN_REFRESH` (statusCode 403) fire `recordSecurityEvent` BEFORE throwing — security-boundary failures observable in `security_audit_events` independent of error-log routing. `principalOrgId === undefined` is system-integrity failure (ALS context absent); `principalOrgId !== null && !== connection.organisationId` is security-boundary violation. `null` is the explicit system-flow sentinel.
- **AppError immutability post-construction.** All four fields (`code`, `statusCode`, `message`, `context`) declared `readonly`; constructor freezes `context` via `Object.freeze`. Mutation attempts are blocking PR findings — guarantees logs reflect throw-site intent.
- **Audit log immutability (append-only, absolutely).** Rows in `security_audit_events` MUST NEVER be UPDATEd or DELETEd. Corrections insert NEW event with `context.supersedes = '<original_event_id>'`. Retention/archival sweeps are a separate post-launch spec — Phase 3 introduces no deletion path.
- **Rate-limit fail-open posture.** Both `ip:email` and `email`-only buckets fail OPEN if storage backend errors — auth-availability over abuse-resistance during incidents. Fail-open path emits `auditEvent.security.rateLimitTrip` with `context.severity = 'configuration'` and `context.reason = 'BACKEND_UNAVAILABLE'`. Future fail-closed change is a blocking finding.
- **Audit causality posture (observational, not causal).** `ORDER BY created_at DESC, id DESC` is display ordering only. Consumers requiring causal ordering MUST use chain identifiers (`runId`, `connectionId`, transactional locks) carried in event `context`, NOT timestamps.
- **CI gate failure posture meta-rule.** Every gate fails fast (`exit 1`) on first violation with single-line actionable error `<script>: <problem> at <file:line>`. No multi-page diffs; no warnings tier. Phase 3 codifies for new gates; pre-existing scripts updated only when touched by a Phase 3 chunk file.
- **LRU dedupe persistence posture.** Process-local, resets on restart, best-effort only. Cross-restart / cross-process duplicates not suppressed. Full SHA-256 (256 bits) — eliminates 64-bit-prefix collision class.
- **`logAndSwallow` critical-tier cap ≤10.** Pre-launch only auth-flow + onboarding-flow paths tagged critical (8 enumerated; build-time review may add ≤2). Critical sites POST to `/api/client-errors`; noisy sites `console.debug` only.
- **No backfill of canonical error taxonomy in Phase 3.** Phase 4 sweep — co-located in §13 deferral with the Phase 4 "no raw DB writes outside transaction helpers" gate (both items "tighten the write surface").

## 5. Source-of-finding traceability

24 source items closed across 5 chunks (A-E) + 4 explicit verdicts. Spec §Appendix A enumerates the per-chunk source mapping. Sources: chatgpt-pr-review R1/R2/R3 (10 items), adversarial-reviewer Phase 2 (6 items), spec-conformance Phase 2 deviations (3 items), adversarial-reviewer Phase 1 residue (4 items), chatgpt-pr-review Phase 1 round 2 deferral (1 item).

## 6. Spec-reviewer (Codex) autonomous decisions

3 mechanical findings auto-applied across iterations 1-2:

- **B.3 grep gate brittleness** (iter 1) — gate spec rejected normalised-variable patterns at call site; rewritten to allow pre-normalised variables, with type-system as canonical enforcement.
- **D.5 GHL pagination idempotency** (iter 1) — `WHERE NOT EXISTS subaccount.ghl_location_id = page_cursor` was using pagination token in place of location id; re-keyed on each page item's location id.
- **D.5 ON CONFLICT predicate mismatch** (iter 2) — Postgres requires conflict target's WHERE clause to match index predicate exactly; added `AND deleted_at IS NULL` to ON CONFLICT predicate.

Iteration 3 was CLEAN on commit-scoped review. Full-branch review surfaced one ambiguous operational-tooling finding (Mission Control parser ignoring parallel block) — autonomously routed to `tasks/todo.md` as a deferred operational item; outside spec scope and explicitly authorised by parallel-session operating mode.

**0 directional findings** across all three iterations. Spec stayed inside framing assumptions throughout.

## 7. chatgpt-spec-review summary (5 rounds)

33 technical findings auto-applied across rounds 1-4. 1 auto-rejected (`AppError` `version: 1` field — YAGNI, pre-launch posture). 2 escalated-to-defer per agent recommendation, both confirmed by operator with "as recommended":

- **F6 (round 1) — Phase 4 CI gate "no raw DB writes outside transaction helpers."** Valid invariant but outside Phase 3's chartered backlog. Co-located in §13 with R3-2 backfill (both items tighten write surface).
- **F11 (round 4) — failure playbook (operational runbooks).** Pre-launch runbooks tend to be wrong; defer until first-agency monitoring + on-call rotation provide real signal. Lives at `docs/runbooks/*.md` post-launch, separate from spec.

Round 5 was zero-findings final-validation. Final ChatGPT verdict: **APPROVED — FINAL**. 0 blockers, 0 risky ambiguities, 0 missing mechanisms.

Highest-leverage Phase 1 changes were structural-enforcement upgrades from "convention + grep" to "type system + factory + readonly + closed enum":

- AppError normalisation in asyncHandler (round 1 F1) — single downstream wire shape.
- `auditEvent` factory replacing raw-string event names (round 1 F5) — eliminates `as SecurityAuditEventName` cast bypass.
- GHL pagination single-writer per connection (round 1 F2) — kills duplicate-progress-event race.
- `NormalisedEmail` branded type as the only RL key constructor (round 1 F3) — compile-time guarantee.
- OAuth state `latencyMs` capture (round 1 F4) — direct enabler of post-launch TTL revert decision.
- `enrolPartial` reclassified as non-terminal checkpoint (round 2 F1+F2) — fixed contract gap where "exactly one terminal" invariant was provably false.
- LRU dedupe full SHA-256 (round 2 F3) — eliminates 64-bit collision class.
- runId monotonicity + globally-unique invariants (rounds 2 + 4) — chain identity locked.
- Audit-event immutability (round 4 F4) — append-only with supersedes-event correction pattern.
- AppError post-construction immutability (round 4 F8) — `readonly` + `Object.freeze`.
- Severity bound at factory declaration, immutable at call site (round 4 F7).

## 8. Open questions for Phase 2

These are resolved at build time by the `architect` sub-agent or escalated by `builder`:

1. **AppError code-enum scope.** Initial seed-set: which existing error codes are migrated into the typed union vs left as raw strings? Architect to enumerate from `git grep "errorCode:" server/`.
2. **D.6 advisory-lock decision.** Read of `workflowEngineService.ts:840-1924` will resolve whether `pgboss.send()` runs inside the same transaction as `pg_try_advisory_xact_lock`. If yes, doc-only; if no, wrap the send. Build-time decision.
3. **REQ #29 baseline numbers.** Captured from CI on first push to `claude/pre-launch-phase-3`. Requires CI to run, then operator update of `progress.md`.
4. **`logAndSwallow` critical sites — final list.** Spec §11 E.2 enumerates 8 critical sites; build-time review of remaining 11 may upgrade ≤2 more to critical. Cap at ≤10 stays.

## 9. Deferred items (routed to `tasks/todo.md`)

- **OAuth state TTL revert decision (R1-7).** Phase 3 emits the four `auditEvent.oauth.state*` events with success-side `latencyMs`. Decision waits on post-launch telemetry — minimum 2 weeks of staging traffic with mobile/desktop + IdP-type segment breakdown.
- **Invalidation-guards double-read profiling (R2-6).** Phase 3 ships no work. Re-evaluate after first production traffic spike OR pre-launch load-testing run.
- **Agent-triggered GHL OAuth resume wiring** (Phase-1 residue). Infrastructure exists (`pendingRunId` column + `enqueueResumeAfterOAuth`); wired when the consumer feature is built. Not Phase 4 either.
- **Canonical error taxonomy backfill (R3-2 Phase 4).** AppError class + `shared/errorCodes.ts` registry ship in Phase 3; existing throw sites NOT retrofitted.
- **REQ #4 integration tests.** Permanently DEFER (WONT-DO via mini-spec amendment) — pure-function tests are canonical per `feedback_unit-tests-mid-build`.
- **AR-3.1 advisory-lock scope.** Build-time decision in Chunk D.6 — doc-only OR code change, depending on read of `workflowEngineService.ts`.
- **CI gate: "no raw DB writes outside transaction helpers" (Phase 4 candidate).** Outside Phase 3's chartered backlog; co-located with R3-2 backfill.
- **OAuth-enrol + connection-token failure runbooks (post-launch).** `docs/runbooks/*.md`, defer until first-agency monitoring + on-call rotation provide real signal.
- **Mission Control dashboard parallel-block parsing** (operational tooling). Outside spec scope; auto-routed to `tasks/todo.md` by spec-reviewer iteration 3.

## 10. Doc-sync footprint pre-flagged for Phase 3 build

- `architecture.md § Layer 4` — namespace + telemetry references (Chunk A.5, C.4).
- `DEVELOPMENT_GUIDELINES § 8` — DESC-DESC audit ordering invariant pointer.
- `KNOWLEDGE.md` — refresh `withOrgTx({tx:db})` gotcha entry pointing at the now-canonical `setOrgGUC` helper (Chunk E.5). 6 KNOWLEDGE entries already added during spec review (factory const-object, branded-type single-constructor, pg-boss singleton+cursor-in-payload, three-state job chain, audit causality posture, terminal zero-findings round).
- `docs/spec-context.md` — `last_reviewed_at` already bumped to 2026-05-05 during spec review. `accepted_primitives` will be extended by `feature-coordinator` doc-sync when the build commits.
- `docs/pre-launch-hardening-mini-spec.md` — REQ #4 done-criteria text amendment (Chunk E.6 verdict).
- `docs/security-audit-namespace.md` (NEW) and `docs/oauth-state-telemetry.md` (NEW) — created in Chunks A.5 / C.4.

## 11. Next-session entry pointer

Open a new Claude Code session and type `launch feature coordinator`. Phase 2 entry reads this handoff first; the spec at `tasks/builds/pre-launch-phase-3-deferred-backlog/spec.md` is the canonical source of truth for the build.

**Phase status:** PHASE_2_PAUSED_AWAITING_OPERATOR — Phase 2 entry: slug rename complete (`pre-launch-phase-3` → `pre-launch-phase-3-deferred-backlog`, commit `0d000cb3`), S1 sync complete (merge commit `661e6009`, post-merge typecheck clean, pushed). Architect invocation BLOCKED — feature-coordinator sub-agent invocation requires Task/Agent tool which is unavailable in this Claude Code web session. Operator decision required: run architect playbook inline OR defer plan-phase to a Claude Code CLI session.
