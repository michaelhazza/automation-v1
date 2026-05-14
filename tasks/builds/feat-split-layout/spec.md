**Status:** reviewing
**Spec date:** 2026-05-14
**Last updated:** 2026-05-14
**Author:** Michael
**Build slug:** feat-split-layout

# Split Layout along chrome / modal / data-orchestrator seams

## Table of contents

1. Goals
2. Non-goals
3. Existing primitives this spec reuses
4. Current structure (today)
5. Target structure
6. Component tree and ownership
7. Data and side-effect ownership (hooks extracted)
8. Prop contracts at each new boundary
9. Pure-helper extraction
10. Migration plan (chunked)
11. Deferred Items
12. Self-consistency check
13. Acceptance criteria
14. Open questions

## 1. Goals

- Decompose `client/src/components/Layout.tsx` (1,325 LOC) into a thin layout host plus one file per logically distinct chrome region (icon rail, sidebar, topbar, alerts, modals), matching the established `client/src/components/<feature>/` convention.
- Lift side-effect-heavy state (identity, permissions, badges, projects/agents, budget, socket, keyboard) into focused hooks under `client/src/hooks/` so each hook owns one slice of orchestration logic and the host stays declarative.
- Preserve every user-visible behaviour: icon-rail order, org picker, client avatars + active-marker bar, sidebar groups, breadcrumb derivation, budget banner thresholds (≥75% / ≥90% / ≥95% colour bands), trial countdown copy thresholds, Cmd/Ctrl+K palette, four create-modal flows (Project, Agent, Client, Brief), and the cross-tenant safety logic in the New Brief submit handler (today's lines 569–599 — the `targetSubaccountId` guard inside `handleNewBriefSubmit`).
- Preserve the caller contract. `App.tsx` continues to import `Layout` as a default export with `{ user, children }` props from the same path.

## 2. Non-goals

- Visual change. All Tailwind classes, SVG paths, colour tokens, dimensions, animation timings stay byte-for-byte.
- WebSocket protocol change. `useSocketRoom('subaccount', activeClientId, …)` keeps the same event handlers and `resyncBadges` semantics.
- Auth / localStorage change. The `auth.ts` getters / setters (`getActiveOrgId`, `setActiveOrg`, etc.) remain the source of truth; React mirror state still tracks them.
- Permission-resolution change. `hasOrgPerm` / `hasClientPerm` keep the same `__system_admin__` / `__org_admin__` sentinels and `'/api/my-permissions'` shape.
- Nav-config change. `buildNavItems(navCtx)` and the `NavItemSpec` / `NavContext` types in `client/src/config/sidebar.ts` are NOT touched — the host keeps producing `navCtx` and passing it through.
- New tests beyond those allowed by `docs/spec-context.md` (`runtime_tests: pure_function_only`). One Vitest unit file for `buildBreadcrumbs` is in scope (see §9 for the five cases). The other pure helpers (`avatarColor`, `toInitials`) are too trivial to test individually; their behaviour is covered by visual smoke.

## 3. Existing primitives this spec reuses

| Primitive | Why reuse |
|---|---|
| `client/src/components/<feature>/` folder convention | Existing `client/src/components/global-ask-bar/` and `client/src/components/pulse/` precedent for layout-adjacent groupings |
| `client/src/config/sidebar.ts` (`buildNavItems`, `NavContext`, `NavItemSpec`) | The data-shape contract between Layout and its nav definitions is already correct — extraction does not change it |
| `client/src/config/routes.ts` (`AppRoute`, `buildRoute`, `staticRoute`) | All link destinations keep going through the route registry |
| `client/src/hooks/useViewMode.ts` | Stays as-is; host continues to wire `onRequireClientSelection` and `onClientCleared` |
| `client/src/hooks/useSocket.ts` (`useSocketRoom`) | Extracted badges hook re-uses it |
| `client/src/hooks/useConfigAssistantPopup.ts` / `useUserOwnedAgents.ts` | Already extracted; consumed by the host |
| `client/src/components/CommandPalette.tsx` / `ViewModeSwitcher.tsx` / `global-ask-bar/GlobalAskBar.tsx` | Already extracted; consumed by the chrome |
| `client/src/lib/auth.ts` localStorage helpers | Source of truth for org / client / system-admin override identity |

No new primitives invented.

## 4. Current structure (today)

`Layout.tsx` contains, roughly:

- **Top-of-file presentational helpers** (lines 1–250)
  - `Icons` object (~30 inline SVG icons), `avatarColor`, `toInitials`, `SEG`, `UUID_RE`, `buildBreadcrumbs` (pure)
  - Small components: `NavButton`, `NavItem`, `NavSectionAction`, `NavSection`, `TrialCountdown`
- **Main `Layout` component** (lines 253–1325) — single ~1,070-line function:
  - **State declarations** (~80 lines): identity (org id/name/orgs, client id/name/subaccounts), perms (`orgPerms`, `clientPerms`), badges (`reviewCount`, `liveAgentCount`, `incidentCount`), 4 sets of modal-form fields, dynamic nav (`navProjects`, `navAgents`), `budgetAlert`, `cmdOpen`, view-mode hookups, sidebar items
  - **~15 `useEffect` blocks** for: org auto-set, fetch orgs, fetch subaccounts, fetch org perms, fetch client perms, fetch sidebar-config, review-count badge, incident badge, live-agent badge, dynamic nav list, budget alert, socket init, Cmd+K keybind, org-picker outside-click, useSocketRoom subscription
  - **Handlers**: `handleSelectClient`, `handleSelectClientFromPalette`, `handleSelectOrg`, `handleOpenNewBrief`, `handleNewBriefSubmit` (~50 LOC with cross-tenant safety logic), `handleLogout`, `resyncBadges`
  - **Render** (lines 741–1323):
    - Cmd palette overlay + four modal overlays (Create Project, Create Agent, Create Client, New Brief) totalling ~340 LOC of JSX
    - Icon rail (~104 LOC): logo, org picker dropdown, client avatars, "+ new client" button, user avatar
    - Main sidebar (~58 LOC): context header, ViewModeSwitcher, nav-item renderer, footer (TrialCountdown + footer nav items + support link)
    - Main content area (~67 LOC): breadcrumb bar, GlobalAskBar, Cmd+K trigger button, BudgetAlertBanner, children
    - `renderNavItem` / `resolveIcon` inline closure helpers (~85 LOC)

## 5. Target structure

```
client/src/components/Layout.tsx                        ← host only (~150–200 LOC target)
client/src/components/layout/
  ├─ IconRail.tsx                          ← logo, org picker, client avatars, new-client button, user avatar
  ├─ SidebarShell.tsx                      ← context header, ViewModeSwitcher, nav region, footer composition
  ├─ NavItem.tsx                           ← moved from Layout (link variant, exact, badge, badgeLabel, manageTo)
  ├─ NavButton.tsx                         ← moved from Layout (button variant)
  ├─ NavSection.tsx                        ← moved from Layout (section header + optional + action)
  ├─ NavItemRenderer.tsx                   ← renderNavItem + resolveIcon (the closure helpers, extracted)
  ├─ TrialCountdown.tsx                    ← moved from Layout
  ├─ BudgetAlertBanner.tsx                 ← extracted, was inline in main content
  ├─ TopBar.tsx                            ← breadcrumb bar + GlobalAskBar slot + Cmd-K trigger
  ├─ Breadcrumbs.tsx                       ← consumes buildBreadcrumbs helper
  ├─ OrgPicker.tsx                         ← conditional split out of IconRail (created only if IconRail.tsx > 200 LOC after Chunk 4; otherwise stays inline)
  ├─ icons.tsx                             ← the Icons map + Ico wrapper; nothing else
  ├─ breadcrumbs.ts                        ← pure helpers: SEG, UUID_RE, buildBreadcrumbs, avatarColor, toInitials
  └─ modals/
      ├─ CreateProjectModal.tsx
      ├─ CreateAgentModal.tsx
      ├─ CreateClientModal.tsx
      └─ NewBriefModal.tsx                 ← contains the cross-tenant safety logic
client/src/hooks/
  ├─ useLayoutIdentity.ts                  ← org / client React-mirror state + auto-set, persisted via auth.ts
  ├─ useLayoutPermissions.ts               ← orgPerms + clientPerms + hasOrgPerm/hasClientPerm derivations
  ├─ useSidebarConfig.ts                   ← /api/my-sidebar-config + hasSidebarItem(slug)
  ├─ useLayoutBadges.ts                    ← review/live/incident counts + budgetAlert + useSocketRoom wiring + resync
  ├─ useNavLists.ts                        ← navProjects + navAgents fetch per active client
  ├─ useCommandPaletteKeybind.ts           ← Cmd/Ctrl+K listener
  ├─ useTrialCountdown.ts                  ← /api/my-subscription + day-count derivation (replaces inline state in TrialCountdown)
  └─ useOrgList.ts                         ← system-admin only; orgs list for IconRail OrgPicker + NewBriefModal
```

`App.tsx`'s `import Layout from './components/Layout'` is unchanged.

## 6. Component tree and ownership

```
Layout  (host — ~150–200 LOC)
│
├── <CommandPalette> (unchanged primitive, already extracted)
├── <IconRail user, identity, orgs, subaccounts, canCreateClient, onCreateClient />
│    ├── <OrgPicker orgs, activeOrgId, activeOrgName, onSelectOrg />   ← inside IconRail; visible only for system_admin
│    └── client avatars (inline)
├── <SidebarShell user, viewMode, availableModes, setViewMode, navItems, identity />
│    ├── context header (inline)
│    ├── <ViewModeSwitcher … />                          (unchanged primitive)
│    ├── <NavItemRenderer items=navItems.filter(s => s.group !== 'footer') />
│    └── footer
│         ├── <TrialCountdown />                          (already moved)
│         ├── <NavItemRenderer items=navItems.filter(s => s.group === 'footer') />
│         └── "Need help?" mailto link (inline)
├── <main>
│    ├── <TopBar breadcrumbs, hasOrgContext, onOpenCommandPalette />
│    │    ├── <Breadcrumbs items />
│    │    ├── (optional) <GlobalAskBar />
│    │    └── Cmd-K trigger button
│    ├── <BudgetAlertBanner alert, activeClientId, onDismiss />        ← rendered only when alert and client present
│    └── <div class="page content"> {children} </div>
└── modal layer
     ├── <CreateProjectModal activeClientId, open, onClose, onCreated />
     ├── <CreateAgentModal activeClientId, open, onClose, onCreated />
     ├── <CreateClientModal open, onClose, onCreated />
     └── <NewBriefModal open, onClose, identity, orgs, subaccounts, onCreated />
```

The host's primary job becomes orchestration: wire hooks together, derive `navCtx`, call `buildNavItems(navCtx)`, pass slices to chrome components, own the four modal-open flags. All side effects move into the hooks; all presentation moves into the chrome components.

## 7. Data and side-effect ownership (hooks extracted)

Each hook owns a coherent slice of state. The host wires the slices into a single `navCtx` and into the chrome components.

### 7.1 `useLayoutIdentity(user)`

Owns: `activeOrgId` / `activeOrgName` / `activeClientId` / `activeClientName` mirror state, the auto-set-org effect (line 356-370 today), `setActiveOrg` / `setActiveClient` / `removeActiveClient` / `removeSystemAdminOrgOverride` integrations, `handleSelectOrg`, `handleSelectClient`, `handleSelectClientFromPalette`.

Returns:
```
{
  activeOrgId, activeOrgName, activeClientId, activeClientName,
  hasOrgContext, isSystemAdmin,
  selectOrg(org), selectClient(sa), selectClientFromPalette(id, name),
  clearClient(),
  logout(),                       // disconnectSocket + remove tokens + navigate('/login')
}
```

Internally calls `reconnectSocket()` on org change and clears `systemAdminOrgOverride` on client select.

### 7.2 `useLayoutPermissions(identity)`

Owns: `orgPerms`, `clientPerms` state, the two fetch effects (lines 394–407 today), the `hasOrgPerm` / `hasClientPerm` derivation closures.

Returns:
```
{
  hasAnyOrgPerm,
  hasOrgPerm(key),
  hasClientPerm(key),
}
```

### 7.3 `useSidebarConfig(identity)`

Owns: `sidebarItems` set, `sidebarLoaded`, the `/api/my-sidebar-config` fetch effect (lines 410–422 today), the `hasSidebarItem(slug)` closure.

Returns:
```
{
  sidebarLoaded,
  hasSidebarItem(slug),            // returns false until loaded, then membership check
}
```

### 7.4 `useLayoutBadges(identity)`

Owns: `reviewCount`, `liveAgentCount`, `incidentCount`, `budgetAlert`, the four initial-load effects (lines 425–456 today), `resyncBadges`, the `useSocketRoom` subscription (lines 460–473 today).

Returns:
```
{
  reviewCount, liveAgentCount, incidentCount, budgetAlert,
  dismissBudgetAlert(),
}
```

Internally calls `useSocketRoom('subaccount', activeClientId, …, resyncBadges)`. `resyncBadges` is internal to the hook (passed to `useSocketRoom` as its reconnect callback) and intentionally NOT part of the returned contract — no consumer outside the hook needs it.

### 7.5 `useNavLists(identity)`

Owns: `navProjects`, `navAgents` state, the per-client fetch effect (lines 476–484 today).

Returns:
```
{
  navProjects,       // NavProject[] mapped to { id, name, color, status }
  navAgents,         // NavAgent[] mapped to { id, agentId, name, icon }
  refresh: { projects(), agents() },   // exposed so modals can call after create
}
```

### 7.6 `useCommandPaletteKeybind()`

Owns: `cmdOpen` state, the Cmd/Ctrl+K listener (lines 507–513 today).

Returns: `{ cmdOpen, open(), close() }`.

### 7.7 `useTrialCountdown()`

Replaces `TrialCountdown`'s internal state. Owns: `trialEndsAt`, `status`, the `/api/my-subscription` fetch. Returns `{ label: string | null, severity: 'muted' | 'warn' | 'danger' | null }`. The component becomes pure rendering.

### 7.8 `useOrgList(isSystemAdmin)` (system admin only)

Owns: `orgs` state, fetch effect (lines 373–377 today). The hook lives at `client/src/hooks/useOrgList.ts`. The **host** invokes it and passes `orgs` down to both `<IconRail>` (§8.1) and `<NewBriefModal>` (§8.5). Both consumers receive the array as a prop — neither owns the fetch. When `isSystemAdmin` is false the hook short-circuits and returns `[]`.

Returns:
```
{
  orgs,                            // OrgOption[]; [] when !isSystemAdmin
}
```

## 8. Prop contracts at each new boundary

All `Identity` references below are the shape returned by `useLayoutIdentity`.

### 8.1 `<IconRail>`

```
props: {
  user: User;
  identity: Identity;
  orgs: OrgOption[];                       // system admin only; empty array otherwise
  subaccounts: ClientOption[];
  canCreateClient: boolean;                // hasOrgPerm('org.subaccounts.edit')
  onCreateClient(): void;
}
```

### 8.2 `<SidebarShell>`

```
props: {
  identity: Identity;
  viewMode: ViewMode;
  availableModes: ViewMode[];
  setViewMode(next: ViewMode): void;
  hasAnyOrgPerm: boolean;
  navItems: NavItemSpec[];                 // already built by host via buildNavItems(navCtx)
  isSystemAdmin: boolean;
  activeOrgName: string | null;
}
```

`<NavItem>`, `<NavButton>`, `<NavSection>`, and the `NavItemRenderer` helper consume `NavItemSpec[]`. Their props are unchanged from today's inline implementations.

### 8.3 `<TopBar>`

```
props: {
  breadcrumbs: { label: string; to: string }[];
  hasOrgContext: boolean;                  // controls GlobalAskBar visibility
  onOpenCommandPalette(): void;
}
```

`<Breadcrumbs>` props: `{ items: { label: string; to: string }[] }`.

### 8.4 `<BudgetAlertBanner>`

```
props: {
  alert: { pct: number; spent: number; limit: number } | null;
  activeClientId: string | null;
  onDismiss(): void;
}
```
Returns `null` when `alert` is null or `activeClientId` is null. Severity bands (75 / 90 / 95) computed internally.

### 8.5 Modals

Each modal opens-closes via prop; submission state is internal.

```
<CreateProjectModal>:
  { open: boolean; activeClientId: string; onClose(): void; onCreated(projectId: string): void; }

<CreateAgentModal>:
  { open: boolean; activeClientId: string; onClose(): void; onCreated(agentId: string): void; }

<CreateClientModal>:
  { open: boolean; onClose(): void; onCreated(client: ClientOption): void; }

<NewBriefModal>:
  {
    open: boolean;
    onClose(): void;
    identity: Identity;
    orgs: OrgOption[];                      // for system-admin org override
    subaccounts: ClientOption[];            // for sub-account override
    onSubmitted(briefId: string, contextSwitch: { org?: OrgOption; subaccount?: ClientOption }): void;
  }
```

`NewBriefModal` keeps the cross-tenant safety logic verbatim (today's lines 569–599). The host's `onSubmitted` callback closes the modal, conditionally calls `identity.selectOrg(...)` or `identity.selectClient(...)`, then navigates to the brief detail page.

## 9. Pure-helper extraction

- `avatarColor(str)`, `toInitials(name)`, `buildBreadcrumbs(pathname, clientName)`, `SEG`, `UUID_RE` move to `client/src/components/layout/breadcrumbs.ts`.
- The `Icons` object and `Ico` wrapper move to `client/src/components/layout/icons.tsx`. Existing consumers inside Layout become imports.
- `resolveIcon(iconKey)` and `renderNavItem(spec)` — both inline closures today — move into `NavItemRenderer.tsx`. The closure dependency on `Icons` and on the small set of inline button bodies (`new-task`, `sign-out` special cases) becomes explicit-prop-driven inside the renderer.

Tests: add one Vitest unit file `client/src/components/layout/__tests__/breadcrumbs.test.ts` covering: empty pathname → []; UUID after `subaccounts` → uses `clientName`; UUID without preceding `subaccounts` → skipped; `SEG[part] === null` → segment skipped; unknown segment → title-case fallback. The other helpers (`avatarColor`, `toInitials`) are too trivial to test individually; their behaviour is covered by visual smoke.

## 10. Migration plan (chunked)

Each chunk is independently revertible. The order is bottom-up: pure helpers and presentational atoms first, hooks second, chrome regions third, modals last. The host's render stays the source of truth until the very end of each chunk.

### Chunk 1 — Move pure helpers and presentational atoms

- Create `client/src/components/layout/breadcrumbs.ts` with `SEG`, `UUID_RE`, `avatarColor`, `toInitials`, `buildBreadcrumbs`. Add `__tests__/breadcrumbs.test.ts`.
- Create `client/src/components/layout/icons.tsx` with `Ico` and `Icons`.
- Move `NavItem`, `NavButton`, `NavSection`, `TrialCountdown` to dedicated files under `client/src/components/layout/`. `NavSectionAction` stays inside `NavSection.tsx` (it is the click-action shape consumed by section headers and has no other consumer).
- Host imports from new paths.
- **Done when:** host file ~250 LOC lighter; lint + typecheck + build:client clean.

### Chunk 2 — Extract `NavItemRenderer`

- Move `renderNavItem` + `resolveIcon` to `client/src/components/layout/NavItemRenderer.tsx`.
- Renderer receives the `NavItemSpec[]` filtered slice and an `onAction` map only if needed for `new-task` / `sign-out` special cases — but those callbacks come through on the spec itself today, so the renderer can stay self-contained.
- **Done when:** host's `.map(renderNavItem)` calls are replaced with `<NavItemRenderer items={…} />`; two usages (`group !== 'footer'` and `group === 'footer'`) both work.

### Chunk 3 — Extract hooks

- Create the eight hooks under `client/src/hooks/`: `useLayoutIdentity`, `useLayoutPermissions`, `useSidebarConfig`, `useLayoutBadges`, `useNavLists`, `useCommandPaletteKeybind`, `useTrialCountdown`, `useOrgList`.
- The host shrinks dramatically — most useEffect blocks vanish.
- Wire the hooks into the host. Preserve every effect dependency exactly (the existing eslint-disable comments and rationale comments around effect deps stay verbatim — they reflect the spec, not laziness).
- Update `TrialCountdown.tsx` to consume `useTrialCountdown` instead of holding its own state.
- **Done when:** host file is mostly hook calls + JSX; all badges, identity flows, sidebar config, command palette keybind work identically.

### Chunk 4 — Extract `IconRail`, `SidebarShell`, `TopBar`, `Breadcrumbs`, `BudgetAlertBanner`

- Create each chrome component per §5 with the props in §8.
- Host renders become `<IconRail … />`, `<SidebarShell … />`, `<TopBar … />`, `<BudgetAlertBanner … />`.
- Decide during this chunk whether `OrgPicker` is a sub-file of `IconRail.tsx` or a standalone `OrgPicker.tsx` — based on resulting `IconRail.tsx` size. Cut into separate file only if `IconRail.tsx` > 200 LOC.
- **Done when:** host's `return (...)` block is 5–6 component invocations + the modal layer.

### Chunk 5 — Extract the four modals

- Create `CreateProjectModal.tsx`, `CreateAgentModal.tsx`, `CreateClientModal.tsx`, `NewBriefModal.tsx` under `client/src/components/layout/modals/`.
- Each modal owns its form state + submission state internally.
- `NewBriefModal` keeps the cross-tenant safety logic verbatim — preserve the inline comments at lines 569–599 of today's file (they explain why the cross-tenant override is shaped the way it is — see §12 self-consistency for risk).
- Host receives `onCreated` / `onSubmitted` callbacks and triggers `navLists.refresh.*()` + navigation.
- **Done when:** all four modals open + close + create + navigate, with no behavioural regression vs. today.

### Chunk 6 — Final cleanup and verify

- Remove now-unused imports from the host.
- Confirm host is ~150–200 LOC: hooks call sequence, `navCtx` build, `buildNavItems(navCtx)` call, modal-open flag state, return JSX (~50 LOC composing the chrome components and modal layer).
- Run lint + typecheck + build:client.
- Manual smoke test:
  - System-admin login → org picker visible → select org → subaccounts refresh.
  - Non-admin login → org auto-set → subaccounts list populated.
  - Cmd+K opens palette; selecting a client clears system-admin override.
  - Budget warning at 75 / 90 / 95% bands shows correct colours and copy.
  - Each of the four create modals submits + navigates + refreshes the nav list.
  - Trial countdown shows the right copy at 8 / 3 / 2 / 1 / 0 days.

## 11. Deferred Items

- **Promote `IconRail` and `SidebarShell` to a generic `<AppShell>`.** Tempting because it pulls the layout out of the `components/` folder into a top-level shell concept. Deferred — no second consumer exists today, and the layered `IconRail + SidebarShell + TopBar` composition already reads as the shell.
- **Persist `cmdOpen` and modal-open flags to URL search params.** Would let users deep-link to "Cmd+K open" state. Pure ergonomics; out of scope.
- **Move `Icons` to `client/src/lib/icons.tsx` for cross-component reuse.** Several pages duplicate icon definitions. Real win — but a separate refactor across all consumers; deferred to keep this spec scoped to Layout.
- **Replace `useSocketRoom` callbacks in `useLayoutBadges` with a typed event bus.** The current handlers manually narrow `unknown` payloads. Refactor for type safety in a follow-up.
- **`OrgPicker` extraction.** Decided in-chunk per §10 Chunk 4. If kept inline, the deferred item is to revisit if `IconRail.tsx` grows. Reason: defer-by-evidence.

## 12. Self-consistency check

- `useViewMode` still receives `onRequireClientSelection` and `onClientCleared` callbacks. The host wires them as: `onRequireClientSelection: commandPalette.open` (from `useCommandPaletteKeybind`) and `onClientCleared: identity.clearClient` (from `useLayoutIdentity`). The auth-layer side effect (the `localStorage` `removeActiveClient`) lives inside `useLayoutIdentity.clearClient`.
- `buildNavItems(navCtx)` produces the same `NavItemSpec[]` because `navCtx` carries the same fields: `hasOrgPerm`, `hasClientPerm`, `hasSidebarItem`, `viewMode`, `navProjects`, `navAgents`, `userOwnedAgents`, badge counts, the four create-modal openers, `onLogout`, `onOpenConfigAssistant`.
- The order of effect execution must not change. Existing eslint-disable rationale comments around effect deps in today's file (e.g. line 387–391 about subaccount refetch on org change) are carried verbatim into the new hooks.
- Sidebar `hasSidebarItem(slug)` returns `false` until `sidebarLoaded`. Preserved — the hook keeps the same loading-state-suppression behaviour, otherwise the sidebar flashes nav items on first paint.
- The `New Brief` submit handler's cross-tenant safety (today's lines 569–599) is implementation-critical security logic: if the user picks a different org without picking a subaccount, do NOT fall back to the previous org's `activeClientId`. This logic moves verbatim into `NewBriefModal`; the spec lists it as the highest-risk piece in §10 Chunk 5 to ensure reviewers verify it.
- `handleLogout` order is preserved: `disconnectSocket()` first, THEN remove tokens (otherwise the disconnect path tries to authenticate with cleared tokens).

## 13. Acceptance criteria

- `git diff client/src/components/Layout.tsx` shows the host shrunk to ≤ 250 LOC (target per §1/§5/§10 Chunk 6 is 150–200 LOC; 250 is the acceptance ceiling); the host file contains only: imports, the function body, hook calls, `navCtx` derivation, `buildNavItems(navCtx)` call, modal-open flag state, and the return JSX (composition of chrome + modal layer).
- New folders `client/src/components/layout/` and `client/src/components/layout/modals/` exist with the file listing in §5. `OrgPicker.tsx` is conditional per §5 (present iff Chunk 4 decided to split it out; absence is acceptance-passing when the inline path was chosen).
- New hook files under `client/src/hooks/` exist per §7.
- One new test file `client/src/components/layout/__tests__/breadcrumbs.test.ts` with the five cases in §9.
- `npm run lint`, `npm run typecheck`, `npm run build:client`, `npx vitest run client/src/components/layout/__tests__/breadcrumbs.test.ts` all pass.
- Manual smoke through every flow in §10 Chunk 6.

## 14. Open questions

- None blocking. One in-chunk decision: keep `OrgPicker` inline in `IconRail.tsx` or extract to its own file. Decided by file size after Chunk 4 — no spec amendment needed either way.
