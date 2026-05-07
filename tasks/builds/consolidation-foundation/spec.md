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
| Workspace badge (clickable for org admin) | None. Each call site styles a badge inline. | **New** (`<WorkspaceBadge>`) | Clickable for `org_admin`, calls the `switchWorkspace(clientId, clientName)` helper (§4.5). Used by activity table rows, activity drawer, activity modal, run-trace embedded page. |
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

**Overlay z-index ladder (cross-cuts §4.1 and §4.2, locked here):**

| Layer | Default zIndex |
|---|---|
| Modal | `1000` |
| Drawer | `900` |
| Backdrop (any overlay) | overlay's zIndex `- 1` |
| Nested overlay (Modal-over-Drawer, e.g. run-trace popup over activity drawer) | parent's zIndex `+ 10` |

Consumers stacking a Modal on top of another overlay pass `zIndex={parent + 10}`. Backdrops are computed by the primitive (always `zIndex - 1`); consumers do not set backdrop z-index directly.

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

**Scroll-lock ownership (cross-cuts §4.1 and §4.2, locked):**

- Each overlay (Modal, Drawer) manages body-scroll lock independently. On mount, the overlay applies `overflow: hidden` to `document.body` (or equivalent); on unmount, it restores the prior value.
- When overlays stack (the modal-over-drawer carveout below), only the **top-most** mounted overlay controls the lock. Each overlay snapshots the body's `overflow` value at mount time AND only restores it on unmount if no other overlay is still mounted (use a small mount-counter on a window-scoped symbol; if the count is greater than zero on unmount, skip restoration).
- This guarantees scroll-lock state restores correctly after stacked-overlay close sequences, including the case where a Modal mounted over an active Drawer is closed first (lock stays applied because the Drawer is still mounted) and the case where the Drawer is closed first (lock release deferred until the Modal also closes).
- Without this rule, naive `overflow: hidden` / restore pairs would leak: closing the Modal first restores `overflow: auto` while the Drawer is still open, and the body becomes scrollable behind a visible Drawer. Lock the contract, not the implementation.

**Overlay exclusivity invariant (cross-cuts §4.1 and §4.2):**

- Only one top-level overlay (Modal OR Drawer) is active at a time. Consumers MUST close the active overlay before opening another of the same kind.
- Carveout: a Modal MAY open over an active Drawer (the run-trace-popup-over-activity-drawer case). The Modal sets `zIndex={drawerZ + 10}` per the ladder in §4.1; both primitives keep their own focus trap and scroll lock without conflict because the Modal's trap takes precedence while it is mounted, and the Drawer's trap reactivates on Modal close.
- Two simultaneous Modals or two simultaneous Drawers are a consumer bug, not a primitive concern. The primitives do NOT police global overlay state in Phase 0 (would require introducing an OverlayManager, explicitly deferred per §10).
- **Failure-mode boundary (locked):** if a consumer bug DOES open two overlays of the same kind at once, the primitives do not guard or recover. The last-mounted overlay wins visually because its portal renders on top of the prior one in DOM order; both keep their own focus trap, but the older trap is functionally inert until the newer overlay closes. This behaviour is predictable, not "right": the contract is "do not open two", and the visual outcome is documented only so the failure mode is debuggable.

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
- **Stability is a contract, not an implementation detail.** Sorting MUST be stable: if two rows compare equal under the active comparator, their relative order from the input `rows` array MUST be preserved across renders. Implementations using `Array.prototype.sort` are acceptable on engines that guarantee stability (V8 since 7.0, all currently-shipping browsers); any future implementation MUST preserve this guarantee even if a non-stable algorithm is faster. Document the requirement in the component JSDoc.

**Sort comparator semantics (locked):**

- **String sort:** `localeCompare` with `{ sensitivity: 'base' }` (case- and accent-insensitive).
- **Number sort:** numeric subtraction (`a - b`); both values coerced via `Number(...)` first. **NaN guard:** if either coerced value is `NaN` (e.g. `Number('abc')`), the comparator falls back to the locale-aware string comparison for that pair only. Prevents unstable ordering when dirty data slips through.
- **Null handling:** `null` and `undefined` always sort to the bottom in BOTH ascending and descending directions. The directional arrow flips ordering of non-null values only.
- **Mixed types:** if `getValue` returns mixed types across rows for the same column, the comparator coerces every value with `String(v)` and falls back to the locale-aware string comparison above. Implementation must NOT throw on mixed input.
- The default comparator is exposed but not extensible in Phase 0; consumers needing custom sort precompute a sortable scalar via `getValue`.

**Filter value identity (locked):**

- Each filter option is keyed by `String(getValue(row) ?? `__NULL__::${column.key}`)`. The column-scoped `'__NULL__::<column.key>'` sentinel ensures null/undefined values collapse into a single distinguishable filter option rather than producing duplicate empty-string entries for non-string inputs (dates, floats, derived values), AND avoids the rare collision where real row data equals a literal `'__NULL__'` string.
- A custom `getFilterOptions` MUST return options whose `value` field is a deterministic string; non-string `value` fields are a type error.
- This rule prevents subtle equality bugs where two visually-identical options (e.g. `Date` instances representing the same instant) produce two filter entries.

**Persist key namespacing (locked):**

- The `persistKey` prop names the consumer logically (e.g. `'spending-ledger'`). The component prefixes it as `table:v1:${persistKey}` when reading/writing localStorage so SortableTable storage cannot collide with non-table consumers.
- The `v1` segment is the **persisted-state schema version**. If the persisted shape (sort tuple, filter selections, column-key set) ever changes incompatibly, bump to `v2`; the old `v1` keys are then ignored and treated as absent rather than producing corrupted state. Consumers do NOT include the version in `persistKey`.
- Callers pass the unprefixed, unversioned identifier; the component owns both the namespace AND the version.

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
- The destructive button (e.g. "Delete agent") uses `margin-left: auto` to push to the right edge of the inner band.

**Spacing contract (locked):** pages using `<FormFooter>` MUST be wrapped in `<PageShell bottomPadding={100}>` (or larger). `<FormFooter>` does NOT inject its own spacer div — keeping the spacing decision at the page-shell level avoids hidden spacers in the DOM and lets the page tune `bottomPadding` if it needs more clearance. A page that uses `<FormFooter>` without `<PageShell bottomPadding>` will visually clip its last field; this is a consumer bug that surfaces at G2 manual verification, not a primitive concern.

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
- Pill variant uses a deterministic colour from `hashToColor(clientName)` (see `client/src/lib/colorHash.ts` below; matching the prototype palette: indigo / amber / emerald / red / sky / slate).
- When `clickable` and user has org-admin permission in the active org, click calls `switchWorkspace(clientId, clientName)` (see helper below).
- When not clickable (workspace user, or `clickable={false}`), renders as a plain pill.
- Tooltip: "Switch to <name> workspace" when clickable.

**Permission read:** from existing `auth.ts` user/permission state. No new permission concept introduced.

**`switchWorkspace` helper (NEW):**

`client/src/lib/workspace.ts`

```ts
import { setActiveClient } from '@/lib/auth';

/**
 * Switches the active workspace and refreshes app state.
 *
 * TEMPORARY: relies on a hard reload because Phase 0 does not yet have
 * router-level state refresh. A later phase replaces the reload with a
 * targeted invalidation. Do NOT inline `window.location.reload()` elsewhere
 * in the codebase; route every workspace switch through this helper.
 */
export function switchWorkspace(clientId: string, clientName: string): void {
  setActiveClient(clientId, clientName);
  window.location.reload();
}
```

`<WorkspaceBadge>` calls `switchWorkspace` rather than inlining `setActiveClient` + `window.location.reload()`. This isolates the temporary reload pattern to a single call site so the eventual replacement (router-level refresh) is a single-file change.

**`hashToColor` helper (NEW, extracted util):**

`client/src/lib/colorHash.ts`

```ts
export type Palette = ReadonlyArray<string>;

export const DEFAULT_WORKSPACE_PALETTE: Palette = [
  'indigo', 'amber', 'emerald', 'red', 'sky', 'slate',
];

/**
 * Deterministic palette assignment from an arbitrary string input.
 * Reused wherever a stable visual identity per name is needed
 * (workspace badges today, potentially agent/skill badges later).
 */
export function hashToColor(input: string, palette: Palette = DEFAULT_WORKSPACE_PALETTE): string;
```

Extraction rationale: the same hash logic recurs across consolidated UI (workspace badges in lists, drawers, modals, run-trace embeds). One source of truth prevents palette drift.

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

**Illegal-transition handling (locked at hook level):** the `useViewMode` hook owns transition validation so consumers cannot drift on the rule. The hook contract:

```ts
// client/src/hooks/useViewMode.ts
export interface UseViewModeReturn {
  viewMode: ViewMode;
  availableModes: ReadonlyArray<ViewMode>;
  /** Returns false and triggers onRequireClientSelection if the transition is illegal. */
  setViewMode: (next: ViewMode) => boolean;
}

export interface UseViewModeOptions {
  /** Called when setViewMode('workspace') is attempted with no activeClient. Layout wires this to its existing client-picker open flow. */
  onRequireClientSelection?: () => void;
}

export function useViewMode(options?: UseViewModeOptions): UseViewModeReturn;
```

Transition rules and side effects (locked):

| Call | Precondition | Side effects | Return |
|---|---|---|---|
| `setViewMode('org')` | always allowed for users with org-admin permission | Clears `activeClient`. Disables `system_admin_org_override` if previously set. | `true` |
| `setViewMode('workspace')` | `activeClient` is set | No mutation to identity state; mode flips to `workspace`. | `true` |
| `setViewMode('workspace')` | NO `activeClient` | No mutation. Invokes `options.onRequireClientSelection?.()`. | `false` |
| `setViewMode('system')` | user has `system_admin` permission | Enables `system_admin_org_override`. | `true` |
| `setViewMode('system')` | user lacks `system_admin` | No mutation. | `false` |

Refactor invariant: any future change to `useViewMode` MUST preserve the table above. The boolean return + optional callback pattern is the only signalling channel; consumers do not read identity state directly to detect a rejected transition.

`<ViewModeSwitcher onChange={setViewMode}>` propagates the boolean return implicitly via React state; consumers that need to react to a rejected transition wire `onRequireClientSelection`. `Layout.tsx` is the canonical consumer and wires it to its client picker.

### 4.7 Sidebar nav config (refactor)

Today, `Layout.tsx` inlines its nav structure across hundreds of lines. Phase 0 extracts it into a typed config:

```ts
// client/src/config/routes.ts (NEW central route map)
/**
 * Single source of truth for every route the app navigates to. All Phase-0
 * primitives that take a route prop reference this union so adding/renaming
 * a route is a one-file change and stale links surface as TypeScript errors.
 */
export const APP_ROUTES = [
  '/',
  '/inbox',
  '/activity',
  '/agents',
  '/agents/:id/edit',
  '/recurring-tasks',
  '/projects/:id/edit',
  '/knowledge',
  '/org-knowledge',
  '/spending',
  '/integrations',
  // ... extended by A/B/C as their pages are added
] as const;

export type AppRoute = (typeof APP_ROUTES)[number];
```

```ts
// client/src/config/sidebar.ts
import type { AppRoute } from './routes';

export type NavGroup = 'work' | 'build' | 'tasks' | 'external' | 'setup' | 'clientpulse';

export interface NavItem {
  group: NavGroup;
  label: string;
  to: AppRoute;                       // typed route, not raw string
  icon: keyof typeof Icons;           // existing Icons map in Layout
  permission?: string;                // optional permission key; gates visibility
  viewModes?: ReadonlyArray<ViewMode>;// modes in which this item is visible (default: all)
  badge?: 'count' | null;             // count comes from existing inbox badge wiring; no new mechanic
}

export const NAV_ITEMS: NavItem[] = [ /* ... */ ];
```

**Why typed `to`:** with `to: string`, an A/B/C edit can silently land a typo (`/recurrring-tasks`) or a stale path (after a Spec-A rename) that compiles cleanly. With `to: AppRoute`, the build fails at the spec boundary. The route map lives in `client/src/config/routes.ts` so each downstream spec adds its own routes there in a small, mergeable diff.

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
  /** Override the default 1280px content max-width. Use sparingly (e.g. wide tables). */
  maxWidth?: number;
}
```

**Default max-width: `1280px`** (locked). Applied via `.page-content { max-width: 1280px; margin: 0 auto; }`. Consumers needing a wider band (e.g. a six-column table) pass `maxWidth` explicitly; the default applies otherwise so A/B/C consumers do not pick divergent values.

**Default horizontal padding: `28px`** (locked). Applied via `.page-content` and matches the inner padding used by `.form-footer` (`padding: 14px 28px`) so a fixed footer aligns flush with the page-content gutters. Consumers do not override; pages needing a different gutter use a nested element rather than fighting the default.

CSS additions (around 12 lines) in the production stylesheet.

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
| `client/src/config/routes.ts` | NEW central route map; `AppRoute` union typed at compile time. Source of truth for every navigable path in the app. |
| `client/src/hooks/useViewMode.ts` | NEW hook returning `{ viewMode, setViewMode, availableModes }` derived from existing identity state; owns illegal-transition handling (§4.6) |
| `client/src/lib/workspace.ts` | NEW `switchWorkspace(clientId, clientName)` helper isolating `setActiveClient + window.location.reload()` (§4.5). Single call site so the eventual router-level refresh is a one-file change. |
| `client/src/lib/colorHash.ts` | NEW `hashToColor(input, palette)` util extracted from prototype-inline logic. Used by `<WorkspaceBadge>` today; shared with future consumers. |
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

1. **C1 — Modal extension.** Add `size`, `footer`, `bodyPadding`, `zIndex` props. Add the z-index ladder to the JSDoc. Update existing call sites only where breakage would occur (none expected).
2. **C2 — Drawer + WorkspaceBadge + helpers.** Drawer primitive (with overlay-exclusivity invariant); WorkspaceBadge plus `client/src/lib/colorHash.ts` and `client/src/lib/workspace.ts`. Independent of C1.
3. **C3 — SortableTable.** The largest chunk. Single component file. Locks the sort-comparator semantics, filter-value-identity rule, and persistKey namespacing per §4.3. Inline demo page optional (delete before merge or gate behind a dev-only route).
4. **C4 — useViewMode + ViewModeSwitcher.** Hook + component. Hook owns illegal-transition handling and exposes `onRequireClientSelection`.
5. **C5 — routes + sidebar config + Layout refactor.** Land `client/src/config/routes.ts` (`AppRoute` union), then `client/src/config/sidebar.ts` consuming it; refactor `Layout.tsx` to read `NAV_ITEMS`; wire `<ViewModeSwitcher>` and pass `onRequireClientSelection` to its existing client-picker open flow. Confirm no visual diff.
6. **C6 — FormFooter + PageShell + shared CSS.** Component wrappers + class additions to the production stylesheet, including `.page-content { max-width: 1280px }`.
7. **C7 — Doc + handoff.** Update `architecture.md` "Key files per domain" table to point at the new components. Update `KNOWLEDGE.md` only if a non-obvious gotcha was hit during implementation.

Total target: 2-3 days of one builder (sonnet). Single PR.

**Dependency graph:** C5 depends on C4 (Layout reads `useViewMode` and wires `onRequireClientSelection`). C5 also lands `client/src/config/routes.ts` before `sidebar.ts` references it (intra-chunk ordering). All other chunks are independent. C3 (SortableTable) does not depend on C1 (Modal extension) because the filter dropdown uses an inline popover, not a modal portal.

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
