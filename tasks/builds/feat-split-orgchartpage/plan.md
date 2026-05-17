# Plan — feat-split-orgchartpage

Spec: `tasks/builds/feat-split-orgchartpage/spec.md`. Source: `client/src/pages/OrgChartPage.tsx` (702 LOC).

Single chunk: extract 7 layout helpers + AgentNode/LayoutNode/Edge types into `org-chart/layout.ts`. Tests for buildTree + subtreeWidth round-trip. Update host imports.

No `.js` suffixes on relative imports.
