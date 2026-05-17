# Spec Review Iteration 3 — wave-4-architectural-and-duplication

**Iteration:** 3 of 5
**Spec commit at start:** af034537 (iteration 2)
**Timestamp:** 20260516-104032

## Codex output summary
Codex returned 3 findings — all P2-mechanical, surfacing real contradictions left after iteration 2's tightening.

## Findings classification

### FINDING #1 — "Total new files: 10" doesn't reconcile when FE4 default path adds 2+ files
- Source: Codex
- Section: §4.1 intro line
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Numeric reconciliation — under the binding FE4 default, the build creates the IncidentTimeline + IncidentDetailDrawer sub-components, pushing the total to 12 (or 13 if a third is needed). Reframed as a 2-row table: 12 under default-EXTRACT path, 10 under override-ACCEPT path; 13 if chunk 0 decides a third extraction is needed.

### FINDING #2 — Chunk sequencing: chunk 1 wires boot but signatures don't land until chunks 2-3
- Source: Codex
- Section: §4.1 modified-files table + §9 chunks list
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Phase-dependency rubric. If chunk 1 wires `buildHandlerContext()` into handler registration but the registration signature doesn't accept the context until chunk 2, chunk 1 references APIs that don't exist yet. Moved boot wiring to chunk 4 (where the signature exists in both chunks 2 + 3 and the `check:circular` verification also lands). Updated §4.1 row, §5.2.1 Producer field, and §9 chunks-1-4 narrative.

### FINDING #3 — DUP8 contradiction: "in this build or defer them" vs §12 "None deferred"
- Source: Codex
- Section: §6.7 vs §12 + §4.1
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Cross-section contradiction. Forced the decision now: all 6 prune-job files are migrated in this build (the audit identified 4, but the marginal cost of migrating the other 2 once the factory exists is trivial, keeping the family uniform). Updated DUP8 §6.7 prose, §6.7 acceptance, §1.1 verification row (dropped "with caveat"), and §4.1 modified-files row (now lists all 6 by name).

## Rubric findings (this iteration)
None beyond what Codex caught. The cross-section consistency surfaces are now uniform.

## Decisions log

[ACCEPT] §4.1 intro — Recast total-files count as conditional on FE4 verdict (12 default / 10 override / 13 third-extraction)
[ACCEPT] §4.1 modified-files row + §5.2.1 Producer + §9 chunks 1-4 — Move boot wiring from chunk 1 to chunk 4
[ACCEPT] §6.7 + §1.1 + §4.1 — Decide all 6 prune-job files migrate in this build (removes §12 contradiction)

## Iteration 3 Summary

- Mechanical findings accepted:  3
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Stopping-heuristic counters:
  - mechanical_accepted: 3
  - mechanical_rejected: 0
  - directional_or_ambiguous: 0
- Spec commit after iteration: pending Step 8b commit

## Stopping heuristic evaluation (for after iter3 commit)

Iteration 2 was mechanical-only (0 directional). Iteration 3 is also mechanical-only (0 directional). **Two consecutive mechanical-only rounds.** The stopping heuristic triggers — exit after this commit without running iteration 4. Final report follows.
