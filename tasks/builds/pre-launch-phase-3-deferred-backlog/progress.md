# Build Progress — pre-launch-phase-3-deferred-backlog

**Build slug:** `pre-launch-phase-3-deferred-backlog`
**Branch:** `claude/pre-launch-phase-3`
**Spec:** `tasks/builds/pre-launch-phase-3-deferred-backlog/spec.md` (locked + approved)
**Handoff:** `tasks/builds/pre-launch-phase-3-deferred-backlog/handoff.md` (written)

## Phase 1 — SPEC

| Step | Status | Notes |
|------|--------|-------|
| 0. Context load + PLANNING lock | DONE | `tasks/current-focus.md` parallel block added (alongside baseline-capture REVIEWING) |
| 2. Branch-sync S0 + freshness | DONE | Branched from main HEAD `a7ad66fc`; 0 commits behind |
| 3. Brief intake + UI-touch detect | DONE | UI-touch = no (hardening / observability / CI invariants); mockup loop skipped |
| 4. Build slug derivation + dir | DONE | `pre-launch-phase-3-deferred-backlog` directory created (renamed from `pre-launch-phase-3` 2026-05-05 to resolve S1 collision with main's parallel `pre-launch-phase-3` spec — see Phase 2 entry below) |
| 5. Mockup loop | SKIPPED | No UI surface |
| 6. Spec authoring | DONE | 498 lines; 24 source items closed across 5 chunks (A-E) + 4 explicit verdicts |
| 7. spec-reviewer (Codex) | DONE | 3/5 iterations used; READY_FOR_BUILD; 3 mechanical findings auto-applied (B.3 gate, D.5 idempotency, D.5 ON CONFLICT predicate); 0 directional; 1 ambiguous routed to todo.md (Mission Control parser — outside spec scope) |
| 8. chatgpt-spec-review (manual) | DONE | 5 rounds; APPROVED FINAL (commit `35179a4f`); 33 technical findings auto-applied; 1 auto-rejected (`AppError version: 1` YAGNI); 2 escalated-to-defer (Phase 4 raw-DB-writes gate; post-launch failure playbook); 6 KNOWLEDGE entries added |
| 9. Handoff write | DONE 2026-05-05 | `tasks/builds/pre-launch-phase-3-deferred-backlog/handoff.md` written via chunked workflow (long-doc-guard); decisions log + deferrals + open questions captured |
| 10. current-focus → BUILDING | DONE 2026-05-05 | parallel mission-control block flipped PLANNING → BUILDING; prose body kept in sync per the prose-canonical rule |

## Source items (Phase 3 backlog)

Three Phase 2 deferral streams + spec-deviations + adversarial residue:

- chatgpt-pr-review Round 1 (4): R1-4, R1-6, R1-7, R1-8
- chatgpt-pr-review Round 2 (3): R2-2, R2-3, R2-6
- chatgpt-pr-review Round 3 (3): R3-1, R3-2, R3-6
- adversarial-reviewer Phase 2 (6): AR-3.1, AR-5.1, AR-1.1, AR-2.2, AR-4.1, AR-6.1
- spec-conformance Phase 2 deviations (3): REQ #4, REQ #15, REQ #29
- adversarial-reviewer Phase 1 residue (4): migration header, signup-RL email-bucket, GHL enrol cap, withOrgTx pattern refactor
- chatgpt-pr-review Phase 1 round 2 deferral (1): agent-triggered GHL OAuth resume wiring

Total = 24 items.

## Decisions made in Phase 1

Canonical record lives in `tasks/builds/pre-launch-phase-3-deferred-backlog/handoff.md § 4` (Decisions made in Phase 1 — architecture / framing). Highlights:

- Single canonical typed-error class (`AppError` with `readonly` + `Object.freeze` immutability); legacy throws normalised in `asyncHandler` — no Phase 3 backfill.
- Audit-event factory IS the union — `auditEvent` const-object factory with `typeof`-derived `SecurityAuditEventName`; no raw-string source; cast-bypass blocked by B.4 grep gate.
- Severity bound at factory entry (closed enum, not call-site).
- `NormalisedEmail` branded type as canonical RL key constructor; B.3 grep gate scoped to cast-bypass detection only.
- GHL pagination: single-writer per connection (`singletonKey: ghl-enrol:${connectionId}`, cursor in payload).
- `runId` chain identity — monotonic within a chain, globally unique across chains, `crypto.randomUUID()` only.
- Three-state event taxonomy: `enrolCompleted`/`enrolFailed` terminal, `enrolPartial` non-terminal checkpoint (page-cap = safety abort, not failure).
- Post-terminal silence invariant — no events of any kind after a chain closes; runtime check at handler.
- Cursor trust boundary — `pageCursor` opaque; safety nets (empty-page early exit + page-cap abort) handle invalid/stale/looping cursors.
- Per-location idempotency on partial-unique index `(organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL`.
- Soft-delete interaction — tombstoned rows free `(org, external_id)` for re-insert (intentional; future hard-lock is a separate spec).
- Connection-token assertions emit-then-throw — security-boundary failures observable in `security_audit_events` independent of error-log routing.
- AppError post-construction immutability + audit log append-only (corrections via `context.supersedes`).
- Rate-limit fail-open posture — auth-availability over abuse-resistance during incidents; emits `BACKEND_UNAVAILABLE` audit event.
- CI gate failure posture meta-rule — fail-fast `exit 1` + single-line actionable error.
- LRU dedupe full SHA-256 (256 bits), process-bound + best-effort.

Operator-confirmed deferrals: Phase 4 raw-DB-writes gate (co-located with R3-2 backfill); post-launch OAuth-enrol + connection-token failure runbooks (waits on first-agency monitoring).

## Phase 2 — BUILD

| Step | Status | Notes |
|------|--------|-------|
| 0. Context load + Phase 2 entry | DONE 2026-05-05 | feature-coordinator resumed after S1 collision detected on prior session — slug `pre-launch-phase-3` collided with origin/main `dd08e9a9` parallel spec |
| 1. Slug rename to resolve S1 collision | DONE 2026-05-05 | Operator approved Recommendation 1: build slug renamed `pre-launch-phase-3` → `pre-launch-phase-3-deferred-backlog`. Branch name `claude/pre-launch-phase-3` unchanged. `git mv` for build dir + 6 review-log files; internal slug references updated in spec.md / handoff.md / progress.md / 2 review log .md files / KNOWLEDGE.md (6 entries) / tasks/todo.md (3 sites) / tasks/current-focus.md (parallel block + prose body) / _index.jsonl (36 file: refs). Codex raw txt captures left as-is (immutable historical terminal output). After rename, main's `tasks/builds/pre-launch-phase-3/` (narrower 7-item spec by `dd08e9a9`) coexists alongside our `tasks/builds/pre-launch-phase-3-deferred-backlog/`. |
| 2. Branch-sync S1 + freshness check | DONE 2026-05-05 | Merged `dd08e9a9` (main's parallel pre-launch-phase-3 spec) into branch as merge commit `661e6009`. No file overlaps post-rename. No migration collisions. Post-merge `npm run typecheck` clean. Pushed. Both `tasks/builds/pre-launch-phase-3/` (main's narrower spec) and `tasks/builds/pre-launch-phase-3-deferred-backlog/` (ours) coexist. |
| 2b. Branch-sync S1 freshness (resume) | NOTED 2026-05-06 | Re-fetched origin/main. Two new main commits since last S1: `56577989` (spec-reviewer iter 2 — narrow `pre-launch-phase-3` spec) and `a9852133` (spec-reviewer final report). Both touch ONLY `tasks/builds/pre-launch-phase-3/spec.md` and `tasks/review-logs/*pre-launch-phase-3*` — files outside our build's scope (we build from `pre-launch-phase-3-deferred-backlog/`). Merge attempted; surfaced conflict on the narrow spec from divergent edits (our branch did chatgpt-spec-review rounds 1+2 on it; main did spec-reviewer iter 2). Aborted merge — narrow-spec divergence is owned by main's effort, not ours; resolving here would bias their work. Migration collision detection ran clean. Code-file overlap with main: NONE (only `KNOWLEDGE.md` differs, additive entries from our spec review). Proceeding with architect invocation against current branch HEAD `aebf5384`. |
| 3. architect invocation | DONE 2026-05-06 | Architect playbook executed inline (Task/Agent sub-agent tool unavailable in this session). Plan written to `tasks/builds/pre-launch-phase-3-deferred-backlog/plan.md` — 1021 lines / ~86kB. Sections: architecture notes (1), model-collapse check (2 — rejected, hardening is not an ingest→render pipeline), primitives-reuse confirmation (3), file inventory cross-reference (4 — three corrections recorded vs spec: `limits.ts` vs `systemLimits.ts`, `server/lib/orgScoping.ts` vs `server/middleware/orgScoping.ts`, migration `0285`), contracts (5 — TS-level signatures for `AppError`, `auditEvent` factory, `NormalisedEmail`, GHL job payload, D.3 assertions), chunk decomposition (6 — A→B, A→C, A→D.3+D.5; D and E independent of A elsewhere), per-chunk detail (7 — 4-7 file modifications per chunk + acceptance criteria), risks (8 — 9 named risks with mitigations), system invariants (9 — 20 invariants), self-consistency (10), executor notes (11). |
| 4. chatgpt-plan-review (MANUAL) | DONE 2026-05-06 | 3 rounds; APPROVED. Round 1: 10 findings (6 high-impact + 4 minor) — all applied (D.5 idempotency, D.5 restart-safe totals, D.3 isSystemContext guard, B.1 gate precision, E.3 time-based LRU eviction, D.5 classifyError, A.2 stack capture, B.4 indirect string pass, D.1 all-buckets-independent, E.5 orgId assert). Round 2: 6 polish notes — all applied (D.5 partial-index hint, D.5 totals scaling note, D.3 sync-by-design comment, B.4 dynamic-string scope, E.3 concurrency note, migration 0285 backfill safety check). Round 3: CLEAN — no findings; final sign-off. Plan LOCKED. See review log `tasks/review-logs/chatgpt-plan-review-pre-launch-phase-3-deferred-backlog-2026-05-05T21-45-44Z.md`. |
| 5. plan-gate | DONE | Operator approved plan 2026-05-06 before chunk loop |
| 6. Per-chunk loop (A → B → C → D → E) | DONE 2026-05-06 | All 5 chunks built — see chunk sections below |
| 7. G2 integrated-state static-check gate | DONE 2026-05-06 | `npm run lint` exit 0 (0 errors, 872 warnings pre-existing); `npm run typecheck` exit 0 |
| 8. Branch-level review pass | DONE 2026-05-06 | spec-conformance NON_CONFORMANT → CONFORMANT_AFTER_FIXES (DG-1/DG-2/DG-3 deferred to todo.md); adversarial-reviewer ADVISORY — 2 confirmed holes closed (F-1 = RLS bypass → B-1 fix; F-2 = OAuth audit events → B-4 fix), 2 advisory deferred (A-1 in-memory queue / S-4, A-2 = B-2); pr-reviewer CHANGES_REQUESTED → 4 blocking fixed + 2 strong deferred (S-1, S-4). Re-check: APPROVED. dual-reviewer SKIPPED (Codex CLI unavailable — REVIEW_GAP). |
| 9. Doc-sync gate | DONE 2026-05-06 | KNOWLEDGE.md: yes (2 new entries — external_id_namespace bypass gotcha, migration safety-check scoping rule). architecture.md: no — checked setOrgGUC, orgScoping, external_id_namespace, setSystemWorkerContext; zero stale references. capabilities.md: n/a. integration-reference.md: n/a. CLAUDE.md / DEVELOPMENT_GUIDELINES.md: n/a — no rule changes. frontend-design-principles.md: n/a. |
| 10. Handoff (Phase 2 section) | DONE 2026-05-06 | This section is the handoff. Phase 3: open new session and type `launch finalisation`. |
| 11. current-focus → REVIEWING | DONE 2026-05-06 | Parallel block updated to REVIEWING in tasks/current-focus.md |

## Chunk A — Canonical types (foundation) — DONE 2026-05-06

### Files created
- `shared/errorCodes.ts` — `APP_ERROR_CODES` const array + `AppErrorCode` union (A.1)
- `server/lib/errors.ts` — `AppError` class + kept `OptimisticLockError` (A.2)
- `server/lib/asyncHandlerNormalisationPure.ts` — extracted pure normalisation helper (`normaliseRouteError`) for testability
- `shared/types/securityAuditEvents.ts` — `auditEvent` factory (all namespaces), `SecurityAuditEventName` union, `SecurityEventSeverity` enum (A.3)
- `docs/security-audit-namespace.md` — convention doc (A.5)
- `server/lib/__tests__/errorsPure.test.ts` — AppError constructor pure tests (5 assertions, all pass)
- `server/lib/__tests__/asyncHandlerNormalisationPure.test.ts` — normaliseRouteError pure tests (6 assertions, all pass)

### Files modified
- `server/lib/asyncHandler.ts` — imports `normaliseRouteError`; full normalisation logic (AppError → legacy AppError → unknown 500)
- `server/services/securityAuditServicePure.ts` — added `SecurityEventInputV2`, `NormalisedSecurityEvent`, `normaliseSecurityEventV2`; legacy `normaliseSecurityEvent` retained for existing vitest
- `server/services/securityAuditService.ts` — `recordSecurityEvent` re-typed to accept `SecurityEventInputV2`; removed legacy V1 overload at write path
- `server/routes/auth.ts` — all 4 `recordSecurityEvent` calls migrated to factory member access (A.4)
- `server/middleware/auth.ts` — all 3 `recordSecurityEvent` calls migrated (A.4)
- `architecture.md` § Layer 4 — one-line pointer to `docs/security-audit-namespace.md` (A.5)

### Verification results
- `npm run lint` — 0 errors (869 warnings, pre-existing)
- `npm run typecheck` — clean exit
- `npx tsx server/lib/__tests__/errorsPure.test.ts` — 5/5 PASS
- `npx tsx server/lib/__tests__/asyncHandlerNormalisationPure.test.ts` — 6/6 PASS
- No raw-string `eventType:` literals remain at call sites: `git grep "'auth\.\|'oauth\.\|'security\." server/services/securityAuditService.ts server/middleware/auth.ts server/routes/auth.ts` — exit 1 (no matches)
- 7 `auditEvent.` member-access usages confirmed in `server/`

### Decisions / notes
- `SecurityAuditEventName` type derivation: used explicit per-namespace union (`EventNamesInNamespace<AuditEventFactory['auth']> | ...`) instead of the spec's generic form — the generic form returned `unknown` for TypeScript's infer handling with the empty `audit` namespace. The `audit` namespace comment is preserved in the docs.
- `asyncHandlerNormalisationPure.ts` introduced as a pure extraction so the test can import it without pulling in `env.ts` (via logger/incidentIngestor). `asyncHandler.ts` delegates to it.
- Legacy `SecurityEventType` and `SecurityEventInput` retained in `securityAuditServicePure.ts` for backward compat with existing vitest (`securityAuditServicePure.test.ts`).

## Chunk B — CI grep invariants (B.1-B.5) — DONE 2026-05-06

### Files created
- `scripts/verify-assert-active.sh` — B.1: hunts db.query on soft-deletable tables with no assertActive/isActive guard
- `scripts/verify-no-raw-console.sh` — B.2: hunts raw console.* in server/ outside allowlist; grandfathered legacy list built in
- `scripts/verify-rate-limit-key-normalisation.sh` — B.3: hunts `as NormalisedEmail` cast bypass outside rateLimitKeys.ts
- `scripts/verify-audit-event-namespace.sh` — B.4: three-pass strategy; hunts raw eventType strings, SecurityAuditEventName casts, and dotted namespace strings
- `scripts/fixtures/verify-assert-active-bad.txt` — known-bad fixture for B.1
- `scripts/fixtures/verify-no-raw-console-bad.txt` — known-bad fixture for B.2
- `scripts/fixtures/verify-rate-limit-key-normalisation-bad.txt` — known-bad fixture for B.3
- `scripts/fixtures/verify-audit-event-namespace-bad-pass1.txt` — known-bad fixture for B.4 pass 1
- `scripts/fixtures/verify-audit-event-namespace-bad-pass3.txt` — known-bad fixture for B.4 pass 3
- `tasks/builds/pre-launch-phase-3-deferred-backlog/audit/assert-active-allowlist.txt` — empty allowlist for B.1

### Files modified
- `.github/workflows/ci.yml` — added `grep_invariants` job (B.5): 4 steps wiring B.1-B.4, unconditional on every PR

### Bug fixed
- `verify-audit-event-namespace.sh` pass 3: `grep | head -1` without `|| true` caused SIGPIPE-exit when grep found no matches (grep exits 1, head exits 0, pipefail propagates grep's non-zero). Added `|| true` to the inner command substitution.

### False positives resolved
- B.1: No false positives — `db.query.<soft-deletable-table>.findFirst/findMany` pattern has 0 occurrences in server/services and server/routes (codebase uses `.select().from()` pattern instead)
- B.2: 291 existing raw console calls grandfathered into `LEGACY_ALLOWLIST` inside the script — new files will be caught
- B.3: No false positives — `NormalisedEmail` doesn't exist yet (Chunk D)
- B.4: No false positives — Chunk A cleaned all call sites

### Verification results
- `bash scripts/verify-assert-active.sh` — EXIT:0
- `bash scripts/verify-no-raw-console.sh` — EXIT:0
- `bash scripts/verify-rate-limit-key-normalisation.sh` — EXIT:0
- `bash scripts/verify-audit-event-namespace.sh` — EXIT:0
- `npm run lint` — exit 0
- `npm run typecheck` — exit 0
- Commit: `ce537318`

## Chunk C — DONE 2026-05-06

(Summary in prior session — commit `3624394a` on branch. C.1 sentinel org fix, C.2 queryAuditEvents two-tx RLS fix, C.3 stateExpired/stateNotFound userAgent/ip fields, C.4 resumeRunAfterOAuth job, C.5 RLS-boundary guard + securityAuditService two-tx pattern.)

## Chunk D — Independent hardening — DONE 2026-05-06

### Files created
- `server/lib/__tests__/rateLimitKeysEmailOnlyPure.test.ts` — D.1 pure test (NormalisedEmail, loginEmailOnlyKey, loginEmailOnlyKeyBurst)
- `server/services/__tests__/securityAuditServicePiiSubstringPure.test.ts` — D.2 pure test (PII substring blacklist)
- `server/services/__tests__/connectionTokenServiceAssertionsPure.test.ts` — D.3 pure test (decideTokenRefreshAssertion)
- `server/services/__tests__/ghlEnrolCapDecisionPure.test.ts` — D.4 pure test (decideEnrolPath)
- `server/jobs/ghlAutoEnrolLocationsPageJob.ts` — D.5 background pagination job
- `server/jobs/__tests__/ghlAutoEnrolLocationsPagePure.test.ts` — D.5 pure test (classifyPageOutcome, classifyError)
- `migrations/0285_subaccounts_external_id_namespace.sql` — D.5 schema migration (up)
- `migrations/0285_subaccounts_external_id_namespace.down.sql` — D.5 schema migration (down)

### Files modified
- `server/lib/rateLimitKeys.ts` — D.1: NormalisedEmail brand, normaliseEmail(), loginEmailOnlyKey(), loginEmailOnlyKeyBurst()
- `server/routes/auth.ts` — D.1: 4-bucket login RL (2 IP+email existing + 2 email-only new); fail-open on backend error with audit emit
- `server/services/securityAuditServicePure.ts` — D.2: PII_SUBSTRINGS substring check in sanitiseMeta()
- `server/services/connectionTokenService.ts` — D.3: principal-context assertions in refreshIfExpired(); trimmedStackTrace(), setSystemWorkerContext(), isSystemContext()
- `server/services/ghlAgencyOauthService.ts` — D.4: cap check vs MAX_GHL_LOCATIONS_TO_ENROL; dispatch GHL_AUTO_ENROL_PAGE_JOB on cap breach; import crypto
- `server/config/limits.ts` — D.4/D.5: MAX_GHL_LOCATIONS_TO_ENROL=250, MAX_GHL_PAGES_PER_RUN=200
- `server/db/schema/subaccounts.ts` — D.5: externalIdNamespace column + orgExternalGhlLocationIdx partial unique index
- `server/services/queueService.ts` — D.5: register 'ghl:auto-enrol-locations-page' worker via boss.work()
- `server/services/workflowEngineService.ts` — D.6: in-situ AR-3.1 comment on advisory-lock scope (NOT in same transaction as pgboss.send)
- `KNOWLEDGE.md` — D.6: advisory-lock scope entry appended

### Deviations from plan
- D.3: `withPrincipalContext.ts` does NOT export a principal org ID accessor. Used `getOrgTxContext().organisationId` from `instrumentation.ts` instead. The three-state contract (undefined/null/string) maps correctly.
- D.5: `classifyPageOutcome` exported for testing but test file is fully hermetic (no runtime imports) to avoid env validation. classifyError is duplicated inline in the test.
- D.6: Advisory lock IS NOT in same transaction as pgboss.send (auto-commit via db.execute). Added comment + KNOWLEDGE entry. Full transaction wrap deferred (AR-3.1 in tasks/todo.md under Deferred).
- D.5: `npm run db:generate` fails with pre-existing "duplicated view name" error unrelated to D.5 changes. Schema type-checks clean via `npm run typecheck`.

### Verification results
- `npm run lint` — exit 0 (0 errors, warnings only pre-existing)
- `npm run typecheck` — exit 0
- `npx tsx server/lib/__tests__/rateLimitKeysEmailOnlyPure.test.ts` — PASS
- `npx tsx server/services/__tests__/securityAuditServicePiiSubstringPure.test.ts` — PASS
- `npx tsx server/services/__tests__/connectionTokenServiceAssertionsPure.test.ts` — PASS
- `npx tsx server/services/__tests__/ghlEnrolCapDecisionPure.test.ts` — PASS
- `npx tsx server/jobs/__tests__/ghlAutoEnrolLocationsPagePure.test.ts` — PASS
- Commit: `e36ea2d4`

## Chunk E — Cleanup and convenience — DONE 2026-05-06

### Files created
- `server/lib/orgScoping.ts` — E.5: `setOrgGUC(tx, orgId)` canonical helper for setting org GUC in real db.transaction blocks
- `server/routes/__tests__/clientErrorsLruPure.test.ts` — E.3: pure LRU dedupe tests (4/4 pass)
- `scripts/verify-skill-error-envelope.sh` — E.6: REQ #15 skill-envelope CI gate
- `scripts/fixtures/verify-skill-error-envelope-bad.txt` — E.6: known-bad fixture

### Files modified
- `server/lib/queryHelpers.ts` — E.1: narrowed `isActive`/`assertActive` generic constraint from `deletedAt: unknown` to `deletedAt: Date | null`
- `client/src/lib/silentCatchHelper.ts` — E.2: extended `logAndSwallow` with optional `{ severity: 'critical' | 'noisy' }` parameter
- `client/src/pages/AdminAgentEditPage.tsx` — E.2: severity: 'critical'
- `client/src/pages/SystemOrganisationsPage.tsx` — E.2: severity: 'critical'
- `client/src/pages/SystemIncidentsPage.tsx` — E.2: severity: 'critical'
- `client/src/pages/OnboardingWizardPage.tsx` — E.2: severity: 'critical' (2 call sites)
- `client/src/pages/SptOnboardingPage.tsx` — E.2: severity: 'critical'
- `client/src/components/Layout.tsx` — E.2: severity: 'critical' (2 call sites)
- `client/src/App.tsx` — E.2: severity: 'critical' (3 call sites — permissions fetches)
- `client/src/hooks/useConversation.ts` — E.2: severity: 'critical'
- `server/routes/clientErrors.ts` — E.3: LRU dedupe (SHA-256, 60s window, 1000 cap) before rate-limit check; `decideDedupe` exported as pure helper
- `migrations/0277_oauth_state_nonces.sql` — E.4: added system-scoped header comment as line 1
- `KNOWLEDGE.md` — E.5: appended `setOrgGUC` canonical replacement entry
- `.github/workflows/ci.yml` — E.6: added E.6 step to grep_invariants job
- `docs/pre-launch-hardening-mini-spec.md` — E.6: amended REQ #4 done criteria (integration test → pure-function test)
- `tasks/builds/pre-launch-phase-3-deferred-backlog/progress.md` — E.7: SC-COVERAGE-BASELINE placeholder section

### Deviations from plan
- E.5: The `withOrgTx({ tx: db })` anti-pattern no longer exists in `oauthIntegrations.ts` or `auth.ts` — it was already fixed in Chunk C (proper `db.transaction` + inline `set_config` + `withOrgTx`). `server/lib/orgScoping.ts` created as the canonical helper for future use; KNOWLEDGE.md updated to reference it.
- E.5: Helper placed in `server/lib/orgScoping.ts` (spec says `server/middleware/orgScoping.ts` but plan corrected to `server/lib/orgScoping.ts` — using lib as the plan confirmed).
- E.6: CRM provider-call builder files (`crmCreateTaskServicePure.ts`, etc.) added to the allowlist — they return `ProviderCall` objects, not skill envelopes. `readDataSource.ts` correctly uses `ok:` and is not allowlisted.

### Verification results
- `npm run lint` — exit 0
- `npm run typecheck` — exit 0
- `npm run build:client` — exit 0 (built in 14.57s)
- `npx tsx server/routes/__tests__/clientErrorsLruPure.test.ts` — 4/4 PASS
- `bash scripts/verify-skill-error-envelope.sh` — EXIT:0 (OK; fixture self-check confirmed)

## B-1 through B-4 fix pass — DONE 2026-05-06

After the initial pr-reviewer pass (CHANGES_REQUESTED — 4 blocking), fixes were applied in-session:

### B-1 — GHL pagination job INSERT bypasses FORCE RLS
- **Root cause:** `ghlAutoEnrolLocationsPageJob.ts` per-location INSERTs ran on the module-level pool connection with no `app.organisation_id` GUC set. FORCE RLS WITH CHECK silently rejected every INSERT; the job emitted progress/completion events while writing zero subaccount rows.
- **Fix:** Wrapped each per-location INSERT in `db.transaction(async (tx) => { await setOrgGUC(tx, organisationId); await tx.execute(sql\`INSERT...\`); })`. The per-location try/catch error boundary wraps the full transaction call so non-fatal per-location errors log and continue.

### B-2 — `external_id_namespace` omitted from inline and webhook INSERT paths
- **Root cause:** `ghlAgencyOauthService.ts` (autoEnrolAgencyLocations) and `ghlWebhookMutationsService.ts` (location_create branch) inserted subaccounts without `external_id_namespace = 'ghl_location'`, causing migration 0285's partial unique index to be bypassed entirely for those paths.
- **Fix:** Added `external_id_namespace: 'ghl_location'` to both INSERT column lists and updated ON CONFLICT target from old `(connector_config_id, external_id)` to new `(organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL`.

### B-3 — Migration backfill safety check too broad
- **Root cause:** The `RAISE EXCEPTION` check in `migrations/0285_subaccounts_external_id_namespace.sql` used `WHERE external_id IS NOT NULL AND external_id_namespace IS NULL` — too broad, would fire on manually-created subaccounts and future non-GHL providers.
- **Fix:** Scoped to GHL rows only: added `AND connector_config_id IN (SELECT id FROM connector_configs WHERE connector_type = 'ghl')`.

### B-4 — OAuth state audit events have null userAgent/ip
- **Root cause:** `setGhlOAuthState` and `consumeGhlOAuthState` called without the `context` argument in `server/routes/ghl.ts` and `server/routes/oauthIntegrations.ts`.
- **Fix:** Added `{ userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null }` as trailing context arg at both call sites.

### Verification after fixes
- `npm run lint` — exit 0 (0 errors)
- `npm run typecheck` — exit 0

### Deferred items from review pass
- S-1 / S-4 — routed to `tasks/todo.md` (inline test copy, in-memory queue setSystemWorkerContext)
- Non-blocking style note: inline `SELECT set_config(...)` calls in ghlAgencyOauthService.ts and ghlWebhookMutationsService.ts vs. `setOrgGUC` helper — functionally equivalent, inconsistent in style. Deferred to follow-up.

## Review logs

| Log | Verdict |
|-----|---------|
| `tasks/review-logs/spec-conformance-log-pre-launch-phase-3-deferred-backlog-2026-05-06T02-10-53Z.md` | NON_CONFORMANT → CONFORMANT_AFTER_FIXES (DG-1/DG-2/DG-3 deferred) |
| `tasks/review-logs/adversarial-review-log-pre-launch-phase-3-deferred-backlog-2026-05-06T03-10-00Z.md` | ADVISORY — 2 confirmed holes closed (F-1, F-2), 2 advisory deferred (A-1, A-2) |
| `tasks/review-logs/pr-review-log-pre-launch-phase-3-deferred-backlog-2026-05-06T03-00-00Z.md` | CHANGES_REQUESTED — 4 blocking (B-1 through B-4) + 2 strong (S-1, S-4) |
| `tasks/review-logs/pr-review-log-pre-launch-phase-3-deferred-backlog-recheck-2026-05-06T03-30-00Z.md` | APPROVED — all 4 fixes verified correct |

## Phase 3 SC-COVERAGE-BASELINE

SC-COVERAGE-BASELINE numbers pending CI run post-merge. To be filled from the
`coverage-baseline` CI job output after the PR merges to main.
