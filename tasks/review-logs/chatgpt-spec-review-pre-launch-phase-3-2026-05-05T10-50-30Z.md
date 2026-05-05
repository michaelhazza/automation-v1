# chatgpt-spec-review log — pre-launch-phase-3

## Session Info

- **Started:** 2026-05-05T10:50:30Z
- **Mode:** manual
- **Spec:** `tasks/builds/pre-launch-phase-3/spec.md`
- **Spec commit at start:** `29c64f44`
- **Branch:** `claude/pre-launch-phase-3`
- **Coordinator:** spec-coordinator (Opus, inline)
- **Driving rule:** operator copies the spec + prompt into ChatGPT-web; pastes ChatGPT's response back here. Coordinator triages each finding (technical → auto-implement; user-facing → operator approval).
- **Project context loaded:** CLAUDE.md, docs/spec-context.md, DEVELOPMENT_GUIDELINES.md (read previously this session).

## Spec metadata

- 462 lines, 24 source items, 5 chunks (A-E), 4 explicit verdicts (DEFER/WONT-DO).
- Cleared spec-reviewer (Codex) with READY_FOR_BUILD verdict — 3 of 5 iterations used; 3 mechanical findings applied across iter 1-2; 0 directional; 1 ambiguous (auto-decided + deferred to todo.md).

## Round 1 — 2026-05-05T11-30-00Z

### ChatGPT Feedback (raw)

> Executive summary
>
> This spec is tight, deliberate, and consistent with your "invariants + gates over testing" philosophy. Scope discipline is strong, and most changes are low-risk extensions of existing primitives. The only areas that need attention before build are a few hidden coupling risks (AppError rollout, audit enum blast radius), one correctness gap in pagination idempotency semantics, and two CI gate edge cases that could create false confidence.
>
> **What's solid (no change needed)**
> 1. Scope discipline and framing — clean BUILD vs DEFER vs WONT-DO separation; one of the cleaner "closure specs."
> 2. "Mechanism over intent" correctly applied — every important rule has enforcement (audit grep, RL gate+type, assertActive, AppError + asyncHandler).
> 3. GHL pagination architecture direction is correct — async via pg-boss, per-location idempotency, partial unique index, cursor-based continuation.
> 4. Execution-safety section is strong — explicit idempotency classification, state machine defined and closed, terminal event guarantees.
>
> **Issues / risks that should be fixed**
> 1. **AppError rollout gap (medium risk).** Dual error semantics — some errors structured (AppError), others duck-typed `{statusCode, message, errorCode}`. Fix: normalize legacy errors in asyncHandler.
> 2. **Audit event enum migration risk (high leverage).** No exhaustiveness guard, no fallback for dynamic cases, `as SecurityAuditEventName` cast bypass possible. Fix: factory pattern (`auditEvent.auth.loginFailed`).
> 3. **GHL pagination idempotency subtle flaw (important).** `singletonKey: ghl-enrol:${connectionId}:${pageCursor}` allows two cursor-different jobs to race on the same connection. Same location across pages → duplicate progress events. Fix: connection-scoped singleton, cursor in payload.
> 4. **Rate-limit normalization gate is fragile.** Static grep can't reliably trace data flow. Fix: branded `NormalisedEmail` as the only path; remove grep tracing.
> 5. **OAuth state telemetry missing one critical dimension.** No latency between issue and consume. Fix: add `latencyMs` to `oauth.state_consumed`.
> 6. **CI grep gates need one more invariant.** Add: "No raw DB writes outside transaction helpers" — gate idea: `grep -R "db\.\(insert\|update\|delete\)" server/ | grep -v "transaction"` (allowlist required).
> 7. **connectionTokenService assertion edge case.** Allowing `principalOrgId === null` for system flows risks silent bypass if ALS context is missing. Fix: tighten — `if (principalOrgId === undefined) throw MISSING_PRINCIPAL_CONTEXT`.
>
> **Minor improvements (nice-to-have)**
> 1. Add versioning note to AppError (`version: 1`).
> 2. Explicitly state audit log ordering guarantee.
> 3. Add "max pages per run" safety for GHL job.
>
> **Final verdict: APPROVED with targeted fixes**
> Must-fix before build: AppError normalization layer, GHL singletonKey change, RL branded type only, OAuth latency metric.
> Strongly recommended: audit event factory, extra CI invariant (raw DB writes), tighten principal context assertion.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F1 | AppError legacy-error normalisation in asyncHandler | technical | apply | auto (apply) | medium | Spec already says asyncHandler falls through to duck-shape; making the fall-through wrap into AppError unifies the downstream shape with no behaviour change |
| F2 | GHL singletonKey: connection-scoped not cursor-scoped + cursor in payload | technical | apply | auto (apply) | medium | Real correctness improvement — cursor-scoped admits concurrent jobs on different pages, leading to duplicate progress events; single-writer pattern is canonical |
| F3 | RL email normalisation: branded `NormalisedEmail` as the ONLY path | technical | apply | auto (apply) | medium | Spec already names branded type as canonical; ChatGPT correct that keeping grep tracing as fallback is fragile — tightening to compile-time-only |
| F4 | OAuth `state_consumed`: add `latencyMs` (issuedAt / consumedAt / latencyMs context) | technical | apply | auto (apply) | low | Direct enabler of the §13 deferred TTL revert decision — spec already has a `context` payload, adding one field |
| F5 | Audit event factory pattern (`auditEvent.auth.loginFailed`) over raw strings | technical | apply | auto (apply) | medium | Eliminates the `as SecurityAuditEventName` cast bypass route; factory IS the union (typeof-derived) — better ergonomics, structurally enforced |
| F6 | Extra CI gate: "no raw DB writes outside transaction helpers" | technical-escalated (defer) | defer | user (defer per recommendation) | medium | Valid invariant but not in the Phases 1+2 deferred backlog this spec is chartered to close — Phase 4 candidate alongside R3-2 backfill; routed to tasks/todo.md |
| F7 | Tighten principal-context assertion: `undefined` → `MISSING_PRINCIPAL_CONTEXT`, `null` → system-flow | technical | apply | auto (apply) | medium | Two-assertion pattern adds explicit error code for missing-ALS case (the spec's strict `!== null` already catches `undefined` but throws a misleading `CROSS_TENANT` code) — clarification |
| F8 | AppError `version: 1` field | technical | reject | auto (reject) | low | YAGNI — pre-launch, breaking changes expected per spec-context.md, no consumer; speculative future-proofing |
| F9 | Explicit audit-log ordering guarantee (`ORDER BY created_at DESC, id DESC`) | technical | apply | auto (apply) | low | Spec gap — currently implicit; one sentence in §7.2 prevents downstream confusion |
| F10 | `MAX_GHL_PAGES_PER_RUN` safety cap on the auto-enrol job | technical | apply | auto (apply) | low | Defense-in-depth on a self-re-enqueueing job; the §11 D.4 inline cap of 250 doesn't bound the job, which picks up beyond 250 |

### Auto-execution summary (technical findings)

- **Auto-applied (8):** F1, F2, F3, F4, F5, F7, F9, F10.
- **Auto-rejected (1):** F8 (YAGNI).
- **Escalated to operator (1):** F6 (defer carveout — silent defers accumulate spec debt).

### User-facing approvals

None. All findings classified `technical`. F6 escalated only because the recommendation is `defer` (per the carveout in §3a — silent technical defers escalate so the operator sees what's being held back, even when they wouldn't normally need to approve it).

### Operator decisions (round 1)

- **F6 — extra CI gate (defer):** operator replied **"all as recommended"** → F6 deferred per agent recommendation. Routed to tasks/todo.md § Spec Review deferred items / pre-launch-phase-3.

### Applied (auto-applied technical + user-approved user-facing)

- [auto F1] §7.1 — asyncHandler normalises any non-`AppError` with a numeric `statusCode` into a synthetic `AppError` (`code: errorCode ?? 'LEGACY_ERROR'`, `context: { legacy: true }`). Backfill of throw sites remains a Phase 4 sweep.
- [auto F2 + F5 + F10] §11 D.5 — pg-boss singletonKey changed to `ghl-enrol:${connectionId}` (connection-scoped); cursor lives in job payload `{ connectionId, runId, pageCursor, pageIndex }`; `MAX_GHL_PAGES_PER_RUN = 200` cap with `auditEvent.oauth.enrolFailed` + `GHL_ENROL_PAGE_CAP_EXCEEDED` reason code. Mirrored into §12.1 + §12.2.
- [auto F3] §7.3 — `loginIpEmailKey(ip, email: NormalisedEmail)` / `loginEmailOnlyKey(email: NormalisedEmail)` — branded type required; raw-string callers structurally rejected. §11 B.3 grep gate scoped to cast-bypass detection only (data-flow tracing rejected).
- [auto F4] §7.4 — `auditEvent.oauth.stateConsumed` and `auditEvent.oauth.stateExpired` carry `{ issuedAt, consumedAt, latencyMs }` context fields for the post-launch TTL-revert decision.
- [auto F5] §6 + §7.2 + §11 A.3 / A.4 — `auditEvent` const-object factory with nested namespaces (auth/oauth/security/audit); `SecurityAuditEventName` derived via `typeof`. Producers MUST use `auditEvent.<namespace>.<eventKey>`; B.4 fails on `as SecurityAuditEventName` cast bypass. All §11 / §15 raw-string event references migrated to factory member access.
- [auto F7] §7.7 + §11 D.3 — two ordered assertions in `connectionTokenService.refreshIfExpired`: (1) `principalOrgId === undefined` → `MISSING_PRINCIPAL_CONTEXT` (statusCode 500); (2) cross-tenant check throws `CROSS_TENANT_TOKEN_REFRESH` (statusCode 403). New error codes added to §6 + §15.
- [auto F9] §7.2 — explicit ordering guarantee: `ORDER BY created_at DESC, id DESC`; cross-writer same-millisecond ordering undefined; convention recorded as DEVELOPMENT_GUIDELINES § 8 invariant pointer.
- [user F6 → DEFER] §13 — added "CI gate: no raw DB writes outside transaction helpers (Phase 4 candidate)" entry; routed to tasks/todo.md. Tracked alongside R3-2 backfill since both items "tighten the write surface."
- [auto F8 → REJECT] no spec change — `version: 1` rejected per YAGNI / pre-launch posture.

### Integrity check (post-edit pass)

- Forward references: all event-name references in §8, §11 (C.1, C.2, D.4), §13, §15 migrated to factory member access (`auditEvent.<namespace>.<eventKey>`). Zero raw-string event names remain after pass.
- Contradictions: §14 self-consistency line updated to reflect dual canonical claims (`AppError` + legacy normalisation; `auditEvent` factory + derived union; new `MAX_GHL_PAGES_PER_RUN` cap; `NormalisedEmail` branded type as the canonical RL key constructor).
- Missing inputs/outputs: §6 / §15 enumerate the three new error codes (`CROSS_TENANT_TOKEN_REFRESH`, `MISSING_PRINCIPAL_CONTEXT`, `GHL_ENROL_PAGE_CAP_EXCEEDED`) and the new constant (`MAX_GHL_PAGES_PER_RUN`). All hooks present.
- Issues found this round: 0 mechanical, 0 directional. (Auto: 0, escalated: 0.)

### Round 1 summary

- **Auto-accepted (technical):** 8 applied, 1 rejected, 0 deferred.
- **User-decided (user-facing + technical-escalated):** 0 applied, 0 rejected, 1 deferred.

Top theme: tightening invariants from "convention + grep" to "type system + structural enforcement" — branded types, factory const-objects, explicit error codes for boundary cases. Plus one defense-in-depth cap (MAX_GHL_PAGES_PER_RUN). All changes are internal-contract scope; zero user-visible product changes.

---

## Round 2 — 2026-05-05T12-15-00Z

### ChatGPT Feedback (raw)

> Executive summary
>
> This is now materially stronger than the previous version. You've closed the key structural risks: unified error shape, factory-based audit events, correct single-writer pagination, and type-enforced rate limiting. At this point, the spec is build-ready, with only a few edge-condition tightenings worth addressing to avoid subtle production drift.
>
> **What's now solid (no further action)**
> 1. AppError normalization — single downstream shape achieved; legacy compatibility preserved; no Phase 3 backfill needed.
> 2. Audit event factory — eliminates string drift entirely; grep gate now enforcement, not primary control.
> 3. Pagination concurrency model — connection-scoped singletonKey correct; cursor in payload avoids dual-writer race; page cap adds safety against infinite loops.
> 4. Rate limit correctness — branded type → real compile-time guarantee; grep reduced to bypass detection only.
> 5. OAuth telemetry completeness — latency captured on both success and expiry paths; enables real TTL decision post-launch.
>
> **Remaining issues (worth fixing before build)**
> 1. **Pagination terminal event correctness edge case.** Current invariant "exactly one terminal event per (connectionId, runId)" allows a subtle path: partial → completed (job hits inline cap → emits partial; background job continues; later completes → emits completed). Fix: make `enrolPartial` non-terminal.
> 2. **Page cap failure classification slightly off.** Page-cap is a safety abort, not a true failure. Post-launch analysis would misclassify as system failure, inflate failure rates. Fix: use `enrolPartial + reason = PAGE_CAP_EXCEEDED`; reserve `enrolFailed` for auth/API/unrecoverable.
> 3. **LRU dedupe collision risk (minor but real).** 16 hex chars = 64 bits; this is a dedupe mechanism — collisions create silent data loss. Fix: full hash (256 bits).
> 4. **Audit ordering guarantee needs one clarification.** Doesn't explicitly forbid using audit logs for causality reconstruction. Fix: add one line — "Audit logs are NOT a source of truth for causality across concurrent writers. Observational stream only."
> 5. **NormalisedEmail bypass vector still exists.** `const email = someFunc() as NormalisedEmail` passes (caught by grep, but stronger fix: opaque brand pattern).
> 6. **GHL pagination missing "empty page loop" guard.** Valid cursor + empty results repeatedly → relies on page cap to stop (slow + noisy). Fix: early exit on `locations.length === 0`.
> 7. **Connection token assertion logging gap.** No explicit audit event emission for MISSING_PRINCIPAL_CONTEXT / CROSS_TENANT_TOKEN_REFRESH. Security-relevant events should be observable independent of error handling.
>
> **Optional improvement (high leverage)**
> Add "runId monotonicity" invariant to pagination — all jobs in a chain MUST share the same runId; a new run MUST create a new runId.
>
> **Final verdict: APPROVED (build-ready)**
> Suggested final tweaks: make enrolPartial non-terminal; reclassify page-cap as non-failure; increase LRU hash length; add empty-page early exit; emit audit events for token assertion failures.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F1 | Make `enrolPartial` non-terminal — current invariant "exactly one terminal" is wrong because partial→completed is a real flow | technical | apply | auto (apply) | medium | Real contract gap; spec asserts an invariant that is provably false. Cleanest fix: redefine partial as a non-terminal checkpoint |
| F2 | Reclassify page-cap-exceeded as `enrolPartial + reason` (not `enrolFailed`) | technical | apply | auto (apply) | medium | Pairs with F1; semantically correct (safety abort ≠ failure). Prevents post-mortem misclassification |
| F3 | Full SHA-256 hash for client-errors LRU dedupe (drop 16-char prefix) | technical | apply | auto (apply) | low | Free correctness win — in-memory storage, no downside; 64 bits of entropy is dedupe-collision-prone |
| F4 | Audit log ordering: explicit "not a source of truth for causality across concurrent writers" | technical | apply | auto (apply) | low | One-line clarification preventing future misuse |
| F5 | NormalisedEmail brand pattern — pin canonical syntax `string & { readonly __brand: 'NormalisedEmail' }` | technical | apply | auto (apply) | low | Spec named the brand but didn't pin the type-syntax canonical form; pinning prevents build-time drift |
| F6 | Empty-page early-exit guard for GHL pagination | technical | apply | auto (apply) | low | Defense-in-depth against upstream API returning valid cursor + empty results — cheap |
| F7 | Emit `auditEvent.security.crossTenantAttempt` / `missingPrincipalContext` BEFORE throw in connectionTokenService | technical | apply | auto (apply) | medium | Security-relevant events should be observable independent of error logs — real observability gap |
| F8 | runId monotonicity invariant (chain-wide identity) | technical | apply | auto (apply) | low | Trivially small; prevents subtle debugging issues; explicit chain-identity rule |

### Auto-execution summary (technical findings)

- **Auto-applied (8):** F1, F2, F3, F4, F5, F6, F7, F8.
- **Auto-rejected (0):** none.
- **Escalated to operator (0):** none — all medium-or-lower severity, all internal-contract scope.

### User-facing approvals

None. All findings classified `technical` with apply recommendation. No carveouts triggered.

### Operator decisions (round 2)

None required — round 2 was 100% technical / auto-execute.

### Applied (auto-applied technical)

- [auto F1+F2] §11 D.5, §12.1, §12.2 — `enrolPartial` redefined as non-terminal checkpoint. Terminals are now strictly `enrolCompleted` | `enrolFailed`. Page-cap exceeded reclassified from `enrolFailed + GHL_ENROL_PAGE_CAP_EXCEEDED` to `enrolPartial + context.reason = 'PAGE_CAP_EXCEEDED'` (safety abort, not failure). The "exactly one terminal per chain" invariant scoped to actual terminals; chains ending in `enrolPartial` have no terminal until operator-driven re-trigger. State machine §12.2 updated accordingly.
- [auto F3] §7.6 — `/api/client-errors` LRU dedupe key changed to full hex `sha256(message + '\n' + stack)` (256 bits) — eliminates the 64-bit-prefix collision class. Storage cost negligible (in-memory).
- [auto F4] §7.2 — added "Causality posture (explicit non-guarantee)" paragraph: audit logs are observational, not causal-truth; consumers needing ordered events MUST use chain identifiers (runId, connectionId, transactional locks), not `created_at` timestamps. The DESC-DESC ordering is a display convention only.
- [auto F5] §7.3 — pinned the canonical brand-pattern syntax: `type NormalisedEmail = string & { readonly __brand: 'NormalisedEmail' }`. The `__brand` symbol is structural, unconstructable from a plain `string`; only escape hatch is the `as NormalisedEmail` cast hunted by B.3 grep gate.
- [auto F6] §11 D.5, §12.1 — empty-page early exit: if a page returns 0 locations the job emits `enrolCompleted` and stops without re-enqueuing, regardless of cursor state. Fires before the page-cap check. Handles upstream-API-bug class (valid-looking cursor that never advances).
- [auto F7] §7.7, §11 D.3, §6 — `connectionTokenService` assertions emit `auditEvent.security.missingPrincipalContext` / `auditEvent.security.crossTenantAttempt` BEFORE throwing. Both new events added to the factory namespace `auditEvent.security.*`. Security-relevant boundary failures now observable in `security_audit_events` independent of error-log routing.
- [auto F8] §11 D.5 — runId monotonicity invariant added: every job in a single pagination chain MUST share the same `runId` (re-enqueue copies it verbatim); a fresh chain (re-trigger / post-partial / post-failed) MUST mint a new `runId` (`crypto.randomUUID()`); never reuse a runId from a chain that has terminated or checkpointed.

### Integrity check (post-edit pass)

- Forward references: `enrolPartial` references in §6 / §11 / §12.1 / §12.2 all consistent with the new non-terminal classification. The page-cap reason is now `'PAGE_CAP_EXCEEDED'` (string in audit context), not `GHL_ENROL_PAGE_CAP_EXCEEDED` (formerly an error code). Updated §6 + §15 to drop the error-code reference (page-cap is no longer thrown as `AppError`).
- Contradictions: §14 self-consistency claims still hold (factory + branded type + caps + AppError normalisation). The "exactly one terminal" invariant statement now consistent with the partial=non-terminal model.
- Missing inputs/outputs: two new audit events (`auditEvent.security.crossTenantAttempt`, `auditEvent.security.missingPrincipalContext`) added to §6 factory namespace list; D.3 wires them into the assertion path.
- Issues found this round: 1 mechanical (stale GHL_ENROL_PAGE_CAP_EXCEEDED error-code reference in §6/§15 after F1+F2 reclassification) — auto-fixed inline. 0 directional.
- Integrity-check findings this round: auto: 1, escalated: 0.

### Round 2 summary

- **Auto-accepted (technical):** 8 applied, 0 rejected, 0 deferred.
- **User-decided (user-facing + technical-escalated):** 0 applied, 0 rejected, 0 deferred.

Top theme: terminal/checkpoint clarification + observability filling — pagination event taxonomy fixed (partial is now non-terminal), security-boundary failures gain audit-stream visibility, dedupe hash strengthened to full SHA-256, brand-pattern syntax pinned, runId chain identity made explicit. ChatGPT verdict: **APPROVED (build-ready)** with all suggested tweaks applied.

