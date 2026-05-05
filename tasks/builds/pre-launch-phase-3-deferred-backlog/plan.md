# Pre-Launch Phase 3 Deferred Backlog — Implementation Plan

**Plan date:** 2026-05-05
**Author:** architect (Opus, Phase 2 plan-phase, called inline)
**Spec source:** `tasks/builds/pre-launch-phase-3-deferred-backlog/spec.md` (APPROVED FINAL)
**Branch:** `claude/pre-launch-phase-3` (HEAD `1d13a97e`, synced with main, ahead by 4 commits)
**Build slug:** `pre-launch-phase-3-deferred-backlog`
**Plan classification:** Major (5 chunks, ~50 files touched, 1 schema migration, 5 new CI gates)
**Plan status:** FINALISED 2026-05-06 — all 7 §8 open questions resolved (operator approved architect recommendations on all items). Ready for plan gate and chunk dispatch.

---

## Table of contents

1. Summary
2. Model-collapse check
3. Architecture notes (key decisions and pattern choices)
4. Chunk ordering and rationale
5. Cross-cutting concerns and shared utilities
6. Per-chunk detail
   - Chunk A — Canonical types (foundation)
   - Chunk B — CI grep invariants
   - Chunk C — Observability and audit additions
   - Chunk D — Independent hardening
   - Chunk E — Cleanup and convenience
7. Risks and unknowns
8. Open questions for operator (must read before launching builders)
9. Self-consistency pass
10. Doc-sync footprint (carry-forward from spec §10)
11. Executor notes (test-gate posture)

---

## 1. Summary

Phase 3 is the final pre-launch hardening pass — closes the 24-item deferred backlog accumulated across Pre-Launch Phases 1 (PR #261) and 2 (PR #264). No new product features. The spec is locked APPROVED FINAL after 3 spec-reviewer iterations and 5 chatgpt-spec-review rounds. This plan is mechanical decomposition of spec §11 Chunks A–E into a build-ready file inventory + contract surface + dependency graph.

**Footprint at a glance:**

- 12 new files (1 schema migration, 5 CI gate scripts, 1 pg-boss job, 2 new doc files, 3 new TypeScript modules)
- ~25 files modified (asyncHandler, audit service, queryHelpers, rateLimitKeys, oauthIntegrations, clientErrors, etc.)
- ~30 audit-event call-sites renamed (mechanical pass, gate-enforced)
- 1 new DB column + 1 partial-unique index on `subaccounts`
- 1 in-file migration comment (no version bump)

**Three biggest risks (full list in §7):**

1. **D.6 advisory-lock decision is non-trivial.** The current `pg_try_advisory_xact_lock` at `workflowEngineService.ts:839` is on a `db.execute(...)` call, NOT inside a `db.transaction(...)` — meaning the lock is released the instant the SELECT auto-commits. The dispatch at line 1897 runs ~1000 lines later, far outside any transaction boundary. The fix is either (a) wrap `tick()`'s body in `db.transaction(...)` (changes error-handling semantics across the whole method) or (b) switch to `pg_try_advisory_lock` (session-scoped) with explicit unlock in `finally`. Neither is the one-line fix the spec implied. **See Open Question §8.2.**
2. **`PrincipalContext` ALS distinguishability.** Spec D.3 requires `principalOrgId === undefined` (ALS missing) to be distinguishable from `principalOrgId === null` (explicit system-flow). Current `getCurrentPrincipal()` at `server/services/principal/systemPrincipal.ts:36` returns `PrincipalContext | null` — collapses both states. Build must add a sibling helper that preserves the three-way distinction. **See Open Question §8.3.**
3. **`SecurityEventType` already exists as a typed union.** The spec's framing assumed event names were free-form strings; they are not — `securityAuditServicePure.ts` already exports a 14-member `SecurityEventType` union. The Chunk A factory work REPLACES this union with the factory-derived `SecurityAuditEventName`. The 14 existing event names must be enumerated into the four new namespaces (`auth`, `oauth`, `security`, `audit`). Mechanical mapping but every existing call-site must be inspected to confirm the mapping preserves wire-format strings. **See §6 Chunk A and Open Question §8.4.**

---

## 2. Model-collapse check

**Q1: Does this feature decompose into ingest → extract → transform → render?** No. This is hardening work — grep gates, type-system tightening, audit-event factory, RL bucket extension, advisory-lock verification, pg-boss pagination job, and miscellaneous cleanup.

**Q2: Could each step be done with a single frontier-multimodal call?** No. There is no inference workload anywhere in this scope. The closest thing to "model-shaped work" is the audit-event call-site rename pass, which is a deterministic AST/grep transformation, not classification.

**Q3: Could the whole thing collapse to one structured-output call?** No. Code edits, schema migrations, CI scripts, and job handlers are not reducible to inference output. They are mechanical changes with deterministic verification (lint, typecheck, gate scripts, targeted unit tests).

**Decision:** Reject collapse. There is no LLM pipeline to compress. The plan proceeds with conventional code-edit decomposition.

---

## 3. Architecture notes (key decisions and pattern choices)

The locked spec made the architecture decisions; this section names them and points at the patterns selected so builders don't re-litigate.

### 3.1 Single canonical typed-error class — pattern: discriminated-union exception

**Decision (spec §7.1):** New `AppError` class with `readonly` + `Object.freeze` immutability, discriminated `code` enum from `shared/errorCodes.ts`. `asyncHandler` normalises legacy duck-typed `{statusCode, message, errorCode}` throws into synthetic `AppError` shapes.

**Pattern selected:** Adapter pattern at the asyncHandler boundary — legacy errors and new `AppError` instances both produce identical wire output. New throws use the typed class; old throws keep working.

**Rejected:** Backfill all existing throw sites in Phase 3 (rejected — too large to land in one PR; co-located with the Phase 4 backfill sweep in spec §13 deferral).

### 3.2 Audit-event factory IS the union — pattern: const-object-as-source-of-truth

**Decision (spec §7.2):** `shared/types/securityAuditEvents.ts` exports a const-object factory `auditEvent` with four namespaces. The `SecurityAuditEventName` union is derived via `typeof auditEvent[K1][K2]`. There is no separate raw-string source of truth.

**Pattern selected:** Single-source-of-truth via const factory. The const object IS the schema; the union is derived. Adding a new event requires editing the factory; raw-string callers fail compile.

**Rejected:** A `string` parameter with a separate enum/union (current pattern — fragile; allows raw-string drift). A registry function `registerEvent('name')` (rejected — runtime registration loses static-type guarantees).

### 3.3 Single-writer GHL pagination — pattern: pg-boss singleton + payload-carried cursor

**Decision (spec §7.4 + §12.1):** pg-boss `singletonKey: ghl-enrol:${connectionId}` (NOT cursor-suffixed); cursor lives in job payload `{ connectionId, runId, pageCursor, pageIndex }`. Per-location idempotency via partial-unique index `(organisation_id, external_id) WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL`.

**Pattern selected:** Single-writer-per-aggregate. Eliminates the duplicate-progress-event class where cursor-different jobs race on the same connection.

**Rejected:** Cursor-suffixed singleton (`ghl-enrol:${connectionId}:${cursor}` — rejected because two jobs can run concurrently on the same connection, producing duplicate progress events).

### 3.4 Branded type for rate-limit key normalisation — pattern: nominal-flavoured brand

**Decision (spec §7.3):** `type NormalisedEmail = string & { readonly __brand: 'NormalisedEmail' }` exported from `server/lib/rateLimitKeys.ts`. Single constructor `normaliseEmail(input: string): NormalisedEmail`. RL key helpers take `NormalisedEmail`, not `string`.

**Pattern selected:** Brand pattern. Compile-time guarantee replaces fragile data-flow grep tracing. The B.3 grep gate is a backstop for `.js` callers and `as` casts only, NOT the canonical enforcement.

**Rejected:** Runtime normalisation inside the helper (loses the type-system guarantee — caller can pass an unnormalised string and it would still work but with key-fragmentation downstream). Data-flow grep tracing (rejected by spec-reviewer iteration 1 as fragile).

### 3.5 Severity bound at factory entry — pattern: closed-enum metadata

**Decision (spec §7.7):** `SecurityEventSeverity` is a closed enum `'system_integrity' | 'security_boundary' | 'rate_limit' | 'configuration'`. Each `auditEvent.security.*` event ships severity in its factory entry; `recordSecurityEvent` reads severity from the entry, not from a caller param.

**Pattern selected:** Metadata-on-the-factory-entry. A security event's severity is a property of the event, not the moment-in-time circumstances of the throw.

**Rejected:** Per-call severity override (rejected — call sites would diverge on the same event type).

### 3.6 Three-state event taxonomy: terminal vs non-terminal checkpoint

**Decision (spec §12.2):** Terminals are `enrolCompleted` and `enrolFailed`; `enrolPartial` is non-terminal. Page-cap exceeded → `enrolPartial + reason='PAGE_CAP_EXCEEDED'` (safety abort, NOT a failure). Post-terminal silence invariant: once any closing event fires for `(connectionId, runId)`, NO further events of any type.

**Pattern selected:** Explicit closure invariant enforced at the job handler layer (runtime check, not just doc rule). Idempotency of per-location DB writes is the correctness backstop; the explicit drop is the contract.

**Rejected:** Reuse `failed` for safety aborts (rejected — operator response to "page cap reached" is "re-trigger when convenient", not "investigate the failure"; semantic distinction matters).

### 3.7 Append-only audit log with supersedes-event correction

**Decision (spec §7.2):** Rows in `security_audit_events` MUST NEVER be UPDATEd or DELETEd. Corrections insert NEW event with `context.supersedes = '<original_event_id>'`.

**Pattern selected:** Event-sourced correction. Forensic and observability integrity depend on this invariant.

**Rejected:** Update-in-place corrections (rejected — destroys forensic trail; future feature attempting this is a blocking finding).

### 3.8 Fail-open rate limiting — pattern: availability-over-abuse-resistance during incidents

**Decision (spec §7.3):** Both `ip:email` and `email`-only buckets fail OPEN if storage backend errors. Fail-open path emits `auditEvent.security.rateLimitTrip` with `context.severity = 'configuration'` and `context.reason = 'BACKEND_UNAVAILABLE'`.

**Pattern selected:** Auth-availability over abuse-resistance during incidents. Locked as policy — any future fail-closed change is a blocking finding.

### 3.9 No-pattern items (direct code, no abstraction)

The following work is implemented directly without pattern application:

- PII substring extension — array constant + linear loop in pure function
- Migration `0277` header comment — file edit only
- `MAX_GHL_LOCATIONS_TO_ENROL` / `MAX_GHL_PAGES_PER_RUN` constants — module-level exports
- `isActive` / `assertActive` generic narrowing — single-character type-parameter change
- `logAndSwallow` severity tag — optional parameter on existing helper
- LRU dedupe on client-errors — in-memory `Map` with size cap
- REQ #29 baseline capture — operator-driven progress.md edit
- REQ #4 mini-spec amendment — one-line edit

Pattern application would be over-engineering. Direct code is preferred per CLAUDE.md §5.

---

## 4. Chunk ordering and rationale

```
A (canonical types)
├──> B (CI gates referencing A's types)
├──> C (observability events using A's namespaces)
└──> D (D.3 references A's error codes + audit events)
                                    │
E (cleanup) — independent, can land in parallel with B/C/D
```

**Forward dependency graph (no cycles):**

| Chunk | Depends on | Why |
|-------|------------|-----|
| A | — | Foundation chunk |
| B | A.3 | B.4 grep gate verifies callers use the union from A.3 |
| C | A.3, A.4 | OAuth-state events use `auditEvent.oauth.*` from A.3 |
| D | A.1, A.3 | D.3 throws `AppError` (A.2) with codes from A.1 + emits `auditEvent.security.*` from A.3 |
| E | — | Cleanup pass independent of A/B/C/D for the most part |

**Recommended landing order:** A → (B, C, D) in parallel by separate builders → E. The Phase 2 `feature-coordinator` should land A first as a small foundation commit, then dispatch B/C/D builders against the shared foundation. E lands last to avoid carrying a half-state through earlier chunks.

**Rationale for keeping A as the bottleneck:** A.3 and A.4 (factory + rename pass) introduce churn across ~30 call sites. Landing this as the first commit makes B's grep gate work mechanically — the gate fixture proves the gate trips on a known-bad raw-string usage that no longer exists in the codebase. Landing A and B as separate commits in the same PR is also fine if the feature-coordinator prefers atomic landing.

**No chunk references a primitive built in a later chunk** — verified.

---

## 5. Cross-cutting concerns and shared utilities

These concerns span multiple chunks. Builders for individual chunks must respect them.

### 5.1 Audit-event factory consumption

Once Chunk A lands, every chunk that adds a new audit event call site MUST go through the factory (`auditEvent.<namespace>.<eventKey>`). This applies to C.1, C.2, D.1 (rate-limit trip), D.3, D.5 (enrol events). No raw strings; no `as SecurityAuditEventName` casts.

### 5.2 Error-throwing convention for Phase 3 new throws

New throw sites added in Phase 3 (specifically D.3) MUST use `new AppError({ code, statusCode, message, context })`. Pre-existing throw sites are NOT retrofitted (Phase 4 sweep). Builders editing existing files should not opportunistically refactor old throws.

### 5.3 CI gate convention (failure posture meta-rule)

All new gates (B.1–B.4, E.6) AND any pre-existing `verify-*.sh` script that's edited as part of a Phase 3 chunk MUST adopt the failure posture: `exit 1` on first violation; single-line actionable message in the form `<script-name>: <one-sentence problem> at <file:line>`. No multi-page diffs. No "warnings" tier. Each gate ships a known-bad fixture (committed under `scripts/fixtures/<gate-name>/known-bad.txt` or as a code-block inline in the gate's docstring) that the gate is run against in dev to prove it trips.

Pre-existing gates not touched by Phase 3 are NOT updated (out of scope).

### 5.4 Event-emit-then-throw idiom for security boundaries

Where a security-boundary failure throws, the pattern is **emit audit event first, then throw** (D.3 establishes this; future security-boundary code follows the pattern). Rationale (spec §7.7): security-boundary failures must land in `security_audit_events` independent of error-log routing, so post-mortems find them via the audit stream even when an outer handler swallows the throw.

### 5.5 Migration numbering

Current head migration is `0284_baseline_rls_and_dictionary.sql`. The Chunk D.5 schema change is the next sequential — plan as `0285_subaccounts_external_id_namespace.sql`. If a parallel branch lands a `0285` first, the builder must rebase to `0286`. Migration numbering is a build-time decision per `architecture.md`.

### 5.6 Doc-sync touch points

Several chunks update reference docs in the same commit (per CLAUDE.md §11). Specifically:

- A.5 + C.4 → `architecture.md § Layer 4`
- A.5 → `docs/security-audit-namespace.md` (new)
- C.4 → `docs/oauth-state-telemetry.md` (new)
- E.5 → `KNOWLEDGE.md` (refresh `withOrgTx({tx:db})` gotcha)
- E.6 verdict → `docs/pre-launch-hardening-mini-spec.md` (REQ #4 amendment)
- E.7 → `tasks/builds/pre-launch-phase-3-deferred-backlog/progress.md` (operator post-CI capture)
- (cross-cutting) audit-event DESC-DESC ordering invariant → `DEVELOPMENT_GUIDELINES.md § 8`

Builders MUST NOT defer doc updates to a later commit — same commit as the code change.

### 5.7 Overlap with parallel narrow Phase 3 spec

There is an unrelated, parallel narrow spec at `tasks/builds/pre-launch-phase-3/spec.md` that covers three items overlapping ours: (a) `requireSubaccountPermission` audit (our C.2), (b) login email-bucket RL (our D.1), (c) optimiser cost CI. The slug rename to `pre-launch-phase-3-deferred-backlog` was the resolution; both specs coexist. Per the operator's instruction, the spec is locked — DO NOT remove items from our scope. If the narrow spec lands first on `main`, the builder must rebase and merge — overlap conflicts are resolved in our favour (the deferred-backlog spec is the more thorough version of these three items). If our branch lands first, the narrow spec rebases onto our work.

Recommendation: feature-coordinator monitors `main` during Phase 2 build. If the narrow spec lands mid-build, the affected chunk (C.2 or D.1) re-bases on the new main and reuses any helpers the narrow spec introduced.

### 5.8 `withOrgTx` location anomaly (spec said `orgScoping.ts`, code is in `instrumentation.ts`)

The spec §15 names `server/middleware/orgScoping.ts` as the home for the new `setOrgGUC(tx, orgId)` helper (E.5). That file does NOT exist. The actual `withOrgTx` lives in `server/instrumentation.ts:172`. Recommendation: place the new `setOrgGUC` helper alongside `withOrgTx` in `server/instrumentation.ts`, NOT in a new `orgScoping.ts` file. This preserves the existing pattern and avoids a new file with a single helper. The spec's filename is treated as a slip-up; the contract (a `setOrgGUC(tx, orgId)` helper that wraps `tx.execute(sql\`SELECT set_config('app.organisation_id', \${orgId}, true)\`)`) is unchanged.

### 5.9 `systemLimits.ts` location

The spec §6 + §15 names `server/config/systemLimits.ts` as the home for the two new constants (`MAX_GHL_LOCATIONS_TO_ENROL`, `MAX_GHL_PAGES_PER_RUN`). That file does NOT exist; `server/config/` does not exist either. The closest existing pattern is `server/lib/runDepthGuard.ts` which exports `MAX_WORKFLOW_RUN_DEPTH`. Recommendation: create `server/config/systemLimits.ts` as the spec instructs (it becomes the canonical home for system-wide caps; `MAX_WORKFLOW_RUN_DEPTH` can move into it in a separate Phase 4 cleanup). Builder instructions: (a) create the directory + file; (b) export both constants; (c) wire imports into `server/routes/oauthIntegrations.ts` (D.4) and `server/jobs/ghlAutoEnrolLocationsPageJob.ts` (D.5). The new file is small and on-topic.

---

## 6. Per-chunk detail

### Chunk A — Canonical types (foundation)

**Source-of-finding:** R3-2 (A.1, A.2), R3-6 (A.3, A.4, A.5).

**Scope:** Foundation types that the rest of the build depends on. No new behaviour; mostly type-system + a single `asyncHandler` change + a mechanical rename pass.

#### A.1 — `shared/errorCodes.ts` (new)

**File to create:** `shared/errorCodes.ts`

**Contract:**

```typescript
// Discriminated string union — closed; additions require spec amendment.
export type AppErrorCode =
  // Seed-set (enumerated at build time from `git grep "errorCode:" server/`)
  | 'ARTEFACT_ALREADY_COMPLETED'
  | 'OPTIMISTIC_LOCK_FAILED'
  | 'BASELINE_SKIP_PRECONDITION_FAILED'
  // ... (full seed set is build-time decision; see Open Question §8.1)
  // Phase 3 additions (D.3)
  | 'CROSS_TENANT_TOKEN_REFRESH'
  | 'MISSING_PRINCIPAL_CONTEXT'
  // Legacy normalisation sentinel (used by asyncHandler for non-AppError errors)
  | 'LEGACY_ERROR';
```

**Dependencies:** None — this is the foundation file.

**Test surface:** Pure-function test `shared/__tests__/errorCodes.test.ts` — sanity check that the exported type is a string union and the seed members are present. Run via `npx tsx shared/__tests__/errorCodes.test.ts`.

**Acceptance criteria:**

- File exists at `shared/errorCodes.ts`.
- Exports a single `AppErrorCode` type alias.
- Includes both Phase 3 new codes (`CROSS_TENANT_TOKEN_REFRESH`, `MISSING_PRINCIPAL_CONTEXT`) and `LEGACY_ERROR`.
- Seed-set decided per Open Question §8.1.

#### A.2 — `server/lib/errors.ts` (new) + `asyncHandler.ts` update

**Files to create:** `server/lib/errors.ts`

**Files to modify:** `server/lib/asyncHandler.ts`

**Contract:**

```typescript
// server/lib/errors.ts
import type { AppErrorCode } from '../../shared/errorCodes.js';

export interface AppErrorOptions {
  code: AppErrorCode;
  statusCode: number;
  message: string;
  context?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly context: Readonly<Record<string, unknown>> | undefined;

  constructor(opts: AppErrorOptions) {
    super(opts.message);
    this.name = 'AppError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.context = opts.context ? Object.freeze({ ...opts.context }) : undefined;
    Object.freeze(this);
  }
}

// asyncHandler change: instanceof AppError check first; legacy normalisation second.
// Pseudocode at the top of the catch block:
//
//   const normalised = err instanceof AppError
//     ? err
//     : (typeof err === 'object' && err !== null && typeof (err as any).statusCode === 'number')
//       ? new AppError({
//           code: ((err as any).errorCode as AppErrorCode) ?? 'LEGACY_ERROR',
//           statusCode: (err as any).statusCode,
//           message: (err as any).message ?? 'Internal server error',
//           context: { legacy: true },
//         })
//       : new AppError({
//           code: 'LEGACY_ERROR',
//           statusCode: 500,
//           message: err instanceof Error ? err.message : 'Internal server error',
//           context: { legacy: true },
//         });
//
// Downstream wire output is unchanged for legacy throws — code/message/statusCode
// flow through identically.
```

**Dependencies:** A.1 (imports `AppErrorCode`).

**Error handling:** N/A — this IS the error class. The asyncHandler normalisation guarantees no behaviour change for legacy throws.

**Test surface:**

- `server/lib/__tests__/AppError.test.ts` — pure tests: constructor shape, `Object.freeze` on context, mutation attempts throw in strict mode (or are silent no-ops in non-strict — verify behaviour matches expectation).
- `server/lib/__tests__/asyncHandler.test.ts` — test legacy normalisation: throw `{statusCode: 409, message: 'X', errorCode: 'Y'}` and assert response body has `error.code === 'Y'`, `statusCode === 409`. Throw `new AppError({...})` and assert same. Throw a bare `new Error('foo')` and assert 500 + `code === 'LEGACY_ERROR'`.

**Acceptance criteria:**

- `AppError` constructor freezes context (`Object.freeze`).
- All four fields (`code`, `statusCode`, `message`, `context`) are `readonly`.
- `asyncHandler` first-checks `instanceof AppError`, then normalises duck-typed errors with numeric `statusCode`, then falls back to 500.
- Wire format unchanged for legacy throws — verify via integration-style pure test that compares before/after JSON shape.
- `recordIncident` call path preserved (line 53–62 of current `asyncHandler.ts`) — Phase 3 does NOT change incident recording behaviour.

#### A.3 — `shared/types/securityAuditEvents.ts` (new) + `securityAuditService.ts` re-typing

**Files to create:** `shared/types/securityAuditEvents.ts`

**Files to modify:**
- `server/services/securityAuditService.ts` (re-type `eventType` parameter; sentinel-org constant promotion)
- `server/services/securityAuditServicePure.ts` (replace existing `SecurityEventType` union with import of `SecurityAuditEventName`)

**Contract:**

```typescript
// shared/types/securityAuditEvents.ts

export type SecurityEventSeverity =
  | 'system_integrity'
  | 'security_boundary'
  | 'rate_limit'
  | 'configuration';

interface SecurityEventEntry {
  readonly name: string;
  readonly severity?: SecurityEventSeverity; // required for security.* events; optional elsewhere
}

// Const-object factory — IS the source of truth.
export const auditEvent = {
  auth: {
    loginSuccess:           { name: 'auth.login.success' },
    loginFailed:            { name: 'auth.login.failure' },
    logout:                 { name: 'auth.logout' },
    signup:                 { name: 'auth.signup' },
    passwordResetRequested: { name: 'auth.password_reset_requested' },
    passwordResetCompleted: { name: 'auth.password_reset_completed' },
    permissionDenied:       { name: 'auth.permission_denied' },        // C.2 — also used by requireOrgPermission already
    crossOrgAccess:         { name: 'auth.cross_org_access' },
    tokenRevoked:           { name: 'auth.token_revoked' },
  },
  oauth: {
    crossOrgStateMismatch:  { name: 'oauth.cross_org_state_mismatch' },
    invalidState:           { name: 'oauth.invalid_state' },
    stateIssued:            { name: 'oauth.state.issued' },            // C.1 new
    stateConsumed:          { name: 'oauth.state.consumed' },          // C.1 new
    stateExpired:           { name: 'oauth.state.expired' },           // C.1 new
    stateNotFound:          { name: 'oauth.state.not_found' },         // C.1 new
    enrolProgress:          { name: 'oauth.enrol.progress' },          // D.5
    enrolCompleted:         { name: 'oauth.enrol.completed' },         // D.5 terminal
    enrolFailed:            { name: 'oauth.enrol.failed' },            // D.5 terminal
    enrolPartial:           { name: 'oauth.enrol.partial' },           // D.5 non-terminal checkpoint
    enrolCapped:            { name: 'oauth.enrol.capped' },            // D.4 inline-cap hit
  },
  security: {
    rateLimitTrip:           { name: 'security.rate_limit_trip',           severity: 'rate_limit'        },
    crossTenantAttempt:      { name: 'security.cross_tenant_attempt',      severity: 'security_boundary' }, // D.3
    missingPrincipalContext: { name: 'security.missing_principal_context', severity: 'system_integrity'  }, // D.3
  },
  data: {
    configChanged:        { name: 'data.config_changed' },
    scopeDriftDetected:   { name: 'data.scope_drift_detected' },
  },
  job: {
    partialFailure:       { name: 'job.partial_failure' },
  },
  // 'audit' namespace per spec §6 — currently empty; reserved for future audit-of-audit-stream events.
} as const;

// Derived union — every entry's name becomes a literal-string union member.
type AnyEntry =
  typeof auditEvent[keyof typeof auditEvent][keyof typeof auditEvent[keyof typeof auditEvent]];
export type SecurityAuditEventName = AnyEntry['name'];
```

**Note on namespace coverage:** the spec §6 names four namespaces (`auth`, `oauth`, `security`, `audit`) but the existing `SecurityEventType` union has events in `data.*` and `job.*` too. The factory MUST cover all existing event names (rename pass A.4 must not lose any — the wire format strings stay verbatim). The plan adds `data` and `job` namespaces explicitly so the rename pass does not orphan the 5 existing events in those families. The `audit` namespace stays empty per spec (reserved).

**`server/services/securityAuditService.ts` change:**

```typescript
// Before:
import { normaliseSecurityEvent, type SecurityEventInput } from './securityAuditServicePure.js';

export const SECURITY_AUDIT_SENTINEL_ORG_ID = '00000000-0000-0000-0000-000000000000';

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> { ... }

// After:
import { normaliseSecurityEvent, type SecurityEventInput } from './securityAuditServicePure.js';
import { auditEvent, type SecurityAuditEventName, type SecurityEventSeverity } from '../../shared/types/securityAuditEvents.js';

// (Constant already exported; no change needed — it's already exported.)
export const SECURITY_AUDIT_SENTINEL_ORG_ID = '00000000-0000-0000-0000-000000000000';

// recordSecurityEvent body stays the same; the type change happens in
// SecurityEventInput (modify pure file) which now declares
//   eventType: SecurityAuditEventName
// instead of
//   eventType: SecurityEventType
```

**`server/services/securityAuditServicePure.ts` change:** delete the local `SecurityEventType` union; import `SecurityAuditEventName` from `shared/types/securityAuditEvents.ts`; re-type `SecurityEventInput.eventType: SecurityAuditEventName`.

**Dependencies:** A.1 not strictly required, but logical sequencing puts A.1 first.

**Error handling:** N/A — type-system change only.

**Test surface:**

- `shared/types/__tests__/securityAuditEvents.test.ts` — assert all 14 existing event names are present (literal-string equality); assert `auditEvent.security.crossTenantAttempt.severity === 'security_boundary'`; assert TypeScript rejects `auditEvent.security.crossTenantAttempt = { ... }` (compile-time, not runtime — verify via type-only test).
- Existing tests in `server/services/__tests__/securityAuditServicePure.test.ts` should continue to pass after the type swap (rename pass A.4 updates any test fixtures referencing raw strings).

**Acceptance criteria:**

- `auditEvent` factory exports cover ALL existing 14 event names verbatim (no wire-format change).
- `SecurityAuditEventName` derived union has exactly the same string members as the previous `SecurityEventType`.
- `SECURITY_AUDIT_SENTINEL_ORG_ID` exported from `securityAuditService.ts` (already exported per current code — verify).
- `securityAuditServicePure.ts` no longer exports `SecurityEventType` (it's removed; the import path becomes `shared/types/securityAuditEvents.ts`).

#### A.4 — Rename pass (~30 call sites)

**Files to modify (estimated; build-time enumeration via `git grep -nE "recordSecurityEvent\(|securityAuditService\.recordEvent\(|eventType:\s*['\"]"`):**

- `server/middleware/auth.ts` — login success/failure events (multiple call sites)
- `server/routes/auth.ts` — login/signup/password-reset events
- (other call sites enumerated at build time)

**Contract:** every raw string `'auth.login.failure'` (etc.) replaced with `auditEvent.auth.loginFailed.name`. Type-checker enforcement: `recordSecurityEvent({ eventType: auditEvent.X.Y.name, ... })`.

**Dependencies:** A.3.

**Error handling:** N/A — pure rename.

**Test surface:** B.4 grep gate (Chunk B) catches any missed call site or any new raw-string regression. No additional tests authored in this sub-chunk.

**In-pass mechanical guard (run BEFORE committing the rename):** during the rename pass itself — not just at B.4 enforcement after the fact — the builder runs the following grep checks and fixes anything that lights up:

```bash
# (1) Any remaining raw-string eventType in recordSecurityEvent / recordEvent calls.
git grep -nE "(recordSecurityEvent|recordEvent)\([^)]*eventType\s*:\s*['\"]" -- server/

# (2) Any cast bypass — should always be zero hits.
git grep -n "as SecurityAuditEventName" -- server/

# (3) Any straggling raw `auth.` audit-stream string outside the auditEvent namespace
#     (heuristic: strings like 'auth.login.*' / 'auth.password_reset_*' etc. that
#     were not picked up by the eventType-anchored pattern). Filter out the
#     legitimate factory call sites by grep -v "auditEvent".
git grep -n "auth\." -- server/ | grep -v "auditEvent"
```

The third check is a defence-in-depth heuristic. It will produce false positives (e.g. unrelated property paths like `auth.user`); the builder eyeballs the diff and confirms each remaining hit is unrelated to the audit-stream namespace. This is cheap insurance against the rename pass missing a lookup that's spelt as a raw string in a code path the eventType-anchored pattern doesn't see.

**Acceptance criteria:**

- All three grep checks above return zero relevant hits before committing the rename.
- `git grep -nE "(recordSecurityEvent|recordEvent)\([^)]*eventType\s*:\s*['\"]"` returns zero hits in `server/**` (raw strings eliminated).
- `git grep -n "as SecurityAuditEventName"` returns zero hits (no cast bypass).
- `npm run typecheck` passes.

#### A.5 — Convention doc

**Files to create:** `docs/security-audit-namespace.md`

**Files to modify:** `architecture.md § Layer 4 — Security audit stream` (line 1623)

**Contract:** Doc describes the four namespaces (`auth`, `oauth`, `security`, `audit`) plus the auxiliary `data` / `job` namespaces; describes severity classifier; describes the append-only invariant + supersedes-event correction pattern; describes the DESC-DESC ordering convention; references the post-terminal silence invariant for D.5.

`architecture.md § Layer 4` gets a one-paragraph reference + link to `docs/security-audit-namespace.md`.

**Dependencies:** A.3 (the doc references the factory).

**Test surface:** N/A — doc.

**Acceptance criteria:**

- `docs/security-audit-namespace.md` exists.
- `architecture.md` § Layer 4 references it.
- `DEVELOPMENT_GUIDELINES.md § 8` gets a one-line entry for the DESC-DESC ordering invariant (cross-cutting; lands in Chunk A even though it concerns audit ordering, because §8 is canonical for invariants).

#### Chunk A — verification commands (G1 gate)

```
npm run lint
npm run typecheck
npx tsx shared/__tests__/errorCodes.test.ts
npx tsx server/lib/__tests__/AppError.test.ts
npx tsx server/lib/__tests__/asyncHandler.test.ts
npx tsx shared/types/__tests__/securityAuditEvents.test.ts
```

No build script changes; no whole-repo test suite. Tests above are authored in this chunk per spec §16 testing posture.

---

### Chunk B — CI grep invariants (depends on A)

**Source-of-finding:** R3-1 (B.1 sub-1 assertActive, B.2 sub-2 raw console, B.3 sub-3 RL key normalisation, B.4 sub-4 namespace consistency) and R1-4 (B.4 also enforces audit-stream split).

**Scope:** Four new `verify-*.sh` gates wired into CI alongside existing scripts. Each ships a known-bad fixture proven to trip it.

**Cross-cutting failure posture:** every gate produces a single-line actionable error `<script>: <problem> at <file:line>` and exits 1 on first violation. See §5.3.

#### B.1 — `scripts/verify-assert-active.sh` (new)

**Files to create:**
- `scripts/verify-assert-active.sh`
- `scripts/fixtures/verify-assert-active/known-bad.txt` (fixture documenting a failing pattern; gitignored if dynamic, or committed as a static reference)

**Contract:** grep guard that flags any `db.select`/`db.query`/`tx.select` from a soft-deletable table that doesn't pass through `assertActive` / `isActive` within ±10 lines. Allowlist mechanism: a co-located file `scripts/verify-assert-active-allowlist.txt` listing files exempt (e.g. paths that perform admin queries or bulk reads where soft-delete inclusion is intentional).

Soft-deletable tables enumerated at build time (any table in `server/db/schema/` with a `deletedAt` column). The list is hard-coded into the gate script; adding a new soft-deletable table requires updating both the schema and the gate.

**Dependencies:** None mechanically; conceptually depends on A.3 only via "shared gate-failure posture".

**Error handling:** gate exits 1 with single-line `verify-assert-active.sh: write-path read on soft-deletable table without isActive/assertActive at <file:line>`.

**Test surface:**

- Known-bad fixture: a tiny `.ts` snippet (committed under `scripts/fixtures/verify-assert-active/known-bad.ts`) that contains an unguarded soft-deletable read. The gate's docstring shows how to dev-run the gate against the fixture to prove it trips. Documented as: `bash scripts/verify-assert-active.sh scripts/fixtures/verify-assert-active/known-bad.ts` should `exit 1`.
- No unit test authored separately — the gate IS the test.

**Acceptance criteria:**

- Gate trips on the known-bad fixture (proven in dev before merge).
- Gate is silent on the current `main` HEAD (verifies no false positives in the existing codebase).
- Allowlist file exists (may be empty initially; populated as needed).
- Wired into `.github/workflows/<existing-ci-config>.yml` alongside other `verify-*.sh` calls.

#### B.2 — `scripts/verify-no-raw-console.sh` (new)

**Files to create:**
- `scripts/verify-no-raw-console.sh`
- `scripts/verify-no-raw-console-allowlist.txt`

**Contract:** grep guard forbidding raw `console.log`/`console.warn`/`console.error`/`console.debug`/`console.info` outside the explicit allowlist:
- `server/index.ts` (boot)
- `server/lib/logger.ts` (logger internals)
- `scripts/**` (build/dev scripts allowed)
- `server/__tests__/**` and `**/__tests__/**` (test fixtures allowed)
- `client/**` (frontend allowed — server-side gate scope only)

**Dependencies:** None.

**Error handling:** gate exits 1 with `verify-no-raw-console.sh: raw console call outside allowlist at <file:line>`.

**Test surface:**

- Known-bad fixture: a `.ts` snippet with `console.warn("...")` outside allowlist. Dev-run proves trip.

**Acceptance criteria:**

- Gate trips on known-bad.
- Gate is silent on current `main` (build-time verification — if it fails, builder either adds to allowlist or fixes the call site; document each addition).
- Allowlist documented inline in the gate docstring.

#### B.3 — `scripts/verify-rate-limit-key-normalisation.sh` (new)

**Files to create:** `scripts/verify-rate-limit-key-normalisation.sh`

**Contract (narrow scope per spec §7.3):** grep guard that fails on any `as NormalisedEmail` cast in `server/**` and on any RL-key-helper-style call (e.g. `loginIpEmailKey(`, `loginEmailOnlyKey(`) inside `.js` files (no TS type checking). The TypeScript checker is the canonical enforcement; this gate is the cast-bypass + untyped-script backstop.

**Implementation notes:**

- Pattern: `\bas\s+NormalisedEmail\b` — fails the gate, single-line message.
- Pattern: any `*Key(` call within `.js` files in `server/**` — flagged for review.
- Does NOT do data-flow tracing. The spec explicitly rejects that approach.

**Dependencies:** D.1 introduces the branded type; B.3 ships in Chunk B but is mechanically a no-op until D.1 lands the type. Recommendation: land B.3's gate script logic in Chunk B (so the gate exists), but only wire it into CI AFTER D.1 lands the brand. Wire-up timing is a feature-coordinator decision.

**Error handling:** gate exits 1 with `verify-rate-limit-key-normalisation.sh: NormalisedEmail cast bypass at <file:line>`.

**Test surface:**

- Known-bad fixture: a `.ts` snippet with `loginIpEmailKey('1.2.3.4', email as NormalisedEmail)` — trips the gate.

**Acceptance criteria:**

- Gate trips on known-bad.
- Gate is silent on current `main` (no `as NormalisedEmail` casts because the type doesn't exist yet — verify zero hits).
- Wired into CI in conjunction with D.1 (chunk dependency).

#### B.4 — `scripts/verify-audit-event-namespace.sh` (new)

**Files to create:** `scripts/verify-audit-event-namespace.sh`

**Contract:** grep guard that fails on:

1. Any `recordSecurityEvent` / `securityAuditService.recordEvent` call where `eventType:` is followed by a string literal (not a `auditEvent.X.Y.name` member access).
2. Any `as SecurityAuditEventName` cast.
3. Any single-quoted string literal in `server/**` whose contents start with one of the audit-stream namespace prefixes (`auth.`, `oauth.`, `security.`, `data.`, `job.`) and which does NOT appear on a line referencing `auditEvent` (the factory). This catches stray raw-string event names that escape Pattern 1's eventType-anchor — e.g. a logger call using a hard-coded namespace string, or a metric label re-emitting an event name.

**Implementation notes:**

- Pattern 1 (multiline-aware): `(recordSecurityEvent|recordEvent)\([\s\S]*?eventType\s*:\s*['"]` — anchored to the call expression. Use `rg --multiline-dotall` or perl-style.
- Pattern 2: `\bas\s+SecurityAuditEventName\b`.
- Pattern 3: `'(auth|oauth|security|data|job)\.` (note the leading single quote — this anchors to a string literal opening, NOT to property access like `auth.user`). Filter the result through `grep -v auditEvent` to drop legitimate factory call sites that mention both the namespace string and the factory on the same line. The remaining hits are the violators.
  - Implementation: `git grep -nE "'(auth|oauth|security|data|job)\." -- server/ | grep -v auditEvent`. The script wraps this and converts non-empty output into `exit 1` + a single-line message.
  - Why this works without false positives: property-path access like `auth.user` is unquoted; method names like `oauth.consume` are unquoted. The pattern requires a leading `'`, so it only matches inside single-quoted string literals — and those strings starting with namespace prefixes are exactly the audit-stream event names we want to flag.

**Dependencies:** A.3 + A.4 (the gate fails if A.4's rename pass missed any call site).

**Error handling:** gate exits 1 with `verify-audit-event-namespace.sh: raw audit event string at <file:line>` or `... cast bypass at <file:line>` or `... namespace-prefix string literal outside auditEvent factory at <file:line>`.

**Test surface:**

- Known-bad fixture: snippet with `recordSecurityEvent({ eventType: 'auth.login.failure', ... })` — trips Pattern 1. Snippet with `recordSecurityEvent({ eventType: 'X' as SecurityAuditEventName, ... })` — trips Pattern 2. Snippet with `logger.info('oauth.stateConsumed', { ... })` — trips Pattern 3.
- Known-good fixture: snippet with `recordSecurityEvent({ eventType: auditEvent.auth.loginFailed.name, ... })` — silent (factory call site, line contains `auditEvent`).

**Acceptance criteria:**

- Gate trips on all three known-bad patterns.
- Gate is silent on the known-good fixture.
- Gate is silent on current `main` AFTER A.4 rename pass completes (verify zero hits before merging Chunk A).
- Wired into CI alongside other gates.

#### B.5 — Wire-up + meta-rule

**Files to modify:**
- The CI workflow file that runs `verify-*.sh` (look in `.github/workflows/` at build time — the spec doesn't specify, and the file structure may have evolved).

**Contract:** Each new gate is invoked by CI in the same step that runs existing `verify-audit-stream-split.sh` and `verify-rls-contract-compliance.sh`. The meta-rule (§5.3) applies: fail-fast `exit 1` + single-line actionable message.

**Dependencies:** B.1, B.2, B.3, B.4 all need to be on disk before the wire-up. Wire-up is the LAST sub-step of Chunk B.

**Error handling:** N/A.

**Test surface:**

- After wire-up, push a commit with a deliberate violation in a feature branch and verify CI fails with the expected single-line message. (Operator-driven, not a unit test.)

**Acceptance criteria:**

- All four new gates run in CI on every PR.
- Each prints a single-line actionable error on failure.
- No two gates produce overlapping diagnostics for the same root cause (avoid double-counting).

#### Chunk B — verification commands (G1 gate)

```
npm run lint
npm run typecheck
bash scripts/verify-assert-active.sh scripts/fixtures/verify-assert-active/known-bad.ts  # expect exit 1
bash scripts/verify-no-raw-console.sh scripts/fixtures/verify-no-raw-console/known-bad.ts  # expect exit 1
bash scripts/verify-rate-limit-key-normalisation.sh scripts/fixtures/verify-rate-limit-key-normalisation/known-bad.ts  # expect exit 1
bash scripts/verify-audit-event-namespace.sh scripts/fixtures/verify-audit-event-namespace/known-bad.ts  # expect exit 1
bash scripts/verify-assert-active.sh           # expect exit 0 on full repo
bash scripts/verify-no-raw-console.sh          # expect exit 0 on full repo
bash scripts/verify-rate-limit-key-normalisation.sh  # expect exit 0 on full repo
bash scripts/verify-audit-event-namespace.sh   # expect exit 0 on full repo
```

The above are NOT whole-repo gate runs of the existing `verify-*.sh` set — only the four NEW gates from this chunk, plus their fixtures. Existing gates run in CI per §11 executor notes.

---

### Chunk C — Observability and audit additions (depends on A)

**Source-of-finding:** R1-7 (C.1, C.4), AR-2.2 (C.2), AR-1.1 (C.3).

**Scope:** New OAuth-state lifecycle telemetry; subaccount-permission denial event; sentinel-org admin-query helper; two doc files.

#### C.1 — OAuth state lifecycle telemetry

**Files to modify:**
- `server/services/ghlOAuthStateStore.ts` — emit `auditEvent.oauth.stateConsumed` / `stateExpired` / `stateNotFound` with `issuedAt`/`consumedAt`/`latencyMs`
- `server/routes/ghl.ts` — emit `auditEvent.oauth.stateIssued` after `setGhlOAuthState`

**Contract:**

```typescript
// server/services/ghlOAuthStateStore.ts — refactored consumer

import { recordSecurityEvent } from '../services/securityAuditService.js';
import { auditEvent, SECURITY_AUDIT_SENTINEL_ORG_ID } from '../services/securityAuditService.js';
// (note: SECURITY_AUDIT_SENTINEL_ORG_ID and auditEvent are already exported per A.3)

export async function consumeGhlOAuthState(
  nonce: string,
): Promise<{ organisationId: string; pendingRunId: string | null } | null> {
  const consumedAt = new Date();

  // Issue: current implementation does a single DELETE … RETURNING that returns null
  // for both expired and unknown nonces. To distinguish AND avoid a TOCTOU window
  // between SELECT and DELETE, use a single-query CTE that classifies the nonce
  // and conditionally consumes it in one round-trip.
  //
  // CANONICAL IMPLEMENTATION — atomic CTE with always-return-row guarantee:
  //
  //   WITH target AS (
  //     SELECT id, organisation_id, pending_run_id, expires_at, created_at,
  //            now() AS now_ts
  //       FROM oauth_state_nonces
  //      WHERE nonce = $1
  //   ),
  //   consumed AS (
  //     DELETE FROM oauth_state_nonces
  //      WHERE nonce = $1
  //        AND expires_at > now()
  //      RETURNING id
  //   )
  //   SELECT
  //     target.id,
  //     target.organisation_id,
  //     target.pending_run_id,
  //     target.expires_at,
  //     target.created_at,
  //     target.now_ts,
  //     (consumed.id IS NOT NULL)             AS was_consumed,
  //     (target.expires_at <= target.now_ts)  AS was_expired,
  //     false                                  AS was_not_found
  //   FROM target
  //   LEFT JOIN consumed ON consumed.id = target.id
  //
  //   UNION ALL
  //
  //   SELECT
  //     NULL, NULL, NULL, NULL, NULL, now(),
  //     false, false, true
  //   WHERE NOT EXISTS (SELECT 1 FROM target);
  //
  // Always-return-row guarantee: the UNION ALL with a NOT EXISTS guard ensures
  // the query returns exactly one row regardless of whether the nonce existed.
  // This unifies the classification surface — the caller never has to interpret
  // "no rows returned" as "not found"; the row itself carries was_not_found.
  //
  // Classify in code from the single result row:
  //   - was_not_found       → stateNotFound (emit with sentinel-org, return null)
  //   - was_expired         → stateExpired  (emit with row org, return null)
  //   - was_consumed        → stateConsumed (emit with latencyMs, return row)
  //   (the three flags are mutually exclusive by construction)
  //
  // Why CTE: SELECT-then-DELETE has a TOCTOU window where a concurrent consumer
  // can win the DELETE between our SELECT and our DELETE. The CTE form makes the
  // classification + consume a single statement, eliminating the race entirely.
  // The DELETE only fires when expires_at > now(), so an expired nonce is
  // classified as stateExpired (not erroneously consumed). Single-writer guarantee
  // from ADR-0006 still holds; this just removes the in-statement race.
  //
  // Why always-return-row: keeps classification logic uniform in the caller (no
  // dual-path "row vs no row"); test surface is simpler — a single shape covers
  // all three outcomes. Cost is one trivial UNION ALL branch evaluated only when
  // target is empty (cheap planner-side; not a measurable hot-path concern).
  //
  // INVARIANT — first-class contract (NOT just an implementation detail):
  // The CTE above MUST return exactly one row per call. Zero or multiple rows
  // is a correctness failure (a regression in the SQL or a schema change that
  // broke the UNION ALL guard). Enforce this with a runtime assertion in code:
  //
  //   const result = await db.execute(consumeQuery, [nonce]);
  //   if (result.rows.length !== 1) {
  //     throw new Error(
  //       `oauth_state_consume: invariant violation — expected exactly one row, got ${result.rows.length}`
  //     );
  //   }
  //   const [row] = result.rows;
  //
  // Why a hard throw rather than a soft fallback: silent regression on this
  // contract would manifest as inconsistent telemetry (e.g. some not-found
  // cases stop emitting stateNotFound) which is exactly the failure the CTE
  // was designed to prevent. A throw makes the regression loud and obvious;
  // tests targeting this assertion fail clearly. The audit-event call sites
  // downstream (stateConsumed / stateExpired / stateNotFound) trust this
  // contract — breaking it would corrupt the audit stream.
  //
  // SECOND INVARIANT — mutual-exclusivity of classification flags:
  // The three boolean flags on the returned row (was_consumed / was_expired /
  // was_not_found) MUST be mutually exclusive — exactly ONE is true per row.
  // The CTE's structure guarantees this by construction (the target/consumed
  // path emits one of was_consumed/was_expired; the UNION ALL synthetic-row
  // path emits was_not_found and only fires when target is empty). However,
  // the row-count invariant alone does not protect against future SQL edits
  // breaking flag logic without changing row count (e.g. a refactor that
  // accidentally lets was_consumed and was_expired both be true). Enforce
  // this with a second runtime assertion right after row extraction:
  //
  //   const flags = [row.was_consumed, row.was_expired, row.was_not_found].filter(Boolean);
  //   if (flags.length !== 1) {
  //     throw new Error(
  //       `oauth_state_consume: invariant violation — expected exactly one classification, got ${flags.length}`
  //     );
  //   }
  //
  // Why two assertions instead of one: the row-count check protects against
  // SQL regressions that change cardinality; the flag-count check protects
  // against SQL regressions that preserve cardinality but break classification.
  // Together they close the correctness envelope of the CTE — every observable
  // failure mode (zero rows / multiple rows / multiple flags / no flags) lands
  // a loud throw that the invariant-violation tests pin.
  ...
}
```

**`oauthStateNonces` schema check:** the schema must expose `created_at`. Verify at build time. If `created_at` is not currently stored, the spec C.1 latency requirement requires adding it (small migration, but spec §6 doesn't anticipate this — flag in build session if needed). If `expires_at` is stored, `created_at = expires_at - TTL_MS` can be derived without a schema change. Recommendation: derive from `expires_at` to avoid a schema change.

**Event payload (per spec §7.4):**

```typescript
{
  organisationId: stateData.organisationId,    // for stateConsumed; sentinel for not_found
  eventType: auditEvent.oauth.stateConsumed.name,
  meta: {
    provider: 'ghl',
    userAgent: req.headers['user-agent'],
    ipHash: hashIp(req.ip),                    // existing hashIp helper
    issuedAt: row.created_at.toISOString(),     // or expires_at - TTL_MS
    consumedAt: consumedAt.toISOString(),
    latencyMs: consumedAt.getTime() - row.created_at.getTime(),
    // No callerSegment yet — post-launch field, optional.
  },
}
```

`stateExpired` similarly carries `issuedAt`/`expiredAt`/`latencyMs`. `stateNotFound` carries just `provider`/`userAgent`/`ipHash`.

`stateIssued` is emitted from `routes/ghl.ts` after `setGhlOAuthState(nonce, orgId, pendingRunId)`. Payload: `{ provider: 'ghl', orgId, pendingRunId, userAgent, ipHash }`.

**Dependencies:** A.3 (factory), A.4 (rename pass for any pre-existing OAuth state events).

**Error handling:** audit emission errors are caught by `recordSecurityEvent`'s existing `try/catch` — failures are logged but do not propagate. If `recordSecurityEvent` throws synchronously, the OAuth flow continues (best-effort observability per spec).

**Test surface:**

- `server/services/__tests__/ghlOAuthStateStorePure.test.ts` — pure tests that exercise the consume logic against an in-memory mock DB and assert the correct event was emitted (capture via a stub `recordSecurityEvent`). Verify `latencyMs` is computed correctly for stateConsumed.
- Always-return-row test: invoke `consumeGhlOAuthState` against an in-memory DB containing zero matching nonces — assert the query returns exactly one row with `was_not_found = true` and the other flags `false`. Repeat for the expired and consumed paths to confirm the three flag combinations are mutually exclusive.
- Invariant-violation test (row-count): stub the underlying `db.execute` to return a result with `rows.length === 0` (or `rows.length === 2`). Assert `consumeGhlOAuthState` throws with a message containing `oauth_state_consume: invariant violation — expected exactly one row`. This test pins the runtime guard against silent SQL regressions that change row cardinality.
- Invariant-violation test (flag mutual-exclusivity): stub the underlying `db.execute` to return a single row with two flags simultaneously true (e.g. `{ was_consumed: true, was_expired: true, was_not_found: false }`) and again with all three flags false. Assert `consumeGhlOAuthState` throws with a message containing `oauth_state_consume: invariant violation — expected exactly one classification`. This test pins the runtime guard against silent SQL regressions that preserve cardinality but break classification flags.
- Verify event ordering: emit-then-throw is NOT applicable here (these are not security boundary throws); just emit-and-return.

**Acceptance criteria:**

- All four `oauth.state.*` events fire from the appropriate code paths.
- `stateConsumed` and `stateExpired` events carry `latencyMs`.
- The CTE always returns exactly one row per call; classification is driven by the three boolean flags (`was_consumed` / `was_expired` / `was_not_found`), never by absence of rows.
- The "exactly one row" contract is enforced as a runtime invariant: `consumeGhlOAuthState` throws `oauth_state_consume: invariant violation — expected exactly one row` if the query ever returns zero or multiple rows. Pinned by the row-count invariant-violation test in the test surface.
- The "exactly one classification flag" contract is enforced as a second runtime invariant: `consumeGhlOAuthState` throws `oauth_state_consume: invariant violation — expected exactly one classification` if the returned row carries zero or multiple of (`was_consumed` / `was_expired` / `was_not_found`). Pinned by the flag-mutual-exclusivity invariant-violation test in the test surface. Together with the row-count assertion, this closes the correctness envelope of the CTE — every observable regression (cardinality OR classification) lands a loud throw.
- No raw-string event names (B.4 gate enforces).
- Existing OAuth callback behaviour is unchanged (success path still returns the consumed row to the caller).

#### C.2 — `requireSubaccountPermission` 403 audit event

**Files to modify:** `server/middleware/auth.ts` (line 394 — the 403 branch in `requireSubaccountPermission`).

**Contract:**

```typescript
// Before line 394 res.status(403).json({ error: 'Forbidden' });
await recordSecurityEvent({
  organisationId: req.orgId ?? req.user.organisationId ?? SECURITY_AUDIT_SENTINEL_ORG_ID,
  subaccountId: subaccountId,
  actorUserId: req.user.id,
  actorRole: req.user.role,
  eventType: auditEvent.auth.permissionDenied.name,
  targetType: 'subaccount',
  targetId: subaccountId,
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  meta: { permissionKey, scope: 'subaccount' },
});
res.status(403).json({ error: 'Forbidden' });
return;
```

The pattern mirrors what `requireOrgPermission` already does (verify at build time — if `requireOrgPermission` does NOT emit this event, a sibling addition is needed there too, but spec §11 C.2 is explicit that `requireOrgPermission` already emits it).

**Dependencies:** A.3.

**Error handling:** `recordSecurityEvent` swallows internal errors per its existing implementation (line 40–46 of current code). The middleware does NOT block the 403 response on audit failure.

**Test surface:** None authored in this chunk — the existing `requireOrgPermission` mirror pattern is the implicit reference. If desired, a tiny pure test could mock the middleware and assert the call site: `server/middleware/__tests__/requireSubaccountPermissionPure.test.ts`.

**Acceptance criteria:**

- The 403 branch emits `auditEvent.auth.permissionDenied` BEFORE responding.
- `meta.scope === 'subaccount'` to distinguish from org-level denials.
- Audit record uses sentinel-org if `req.orgId` is unavailable (defensive).

#### C.3 — Sentinel-org admin-query helper

**Files to modify:**
- `server/services/securityAuditService.ts` — add a new exported helper (e.g. `listSecurityAuditEvents({ orgId, includeSentinelOrg, ... })`)
- `architecture.md § Layer 4` — one-paragraph note documenting the helper

**Contract:**

```typescript
export interface ListSecurityAuditEventsOptions {
  orgId: string;
  includeSentinelOrg?: boolean;  // default false
  limit?: number;
  cursor?: string;
  // ... other filters as needed
}

export async function listSecurityAuditEvents(
  opts: ListSecurityAuditEventsOptions,
): Promise<SecurityAuditEvent[]> {
  // SELECT ... FROM security_audit_events
  // WHERE organisation_id = $1
  //   OR (organisation_id = SECURITY_AUDIT_SENTINEL_ORG_ID AND $2 = true)
  // ORDER BY created_at DESC, id DESC
  // LIMIT $3
  // (cursor handling per existing pattern)
}
```

**Note on existing read paths:** if a caller already exists that lists audit events without the sentinel-org option, this chunk does NOT retroactively change them — the new helper is additive. Any caller that opts into the new helper opts into sentinel-org visibility. Verify at build time whether such a caller exists.

**Dependencies:** A.3 (uses `SECURITY_AUDIT_SENTINEL_ORG_ID`).

**Error handling:** standard service-layer throws (`{ statusCode, message }`); no new error codes required (read-only path).

**Test surface:** N/A in Phase 3. The helper is documentation-grade for now; consumers ship post-launch.

**Acceptance criteria:**

- `listSecurityAuditEvents` exported from `securityAuditService.ts`.
- Default behaviour: `includeSentinelOrg === false` returns only rows for the given `orgId`.
- `architecture.md § Layer 4` references the helper and the DESC-DESC ordering.

#### C.4 — `docs/oauth-state-telemetry.md`

**Files to create:** `docs/oauth-state-telemetry.md`

**Contract:** doc describes:
- The four `oauth.state.*` events emitted by C.1.
- The `latencyMs` measurement and how to use it for the post-launch TTL revert decision.
- Segment fields (`provider`, `userAgent`, `ipHash`, `callerSegment?`).
- The decision criteria for keep-5min vs revert-to-10min (P95 latency margin to TTL).

**Dependencies:** C.1.

**Test surface:** N/A — doc.

**Acceptance criteria:**

- Doc exists and references the four events by their factory names.
- `architecture.md § Layer 4` links to it.

#### Chunk C — verification commands (G1 gate)

```
npm run lint
npm run typecheck
npx tsx server/services/__tests__/ghlOAuthStateStorePure.test.ts
```

Optional: `npx tsx server/middleware/__tests__/requireSubaccountPermissionPure.test.ts` if authored.

---

### Chunk D — Independent hardening (depends on A)

**Source-of-finding:** AR-5.1 + Phase-1 residue (D.1), AR-4.1 (D.2), AR-6.1 (D.3), Phase-1 residue GHL enrol cap (D.4), R1-8 (D.5), AR-3.1 (D.6).

**Scope:** Six independent hardening items, none depending on the others within Chunk D, all depending on A's types.

#### D.1 — Email-only login rate-limit bucket + branded `NormalisedEmail`

**Files to modify:**
- `server/lib/rateLimitKeys.ts` — add `NormalisedEmail` brand + `normaliseEmail` constructor + `loginEmailOnlyKey` helper; re-type existing helpers to take `NormalisedEmail`
- `server/routes/auth.ts` — login handler checks both `ip:email` and `email`-only buckets

**Contract:**

```typescript
// server/lib/rateLimitKeys.ts (additions)

export type NormalisedEmail = string & { readonly __brand: 'NormalisedEmail' };

export function normaliseEmail(input: string): NormalisedEmail {
  return input.trim().toLowerCase() as NormalisedEmail;
}

// Existing helpers — re-typed to take NormalisedEmail.
// rateLimitKeys.authLogin: (ip: string, email: NormalisedEmail) => string
// rateLimitKeys.authLoginLong: (ip: string, email: NormalisedEmail) => string

// New helper:
// rateLimitKeys.authLoginEmail: (email: NormalisedEmail) => string
//   returns `rl:v1:auth:login:email:${email}`
```

**`routes/auth.ts` change:**

```typescript
// Pseudocode for the login handler:

const email = normaliseEmail(req.body.email);

// safeRateLimitCheck wraps each call with the fail-open behaviour described below.
// `bucket` is passed so the audit event carries the bucket type on backend failure.
const [shortBucket, longBucket, emailBucket] = await Promise.all([
  safeRateLimitCheck(rateLimitKeys.authLogin(req.ip, email),     10,  60,   'ip_email_short'),
  safeRateLimitCheck(rateLimitKeys.authLoginLong(req.ip, email), 50,  3600, 'ip_email_long'),
  safeRateLimitCheck(rateLimitKeys.authLoginEmail(email),        100, 3600, 'email_only'),  // new
]);

if (!shortBucket.allowed || !longBucket.allowed || !emailBucket.allowed) {
  // existing rate-limit response (with optional auditEvent.security.rateLimitTrip emission)
  return res.status(429).json({ error: 'rate_limited' });
}
```

**Fail-open behaviour:** if `rateLimitCheck` throws (storage backend unavailable), the catch path emits `auditEvent.security.rateLimitTrip` with a diagnosable meta payload (severity, reason, bucket-type, limit, windowSec, key) and ALLOWS the request through. Audit emission is throttled per `(bucket, identity)` pair to prevent log floods during a backend outage WITHOUT cross-user suppression. Pseudocode:

```typescript
type RlBucketType = 'ip_email_short' | 'ip_email_long' | 'email_only';

// In-process, per-(bucket, identity) throttle: at most one rateLimitTrip event
// per identity per 30 seconds. During an outage, every login request would
// otherwise emit one event — a loud, unhelpful flood. We only need ONE record
// per affected identity per outage window; the audit stream is for incident
// detection, not for per-request observability of the failure path.
//
// Identity key — IMPORTANT: orgId is NOT available in this code path. The
// fail-open branch fires when the rate-limit backend is down; auth/lookup may
// not have completed yet, and the email may not even resolve to an org. The
// natural identity is the RL `key` parameter itself, which is already a
// stable hash of (ip, email) for ip_email_short / ip_email_long buckets, or
// of (email) for the email_only bucket. Keying suppression on `${bucket}:${key}`
// gives a per-identity throttle without requiring orgId.
//
// Why per-(bucket, identity) instead of per-bucket: keying by bucket alone
// would let one user's first failure suppress every other user's audit event
// for 30s during a sustained outage — unintentional cross-user suppression
// that destroys signal during the exact incident the audit is meant to record.
// Per-(bucket, identity) preserves one record per affected identity, so a
// partial outage that hits 50 users produces 50 records (one per user) per
// 30s window, not one record total. Map size is bounded by request volume in
// a single 30s window per process; entries naturally age out as Date.now()
// progresses past the suppression window.
//
// Process-local Map is intentional — fail-open audit emission is best-effort
// observability; we accept that a multi-process deployment may emit up to
// (process-count) events per 30s window per (bucket, identity). That is still
// orders of magnitude below an unsuppressed flood and well within
// signal-to-noise.
//
// Soft cap on Map growth — defensive against unbounded creep:
// Under a high-cardinality attack scenario (bot spray with many distinct
// (ip, email) pairs) AND a sustained backend outage, the Map could accumulate
// entries faster than they age out, costing memory in a long-running process.
// Apply a soft cap: once the Map exceeds MAX_RL_SUPPRESSION_ENTRIES, clear it
// in full. Clearing rather than evicting LRU-style is intentional — simpler,
// no extra bookkeeping, and the worst case after a clear is one extra audit
// event per (bucket, identity) until suppression re-establishes. That is
// acceptable: best-effort observability tolerates a transient un-suppression
// burst far better than it tolerates unbounded memory growth. The cap is
// sized at 10_000 — well above the realistic identity-cardinality of a single
// process during a 30s window in normal traffic, but low enough to bound RAM
// at <1MB even under pathological string sizes.
const RATE_LIMIT_TRIP_SUPPRESSION_MS = 30_000;
const MAX_RL_SUPPRESSION_ENTRIES = 10_000;
const lastRateLimitTripEmit = new Map<string, number>();  // key: `${bucket}:${rlKey}`

function shouldEmitRateLimitTrip(bucket: RlBucketType, rlKey: string): boolean {
  const suppressionKey = `${bucket}:${rlKey}`;
  const now = Date.now();
  const last = lastRateLimitTripEmit.get(suppressionKey);
  if (last !== undefined && now - last < RATE_LIMIT_TRIP_SUPPRESSION_MS) {
    return false;
  }
  // Defensive soft cap — prevent unbounded growth under high-cardinality attack.
  if (lastRateLimitTripEmit.size > MAX_RL_SUPPRESSION_ENTRIES) {
    lastRateLimitTripEmit.clear();
  }
  lastRateLimitTripEmit.set(suppressionKey, now);
  return true;
}

async function safeRateLimitCheck(
  key: string,
  limit: number,
  windowSec: number,
  bucket: RlBucketType,
) {
  try {
    return await rateLimitCheck(key, limit, windowSec);
  } catch (err) {
    if (shouldEmitRateLimitTrip(bucket, key)) {
      await recordSecurityEvent({
        organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
        eventType: auditEvent.security.rateLimitTrip.name,
        meta: {
          severity: 'configuration',
          reason: 'BACKEND_UNAVAILABLE',
          bucket,        // which bucket fell open — distinguishes incident shape
          limit,         // configured limit at the time of failure
          windowSec,     // configured window at the time of failure
          key,           // the actual rl key (already org-namespaced)
        },
      });
    }
    return { allowed: true };  // fail-open
  }
}
```

**Why these meta fields:** post-incident, an operator reading the audit stream needs to answer "which bucket fell open, how big was its limit, what was the window?" without reading source. `bucket` distinguishes a per-IP storm from a per-email storm; `limit` + `windowSec` capture the configured posture (these may shift over time, so capturing at emission is the diagnosable record).

This wrapper is local to `routes/auth.ts` (small enough, only used for login). If the spec posture extends to other RL call sites, a shared helper is justified later. Phase 3 keeps it local.

**Dependencies:** A.3 (factory).

**Error handling:** the wrapper above swallows backend errors; emits the audit event; returns `allowed: true`. Locked posture per spec §7.3.

**Test surface:**

- `server/lib/__tests__/rateLimitKeysPure.test.ts` — tests for `normaliseEmail` (idempotence, lowercases, trims); tests for `authLoginEmail` key shape.
- Integration-style pure test for the fail-open wrapper: stub `rateLimitCheck` to throw, assert `safeRateLimitCheck` returns `{ allowed: true }` and emits the audit event.
- Suppression test (same identity): stub `rateLimitCheck` to throw, call `safeRateLimitCheck` 5 times in rapid succession on the same `(bucket, key)` pair — assert exactly ONE audit event was emitted; advance the test clock by `RATE_LIMIT_TRIP_SUPPRESSION_MS + 1`, call again — assert a SECOND event fires. Different buckets with the same key are throttled independently. Different keys within the same bucket are throttled independently.
- Cross-identity test (regression guard for bucket-only suppression bug): stub `rateLimitCheck` to throw, call `safeRateLimitCheck` once with `(bucket = 'ip_email_short', key = 'rl:auth:login:ipA:emailA')` — assert ONE event emitted; immediately call again with `(bucket = 'ip_email_short', key = 'rl:auth:login:ipB:emailB')` — assert a SECOND event fires (different identity, must not be suppressed). This pins the per-(bucket, identity) keying contract.

**Acceptance criteria:**

- `NormalisedEmail` brand exists and is unforgeable except via `normaliseEmail`.
- Login route checks 3 buckets, fails-open on storage error, emits the configuration-severity event when it fails-open.
- Fail-open emission is throttled per `(bucket, identity)` pair to at most one event per 30s — under sustained backend outage the audit stream gets one record per affected identity per window, not one record per request, and NOT one record per bucket (which would unintentionally suppress other users). The suppression key is `${bucket}:${rlKey}` where `rlKey` is the rate-limit key string already passed to `safeRateLimitCheck` (no orgId required — orgId is unavailable on the fail-open path).
- B.3 grep gate passes (no `as NormalisedEmail` casts anywhere).
- Existing `signup` / `forgot` / `reset` keys continue to take `string` for now (out of scope for Phase 3 — only the login path is hardened per spec).

#### D.2 — PII substring blacklist

**Files to modify:** `server/services/securityAuditServicePure.ts`

**Contract:**

```typescript
const PII_BLACKLIST = new Set(['password', 'token', 'secret', 'authorization']);
const PII_SUBSTRINGS = ['password', 'token', 'secret', 'authorization', 'credential'] as const;

export function normaliseSecurityEvent(input: SecurityEventInput): SecurityEventInput {
  const meta = { ...(input.meta ?? {}) };
  for (const k of Object.keys(meta)) {
    const lower = k.toLowerCase();
    if (PII_BLACKLIST.has(lower) || PII_SUBSTRINGS.some(sub => lower.includes(sub))) {
      meta[k] = '[redacted]';
    }
  }
  // ... existing byte-cap logic
}
```

**Dependencies:** None.

**Error handling:** N/A — pure function.

**Test surface:**

- Extend `server/services/__tests__/securityAuditServicePure.test.ts` with new cases:
  - `meta: { 'apiToken': 'abc' }` → redacted (substring match).
  - `meta: { 'CredentialRef': 'xyz' }` → redacted.
  - `meta: { 'helloWorld': 'safe' }` → not redacted (no substring match).

**Acceptance criteria:**

- Substring match runs IN ADDITION to exact-key match.
- Existing exact-key tests continue to pass.

#### D.3 — `connectionTokenService.refreshIfExpired` cross-tenant assertion

**Files to modify:** `server/services/connectionTokenService.ts` (line 134 onwards)

**Files to verify (existence):** `server/services/principal/systemPrincipal.ts` provides `getCurrentPrincipal()` returning `PrincipalContext | null`. **The build session must add a sibling helper to distinguish `undefined` (no ALS) from `null` (system flow) — see Open Question §8.3.**

**Contract:**

```typescript
import { AppError } from '../lib/errors.js';
import { recordSecurityEvent } from './securityAuditService.js';
import { auditEvent } from '../../shared/types/securityAuditEvents.js';
// New helper imported here (build-time location TBD per Open Question §8.3):
import { getCurrentPrincipalOrgId } from './principal/systemPrincipal.js';
//   getCurrentPrincipalOrgId(): string | null | undefined
//     - undefined: ALS scope absent (caller forgot to enter withSystemPrincipal / withPrincipalContext)
//     - null:      explicit system-flow sentinel (caller deliberately set null org)
//     - string:    a real organisation id

async refreshIfExpired(connection: IntegrationConnection): Promise<IntegrationConnection> {
  // ... existing buffer/expiry checks ...

  // NEW: ordered cross-tenant assertions (D.3)
  const principalOrgId = getCurrentPrincipalOrgId();

  if (principalOrgId === undefined) {
    await recordSecurityEvent({
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      eventType: auditEvent.security.missingPrincipalContext.name,
      meta: {
        severity: auditEvent.security.missingPrincipalContext.severity,  // 'system_integrity'
        connectionId: connection.id,
        connectionOrgId: connection.organisationId,
        callerStack: new Error().stack?.split('\n').slice(2, 8).join('\n'),
      },
    });
    throw new AppError({
      code: 'MISSING_PRINCIPAL_CONTEXT',
      statusCode: 500,
      message: 'Principal context not set in ALS — refusing token refresh',
      context: { connectionId: connection.id, connectionOrgId: connection.organisationId },
    });
  }

  if (principalOrgId !== null && principalOrgId !== connection.organisationId) {
    await recordSecurityEvent({
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      eventType: auditEvent.security.crossTenantAttempt.name,
      meta: {
        severity: auditEvent.security.crossTenantAttempt.severity,  // 'security_boundary'
        connectionId: connection.id,
        connectionOrgId: connection.organisationId,
        principalOrgId,
        attemptedOperation: 'token_refresh',
      },
    });
    throw new AppError({
      code: 'CROSS_TENANT_TOKEN_REFRESH',
      statusCode: 403,
      message: 'Cross-tenant token refresh blocked',
      context: { connectionOrgId: connection.organisationId, principalOrgId },
    });
  }

  // ... existing refresh logic continues ...
}
```

**Dependencies:** A.1 (error codes), A.2 (`AppError`), A.3 (factory).

**Error handling:** both throws use `AppError`. The `recordSecurityEvent` is awaited but NOT wrapped in try/catch — emit-then-throw idiom requires the audit event to land before the throw (see §5.4). Failures inside `recordSecurityEvent` are swallowed by the service per existing code, so the throw still fires.

**Test surface:**

- `server/services/__tests__/connectionTokenServicePure.test.ts` — pure tests covering the three branches:
  - `principalOrgId === undefined` → emits `missingPrincipalContext`, throws with code `MISSING_PRINCIPAL_CONTEXT`.
  - `principalOrgId === 'org-A', connection.organisationId === 'org-B'` → emits `crossTenantAttempt`, throws with code `CROSS_TENANT_TOKEN_REFRESH`.
  - `principalOrgId === null` → no event, no throw, refresh proceeds.
  - `principalOrgId === connection.organisationId` → no event, no throw, refresh proceeds.

**Acceptance criteria:**

- Both new throws use `AppError`.
- Audit events emit BEFORE throws.
- The `=== undefined` vs `=== null` distinction is preserved.
- Existing `guard-ignore-next-line` comment is retained on the UPDATE statement (it's still required — the assertions are defence-in-depth, not a replacement for the guard).
- B.4 gate passes (factory member access for event names).

#### D.4 — GHL enrol cap (inline path)

**Files to modify:**
- `server/config/systemLimits.ts` (NEW per §5.9 — verify decision)
- `server/routes/oauthIntegrations.ts` (the inline `autoEnrolAgencyLocations` call site, line 432–446)

**Contract:**

```typescript
// server/config/systemLimits.ts (new)
export const MAX_GHL_LOCATIONS_TO_ENROL = 250;
export const MAX_GHL_PAGES_PER_RUN      = 200;
```

**`routes/oauthIntegrations.ts` change:** before invoking `autoEnrolAgencyLocations`, fetch the count of agency locations (the existing `enumerateAgencyLocations` is the closest helper — verify at build time). If `count > MAX_GHL_LOCATIONS_TO_ENROL`:

1. Emit `auditEvent.oauth.enrolCapped` with `meta: { connectionId, connectionOrgId, totalLocations: count, capLimit: MAX_GHL_LOCATIONS_TO_ENROL }`.
2. Dispatch the D.5 pagination job with a fresh `runId`.
3. Redirect with a `partial-enrol` flag so the UI shows "enrolment in progress" rather than "enrolment complete".

**Dependencies:** A.3 (factory), D.5 (the pagination job must exist before the dispatch can target it). Inter-chunk dependency: D.5 lands first, then D.4 wires the dispatch.

**Error handling:** the count-fetch is best-effort; if it fails, fall through to the existing inline path (preserves Phase 2 behaviour).

**Test surface:** N/A — pure-function tests don't apply (this is integration-shaped). The job test in D.5 covers the behaviour.

**Acceptance criteria:**

- `MAX_GHL_LOCATIONS_TO_ENROL = 250` constant lives in `server/config/systemLimits.ts`.
- The inline path no longer attempts to enrol > 250 locations in a single transaction.
- `enrolCapped` event fires when the cap is hit.
- The pagination job is dispatched with a fresh `runId`.

#### D.5 — GHL pagination background job

**Files to create:**
- `server/jobs/ghlAutoEnrolLocationsPageJob.ts` — pg-boss job handler
- `migrations/0285_subaccounts_external_id_namespace.sql` — schema change + backfill (or `0286` if rebased)

**Files to modify:**
- `server/db/schema/subaccounts.ts` — add `externalIdNamespace: text('external_id_namespace')` + register the partial-unique index in the table builder
- `server/services/ghlAgencyOauthService.ts` — add `enqueueAutoEnrolPageJob` helper that the inline path (D.4) and the job's re-enqueue both call
- `server/jobs/index.ts` (or whichever registers pg-boss workers) — register the new queue worker

**Migration contract (`0285_subaccounts_external_id_namespace.sql`):**

```sql
-- Pre-flight guard: fail loudly if provider_type='ghl' is not present in
-- connector_configs. This prevents silent partial backfill if the provider_type
-- string was ever renamed (e.g. 'gohighlevel', 'ghl_agency'). The build session
-- verifies the actual string at build-time via
-- `git grep "provider_type.*ghl" server/db/`; if the string differs, this guard
-- AND the WHERE clause below are updated together.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM connector_configs WHERE provider_type = 'ghl'
  ) THEN
    RAISE EXCEPTION 'Migration 0285 expected provider_type = ''ghl'' in connector_configs but found none. Verify the provider_type string and update this guard + the backfill WHERE clause together.';
  END IF;
END $$;

-- Add namespace column (nullable, default null)
ALTER TABLE subaccounts ADD COLUMN external_id_namespace text;

-- Partial-unique index for ghl_location namespace
CREATE UNIQUE INDEX subaccounts_org_external_ghl_location_idx
  ON subaccounts (organisation_id, external_id)
  WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL;

-- Inline backfill: existing GHL-enrolled rows
-- (identification: rows whose connector_config_id joins to a GHL connector)
UPDATE subaccounts
SET external_id_namespace = 'ghl_location'
WHERE external_id IS NOT NULL
  AND connector_config_id IN (
    SELECT id FROM connector_configs WHERE provider_type = 'ghl'
  );

-- (down migration drops the index + column; do NOT include backfill rollback —
-- forward-only behaviour per DEVELOPMENT_GUIDELINES)
```

**Job handler contract:**

```typescript
// server/jobs/ghlAutoEnrolLocationsPageJob.ts

interface PageJobPayload {
  connectionId: string;
  runId: string;          // chain identity — preserved across re-enqueues
  pageCursor: string | null;  // opaque token from upstream GHL API; null for first page
  pageIndex: number;      // 0-indexed; bounded by MAX_GHL_PAGES_PER_RUN
}

export const GHL_AUTO_ENROL_PAGE_QUEUE = 'ghl:auto-enrol-locations-page';

export async function ghlAutoEnrolLocationsPageHandler(
  payload: PageJobPayload,
): Promise<void> {
  const { connectionId, runId, pageCursor, pageIndex } = payload;

  // Drop late retries against a known-closed chain.
  // Implementation: query the security_audit_events stream for any event whose
  // event_type is in the ENROL_TERMINAL_EVENTS set, scoped to (connectionId, runId).
  //
  // The terminal-event set is a SHARED CONSTANT — the SAME set used by the
  // emitters (emitEnrolCompleted / emitEnrolFailed / emitEnrolPartial) and by
  // the reader (isChainClosed). This prevents drift between what the job emits
  // as "terminal" and what the closure check treats as "terminal". Aligns with
  // the single-source-of-truth pattern used elsewhere (e.g. workflow terminal
  // statuses). Define once, use in both directions:
  //
  //   const ENROL_TERMINAL_EVENTS = new Set<SecurityAuditEventName>([
  //     auditEvent.oauth.enrolCompleted.name,
  //     auditEvent.oauth.enrolFailed.name,
  //     auditEvent.oauth.enrolPartial.name,
  //   ]);
  //
  // The closure-check query uses this set:
  //   WHERE event_type IN (...ENROL_TERMINAL_EVENTS)
  //     AND meta->>'connectionId' = $1
  //     AND meta->>'runId' = $2
  //
  // (Optimisation: maintain an in-process LRU of recently-closed runIds.)
  if (await isChainClosed(connectionId, runId)) {
    logger.info('ghl_enrol_page_drop_closed_chain', { connectionId, runId, pageIndex });
    return;
  }

  // Page-cap safety abort
  if (pageIndex >= MAX_GHL_PAGES_PER_RUN) {
    await emitEnrolPartial(connectionId, runId, pageIndex, 'PAGE_CAP_EXCEEDED', accumulator);
    return;  // chain closes here; no re-enqueue
  }

  // Fetch the page (opaque cursor passed through verbatim)
  const page = await fetchAgencyLocationsPage(connection, pageCursor, 50);

  // Empty-page early exit (fires regardless of cursor state)
  if (page.locations.length === 0) {
    await emitEnrolCompleted(connectionId, runId, pageIndex, accumulator, 'empty_page_early_exit');
    return;
  }

  // Per-location idempotent insert
  for (const loc of page.locations) {
    await upsertGhlSubaccount(connection.organisationId, loc);
    // INSERT ... ON CONFLICT (organisation_id, external_id)
    //   WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL
    //   DO NOTHING
  }
  await emitEnrolProgress(connectionId, runId, pageIndex, page.locations.length);

  // Re-enqueue or terminate
  if (page.nextCursor === null) {
    await emitEnrolCompleted(connectionId, runId, pageIndex, accumulator, 'all_pages_processed');
    return;
  }

  await enqueueNextPage({
    connectionId,
    runId,                       // preserved verbatim
    pageCursor: page.nextCursor, // opaque
    pageIndex: pageIndex + 1,
  });
}
```

**Singleton-key behaviour:**

```typescript
await pgboss.send(
  GHL_AUTO_ENROL_PAGE_QUEUE,
  payload,
  { singletonKey: `ghl-enrol:${payload.connectionId}` },  // NOT cursor-suffixed
);
```

**Drizzle schema change:**

```typescript
// server/db/schema/subaccounts.ts (additions)
externalIdNamespace: text('external_id_namespace'),
// In the index list at the bottom of the table builder:
ghlLocationUnique: uniqueIndex('subaccounts_org_external_ghl_location_idx')
  .on(table.organisationId, table.externalId)
  .where(sql`external_id_namespace = 'ghl_location' AND deleted_at IS NULL`),
```

**Dependencies:**

- A.3 (factory for all `oauth.enrol.*` events).
- A.1, A.2 (`AppError` for any internal errors thrown by the job; the job itself does NOT throw publicly — failures emit `enrolFailed`).

**Error handling:**

- Per-location ON CONFLICT short-circuits duplicates (no error).
- Auth-token revocation mid-page → emit `enrolFailed` with error context, no re-enqueue.
- GHL API 5xx → `withBackoff` retry budget exhausted → emit `enrolFailed`, no re-enqueue.
- Schema constraint violations not absorbed by ON CONFLICT (e.g. NOT NULL violation on a required column we missed) → emit `enrolFailed`.
- Page-cap exceeded → emit `enrolPartial` with `reason: 'PAGE_CAP_EXCEEDED'`, no re-enqueue.
- Crash mid-job → pg-boss releases singleton lock; subsequent worker may pick up via re-enqueue OR fresh dispatch; runId preserved across retries.

**Test surface:**

- `server/jobs/__tests__/ghlAutoEnrolLocationsPageJobPure.test.ts` — pure tests against a stubbed pg-boss + stubbed GHL API:
  - Empty-page early exit fires `enrolCompleted` regardless of cursor state.
  - Page-cap exceeded fires `enrolPartial` with `reason: 'PAGE_CAP_EXCEEDED'`.
  - Late retry against closed chain is dropped.
  - runId is preserved across re-enqueues.
  - Per-location ON CONFLICT short-circuits duplicates.
  - Crash mid-page → next worker resumes with same runId from payload.

- The job's `migrations/0285_*.sql` is verified by `npm run db:generate` (Drizzle re-emits migration; manual SQL is a deliberate write).

**Acceptance criteria:**

- New job is registered and runs.
- Singleton-key is `ghl-enrol:${connectionId}` (NOT cursor-suffixed).
- All four enrol events fire from the appropriate paths.
- Post-terminal silence: late retries are dropped.
- `isChainClosed()` is implemented against a shared `ENROL_TERMINAL_EVENTS` Set constant containing `auditEvent.oauth.enrolCompleted.name`, `auditEvent.oauth.enrolFailed.name`, `auditEvent.oauth.enrolPartial.name`. The same constant is referenced by the emitter call sites and by the closure-check reader. Verified by code inspection — adding a new terminal event must update the constant, not duplicate the list.
- Migration runs cleanly on a fresh DB and on a DB with existing GHL-enrolled rows (backfill verified).
- New partial-unique index created.
- Schema file updated with the column + index.

**Drizzle migration regen note:** Drizzle's migration generator MAY produce a slightly different SQL for the partial-unique index (e.g. it may not emit the WHERE clause depending on the Drizzle version). The migration file is hand-authored to ensure the predicate matches exactly. The schema change in `subaccounts.ts` SHOULD allow `npm run db:generate` to produce a comparable migration; if there's a delta, the hand-authored file wins (per spec §11 D.5).

#### D.6 — Advisory-lock scope verification

**Files to investigate (read-only first):** `server/services/workflowEngineService.ts:837-1924` (the `tick()` method).

**Finding (recorded in this plan):**

The current implementation at `workflowEngineService.ts:839` does:

```typescript
const lockResult = await db.execute(
  sql`SELECT pg_try_advisory_xact_lock(hashtext(${'workflow-run:' + runId})::bigint) AS got`
);
```

This is a `db.execute(...)` call, NOT inside a `db.transaction(...)` block. Postgres `pg_try_advisory_xact_lock` releases the lock at transaction end. Because `db.execute` runs in auto-commit mode, the SELECT auto-commits immediately and the lock is released immediately. The dispatch at line 1897 (`pgboss.send`) is far below — definitely not inside any transaction with the lock-holder.

**Conclusion:** the lock is effectively a no-op. The intended exclusion does not hold.

**Recommended fix (build-time decision per Open Question §8.2):**

Two options:

**Option A — wrap `tick()` in `db.transaction(...)`.** All DB reads/writes inside `tick()` use the same transaction; `pg_try_advisory_xact_lock` properly excludes concurrent runners. Trade-off: changes error-handling semantics — any throw inside `tick()` now rolls back ALL writes performed by the method. The current implementation has multiple writes that the operator may want to commit independently.

**Option B — switch to `pg_try_advisory_lock` (session-scoped) with explicit `pg_advisory_unlock` in `finally`.** Lock is held across auto-commits; explicit release. Trade-off: requires careful exception handling; `db.execute` is connection-pooled, so the SELECT and the UNLOCK might land on different physical connections (would need a single explicit-checkout session for the whole `tick()`).

**Recommendation: Option A.** It's the more idiomatic Postgres pattern; `pg_try_advisory_xact_lock` is designed for exactly this case (transaction-scoped exclusion). The error-handling change is auditable: today, the half-write states are ALSO problematic (a throw mid-tick leaves inconsistent state); wrapping in a transaction makes the failure mode "all-or-nothing", which is a strict improvement.

**Files to modify (assuming Option A):**

- `server/services/workflowEngineService.ts` — wrap the body of `tick()` in `db.transaction(async (tx) => { ... })`. Replace `db.execute(...)` with `tx.execute(...)` throughout. The pgboss.send at line 1897 stays inside the transaction; if the transaction rolls back, the queued job is rolled back too (this is the desired "split-brain" prevention property).
- `KNOWLEDGE.md` — entry documenting the AR-3.1 finding and the chosen fix.
- `architecture.md § <relevant section>` — note the pattern for future workflow-engine changes.

**Invariant (load-bearing — document inline at the top of the wrapped `tick()` body):**

> **No external side effects before enqueue inside `tick()`.** Every effect that must NOT happen if the transaction rolls back lives inside the `db.transaction(async (tx) => { ... })` block. The `pgboss.send(...)` dispatch is the canonical example: it is performed inside the transaction so that a rollback also un-enqueues the job (pg-boss writes job rows to its own tables in the same transaction, so the job dispatch is part of the same atomic unit). Any HTTP call, external-API call, or other side effect that cannot be transactionally rolled back MUST happen AFTER the transaction commits — or, if it must run inside the lock window, it must be idempotent and safe to repeat after a crash.
>
> Why this matters: Option A's split-brain prevention relies on dispatch-and-DB being one atomic unit. Adding a side effect that fires before enqueue but after a partial DB write would re-introduce the very split-brain we deleted. This invariant is the contract that makes Option A correct; future tick() edits must preserve it.

**Structural enforcement — `EXTERNAL SIDE EFFECTS` section marker:**

The invariant above is a contributor-discipline rule. Without a structural cue, future contributors will accidentally land non-transactional side effects inside the transaction body. The cheapest enforcement is a clearly-named comment-block marker placed AFTER the `db.transaction(async (tx) => { ... })` body, separating "transactional work" from "post-commit work":

```typescript
async function tick() {
  return await db.transaction(async (tx) => {
    // ============================================================
    // INVARIANT: No external side effects before enqueue.
    // Every effect inside this transaction MUST be transactionally
    // safe (DB reads/writes via tx, pg-boss dispatch via the
    // boss instance bound to tx). HTTP calls, external APIs, file
    // I/O, anything that cannot roll back — DO NOT add them here.
    // ============================================================

    // ... transactional work: lock acquisition, due-work claim,
    //     DB reads/writes via tx, pg-boss dispatch ...
  });

  // ============================================================
  // EXTERNAL SIDE EFFECTS (must run AFTER transaction commit)
  // ============================================================
  // Anything that cannot be transactionally rolled back lands
  // BELOW this line. If a side effect must observe state from the
  // transaction, capture the state into local vars inside the tx
  // callback's return value and consume it here.
  // ============================================================

  // ... post-commit work, if any ...
}
```

Why a comment marker rather than a runtime guard: a runtime variable (e.g. a `hasExternalSideEffects` flag mutated by a `markExternalEffect()` helper, throwing before commit) was considered. Rejected — it adds runtime weight to enforce a static contributor-discipline rule, and contributors who don't know the rule won't know to call `markExternalEffect()` either. The structural marker addresses the exact failure mode (a contributor pasting `await fetch(...)` mid-transaction): a reviewer or the contributor themselves sees the marker and knows where the boundary is. Cheap, durable, no runtime cost.

The builder adds BOTH the invariant docstring AND the `EXTERNAL SIDE EFFECTS` section marker as code comments in the same commit. The marker is REQUIRED — not optional — even if `tick()` ships with no post-commit work today; it pre-positions the contract for any future addition.

**Dependencies:** None mechanically (no Chunk A types used). Conceptually depends on §5.4 (emit-then-throw) only if any new audit events are added — not required by D.6.

**Error handling:** if the transaction rolls back, the workflow run stays in its prior state. The advisory lock is auto-released. No new error codes needed (existing throw shapes stay).

**Test surface:**

- `server/services/__tests__/workflowEngineServicePure.test.ts` — pure test that asserts the lock + dispatch + writes all run under the same transaction handle. Stub pg-boss; verify the dispatch is inside the same `tx` callback as the lock check.
- (No integration test — out of scope per spec §16.)

**Acceptance criteria:**

- The lock acquisition and the pg-boss dispatch are inside the same transaction (verified by code inspection + targeted test).
- The "no external side effects before enqueue" invariant is documented as a code comment at the top of the wrapped `tick()` body and verified by code inspection.
- An `EXTERNAL SIDE EFFECTS (must run AFTER transaction commit)` comment-block marker is present in the file, placed AFTER the `db.transaction(...)` block, separating transactional work from post-commit work. Required even if no post-commit work ships today — pre-positions the contract for future additions. Verified by code inspection.
- KNOWLEDGE.md entry shipped in the same commit.
- architecture.md updated.

#### Chunk D — verification commands (G1 gate)

```
npm run lint
npm run typecheck
npm run db:generate     # verify migration emits without unexpected diff
npx tsx server/lib/__tests__/rateLimitKeysPure.test.ts
npx tsx server/services/__tests__/securityAuditServicePure.test.ts
npx tsx server/services/__tests__/connectionTokenServicePure.test.ts
npx tsx server/jobs/__tests__/ghlAutoEnrolLocationsPageJobPure.test.ts
npx tsx server/services/__tests__/workflowEngineServicePure.test.ts
```

Run only the tests authored in this chunk. The whole-repo test suite runs in CI.

---

### Chunk E — Cleanup and convenience

**Source-of-finding:** R1-6 (E.1), R2-2 (E.2), R2-3 (E.3), Phase-1 residue (E.4), Phase-1 residue + KNOWLEDGE.md gotcha (E.5), REQ #15 (E.6), REQ #29 (E.7).

**Scope:** Seven independent cleanup items. Most are low-risk; E.5 and E.6 are the largest.

#### E.1 — `isActive` / `assertActive` generic narrowing

**Files to modify:** `server/lib/queryHelpers.ts`

**Contract:**

```typescript
import { isNull, type AnyColumn } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

// Narrow: T must be a Drizzle table with a `deletedAt` column.
type SoftDeletableTable = PgTable & { deletedAt: AnyColumn };

export function isActive<T extends SoftDeletableTable>(table: T): SQL<unknown> {
  return isNull(table.deletedAt);
}

export function assertActive<T extends { id: string; deletedAt: unknown }>(
  entity: T | null | undefined,
  entityType: string,
): asserts entity is T & { deletedAt: null } {
  // (existing logic — no change)
}
```

**Note:** the spec says "narrow to Drizzle table types". `assertActive` operates on row-shaped objects (entities), not tables; its current generic `<T extends { id: string; deletedAt: unknown }>` is already narrow. Only `isActive` needs the narrowing. Build session may keep `assertActive` as-is or further narrow `deletedAt` from `unknown` to `Date | null` — small judgement call; recommendation is to leave row-side as-is (the table-side narrowing is the spec's intent).

**Dependencies:** None.

**Error handling:** N/A — type-system change only.

**Test surface:** typecheck is the gate. No new tests authored.

**Acceptance criteria:**

- `isActive` rejects passing a non-table, non-`deletedAt` object (compile error).
- All existing call sites continue to compile.
- B.1 grep gate (Chunk B) passes.

#### E.2 — `logAndSwallow` severity tagging

**Files to modify:**
- `client/src/lib/silentCatchHelper.ts` — accept `severity` param
- 8+ critical-tier client files (enumerated in spec §11 E.2)

**Contract:**

```typescript
// client/src/lib/silentCatchHelper.ts

export interface LogAndSwallowOptions {
  severity?: 'critical' | 'noisy';
  context?: string;
}

export function logAndSwallow(err: unknown, opts: LogAndSwallowOptions = { severity: 'noisy' }) {
  const message = err instanceof Error ? err.message : String(err);
  console.debug('[silent-catch]', message, opts.context);

  if (opts.severity === 'critical') {
    // Best-effort POST to /api/client-errors. Failures are themselves swallowed.
    fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        componentStack: err instanceof Error ? err.stack : undefined,
        url: window.location.href,
        userAgent: navigator.userAgent,
      }),
    }).catch(() => { /* swallow */ });
  }
}
```

**Critical-tier call sites (per spec §11 E.2):**

- `client/src/pages/AdminAgentEditPage.tsx` — agent save catch
- `client/src/pages/SystemOrganisationsPage.tsx` — org-load catch
- `client/src/pages/SystemIncidentsPage.tsx` — incident-load catch
- `client/src/pages/OnboardingWizardPage.tsx` — wizard step catch
- `client/src/pages/SptOnboardingPage.tsx` — SPT step catch
- `client/src/components/Layout.tsx` — top-level error boundary fallback
- `client/src/App.tsx` — auth-token refresh catch
- `client/src/hooks/useConversation.ts` — websocket failure catch

Each call site updated to `logAndSwallow(err, { severity: 'critical', context: '<descriptive>' })`. All other 11 call sites stay default (noisy).

**Dependencies:** None mechanically. Conceptually depends on E.3 landing the dedupe (otherwise high-volume critical posts could overwhelm the existing rate-limiter). E.2 and E.3 land in the same commit.

**Error handling:** the `fetch` is fire-and-forget; `.catch(() => {})` swallows failures. Existing `console.debug` always fires.

**Test surface:**

- `client/src/lib/__tests__/silentCatchHelperPure.test.ts` — pure tests for the helper:
  - Default severity is `'noisy'`; no `fetch` call.
  - Severity `'critical'` invokes `fetch` with the expected body.
  - `fetch` rejection is swallowed.

**Acceptance criteria:**

- 8 critical-tier sites tagged.
- 11 other sites stay default.
- No call site exceeds the ≤10 cap (build-time review may upgrade ≤2 more).

#### E.3 — `/api/client-errors` LRU dedupe

**Files to modify:** `server/routes/clientErrors.ts`

**Contract:**

```typescript
import crypto from 'crypto';

// In-memory LRU. Process-bound; resets on restart. Best-effort dedupe only.
class LruDedupe {
  private map = new Map<string, number>();  // key -> firstSeenMs
  constructor(private capacity: number, private windowMs: number) {}

  shouldEmit(key: string): boolean {
    const now = Date.now();
    const seen = this.map.get(key);
    if (seen !== undefined && now - seen < this.windowMs) {
      // refresh recency
      this.map.delete(key);
      this.map.set(key, seen);
      return false;
    }
    if (this.map.size >= this.capacity) {
      // evict oldest entry (first key in Map insertion order)
      const oldest = this.map.keys().next().value;
      if (oldest) this.map.delete(oldest);
    }
    this.map.set(key, now);
    return true;
  }
}

const dedupe = new LruDedupe(1000, 60_000);

router.post(
  '/api/client-errors',
  authenticate,
  asyncHandler(async (req, res) => {
    const rl = await rateLimitCheck(rateLimitKeys.clientError(req.user!.id), 30, 300);
    if (!rl.allowed) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    const body = ClientErrorBody.parse(req.body);
    const hash = crypto
      .createHash('sha256')
      .update(`${body.message}\n${body.componentStack ?? ''}`)
      .digest('hex');  // 64 hex chars / 256 bits

    if (!dedupe.shouldEmit(hash)) {
      res.status(204).end();  // duplicate within window
      return;
    }

    logger.warn('client_render_error', {
      organisationId: req.user!.organisationId,
      userId: req.user!.id,
      message: body.message,
      url: body.url,
      userAgent: body.userAgent,
    });
    res.status(204).end();
  })
);
```

**Note (LOCKED):** The dedupe runs AFTER the rate-limit check. Final ordering rule: **rate-limit FIRST, then dedupe** (operator-approved §8.7; reaffirmed Round 1 plan-review).

**Layering rationale (canonical statement):**

- **Rate limit is the protection layer** — defends the server from DoS; bounded by `userId` so one bad actor cannot starve others.
- **Dedupe is the observability optimisation layer** — reduces log-stream noise; bounded by `(message, stack)` hash so identical bursts collapse to one entry.

Different concerns, different keys, different purposes. Rate limit always runs first; dedupe always runs second. Any future change that inverts this order is a blocking finding.

Spec §7.6's "before rate-limit" phrasing is a slight wording tension; the locked posture above takes precedence. Doc-sync at Phase 3 finalisation will reconcile spec §7.6 wording (non-blocking for build).

**Dependencies:** None.

**Error handling:** standard route layer. No new error codes.

**Test surface:**

- `server/routes/__tests__/clientErrorsLruPure.test.ts` — pure tests for the LRU class:
  - First emit returns true.
  - Second emit within window returns false.
  - After window expires, emit returns true.
  - Capacity-eviction works (insert capacity+1, oldest evicted).
  - Hash uses full 64 hex chars.

**Acceptance criteria:**

- LRU is process-local, capacity 1000, window 60s.
- Hash is SHA-256 (256 bits / 64 hex chars).
- Duplicates within window return 204 without log emission.
- After restart, dedupe resets (process-bound, intentional).

#### E.4 — Migration `0277` header comment

**Files to modify:** `migrations/0277_oauth_state_nonces.sql`

**Contract:** add at the very top of the file (above any existing SQL):

```sql
-- system-scoped: pre-auth OAuth state, no organisation_id available pre-callback
```

The migration version is NOT bumped (in-file comment edit only). The `rls-not-applicable-allowlist.txt` allowlisting stays in place.

**Dependencies:** None.

**Error handling:** N/A.

**Test surface:** None — comment-only change. `npm run db:generate` is NOT re-run because the migration content is unchanged at the SQL level.

**Acceptance criteria:**

- Comment is on line 1 of `0277_oauth_state_nonces.sql`.
- File checksum updated if the migration system uses checksums (verify at build time — most Drizzle setups don't).

#### E.5 — `withOrgTx({ tx: db })` refactor + `setOrgGUC` helper

**Files to modify:**
- `server/instrumentation.ts` (per §5.8 — NOT `server/middleware/orgScoping.ts`) — add `setOrgGUC(tx, orgId)` helper alongside `withOrgTx`
- `server/routes/oauthIntegrations.ts` — replace the `withOrgTx({ tx: db })` pattern with a real `db.transaction(...)` + `setOrgGUC` wrapper
- `KNOWLEDGE.md` — refresh the existing entry pointing at the now-canonical `setOrgGUC`

**Contract:**

```typescript
// server/instrumentation.ts (addition)

import { sql } from 'drizzle-orm';
import type { OrgScopedTx } from './db/index.js';

/**
 * Sets `app.organisation_id` GUC on the given transaction handle.
 * Co-locates with `withOrgTx` because both deal with org-scoped tx setup.
 * Use inside a `db.transaction(async (tx) => { ... })` block when the tx is
 * created locally (e.g. in OAuth callback, where no auth middleware has set
 * the GUC).
 */
export async function setOrgGUC(tx: OrgScopedTx, orgId: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.organisation_id', ${orgId}, true)`);
}
```

**`oauthIntegrations.ts` change (line 432–446):**

```typescript
// Before:
await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.organisation_id', ${ghlOrgId}, true)`);
  await withOrgTx(
    { tx, organisationId: ghlOrgId, source: 'oauth:callback:ghl:enrol' },
    () => Promise.race([ ... ]),
  );
});

// After (using new helper):
await db.transaction(async (tx) => {
  await setOrgGUC(tx, ghlOrgId);
  await withOrgTx(
    { tx, organisationId: ghlOrgId, source: 'oauth:callback:ghl:enrol' },
    () => Promise.race([ ... ]),
  );
});
```

The change is small (one line) but the new helper makes the pattern grep-able and self-documenting.

**KNOWLEDGE.md refresh:** locate the existing `withOrgTx({tx:db})` gotcha entry. Update to reference `setOrgGUC` as the canonical helper and link to its location.

**Dependencies:** None.

**Error handling:** N/A.

**Test surface:**

- `server/__tests__/setOrgGUCPure.test.ts` — verify the helper executes the expected SQL (stub `tx.execute`, assert the SQL string contains `set_config('app.organisation_id', ...)`).

**Acceptance criteria:**

- `setOrgGUC` exported from `server/instrumentation.ts`.
- The OAuth callback uses it.
- KNOWLEDGE.md entry refreshed (existing gotcha entry, not a new one).

#### E.6 — REQ #15 skill-envelope CI gate

**Files to create:**
- `scripts/verify-skill-error-envelope.sh`
- `scripts/fixtures/verify-skill-error-envelope/known-bad.ts`

**Contract:** grep gate enforcing the flat-string envelope shape per the C4a-6-RETSHAPE contract:

- In-scope paths: `server/skills/**/*.ts`, `server/tools/**/*.ts`, `server/services/skillExecutor.ts` (`SKILL_HANDLERS`).
- Out-of-scope (allowlisted): `server/services/connectorConfigService.ts`, `server/services/ghlAgencyOauthService.ts`, `server/services/locationTokenService.ts` (these emit event payloads, not skill envelopes).

Every `return` path in in-scope files must match `{ ok: true, ... } | { ok: false, error: string, errorCode?: string }`. Mixed-shape allowlist declared inline in the gate script.

**Implementation strategy:**

- Pattern 1: any `return { ok: false, error:` followed by a non-string (e.g. an object). Trip if `error: {` appears.
- Pattern 2: any `return { ok: true, ... }` is allowed (no check on success-shape diversity).
- Pattern 3: any return that doesn't include `ok:` at all is suspect — flag for review.

**Dependencies:** None.

**Error handling:** gate exits 1 with `verify-skill-error-envelope.sh: skill envelope shape violation at <file:line>`.

**Test surface:**

- Known-bad fixture: a skill handler with `return { ok: false, error: { message: 'X' } }` — trips.

**Acceptance criteria:**

- Gate trips on known-bad.
- Gate is silent on current `main` (verify by build-time run; if it trips, fix or allowlist each violation explicitly).
- Wired into CI alongside other gates.

#### E.7 — REQ #29 SC-COVERAGE-BASELINE capture

**Files to modify:** `tasks/builds/pre-launch-phase-3-deferred-backlog/progress.md` — add the captured baseline numbers under a new section.

**Contract:** operator action, not code. After the first CI run on `claude/pre-launch-phase-3` post-build, the operator copies the baseline numbers from the CI output into `progress.md`. This is documentation work, not implementation.

**Dependencies:** Phase 2 build complete + first CI push.

**Error handling:** N/A.

**Test surface:** N/A.

**Acceptance criteria:**

- `progress.md` has a "SC-COVERAGE-BASELINE" section with the actual numbers from CI.
- The numbers are not placeholders.

#### E.8 — REQ #4 mini-spec amendment

**Files to modify:** `docs/pre-launch-hardening-mini-spec.md`

**Contract:** one-line edit in the REQ #4 done-criteria section: replace "integration tests" with "pure-function tests" (or add a note: "pure-function tests are canonical per `feedback_unit-tests-mid-build`; integration tests permanently deferred"). Exact wording is build-time decision.

**Dependencies:** None.

**Error handling:** N/A.

**Test surface:** N/A.

**Acceptance criteria:**

- The REQ #4 entry no longer says "integration tests".
- Operator memory `feedback_unit-tests-mid-build` is referenced.

#### Chunk E — verification commands (G1 gate)

```
npm run lint
npm run typecheck
npm run build:client    # E.2 touches client code
npx tsx client/src/lib/__tests__/silentCatchHelperPure.test.ts
npx tsx server/routes/__tests__/clientErrorsLruPure.test.ts
npx tsx server/__tests__/setOrgGUCPure.test.ts
bash scripts/verify-skill-error-envelope.sh scripts/fixtures/verify-skill-error-envelope/known-bad.ts  # expect exit 1
bash scripts/verify-skill-error-envelope.sh   # expect exit 0 on full repo
```

---

## 7. Risks and unknowns

### 7.1 Advisory-lock fix has wider blast radius than the spec implies (D.6)

**Risk:** Wrapping `tick()` in `db.transaction(...)` changes failure semantics across the workflow engine. Today, partial writes can commit independently; tomorrow, they roll back together. Subtle bugs may surface (a write that today is committed before a throw becomes uncommitted).

**Mitigation:** Pure test in D.6 covers the new transaction boundary. Build session reads `tick()` in full before the wrap; any nested `db.transaction(...)` calls inside the method get unwrapped (Postgres doesn't support true nested transactions; nested calls become savepoints, but Drizzle may not handle that gracefully). Recommendation: budget extra time for D.6 review.

### 7.2 D.5 migration backfill assumes `connector_configs.provider_type = 'ghl'` is stable

**Risk:** The backfill UPDATE in `0285_subaccounts_external_id_namespace.sql` relies on joining to `connector_configs` where `provider_type = 'ghl'`. If the provider_type string differs (e.g. `'gohighlevel'`, `'ghl_agency'`), the backfill misses rows. Those missed rows lose the partial-unique guard and could produce duplicate inserts post-launch.

**Mitigation:** The migration ships with a pre-flight `DO $$ ... RAISE EXCEPTION` guard at the top that fails the migration if no `provider_type = 'ghl'` row exists in `connector_configs` (Round 1 plan-review addition). This converts a silent partial backfill into a loud migration failure. Build session verifies the actual `provider_type` value at build time via `git grep "provider_type.*ghl" server/db/`; if the string differs, the guard AND the WHERE clause are updated together. There are no live agencies pre-launch, so backfill correctness can be verified against the staging DB before merge.

### 7.3 OAuth state consume atomicity (C.1) — RESOLVED via CTE + always-return-row

**Resolution (Round 1 plan-review, 2026-05-05; refined Round 2, 2026-05-05):** Adopt the single-query CTE pattern in §6 C.1. The CTE classifies the nonce (not-found / expired / consumed) and conditionally DELETEs only when `expires_at > now()` — all in one statement. This eliminates the TOCTOU window that a SELECT-then-DELETE would have. Round 2 added a `UNION ALL` synthetic-row branch so the query returns exactly one row regardless of whether the nonce matched, unifying the caller's classification surface (the row carries `was_consumed` / `was_expired` / `was_not_found`; the caller never has to interpret "no rows" as "not found").

**Residual risk:** none — the CTE is atomic and the always-return-row guarantee makes the classification logic uniform. ADR-0006's single-writer constraint is preserved; the CTE is purely an in-statement correctness improvement.

### 7.4 `oauth_state_nonces.created_at` may not exist (C.1 latency)

**Risk:** The `latencyMs = consumedAt - issuedAt` calculation depends on `created_at` being available on the row. The schema may not store it.

**Mitigation:** Derive `issuedAt = expires_at - TTL_MS` if `created_at` is absent. This is exact (TTL is constant 5min). If `expires_at` is also absent, the build adds a column in the same migration as D.5 (`0285_*.sql`) — but verify first; the ADR-0006 doc and migration `0277` both reference the schema so a quick read clarifies.

### 7.5 LRU dedupe order (E.3) — RESOLVED

**Resolution (operator-approved §8.7; reaffirmed Round 1 plan-review):** rate-limit FIRST, then dedupe. Layering rationale locked: rate limit is the protection layer (DoS defence, keyed by userId); dedupe is the observability optimisation layer (log-stream noise reduction, keyed by message+stack hash). Any inversion of this order is a blocking finding. Spec §7.6 wording reconciled at Phase 3 finalisation doc-sync.

**Residual risk:** none — order is locked.

### 7.6 Skill-envelope gate may surface unexpected violations (E.6)

**Risk:** REQ #15 says current shapes are "mixed" across `connectorConfigService.ts`, `ghlAgencyOauthService.ts`, `locationTokenService.ts`, `skillExecutor.ts`. The first three are out-of-scope (event-payload services), but `skillExecutor.ts` IS in-scope and may have a non-conforming return path. The build session may need to fix violations or allowlist them.

**Mitigation:** Build session runs the gate on current `main` before merging Chunk E. Each violation either gets fixed (preferred — small diff) or added to the allowlist with a documented reason.

### 7.7 ~30 audit-event call-site rename pass (A.4) — count is approximate

**Risk:** The spec estimates ~30 sites. Actual count from `git grep -c "recordSecurityEvent\|securityAuditService.recordEvent"` could be higher. Larger PRs are harder to review.

**Mitigation:** Count is mechanical; build session enumerates exact list at start of A.4 and reports back. If the count exceeds 50, consider splitting A.4 into two commits within the same PR.

### 7.8 Critical-tier client error volume (E.2 + E.3)

**Risk:** Tagging 8 sites as `'critical'` could spike `/api/client-errors` traffic during an incident (e.g. API outage cascading into 8 different critical catches per page load). The 30/300s rate limit + 1000-entry LRU absorbs typical bursts but a 1000+ unique-error storm overwhelms both.

**Mitigation:** Pre-launch only — no live users. If post-launch monitoring shows storm patterns, reduce the critical tier. Plan documents this as a known-acceptable risk.

### 7.9 `feature-coordinator` cannot run inline in this Web session (handoff §11)

**Risk:** The handoff already noted that feature-coordinator's sub-agent invocations are unavailable in Claude Code on the web. This plan is the architect output; the operator must dispatch builders manually OR move to a Claude Code CLI session for Phase 2 build.

**Mitigation:** Plan is structured so each chunk can be built by a Sonnet builder via direct prompt OR by the feature-coordinator's auto-invocation in CLI. No dependency on feature-coordinator-specific behaviour.

---

## 8. Open questions for operator — RESOLVED 2026-05-06

All 7 questions decided. Operator (non-technical) ratified the architect's recommendation on each item; rationale chain documented per question below. Build can dispatch.

**Decisions log (one-line summary):**

| # | Topic | Decision |
|---|-------|----------|
| 8.1 | `AppErrorCode` seed-set scope | Minimum-viable seed (asyncHandler legacy codes + multi-call-site codes); single-throw codes deferred to Phase 4 |
| 8.2 | D.6 advisory-lock fix path | Option A — wrap `tick()` body in `db.transaction(...)` |
| 8.3 | `getCurrentPrincipalOrgId` API | New helper returning `string \| null \| undefined`; add `withSystemFlowPrincipal(fn)` sibling wrapper |
| 8.4 | `data.*` and `job.*` namespaces in factory | Include both as namespaces in the factory; `audit` namespace stays empty per spec |
| 8.5 | `server/config/` directory | Create new directory; `MAX_WORKFLOW_RUN_DEPTH` migration deferred to Phase 4 |
| 8.6 | `setOrgGUC` location | Co-locate with `withOrgTx` in `server/instrumentation.ts` |
| 8.7 | LRU dedupe vs rate-limit ordering | Rate-limit FIRST, then dedupe |

Detailed reasoning per question follows.

### 8.1 — `AppErrorCode` seed-set scope (Chunk A.1)

**DECISION (operator-approved 2026-05-06):** Approve minimum-viable seed-set. Build session enumerates from `asyncHandler.ts`'s legacy branch + any error code with ≥2 call sites. Single-throw codes deferred to Phase 4 cleanup.

**Question:** Which existing error codes should be migrated into the typed `AppErrorCode` union? The spec §17 says "Architect to enumerate from `git grep \"errorCode:\" server/`". A first-pass enumeration is needed.

**Recommendation:** Seed with the codes currently used in `asyncHandler.ts`'s legacy branch + any code that already has multiple call sites (low-friction migration). Skip one-off codes (single throw site) — they migrate as part of the Phase 4 sweep.

**Rationale:** Migrating every code in one pass would expand A.1 beyond the foundation chunk; minimum-viable seed-set keeps A.1 small and lets D.3 throw `MISSING_PRINCIPAL_CONTEXT` and `CROSS_TENANT_TOKEN_REFRESH` cleanly. Phase 4 backfill handles the rest.

### 8.2 — D.6 advisory-lock fix path (Chunk D.6)

**DECISION (operator-approved 2026-05-06):** Approve Option A — wrap `tick()` body in `db.transaction(...)`. Build session reads `tick()` end-to-end before wrapping; documents any nested transactions and unwinds them as savepoints if needed. This is flagged as the highest-risk chunk in §7.1 — budget extra review time.

**Question:** The current `pg_try_advisory_xact_lock` is on a `db.execute(...)` call — auto-commits and releases the lock immediately. Two fixes:

- **Option A:** wrap `tick()` in `db.transaction(...)`. All writes become atomic; advisory lock holds for the whole method.
- **Option B:** switch to `pg_try_advisory_lock` (session-scoped) with explicit unlock in `finally`.

**Recommendation: Option A.** It is the idiomatic Postgres pattern; `pg_try_advisory_xact_lock` exists exactly for this case. Half-write states are also problematic today (a throw mid-`tick()` already leaves inconsistent state), so wrapping in a transaction is a strict improvement.

**Rationale:** Option B requires careful session management (the lock and the unlock must run on the same physical connection — Drizzle's pool may not preserve this without an explicit `client.checkout()` pattern). Option A is simpler and more correct.

### 8.3 — `getCurrentPrincipalOrgId` helper API (Chunk D.3)

**DECISION (operator-approved 2026-05-06):** Approve the helper signature `getCurrentPrincipalOrgId(): string | null | undefined` and the sibling `withSystemFlowPrincipal(fn)` wrapper as drafted below. Existing `withSystemPrincipal` callers unchanged.

**Question:** Spec D.3 requires `principalOrgId === undefined` (no ALS) to be distinguishable from `principalOrgId === null` (system-flow). Current `getCurrentPrincipal()` returns `PrincipalContext | null` — collapses both states.

**Recommendation:** Add a new helper to `server/services/principal/systemPrincipal.ts`:

```typescript
export function getCurrentPrincipalOrgId(): string | null | undefined {
  const store = als.getStore();
  if (!store) return undefined;          // ALS scope absent
  return store.principal.organisationId;  // string OR null (caller's choice)
}
```

To set the explicit-null sentinel, add a sibling wrapper `withSystemFlowPrincipal(fn)` that runs `fn` inside `als.run({ principal: { ...systemPrincipal, organisationId: null } }, fn)`. Existing `withSystemPrincipal` paths default to a real org ID — they don't need to change.

**Rationale:** Smallest surface change; preserves all existing callers; gives D.3 the three-way distinction the spec needs.

### 8.4 — `data.*` and `job.*` namespaces in the audit-event factory (Chunk A.3)

**DECISION (operator-approved 2026-05-06):** Approve adding `data` and `job` namespaces to the factory as a full superset of existing wire events. `audit` namespace stays empty per spec (reserved). No wire-format changes — every existing event name preserved verbatim.

**Question:** Spec §6 + §11 A.3 names four namespaces (`auth`, `oauth`, `security`, `audit`). The existing `SecurityEventType` union has events in `data.*` and `job.*` too (`data.config_changed`, `data.scope_drift_detected`, `job.partial_failure`). The factory MUST cover all existing event names (the rename pass A.4 must not lose any — wire format strings stay verbatim).

**Recommendation:** Add `data` and `job` namespaces to the factory explicitly (this plan §6 Chunk A.3 contract reflects this). The `audit` namespace stays empty per spec (reserved).

**Rationale:** The spec listed four namespaces because those are the ones gaining new events in Phase 3. The factory must be a full superset to prevent rename-pass orphans. Spec wording was a slight oversight; adding two more namespaces is mechanical and on-spec-intent.

### 8.5 — `server/config/systemLimits.ts` directory creation (§5.9)

**DECISION (operator-approved 2026-05-06):** Approve creating `server/config/` directory. `MAX_WORKFLOW_RUN_DEPTH` migration into the new directory is deferred to Phase 4 — out of scope for Phase 3.

**Question:** Spec §6 names the new file at `server/config/systemLimits.ts`. The `server/config/` directory does NOT exist.

**Recommendation:** Create `server/config/` as the canonical home for system-wide caps. `MAX_WORKFLOW_RUN_DEPTH` (currently in `server/lib/runDepthGuard.ts`) can move into it in a separate Phase 4 cleanup — out of Phase 3 scope.

**Rationale:** New directory is small; matches spec §6 verbatim; separates "system-wide configuration constants" from `lib/` (which is for code-shaped helpers).

### 8.6 — `setOrgGUC` location (§5.8)

**DECISION (operator-approved 2026-05-06):** Approve co-locating `setOrgGUC` with `withOrgTx` in `server/instrumentation.ts`. No new file. Spec §15 path reference (`server/middleware/orgScoping.ts`) is corrected during the build.

**Question:** Spec §15 names the helper at `server/middleware/orgScoping.ts`. That file does NOT exist; `withOrgTx` lives in `server/instrumentation.ts`.

**Recommendation:** Co-locate `setOrgGUC` with `withOrgTx` in `server/instrumentation.ts`. Avoid creating a new file with one helper.

**Rationale:** Keeps related helpers grouped; preserves the existing pattern; avoids a single-export new file.

### 8.7 — LRU dedupe vs rate-limit ordering (§7.5 risk + Chunk E.3)

**DECISION (operator-approved 2026-05-06):** Approve rate-limit FIRST, then dedupe. E.3 pseudocode stands. Spec §7.6 wording will be reconciled during doc-sync at Phase 3 finalisation (note added to spec margin or via supplemental clarification — non-blocking for build).

**Question:** Spec §7.6 phrasing implies dedupe-before-rate-limit; recommended pseudocode in E.3 is rate-limit-first.

**Recommendation:** rate-limit first (as in E.3 pseudocode). The rate-limit protects the server from DoS; the dedupe protects the log stream from noise. Different concerns; rate-limit takes precedence.

**Rationale:** A flood of unique errors from one user under dedupe-first would not be throttled, defeating the rate-limit's purpose.

---

## 9. Self-consistency pass

| Question | Verdict |
|----------|---------|
| Goals (close 24 deferred items) match implementation (Chunks A–E + 4 explicit verdicts)? | yes — every item from spec §11 + §13 is named in this plan |
| Single-source-of-truth claims survive? | yes: `AppError` is the canonical typed error; `auditEvent` factory is the canonical event-name source; `MAX_GHL_LOCATIONS_TO_ENROL` / `MAX_GHL_PAGES_PER_RUN` are the canonical caps; `NormalisedEmail` brand is the canonical RL key constructor — all preserved |
| Non-functional claims match execution model? | yes — no latency/throughput claims; cardinality budgets bounded; D.5 explicitly async via pg-boss |
| Every "must" / "guarantees" backed by mechanism? | yes — A.4 rename pass gated by B.4; assertActive adoption gated by B.1; raw-console gated by B.2; brand bypass gated by B.3 + type system; skill-envelope gated by E.6 |
| File inventory is complete? | yes — every file in spec §15 is named in §6 of this plan; two filesystem-anomaly resolutions documented in §5.8 + §5.9 |
| Forward-only chunk dependencies? | yes — verified in §4; A → B/C/D; E independent; no later chunk referenced by an earlier one |
| Spec ambiguities flagged? | yes — 7 open questions in §8, spec interpretations annotated in §5.7, §5.8, §5.9, §6 D.5 backfill, §6 C.1 two-phase consume |
| Tests authored within plan, not run via whole-repo gates? | yes — all test runs use `npx tsx <single-file>`; G1 gate per chunk lists only lint, typecheck, and targeted tests authored in that chunk |

**One internal tension surfaced:** §5.7 notes the parallel narrow Phase 3 spec on three overlapping items. Plan does NOT redesign those three items to match the narrow spec (the locked spec is canonical). If the narrow spec lands first, our chunks affected (C.2, D.1) will need a rebase but no semantic redesign — both versions of those items implement the same audit + RL behaviour; only the scope wording differs.

**One spec-interpretation gap surfaced:** §6 Chunk A.3 — the spec did not list the existing `data.*` and `job.*` events. Plan resolves by including them in the factory (Open Question §8.4). This preserves wire-format compatibility.

---

## 10. Doc-sync footprint (carry-forward from spec §10)

Builders must update these in the same commit as their chunk:

| Doc | Chunk | Update |
|-----|-------|--------|
| `architecture.md § Layer 4` | A.5, C.4 | Reference factory + telemetry |
| `docs/security-audit-namespace.md` (NEW) | A.5 | Convention doc — four namespaces + severity classifier + supersedes-event correction |
| `docs/oauth-state-telemetry.md` (NEW) | C.4 | Telemetry doc — four `oauth.state.*` events + post-launch TTL revert decision criteria |
| `KNOWLEDGE.md` | E.5 | Refresh `withOrgTx({tx:db})` gotcha → reference `setOrgGUC` |
| `KNOWLEDGE.md` | D.6 | Add entry for advisory-lock fix (AR-3.1) |
| `architecture.md § <workflow engine>` | D.6 | Note the advisory-lock + transaction pattern |
| `DEVELOPMENT_GUIDELINES.md § 8` | A.5 | One-line entry for the DESC-DESC ordering invariant |
| `docs/pre-launch-hardening-mini-spec.md` | E.8 | REQ #4 amendment (pure-function tests are canonical) |
| `tasks/builds/pre-launch-phase-3-deferred-backlog/progress.md` | E.7 | SC-COVERAGE-BASELINE numbers (operator action post-CI) |
| `docs/spec-context.md § accepted_primitives` | (cross-cutting) | Extended by feature-coordinator doc-sync at PR finalisation |

---

## 11. Executor notes (test-gate posture)

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

The above paragraph is the operator's locked posture per CLAUDE.md and `references/test-gate-policy.md`. Builders consuming this plan must NOT add gate runs to their TodoWrite lists or their commit checklists. Each chunk's "verification commands" subsection lists only:

- `npm run lint`
- `npm run typecheck`
- `npm run build:server` / `npm run build:client` when touching the build surface
- Targeted single-file unit tests authored within the chunk via `npx tsx <path>`
- Targeted execution of NEW gate scripts authored within the chunk against their fixture files (B.1–B.4, E.6 only)

CI runs the full battery on PR open. If a chunk's correctness depends on a gate-level invariant, the chunk authors a unit test for that invariant; CI proves nothing else regressed.

**Pre-existing violations.** The plan flags one suspected pre-existing-pattern issue: D.6 advisory-lock scope. This is fixed in Chunk D.6 itself (not a separate "fix-before-build" step). No "run gates to baseline" step appears anywhere in this plan.

**Mid-build verification** is `npx tsc --noEmit` (or `npm run typecheck`) per operator preference (`feedback_unit-tests-mid-build` memory). Targeted single-file tests are encouraged when the chunk authors them; whole-suite runs are CI-only.

**Plan is complete.** Builders dispatch in order: A → (B, C, D in parallel) → E → final commit + push.
