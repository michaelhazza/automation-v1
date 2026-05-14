# ChatGPT Spec Review — Pre-Production Boundary + Brief API (Round 3 — final)

**Mode:** manual.
**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
**Branch:** `pre-prod-boundary-and-brief-api`
**Round:** 3 of ≤ 5 lifetime cap (loop closed at this round per ChatGPT's own verdict).
**Captured at:** 2026-04-29T03-32-54Z
**Spec line count:** 863 → 876 (+13 lines).
**Prior rounds:**
- Round 1: `chatgpt-spec-review-pre-prod-boundary-and-brief-api-2026-04-29T03-12-14Z.md`
- Round 2: `chatgpt-spec-review-pre-prod-boundary-and-brief-api-2026-04-29T03-28-51Z.md`

## ChatGPT verdict

> "You're done. This is architect-ready. … There are no structural gaps left. What remains are edge-condition clarifications, not design flaws. … Further rounds will produce diminishing returns and likely introduce overengineering."

Round 3 was explicitly framed by the reviewer as the loop-close round.

## Findings adjudication

All six items were mechanical doc-hardening with no design change. Applied in one pass.

| # | ChatGPT title | Class | Decision | Action |
|---|---|---|---|---|
| R3-1 | Negative `elapsedFractionOfCurrentWindow` guard | Mechanical | Apply | §6.2.3 — clamp `[0, 1]` made **mandatory** in spec text (was previously parenthetical "clamped to `[0, 1)`"); rationale ties out to leap-second adjustments and float rounding drift between `floor()` and `extract(epoch)`; pure-helper unit-test surface widened to include the two slightly-out-of-range inputs (`-1e-9`, `1 + 1e-9`). |
| R3-2 | Single-logical-timestamp-per-statement invariant | Mechanical | Apply | §6.2.3 — added explicit invariant bullet: `now()` (= `transaction_timestamp()`) is the only timestamp source the CTE may read; `clock_timestamp()` and any application-supplied parameter are spec-conformance violations. Multi-instance-safety property explicitly tied to this invariant so future "optimisation" attempts are flagged at review time. |
| R3-3 | `remaining` non-monotonic guarantee | Mechanical | Apply | §7.1 `RateLimitCheckResult.remaining` doc — added "Instantaneous estimate, not a monotonic sequence" paragraph: explains that sliding-window de-weighting can cause `remaining` to *increase* between successive calls; treat as a UX hint, not a client-side counter. Pre-empts "remaining went up, is this a bug?" reports. |
| R3-4 | Cleanup ordering-bias note | Mechanical | Apply | §6.2.4 — added "Ordering-bias note" paragraph: `ORDER BY window_start` deletes oldest expired rows first, so under backlog the cleanup biases towards old tail rather than per-key fairness; recorded explicitly so the bias isn't read as oversight. |
| R3-5 | `rate_limit.near_capacity` early-warning emission | Directional (cheap doc, deferred) | Apply (deferred) | §13 — added `rate_limit.near_capacity` deferred entry: future enhancement to emit an info-level signal when `effectiveCount / limit ≥ threshold` (e.g. 0.8); explicitly recorded so the next reviewer doesn't re-propose it as missing. |
| R3-6 | Explicit 429-path integration-test gap callout | Mechanical | Apply | §12 *Out of scope for testing* — added "Route-level 429 path on `/api/session/message` is not integration-tested" bullet: T1–T8 cover 200/401/error arms but deliberately stop short of fire-31-requests-expect-429; correctness of the 429 path relies on the primitive's pure-unit test plus static inspection of middleware chain ordering. Same posture extends to every other 429-bearing route in §6.2.5. |

## Outcome

**READY_FOR_BUILD — loop closed.**

- 0 structural changes across rounds 1–3.
- 0 directional findings deferred to `tasks/todo.md` across rounds 1–3.
- 4 directional findings rejected with in-spec rationale across rounds 1–3 (R1-F2, R1-F7, R2-1, R2-8).
- 21 mechanical fixes applied across rounds 1–3.
- Spec growth: 762 → 876 lines (+114 lines, all in existing sections; no new top-level sections).

ChatGPT itself stopped on this round, and round 3 was mechanical-only — the second consecutive mechanical-only round, which is the standard early-stop trigger in our `spec-reviewer` protocol. Loop closed; further rounds would produce diminishing returns and risk overengineering (per the reviewer's own framing).

## Next step

Architect gate — per `tasks/current-focus.md`. The spec is no longer in the ChatGPT loop.

## Caller-handled follow-ups

- None — all decisions applied or rejected with in-spec rationale.
- `tasks/todo.md` route NOT triggered.

## References

- Spec: `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md` (post-round-3 HEAD: 876 lines).
- Prior round logs (this directory): `chatgpt-spec-review-pre-prod-boundary-and-brief-api-2026-04-29T03-12-14Z.md`, `chatgpt-spec-review-pre-prod-boundary-and-brief-api-2026-04-29T03-28-51Z.md`.
- Spec-reviewer logs: `tasks/review-logs/spec-reviewer-log-pre-prod-boundary-and-brief-api-*.md` (3 iterations, 42 mechanical fixes pre-ChatGPT).
- Framing: `docs/spec-context.md`.
