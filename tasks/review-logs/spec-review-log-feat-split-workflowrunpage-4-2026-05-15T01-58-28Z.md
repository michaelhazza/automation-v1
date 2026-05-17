# Spec Review Log — feat-split-workflowrunpage — Iteration 4

**Timestamp:** 2026-05-15T01-58-28Z
**Codex command:** `codex exec --skip-git-repo-check` with stdin-fed spec body.

## Findings & dispositions

**F1 — §9 "three edge cases" text** — Codex (low)
- Real drift: §9 intro said "three edge cases" while table has 5 rows.
- Classification: mechanical
- Disposition: ACCEPT — §9 intro changed to "five cases of the pure helper".

**F2 — §13 "four `npx` commands" wording** — Codex (medium)
- Real wording bug: §13 said "the four `npx` commands above + the format test pass" but the list is 3 npm-run commands + 1 npx vitest.
- Classification: mechanical
- Disposition: ACCEPT — §13 collapsed to one bullet listing the four commands by name, removing the redundant "four npx commands above" reference. Also added the CLAUDE.md test-gates-CI-only attribution so future readers know why the full suite isn't listed.

**F3 — Add Chunk 0 preflight verification** — Codex (medium)
- Codex wants a preflight chunk verifying current line numbers, handler counts, toast wording.
- Classification: directional → AUTO-REJECT
- Framing rationale: `pre_production + rapid_evolution + prefer_existing_primitives_over_new_ones`. The spec already references line numbers explicitly throughout; the implementer reads the file as part of the task. Adding a "Chunk 0 preflight" is process ceremony, not engineering content. Batch-1 specs (UsagePage, AdminSubaccountDetailPage, Layout) didn't have one. Rejecting against framing.
- Disposition: REJECT — framing.

**F4 — onCancel/onReplay/onPortalToggle typing** — Codex (medium)
- Real typing ambiguity: `onCancel(): void` plus "host handlers are async" is inconsistent.
- Classification: mechanical
- Disposition: ACCEPT — all three callbacks typed as `() => void | Promise<void>` with a comment explaining the host's handler is async. The ConfirmDialog's `onConfirm` signature already accepts either, so no caller-side change needed.

**F5 — §8.4 guard expression is JS-ambiguous** — Codex (high)
- Real spec bug: the literal expression `selectedStep?.status === 'awaiting_input' || 'awaiting_approval'` is always truthy.
- Classification: mechanical
- Disposition: ACCEPT — fixed both occurrences (§6 tree comment + §8.4 Render-contract paragraph) to `selectedStep?.status === 'awaiting_input' || selectedStep?.status === 'awaiting_approval'`, with a pointer to today's verbatim line at WorkflowRunPage.tsx:649-651.

**F6 — Add per-item verdict output / PR comment checklist** — Codex (medium)
- Codex wants a PR-comment-shaped checklist with pass/fail/blocked verdicts per gate.
- Classification: directional → AUTO-REJECT
- Framing rationale: This is process ceremony layered onto the spec. Batch-1 specs don't have it; the spec-conformance agent + the standard PR review (pr-reviewer, dual-reviewer) already check the same items at PR time without needing a spec-side template. Rejecting against framing + batch-1 precedent.
- Disposition: REJECT — framing.

**F7 — Name lower-level kebab/dropdown/modal subcomponents** — Codex (low)
- Codex wants every subcomponent inside RunHeader named.
- Classification: directional → AUTO-REJECT
- Framing rationale: Over-specification for a pure refactor. Kebab dropdown and confirm-modal wiring are implementation details inside the file; spec lists the component's top-level prop contract and renders. Pinning each internal subcomponent would 2x the spec length without buying correctness. Rejecting against framing.
- Disposition: REJECT — framing.

**F8 — Add focused component / integration coverage for HITL actions** — Codex (medium)
- Codex suggests adding frontend component tests for the highest-risk extracted code.
- Classification: directional → AUTO-REJECT (framing match)
- Framing rationale: Direct match for `frontend_tests: none_for_now` in `docs/spec-context.md`. Codex is suggesting frontend tests despite the spec-context explicit rejection. Per Step 7 priority 1 framing-assumption table: "Add frontend tests" → AUTO-REJECT against `Rapid evolution / light testing posture`.
- Disposition: REJECT — framing.

## Counts

- mechanical_accepted: 4 (F1, F2, F4, F5)
- mechanical_rejected: 0
- directional_or_ambiguous: 4 (F3, F6, F7, F8 — all AUTO-REJECTED against framing; not routed to tasks/todo.md because the framing-rejection rationale was sufficient and no decision was deferred)
- reclassified_to_directional: 0

## Iteration 4 Summary

- Mechanical findings accepted:  4
- Mechanical findings rejected:  0
- Directional findings:          4 (all AUTO-REJECTED — framing)
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          4
  - AUTO-REJECT (framing):    4 (F3, F6, F7, F8)
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   (set after Step 8b commit)

## Stopping-heuristic note

Iteration 4 finished with `directional == 4` and `mechanical == 4`. Stopping heuristic requires `directional == 0 AND ambiguous == 0 AND reclassified == 0` for two consecutive rounds. Iteration 3 had `directional == 2`. The two-consecutive-mechanical-only condition has NOT yet been met. Iteration 5 is the cap; one more round will run.

If iteration 5 produces only mechanical findings (or NO_FINDINGS) we exit on the iteration cap with `READY_FOR_BUILD`. If iteration 5 produces more directional churn (which is the expected shape — Codex tends to re-raise framing-rejected suggestions in different shapes), we exit on iteration cap with the same verdict because all directional findings have been classified and rejected under the framing assumptions.
