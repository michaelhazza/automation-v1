# Spec Review Log — Iteration 3

- **Spec:** `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md`
- **Iteration:** 3 of 5
- **Spec commit at start:** `8121453b6f75aaf6f806a598cb290a6b998ccac9`
- **Codex version:** v0.118.0

---

## Findings

### FINDING #1 — Task 7 doc-sync verdict rule misaligned with `docs/doc-sync.md`

- **Source:** Codex
- **Section:** Task 7, lines 222-232
- **Description:** Task 7 says "**Verdict format per doc:** record `yes — <summary>` or `no — <reason>` per the `docs/doc-sync.md § Verdict rule`. Bare `no` verdicts are treated as missing." But `docs/doc-sync.md § Verdict rule` actually defines THREE valid verdicts: `yes (sections X, Y)`, `no — <rationale>`, and `n/a`. The spec's Task 7 also pre-labels several docs as `n/a` in its own checklist (`docs/capabilities.md — n/a`, `docs/integration-reference.md — n/a`, etc.) — internally inconsistent with its own "yes/no only" rule. Additionally Task 7 doesn't reference doc-sync.md's *Investigation procedure* (§3 of doc-sync.md) which is the gate for assigning any verdict.
- **Codex's suggested fix:** Change verdict rule to `yes — ... | no — ... | n/a` and instruct the implementer to follow doc-sync.md's investigation procedure for every registered doc.
- **Classification:** mechanical
- **Reasoning:** Internal contradiction (rule says yes/no only but examples use n/a) AND stale reference (rule misquotes doc-sync.md's actual three-verdict format). Surgical fix.
- **Disposition:** auto-apply

### FINDING #2 — F6 deferred-follow-up has no recording slot in Self-review

- **Source:** Codex
- **Section:** Task 6.3 line 198, F6 audit tallies sub-table
- **Description:** Task 6.3 instructs the implementer to "note the deferred work under the F6 task self-review" but the F6 audit-tallies sub-table I added in iteration 2 only has slots for A/B/C counts and net totals — no slot for the deferred discriminated-union follow-up. The F6 deferred consideration was already routed to `tasks/todo.md` in iteration 2, so the cleanest fix is to point Task 6.3 at `tasks/todo.md` as the canonical record (rather than adding redundant rows in the spec).
- **Codex's suggested fix:** Add an explicit "Deferred follow-up preserved" row, OR state that no new self-review note is needed because tasks/todo.md is canonical.
- **Classification:** mechanical
- **Reasoning:** Load-bearing reference (Task 6.3 says "note in self-review") without a backing slot — same rubric category as iteration 2's Finding #4. Surgical fix.
- **Disposition:** auto-apply (option 2: point at tasks/todo.md as canonical)

---

## Rubric pass (my own findings)

No additional rubric findings. Both Codex findings are real, both fall under categories the rubric flags (contradictions, load-bearing claims without mechanism). Nothing else surfaces on this pass — the spec's framing, file inventory, sequencing, contracts, and execution-safety sections are all consistent.

---

## Adjudication and implementation

### [ACCEPT] Task 7 — verdict rule
Fix applied: change verdict rule from "yes/no" to "yes/no/n/a" with the rationale requirements from doc-sync.md § Verdict rule, and add a one-line pointer to doc-sync.md's Investigation procedure as the gate for assigning any verdict.

### [ACCEPT] Task 6.3 — deferred-follow-up preservation
Fix applied: replace "note the deferred work under the F6 task self-review" with "this deferred consideration is recorded in `tasks/todo.md` § *Deferred spec decisions — pr-249-followups*; no new spec-side note required." Point at the canonical record rather than duplicating it.

---

## Iteration 3 Summary

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
- Spec commit after iteration:   `75630605ce28e7ea6c54bfcdced63f3d930fee65`
