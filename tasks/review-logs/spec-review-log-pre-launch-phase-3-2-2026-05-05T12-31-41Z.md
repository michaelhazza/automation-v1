# Spec Review Log — pre-launch-phase-3 — Iteration 2

**Spec:** `tasks/builds/pre-launch-phase-3/spec.md`
**Iteration:** 2 of 5
**Codex output:** `tasks/review-logs/_codex_pre-launch-phase-3_iter2_20260505T123141Z.txt`
**Spec commit at start of iteration 2:** dd08e9a9

---

## Codex findings

9 findings, severities: 0 critical, 6 important, 3 minor, 0 nit.

## Rubric pass

No new findings beyond Codex. The iteration 1 fixes opened up some second-order issues (e.g. iteration 1 created a new test file path that didn't fit the existing test directory structure — Codex caught this in #4) which iteration 2 closes. Spec is now structurally tighter.

## Classifications and dispositions

### FINDING #1 — server/index.ts is the boot callsite; missing from inventory
- Source: Codex
- Section: §3 line 98, §4.L1 line 138, §12 line 431
- Classification: mechanical
- Reasoning: Pure file-inventory drift. `validateEncryptionKeyOrThrow()` IS called from server/index.ts:535-536. New `validateWebhookSecretOrThrow()` needs to be wired in the same place. server/index.ts must appear in the §3 Code table.
- [ACCEPT] §3 + §4.L1
  - Fix applied: added `server/index.ts` row to §3 Code table naming the existing line ~535 callsite. Updated §4.L1 Fix block from 2 to 3 steps making the boot wiring an explicit step.

### FINDING #2 — Pre-review checklist undercounts new test files
- Source: Codex
- Section: §14 line 473
- Classification: mechanical
- Reasoning: After iteration 1's fixes, there are now multiple new test files (L1: webhookSecretValidatorPure.test.ts, L2: authPure.test.ts, L5: costGate.integration.test.ts after iteration 2's split). Checklist line was stale.
- [ACCEPT] §14
  - Fix applied: rewrote the line to enumerate the new pure module + three new test files + extensions to two existing files.

### FINDING #3 — Helper input name mismatch (reqPath/reqMethod vs path/method)
- Source: Codex
- Section: §3 line 113 vs §4.L2 lines 153-169
- Classification: mechanical
- Reasoning: Internal naming inconsistency.
- [ACCEPT] §3
  - Fix applied: §3 row updated to use `path`/`method` (matching §4.L2). Single canonical signature now.

### FINDING #4 — L2 helper location ambiguous; new module not in inventory
- Source: Codex
- Section: §3 line 113, §4.L2 line 155
- Classification: mechanical
- Reasoning: Spec said "exported from server/middleware/auth.ts (or a sibling *Pure.ts module — implementation choice)." That violates file-inventory-lock. Pin one location.
- [ACCEPT] §3 + §4.L2
  - Fix applied: pinned the helper to a NEW sibling module `server/middleware/authPure.ts` `[NEW]`. Test moved from `server/lib/__tests__/requireSubaccountPermissionPure.test.ts` (which would have lived in the wrong directory tree relative to the source) to `server/middleware/__tests__/authPure.test.ts` `[NEW]`. Both files added to §3.

### FINDING #5 — verificationMatrix.test.ts cannot host a live cost gate
- Source: Codex
- Section: §4.L5 lines 234-240
- Classification: mechanical
- Reasoning: Concrete file evidence — the test file globally mocks `env`, `db`, `renderRecommendation`, and the optimiser query modules at module load time. A live LLM call literally cannot run there.
- [ACCEPT] §3 + §4.L5
  - Fix applied: added a NEW dedicated integration test file `server/services/optimiser/__tests__/costGate.integration.test.ts` `[NEW]` to §3, with explicit "no `vi.mock` blocks" and the `LIVE_LLM_COST_GATE` guard. Demoted `verificationMatrix.test.ts` to "remove the placeholder describe.skip and leave a comment pointing at the new file." Updated §4.L5 Fix block from 7 to 9 numbered steps reflecting the new file.

### FINDING #6 — Pin model + per-token rate
- Source: Codex
- Section: §4.L5 lines 238-239
- Classification: mechanical
- Reasoning: Cost claim "< $0.02/sa/day" is meaningless without pinned per-token rates and a model. Load-bearing claim without source-of-truth.
- [ACCEPT] §4.L5
  - Fix applied: added a new step 5 to the L5 Fix block. Names the model resolver function (`getOptimiserRenderModel()` or equivalent), inlines per-token-rate constants at top of the test file with comments naming model + source URL + capture date, and documents the update path when the optimiser model changes.

### FINDING #7 — Path filter scope vs goal "every relevant change"
- Source: Codex
- Section: lines 46, 240, 250, 435
- Classification: mechanical
- Reasoning: Goal-vs-implementation drift. EITHER expand path-filter, OR justify the narrower scope.
- [ACCEPT] §4.L5 step 7
  - Fix applied: expanded the workflow trigger to include LLM/cost surfaces outside `optimiser/**` (currently `server/lib/llm/**` if it exists), plus `workflow_dispatch` for manual reruns when out-of-tree pricing changes happen. The narrower default-trigger is justified by the explicit `workflow_dispatch` escape valve.

### FINDING #8 — Done-definition contradicts secret-absence path
- Source: Codex
- Section: §4.L5 line 242, §12 line 435
- Classification: mechanical
- Reasoning: Internal contradiction. "Every PR runs measurement" vs "no-secrets path exits cleanly without measuring."
- [ACCEPT] §4.L5 step 9 + §12
  - Fix applied: secret-absence path now FAILS the run with `::error::` and a non-zero exit code (not silent pass). §12 done-definition expanded to make this explicit: workflow fails when (a) cost ≥ $0.02/sa/day OR (b) secrets unavailable.

### FINDING #9 — `tasks/current-focus.md` "after merge" future-tense
- Source: Codex
- Section: §3 line 124, §11 line 421, §12 line 441
- Classification: mechanical
- Reasoning: Inventory said "after merge, update the sprint-pointer" — that's a post-merge action, not a PR diff. Either it IS in the PR (final commit flips the pointer) or it ISN'T (move to operator action). Pure ambiguity.
- [ACCEPT] §3 + §11 + §12
  - Fix applied: clarified that `tasks/current-focus.md` is updated as part of the PR diff (final commit flips the pointer to "shipped"). Updated §11 doc-sync line and §12 done-definition to match.

---

## Iteration 2 Summary

- Mechanical findings accepted:  9
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0 (no items routed to tasks/todo.md)
- Spec commit after iteration:   pending (will be set after auto-commit step)
