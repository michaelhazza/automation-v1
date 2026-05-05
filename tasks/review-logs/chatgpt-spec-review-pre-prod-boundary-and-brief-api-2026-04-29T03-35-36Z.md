# ChatGPT Spec Review — Pre-Production Boundary + Brief API (Round 4 — final close-out)

**Mode:** manual.
**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
**Branch:** `pre-prod-boundary-and-brief-api`
**Round:** 4 of ≤ 5 lifetime cap. Loop **closed** at this round (user-stated final round).
**Captured at:** 2026-04-29T03-35-36Z
**Spec line count:** 876 → 888 (+12 lines).
**Prior round logs:**
- Round 1: `chatgpt-spec-review-pre-prod-boundary-and-brief-api-2026-04-29T03-12-14Z.md`
- Round 2: `chatgpt-spec-review-pre-prod-boundary-and-brief-api-2026-04-29T03-28-51Z.md`
- Round 3: `chatgpt-spec-review-pre-prod-boundary-and-brief-api-2026-04-29T03-32-54Z.md`

## ChatGPT verdict (round 4)

> "Properly finished. Past 'ready for build' and firmly in architect-signoff territory. … No architectural flaws, no concurrency gaps, no correctness holes, no meaningful missing invariants."

Three small items raised, all clarifications. All applied.

## Findings adjudication

| # | ChatGPT title | Class | Decision | Action |
|---|---|---|---|---|
| R4-1 | Within-window adversarial cardinality airtight rule | Mechanical | Apply | §7.2 — added "Within-window adversarial cardinality (airtight rule)" paragraph. TTL bounds *inter*-window growth, not *intra*-window unique-row creation. The rule: callers with high-cardinality attacker-controlled components MUST either hash the component or enforce an upstream cap (typically a coarser per-IP limiter at the LB / edge). The current call-site set is judged compliant under the second clause: every key includes an IP component whose own per-IP limits cap the rotation rate of the inner free-form component. Future call sites that loosen this implicit cap MUST add explicit hashing or an explicit secondary limiter. |
| R4-2 | Explicit "denied calls still counted" (non-leaky property) | Mechanical | Apply | §7.1 `check()` JSDoc — added "Non-leaky: denied calls still increment the bucket" paragraph: every invocation unconditionally performs the UPSERT before evaluating the limit; a caller that retries a denied request deepens the denial. This is the intended behaviour (punishes scripted retry loops) and is the explicit reason §10.1 classifies retry as `unsafe`. |
| R4-3 | Cleanup-cutoff DB-time consistency | Mechanical | Apply | §6.2.4 batched-DELETE SQL — switched the cutoff from a bound parameter (`$1 = cutoff`) to inline `now() - interval '2 hours'` so the cleanup job reads the same DB clock as the limiter's bucket alignment (§6.2.3 single-logical-timestamp invariant). No application-supplied cutoff parameter is accepted; consistency with §6.2.3 is now structural rather than convention. |

## Outcome

**READY_FOR_BUILD — loop terminally closed.**

### Rollup across all four rounds

| Metric | Count |
|---|---|
| Rounds executed | 4 (of ≤ 5 lifetime cap) |
| Mechanical fixes applied | 24 |
| Directional findings rejected with in-spec rationale | 4 (R1-F2, R1-F7, R2-1, R2-8) |
| Findings deferred to `tasks/todo.md` | 0 |
| Structural / architectural changes | 0 |
| Net spec growth | 762 → 888 lines (+126 lines, all in existing sections; no new top-level sections) |

### Loop-close justification

- ChatGPT stopped on round 3 with "you're done"; user explicitly framed round 4 as the final round.
- All round-4 items were clarification-class — none changed behaviour, signature, or schema.
- No directional rejections this round; no `tasks/todo.md` deferrals across the entire loop.

The spec is now in **architect-signoff territory** per the reviewer's own framing. The architect gate (per `tasks/current-focus.md`) is the next checkpoint.

## Caller-handled follow-ups

- None.
- `tasks/todo.md` route NOT triggered across any of the four rounds.

## References

- Spec (post-round-4 HEAD: 888 lines): `docs/superpowers/specs/2026-04-29-pre-prod-boundary-and-brief-api-spec.md`
- Prior round logs: see header.
- Spec-reviewer logs (pre-ChatGPT): `tasks/review-logs/spec-reviewer-log-pre-prod-boundary-and-brief-api-*.md` (3 iterations, 42 mechanical fixes).
- Framing: `docs/spec-context.md`.
