# Spec Review Iteration 3 Log — feat-split-subaccountknowledgepage

## Codex findings (7) — classification

- C3.1 mechanical — Insights count delta: host can no longer source `insights.length` for the tab bar after the state moves into the unmounted-when-inactive InsightsTab → applied (acknowledged as a §12 minor delta; rewrote §13 smoke test accordingly)
- C3.2 mechanical — "insight leaves the Insights list" only observable after returning to insights → applied (smoke test now explicitly says "Returning to the Insights tab then refetches and confirms the promoted insight no longer appears")
- C3.3 mechanical — Chunk 1 "host imports the four new modules" includes the test file → applied (now reads "three new runtime modules: types, format, TabButton")
- C3.4 mechanical — RenameReferenceModal props under-specified → applied (added `onRename(newTitle: string): Promise<void>`; named what the modal owns; named what the parent wraps)
- C3.5 mechanical — `atoms/` allowance contradicts "no other sub-files" + unnamed atoms → applied (removed `atoms/` entirely; rationale: no shared atoms across the three tabs today)
- C3.6 mechanical — useEffect dep array missing `onCreateConsumed` → applied (added to deps + host useCallback stabilisation in both §8.2 and §8.4)
- C3.7 mechanical-REJECT — `renameReferenceHtml` "verbatim" vs §9 escaping cases. Verified at source line 37: `const safe = newTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();` — the helper DOES escape `<` and `>` today. Test cases match current behaviour byte-for-byte. No spec change needed.

## Rubric findings — none new

The iteration-2 fixes plus the iteration-3 changes have resolved the self-consistency gaps. The remaining language is internally consistent: §6 tree props match §8 prop contracts, §7 prose ordering matches §8 callback ordering, §12 lists all behaviour deltas explicitly, §13 acceptance criteria align with §10 chunks.

## Counts

- mechanical_accepted: 6 (all from Codex)
- mechanical_rejected: 1 (C3.7 — source verification disproved the finding)
- directional_or_ambiguous: 0
- reclassified: 0

## Iteration 3 Summary

- Mechanical findings accepted:  6
- Mechanical findings rejected:  1
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
- Spec commit after iteration:   (pending commit)
