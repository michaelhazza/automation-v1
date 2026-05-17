# Plan — feat-split-adminsubaccountdetailpage

**Spec:** `tasks/builds/feat-split-adminsubaccountdetailpage/spec.md`
**Source file:** `client/src/pages/AdminSubaccountDetailPage.tsx` (1,415 LOC)
**Target host LOC:** ≤ 280

This plan is a thin wrapper around the spec's §10 migration plan. The spec is the source of truth for every prop contract, data-fetch ownership decision, and behavioural-delta acknowledgement — read it before each chunk.

## Chunk order and dependencies

Chunks 1–4 must run in order: each one modifies the same host file (`AdminSubaccountDetailPage.tsx`) by deleting an inline tab body and replacing it with a component invocation, so they cannot parallelise. Chunk 5 is conditional. Chunk 6 is the verification sweep.

## Chunk 1 — Extract `types.ts` + 4 fully-self-contained tabs

**Spec section:** §10 Chunk 1, §5 (target structure), §8.1 / §8.6 / §8.7 / §8.8 (prop contracts).

**Files to create:**
- `client/src/components/admin-subaccount-detail/types.ts` — interfaces: `Subaccount`, `Category`, `ProcessLink`, `OrgProcess`, `ActiveTab` (union), `SettingsForm`, plus inlined-today row interfaces: `OrgAgent`, `LinkedAgent`, `Template`, `AgentRunRecord`, `Belief`, `OwedOnboardingRow`. Plus `TAB_LABELS: Record<ActiveTab, string>`.
- `client/src/components/admin-subaccount-detail/OnboardingTab.tsx` — moved from source lines 1264–1415 (today's `OnboardingTab` function + `OwedOnboardingRow` interface + `ONBOARDING_STATUS_STYLES` constant).
- `client/src/components/admin-subaccount-detail/BeliefsTab.tsx` — moved from source lines 1106–1262.
- `client/src/components/admin-subaccount-detail/DevContextConfig.tsx` — moved from source lines 945–1100.
- `client/src/components/admin-subaccount-detail/AgentsTab.tsx` — moved from source lines 572–943.

**Files to modify:**
- `client/src/pages/AdminSubaccountDetailPage.tsx` — delete the four inline tab components and their row-interface declarations. Add four imports. Replace tab-body JSX `{activeTab === 'foo' && <inline JSX>}` with `<FooTab subaccountId={subaccountId} />` for the four tabs (the inline JSX is already a sub-component call today for these four, so this is just an import-path swap).

**Done when:** host shrinks by ~795 LOC; lint + typecheck + build:client clean.

## Chunk 2 — Extract `WorkflowsTab` and `CategoriesTab`

**Spec section:** §10 Chunk 2, §8.2 / §8.3, §8 error-banner contract.

**Files to create:**
- `client/src/components/admin-subaccount-detail/WorkflowsTab.tsx`
- `client/src/components/admin-subaccount-detail/CategoriesTab.tsx`

Each tab gets its own local `error` state and renders the error banner `<div className="text-[13px] text-red-600 mb-4">{error}</div>` at the top of its body when non-empty.

**Files to modify:**
- `client/src/pages/AdminSubaccountDetailPage.tsx` — remove `showCatForm`, `catForm`, `deleteCatId`, `showLinkForm`, `linkForm`, `deleteLinkId` state from the host. Remove `handleCreateCategory`, `handleDeleteCategory`, `handleCreateLink`, `handleDeleteLink`, `handleToggleLinkActive` from the host. Replace the inline workflows / categories tab JSX with `<WorkflowsTab … />` and `<CategoriesTab … />`. Pass `linkedProcesses`, `orgProcesses`, `categories`, `onChange={load}` to WorkflowsTab; `categories`, `onChange={load}` to CategoriesTab.

**Done when:** workflows + categories tabs render identically; link / unlink / toggle / category-create / category-delete all work.

## Chunk 3 — Extract `BoardConfigTab` (fully self-contained)

**Spec section:** §10 Chunk 3, §8.4.

**Files to create:**
- `client/src/components/admin-subaccount-detail/BoardConfigTab.tsx` — owns its `GET /api/subaccounts/:id/board-config` fetch on mount, `boardColumns` / `boardLoading` / `boardSaving` / `boardMsg` state, and `handleSaveBoardConfig` / `handleResetFromOrg` / `handleInitBoard` handlers.

**Files to modify:**
- `client/src/pages/AdminSubaccountDetailPage.tsx` — remove board-config fetch from `load()`. Remove `boardColumns`, `boardLoading`, `boardSaving`, `boardMsg` state. Remove three board handlers. Replace inline board tab JSX with `<BoardConfigTab subaccountId={subaccountId} />`. Remove unused `BoardColumnEditor` import if no longer used in host (Chunk 6 will catch it).

**Done when:** empty-state init flow + populated-state save / reset flow both work; host `load()` no longer references board-config.

## Chunk 4 — Extract `AdminTab`

**Spec section:** §10 Chunk 4, §8.5.

**Files to create:**
- `client/src/components/admin-subaccount-detail/AdminTab.tsx` — owns `settingsForm`, `settingsSaved`, settings-scoped local `error`, `handleSaveSettings`. Seeds `settingsForm` from `subaccount` prop on mount; resyncs whenever `subaccount` changes. Composes `<DevContextConfig>`, conditional manual-baseline card, `<AdminBaselineResetButton>`.

**Files to modify:**
- `client/src/pages/AdminSubaccountDetailPage.tsx` — remove `settingsForm`, `settingsSaved`, `handleSaveSettings` from the host. Remove the shared `error` state and its banner above the tab dispatch (Categories / Workflows / Admin tabs now render their own banners; no other consumer remains). Replace inline admin tab JSX with `<AdminTab subaccountId={…} user={_user} subaccount={sa!} baselineStatus={baselineStatus} onSubaccountChanged={load} onBaselineSaved={load} />`. Remove unused `ManualBaselineForm` / `AdminBaselineResetButton` imports from host.

**Done when:** settings save round-trips and refreshes `Subaccount`; manual-baseline card appears only for `failed` or `captured+partial`; reset button sysadmin-only; banner rendering is inside AdminTab.

## Chunk 5 — Optional internal split of `AgentsTab`

**Spec section:** §10 Chunk 5, §5.

Skip unless `AgentsTab.tsx` after Chunk 1 still exceeds ~300 LOC.

If splitting: create `LinkAgentModal.tsx`, `TeamTemplatesModal.tsx`, `RunResultModal.tsx`, `AgentRunHistoryRow.tsx` under `client/src/components/admin-subaccount-detail/AgentsTab/`.

## Chunk 6 — Verify and clean up

**Spec section:** §10 Chunk 6, §13 acceptance criteria.

- Run lint, typecheck, build:client.
- Confirm host file ≤ 280 LOC.
- Remove any imports the host carried only for now-inlined tabs that are no longer referenced.
- Verify the deferred behaviour-delta (modal/draft state not surviving tab switch) is the only behavioural change.

## Notes for builders

- Preserve every Tailwind class string and console-error message verbatim during moves.
- The four already-self-contained tabs (Chunk 1) move WHOLESALE — no prop-shape change. Each function move is byte-equivalent inside the new file.
- Builder cannot dispatch sub-agents. If a chunk's prerequisite (e.g. types.ts from Chunk 1) is missing when building Chunk 2, return `PLAN_GAP`.
