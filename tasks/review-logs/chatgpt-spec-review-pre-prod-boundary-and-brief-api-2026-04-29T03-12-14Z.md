# ChatGPT Spec Review — Pre-Production Boundary + Brief API

**Mode:** manual (no `chatgpt-spec-review` agent loop; reviewer submitted feedback inline; main session adjudicated and applied edits).
**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
**Branch:** `pre-prod-boundary-and-brief-api`
**Round:** 1
**Captured at:** 2026-04-29T03-12-14Z
**Spec HEAD before edits:** `6ecb74e1` (post-`spec-reviewer` READY_FOR_BUILD).

## Framing assumptions applied

Per `.claude/agents/spec-reviewer.md` baked-in framing (mirrored here for the manual loop): pre-production, rapid evolution, no feature flags, prefer existing primitives.

## ChatGPT verdict

> "Ready for implementation with minor fixes." Blocking class: 3 must-fix (clarify reset semantics, add `(key)` index, document key-cardinality constraint). Strongly recommended: denial logging, auth ordering, key hashing.

## Findings adjudication

| # | ChatGPT title | Class | Decision | Action |
|---|---|---|---|---|
| F1 | resetAt sliding-window edge bug | Mechanical | Apply (doc fix) | §7.1 — relabelled `resetAt` as a fixed-window approximation; explicit "minimum retry time" wording; cross-reference to the new `getRetryAfterSeconds` helper. |
| F2 | Add `(key)`-only index | Directional | **REJECT** | §7.2 — added explicit "no separate `(key)` index" preempt with rationale: composite `PRIMARY KEY (key, window_start)` is a B-tree supporting leftmost-prefix lookups; a standalone `(key)` index would double per-UPSERT maintenance on the hot write path for zero query benefit. |
| F3 | Key-cardinality invariant | Mechanical (extracted from ChatGPT's "minimal" form) | Apply | §7.2 — added Key cardinality (hardening invariant) subsection: callers MUST normalise + length-cap free-form attacker-controlled tokens (e.g. email) before key concatenation; new free-form-keyed call sites require either component-hashing or upstream-bounded IDs. Current call-site set declared compliant. |
| F4 | Timeout / failure-handling policy | Mechanical | Apply | §10.1 — added Failure mode (fail closed) + Per-call timeout subsections: rejected `check()` promise → HTTP 500 across every call site (including unauthenticated public routes); per-call statement timeout is inherited from project pool defaults; tighter explicit timeout deferred to §13. |
| F5 | Tempfile cleanup edge case | Mechanical | Apply | §10.6 — added Crash-recovery & secondary safety net subsection: `res.on('close')` does not fire on process crash; OS `systemd-tmpfiles` reaper is the only fallback in scope; periodic in-process sweep deferred. |
| F6 | Rate-limiter vs auth ordering matrix | Mechanical | Apply | §6.1 — added explicit "Middleware ordering invariant (audit semantics)" table: 401 (unauth) / 429 (auth + over-limit) / 403 (auth + under-limit + lacks permission); reviewers MUST preserve `auth → rateLimit → permission` ordering on every authenticated route added by follow-up specs. |
| F7 | SessionMessage key shape (per-user vs per-user+org) | Directional | **REJECT** | §6.1 — strengthened the existing "per-user" rationale: a user toggling between orgs in the same minute is still one human typing; per-user+org would let the same human exceed the per-org limit by switching tenants — defeats the limit's purpose. ChatGPT's "spam across orgs" framing was already refuted by the spec; we made the refutation explicit. |
| F8 | Logging on rate-limit denial | Mechanical | Apply | §7.1 — added Denial observability paragraph to the contract: primitive emits `logger.info('rate_limit.denied', { key, limit, windowSec, currentCount, effectiveCount, remaining, resetAt })` once per denial; routes do not log denial themselves; canonical signal lives in the primitive (per `DEVELOPMENT_GUIDELINES § 8.20`). |
| F9 | Retry-After helper extraction | Mechanical | Apply | §7.1 — exported `getRetryAfterSeconds(resetAt: Date): number` adjacent to `RateLimitCheckResult`; updated the inline §7.1 login example + §6.2.5 on-failure-behaviour paragraph to call the helper instead of inlining the formula. |

## Summary of changes (file-by-file)

- `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
  - §6.1 — middleware ordering invariant + response-code matrix; per-user-vs-per-user+org rationale strengthened.
  - §6.2.5 — Retry-After paragraph references helper.
  - §7.1 — `resetAt` doc rewrite (approximation language); `getRetryAfterSeconds` helper export; denial-logging contract; failure-mode cross-references.
  - §7.2 — `(key)` index preempt; key-cardinality hardening invariant.
  - §10.1 — Failure mode (fail closed) + Per-call timeout subsections.
  - §10.6 — Crash-recovery & secondary safety-net subsection.
  - §13 — added per-call `statement_timeout` deferred entry.

Spec line count: 762 → 806 (+44 lines, all in existing sections; no new top-level sections introduced).

## Items NOT applied (rejected)

- **F2** — composite PK already serves leftmost-prefix lookups; redundant index would regress write-path perf.
- **F7** — per-user keying is already correct under the "limit on a human's typing rate" framing the spec defends.

Both rejections are now defended in the spec body so the next reviewer doesn't re-litigate.

## Outcome

**READY_FOR_BUILD (round 1 closed).** All blocking class findings (F1, F3) applied. All "strongly recommended" items (F4, F6, F8) applied. Both rejections (F2, F7) carry inline rationale in the spec. The architect gate remains the next checkpoint per `tasks/current-focus.md`.

## Caller-handled follow-ups

- None — all decisions were applied or rejected with rationale recorded in the spec.
- `tasks/todo.md` route NOT triggered (no directional findings deferred for follow-up work).

## References

- Spec: `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
- Spec-reviewer log: `tasks/review-logs/spec-reviewer-log-pre-prod-boundary-and-brief-api-*.md` (3 iterations, 42 mechanical fixes pre-ChatGPT).
- Framing: `docs/spec-context.md` — pre-production, rapid evolution, no feature flags, prefer existing primitives.
