# Spec Review Log — Iteration 1

**Spec:** `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`
**Iteration:** 1
**Timestamp:** 2026-05-01T12:00:00Z

---

## Codex Output

The spec has multiple workflow-breaking issues: UI mockup runs reference a slug before it exists, Phase 1 never records the documented `PLANNING` state, and the sync sequence fails on the common already-up-to-date case. These problems would prevent the proposed pipeline from operating as described.

Full review comments:

- [P1] Derive the build slug before the mockup loop starts (lines 164-179): For UI-touching briefs, Step 4 asks mockup-designer to write `prototypes/{slug}...` and append each round to `tasks/builds/{slug}/mockup-log.md`, but Step 5 does not create `{slug}` or `tasks/builds/{slug}/` until after the loop.

- [P1] Record `PLANNING` in current-focus before spec work begins (lines 254-269): The state machine requires `NONE -> PLANNING` at spec-coordinator entry, but the only tasks/current-focus.md write in Phase 1 jumps straight to BUILDING.

- [P1] Skip `git merge --abort` on the already-up-to-date path (lines 1587-1590): When origin/main is already merged, `git merge --no-commit --no-ff` exits 0 without creating an in-progress merge, then `git merge --abort` errors with "There is no merge to abort".

- [P2] Detect migration-number collisions from the tree, not recent log snippets (lines 1606-1610): The collision check only prints the last 20 migration commits and never compares filenames or contents. A reused number outside that narrow history window will be missed.

## Findings Extracted (Step 2)

FINDING #1
  Source: Codex
  Section: §1.7 (mockup loop) + §1.8 (slug derivation)
  Description: Mockup loop references `prototypes/{slug}/` before slug/directory is created in Step 5.
  Codex's suggested fix: Move slug derivation (§1.8) before the mockup loop (§1.7).
  Classification: mechanical
  Reasoning: Clear sequencing bug — Step 4 requires outputs of Step 5. No scope/framing change.
  Disposition: auto-apply

FINDING #2
  Source: Codex
  Section: §1.4 (TodoWrite), §1.13 (Step 10), §6.1 (state machine)
  Description: State machine mandates `NONE → PLANNING` at spec-coordinator entry, but no step writes PLANNING; only BUILDING is written (Step 10).
  Codex's suggested fix: Add a step early in spec-coordinator that writes `status: PLANNING`.
  Classification: mechanical
  Reasoning: Sequencing ordering bug — state machine is inconsistent with coordinator steps. Fix aligns them.
  Disposition: auto-apply

FINDING #3
  Source: Codex
  Section: §8.2 (sync command sequence, lines 1618-1633)
  Description: When already up-to-date, `git merge --abort` is called unnecessarily and errors.
  Codex's suggested fix: Detect whether a merge is in progress before aborting.
  Classification: mechanical
  Reasoning: Concrete bash scripting bug in spec's code example. Fix removes erroneous abort.
  Disposition: auto-apply

FINDING #4
  Source: Codex
  Section: §8.3 (migration collision detection, lines 1638-1644)
  Description: `git log ... | head -20` prints 20 entries but never compares filenames for numeric prefix collision.
  Codex's suggested fix: Use file-system based detection to actually compare numeric prefixes.
  Classification: mechanical
  Reasoning: Implementation described doesn't perform the comparison it claims. Fix corrects the algorithm.
  Disposition: auto-apply

## Rubric Pass Findings (Step 4)

FINDING #R1 (consolidated with #2)
  Source: Rubric-sequencing
  Section: §1.4 (TodoWrite list)
  Description: §1.4 TodoWrite list does not include a PLANNING step; same root cause as Finding #2.
  Classification: mechanical (consolidated)
  Disposition: auto-apply (addressed by Finding #2 fix)

FINDING #R2
  Source: Rubric-load-bearing-claim
  Section: §6.2 (last paragraph)
  Description: §6.2 mandates "frontmatter description MUST include Step 1 TodoWrite skeleton" but YAML frontmatter descriptions are one-liners — multi-step skeletons cannot go there. All agents DO have body-level Step 1 sections.
  Classification: ambiguous
  Reasoning: Unclear whether intent was description-field or body-section. Body sections satisfy the spirit.
  Disposition: auto-decide (Step 7)

FINDING #R3
  Source: Rubric-file-inventory
  Section: §6.5 (auto-commit list)
  Description: §6.5 lists files spec-coordinator commits at Phase 1 end but omits `tasks/builds/{slug}/progress.md`, which is created in §1.8 (Step 5).
  Classification: mechanical
  Reasoning: File inventory drift in commit specification. Fix adds progress.md to the commit list.
  Disposition: auto-apply

## Step 5 — Classification Summary

Mechanical (auto-apply): #1, #2, #3, #4, #R1 (consolidated with #2), #R3
Ambiguous (Step 7): #R2
Rejected / N/A: none

## Step 7 — Autonomous Decisions

[AUTO-DECIDED - reject] §6.2 — "frontmatter description MUST include TodoWrite skeleton"
  Reasoning: YAML frontmatter descriptions are by convention one-liners (shown in agent selector UI). A multi-step skeleton cannot be embedded there without breaking YAML parsing. All agents defined in the spec already have a body-level "Step 1 — TodoWrite list" section which satisfies the spirit of the requirement. The §6.2 language is an overspecification — the intent is clearly that every agent have a Step 1 body section, not that the YAML description field contain a skeleton. Spec as-is is correct; the mandate wording in §6.2 should be clarified.
  → Added to tasks/todo.md for deferred review.

## Step 6 — Mechanical Findings Applied

[ACCEPT] §1.7/§1.8 — Slug derivation must precede mockup loop
  Fix applied: Reordered spec-coordinator steps so slug derivation and directory creation (formerly Step 5) occur before the mockup loop (formerly Step 4). Added new step numbering and updated §1.4 TodoWrite list.

[ACCEPT] §1.13/§6.1 — PLANNING status write missing from spec-coordinator
  Fix applied: Added explicit instruction in §1.3 (context loading) to write `status: PLANNING` to current-focus.md after verifying no other feature is in flight. Also added "Update current-focus.md → PLANNING" as item 2 of §1.4 TodoWrite list.

[ACCEPT] §8.2 — git merge --abort on already-up-to-date path
  Fix applied: Replaced the `git diff --cached --quiet` branch with a direct check using `git merge --is-ancestor origin/main HEAD` or by detecting `.git/MERGE_HEAD`. Updated the bash snippet to skip abort when already up-to-date.

[ACCEPT] §8.3 — Migration collision detection uses wrong approach
  Fix applied: Replaced `git log ... | head -20` approach with a file-comparison approach: extract numeric prefixes from both sides and use sort/uniq to find duplicates. Updated bash snippet to actually detect collision.

[ACCEPT] §6.5 — progress.md missing from spec-coordinator auto-commit file list
  Fix applied: Added `tasks/builds/{slug}/progress.md` to the commit file list in §6.5.

## Iteration 1 Summary

- Mechanical findings accepted:  5 (Findings #1, #2, #3, #4, #R3)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            1 (Finding #R2)
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 1
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             1 (see tasks/todo.md for details)
- Spec commit after iteration:   [to be set after commit]
