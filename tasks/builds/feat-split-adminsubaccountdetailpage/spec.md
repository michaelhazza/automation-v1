**Status:** draft
**Spec date:** 2026-05-14
**Last updated:** 2026-05-14
**Author:** Michael
**Build slug:** feat-split-adminsubaccountdetailpage

# Split AdminSubaccountDetailPage along tab seams

## Table of contents

1. Goals
2. Non-goals
3. Existing primitives this spec reuses
4. Current structure (today)
5. Target structure
6. Component tree and ownership
7. Data-fetching ownership
8. Prop contracts at each new boundary
9. Pure-helper extraction
10. Migration plan (chunked)
11. Deferred Items
12. Self-consistency check
13. Acceptance criteria
14. Open questions

## 1. Goals

- Decompose `client/src/pages/AdminSubaccountDetailPage.tsx` (1,415 LOC) into one host page plus one file per tab, matching the established `client/src/components/<feature>/` extraction convention used by `pulse/`, `clientpulse/`, `skill-analyzer/`, `baseline/`.
- Preserve every user-visible behaviour: tab labels, tab order, URL `?tab=` parameter, visible-tabs differ by `mode` (`client` vs `admin`), modal copy, button labels, table columns, loading states, error states.
- Preserve the caller contract. `App.tsx` continues to import `AdminSubaccountDetailPage` as a default export with `{ user, mode? }` props from the same path.
- Reduce the file's mental footprint so future tab additions or per-tab work don't require touching the host page.

## 2. Non-goals

- Visual change of any kind. Class names, spacing, colour tokens, font sizes all stay byte-for-byte where extracted.
- API-shape change. Every endpoint call, payload, query-param, optional-chaining default, and error-handling branch (every `catch (err) => { console.error … }`) is preserved verbatim.
- Permission-gating change. `mode='client'` vs `mode='admin'` still controls visible tabs and the "Back to companies" link.
- Re-routing the page. The file path `client/src/pages/AdminSubaccountDetailPage.tsx` does not change.
- New tests. Per `docs/spec-context.md` (`runtime_tests: pure_function_only`, `frontend_tests: none_for_now`), no UI tests are added.
- Preserving draft tab-state across tab switches. See the acknowledged behaviour delta in §12 — modal-open state, unsaved settings-form edits, and unsaved board-column edits no longer survive a switch-away-and-back. This is an accepted minor delta for this refactor.

## 3. Existing primitives this spec reuses

| Primitive | Why reuse |
|---|---|
| `client/src/components/<feature>/` folder convention | Matches `pulse/`, `clientpulse/`, `skill-analyzer/`, `baseline/` — page imports tab files from `../components/<feature>/` |
| `client/src/components/Modal.tsx` | All current modal renders already use this — no change |
| `client/src/components/ConfirmDialog.tsx` | Same — no change |
| `client/src/components/baseline/*` | Already extracted; not touched |
| `client/src/components/workspace/WorkspaceTabContent.tsx` | Already extracted; not touched |
| `client/src/components/BoardColumnEditor.tsx` | Reused by extracted `BoardConfigTab` — same prop contract |
| `client/src/lib/api.ts` axios wrapper | All fetch calls keep using it |
| `sonner` `toast` | All current toast calls keep their wording |
| `useParams` / `useSearchParams` from `react-router-dom` | Host page keeps reading `subaccountId` and `tab` from these |

No new primitives invented.

## 4. Current structure (today)

`AdminSubaccountDetailPage.tsx` contains:

- **Host component** (lines 34–570) — tab nav + dispatch by `activeTab`:
  - Inline JSX for `workflows`, `categories`, `board`, `admin` tabs.
  - Lazy-loaded pages for `engines` (`AdminEnginesPage`), `tags` (`SubaccountTagsPage`), `usage` (`UsagePage`).
  - Imported tab content: `WorkspaceTabContent` (workspace tab).
- **Inline tab components** in the same file:
  - `AgentsTab` (lines 579–943, ~365 LOC) — linked agents list, run buttons, run history expander, run-result modal, link-agent modal, unlink confirm, team-templates modal.
  - `DevContextConfig` (lines 947–1100, ~155 LOC) — admin tab subsection.
  - `BeliefsTab` (lines 1118–1262, ~145 LOC) — agent picker + beliefs table + edit modal.
  - `OnboardingTab` (lines 1290–1415, ~130 LOC) — owed-workflow list + start button.

The host's own load logic (`load()`, `loadOrgData()`) fetches `Subaccount`, `categories`, `linkedProcesses`, `boardConfig`, `baselineStatus` for use by the workflows / categories / board / admin tabs only.

## 5. Target structure

```
client/src/pages/AdminSubaccountDetailPage.tsx        ← host only (~250 LOC target)
client/src/components/admin-subaccount-detail/
  ├─ WorkflowsTab.tsx                                 ← extracted, was inline
  ├─ CategoriesTab.tsx                                ← extracted, was inline
  ├─ BoardConfigTab.tsx                               ← extracted, was inline
  ├─ AdminTab.tsx                                     ← extracted, was inline; composes DevContextConfig + Baseline cards
  ├─ DevContextConfig.tsx                             ← extracted, was inline
  ├─ AgentsTab.tsx                                    ← extracted, was inline
  ├─ AgentsTab/                                       ← optional internal split, only if AgentsTab still exceeds ~300 LOC
  │   ├─ LinkAgentModal.tsx
  │   ├─ TeamTemplatesModal.tsx
  │   ├─ RunResultModal.tsx
  │   └─ AgentRunHistoryRow.tsx
  ├─ BeliefsTab.tsx                                   ← extracted, was inline
  ├─ OnboardingTab.tsx                                ← extracted, was inline
  └─ types.ts                                         ← shared interfaces (Subaccount, Category, ProcessLink, ActiveTab, OrgProcess, plus tab-specific row types)
```

Final routing: `App.tsx` continues to `import AdminSubaccountDetailPage from './pages/AdminSubaccountDetailPage'`. No App.tsx edits.

## 6. Component tree and ownership

```
AdminSubaccountDetailPage  (host)
│
├── header (h1 + slug + BaselineStatusBadge + Back link)            ← inline
├── tab bar                                                          ← inline
└── tab body — dispatch by activeTab
    ├── onboarding  → <OnboardingTab subaccountId />                ← owns its data
    ├── engines     → <Suspense><AdminEnginesPage embedded /></...> ← unchanged lazy
    ├── workflows   → <WorkflowsTab subaccountId, linkedProcesses, orgProcesses, categories, onChange />
    ├── agents      → <AgentsTab subaccountId />                    ← owns its data
    ├── beliefs     → <BeliefsTab subaccountId />                   ← owns its data
    ├── categories  → <CategoriesTab subaccountId, categories, onChange />
    ├── tags        → <Suspense><SubaccountTagsPage /></...>        ← unchanged lazy
    ├── board       → <BoardConfigTab subaccountId />               ← fully self-contained; owns its fetch + state
    ├── usage       → <Suspense><UsagePage embedded /></...>        ← unchanged lazy
    ├── workspace   → <WorkspaceTabContent subaccountId />          ← unchanged
    └── admin       → <AdminTab subaccountId, user, subaccount, baselineStatus, onSubaccountChanged, onBaselineSaved />
```

## 7. Data-fetching ownership

Today, the host calls one mega-`load()` fetching `Subaccount`, `categories`, `linkedProcesses`, `boardConfig`, `baselineStatus` in parallel, plus a separate `loadOrgData()` for org-level workflow templates.

The refactor splits ownership by tab while keeping the page-level identity load:

**Stays on host:**
- `GET /api/subaccounts/:id` → `Subaccount` (drives the header h1 + slug, `visibleTabs` derivation, and is passed to `AdminTab` as the `subaccount` prop, which uses it to seed its internal `settingsForm`).
- `GET /api/subaccounts/:id/baseline` → `baselineStatus` (drives the manual-entry card visibility in AdminTab ONLY; passed to AdminTab as a prop). The header's `BaselineStatusBadge` self-fetches the same endpoint internally — it does NOT consume the host's `baselineStatus` value, so the badge's prop contract is unchanged.

**Moves to tab components (self-fetched on mount):**
- `OnboardingTab` already fetches `GET /api/subaccounts/:id/onboarding/owed` itself today — no change.
- `AgentsTab` already fetches `GET /api/subaccounts/:id/agents` + `/api/agents` + `/api/hierarchy-templates` + `/api/subaccounts/:id/claude-code-status` itself today — no change.
- `BeliefsTab` already fetches `/api/subaccounts/:id/agents` + per-agent beliefs itself today — no change.
- `DevContextConfig` already fetches `/api/subaccounts/:id/dev-context` itself today — no change.
- `BoardConfigTab` (new): takes over `GET /api/subaccounts/:id/board-config` from the host. The host no longer fetches board-config — `boardColumns` / `boardLoading` / `boardSaving` / `boardMsg` state and the three mutation handlers (`handleSaveBoardConfig`, `handleResetFromOrg`, `handleInitBoard`) all live in the tab.

**Mixed ownership (host fetches, child renders + mutates):**
- `categories`: host fetches `GET /api/subaccounts/:id/categories` (host needs the list for the workflows-tab "link-to-category" dropdown). Host passes `categories` + `onChange={load}` to `CategoriesTab` and `WorkflowsTab`.
- `linkedProcesses` + `orgProcesses`: host fetches both. Host passes them to `WorkflowsTab` along with `categories` and `onChange={load}`.
- `Subaccount` is also mixed-ownership in spirit: AdminTab mutates it via `PATCH /api/subaccounts/:id` inside `handleSaveSettings`. After success, AdminTab calls `onSubaccountChanged`; the host's `load()` re-fetches and the new `Subaccount` cascades back through the `subaccount` prop, reseeding AdminTab's `settingsForm`. No separate ownership row needed — it's the same Subaccount listed under "Stays on host."

**Rationale.** The mega-`load()` couples ownership of every cross-tab dependency in the page. The split above keeps the host responsible only for data that more than one tab consumes (categories, linked processes), or that hydrates the host's own settings form. Each fully self-contained tab moves with its data fetch — including `BoardConfigTab`, which used to be host-owned but has no cross-tab dependency. Mixed-ownership tabs use an `onChange` callback that lets the child trigger a host refresh after a mutation — same model `WorkspaceTabContent` already uses.

## 8. Prop contracts at each new boundary

Pin every shape. JSON-style examples are illustrative; final TypeScript shapes live in `types.ts` co-located with the tab components.

**Error-banner contract (applies only to the THREE tabs whose error path moves off the host).** Today the host owns a shared `error` state (line 51 of the source) rendered as a single banner at line 244 above the tab dispatch; only three handlers push into it: `handleCreateCategory`, `handleCreateLink`, `handleSaveSettings`. The tab-bar handler clears it on switch (line 231). After extraction those three handlers' tabs — `CategoriesTab`, `WorkflowsTab`, `AdminTab` — each own their own local `error` state and render the same simple Tailwind banner (`<div className="text-[13px] text-red-600 mb-4">{error}</div>`) at the top of their body, byte-for-byte identical to the host's current banner. Tab-switch clearing happens implicitly because the unmounting tab discards its local state. The host's shared `error` state and banner are removed.

All OTHER tabs (AgentsTab, BeliefsTab, DevContextConfig, OnboardingTab) keep their existing local error treatment verbatim — AgentsTab and DevContextConfig use boxed red banners (`bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 …`), OnboardingTab uses a plain `py-4 text-sm text-red-600`, BeliefsTab has no local error state and uses `toast.error(…)`. None of those visual treatments change; this contract does NOT propagate to them. The §2 "Visual change of any kind" non-goal is preserved.

No new `onError` callbacks are added.

### 8.1 `<OnboardingTab>`

```
props: { subaccountId: string }
```
No callback — tab handles `Start` navigation by `window.location.href = …` exactly as today.

### 8.2 `<WorkflowsTab>`

```
props: {
  subaccountId: string;
  linkedProcesses: ProcessLink[];
  orgProcesses: OrgProcess[];
  categories: Category[];
  onChange: () => void;             // host calls load() to refresh after link/unlink/toggle
}
```

`ProcessLink`, `OrgProcess`, `Category` defined in `types.ts`. Modal state (`showLinkForm`, `deleteLinkId`, `linkForm`) becomes internal to the tab.

### 8.3 `<CategoriesTab>`

```
props: {
  subaccountId: string;
  categories: Category[];
  onChange: () => void;
}
```

Modal state (`showCatForm`, `deleteCatId`, `catForm`) becomes internal.

### 8.4 `<BoardConfigTab>`

```
props: { subaccountId: string }
```

Fully self-contained. The tab owns its own `GET /api/subaccounts/:id/board-config` fetch on mount, plus `boardColumns`, `boardLoading`, `boardSaving`, `boardMsg` local state and the three handlers (`handleSaveBoardConfig`, `handleResetFromOrg`, `handleInitBoard`). Empty-array `boardColumns` after fetch still means "uninitialised" and renders the Init-from-Org card; populated array renders the editor. No `columns` prop and no `onChange` callback — there is no cross-tab consumer.

### 8.5 `<AdminTab>`

```
props: {
  subaccountId: string;
  user: User;
  subaccount: Subaccount;            // host-fetched identity row; AdminTab seeds its settings form from this on mount
  baselineStatus: { status: string; confidence?: string } | null;
  onSubaccountChanged: () => void;   // host calls load() to refetch Subaccount after a successful settings save
  onBaselineSaved: () => void;       // called by ManualBaselineForm's onSaved + AdminBaselineResetButton's onReset
}
```

`SettingsForm` shape (lives inside AdminTab as local state, not a prop):
```
{ name: string; slug: string; status: string; timezone: string; includeInOrgInbox: boolean; runRetentionDays: string }
```

`AdminTab` owns `settingsForm`, `settingsSaved`, and its local `error` state (per §8's error-banner contract), plus the `handleSaveSettings` handler. It seeds `settingsForm` from `subaccount` on mount and resets it whenever `subaccount` changes (i.e. after `onSubaccountChanged` triggers a host refresh). The success path calls `onSubaccountChanged` so the host's `Subaccount` and any other tab consuming it stay fresh.

Internally composes `<DevContextConfig subaccountId />`, the manual-baseline card (conditional render unchanged), and `<AdminBaselineResetButton>` (unchanged).

### 8.6 `<DevContextConfig>`

```
props: { subaccountId: string }
```
Already self-contained today — moves wholesale; no shape change.

### 8.7 `<AgentsTab>`

```
props: { subaccountId: string }
```
Already self-contained today — moves wholesale. If still exceeds ~300 LOC after move, optional internal split into `LinkAgentModal.tsx`, `TeamTemplatesModal.tsx`, `RunResultModal.tsx`, `AgentRunHistoryRow.tsx` per §5.

### 8.8 `<BeliefsTab>`

```
props: { subaccountId: string }
```
Already self-contained today — moves wholesale.

## 9. Pure-helper extraction

Three small pure helpers / constants are co-located inside the host today:

- The `inputCls`, `btnPrimary`, `btnSecondary` string constants — leave inline in each consuming file as Tailwind utility strings. Do NOT centralise into a constants file (each tab will use only the ones it needs).
- The `TAB_LABELS: Record<ActiveTab, string>` — moves to `types.ts` next to `ActiveTab`.
- `ONBOARDING_STATUS_STYLES: Record<string, { dot: string; label: string }>` — already lives inside the onboarding tab; moves with it.

No new pure functions introduced; no Vitest tests added.

## 10. Migration plan (chunked)

Each chunk leaves the page green (lint + typecheck + build:client clean) and visually unchanged. Chunks are sequenced so dependent files appear before consumers, and each chunk is independently revertible.

### Chunk 1 — Extract `types.ts` and the four fully-self-contained tabs

- Create `client/src/components/admin-subaccount-detail/types.ts` with `Subaccount`, `Category`, `ProcessLink`, `OrgProcess`, `ActiveTab`, `TAB_LABELS`, `SettingsForm`, plus the tab-specific row interfaces currently declared above each of the four self-contained tabs (`OrgAgent`, `LinkedAgent`, `Template`, `AgentRunRecord`, `Belief`, `OwedOnboardingRow`).
- Move `OnboardingTab`, `BeliefsTab`, `DevContextConfig`, `AgentsTab` to dedicated files under `client/src/components/admin-subaccount-detail/`. No prop-shape change.
- Update host imports.
- **Done when:** host file shrinks by ~795 LOC; visible behaviour unchanged.

### Chunk 2 — Extract `WorkflowsTab` and `CategoriesTab`

- Create `WorkflowsTab.tsx` and `CategoriesTab.tsx` under the new folder.
- Move `showLinkForm`, `linkForm`, `deleteLinkId` state into `WorkflowsTab`; `showCatForm`, `catForm`, `deleteCatId` state into `CategoriesTab`. Each tab also gains its own local `error` state per §8's error-banner contract.
- Move `handleCreateLink`, `handleDeleteLink`, `handleToggleLinkActive` into `WorkflowsTab`. Move `handleCreateCategory`, `handleDeleteCategory` into `CategoriesTab`. Error paths inside these handlers write to the tab's LOCAL `error` state, not the host's.
- Host passes `linkedProcesses`, `orgProcesses`, `categories`, `onChange={load}` to `WorkflowsTab`; `categories`, `onChange={load}` to `CategoriesTab`. No error callback is needed — each tab renders its own banner.
- **Done when:** workflows and categories tabs render identically; link / unlink / toggle / category create / category delete all work; the host's shared `error` state is now unused for these flows.

### Chunk 3 — Extract `BoardConfigTab` (fully self-contained)

- Create `BoardConfigTab.tsx`. Move `boardColumns`, `boardLoading`, `boardSaving`, `boardMsg` state and the three handlers (`handleSaveBoardConfig`, `handleResetFromOrg`, `handleInitBoard`) into the tab.
- Move the `GET /api/subaccounts/:id/board-config` fetch out of the host's `load()` and into the tab's `useEffect` mount fetch.
- Host passes only `subaccountId`. No `columns` prop, no `onChange` callback — there is no cross-tab consumer of board state.
- **Done when:** empty-state init flow + populated-state save / reset flow both work, message banners appear and clear identically. Host `load()` no longer references board-config.

### Chunk 4 — Extract `AdminTab` (composes DevContextConfig + baseline cards)

- Create `AdminTab.tsx`. Move `settingsForm`, `settingsSaved`, the settings-scoped local `error` state (per §8's error-banner contract), and `handleSaveSettings` ALL into the tab. The tab seeds `settingsForm` from the `subaccount` prop on mount and resyncs whenever `subaccount` changes.
- Host stops owning `settingsForm` and `settingsSaved`. Host still owns `Subaccount` and passes it through as the `subaccount` prop. Host's `onSubaccountChanged` is the existing `load()` function so a successful save triggers a fresh `Subaccount` fetch.
- Tab internally renders the company-settings form, the local "Saved successfully" banner, the local error banner, `<DevContextConfig>`, the conditional manual-baseline card, and `<AdminBaselineResetButton>`.
- **Done when:** settings save round-trips and refreshes the underlying `Subaccount`; manual-baseline card appears only for `failed` or `captured+partial`; reset button works for sysadmin only; settings-save error and saved banner both render inside AdminTab, not at host level.

### Chunk 5 — Optional internal split of `AgentsTab` (only if it remains too large)

- If `AgentsTab.tsx` after Chunk 1 still exceeds ~300 LOC, split into the sub-files in §5: `LinkAgentModal.tsx`, `TeamTemplatesModal.tsx`, `RunResultModal.tsx`, `AgentRunHistoryRow.tsx`. All co-located under `AgentsTab/`.
- Do NOT split if the file lands under ~300 LOC after Chunk 1 — over-splitting fragments a coherent tab.

### Chunk 6 — Verify and clean up

- Run lint, typecheck, build:client.
- Confirm the host file is ~250 LOC and contains: imports, lazy imports, `load()` (now slimmer — no `boardConfig` fetch), `loadOrgData()`, header render, tab nav render, and tab-dispatch JSX.
- Confirm the host no longer holds `settingsForm`, `settingsSaved`, `boardColumns`, `boardLoading`, `boardSaving`, `boardMsg`, or the shared `error` state — all of these moved into their respective tabs.
- Remove any now-unused imports the host carried only for the inlined tabs (likely candidates: `BoardColumnEditor`, `ManualBaselineForm`, `AdminBaselineResetButton`, `Modal`, `ConfirmDialog` if no longer referenced by the host itself).

## 11. Deferred Items

- **A central `<TabBar>` primitive shared with `UsagePage`.** Both files render almost-identical tab bars. Sharing is tempting; deferring because the two pages have different `Tab` enum types and the duplication is 15 lines. Revisit only when a third page needs the same control. Reason: avoid premature abstraction.
- **Pure render-helper tests.** No new pure helpers are introduced by this refactor that aren't already trivial constants. If Chunk 5 fires and `RunResultModal.tsx` ends up with formatting logic, add a targeted Vitest test for that one helper only. Reason: align with `frontend_tests: none_for_now`.
- **Subaccount-detail folder move.** Promoting `AdminSubaccountDetailPage.tsx` to `client/src/pages/admin-subaccount-detail/index.tsx` would match `govern/` and `operate/` patterns. Out of scope — would touch `App.tsx` routing and is unrelated to the LOC-pressure problem the user raised.

## 12. Self-consistency check

- Visible-tab differs by `mode`: preserved (host still owns `visibleTabs` derivation).
- `?tab=` URL param: preserved (host still computes `initialTab` from `searchParams`).
- `BaselineStatusBadge` next to slug: preserved (only `mode='admin'`, host renders it inline).
- Lazy-loaded `engines`, `tags`, `usage` tabs: preserved (Suspense boundaries unchanged).
- `mode='client'` shows only `board` and `categories` tabs: preserved.
- "Back to companies" link only in `mode='admin'`: preserved.
- All console error logs in `.catch` clauses: preserved verbatim; do not consolidate into a helper.
- Visible error-banner location: changes from one host-level banner above the tab dispatch to one local banner inside whichever extracted tab raised the error. Tab-switch clearing remains automatic (unmount discards local state). Same Tailwind class string preserved verbatim.
- **Acknowledged behaviour delta — draft tab-state across tab switches.** Today, `settingsForm`, `boardColumns`, `showCatForm`/`catForm`, `showLinkForm`/`linkForm` all live on the host above the activeTab conditional, so unsaved values and open-modal state survive switching away and back. After this refactor those states live inside their respective tab components, which unmount when activeTab changes. The behaviour delta: (a) an open category-create or workflow-link modal closes when the user switches tabs, (b) unsaved settings-form edits in AdminTab are lost on tab switch (last-fetched `Subaccount` reseeds the form on remount), (c) unsaved board-column edits in BoardConfigTab are lost on tab switch (the tab refetches `/board-config` on remount). This delta is intentional and accepted because preserving the old behaviour would require either mounting every tab unconditionally and toggling visibility via `hidden` (which causes every tab to self-fetch on initial page load, defeating the lazy/conditional render model the page uses) or lifting all draft state back to the host (which undoes the refactor). The current behaviour is not a feature users rely on — it is an incidental consequence of where the state lived. Document in the PR description for the human to confirm acceptance.

## 13. Acceptance criteria

- Pre / post comparison: `git diff client/src/pages/AdminSubaccountDetailPage.tsx` shows the host shrunk to ≤ 280 LOC; no JSX or class strings changed for any element that remains in the host.
- New folder `client/src/components/admin-subaccount-detail/` exists with one file per tab listed in §5.
- `npm run lint`, `npm run typecheck`, `npm run build:client` all pass.
- Manual smoke test:
  - In `mode='admin'`: all 11 tabs (`onboarding`, `engines`, `workflows`, `agents`, `beliefs`, `categories`, `tags`, `board`, `usage`, `workspace`, `admin`) render; all modals open and close; link / unlink / save / reset / init / run / template-apply all succeed against a dev backend.
  - In `mode='client'`: the only visible tabs (`board`, `categories`) both render; category create/delete and board init/save/reset all succeed; the "Back to companies" link is hidden as expected.
- No new top-level package dependencies added to `package.json` by this refactor. New tab files MAY (and will need to) import existing modules — `react-router-dom` (for `Link`), `../../lib/api` (for the axios wrapper), `../../lib/auth` (for `User`) — as their own props and JSX require. The intent of this criterion is "no new npm dependencies," not "no new import statements."

## 14. Open questions

- None. The refactor is mechanical; the existing `pulse/` precedent answers every "where does X go" question.
