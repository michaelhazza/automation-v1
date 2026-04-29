# ChatGPT Spec Review — Pre-Production Boundary + Brief API (Round 2)

**Mode:** manual (no `chatgpt-spec-review` agent loop; reviewer submitted feedback inline; main session adjudicated and applied edits).
**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
**Branch:** `pre-prod-boundary-and-brief-api`
**Round:** 2 (round 1 log: `chatgpt-spec-review-pre-prod-boundary-and-brief-api-2026-04-29T03-12-14Z.md`)
**Captured at:** 2026-04-29T03-28-51Z
**Spec line count:** 806 → 863 (+57 lines, all in existing sections).

## Framing assumptions applied

Same baked-in framing as round 1: pre-production, rapid evolution, no feature flags, prefer existing primitives.

## ChatGPT verdict

> "Tight and close to build-ready. … Blocking issues: none. Should-fix before build: 1, 2, 3 (DB protection, time source, cleanup batching). If you tighten those three, this moves from 'good spec' to 'production-grade foundation.'"

Round 2 explicitly framed the spec as already non-blocking; ChatGPT's "should-fix" list was operational hardening, not correctness gaps.

## Findings adjudication

| # | ChatGPT title | Class | Decision | Action |
|---|---|---|---|---|
| R2-1 | Global in-memory backstop limiter (DB amplification) | Directional | **REJECT** | §6.2.3 — added explicit "No in-process pre-check" paragraph: an in-process pre-check would re-introduce the multi-process / multi-instance fragmentation pathology that motivated replacing the existing Map limiters in §4. The correct mitigation for DB amplification is upstream (LB / CDN rate-limit, `statement_timeout`), not another in-process layer. Pre-prod has no live users, so there is no DDoS surface to harden against; the kill switch (raise per-call-site `limit` constants) covers manual recovery. |
| R2-2 | DB time as window-alignment source | Mechanical (correctness) | Apply | §6.2.3 — rewrote the CTE so window boundaries are derived from `extract(epoch from now())` inside the SQL statement; positional binds reduced to `$1=key, $2=windowSec`; CTE returns `curr_window_start, now_epoch, curr_epoch` so the application's `elapsedFraction` is also DB-anchored. §7.1 — `resetAt` doc updated to reference the DB-computed `curr_window_start` and explicitly forbid recomputation from `Date.now()`. Multi-instance bucket fragmentation is closed by construction. |
| R2-3 | Cleanup job batching + iteration bound | Mechanical | Apply | §6.2.4 — replaced the unbounded `DELETE` with a batched pattern (`LIMIT 5000` + `FOR UPDATE SKIP LOCKED` + loop until `< 5000` returned or 20-iteration cap). Cap reached emits `logger.warn('rate_limit.cleanup_capped', { rowsDeleted, iterations })`. |
| R2-4 | `(key)`-only index future-trigger note | Mechanical (cheap doc) | Apply | §7.2 — appended a "Future-trigger condition" paragraph to the existing "No separate `(key)` index" preempt: `>50 ms` sustained latency on `WHERE key = $1` lookups fires the trigger to add the index despite the write-path cost. Pre-empts re-litigation. |
| R2-5 | Retry-After exponential-backoff guidance | Mechanical (cheap doc) | Apply | §7.1 — added "Client retry guidance" paragraph: clients SHOULD layer jittered exponential backoff seeded with `Retry-After`, not retry exactly at the header instant. Server-side `+1` buffer rejected as cosmetic. Future client surfaces that retry on 429 must verify backoff at spec-author time. |
| R2-6 | Multer tmp cleanup log escalation | Mechanical | Apply | §6 Phase 1 — bumped the unlink failure log from `debug` to `warn` for non-`ENOENT` errors; comment block enumerates the meaningful error shapes (`EACCES`, `ENOSPC`, `EBUSY`). §10.6 — updated the idempotency / retry classification text to match the new warn-level signal. Recurring leaks now surface in log aggregation rather than disappearing into debug noise. (The per-failure threshold counter ChatGPT proposed was rejected as over-engineering — the warn-level signal is sufficient observability for pre-prod scale.) |
| R2-7 | Circuit breaker on DB failure | Directional (cheap doc) | Apply (deferred) | §13 — added "Circuit breaker on rate-limit DB unavailability" deferred entry: future enhancement to selectively relax limits on lower-criticality public routes when DB writes time out. Out of scope here (no live users; kill-switch covers manual recovery). Recorded so the next reviewer doesn't propose an in-process backstop as a substitute (cross-references §6.2.3 *No in-process pre-check*). |
| R2-8 | Session message key IP component | Directional | **REJECT** | Same rationale as round 1 F7 (already defended in §6.1 — per-user keying is the correct frame: a user toggling between orgs is one human typing). ChatGPT's "shared accounts" / "API misuse via single user token" framings are not blocked by an additional IP component (a shared account on one network would still hit the same `(user, ip)` bucket). Not applied. |
| R2 polish-a | Max key length explicit | Mechanical | Apply | §7.2 schema-table `key` column note rewritten: "Documented expectation: ≤ 256 chars; callers MUST keep keys within this bound (no DB-side `CHECK` constraint — pathological keys are a caller bug, not a DB-enforced invariant)." |
| R2 polish-b | Hashed-key example inline | Mechanical | Apply | §7.2 *Key cardinality* — inserted a TypeScript snippet demonstrating the 16-char SHA-256 hex prefix pattern (64-bit collision space, fixed-width key component). Distinguishes between cardinality bounding (16 chars sufficient) and adversarial collision resistance (full 64 chars). |
| R2 polish-c | Body-parser ordering | Mechanical | Apply | §6.1 *Middleware ordering invariant* — prepended `[global express.json() body-parser] → ` to the chain documentation; explicit note that body parsing precedes the rate-limit middleware (the limiter charges before the route handler rejects malformed bodies, which is the desired behaviour against scripted abuse). |

## Rejections re-stated (so the next reviewer doesn't re-litigate)

- **R2-1** — pre-empted in §6.2.3 with an explicit "No in-process pre-check" rationale that ties back to §4 (the entire spec premise) and §10.5 (the kill-switch is the documented operational mitigation).
- **R2-8** — already defended in §6.1; no spec change required this round.

## Summary of changes (file-by-file)

- `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
  - §6 Phase 1 — multer cleanup log level escalated to `warn`; comment lists meaningful error shapes.
  - §6.1 — middleware ordering chain prepended with body-parser; per-user keying rationale strengthened.
  - §6.2.3 — CTE rewritten with DB-time window alignment; "No in-process pre-check" pre-empt added.
  - §6.2.4 — batched-DELETE pattern with `FOR UPDATE SKIP LOCKED` + 20-iteration cap + capped-warn signal.
  - §7.1 — `resetAt` doc anchored on DB-computed `curr_window_start`; *Client retry guidance* paragraph added.
  - §7.2 — `key` column expectation tightened to ≤ 256 chars; hashed-key TS snippet inserted; future-trigger condition for `(key)` index appended.
  - §10.6 — idempotency / retry classification text updated to reflect warn-level cleanup signal.
  - §13 — added circuit-breaker deferred entry; cross-reference to §6.2.3 baked in.

## Outcome

**READY_FOR_BUILD (round 2 closed).** Three should-fix items applied (R2-2 DB time, R2-3 cleanup batching, R2-1 explicitly rejected with rationale). Five mechanical/polish items applied. Two directional rejections both pre-empted in-spec. No `tasks/todo.md` deferrals beyond the two cheap doc-only future-enhancement notes already lifted into §13.

The architect gate remains the next checkpoint per `tasks/current-focus.md`. Recommend stopping the ChatGPT loop here — round 2 explicitly returned "blocking issues: none" and round-3 returns are diminishing.

## Caller-handled follow-ups

- None — all decisions were applied or rejected with rationale recorded in the spec.
- `tasks/todo.md` route NOT triggered (no directional findings deferred for follow-up work).

## References

- Spec: `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md` (post-round-2 HEAD: 863 lines).
- Round 1 log: `tasks/review-logs/chatgpt-spec-review-pre-prod-boundary-and-brief-api-2026-04-29T03-12-14Z.md`.
- Spec-reviewer logs: `tasks/review-logs/spec-reviewer-log-pre-prod-boundary-and-brief-api-*.md` (3 iterations, 42 mechanical fixes pre-ChatGPT).
- Framing: `docs/spec-context.md`.
