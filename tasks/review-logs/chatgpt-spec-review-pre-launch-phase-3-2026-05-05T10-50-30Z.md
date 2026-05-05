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

