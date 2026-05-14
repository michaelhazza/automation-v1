# Spec Review Iteration 3 — support-desk-canonical

**Spec:** `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`
**Spec commit at iteration start:** `7147fec7`
**Iteration:** 3 of MAX_ITERATIONS (5)

## Codex findings (2 distinct, both surfaced by iteration 2 edits)

### F13 — Late-link path violates the stated `source_draft_id` writer contract
- Section: §8.5 late-link paragraph, §11.4 source-of-truth precedence
- Type: contradiction (self-introduced by iter 2 fix)
- Codex's fix: amend §11.4 to include the back-link routine as an allowed writer, OR explicitly delegate the upsert-detected write to the reconciliation worker.
- Classification: **mechanical**. Iter 2 added a back-link path that bypassed §11.4's writer set.
- Disposition: **auto-applied** — amended §11.4 to enumerate three writers explicitly: dispatch service (sync-confirm), reconciliation worker (post-`needs_reconciliation`), and the back-link routine (post-upsert, executes the same pure module). Aligned the §8.5 paragraph to cite the bounded writer set.

### F14 — §12 still has a broad manual-action permission guard
- Section: §12 RLS row for `canonical_ticket_drafts`
- Type: ambiguity (residual from iter 2 fix scope)
- Codex's fix: update §12 row to defer to per-route map, or spell out sub-action enforcement on `/manual-resolve`.
- Classification: **mechanical**.
- Disposition: **auto-applied** — rewrote §12 RLS row to spell out the per-route key set and add explicit sub-action enforcement on `/manual-resolve`.

## Stopping heuristic counters (iteration 3)

- mechanical_accepted: 2
- mechanical_rejected: 0
- directional_or_ambiguous: 0
- reclassified_to_directional: 0

## Iteration 3 Summary

- Mechanical findings accepted:  2
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
- Spec commit at start:          7147fec7
- Notes: Both iter-3 findings were direct consequences of iter-2 mechanical fixes. The back-link paragraph (§8.5) and the manual-resolve permission map (§9) each landed as new content that needed downstream-section reconciliation. Iter 3 closes those reconciliation gaps.

## Stopping heuristic decision

Iter 1 (11 mechanical), iter 2 (5 mechanical), iter 3 (2 mechanical). All three rounds had `directional == 0 AND ambiguous == 0 AND reclassified == 0`. The stopping heuristic's "two consecutive mechanical-only rounds" condition triggered after iter 2 already; iter 3 was a confirmation pass. Iter-3 findings were both small reconciliation gaps from iter 2's edits and now resolved.

Recommend running ONE more iteration (iter 4) to confirm the iter-3 fixes don't introduce new gaps. If iter 4 finds zero new issues, the spec is mechanically tight and the loop exits.
