# Spec Review Log — Iteration 2

- **Spec:** `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md`
- **Iteration:** 2 of 5
- **Spec commit at start:** `dcd7159bc7368e60e5ca33477f00613192785a22`
- **Codex version:** v0.118.0

---

## Findings

### FINDING #1 — Task count mismatch ("5 tasks" → 7 tasks)

- **Source:** Codex
- **Section:** Classification line 13, Contents lines 26-38, DoD line 271
- **Description:** Spec line 13 states "Standard. 5 tasks, single concern (cleanup)" but the Contents section enumerates 7 tasks (Task 1 — Pre-flight; Tasks 2-6 are the five backlog items; Task 7 — Doc-sync) and the DoD at line 271 says "All 7 tasks above complete and verified."
- **Codex's suggested fix:** Update classification text to say 7 tasks, or "5 backlog tasks plus pre-flight and doc-sync."
- **Classification:** mechanical
- **Reasoning:** Pure consistency fix — internal contradiction between Classification, Contents, and DoD.
- **Disposition:** auto-apply

### FINDING #2 — Stale eslint-disable inventory baseline (Task 5.1)

- **Source:** Codex
- **Section:** Task 5.1 lines 148-152, Task 5.3 line 164
- **Description:** Two specific drift problems. (a) Spec at line 150 lists 5 files for `no-useless-assignment` totalling 7 occurrences (skillAnalyzerJob 1 + llmRouter 1 + mcpClientManager 2 + executionLoop 3 = 7), not "5×" as the prefix says. (b) Spec assumes a baseline of 12 disables; current codebase has 61 occurrences across 28 files. The "12 → 9" example acceptance framing is no longer accurate.
- **Codex's suggested fix:** Refresh inventory with current numbers, or scope explicitly (e.g. only PR #249-added disables) and remove stale example counts.
- **Classification:** mechanical
- **Reasoning:** File-inventory drift — exactly the rubric category. Fix is to remove the stale baseline counts and lean on the inventory grep as the source of truth (the goal of an audit is to be honest about current state, not to anchor on a stale baseline).
- **Disposition:** auto-apply

### FINDING #3 — Task 6 (Record<string, unknown> audit) scope vs Standard classification

- **Source:** Codex
- **Section:** Task 6.1 line 185
- **Description:** Codex says the requested grep scope returns "hundreds to over a thousand" matches across the listed dirs. I confirmed 510 occurrences across 200 files. Codex argues this is too open-ended for a Standard cleanup PR.
- **Codex's suggested fix:** Narrow scope to a concrete subset (newly added casts, specific files from the review backlog), or reclassify to a larger follow-up with chunked deliverables.
- **Classification:** directional
- **Reasoning:** This is a scope/sequencing decision (split this item / defer some / re-bound the task). Matches the directional signal "split this item into two" / "defer this until later" / "this should be Phase N." Not a mechanical consistency fix — Codex is asking for a different shape of work.
- **Disposition:** AUTO-DECIDED → reject (route to tasks/todo.md as a deferred consideration)
- **Reasoning for AUTO-DECIDED:**
  - Priority 1 (framing): no framing assumption matches; this isn't about flags/tests/rollout/posture.
  - Priority 2 (convention): no specific CLAUDE.md/architecture.md rule on audit scope.
  - Priority 3 (best judgment): prefer spec as-is. The spec already has explicit acceptance criteria (A/B/C tallies, per-callsite framing, no mechanical sweep), an Out-of-Scope section that explicitly carves the discriminated-union refactor as a separate spec, and a "Risk: medium" warning. The implementer can pace and split if execution proves intractable. Arbitrary scope-cut risks dropping legitimately important per-callsite fixes. The volume is large but the work is well-bounded by its acceptance criteria. If 510 turns out to be intractable in practice, the implementer can raise it during execution and split — that decision is better made with execution data, not in the spec.
  - **Routed to tasks/todo.md**: "Spec pr-249-followups Task 6 covers ~510 `Record<string, unknown>` callsites — if the per-callsite audit proves too long for one PR, consider re-scoping to bounded subset (e.g. only the F6 backlog files, only newly-added casts). Decision deferred to execution time."

### FINDING #4 — "Task self-review" location undefined (Tasks 5.3, 6.4)

- **Source:** Codex
- **Section:** Task 5.3 line 164, Task 6.4 line 204, "Self-review against backlog source" section line 257
- **Description:** Both Task 5 and Task 6 require recording final tallies "in the task self-review" but the spec doesn't define where that lives or what format. The existing "Self-review against backlog source" section is a coverage table only — no slots for F4 disable counts or F6 A/B/C tallies.
- **Codex's suggested fix:** Add a small required subsection under each task with explicit fields, OR extend the Self-review section with explicit slots.
- **Classification:** mechanical
- **Reasoning:** Load-bearing reference (acceptance criteria depend on tallies being recorded) without a backing structure — the rubric "load-bearing claim without a mechanism" category. Surgical fix: add tally slots under each task.
- **Disposition:** auto-apply

---

## Rubric pass (my own findings)

| Rubric category | Result |
|---|---|
| Contradictions between sections | Caught by Codex Finding #1 (5 vs 7 tasks) |
| Stale retired language | None |
| Load-bearing claims without mechanism | Caught by Codex Finding #4 (self-review location) |
| File inventory drift | Caught by Codex Finding #2 (eslint-disable baseline) |
| Schema overlaps | N/A |
| Sequencing ordering bugs | None |
| Invariants stated but not enforced | None |
| Missing per-item verdicts | All 7 tasks have explicit goals and success conditions |
| Unnamed new primitives | None |
| Spec-authoring checklist compliance | All applicable sections satisfied |
| Test-gate violations | None |
| Spec/mockup divergence | None |

No additional rubric findings beyond Codex's.

---

## Adjudication and implementation

### [ACCEPT] Classification — task count
Fix applied: change "5 tasks" to "7 tasks (5 backlog items + pre-flight + doc-sync)" in Classification line 13.

### [ACCEPT] Task 5.1 — stale inventory baseline
Fix applied: remove the stale `12 disables` and `5×`/`3×`/`4×` breakdown narrative; replace with "the inventory grep is the source of truth — do NOT anchor on stale historical counts." Rephrase Task 5.3's verification example to drop the stale "12 → 9" framing.

### [REJECT - directional, AUTO-DECIDED] Task 6 — scope
Reason: spec already has clear acceptance criteria (A/B/C tallies + per-callsite framing + out-of-scope carve-out for the discriminated-union refactor). Routed to tasks/todo.md as deferred consideration for execution-time re-scoping if intractable.

### [ACCEPT] Tasks 5.3, 6.4 — self-review location
Fix applied: extend the "Self-review against backlog source" section with two new sub-tables: (a) F4 audit tallies (initial count → final count, redundant removed, kept-with-justification), (b) F6 audit tallies (initial inventory → A/B/C counts). Each task body's "document in self-review" line now points at the specific sub-table.

---

## Iteration 2 Summary

- Mechanical findings accepted:  3
- Mechanical findings rejected:  0
- Directional findings:          1
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 1
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             1 (Finding #3 → routed to tasks/todo.md)
- Spec commit after iteration:   `8121453b6f75aaf6f806a598cb290a6b998ccac9`
