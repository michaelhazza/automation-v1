# Spec Review Log — feat-split-workflowrunpage — Iteration 3

**Timestamp:** 2026-05-15T01-58-28Z
**Codex command:** `codex exec --skip-git-repo-check` with stdin-fed spec body.

## Findings & dispositions

**F1 — §5 case-count drift** — Codex (medium)
- §5 still said "three edge cases" while §2 and §9 say five.
- Classification: mechanical
- Disposition: ACCEPT — §5 updated to "five cases for formatDuration (see §9 table)".

**F2 — §3 "no new primitives" vs hook is a new primitive** — Codex (medium)
- §3 has already been corrected in iter 1 to say "No new cross-codebase / shared / design-system primitives invented" and to characterise the new files as feature-local extractions.
- Classification: mechanical → REJECT (already handled)
- Disposition: REJECT — re-raised by Codex; the §3 wording from iter 1 already distinguishes shared/design-system primitives from feature-local extractions and explicitly disclaims that the new files are not reusable abstractions. No additional change adds clarity.

**F3 — §9 "re-exported by each region file" wording** — Codex (low)
- Wording was loose — region files import from types.ts, they don't re-export.
- Classification: mechanical
- Disposition: ACCEPT — replaced "are re-exported by each region file" with "Each region file imports from `types.ts` directly — no barrel `index.ts` is introduced."

**F4 — §6/§8.4 HITL render ownership ambiguity** — Codex (medium)
- Real ambiguity about who owns the `awaiting_input | awaiting_approval` guard.
- Classification: mechanical
- Disposition: ACCEPT — pinned the contract: host renders `<HitlActionBar>` only when the guard passes; the component assumes non-null actionable stepRun and doesn't re-check. Both §6 and §8.4 updated to match.

**F5 — §7 vs §10 ordered-step-runs sequencing** — Codex (medium)
- Ambiguous where `orderedStepRuns` lives across chunks.
- Classification: mechanical
- Disposition: ACCEPT — §7 now states `orderedStepRuns` + `stepDefById` + `selectedStep` stay in the host across all six chunks; the deferred-items section flags promoting them into the hook later.

**F6 — §8.1 missing Edit-template / run-error / cancellable prop contracts** — Codex (high)
- §8.1 props were correct but the rendering rules were implicit.
- Classification: mechanical
- Disposition: ACCEPT — §8.1 now lists the seven rendering rules byte-for-byte from today's code (back-link href, title fallbacks, pills, metadata line, Edit-template link, run-error box, cancellable predicate), each with its WorkflowRunPage.tsx line reference.

**F7 — §8.1 missing run-error field contract** — Codex (medium)
- Folded into F6's expansion (run-error box bullet names `run.error` + `run.failedDueToStepId` explicitly).
- Classification: mechanical
- Disposition: ACCEPT — addressed in F6.

**F8 — §8.4 missing `api`/`toast` import contract** — Codex (low)
- Codex wanted explicit module-level import declarations in §8.4.
- Classification: directional → REJECT
- Reasoning: Every component in this codebase imports `api` from `client/src/lib/api.ts` and `toast` from `sonner` when needed. §3 already lists both as primitives reused. Pinning module imports in every component's prop-contract section is over-specification and noise for a pure refactor. Routed to `tasks/todo.md`? No — convention rejection applies (matches batch-1 UsagePage rejection pattern: "preserve today's plain behaviour, don't over-specify"). The convention `prefer_existing_primitives_over_new_ones` plus the spec-context framing `pre_production + rapid_evolution` argue against adding spec ceremony for ambient imports. Disposition: REJECT against framing.

**F9 — §12.1 vs §8.4 HITL failure handling** — Codex (medium)
- §12.1 inventories success toasts only; §8.4 says failures are inline `actionError`. Real wording gap (a reader could ask "where's the failure toast?").
- Classification: mechanical
- Disposition: ACCEPT — §12.1 expanded with an explicit "HITL failure path" paragraph noting that today's code does NOT fire a toast on HITL failure; it surfaces `response.data.error` inline and leaves the form open. This behaviour is preserved verbatim.

**F10 — §13 missing per-item preservation checklist table** — Codex (medium)
- Codex wanted a structured table of preserved behaviours × verification method.
- Classification: directional → REJECT
- Reasoning: §12 already lists the preserved behaviours, §13's manual-smoke bullet enumerates the user-visible checks, and the spec-authoring-checklist doesn't require a per-item preservation table for pure refactors. Adding the table would be over-engineering for a pre-production frontend refactor. The framing `rapid_evolution` + `prefer_existing_primitives` + the batch-1 specs not using such a table all argue against. Disposition: REJECT against framing + batch-1 precedent.

**F11 — §2 vs §13 testing-posture clarification** — Codex (low)
- §2 says "no frontend/API/E2E tests", §13 lists manual smoke. Codex wanted explicit "automated vs manual / which gates merge" split.
- Classification: mechanical
- Disposition: ACCEPT — §13 rewritten with two bullets: "Mandatory automated checks (gate the merge)" + "Author-side manual smoke (mandatory before opening the PR; not automated)".

**F12 — §14 "None" unsupported** — Codex (medium)
- Cascading from F4, F5, F6, which are all now resolved in-section.
- Classification: mechanical → REJECT (cascade resolved)
- Disposition: REJECT — once F4/F5/F6/F9 land, the open-question candidates Codex named (Edit-template routing, error fields, topological-sort location, HITL failure behaviour) are all explicitly answered in §7, §8.1, §8.4, §12.1. "None" remains accurate.

## Counts

- mechanical_accepted: 8 (F1, F3, F4, F5, F6, F7, F9, F11)
- mechanical_rejected: 4 (F2 already-handled cascade, F8 over-specification directional rejected against framing, F10 over-specification directional rejected against framing, F12 cascade-resolved)
- directional_or_ambiguous: 0 (F8 and F10 were classified as directional and REJECTED via framing assumptions, not routed to AUTO-DECIDED)
- reclassified_to_directional: 2 (F8, F10) — both rejected against `pre_production + rapid_evolution + prefer_existing_primitives` framing

## Iteration 3 Summary

- Mechanical findings accepted:  8
- Mechanical findings rejected:  4
- Directional findings:          2 (both AUTO-REJECTED against framing)
- Ambiguous findings:            0
- Reclassified → directional:    2
- Autonomous decisions:          2 (both AUTO-REJECT — framing; not routed to tasks/todo.md because the rejection rationale was sufficient)
  - AUTO-REJECT (framing):    2 (F8 import contracts, F10 preservation table)
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   (set after Step 8b commit)
