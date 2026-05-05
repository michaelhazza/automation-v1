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
| 5. plan-gate | AWAITING OPERATOR | Plan is LOCKED. Operator reviews `tasks/builds/pre-launch-phase-3-deferred-backlog/plan.md` and approves before chunk loop begins. |
| 6. Per-chunk loop (A → B → C → D → E) | IN PROGRESS | Chunk A DONE 2026-05-06 — see Chunk A section below |
| 7. G2 integrated-state static-check gate | PENDING | |
| 8. Branch-level review pass | PENDING | spec-conformance → adversarial-reviewer → pr-reviewer → fix-loop → dual-reviewer |
| 9. Doc-sync gate | PENDING | |
| 10. Handoff (Phase 2 section) | PENDING | |
| 11. current-focus → REVIEWING | PENDING | |

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

