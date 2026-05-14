# Spec Conformance Log

**Spec:** `tasks/builds/feat-split-subaccountknowledgepage/spec.md`
**Spec commit at check:** (working-tree spec — file modified vs main per `git status`; matches the spec content read for this audit)
**Branch:** `claude/synthetos-personal-assistant-0kaIM`
**Base:** `b979419433dfd6c33229b7698a0f8f44d8c751cb` (merge-base with main)
**HEAD:** `71d3ede8995996c89b13afa787857b9e86c6e3f1`
**Scope:** Caller-confirmed all-of-spec for this feature only (`tasks/builds/feat-split-subaccountknowledgepage/`) — the broader branch contains many unrelated changes which are out of scope.
**Changed-code set:** 8 files
  - `client/src/pages/SubaccountKnowledgePage.tsx` (host, 256 LOC, down from 1,160)
  - `client/src/components/subaccount-knowledge/types.ts` (new, 46 LOC)
  - `client/src/components/subaccount-knowledge/format.ts` (new, 31 LOC)
  - `client/src/components/subaccount-knowledge/TabButton.tsx` (new, 24 LOC)
  - `client/src/components/subaccount-knowledge/BlocksTab.tsx` (new, 251 LOC)
  - `client/src/components/subaccount-knowledge/InsightsTab.tsx` (new, 266 LOC)
  - `client/src/components/subaccount-knowledge/ReferencesTab.tsx` (new, 407 LOC)
  - `client/src/components/subaccount-knowledge/__tests__/format.test.ts` (new, 87 LOC, 17 tests passing)
**Run at:** 2026-05-15T17:21:49Z
**Commit at finish:** 632963a8

---

## Summary

- Requirements extracted:     19
- PASS:                       18
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 1
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (1 directional gap — see deferred items in `tasks/todo.md`).

The single gap is the conditional Chunk-4 Rename-modal extraction (§10 Chunk 4) — `ReferencesTab.tsx` is 407 LOC vs the spec's ~300 LOC threshold. It is a judgement-call extraction the implementer chose not to perform; the rest of the spec is fully conformant.

---

## Requirements extracted (full checklist)

| # | Category | Spec section | Requirement | Verdict |
|---|---|---|---|---|
| 1 | structure | §10 Chunk 4 | If `ReferencesTab.tsx` exceeds ~300 LOC after Chunk 4, extract `RenameReferenceModal.tsx` with the named prop shape and behaviour. | **DIRECTIONAL_GAP** — ReferencesTab is 407 LOC; extraction skipped. |
| 2 | structure | §5, §13 | New folder `client/src/components/subaccount-knowledge/` contains exactly: `types.ts`, `format.ts`, `__tests__/format.test.ts`, `TabButton.tsx`, `ReferencesTab.tsx`, `InsightsTab.tsx`, `BlocksTab.tsx`. No `atoms/`. | PASS |
| 3 | structure | §13 | Host LOC ≤ 280. | PASS (256 LOC) |
| 4 | file | §10 Chunk 1 | `types.ts` carries `Reference`, `Insight`, `InsightFacets`, `MemoryBlock`, `Tab`, `MEMORY_BLOCK_LABEL_MAX = 80`, `MEMORY_BLOCK_CONTENT_MAX = 2000`, `REFERENCE_PROMOTE_PREVIEW_MAX = 500`, `inputCls`. | PASS |
| 5 | file | §10 Chunk 1 | `format.ts` carries the 3 pure helpers moved verbatim. | PASS — diffed byte-for-byte against original host lines 18–44. |
| 6 | test | §9, §13 | `__tests__/format.test.ts` covers every named case for the 3 helpers. | PASS — 17 tests, all cases from spec §9 present, all passing. |
| 7 | file | §10 Chunk 1 | `TabButton.tsx` moved verbatim from host lines 848–870. | PASS — same JSX and same class string. |
| 8 | contract (§4.1 endpoints) | §4.1 | `GET /api/subaccounts/:id/knowledge` returns `{ references, memoryBlocks }`, called by host `load()`. | PASS — host line 57. |
| 9 | contract | §4.1 | `GET /api/subaccounts/:id/knowledge/insights[?domain&topic&entryType&taskSlug]` called by InsightsTab. | PASS — InsightsTab line 46 with the four exact query params. |
| 10 | contract | §4.1 | `GET /api/subaccounts/:id/baseline-artefacts-status` called by host. | PASS — host line 69. |
| 11 | contract | §4.1 | Mutating endpoints preserved verbatim: `/references` POST/PATCH/DELETE, `/references/:id/promote`, `/insights/:id/promote-to-reference`, `/memory-blocks/:id/demote`, `/api/memory-blocks` POST/PATCH. | PASS — all 8 mutating endpoints found at the correct call sites with verbatim URLs. |
| 12 | behaviour (§4.2 / §8.2) | §8.2 | Promote (Refs → Blocks): `api.post → toast → close modal → await onMutated() → onTabSwitchTo('blocks')`. | PASS — ReferencesTab `handlePromote` lines 100–107. |
| 13 | behaviour (§4.2 / §8.4) | §8.4 | Demote (Blocks → Refs): `api.post → toast → close confirm → await onMutated() → onTabSwitchTo('references')`. | PASS — BlocksTab `handleDemote` lines 88–95. |
| 14 | behaviour (§4.2 / §8.3) | §8.3 | Promote insight: `api.post → toast → await onPromotedToReference() → onTabSwitchTo('references')`, NO local `loadInsights()` refetch. | PASS — InsightsTab `handlePromoteInsight` lines 61–67. Accepted §2.1 delta (c) honoured. |
| 15 | data ownership | §7 | Host owns `activeTab`, `subaccountId`, `references`, `blocks`, `loading`, `error`, `search`, `pendingCreate`, `artefactStatuses`, `drawerSlug`, `load()`, `loadArtefactStatus()`, EditArtefactDrawer JSX, header "+ New" buttons; insights state lives in InsightsTab not host. | PASS — verified host has no insights state. |
| 16 | prop contract | §8.1 | TabButton prop shape `{ active, onClick, children }` unchanged. | PASS. |
| 17 | prop contract | §8.2 | ReferencesTab props match `{ subaccountId, items, search, openCreateOnMount, onCreateConsumed, onMutated: () => Promise<void>, onTabSwitchTo: (next: 'blocks') => void }`. | PASS — ReferencesTab lines 12–20. |
| 18 | prop contract | §8.3 | InsightsTab props match `{ subaccountId, search, onTabSwitchTo: (next: 'references') => void, onPromotedToReference: () => Promise<void> }`. | PASS — InsightsTab lines 7–12. |
| 19 | prop contract | §8.4 | BlocksTab props match `{ subaccountId, items, search, openCreateOnMount, onCreateConsumed, onMutated: () => Promise<void>, onTabSwitchTo: (next: 'references') => void }`. | PASS — BlocksTab lines 9–17. |

### Additional confirmations (§12 self-consistency)

- Tab bar uses 3 tabs in same order with `References (N)`, `Insights` (no count — accepted §2.1 delta (a) honoured), `Memory Blocks (N)` — host lines 186–194. PASS.
- BaselineArtefactsStatusBadge + EditArtefactDrawer remain on host; NOT moved into ReferencesTab — host lines 149–182 and 245–253. PASS.
- All `toast.success` / `toast.error` strings preserved verbatim (sampled and matched 17 of 17 strings). PASS.
- `clearPendingCreate` stabilized via `useCallback(() => setPendingCreate(null), [])` (host line 88) — matches §8.2 final paragraph requirement. PASS.
- `openCreateOnMount` useEffect pattern present in both ReferencesTab (lines 44–49) and BlocksTab (lines 33–38). PASS.

---

## Mechanical fixes applied

None.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

**REQ #1 — `ReferencesTab.tsx` exceeds Chunk 4 conditional extraction threshold.** ReferencesTab is 407 LOC vs spec §10 Chunk 4's "~300 LOC" threshold (35% over). Spec names the exact filename, path, prop shape, internal behaviour, and parent-callback wrapping for `RenameReferenceModal.tsx`. Classified DIRECTIONAL rather than MECHANICAL because:
1. The threshold is explicitly approximate ("~300 LOC"), not exact.
2. §13 acceptance criteria mark the extraction as **conditional and optional** ("optionally `RenameReferenceModal.tsx` (only if Chunk 4 triggered the extraction)").
3. Whether 407 LOC is "far enough past ~300" to mandate extraction is a judgement call the spec author left to the implementer.

Routed to `tasks/todo.md` § *Deferred from spec-conformance review — feat-split-subaccountknowledgepage (2026-05-15)*.

---

## Files modified by this run

- `tasks/todo.md` — appended one deferred-items section.
- `tasks/review-logs/spec-conformance-log-feat-split-subaccountknowledgepage-2026-05-14T17-21-49Z.md` — this log.

No source files modified — no mechanical fixes applied.

---

## Next step

**NON_CONFORMANT** — 1 directional gap routed to `tasks/todo.md`. Decide whether to extract `RenameReferenceModal.tsx` per spec §10 Chunk 4 (current ReferencesTab is 407 LOC vs ~300 threshold), or accept the current shape and move on. The rest of the spec is fully conformant; all 11 endpoints, all 3 cross-tab side-effect orderings (with the spec-mandated reorders), all 4 prop contracts (TabButton, ReferencesTab, InsightsTab, BlocksTab), all 3 accepted §2.1 deltas, and all 17 test cases verified. No data-flow regressions found.

Proceed to `pr-reviewer` once the Rename-modal decision is taken — that decision does not block the rest of the PR.
