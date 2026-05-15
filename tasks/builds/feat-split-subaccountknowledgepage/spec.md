**Status:** draft
**Spec date:** 2026-05-15
**Last updated:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-subaccountknowledgepage

# Split SubaccountKnowledgePage along tab seams

The spec-authoring checklist sections 0 (verify present state), 4 (RLS), 5 (execution model), and 10 (execution-safety contracts) are N/A for this frontend-only refactor — no migrations, no new tenant-scoped tables, no new write paths.

## 1. Goals

- Decompose `client/src/pages/SubaccountKnowledgePage.tsx` (1,160 LOC) into a thin host plus per-tab files under `client/src/components/subaccount-knowledge/`, matching the convention established by batch-1 specs (`pulse/`, `baseline/`, `admin-subaccount-detail/`).
- Preserve every user-visible behaviour, with three accepted minor deltas listed in §2 and detailed in §12: (a) the `Insights (N)` count in the tab bar appears only while the Insights tab is active, (b) modal-open and draft-form state in an inactive tab is discarded on tab switch, (c) one post-promote `loadInsights()` network call is dropped because the InsightsTab unmounts immediately after promote. The headline affordances are preserved: 3-tab layout (References / Insights / Memory Blocks), promote/demote affordances, rename modal, delete-confirm dialogs, EditArtefactDrawer (in the baseline-artefacts region of the header), baseline-artefacts status badge.

## 2. Non-goals

- Visual change of any kind to elements that exist in both before and after.
- API change. Endpoint inventory is preserved — every `GET/POST/PATCH/DELETE` call site keeps its URL, method, and payload shape verbatim. The only call-timing change is described in §8.3 (post-promote-insight `loadInsights()` is dropped because the tab unmounts; mount-effect re-fetches on next visit).
- New tests beyond pure-helper Vitest coverage for the 3 pure helpers (`referenceTitle`, `referencePreview`, `renameReferenceHtml`).

### 2.1 Accepted minor deltas

These are intentional consequences of the per-tab ownership split and are documented up-front so future readers don't treat them as bugs:

- **Insights count.** Tab bar shows `Insights` (no `(N)`) while the Insights tab is inactive. Detailed in §12.
- **Modal / draft persistence.** Switching tabs unmounts the previous tab. Open modals and unsaved form-field edits inside that tab are discarded. Detailed in §6.
- **Promote-insight network call.** The post-promote `loadInsights()` refetch is dropped (the tab is unmounting). Next visit to Insights re-fetches via its mount-effect. Detailed in §8.3.

If a reviewer or implementer believes any of these deltas is unacceptable, raise it before Chunk 1 — the alternative (keeping the host as a state mirror for every tab's data) defeats the refactor.

## 3. Existing primitives reused

| Primitive | Why reuse |
|---|---|
| `client/src/components/<feature>/` convention | Same as batch 1 |
| `client/src/components/Modal.tsx` / `ConfirmDialog.tsx` | Already extracted |
| `client/src/components/RichTextEditor.tsx` | Already extracted |
| `client/src/components/baseline/EditArtefactDrawer.tsx` + `BaselineArtefactsStatusBadge.tsx` | Already extracted |
| `client/src/lib/api.ts` axios wrapper | All fetch calls keep using it |
| `sonner` `toast` | All current toast calls keep their wording |
| `shared/constants/baselineArtefacts` (`BASELINE_SLUGS`, `TIER_BY_SLUG`, `ArtefactStatus`) | Imported by host today; stays |

No new primitives invented.

## 4. Current structure (today)

`SubaccountKnowledgePage.tsx` contains:

- 3 pure helpers at the top (lines 18-46): `referenceTitle`, `referencePreview`, `renameReferenceHtml`.
- Main host component (`SubaccountKnowledgePage`, lines 106-846, ~740 LOC). Manages:
  - 3 tabs (References / Insights / Memory Blocks) + `activeTab` state.
  - One combined fetch (`GET /api/subaccounts/:id/knowledge`) that hydrates BOTH `references` and `memoryBlocks` from a single response payload.
  - A separate insights fetch (`GET /api/subaccounts/:id/knowledge/insights`) that re-runs on filter change.
  - All promote / demote / rename / archive / save handlers (which can flip `activeTab` and reload `load()`).
  - The page-level `search` input and per-tab `useMemo` filtering (`filteredRefs`, `filteredInsights`, `filteredBlocks`).
  - The baseline-artefacts section in the header — `BaselineArtefactsStatusBadge` per slug + `EditArtefactDrawer` triggered by per-slug "Edit" buttons (lines 473-507 and 835-843). This is OUTSIDE the per-tab body — it sits between the header text and the tab bar.
  - Five modal regions: Promote modal, Reference create/edit modal (Tiptap), Rename modal, Memory Block create/edit modal, Archive/Demote ConfirmDialog pair.
  - Two header-level "+ New" buttons (`+ New Reference` when `tab === 'references'`; `+ New Memory Block` when `tab === 'blocks'`).
- Sub-components below the host:
  - `TabButton` (lines 848-870) — pill button used in the tab bar.
  - `ReferencesTable` (871-957) — references list table.
  - `InsightFilterSelect` (958-992) — small select used inside the insights tab.
  - `InsightsTable` (993-1092) — insights tab content.
  - `BlocksTable` (1093-1160) — memory blocks tab content.

### 4.1 API endpoints (verbatim from source)

Three GET endpoints feed the page, plus the mutating endpoints. Spec inventory below references these names exactly — there is no `/knowledge/references` or `/knowledge/blocks` endpoint.

- `GET /api/subaccounts/:id/knowledge` → returns `{ references: Reference[]; memoryBlocks: MemoryBlock[] }`. Drives BOTH the References tab and the Memory Blocks tab.
- `GET /api/subaccounts/:id/knowledge/insights[?domain&topic&entryType&taskSlug]` → returns `{ insights, facets }`. Drives the Insights tab and re-runs on filter change.
- `GET /api/subaccounts/:id/baseline-artefacts-status` → drives the header baseline-artefacts list.
- Plus the mutating endpoints already in the source (`/promote`, `/promote-to-reference`, `/demote`, `/memory-blocks` POST/PATCH, `/references` POST/PATCH/DELETE), preserved verbatim by call site.

### 4.2 Cross-tab side effects (verbatim from source)

These behaviours must survive the refactor — they're invisible from the prop contracts otherwise:

- `handlePromote()` (References → Memory Block): POSTs `/references/:id/promote`, then `setTab('blocks')`, then `await load()` (which re-hydrates BOTH refs and blocks).
- `handleDemote()` (Memory Block → Reference): POSTs `/memory-blocks/:id/demote`, then `setTab('references')`, then `await load()` (re-hydrates both).
- `handlePromoteInsight()` (Insight → Reference): POSTs `/insights/:id/promote-to-reference`, then `setTab('references')`, then `Promise.all([load(), loadInsights()])` (re-hydrates refs + blocks + insights).

## 5. Target structure

```
client/src/pages/SubaccountKnowledgePage.tsx        ← host (~280 LOC target)
client/src/components/subaccount-knowledge/
  ├─ types.ts                                       ← Reference, Insight, InsightFacets, MemoryBlock interfaces + Tab union + the inline constants (MEMORY_BLOCK_LABEL_MAX, MEMORY_BLOCK_CONTENT_MAX, REFERENCE_PROMOTE_PREVIEW_MAX, inputCls)
  ├─ format.ts                                      ← referenceTitle, referencePreview, renameReferenceHtml
  ├─ __tests__/
  │   └─ format.test.ts                             ← Vitest coverage for the 3 pure helpers
  ├─ TabButton.tsx                                  ← extracted, moved verbatim
  ├─ ReferencesTab.tsx                              ← owns: ReferencesTable + filtered list + Reference create/edit modal + Rename modal + Promote modal + Archive ConfirmDialog
  ├─ InsightsTab.tsx                                ← owns: InsightsTable + InsightFilterSelect + insight filters + insights fetch
  ├─ BlocksTab.tsx                                  ← owns: BlocksTable + filtered list + Memory Block create/edit modal + Demote ConfirmDialog
  └─ RenameReferenceModal.tsx                       (only created if ReferencesTab.tsx still exceeds ~300 LOC after Chunk 4 — see §10 Chunk 4)
```

`ReferencesTable`, `InsightsTable`, and `BlocksTable` stay as internal non-exported functions inside their respective `*Tab.tsx` files. They are not promoted to top-level files. The only conditional addition allowed is `RenameReferenceModal.tsx` as a single optional file extraction (per Chunk 4). No `atoms/` directory is created — there are no atoms shared across the three tabs today (`TabButton` is the only candidate and it already sits at the folder root). If a future refactor surfaces a shared atom, it gets its own spec.

Host import path in `App.tsx` is unchanged.

## 6. Component tree

```
SubaccountKnowledgePage (host, ~280 LOC)
│
├── back link + header (h1 + subtitle + conditional "+ New Reference" / "+ New Memory Block" button)   ← inline
├── error banner (host-owned)                                                                          ← inline
├── baseline-artefacts list (per-slug BaselineArtefactsStatusBadge + Edit button)                      ← inline
├── tab bar with three <TabButton>                                                                     ← inline using imported TabButton
├── search input (`search` host state)                                                                 ← inline
├── tab body — dispatch by activeTab
│   ├── references → <ReferencesTab subaccountId items={references} search={search} openCreateOnMount={pendingCreate === 'reference'} onCreateConsumed={clearPendingCreate} onMutated={load} onTabSwitchTo={setTab} />
│   ├── insights   → <InsightsTab   subaccountId search={search} onTabSwitchTo={setTab} onPromotedToReference={load} />
│   └── blocks     → <BlocksTab     subaccountId items={blocks}     search={search} openCreateOnMount={pendingCreate === 'block'} onCreateConsumed={clearPendingCreate} onMutated={load} onTabSwitchTo={setTab} />
└── EditArtefactDrawer (host-owned; opens when drawerSlug !== null, set by the baseline-artefacts row's Edit button) ← inline
```

The host renders only the active tab — inactive tabs unmount, so modal-open and form-draft state inside an inactive tab is discarded when the user switches tabs. This is an accepted minor delta of the same shape as batch 1's AdminSubaccountDetailPage.

## 7. Data-fetching ownership

The host keeps the combined fetch because today's `/api/subaccounts/:id/knowledge` returns refs + blocks in one shot — splitting the call would change the API, which §2 forbids.

**Host owns:**
- `activeTab` (`Tab = 'references' | 'insights' | 'blocks'`), `subaccountId` from `useParams`.
- `references`, `blocks`, `loading`, `error` state.
- `load()` — calls `GET /api/subaccounts/:id/knowledge`, populates `references` AND `blocks`.
- `search` state and the `onChange` for the search input. The host passes `search` down so each tab can apply its own `useMemo` filter — same behaviour as today's `filteredRefs` / `filteredBlocks` / `filteredInsights`. Insights filtering on `search` happens inside `InsightsTab` over its own internal `insights` state.
- `artefactStatuses`, `drawerSlug`, `loadArtefactStatus()`, and the `EditArtefactDrawer` JSX render — all kept in the host's baseline-artefacts region. The drawer is NOT inside ReferencesTab.
- The header-level "+ New Reference" / "+ New Memory Block" buttons. The buttons render conditionally on `activeTab` (same as today's source at lines 440-455), so they are only ever clickable when the matching tab is already active. Click sets a host-level `pendingCreate: 'reference' | 'block' | null` state (replacing today's `setEditRef('new')` / `setEditBlock('new')` triggers). The already-mounted active tab observes `openCreateOnMount` flip true via a `useEffect` on the prop, opens its create modal, and immediately calls `onCreateConsumed()` (host clears `pendingCreate` to null). No tab-switch is needed because the active tab is the only one that can produce the click. There is no cross-tab dispatch path.

**Tab components own:**
- `ReferencesTab`: receives `items: Reference[]` (host's `references` array) + `search`. Owns the filtered `useMemo`, the Reference create/edit modal state (`editRef`, `editRefContent`), the Promote modal state (`promoteFrom`, `promoteLabel`, `promoteContent`, `promoting`), the Rename modal state (`renameRef`, `renameTitle`), the Archive ConfirmDialog state (`archiveRefId`), and all four handlers (`handleSaveReference`, `handlePromote`, `handleRenameReference`, `handleArchiveReference`). After a successful mutation, the tab calls `await onMutated()` (host's `load()`) to refresh `references` + `blocks`; if a tab-switch was part of today's behaviour (promote flips to Blocks), the tab calls `onTabSwitchTo('blocks')` AFTER `onMutated()` resolves. See §8.2 for the exact ordering and rationale.
- `InsightsTab`: owns `insights`, `insightFacets`, `insightFilters`, `insightsLoading`, `loadInsights()`, the `useEffect` that fetches on mount + filter change, and `handlePromoteInsight`. Receives `search` to power its `useMemo` filter. After a successful promote-to-reference: calls `onPromotedToReference()` (host's `load()`) first to refresh references + blocks, then `onTabSwitchTo('references')`. No local `loadInsights()` refetch is needed — the tab is about to unmount on the next render, and on its next mount (when the user returns to the Insights tab) the existing mount-effect refetches automatically. This drops one network call vs today's source but is consistent with the §6 "inactive tabs unmount" accepted delta. The reordering (mutate-then-switch instead of today's switch-then-mutate) is intentional: avoids an unmounted-state-update warning that would arise from running `loadInsights()` after `setTab`.
- `BlocksTab`: receives `items: MemoryBlock[]` (host's `blocks` array) + `search`. Owns the filtered `useMemo`, the Memory Block create/edit modal state (`editBlock`, `editBlockLabel`, `editBlockContent`), the Demote ConfirmDialog state (`demoteBlockId`), and the handlers `handleSaveBlock` + `handleDemote`. After a successful demote: calls `await onMutated()` first, then `onTabSwitchTo('references')`. See §8.4 for the exact ordering and rationale.

There is no `blocksKey` and no force-remount mechanism — because the host owns `blocks` and re-hydrates it via `load()` after every cross-tab mutation, the Blocks tab's `items` prop updates declaratively. The earlier draft's `blocksKey` idea was a leftover from a different ownership model where each tab self-fetched; with the host owning the combined fetch (as today's source does), the prop simply changes and React re-renders.

## 8. Prop contracts

### 8.1 `<TabButton>` — moved verbatim from current lines 848-870. No prop change.

### 8.2 `<ReferencesTab>`
```
props: {
  subaccountId: string;
  items: Reference[];                          // hydrated by host's load()
  search: string;                              // host-owned search query string
  openCreateOnMount: boolean;                  // host sets true when "+ New Reference" was clicked; tab opens create modal once then calls onCreateConsumed
  onCreateConsumed(): void;
  onMutated(): Promise<void>;                  // host's load() — call after save/promote/rename/archive succeeds; awaited
  onTabSwitchTo(next: 'blocks'): void;         // called AFTER onMutated() resolves; sequence per Promote ordering note below
}
```

Owns internally: `filteredRefs` (`useMemo` over `items` + `search`), the Reference create/edit modal (Tiptap), the Promote modal (label + condensed content + REFERENCE_PROMOTE_PREVIEW_MAX seeding), the Rename modal, the Archive ConfirmDialog, and the four handlers (`handleSaveReference`, `handlePromote`, `handleRenameReference`, `handleArchiveReference`). Renders an internal non-exported `ReferencesTable` (moved verbatim from host).

Create-on-mount pattern: a `useEffect(() => { if (openCreateOnMount) { setEditRef('new'); onCreateConsumed(); } }, [openCreateOnMount, onCreateConsumed])` opens the create modal exactly once when the prop transitions true and immediately clears the host flag via `onCreateConsumed()`. The host stabilises `onCreateConsumed` with `useCallback(() => setPendingCreate(null), [])` so the callback identity is stable across renders and the effect does not re-fire on host re-renders. The same pattern is used by `<BlocksTab>` (§8.4).

Promote callback ordering: `await api.post(.../promote)` → `toast.success` → close modal → `await onMutated()` → `onTabSwitchTo('blocks')`. The order is reversed from today's source (today: `setTab('blocks'); await load()`) so the mutating call completes inside the still-mounted ReferencesTab, avoiding an unmounted-state-update warning. The user-visible result is identical: the user lands on the Blocks tab and sees the new block.

### 8.3 `<InsightsTab>`
```
props: {
  subaccountId: string;
  search: string;
  onTabSwitchTo(next: 'references'): void;
  onPromotedToReference(): Promise<void>;     // host's load() — refreshes refs + blocks after promote-to-reference; awaited
}
```

Owns: insights state, facets state, filter state, the `useEffect` that fetches on mount + filter change, `<InsightFilterSelect>` row, the `<InsightsTable>` render, the search-filtered `useMemo`, and `handlePromoteInsight`.

Promote-insight callback ordering: `await api.post(.../promote-to-reference)` → `toast.success` → `await onPromotedToReference()` (refreshes refs + blocks while InsightsTab is still mounted) → `onTabSwitchTo('references')` (triggers unmount of InsightsTab on the next render). No local `loadInsights()` refetch — the next mount of InsightsTab will fetch fresh via its existing mount-effect. Reorder vs today's source is intentional to avoid an unmounted-state-update warning that would arise from running `loadInsights()` after the tab switch.

### 8.4 `<BlocksTab>`
```
props: {
  subaccountId: string;
  items: MemoryBlock[];
  search: string;
  openCreateOnMount: boolean;
  onCreateConsumed(): void;
  onMutated(): Promise<void>;
  onTabSwitchTo(next: 'references'): void;
}
```

Owns internally: `filteredBlocks` (`useMemo`), the Memory Block create/edit modal, the Demote ConfirmDialog, and handlers `handleSaveBlock` + `handleDemote`. Renders an internal non-exported `BlocksTable`. Uses the same create-on-mount pattern as §8.2 (a `useEffect(..., [openCreateOnMount, onCreateConsumed])` that opens the create modal once and immediately calls `onCreateConsumed`; host stabilises the callback via `useCallback`).

Demote callback ordering: `await api.post(.../demote)` → `toast.success` → close confirm → `await onMutated()` → `onTabSwitchTo('references')`. Same reorder as §8.2's promote to keep the mutating call inside the still-mounted tab.

## 9. Pure helpers

Move the three pure helpers (`referenceTitle`, `referencePreview`, `renameReferenceHtml`) to `format.ts`. Test file `__tests__/format.test.ts` covers (every case matches today's source-of-truth behaviour byte-for-byte):

| Helper | Cases to cover |
|---|---|
| `referenceTitle` | Empty → `'Untitled'`. Plain text under 80 chars → returned trimmed. HTML input → HTML stripped via `/<[^>]+>/g` → ` `, whitespace collapsed → first line returned. First line exactly 80 chars → returned without ellipsis. First line 81 chars → first 80 chars + `'…'` (single ellipsis character `U+2026`). |
| `referencePreview` | Empty → `''`. HTML input → HTML stripped via the same regex as `referenceTitle` (whitespace collapsed). Content ≤ 200 chars → returned trimmed. Content 201 chars → first 200 chars + `'…'`. |
| `renameReferenceHtml` | Empty new title (after trim) → returns `currentHtml` unchanged. Existing `<h1>` (any attributes) → that `<h1>...</h1>` replaced with `<h1>{escaped title}</h1>`. No `<h1>` in current content → returns `<h1>{escaped title}</h1>{currentHtml}` (prepend). Title containing `<` and `>` → escaped to `&lt;` / `&gt;` before insertion. |

No new pure helpers introduced. Constants (`MEMORY_BLOCK_LABEL_MAX = 80`, `MEMORY_BLOCK_CONTENT_MAX = 2000`, `REFERENCE_PROMOTE_PREVIEW_MAX = 500`, `inputCls`) move to `types.ts` alongside the interfaces so all consumers import from one place.

## 10. Migration plan

Each chunk leaves the page green (lint + typecheck + build:client clean) and visually unchanged. Chunks are sequenced so dependent files appear before consumers, and each chunk is independently revertible.

### Chunk 1 — `types.ts` + `format.ts` + `TabButton` + tests
- Create `client/src/components/subaccount-knowledge/types.ts` with the `Reference`, `Insight`, `InsightFacets`, `MemoryBlock` interfaces (currently inline at host lines 59-96), the `Tab` union (replacing today's `TabId`), and the constants `MEMORY_BLOCK_LABEL_MAX`, `MEMORY_BLOCK_CONTENT_MAX`, `REFERENCE_PROMOTE_PREVIEW_MAX`, `inputCls`.
- Create `format.ts` with the 3 pure helpers (`referenceTitle`, `referencePreview`, `renameReferenceHtml`), moved verbatim from host lines 18-44.
- Create `__tests__/format.test.ts` per §9.
- Create `TabButton.tsx` (move verbatim from host lines 848-870).
- Update host imports for the moved symbols. The inlined `ReferencesTable`, `InsightFilterSelect`, `InsightsTable`, `BlocksTable` sub-components stay in the host file for this chunk — they move with their owning tab in Chunks 2-4.
- **Done when:** host imports the three new runtime modules (`types`, `format`, `TabButton`); `npx vitest run client/src/components/subaccount-knowledge/__tests__/format.test.ts` passes; lint + typecheck + build:client clean.

### Chunk 2 — `BlocksTab`
- Create `BlocksTab.tsx`. Move into it: the inlined `BlocksTable` sub-component (as an internal non-exported function inside the file), `filteredBlocks` `useMemo`, the Memory Block create/edit modal JSX + its state (`editBlock`, `editBlockLabel`, `editBlockContent`, `openEditBlock`), the Demote ConfirmDialog JSX + its state (`demoteBlockId`), and the handlers `handleSaveBlock` + `handleDemote`.
- Add `openCreateOnMount` / `onCreateConsumed` props per §8.4.
- Host stops owning the Memory Block modal and the Demote dialog; the host's "+ New Memory Block" button now sets `pendingCreate = 'block'` instead of `setEditBlock('new')`.
- **Done when:** Blocks tab renders, demote round-trips and flips back to References tab, "+ New Memory Block" still opens the create modal, edit / save / cancel still work.

### Chunk 3 — `InsightsTab`
- Create `InsightsTab.tsx`. Move into it: the inlined `InsightFilterSelect` + `InsightsTable` sub-components (as internal non-exported functions), `insights`, `insightFacets`, `insightFilters`, `insightsLoading` state, the `useEffect` at host lines 164-169, `loadInsights()`, `filteredInsights` `useMemo`, the filter-row JSX (host lines 541-581), and `handlePromoteInsight`.
- Add `onTabSwitchTo` and `onPromotedToReference` props per §8.3.
- **Done when:** Insights tab fetches on mount + filter change; promote-to-reference refreshes both refs and blocks (host `load()`) and flips to References tab. No local `loadInsights()` refetch happens after promote — next mount of InsightsTab re-fetches via its mount-effect. See §8.3 for the ordering rationale.

### Chunk 4 — `ReferencesTab`
- Create `ReferencesTab.tsx`. Move into it: the inlined `ReferencesTable` sub-component (as an internal non-exported function), `filteredRefs` `useMemo`, the Reference create/edit modal (Tiptap) + its state (`editRef`, `editRefContent`, `openEditReference`), the Promote modal + its state (`promoteFrom`, `promoteLabel`, `promoteContent`, `promoting`, `openPromote`, `handlePromote`), the Rename modal + its state (`renameRef`, `renameTitle`, `handleRenameReference`), the Archive ConfirmDialog + its state (`archiveRefId`, `handleArchiveReference`), and `handleSaveReference`.
- Add `openCreateOnMount` / `onCreateConsumed` / `onMutated` / `onTabSwitchTo` props per §8.2.
- **If `ReferencesTab.tsx` exceeds ~300 LOC after this move**, extract the Rename modal into `client/src/components/subaccount-knowledge/RenameReferenceModal.tsx` with props `{ reference: Reference; initialTitle: string; onClose(): void; onRename(newTitle: string): Promise<void> }`. The modal owns its own `title` input state seeded from `initialTitle`; on submit it calls `await onRename(title.trim())`, then `onClose()`. The parent `<ReferencesTab>`'s `onRename` callback wraps `api.patch(.../references/:id, { content: renameReferenceHtml(reference.content, newTitle) })` + `toast.success` + `await onMutated()`. (`reference` not `ref` because `ref` is a reserved React prop name.) No other extractions.
- Host stops owning the Reference modal pair (create/edit, promote, rename, archive). The host's "+ New Reference" button now sets `pendingCreate = 'reference'`.
- **Done when:** References tab renders, "+ New Reference" opens the create modal, edit / save / rename / archive / promote all round-trip, promote flips to Blocks tab and refreshes both lists.

### Chunk 5 — Verify and clean up
- Confirm the host is ≤ 280 LOC and contains: imports, lazy state, `subaccountId` / `activeTab` / `references` / `blocks` / `loading` / `error` / `search` / `pendingCreate` / `artefactStatuses` / `drawerSlug` state, `load()`, `loadArtefactStatus()`, the back link + header (h1 + subtitle + conditional + New button), error banner, baseline-artefacts list, tab bar, search input, the three tab dispatches, and the `EditArtefactDrawer` render. All five modals have moved into tabs.
- Sweep unused imports — likely candidates: `Modal`, `ConfirmDialog`, `RichTextEditor`, the inline helper imports.
- Run `npm run lint`, `npm run typecheck`, `npm run build:client`, `npx vitest run client/src/components/subaccount-knowledge/__tests__/format.test.ts`.

## 11. Deferred Items

- **Shared `<TabBar>` primitive across multiple pages.** Same deferral as batch 1. Reason: premature abstraction until a third page asks for it.
- **Promote / demote optimistic state.** Today's behaviour refetches the combined `/knowledge` endpoint after every mutation; preserved verbatim. Reason: no UX delta from this refactor.
- **Search input ownership simplification.** Today the host owns one `search` state used by all three tabs. After the split, each tab applies its own `useMemo` filter over `search`. A future refactor could move `search` ownership into the tab bar and out of the host entirely. Out of scope. Reason: would touch the host's tab dispatch shape unnecessarily.
- **Splitting the Promote / Reference modals into dedicated files (beyond Rename).** Allowed only conditionally per Chunk 4 (Rename modal extraction if LOC budget breached). All other modals stay inline inside their owning tab. Reason: avoid premature file fragmentation.

## 12. Self-consistency

- 3 tabs, same labels, same order — preserved (host renders the same tab bar inline).
- `BaselineArtefactsStatusBadge` per slug + `EditArtefactDrawer` opens from per-slug Edit button — preserved on host, NOT moved to ReferencesTab.
- All `toast.success` / `toast.error` strings preserved verbatim by the migrating handlers.
- Promote (Refs → Blocks): host's `handlePromote` → ReferencesTab's `handlePromote`. Sequence reordered from today's `setTab('blocks'); await load()` to `await onMutated(); onTabSwitchTo('blocks')` so the mutating call completes inside the still-mounted ReferencesTab. User-visible result identical.
- Demote (Blocks → Refs): host's `handleDemote` → BlocksTab's `handleDemote`. Same reorder: `await onMutated(); onTabSwitchTo('references')`. User-visible result identical.
- Promote insight (Insight → Reference): host's `handlePromoteInsight` → InsightsTab's `handlePromoteInsight`. Sequence: `await onPromotedToReference()` (refreshes refs + blocks while InsightsTab is still mounted) → `onTabSwitchTo('references')`. No local `loadInsights()` refetch; next mount of InsightsTab fetches fresh. Drops one network call vs today's source — consistent with the §6 "inactive tabs unmount" accepted delta.
- Header "+ New Reference" / "+ New Memory Block" buttons: still rendered by host conditional on `activeTab`. Click flows through new `pendingCreate` host state into the active tab's `openCreateOnMount` prop, which opens the create modal once and calls `onCreateConsumed` to clear the host flag.
- Inactive tabs unmount: modal-open and unsaved form state inside an inactive tab is discarded on tab switch. Same accepted minor delta as batch 1's AdminSubaccountDetailPage.
- `search` input remains in host; each tab receives `search` and filters its own list — preserves today's "type once, all three lists filter" behaviour.
- **Acknowledged behaviour delta — Insights tab-bar count.** Today the host owns the `insights` state, so once the user visits the Insights tab the count `Insights (N)` appears in the tab bar from any tab. After the refactor, `insights` state lives inside `InsightsTab` and is discarded on unmount. The tab bar therefore shows `Insights` (no count) whenever the Insights tab is not active. This is a minor delta, accepted because (a) replicating the old behaviour would require the host to mirror the count via a callback prop and would defeat the ownership split; (b) the References and Memory Blocks counts ARE host-owned today (they come from `load()`) and continue to display from any tab — the asymmetry is intentional and matches the natural data-ownership boundary.

## 13. Acceptance criteria

- `git diff client/src/pages/SubaccountKnowledgePage.tsx` shows the host shrunk to ≤ 280 LOC; no JSX or class strings changed for any element that remains in the host (header, error banner, baseline-artefacts list, tab bar, search input, drawer render).
- New folder `client/src/components/subaccount-knowledge/` exists with: `types.ts`, `format.ts`, `__tests__/format.test.ts`, `TabButton.tsx`, `ReferencesTab.tsx`, `InsightsTab.tsx`, `BlocksTab.tsx`, and optionally `RenameReferenceModal.tsx` (only if Chunk 4 triggered the extraction). No other files; no `atoms/` directory.
- `npm run lint`, `npm run typecheck`, `npm run build:client`, `npx vitest run client/src/components/subaccount-knowledge/__tests__/format.test.ts` all pass.
- Manual smoke test:
  - All three tabs render; tab-bar counts `References (N)` and `Memory Blocks (N)` update from any tab after every mutation. `Insights` count appears only while the Insights tab is active (see §12 delta).
  - "+ New Reference" opens the create modal on the References tab; "+ New Memory Block" opens it on the Blocks tab.
  - Promote a Reference → lands on Blocks tab, the new block appears, References count drops by 1.
  - Demote a Memory Block → lands on References tab, the new reference appears, Memory Blocks count drops by 1.
  - Promote an Insight → lands on References tab, the new reference appears in the list. Returning to the Insights tab then refetches and confirms the promoted insight no longer appears (the local insights state was discarded on unmount and the mount-effect re-fetches fresh).
  - Rename, Archive, Edit (Reference + Block), Demote ConfirmDialog, Archive ConfirmDialog all round-trip.
  - Baseline artefacts: status badge per slug, Edit drawer opens and saves.
  - Search input filters all three tab lists in real time.
- No new top-level package dependencies added.

## 14. Open questions

- None. The decomposition is mechanical; batch 1's `admin-subaccount-detail/` and `usage/` precedents answer every "where does X go" question. Implementation choices that earlier drafts left open (`key={blocksKey}` vs context; optional `atoms/`; optional rename-modal split) are now pinned: host owns `references` + `blocks` so no remount key is needed; no `atoms/` directory is created; `RenameReferenceModal.tsx` is the only allowed conditional extraction and only if the LOC budget triggers it.
