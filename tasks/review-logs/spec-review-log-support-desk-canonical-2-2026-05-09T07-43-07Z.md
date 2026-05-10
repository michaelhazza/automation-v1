# Spec Review Iteration 2 — support-desk-canonical

**Spec:** `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`
**Spec commit at iteration start:** `b1745ff8`
**Iteration:** 2 of MAX_ITERATIONS (5)

## Codex findings (5 distinct, all surfaced by iteration 1 edits)

### F8 — Manual "Mark sent" can't both be terminal and later corrected (CRITICAL)
- Section: §8.5, §11.4, §14.4
- Type: contradiction (self-introduced by iter 1 fix)
- Codex's fix: pick one — keep `sent` terminal, remove "switch to Mark failed later" claim, allow a back-link worker to attach a later provider-confirmed message without changing draft state.
- Classification: **mechanical**. The iter 1 edit overcorrected.
- Disposition: **auto-applied** — rewrote §8.5 to make `sent` strictly terminal, added a "Late linking" paragraph explaining the back-link bookkeeping path runs from the message-upsert (§7) and uses the pure module from §8.4. Removed the "operator can switch to Mark failed later" claim. Added paragraph stating Mark sent is the operator's terminal answer; no auto-switch.

### F9 — Manual-resolve route lacks a permission contract
- Section: §8.5, §10, §12, §18
- Type: missing-contract
- Codex's fix: map manual actions to existing keys: `mark_sent` and `retry_reconciliation` → `support.draft.approve`; `mark_failed` → `support.draft.reject`.
- Classification: **mechanical**.
- Disposition: **auto-applied** — added explicit guards to §9 permission keys, §10 access-control list, §18 routes.

### F10 — C12 phase plan omits `support.reject_draft`
- Section: §3 C12, §9, §18
- Type: drift (residual from iter 1 fix scope)
- Codex's fix: add `support.reject_draft` to C12 chunk row.
- Classification: **mechanical**.
- Disposition: **auto-applied**.

### F11 — §1 framing wording vs §20 testing posture / collision-window boundary
- Section: §1 framing, §18 tests inventory, §20 testing posture
- Type: contradiction
- Codex's fix: change §1 to "no non-pure Vitest" and reconcile boundary list with §20.
- Classification: **mechanical**.
- Disposition: **auto-applied** — rewrote §1 line 80 to refer to §20 boundaries explicitly and clarify that idempotency-key derivation rolls into the draft-transition test (matches §20 line 1758).

### F12 — Acceptance count "ten" but SUPPORT_LOG_CODES now has 15
- Section: §17.1 line 1575
- Type: ambiguity (residual from iter 1 R4a/R4b fix)
- Codex's fix: reword §17.1 to count the operational ten plus the five lifecycle terminals.
- Classification: **mechanical**.
- Disposition: **auto-applied**.

## Rubric pass — no new rubric findings

Re-ran the rubric checklist (file inventory drift, contradictions, state-machine closure, contract examples, sequencing). No new issues uncovered beyond Codex's iter 2 set. The §8.4 / §8.5 / §11.4 invariant chain is now internally consistent.

## Stopping heuristic counters (iteration 2)

- mechanical_accepted: 5
- mechanical_rejected: 0
- directional_or_ambiguous: 0
- reclassified_to_directional: 0

## Iteration 2 Summary

- Mechanical findings accepted:  5
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
- Spec commit at start:          b1745ff8
- Spec line count: 1889 → ~1900 (small additions to §1, §8.5, §9, §10, §17.1, §18, plus C12)

## Stopping heuristic decision

Iteration 1 had 11 mechanical-only findings; iteration 2 had 5. Both rounds were mechanical-only (no directional/ambiguous). That triggers the "two consecutive mechanical-only rounds" exit condition — the spec has converged on its current framing and further iterations are unlikely to surface new directional concerns. Exit before cap.
