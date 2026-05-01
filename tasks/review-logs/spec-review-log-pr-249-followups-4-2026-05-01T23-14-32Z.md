# Spec Review Log — Iteration 4

- **Spec:** `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md`
- **Iteration:** 4 of 5
- **Spec commit at start:** `75630605ce28e7ea6c54bfcdced63f3d930fee65`
- **Codex version:** v0.118.0

---

## Findings

### FINDING #1 — Task 7 doc-sync verdicts have no recording destination

- **Source:** Codex
- **Section:** Task 7, lines 233-235
- **Description:** Task 7 mandates a verdict (`yes (sections X, Y)` / `no — <rationale>` / `n/a`) per registered doc and references doc-sync.md's investigation procedure, but never says where in this PR's deliverables the verdicts live. doc-sync.md only defines verdict slots for review-log final summaries (e.g. chatgpt-pr-review log), not for the spec under build. Without a destination, the acceptance criterion is unverifiable.
- **Codex's suggested fix (paraphrase):** Specify the destination — either the PR description, the build-slug progress.md, or a new sub-table in the spec's Self-review section.
- **Classification:** mechanical
- **Reasoning:** Load-bearing acceptance criterion (Task 7 must be verified) without a backing slot — same rubric category as iterations 2 and 3. Surgical fix.
- **Disposition:** auto-apply. Pick the *PR description* as the destination — it's the canonical post-build deliverable for this spec, will land alongside the lint-typecheck-post-merge-tasks closing log, and survives in git history; this matches how PR #249's own doc-sync verdicts were recorded.

### FINDING #2 — Definition of Done references ambiguous tasks/todo.md labels

- **Source:** Codex
- **Section:** Definition of Done line 311
- **Description:** Spec says "tasks/todo.md backlog entries for N-2, N-4, F3-cgpt, F4-cgpt, F6-cgpt marked `[x]` or removed." But tasks/todo.md has multiple unrelated `N-2` and `N-4` entries (lines 1033, 1035, 2209, 2211 plus the spec-relevant 2228, 2230). An implementer could check off the wrong ones.
- **Codex's suggested fix:** Quote the full title of each post-build entry, or reference the source-log section so disambiguation is mechanical.
- **Classification:** mechanical
- **Reasoning:** Ambiguous reference — fix is to disambiguate by section heading (the post-build entries are all under `### PR #249 — lint-typecheck-post-merge-tasks — post-build pr-reviewer pass (2026-05-01T07:36 UTC)` and `### PR #249 — lint-typecheck-post-merge-tasks — chatgpt-pr-review round 1 (2026-05-01T08:50 UTC)`).
- **Disposition:** auto-apply

---

## Rubric pass (my own findings)

No additional rubric findings. Both Codex findings are real and well-scoped.

---

## Adjudication and implementation

### [ACCEPT] Task 7 — verdict destination
Fix applied: add a one-line destination instruction at the end of Task 7 — verdicts go in the closing PR description under a "## Doc-sync verdicts" section. Lists each registered doc with its verdict.

### [ACCEPT] Definition of Done — disambiguate tasks/todo.md entries
Fix applied: replace the bare "N-2, N-4, F3-cgpt, F4-cgpt, F6-cgpt" reference with the source-log section headings + the specific post-build labels, so the implementer is checking off the correct entries.

---

## Iteration 4 Summary

- Mechanical findings accepted:  2
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   <to be filled after edits>
