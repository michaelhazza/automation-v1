**Status:** draft
**Spec date:** 2026-05-07
**Last updated:** 2026-05-07
**Author:** michael
**Build slug:** consolidation-foundation

---

# Consolidation Foundation — Phase 0 spec

> Phase-0 of the four-spec consolidation programme. Lands the cross-cutting frontend primitives that Specs A (Operate), B (Build), and C (Govern) all depend on. Must merge **before** A/B/C can run in parallel. No business logic, no backend changes, no new routes. Frontend foundation only.

## Table of contents

0. Programme context
1. Goals
2. Non-goals
3. Existing primitives audit
4. Public API contracts
5. File inventory
6. Permissions / RLS / Execution model
7. Phase / chunk plan
8. Testing posture
9. Coordination with Specs A, B, C
10. Deferred items
11. Self-consistency check
12. Pre-review checklist

## 0. Programme context

The 2026-05-06 prototype (`prototypes/consolidation-2026-05-06/`) collapses ~25 existing pages into ~12 consolidated pages organised as Operate / Build / Govern. Three follow-up specs (A, B, C) will deliver one product surface each. Each of those streams reuses the same handful of primitives: a modal with size variants, a sortable + filterable table, a sticky form footer, a workspace/view-mode switcher, and a unified sidebar/nav config.

Building those primitives three times in three streams produces three subtly-different implementations and three review cycles. This spec builds them once.

The mockup-side reference for the look-and-feel is `prototypes/consolidation-2026-05-06/_shared.css` plus `tasks/builds/consolidation-2026-05-06/patterns.md` § 1, 5, 7 (the cross-cutting patterns). Patterns 2, 3, 4, 6 (activity drawer/modal, run-trace popup, workspace switching, inbox priority bands) are page-level and belong in Spec A; this spec only defines the underlying primitive each consumes.

## 1. Goals

1. Ship a single canonical implementation of each cross-cutting frontend primitive used by the consolidation prototype, so Specs A/B/C can consume them rather than reinvent.
2. Keep Phase 0 small and fast, target 2-3 days of work, single PR, no schema changes.
3. Establish stable public APIs (component props, CSS class names, store contracts) that the three follow-up specs can build against before this PR lands.
4. Migrate the existing app shell (`Layout.tsx`) and existing primitives (`Modal.tsx`) toward the new APIs **without breaking existing pages**. Every currently-rendered page must continue to render and function.

## 2. Non-goals

1. Building any of the consolidated pages (home, inbox, activity, run-trace, agents, agent-edit, recurring-tasks, project-edit, knowledge, org-knowledge, spending, integrations). Those belong to Specs A/B/C.
2. Implementing page-level patterns from `patterns.md` § 2/3/4/6 (activity drawer/modal, run-trace popup, cross-page workspace switching wiring, inbox priority bands). Spec A owns those. This spec ships only the primitives those patterns consume.
3. Changing any backend route, service, schema, RLS policy, or job. There are no backend changes in Phase 0.
4. Replacing the existing tenant identity model. "Workspace" is a UI synonym for the existing client/sub-account; we do not introduce a new identity primitive.
5. Adding a UI test framework. Frontend tests remain `none_for_now` per `docs/spec-context.md`.

## 3. Existing primitives audit (mandatory per spec-authoring-checklist § 1)

Each row records what already exists, the verdict (reuse / extend / replace / new), and why.

| Primitive | Existing | Verdict | Reason |
|---|---|---|---|
| Modal / dialog | `client/src/components/Modal.tsx` (87 lines, portal + focus trap + Esc + backdrop close) | **Extend** | Has all the hard parts (focus, esc, portal). Missing: size variants (sm/md/lg/xl), large-iframe variant for run-trace popup, declarative footer. Add as additive props; existing call sites continue to work. |
| Confirm dialog | `client/src/components/ConfirmDialog.tsx` (31 lines) | Reuse | No change. |
| Generic drawer primitive | None reusable. `AutomationPickerDrawer.tsx` is page-specific. | **New** (`Drawer.tsx`) | Activity page drawer in Spec A and possibly other right-side-overlay flows need a shared primitive. Out of Spec 0 scope only if we can confirm Activity is the only consumer; included here because patterns.md treats drawer as a sibling of Modal. |
| Sortable + filterable table | None. Existing tables (e.g. `SystemAgentsPage`, `SubaccountTagsPage`) hand-roll sort + filter inline. | **New** (`SortableTable.tsx`) | Six tables in the consolidated UI use the pattern (recurring-tasks, spending Ledger, spending caps, agents, integrations, activity). Inlining six times is the explicit anti-pattern this spec eliminates. |
| Sticky form footer | None as a reusable component. Existing edit pages render bespoke action rows. | **New** CSS classes (`.form-footer`, `.form-footer-inner`) + tiny React wrapper (`<FormFooter>`) | Used by agent-edit and project-edit. Style block already exists in the prototype's `_shared.css`; this spec ports it to the production stylesheet. |
| App shell + sidebar | `client/src/components/Layout.tsx` (1347 lines) | **Extend** | Layout already owns the sidebar, breadcrumb, command palette, ask bar, and socket wiring. Phase 0 refactors the **nav config** out into a typed array and adds the new view-mode switcher, but does not rewrite Layout's responsibilities. |
| Workspace / org / system view mode | Existing: `getActiveOrgId`, `getActiveClientId`, `setActiveClient` in `client/src/lib/auth.ts`. The mode is implicit (org admins switch via the client switcher in the topbar). | **Extend** | Add an explicit `viewMode: 'workspace' \| 'org' \| 'system'` derived from existing identity state, plus a UI control in the sidebar pill row. The underlying state stays as-is, this is a UI surface on top, not a new identity model. |
| Workspace badge (clickable for org admin) | None. Each call site styles a badge inline. | **New** (`<WorkspaceBadge>`) | Clickable for `org_admin`, calls `setActiveClient` + reload. Used by activity table rows, activity drawer, activity modal, run-trace embedded page. |
| View-mode switcher control | None. Today the topbar has separate Org and Client switchers. | **New** (`<ViewModeSwitcher>`) | Three-segment control (Workspace / Org / System) shown in the sidebar above the client switcher when the user has org-admin permissions. System tab visible only for system admins. |
| Tabs | No shared primitive; each tabbed page rolls its own with Tailwind. | Out of scope | Tabs are page-local enough that the cost of a new primitive isn't justified yet. Revisit if a third tabbed page lands without one. |
| Toast / snackbar | Already exists somewhere, assume reusable. | Out of scope | Not used by any of the new primitives. |

**Verdict summary:** 2 extensions to existing primitives (`Modal`, `Layout`/sidebar config), 4 new primitives (`SortableTable`, `Drawer`, `WorkspaceBadge`, `ViewModeSwitcher`), 1 new shared CSS pair + tiny wrapper (`form-footer` / `<FormFooter>`).

## 4. Public API contracts

These are the contracts Specs A/B/C will build against. Lock them at the start of Phase 0 review; Spec A/B/C drafts can reference them before this PR ships.

### 4.1 `<Modal>` extension

`client/src/components/Modal.tsx`. Additive props only. Existing call sites unaffected.

```ts
interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  // Existing
  maxWidth?: number;                            // default 520; preserved for back-compat
  disableBackdropClose?: boolean;
  // NEW
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'iframe'; // tokenised sizes; takes precedence over maxWidth when set
  footer?: React.ReactNode;                     // rendered in a fixed footer row; centred with the modal body
  bodyPadding?: 'default' | 'none';             // 'none' for iframe-content modals
  zIndex?: number;                              // default 1000; allow stacking (e.g. 1010 for run-trace-on-top-of-activity)
}
```

Size token map: `sm = 480px`, `md = 720px`, `lg = 1024px`, `xl = 1280px`, `iframe = calc(100vw - 64px)` with a height cap of `calc(100vh - 48px)`.

**Producer:** any caller. **Consumer:** `Modal.tsx`. **Source-of-truth precedence:** if both `size` and `maxWidth` are passed, `size` wins. Document this; warn in dev only.

### 4.2 `<Drawer>` (NEW)

`client/src/components/Drawer.tsx`

```ts
interface DrawerProps {
  open: boolean;
  side?: 'right' | 'left';   // default 'right'
  width?: number | string;   // default 480
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}
```

Behaviour: portal-rendered, fade-in backdrop, slide-in panel, Esc closes, backdrop click closes, focus trap (same pattern as `Modal`). No body-scroll lock conflict with Modal; both manage their own.

### 4.3 `<SortableTable>` (NEW)

`client/src/components/SortableTable.tsx`

```ts
interface ColumnDef<Row> {
  key: string;
  label: string;
  sortable?: boolean;                            // default true
  filterable?: boolean;                          // default false
  width?: string;                                // CSS width
  align?: 'left' | 'right' | 'center';
  // Value extraction
  getValue?: (row: Row) => string | number | null;
  // Custom renderers
  render?: (row: Row) => React.ReactNode;
  // Filter options resolution (overrides default = unique getValue() values)
  getFilterOptions?: (rows: Row[]) => Array<{ value: string; label: string }>;
}

interface SortableTableProps<Row> {
  rows: Row[];
  columns: ColumnDef<Row>[];
  rowKey: (row: Row) => string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  emptyState?: React.ReactNode;
  onRowClick?: (row: Row) => void;
  // Persistence (optional, in-memory only for Phase 0; server persistence deferred)
  persistKey?: string;                           // localStorage key for sort + filter state
}
```

Behaviour (locked here, do not redesign in A/B/C):

- Click sortable column header, toggles sort direction. Active column shows up/down arrow in label.
- Click filter caret on filterable column, dropdown opens.
- Filter dropdown: stays open until Apply / Cancel / Esc / outside-click. Individual checkbox changes do NOT close. "Select all" is a smart toggle (any unchecked, check all; all checked, uncheck all). Cancel restores the snapshot taken on open. Filter is committed only on Apply.
- Multi-column filters compose with AND.
- Empty-state row when no matches.
- Caret highlights when column has an active filter (fewer items checked than total).
- Sort tiebreaker: stable insertion order from `rows` prop (consistent with §8 development-discipline rule on sort tiebreakers in `DEVELOPMENT_GUIDELINES.md`).

**Out of scope for Phase 0:** server-side sort/filter, virtualised rendering, column resize, column drag-reorder, multi-sort. Hooks are exposed in props (`getValue`, `getFilterOptions`) so Specs A/B/C can wire client-side filters without modifying the component.

### 4.4 `<FormFooter>` + CSS

`client/src/components/FormFooter.tsx` (very thin) plus class additions in the production stylesheet.

```ts
interface FormFooterProps {
  /** Aligns inner button group to the form column. Default 720 matches the prototype. */
  innerMaxWidth?: number;
  children: React.ReactNode;          // typically <Discard /> <Save /> <Delete />
}
```

CSS classes (added to whichever stylesheet currently holds shared classes, see `§5 File inventory`):

```css
.form-footer { position: fixed; bottom: 0; left: 0; right: 0; background: white;
               border-top: 1px solid var(--border); padding: 14px 28px;
               box-shadow: 0 -2px 8px rgba(0,0,0,0.04); z-index: 100; }
.form-footer-inner { max-width: 720px; margin: 0 auto; display: flex;
                     align-items: center; gap: 10px; }
```

Notes:
- `position: fixed` (not `sticky`) so the footer is visible from page load, not only at scroll-bottom. This decision was reached in round 13 of the prototype after user feedback.
- Pages using `<FormFooter>` MUST add bottom padding of at least 100px to the form-body container so the last field isn't covered by the fixed footer. The component documents this in its JSDoc.
- The destructive button (e.g. "Delete agent") uses `margin-left: auto` to push to the right edge of the inner band.

### 4.5 `<WorkspaceBadge>` (NEW)

`client/src/components/WorkspaceBadge.tsx`

```ts
interface WorkspaceBadgeProps {
  clientId: string;
  clientName: string;
  /** Default 'pill'. 'inline' is unstyled tinted text for use inline in a sentence. */
  variant?: 'pill' | 'inline';
  /** When true, badge becomes a button that switches active client + reloads. Defaults to true if user is org_admin in the active org. */
  clickable?: boolean;
}
```

Behaviour:
- Pill variant uses a deterministic colour based on `clientName` hash (matching the prototype palette: indigo / amber / emerald / red / sky / slate).
- When `clickable` and user has org-admin permission in the active org, click, calls `setActiveClient(clientId, clientName)` then `window.location.reload()`.
- When not clickable (workspace user, or `clickable={false}`), renders as a plain pill.
- Tooltip: "Switch to <name> workspace" when clickable.

**Permission read:** from existing `auth.ts` user/permission state. No new permission concept introduced.

### 4.6 `<ViewModeSwitcher>` (NEW)

`client/src/components/ViewModeSwitcher.tsx`

```ts
type ViewMode = 'workspace' | 'org' | 'system';

interface ViewModeSwitcherProps {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  /** Hide segments the user has no permission to enter. */
  availableModes?: ReadonlyArray<ViewMode>;
}
```

Behaviour:
- Three-segment pill control. Active segment is filled; others are outline.
- Renders only the segments listed in `availableModes`. A workspace-only user sees one segment (Workspace) and the control collapses to a plain label (no switching affordance).
- `org` segment available to users with org-admin permission. `system` segment available only to system admins (existing `system_admin_org_override` mechanic in `architecture.md §152` continues to govern).

**Source-of-truth precedence:** the canonical view mode is **derived state**, not a new persisted field. Derivation:
- `system` if `system_admin_org_override` is active.
- Otherwise `org` if no active client is selected and the user has org-admin permission.
- Otherwise `workspace`.

`onChange('org')` clears `activeClient`. `onChange('workspace')` requires an active client; if none is selected, the consumer must open the client picker (handled by `Layout`).

### 4.7 Sidebar nav config (refactor)

Today, `Layout.tsx` inlines its nav structure across hundreds of lines. Phase 0 extracts it into a typed config:

```ts
// client/src/config/sidebar.ts
export type NavGroup = 'work' | 'build' | 'tasks' | 'external' | 'setup' | 'clientpulse';

export interface NavItem {
  group: NavGroup;
  label: string;
  to: string;                         // route path
  icon: keyof typeof Icons;           // existing Icons map in Layout
  permission?: string;                // optional permission key; gates visibility
  viewModes?: ReadonlyArray<ViewMode>;// modes in which this item is visible (default: all)
  badge?: 'count' | null;             // count comes from existing inbox badge wiring; no new mechanic
}

export const NAV_ITEMS: NavItem[] = [ /* ... */ ];
```

`Layout.tsx` reads `NAV_ITEMS`, filters by current `viewMode` and `user.permissions`, groups by `NavGroup`, and renders the existing markup. **No visual change**, same icons, same group labels, same styling.

**Why extract:** Specs A/B/C will each add 1-4 nav entries (e.g. Spec A renames "Logins" to "Connections"; Spec B adds "Recurring tasks"). With the config extracted, those edits are trivial single-row diffs in `sidebar.ts`. With the nav inlined in 1347-line `Layout.tsx`, the merge surface is much larger.

### 4.8 Layout shell classes

Spec A's pages assume a class set: `.page-shell`, `.page-content`, `.page-body`. The prototype has these informally; production today uses Tailwind utilities directly in each page. Phase 0 ships these as utility classes (or a thin `<PageShell>` component) so Spec A/B/C pages can be written to a stable structure.

```ts
// client/src/components/PageShell.tsx
interface PageShellProps {
  /** Optional sticky header with title/actions. */
  header?: React.ReactNode;
  /** Body content; gets standard padding + max-width. */
  children: React.ReactNode;
  /** Bottom padding override (e.g. 100 when used with FormFooter). */
  bottomPadding?: number;
}
```

CSS additions (around 10 lines) in the production stylesheet.

## 5. File inventory

Files **created** by this spec:

| File | Purpose |
|---|---|
| `client/src/components/Drawer.tsx` | NEW primitive |
| `client/src/components/SortableTable.tsx` | NEW primitive |
| `client/src/components/FormFooter.tsx` | NEW thin wrapper |
| `client/src/components/WorkspaceBadge.tsx` | NEW primitive |
| `client/src/components/ViewModeSwitcher.tsx` | NEW primitive |
| `client/src/components/PageShell.tsx` | NEW primitive |
| `client/src/config/sidebar.ts` | NEW config; nav items extracted from `Layout.tsx` |
| `client/src/hooks/useViewMode.ts` | NEW hook returning `{ viewMode, setViewMode, availableModes }` derived from existing identity state |
| `tasks/builds/consolidation-foundation/plan.md` | Implementation plan written by `architect` after spec accepted |

Files **modified** by this spec:

| File | Change |
|---|---|
| `client/src/components/Modal.tsx` | Add `size`, `footer`, `bodyPadding`, `zIndex` props (additive) |
| `client/src/components/Layout.tsx` | Replace inlined nav with `NAV_ITEMS` from `client/src/config/sidebar.ts`; add `<ViewModeSwitcher>` to sidebar above the client switcher; no other behavioural change |
| Production shared stylesheet (location TBD in plan, likely `client/src/index.css` or equivalent) | Add `.form-footer`, `.form-footer-inner`, `.page-shell`, `.page-content`, `.page-body` |

Files **NOT modified** by this spec (state explicitly to enforce the boundary):

- Any file under `server/`. No backend changes in Phase 0.
- Any DB migration. No schema changes.
- Any existing page (`client/src/pages/**`). Existing pages must continue to render unchanged.
- Any consolidated page (home/inbox/activity/etc). Owned by Specs A/B/C.

**No new tables, no new migrations, no new routes, no new services, no new jobs, no new skills.**

## 6. Permissions / RLS / Execution model

- **Permissions:** No new permission keys. `<WorkspaceBadge>` and `<ViewModeSwitcher>` read existing `org_admin` / `system_admin_org_override` state via existing helpers. No route guards added (no new routes).
- **RLS:** Not applicable. Frontend-only spec. No new tenant-scoped tables.
- **Execution model:** Not applicable. No new write paths, no new jobs, no new external triggers. All primitives are pure UI.
- **Idempotency / retry / concurrency / state machine:** Not applicable per above.

This section exists to make the "not applicable" verdict explicit so spec-reviewer's checklist is satisfied without flagging false-positives.

## 7. Phase / chunk plan (preview, architect will finalise)

This spec's implementation plan (`plan.md`) will be authored by `architect` after the spec is accepted. The expected chunk shape:

1. **C1 — Modal extension.** Add `size`, `footer`, `bodyPadding`, `zIndex` props. Update existing call sites only where breakage would occur (none expected).
2. **C2 — Drawer + WorkspaceBadge.** Two small standalone components with no upstream dependencies.
3. **C3 — SortableTable.** The largest chunk. Single component file, plus minimal storybook-equivalent (an inline demo page if helpful, gate behind a dev-only route or remove before merge).
4. **C4 — useViewMode + ViewModeSwitcher.** Hook + component. Exports `availableModes` derivation logic.
5. **C5 — sidebar config + Layout refactor.** Extract `NAV_ITEMS` into `client/src/config/sidebar.ts`. Wire `<ViewModeSwitcher>`. Confirm no visual diff.
6. **C6 — FormFooter + PageShell + shared CSS.** Component wrappers + class additions to the production stylesheet.
7. **C7 — Doc + handoff.** Update `architecture.md` "Key files per domain" table to point at the new components. Update `KNOWLEDGE.md` only if a non-obvious gotcha was hit during implementation.

Total target: 2-3 days of one builder (sonnet). Single PR.

**Dependency graph:** C5 depends on C4 (Layout reads `useViewMode`). All other chunks are independent. C3 (SortableTable) does not depend on C1 (Modal extension) because the filter dropdown uses an inline popover, not a modal portal.

## 8. Testing posture

Per `docs/spec-context.md`:

```
testing_posture: static_gates_primary
runtime_tests: pure_function_only
frontend_tests: none_for_now
```

This spec ships React components, by framing, **no frontend unit tests**. Static gates (`npm run lint`, `npm run typecheck`, `npm run build:client`) are the verification surface. Pure functions where they emerge (e.g. the sort comparator inside `SortableTable`, the view-mode derivation in `useViewMode`) get a colocated `*.test.ts` invokable via `npx tsx <path>` per CLAUDE.md § Verification Commands; CI runs the full battery.

No E2E tests, no API-contract tests (no API), no visual-regression tests.

**Manual verification at G2 (integrated state):**
- Every existing page that today imports `Layout` or `Modal` must render without console errors. Spot-check around 10 pages including `SystemAgentsPage`, `WorkspaceMemoryPage`, `SubaccountAgentEditPage`, `AdminSkillsPage`.
- Sidebar visual diff: open two tabs, one before / one after, confirm pixel-equivalent rendering for a workspace user, an org admin, and a system admin.
- ViewModeSwitcher: as workspace-only user, control collapses to label. As org admin, three segments. As system admin with override, switching to System works.
- SortableTable demo: render with 50-row mock data, verify sort, filter, Apply/Cancel/Esc/outside-click, snapshot restore on Cancel.

## 9. Coordination with Specs A, B, C

Spec A/B/C drafts MAY be authored in parallel with Phase 0 implementation, against the contracts in `§4`. The contracts are locked once this spec reaches `Status: accepted`.

**Boundary enforcement:** each downstream spec MUST include a "Foundation primitives consumed" section listing every primitive it imports and the version (commit SHA) of the foundation it builds against. If a downstream spec needs a new primitive or a contract change, it goes back into a Spec-0 patch (not bolted into the downstream spec).

**Shared-file edit policy** for Specs A/B/C:

- `client/src/config/sidebar.ts`: each spec may add/edit only its own rows. Coordinate row order at merge time.
- Production shared stylesheet: each spec may add page-scoped classes only (e.g. `.knowledge-row`, `.spending-insight-card`). Cross-cutting style changes require a Spec-0 patch.
- `client/src/components/**`: each spec creates page-scoped components in its own subdirectory (`pages/operate/`, `pages/build/`, `pages/govern/`); no cross-spec component sharing without a Spec-0 patch.
- TypeScript shared types: each spec owns a scoped module: `shared/types/operate.ts`, `shared/types/build.ts`, `shared/types/govern.ts`. No cross-spec shared types.
- DB migrations: sequential numbering. Last spec to merge renumbers if needed.

## 10. Deferred items

- **Drawer animation polish.** Phase 0 ships a slide-in via CSS transition. Springy / motion-tuned animation deferred until real usage data shows it matters.
- **SortableTable persistence to backend.** Phase 0 supports localStorage via `persistKey`. Per-user backend persistence (sort/filter preferences saved across devices) deferred, no consumer needs it yet.
- **SortableTable virtualised rendering.** Phase 0 renders all rows. Defer virtualisation until a consumer ships more than 1000 rows.
- **SortableTable multi-sort.** Phase 0 supports single-column sort only. Multi-sort deferred until requested.
- **Mobile responsive view-mode switcher.** Phase 0 collapses to a label on workspace-only users; on multi-mode users on mobile, the three-segment control works but is cramped. Mobile UX polish deferred to a UI sweep later.
- **Tabs primitive.** Discussed in `§3` audit; left out until a third tabbed page surfaces.
- **Replacing `<Modal>` `maxWidth` prop with `size` only.** Phase 0 ships both for back-compat. A later patch can remove `maxWidth` once all call sites migrate.

## 11. Self-consistency check (per spec-authoring-checklist § 8)

- Goals (`§1`) match Implementation (`§4-7`)? Yes, every primitive in `§3` has a contract in `§4` and a chunk in `§7`.
- Every "must" / "guarantees" claim has a backing mechanism? Reviewed:
  - "Existing pages must continue to render unchanged", backed by additive-only changes to `Modal.tsx` and the no-visual-diff requirement in `§8` manual verification.
  - "Lock the contracts at the start of Phase 0 review", backed by `§9` boundary enforcement.
- File inventory complete? Every component named in `§4` appears in `§5`. Yes.
- Phase dependency graph clean? `§7` lists C5's dependency on C4. No backward references.
- Deferred items section exists? `§10`.
- Testing posture matches framing? `§8` aligns with `frontend_tests: none_for_now`.
- Permissions/RLS/execution-model statement explicit? `§6`.

## 12. Pre-review checklist (from spec-authoring-checklist)

- [x] **§0** No deferred-item references; greenfield foundation.
- [x] **§1** Every new primitive has a "why not reuse" entry in `§3`.
- [x] **§2** Every new file is in `§5`.
- [x] **§3** Public APIs in `§4` include shape, types, defaults, and producer/consumer.
- [x] **§4** No new tenant-scoped tables, `§6` declares N/A explicitly.
- [x] **§5** Execution model declared N/A in `§6`.
- [x] **§6** Phase graph in `§7` is acyclic.
- [x] **§7** `## Deferred Items` (`§10`) present.
- [x] **§8** Self-consistency pass complete (`§11`).
- [x] **§9** Testing posture matches framing (`§8`).
- [x] **§10** No new write paths, execution-safety contracts N/A; declared in `§6`.
- [x] **§11** Frontmatter present (top of file).

Spec ready for `spec-reviewer`.
