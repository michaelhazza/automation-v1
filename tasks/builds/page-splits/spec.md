# Page Splits — Aggregate Build Spec

**Slug:** `page-splits`
**Branch:** `claude/synthetos-personal-assistant-0kaIM` (branch name stale; carries over from EA V1 #291; this build is the post-#291 follow-on body of work)
**Type:** Major (cross-cutting client-side refactor, no schema / API / route changes)
**Status:** Implemented; PHASE 3 finalisation pre-launched

---

## Goal

Split 16 monolithic React page-level files into per-tab / per-region / per-atom seam components, with no functional change and no UI delta.

Each split was authored against an individual per-page spec; this aggregate spec is the umbrella that names the 16 sub-builds, locks the no-functional-change invariant, and serves as the finalisation entry point.

---

## Sub-builds (per-page spec inventory)

Each sub-build has its own `spec.md` + `plan.md` under `tasks/builds/feat-split-<name>/` and was authored via `spec-reviewer` (multiple iterations per spec).

| Sub-build | Spec | Conformance verdict |
|---|---|---|
| feat-split-layout | `tasks/builds/feat-split-layout/spec.md` | (logged 2026-05-15T01-10-00Z) |
| feat-split-adminsubaccountdetailpage | `tasks/builds/feat-split-adminsubaccountdetailpage/spec.md` | NON_CONFORMANT — 1 directional gap |
| feat-split-usagepage | `tasks/builds/feat-split-usagepage/spec.md` | CONFORMANT |
| feat-split-subaccountknowledgepage | `tasks/builds/feat-split-subaccountknowledgepage/spec.md` | (logged 2026-05-14T17-21-49Z) |
| feat-split-workflowrunpage | `tasks/builds/feat-split-workflowrunpage/spec.md` | (logged 2026-05-15T17-26-01Z) |
| feat-split-agentchatpage | `tasks/builds/feat-split-agentchatpage/spec.md` | (built; verdict in commit log) |
| feat-split-configassistantpage | `tasks/builds/feat-split-configassistantpage/spec.md` | (built; verdict in commit log) |
| feat-split-invocationscard | `tasks/builds/feat-split-invocationscard/spec.md` | (built; verdict in commit log) |
| feat-split-onboardingwizardpage | `tasks/builds/feat-split-onboardingwizardpage/spec.md` | (built; verdict in commit log) |
| feat-split-orgchartpage | `tasks/builds/feat-split-orgchartpage/spec.md` | (built; verdict in commit log) |
| feat-split-orgsettingspage | `tasks/builds/feat-split-orgsettingspage/spec.md` | (built; verdict in commit log) |
| feat-split-reviewqueuepage | `tasks/builds/feat-split-reviewqueuepage/spec.md` | (built; verdict in commit log) |
| feat-split-subaccountagenteditpage | `tasks/builds/feat-split-subaccountagenteditpage/spec.md` | (built; verdict in commit log) |
| feat-split-subaccountagentspage | `tasks/builds/feat-split-subaccountagentspage/spec.md` | (built; verdict in commit log) |
| feat-split-systemagenteditpage | `tasks/builds/feat-split-systemagenteditpage/spec.md` | (built; verdict in commit log) |
| feat-split-taskmodal | `tasks/builds/feat-split-taskmodal/spec.md` | (built; verdict in commit log) |

Two earlier sub-builds (`feat-split-mergereviewblock`, `feat-split-skillanalyzerresultsstep`) were dropped during S2 sync because PR #305 deleted the entire `client/src/components/skill-analyzer/` subtree as dead code; the split work on those two files was orphaned.

---

## Invariants

1. **No functional change.** Every split sub-build preserves the original page's behaviour byte-for-byte except for the `function` → `export default function` rewrap on extracted components and explicit dead-code removal documented in each sub-spec.
2. **No schema / API / route / RLS changes.** This is a client-side refactor only.
3. **No new dependencies.** No `package.json` additions.
4. **One sub-build per page-level file.** A monolithic page can map to one or more split sub-builds; a split sub-build never spans multiple pages.
5. **Tab / region / atom seams.** Splits go along existing JSX section boundaries — tabs, panels, atoms — rather than introducing new logical groupings.

---

## Non-goals

- Not introducing new UI patterns. The frontend-design-principles document does not change.
- Not changing render output. Pixel-identical UI is required.
- Not optimising for performance. If the slim-shell happens to be lazier, that's incidental.
- Not consolidating shared primitives. Existing primitives (`PageShell`, `Drawer`, etc.) are referenced but not modified.

---

## Acceptance (per sub-build)

Each sub-build is accepted when:
- `spec-conformance` returns CONFORMANT or CONFORMANT_AFTER_FIXES.
- Branch lint + typecheck pass against the post-split client tree.
- The page renders identically to its pre-split version in manual smoke (operator-verified at branch level).

## Acceptance (aggregate)

- All 16 sub-builds pass per-build acceptance.
- Post-S2 G4 (lint + typecheck) passes against the merged branch.
- `chatgpt-pr-review` (Phase 3 step 5) signs off on the aggregate PR.

---

## Scope deltas vs original 18-spec target

- Dropped: `feat-split-mergereviewblock`, `feat-split-skillanalyzerresultsstep` — source files deleted on main via PR #305 (dead code audit).
- Dropped: `feat-split-agentexecutionservice`, `feat-split-skillexecutor` — these are server-side splits owned by separate branches on main; their `tasks/builds/` dirs appear in this branch only because they came in via the S2 sync. NOT part of this build.
- Tab additions absorbed from main during S2:
  - `client/src/pages/AdminSubaccountDetailPage.tsx` — added OperatorSettingsTab (from main PR #297) into the split structure.
  - `client/src/pages/UsagePage.tsx` — added MemoryUtilityTab (from main PR #298) into the split structure.
