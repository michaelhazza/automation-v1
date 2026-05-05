# chatgpt-spec-review log — pre-launch-phase-3

## Session Info

- **Started:** 2026-05-05T10:50:30Z
- **Finished:** 2026-05-05T14:00:00Z
- **Mode:** manual
- **Spec:** `tasks/builds/pre-launch-phase-3/spec.md`
- **Spec commit at start:** `29c64f44`
- **Spec commit at finish:** `cbe80c53` (round-4 commit; round 5 introduced no edits)
- **Branch:** `claude/pre-launch-phase-3`
- **Coordinator:** spec-coordinator (Opus, inline)
- **Driving rule:** operator copies the spec + prompt into ChatGPT-web; pastes ChatGPT's response back here. Coordinator triages each finding (technical → auto-implement; user-facing → operator approval).
- **Project context loaded:** CLAUDE.md, docs/spec-context.md, DEVELOPMENT_GUIDELINES.md (read previously this session).
- **Verdict:** APPROVED (5 rounds; final-validation round 5 = zero findings)

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

---

## Round 3 — 2026-05-05T13-00-00Z

### ChatGPT Feedback (raw)

> Executive summary
>
> This is tight. The Round 2 changes closed every meaningful gap: terminal semantics are now correct, audit causality is explicitly bounded, pagination is safe, and security assertions are observable. At this point, this is clean, internally consistent, and production-safe to build.
>
> What follows is a final micro-pass. No structural issues. Only edge-case clarifications and future-proofing.
>
> **Final review — only what still matters**
> 1. Terminal invariant — add explicit mutual exclusivity + "no further events of any type after terminal" closure rule.
> 2. enrolPartial chain closure — add explicit prohibition on resume/append; any continuation MUST start a new chain.
> 3. Pagination singletonKey lock-loss behaviour — make crash-recovery semantics intentional (worker crash → next job resumes via runId + cursor in payload; idempotency guarantees correctness).
> 4. Empty-page early exit — make completeness assumption explicit (no reconciliation against previously observed totals).
> 5. Audit causality — add positive directive ("consumers requiring causal ordering MUST use chain identifiers, not infer from timestamps").
> 6. NormalisedEmail — explicit single-constructor lock-in ("MUST only be constructed via `normaliseEmail()`").
> 7. Security audit events — add severity classification hint (`missingPrincipalContext → system integrity`; `crossTenantAttempt → security boundary`).
>
> 8-10. (No changes needed.) LRU dedupe correct (full SHA-256). Page-cap classification correct. Overall spec integrity: everything aligns cleanly — no contradictions found.
>
> **Final verdict: ✅ APPROVED — READY TO BUILD (no blockers)**
>
> This is now mechanically enforceable, operationally safe, observable in failure modes, resistant to race conditions, future-proofed against common regressions.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F1 | Terminal-event mutual exclusivity + post-terminal silence (no further events of any type after terminal) | technical | apply | auto (apply) | low | Closes future-reader ambiguity; turns implied invariant into directive |
| F2 | Explicit prohibition on resuming/appending an `enrolPartial` chain | technical | apply | auto (apply) | low | Currently implied; making directive prevents accidental cursor/runId reuse |
| F3 | Pagination lock-loss behaviour — worker-crash recovery semantics made explicit | technical | apply | auto (apply) | low | Recovery currently incidental; making intentional matters for post-mortem |
| F4 | Empty-page early-exit completeness assumption (no reconciliation against prior totals) | technical | apply | auto (apply) | low | Pre-empts future "why didn't we double-check" debates |
| F5 | Audit causality positive directive ("MUST use chain identifiers, not timestamps") | technical | apply | auto (apply) | low | Spec currently only forbids misuse; pairing with positive directive is symmetrical |
| F6 | NormalisedEmail single-constructor lock-in ("MUST only via `normaliseEmail()`") | technical | apply | auto (apply) | low | Implied; making directive enforceable in future reviews |
| F7 | Security audit events severity classifier (closed enum: `system_integrity` | `security_boundary` | `rate_limit` | `configuration`) | technical | apply | auto (apply) | low | Useful downstream metadata for alerting/dashboards/triage; small Phase 3-appropriate factory extension |

### Auto-execution summary (technical findings)

- **Auto-applied (7):** F1, F2, F3, F4, F5, F6, F7.
- **Auto-rejected (0):** none.
- **Escalated to operator (0):** none.

### User-facing approvals

None. All findings classified `technical` with apply recommendation. No carveouts triggered.

### Operator decisions (round 3)

None required — round 3 was 100% technical / auto-execute.

### Applied (auto-applied technical)

- [auto F1] §11 D.5, §12.1, §12.2 — post-terminal silence invariant: once a terminal (`enrolCompleted` | `enrolFailed`) fires for `(connectionId, runId)`, NO further events of any type may be emitted. Late retries dropped at handler. The §12.1 row updated to "mutually exclusive AND chain-closing"; §12.2 adds explicit "Chain-closure invariant (post-terminal silence)" bullet.
- [auto F2] §11 D.5, §12.2 — `enrolPartial` chain closure directive: chain MUST NOT be resumed or appended to; continuation MUST start fresh chain with new `runId`. Job handler refuses re-enqueue against a payload whose `runId` matches a known-partial chain (runtime check, not just doc rule).
- [auto F3] §11 D.5 — lock-loss / crash recovery section made explicit: pg-boss releases singleton on worker crash; subsequent worker resumes via `runId` + cursor from payload + per-location idempotency. Recovery uses SAME `runId` — fresh `runId` reserved for operator-driven re-trigger after partial/failed.
- [auto F4] §11 D.5 — empty-page completeness assumption: early exit assumes upstream API completeness; no reconciliation against documented agency location counts. Reconciliation logic is a future spec amendment, not implicit.
- [auto F5] §7.2 — added "Causality posture (positive directive)" paragraph: consumers requiring causal ordering MUST use chain identifiers (`runId`, `connectionId`, transactional locks, FK relationships) carried in event `context`, not timestamps. Phase 3 events all carry chain identifiers; dashboards/alerting/post-mortems query by identifier first.
- [auto F6] §7.3 — added "Single-constructor invariant (directive)": `NormalisedEmail` MUST only be constructed via `normaliseEmail()`; no other constructor/factory/wrapper permitted. PR adding a second exporter is a blocking finding, not a nit.
- [auto F7] §6, §7.7 — added `SecurityEventSeverity = 'system_integrity' | 'security_boundary' | 'rate_limit' | 'configuration'` closed enum, exported from `shared/types/securityAuditEvents.ts` alongside the factory. Each `auditEvent.security.*` event has a single canonical severity declared at factory site (NOT call site): `crossTenantAttempt → 'security_boundary'`, `missingPrincipalContext → 'system_integrity'`, `rateLimitTrip → 'rate_limit'`. recordEvent type signature requires a severity. §15 file inventory updated.

### Integrity check (post-edit pass)

- Forward references: severity classifier now consistent across §6 (declaration) and §7.7 (per-event tags). Lock-loss / chain-closure / empty-page-assumption clauses in §11 D.5 align with §12.1 / §12.2 state machine.
- Contradictions: zero. The "exactly one terminal" invariant is now explicitly chain-closing AND mutually exclusive — no remaining wiggle room for interpretation.
- Missing inputs/outputs: §15 file inventory updated for the `SecurityEventSeverity` export from `shared/types/securityAuditEvents.ts`. No other new files / contracts.
- Integrity-check found one self-introduced inconsistency: an optional `auditEvent.oauth.enrolStaleRetry` event mentioned in F1's edit was a new event name not in the factory + conflated namespaces — removed. Late-retry observability is now "the absence of any further `enrol*` event after terminal IS the observable signal."
- Issues found this round: 1 mechanical (self-introduced enrolStaleRetry) — auto-fixed inline. 0 directional.
- Integrity-check findings this round: auto: 1, escalated: 0.

### Round 3 summary

- **Auto-accepted (technical):** 7 applied, 0 rejected, 0 deferred.
- **User-decided (user-facing + technical-escalated):** 0 applied, 0 rejected, 0 deferred.

Top theme: directive-strengthening of implied invariants — turning "this is true because we wrote it correctly" into "this is enforced by signature / handler check / closed enum / runtime drop." Plus one observability metadata addition (severity classifier) for downstream alerting routing. ChatGPT verdict: **APPROVED — READY TO BUILD (no blockers)**.

---

## Round 4 — 2026-05-05T13-30-00Z

### ChatGPT Feedback (raw)

> Executive summary
>
> You're effectively done. This is now one of the cleanest pre-launch hardening specs I've seen: invariants are tight, failure modes are explicit, and every "must" is backed by a mechanism. There are no blockers and nothing here will bite you at runtime.
>
> What follows is the true final pass: only edge-case hardening and future-proofing. No structural changes.
>
> **Final micro-pass (nothing critical)**
> 1. runId global uniqueness invariant — unique across all chains, even across different connectionIds.
> 2. Pagination cursor trust boundary — pageCursor is opaque, not validated/parsed.
> 3. Partial-index soft-delete interaction — soft-deleted row may be re-inserted (clarify).
> 4. Audit immutability — rows MUST NEVER be updated or deleted.
> 5. LRU dedupe process-bound + best-effort (resets on restart).
> 6. Rate-limit explicit fail-open (existing posture).
> 7. Severity declared at event declaration, MUST NOT be overridden at call site.
> 8. AppError immutability — fields MUST NOT be mutated after construction.
> 9. CI gates fail-fast (exit 1) + single-line actionable error.
> 10. enrolCompleted context: `{ totalLocationsProcessed, totalPagesProcessed }` (optional but high leverage).
>
> **Optional last upgrade (high leverage):** Add a "failure playbook" section (1 page max) for `enrolFailed`, `enrolPartial`, `crossTenantAttempt`, `missingPrincipalContext` — what it means, what to check, expected operator action. Turns the spec into an operational runbook, not just a build doc.
>
> **Final verdict: ✅ APPROVED — BUILD WITH CONFIDENCE**
>
> 0 blockers. 0 risky ambiguities. 0 missing mechanisms.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F1 | runId global uniqueness invariant (across all connectionIds) | technical | apply | auto (apply) | low | Convention → directive; prevents accidental reuse in future refactors |
| F2 | Cursor trust boundary — pageCursor is opaque, not validated | technical | apply | auto (apply) | low | Avoids future "validate the cursor" attempts coupling us to GHL's format |
| F3 | Partial-index soft-delete interaction (re-insert allowed) | technical | apply | auto (apply) | low | Makes reuse-after-delete behaviour intentional |
| F4 | Audit-event immutability — rows MUST NEVER be updated/deleted | technical | apply | auto (apply) | low | Forensic reliability; corrections via supersedes-event pattern |
| F5 | LRU dedupe process-bound + best-effort | technical | apply | auto (apply) | low | Prevents future "make it durable" requests built on wrong assumption |
| F6 | Rate-limit explicit fail-open | technical | apply | auto (apply) | low | Existing posture; making explicit prevents silent fail-closed change |
| F7 | Severity declared at event declaration, immutable at call site | technical | apply | auto (apply) | low | Locks the model; prevents drift |
| F8 | AppError immutability post-construction | technical | apply | auto (apply) | low | Prevents downstream-mutation bugs in logs |
| F9 | CI gate failure posture (fail-fast + single-line actionable) | technical | apply | auto (apply) | low | Faster debugging; meta-rule for all verify-*.sh |
| F10 | enrolCompleted context: totalLocationsProcessed + totalPagesProcessed | technical | apply | auto (apply) | low | Cheap observability; uniform across all closing event types |
| F11 | Optional: 1-page operational "failure playbook" section in the spec | technical-escalated (defer) | defer | user (defer per recommendation) | low | Build doc vs runbook concern separation; runbook lives in `docs/runbooks/*.md` post-launch with real on-call signal, not pre-launch in a hardening spec |

### Auto-execution summary (technical findings)

- **Auto-applied (10):** F1, F2, F3, F4, F5, F6, F7, F8, F9, F10.
- **Auto-rejected (0):** none.
- **Escalated to operator (1):** F11 (defer carveout — silent technical defers escalate so the operator sees what's being held back).

### User-facing approvals

None. F11 escalated only because the recommendation is `defer` (per the carveout in §3a — silent technical defers escalate).

### Operator decisions (round 4)

- **F11 — failure playbook (defer):** operator replied **"as recommended"** → F11 deferred per agent recommendation. Routed to tasks/todo.md § Spec Review deferred items / pre-launch-phase-3 as a post-launch task to author after first-agency monitoring + on-call rotation are in place.

### Applied (auto-applied technical + user-approved user-facing)

- [auto F1] §11 D.5 — runId global-uniqueness directive: `runId` MUST be globally unique across all chains regardless of connectionId; `crypto.randomUUID()` provides necessary entropy by construction; no other minting strategy permitted.
- [auto F2] §11 D.5 — cursor trust boundary directive: `pageCursor` is opaque, MUST NOT be validated/parsed/interpreted. Safety nets (empty-page early exit + page-cap abort) handle invalid/stale/looping cursors. Future "validate the cursor" attempts are blocking findings.
- [auto F3] §12.3 — partial-index soft-delete interaction made explicit: soft-deleted rows free the (org, external_id) for re-insertion (intentional — soft-delete is a tombstone for operator view, not a uniqueness reservation). Hard-delete-to-lock-external_id is a future spec.
- [auto F4] §7.2 — audit-event immutability invariant: rows in `security_audit_events` MUST NEVER be UPDATEd or DELETEd post-insertion. Corrections insert a NEW event with `context.supersedes = '<original_event_id>'`. Retention/archival sweeps are a separate post-launch spec.
- [auto F5] §7.6 — LRU dedupe persistence posture: process-local, resets on restart, best-effort only. Cross-restart / cross-process duplicates are not suppressed. Any future durable-dedupe feature MUST introduce its own mechanism.
- [auto F6] §7.3 — rate-limit failure-mode directive: BOTH buckets fail OPEN if the storage backend errors. Auth-availability over abuse-resistance during incidents. Any future fail-closed change is a blocking finding. Fail-open path emits `auditEvent.security.rateLimitTrip` with `context.severity = 'configuration'` and `context.reason = 'BACKEND_UNAVAILABLE'` for post-mortem disambiguation.
- [auto F7] §7.7 + §6 — severity-at-declaration immutability: severity is bound at the factory entry; `recordSecurityEvent` reads it from the factory, not from a caller-supplied parameter. Call-site overrides fail at the type level (the parameter doesn't exist).
- [auto F8] §7.1 — AppError immutability: `code`, `statusCode`, `message`, `context` declared `readonly`; constructor freezes `context` via `Object.freeze`. Mutation attempts are blocking PR findings.
- [auto F9] §11 B.5 — CI gate failure posture meta-rule: every gate fails fast (`exit 1`) on first violation with a single-line actionable error in the form `<script-name>: <one-sentence problem> at <file:line>`. No multi-page diffs; no warnings tier. Phase 3 codifies this for new gates; pre-existing scripts updated only when touched by a Phase 3 chunk file.
- [auto F10] §7.4 — enrolCompleted/Failed/Partial context fields: all three closing events carry `{ totalLocationsProcessed, totalPagesProcessed }`; `enrolCompleted` adds `completedReason: 'all_pages_processed' | 'empty_page_early_exit'` for exit-path discrimination without reconstructing from progress events.
- [user F11 → DEFER] no spec change — failure-playbook routed to tasks/todo.md as post-launch task ("Author OAuth-enrol + connection-token failure runbooks once first-agency monitoring is in place"). Lives at `docs/runbooks/*.md`, separate from the spec.

### Integrity check (post-edit pass)

- Forward references: §6 / §7.7 / §11 D.5 / §12.x all consistent with the new immutability and global-uniqueness directives. The new context fields (`completedReason`, `totalLocationsProcessed`, `totalPagesProcessed`, `BACKEND_UNAVAILABLE`, `supersedes`) are declared once in their canonical sections and referenced consistently.
- Contradictions: zero. The four new "MUST NOT" directives (mutate AppError, override severity, update audit row, fail-closed RL) are non-overlapping and don't conflict with anything earlier.
- Missing inputs/outputs: §15 file inventory unchanged — no new files in this round (all edits tighten existing contracts).
- Issues found this round: 0 mechanical, 0 directional.
- Integrity-check findings this round: auto: 0, escalated: 0.

### Round 4 summary

- **Auto-accepted (technical):** 10 applied, 0 rejected, 0 deferred.
- **User-decided (user-facing + technical-escalated):** 0 applied, 0 rejected, 1 deferred.

Top theme: turn implied invariants and conventions into directives — globally-unique runId, immutable AppError + audit rows, severity bound at factory, opaque cursor, fail-open RL. Plus one observability uniformity (closing-event totals). The spec is now closed under the "every MUST is mechanism-backed" rule. ChatGPT verdict: **APPROVED — BUILD WITH CONFIDENCE** (0 blockers / 0 ambiguities / 0 missing mechanisms).

---

## Round 5 — 2026-05-05T14-00-00Z (zero-findings final validation)

### ChatGPT Feedback (raw)

> Executive summary
>
> This is fully closed. The spec is internally consistent, every invariant is enforced by mechanism, and the remaining deferred item is correctly scoped post-launch. There are no gaps, no contradictions, and no hidden failure modes left.
>
> You're past "review" and into "execution confidence."
>
> **Final validation (true last pass)**
>
> I went looking specifically for: hidden race conditions, unbounded loops or retries, ambiguity between invariants, "looks correct but isn't enforceable" rules. **Nothing material came up.**
>
> **What you got especially right**
> 1. Chain closure model — terminal exclusivity + post-terminal silence + runId monotonic & globally unique. Removes ghost retries, duplicate completion, ambiguous observability.
> 2. Idempotency design — keyed on location, not cursor. Avoids cursor drift, upstream pagination bugs, replay inconsistencies.
> 3. Audit system discipline — append-only + typed namespace + severity bound at declaration + "audit is observational, not causal."
> 4. Failure-mode clarity — failed (unrecoverable) / partial (safe checkpoint) / completed (terminal success), with partial as chain-closing-but-not-terminal.
> 5. Defensive boundaries are actually enforceable — CI grep gates, type system, DB constraints, runtime assertions. No "soft rules" left.
>
> **The only thing worth calling out (not a blocker)**
> Observability edge — chain-level summary derivation. Most dashboards will want a single derived chain summary `{ connectionId, runId, finalState, totalLocationsProcessed, totalPagesProcessed, duration, exitReason }`. Not a spec change; just expect it post-launch.
>
> **Deferred item check (F11)** — Right call. Pre-launch runbooks tend to be wrong; waiting for real signal is correct.
>
> **Final verdict: ✅ APPROVED — FINAL**
>
> Spec is complete. All invariants enforceable. All failure modes bounded. All concurrency paths safe. No hidden coupling remains.

### Recommendations and Decisions

(None — round 5 is a zero-findings validation round.)

### Auto-execution summary (technical findings)

- **Auto-applied (0):** none — zero findings.
- **Auto-rejected (0):** none.
- **Escalated to operator (0):** none.

### User-facing approvals

None.

### Operator decisions (round 5)

Operator instruction: **"final round of feedback, lock down the spec after this"** → finalise.

### Applied (auto-applied technical + user-approved user-facing)

No spec changes this round. The chain-summary observation is non-actionable per ChatGPT's own framing ("Not a spec change, just awareness") — captured in the post-launch observability backlog as informational only, not a deferred item.

### Integrity check (post-edit pass)

- Forward references: n/a — no edits.
- Contradictions: n/a — no edits.
- Missing inputs/outputs: n/a — no edits.
- Issues found this round: 0 mechanical, 0 directional.
- Integrity-check findings this round: auto: 0, escalated: 0.

### Round 5 summary

- **Auto-accepted (technical):** 0 applied, 0 rejected, 0 deferred.
- **User-decided (user-facing + technical-escalated):** 0 applied, 0 rejected, 0 deferred.

Top theme: validation only — ChatGPT confirmed the spec is closed under the "every MUST is mechanism-backed" rule and called out one post-launch observability evolution that is explicitly NOT a spec change. Round 5 functions as the locked-in final-verdict round.

---

## Final Summary

- **Rounds:** 5 (round 5 was a zero-findings final-validation pass)
- **Auto-accepted (technical):** 33 applied | 1 rejected | 0 deferred
- **User-decided:** 0 applied | 0 rejected | 2 deferred
- **Index write failures:** 0 (clean)
- **Deferred to tasks/todo.md § Spec Review deferred items / pre-launch-phase-3:**
  - [user] **CI gate: "no raw DB writes outside transaction helpers"** — Phase 4 candidate; outside Phase 3's deferred-backlog charter; co-locate with R3-2 AppError taxonomy backfill (also Phase 4) — both items "tighten the write surface."
  - [user] **OAuth-enrol + connection-token failure runbooks** — post-launch task; lives at `docs/runbooks/*.md` separate from spec; defer until first-agency monitoring + on-call rotation provide real signal patterns.
- **Consistency warnings:** 0 (no cross-round contradictions; six themes tracked — AppError, audit-event factory, GHL pagination, NormalisedEmail, LRU dedupe, CI gates — all strictly cumulative).
- **Implementation-readiness checklist:** all five criteria pass (inputs / outputs / failure modes / ordering / forward references).
- **KNOWLEDGE.md updated:** yes (6 entries: branded-type single-constructor, factory const-object enum, pg-boss singleton+cursor-in-payload, three-state job chain, audit causality posture, terminal zero-findings round)
- **architecture.md updated:** no — checked `recordSecurityEvent`, `securityAuditService.recordEvent`, `connectionTokenService`, `loginIpEmailKey`, `loginEmailOnlyKey`, `MAX_GHL_LOCATIONS`, `MAX_GHL_PAGES`, `SecurityAuditEventName`, `auditEvent.`, `NormalisedEmail`, `AppError` against architecture.md; existing references (only `connectionTokenService` in Stripe-agent context, line 1678+) still accurate (spec preserves public API). New names not in architecture.md yet — correct, since Phase 3 implementation hasn't landed; `feature-coordinator` D.5 will add them when the build commits.
- **capabilities.md updated:** n/a — no skill / capability / integration add/remove/rename in this PR (pre-launch hardening only).
- **integration-reference.md updated:** n/a — no integration scope/skill/OAuth-provider/MCP-preset/capability-slug/alias changes; spec adds telemetry on existing GHL OAuth flow without altering integration surface.
- **CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated:** no — checked § 8 (development discipline), § 8.17 (multi-source UI merges with stable tiebreaker — analogous principle the spec references for audit-stream reads), § 8.19 (error-code extraction helper); zero stale references. Spec's reference to "§ 8 invariant in DEVELOPMENT_GUIDELINES" applies to the existing § 8.17 family; no edit needed.
- **spec-context.md updated:** yes (bumped `last_reviewed_at` to 2026-05-05 per the update-trigger rule "verified current"). `accepted_primitives` does not yet list the new factory / branded-type patterns because they are spec-only — `feature-coordinator` doc-sync will add them when Phase 3 ships.
- **frontend-design-principles.md updated:** n/a — no UI surface in Phase 3.
- **PR:** to be created by `feature-coordinator` Phase 2 (no implementation commits yet on this branch).

**Final ChatGPT verdict: ✅ APPROVED — FINAL.** Spec is complete; all invariants enforceable; all failure modes bounded; all concurrency paths safe; no hidden coupling remains.

**Next:** hand off to architect (Opus plan breakdown) → feature-coordinator (Phase 2 build).

