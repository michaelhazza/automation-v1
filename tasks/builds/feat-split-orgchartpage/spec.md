**Status:** draft
**Spec date:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-orgchartpage

# Split OrgChartPage along layout-helper seams

## Goals
- Decompose `client/src/pages/OrgChartPage.tsx` (702 LOC) by extracting the 7 layout helpers into `client/src/components/org-chart/layout.ts`.

## Non-goals
- Visual change. API change.

## Current structure
- 7 pure helpers: `allChildrenAreLeaves`, `subtreeWidth`, `layoutTree`, `layoutForest`, `collectEdges`, `buildTree`, `identityStatusDot`.
- Main `OrgChartPage` (191-702, ~511 LOC).

## Target structure
```
client/src/pages/OrgChartPage.tsx                  ← host (~540 LOC target)
client/src/components/org-chart/
  ├─ layout.ts                                      ← 7 helpers + AgentNode + LayoutNode + Edge types
  └─ __tests__/layout.test.ts                       ← Vitest for layout helpers (buildTree round-trip, subtreeWidth recursive correctness)
```

## Migration plan
Single chunk: extract helpers + types + tests. Update host imports.

## Acceptance
- Host ≤ 560 LOC.
- All G1 gates green; layout tests pass.
