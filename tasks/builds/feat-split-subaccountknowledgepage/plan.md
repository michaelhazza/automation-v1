# Plan — feat-split-subaccountknowledgepage

**Spec:** `tasks/builds/feat-split-subaccountknowledgepage/spec.md` (the spec's §10 migration plan IS the source of truth — read it before each chunk).

**Source file:** `client/src/pages/SubaccountKnowledgePage.tsx` (1,160 LOC).
**Target host LOC:** ≤ 280.

Chunks (per spec §10):
1. `types.ts` + `format.ts` + tests + `TabButton`.
2. `BlocksTab` extraction.
3. `InsightsTab` extraction.
4. `ReferencesTab` extraction (largest tab; may need internal modal split).
5. Verify + cleanup.

Notes:
- Three accepted behaviour deltas per spec §2.1: (a) `Insights (N)` count only when active, (b) modal/draft state discarded on tab switch, (c) post-promote `loadInsights()` dropped (unmount-race).
- Cross-tab side effects (handlePromote → tab=blocks + load(), handleDemote → tab=refs + load(), handlePromoteInsight → tab=refs + Promise.all) per spec §4.2 — preserved verbatim.
- Endpoint inventory per spec §4.1 — verbatim, do not invent new routes.
- No `.js` suffixes on relative imports.
