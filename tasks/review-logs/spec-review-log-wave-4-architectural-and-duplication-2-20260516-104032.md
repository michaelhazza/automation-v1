# Spec Review Iteration 2 — wave-4-architectural-and-duplication

**Iteration:** 2 of 5
**Spec commit at start:** ccb6f539 (iteration 1)
**Timestamp:** 20260516-104032

## Codex output summary
Codex returned 7 findings. Captured at `/tmp/codex-iter2.txt`. All 7 are mechanical contradictions/drift introduced or surfaced by the iteration 1 rewrite. Notably, Codex actively read the actual export shapes of `WorkflowEngineService` and `skillExecutor` and identified that my pinned code samples used wrong export shapes.

## Findings classification

### FINDING #1 — §2 goal #4 vs §8 acceptance #1 — "under 30" doesn't reconcile with 73-43=30
- Source: Codex
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Numeric reconciliation. Mathematics: 73 - 43 = 30. The "under 30" claim requires at least one additional cycle to be broken beyond CD1's 43. Either accept the 28-31 floor and reframe, or commit to extra cleanup. Reframed as "hard bar = no skillExecutor↔workflowEngine cycle remains; absolute count is a soft goal in the 28-31 range, ≤30 if chunk 4 cleans up trivial siblings".

### FINDING #2 — §4.1 "8 new shared modules" vs 10 actual new files
- Source: Codex
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Direct count mismatch. Restated as "10 total = 8 DUP modules + 2 CD1 files".

### FINDING #3 — FE4 sub-components not in the new-files table
- Source: Codex
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: File-inventory-lock rubric. Added an explicit FE4 sub-table with placeholder names + chunk-0 confirmation requirement + override-path collapse rule.

### FINDING #4 — HandlerContext code samples use wrong export shapes
- Source: Codex
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Codex correctly read `server/services/workflowEngineService.ts` and `server/services/skillExecutor.ts` and identified that `WorkflowEngineService` is exported as a const (uppercase) and `skillExecutor` is exported as a const (lowercase from registry). Updated factory module description, updated type module sample to use `typeof` pattern, updated factory sample to use correct casing, added explanatory note.

### FINDING #5 — §6 intro says "locked" but DUP7/DUP9 leave exports to chunk 0
- Source: Codex
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Internal contradiction within §6. Updated intro to acknowledge intentional chunk-0 lock for DUP7/DUP9 with explicit requirement that chunk 0 update the spec before extraction begins.

### FINDING #6 — Missing `## Deferred Items` section (checklist §7)
- Source: Codex
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Checklist §7 mandates the section even when empty. The §11 items are non-scope (other-spec ownership), not deferred work within this build. Added §12 "Deferred Items" with explicit "None" plus the framing distinction, and clarified §11's framing accordingly.

### FINDING #7 — DUP4 deletes 2 files but §4.1 lists them as modified
- Source: Codex
- Classification: **mechanical**
- Disposition: auto-apply
- Reasoning: Inventory completeness. Added a "Deleted files" sub-table with the two `messageRender.tsx` copies; removed them from the Modified-files row (now only the AgentChat + ConfigAssistant pages are listed as modified for DUP4).

## Rubric findings (this iteration)
None beyond what Codex caught.

## Decisions log

[ACCEPT] §2 #4 / §8 #1 — Reconcile "under 30" with the 43-cycles-broken arithmetic
[ACCEPT] §4.1 intro — Restate count as 10 total (8 DUP + 2 CD1)
[ACCEPT] §4.1 — Add FE4 extraction sub-table with placeholder names + chunk-0 confirmation
[ACCEPT] §5.2.1 / §5.2.2 — Fix HandlerContext export shapes (uppercase WorkflowEngineService const, typeof-derived types)
[ACCEPT] §6 intro — Acknowledge intentional chunk-0 lock for DUP7/DUP9
[ACCEPT] §11 / §12 — Add Deferred Items section ("None") with non-scope-vs-deferred framing
[ACCEPT] §4.1 / §6.4 — Add Deleted-files sub-table for the two DUP4 messageRender copies

## Iteration 2 Summary

- Mechanical findings accepted:  7
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
  - mechanical_accepted: 7
  - mechanical_rejected: 0
  - directional_or_ambiguous: 0
- Spec commit after iteration: pending Step 8b commit

## Stopping heuristic evaluation (for after iter2 commit)

This iteration is **mechanical-only** (0 directional/ambiguous). Iteration 1 was NOT mechanical-only (1 directional). Therefore the "two consecutive mechanical-only rounds" heuristic has NOT triggered. Run iteration 3.
