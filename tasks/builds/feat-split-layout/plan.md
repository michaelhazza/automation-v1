# Plan — feat-split-layout

**Spec:** `tasks/builds/feat-split-layout/spec.md`
**Source file:** `client/src/components/Layout.tsx` (1,325 LOC)
**Target host LOC:** ≤ 250 (target 150–200)

This plan mirrors the spec's §10 chunked migration. Read the spec before each chunk — every prop contract is in §8, every hook contract in §7, the cross-tenant safety logic to preserve is called out in §12.

## Chunk 1 — Pure helpers + presentational atoms

**Spec section:** §10 Chunk 1, §5, §9.

**Files to create:**
- `client/src/components/layout/breadcrumbs.ts` — `SEG`, `UUID_RE`, `avatarColor`, `toInitials`, `buildBreadcrumbs`. Pure helpers, no React.
- `client/src/components/layout/icons.tsx` — `Ico` wrapper + `Icons` object.
- `client/src/components/layout/NavItem.tsx` — moved from Layout (link variant, exact, badge, badgeLabel, manageTo).
- `client/src/components/layout/NavButton.tsx` — moved from Layout.
- `client/src/components/layout/NavSection.tsx` — moved from Layout. `NavSectionAction` stays inside this file (it's the click-action shape consumed by section headers; no other consumer).
- `client/src/components/layout/TrialCountdown.tsx` — moved from Layout. Self-contained for this chunk (Chunk 3 will refactor it to consume `useTrialCountdown`).
- `client/src/components/layout/__tests__/breadcrumbs.test.ts` — 5 Vitest cases per spec §9.

**Files to modify:**
- `client/src/components/Layout.tsx` — delete the moved functions / objects / constants from the file's top section (lines ~30–250 today). Add imports for the moved items.

**Done when:** host ~250 LOC lighter; G1 clean; `npx vitest run client/src/components/layout/__tests__/breadcrumbs.test.ts` passes.

## Chunk 2 — `NavItemRenderer`

**Spec section:** §10 Chunk 2.

**Files to create:**
- `client/src/components/layout/NavItemRenderer.tsx` — moves `renderNavItem` + `resolveIcon` out of Layout's inline closures. Consumes `Icons` and `NavItemSpec[]`. Component signature: `<NavItemRenderer items={...} />`. Inline special-cases for `new-task` and `sign-out` keys preserved verbatim.

**Files to modify:**
- `client/src/components/Layout.tsx` — remove the inline `renderNavItem` and `resolveIcon` function declarations. Replace the two `.map(renderNavItem)` invocations with `<NavItemRenderer items={...} />`.

**Done when:** sidebar's main and footer regions render via the renderer component.

## Chunk 3 — Extract 8 hooks

**Spec section:** §10 Chunk 3, §7.

**Files to create under `client/src/hooks/`:**
- `useLayoutIdentity.ts` — §7.1. Owns org/client mirror state, subaccounts list, all identity handlers (`selectOrg`, `selectClient`, `selectClientFromPalette`, `clearClient`, `logout`). Internally calls `reconnectSocket()` on org change.
- `useLayoutPermissions.ts` — §7.2. Owns orgPerms/clientPerms + `hasOrgPerm` / `hasClientPerm` closures.
- `useSidebarConfig.ts` — §7.3. Owns sidebarItems + `hasSidebarItem(slug)` (returns false until loaded).
- `useLayoutBadges.ts` — §7.4. Owns review/live/incident counts + budgetAlert + useSocketRoom wiring + internal resyncBadges.
- `useNavLists.ts` — §7.5. Owns navProjects/navAgents fetch per active client; exposes `refresh.projects()` and `refresh.agents()` for modal post-create.
- `useCommandPaletteKeybind.ts` — §7.6. Owns cmdOpen + Cmd/Ctrl+K listener.
- `useTrialCountdown.ts` — §7.7. Returns `{ label, severity }`.
- `useOrgList.ts` — §7.8. System-admin only; returns `{ orgs }`.

**Files to modify:**
- `client/src/components/Layout.tsx` — replace the ~15 inline useEffect blocks with hook calls. Preserve every eslint-disable comment and the rationale comments (e.g. line 387–391 today about subaccount refetch).
- `client/src/components/layout/TrialCountdown.tsx` — refactor to consume `useTrialCountdown`.

**Done when:** host is mostly hook calls + JSX; all badges, identity flows, sidebar config, command palette keybind work identically.

## Chunk 4 — Chrome regions

**Spec section:** §10 Chunk 4, §6, §8.1–8.4.

**Files to create:**
- `client/src/components/layout/IconRail.tsx` — props per §8.1. Logo, OrgPicker (inline unless > 200 LOC), client avatars, "+ new client" button, user avatar. Owns its own org-picker outside-click listener (local UI state, not a hook).
- `client/src/components/layout/SidebarShell.tsx` — props per §8.2. Context header, ViewModeSwitcher, two `<NavItemRenderer>` regions (main + footer).
- `client/src/components/layout/TopBar.tsx` — props per §8.3. Breadcrumb bar, optional GlobalAskBar, Cmd-K trigger.
- `client/src/components/layout/Breadcrumbs.tsx` — props `{ items: { label: string; to: string }[] }`. Consumes `buildBreadcrumbs` indirectly (parent passes computed items).
- `client/src/components/layout/BudgetAlertBanner.tsx` — props per §8.4. Returns null when alert or activeClientId is null. Severity bands 75/90/95 computed internally.
- (Conditional) `client/src/components/layout/OrgPicker.tsx` — only if `IconRail.tsx` exceeds 200 LOC after first pass.

**Files to modify:**
- `client/src/components/Layout.tsx` — replace IconRail JSX block (~lines 750-855), SidebarShell JSX block (~lines 858-915), TopBar JSX block (~lines 920-949), BudgetAlertBanner JSX (~lines 952-979) with component invocations.

**Done when:** host's `return (...)` is 5–6 component invocations plus the modal layer.

## Chunk 5 — Extract 4 modals

**Spec section:** §10 Chunk 5, §8.5, §12 (cross-tenant safety).

**Files to create under `client/src/components/layout/modals/`:**
- `CreateProjectModal.tsx` — props `{ open, activeClientId, onClose, onCreated(projectId) }`. Owns local form state + submission state.
- `CreateAgentModal.tsx` — props `{ open, activeClientId, onClose, onCreated(agentId) }`. Owns icon picker + form state.
- `CreateClientModal.tsx` — props `{ open, onClose, onCreated(client) }`. Owns form state + error state.
- `NewBriefModal.tsx` — props `{ open, onClose, identity, orgs, subaccounts, onSubmitted(briefId, contextSwitch) }`. **CRITICAL:** preserves the cross-tenant safety logic verbatim from today's Layout.tsx lines 569-599 — the `targetSubaccountId` guard inside the submit handler. The inline comments explaining that guard MUST carry over.

**Files to modify:**
- `client/src/components/Layout.tsx` — remove the four large modal JSX blocks (~lines 987-1322). Remove form state fields (newProjectName/Color/RepoUrl, newAgentName/Desc/Prompt/Icon/Role, newClientName/Slug, newBriefTitle/Desc/Priority, briefOrgOverride/briefSubaccountOverride, etc.) plus their loading/error fields and submit handlers. Replace with four component invocations. Wire each modal's `onCreated` callback to `navLists.refresh.*()` + navigation.

**Done when:** all four modals open, close, submit, and trigger the post-create navigation + nav-list refresh exactly as today.

## Chunk 6 — Final cleanup and verify

**Spec section:** §10 Chunk 6, §13.

- Remove any now-unused imports.
- Confirm host file ≤ 250 LOC (target 150–200).
- Run lint + typecheck + build:client + `npx vitest run client/src/components/layout/__tests__/breadcrumbs.test.ts`.

## Notes for builders

- Preserve every Tailwind class string and SVG path verbatim.
- The cross-tenant safety logic in `handleNewBriefSubmit` (today's Layout.tsx ~lines 569-599) is implementation-critical security logic. Lift verbatim into `NewBriefModal.tsx`. Reviewer will diff this byte-for-byte.
- Eslint-disable comments and rationale comments around effect dependencies (e.g. today's lines 387-391 about subaccount refetch on org change) carry over verbatim into hooks — they reflect the spec, not laziness.
- `handleLogout` order: `disconnectSocket()` first, THEN remove tokens. Preserved in `useLayoutIdentity.logout()`.
- Builder cannot dispatch sub-agents. If a prerequisite is missing (e.g. types or icons.tsx not yet created when building NavItemRenderer), return `PLAN_GAP`.
