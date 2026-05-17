# Iteration 2 — browser-hardening-primitives spec review

## Codex findings classification

FINDING #1 — §19.2 still references `--timezone` launch flag
  Source: Codex
  Section: §1, §4.2, §19.2
  Classification: mechanical
  Disposition: auto-apply (missed in iter 1; update §19.2 to `newContext({ timezoneId, locale, extraHTTPHeaders })`)

FINDING #2 — HumanizeToggle.tsx path doesn't exist in repo
  Source: Codex
  Section: §5.1, §15
  Classification: mechanical
  Disposition: auto-apply (move to `client/src/components/HumanizeToggle.tsx` consumed from `WorkflowStudioPage.tsx`; add WorkflowStudioPage modification row to §5.2)

FINDING #3 — `server/db/schema/workflows.ts` doesn't exist; repo uses `workflowTemplates.ts` / `workflowRuns.ts`
  Source: Codex
  Section: §5.2, §5.3, §6.4, §7.2
  Classification: mechanical (the fix is to name accurate target options; the architect's design choice is preserved via paths (a)/(b)/(c))
  Disposition: auto-apply (replace `workflows.ts` reference with three architect-pick options: per-template, per-run, or code-level)

FINDING #4 — Proxy settings UI architect-locates but no proxy-config UI exists in repo
  Source: Codex
  Section: §5.2, §15
  Classification: ambiguous (this is a scope/sequencing question: does proxy-config UI ship as part of this build or upstream?)
  Disposition: AUTO-DECIDED — kept architect-locates pattern with explicit note that proxy-config UI may not exist; routed scope question to tasks/todo.md as BHP-1 and added Open Question Q8 in §17. Rationale: operator already gave the architect discretion on §16 Deferred items / §17 Open questions; proxy-config UI is genuinely an architect-pick at Phase 2 build time. Not blocking.

FINDING #5 — "Surfaced on run record" claim adds API surface not in inventory
  Source: Codex
  Section: §15
  Classification: mechanical
  Disposition: auto-apply (drop the run-record surfacing claim; preserve only "included in dispatched envelope"; pinned reproducibility per-workflow-+-seed)

FINDING #6 — Seed assigned at workflow save time conflicts with §8.3 "dispatch only reads"
  Source: Codex
  Section: §15
  Classification: mechanical
  Disposition: auto-apply (clarify save-time = workflow save/update server route assigns; dispatch only reads)

FINDING #7 — CI exit-code contract ambiguous across §8.1 / §10.5 / §13
  Source: Codex
  Section: §8.1, §10.5, §13
  Classification: mechanical
  Disposition: auto-apply (pin exact triple-condition rule in §8.1)

FINDING #8 — humanize terminal-event guarantee ignores action throws
  Source: Codex
  Section: §10.4
  Classification: mechanical
  Disposition: auto-apply (reframe as wrapper decision events emitted before Playwright execution; action failure stays with existing action telemetry)

FINDING #9 — pg-boss singleton not fully specified
  Source: Codex
  Section: §8.4, §10.3
  Classification: mechanical
  Disposition: auto-apply (pin queue name, singletonKey, singletonMinutes, worker concurrency)

FINDING #10 — e2b fallback undermines Phase 1 gate for Phase 2/3
  Source: Codex
  Section: §9, §16, §19.1
  Classification: mechanical
  Disposition: auto-apply (update §9 diagram to "Phase 1 harness e2b-backed"; expand §16 fallback clause to make Phase 2/3 acceptance dependent on real-e2b nightly when per-PR is cached-only)

## Rubric findings (this iteration)

FINDING #R-4 — Frontmatter Last updated not bumped after iter 1 edits
  Source: Rubric-frontmatter
  Section: frontmatter
  Classification: mechanical
  Disposition: auto-apply (mark "2026-05-18 (spec-reviewer iter 2)")

FINDING #R-5 — Numeric reconciliation drift after Finding 2/3 (added new rows + open questions)
  Source: Rubric-numeric-count-reconciliation
  Section: §18
  Classification: mechanical
  Disposition: auto-apply (update §18 counts: 11 modified rows, 2 conditional migrations, 9 open questions)

## Mechanical fixes applied

[ACCEPT] §1 + §19.2 — Acceptance criterion timezone clause moved from `--timezone=...` flag to Playwright `newContext({ timezoneId })`. Iter-1 missed this surface (Finding #1).
[ACCEPT] §5.1 — HumanizeToggle.tsx path corrected; clarified consumed from WorkflowStudioPage.tsx (Finding #2).
[ACCEPT] §5.2 — Added `WorkflowStudioPage.tsx` modification row; rewrote workflow-config persistence row as three architect-pick options (a/b/c); rewrote proxy-settings row to acknowledge the codebase doesn't have proxy-config UI today (Finding #2, #3, #4 partial).
[ACCEPT] §5.3 — Migration row marked conditional on §5.2 paths (a)/(b); not emitted under (c) (Finding #3).
[ACCEPT] §6.4 — Source-of-truth precedence rewritten to refer to "persisted humanize value" instead of "workflow row's column" (Finding #3 propagation).
[ACCEPT] §7.2 — RLS posture rewritten to cover all three architect-pick paths (Finding #3 propagation).
[ACCEPT] §8.1 — Exit-code contract pinned with three explicit conditions (Finding #7).
[ACCEPT] §8.4 — GeoLite2 refresh dispatch pinned: queue, singletonKey, singletonMinutes, worker concurrency (Finding #9).
[ACCEPT] §9 — Phase sequencing diagram updated: "Phase 1 harness e2b-backed" for Phase 2/3 dependency (Finding #10).
[ACCEPT] §10.3 — GeoLite2 concurrency guard rewritten with pg-boss singleton details (Finding #9).
[ACCEPT] §10.4 — humanize events reframed as wrapper-decision pre-execution events (Finding #8).
[ACCEPT] §15 — HumanizeToggle component placement clarified; conditional on §5.2 path; seed lifecycle clarified (save-route assigns; dispatch only reads); "surfaced on run record" claim removed (Findings #2, #5, #6).
[ACCEPT] §16 — Sandboxed-test-runner fallback expanded with explicit Phase 2/3 acceptance dependency on real-e2b nightly (Finding #10).
[ACCEPT] §17 — Added Q8 (tenant proxy-config UI scope) and Q9 (humanize persistence target) explicit open questions for architect (Finding #4 routing, Finding #3 routing).
[ACCEPT] §18 — Numeric reconciliation updated: 11 modified-file rows, 2 conditional migrations, 9 open questions (Finding #R-5).
[ACCEPT] frontmatter Last updated bumped (Finding #R-4).

## Autonomous decisions

[AUTO-DECIDED - accept] §5.2 proxy-settings UI row — kept architect-locates pattern but expanded explanatory text acknowledging the codebase has no proxy-config UI today. Added BHP-1 to tasks/todo.md and Open Question Q8 in §17 so the architect addresses this at Phase 2 chunk authoring. Reasoning: this is a scope/sequencing question the operator already gave the architect discretion on (intent.md grill Q3-Q13 locked alignment-on-proxy; tenant-facing proxy-config UI was not a grilled topic). The mechanical fix path is to make the conditional explicit, not to lock a UI surface that may not exist.
  → Added to tasks/todo.md for deferred review

## Iteration 2 Summary

- Mechanical findings accepted: 11 (10 Codex + 2 rubric)
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 1 (Finding #4 — proxy-config UI scope)
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 1
  - AUTO-DECIDED: 1 (routed to tasks/todo.md as BHP-1 and §17 Q8)
- Spec commit after iteration: pending Step 8b commit
