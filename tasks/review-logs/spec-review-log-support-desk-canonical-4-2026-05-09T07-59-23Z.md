# Spec Review Iteration 4 — support-desk-canonical

**Spec:** `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`
**Spec commit at iteration start:** `a1ec6502`
**Iteration:** 4 of MAX_ITERATIONS (5)

## Codex findings (1 distinct, surfaced by iteration 2 + iter 3 edits)

### F15 — Late back-link excludes internal-note drafts
- Section: §8.5 late-link paragraph, §5.2 message direction enum, §8.3 phase 3, §9 skill surface
- Type: invariant-gap (self-introduced by iter 2 fix)
- Codex's fix: broaden the §8.5 back-link predicate from `direction = 'outbound'` to `direction IN ('outbound', 'internal_note')` with visibility-matched constraints.
- Classification: **mechanical**.
- Disposition: **auto-applied** — broadened the predicate and added the visibility-match disambiguation rule (public reply ↔ outbound, internal note ↔ internal_note).

## Stopping heuristic counters (iteration 4)

- mechanical_accepted: 1
- mechanical_rejected: 0
- directional_or_ambiguous: 0
- reclassified_to_directional: 0

## Iteration 4 Summary

- Mechanical findings accepted:  1
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
- Spec commit at start:          a1ec6502

## Stopping heuristic decision

Iter 1 (11), iter 2 (5), iter 3 (2), iter 4 (1) — all four rounds mechanical-only, monotonically decreasing finding count. The cap is 5 iterations and we're at 4. Iter 5 should confirm the iter-4 fix doesn't introduce a new gap. If it doesn't, the spec is mechanically tight and the loop exits. If it does, we'll have to surface the residual issue and stop at the cap.
