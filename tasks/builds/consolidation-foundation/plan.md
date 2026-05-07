# Implementation Plan — consolidation-foundation

**Spec:** `tasks/builds/consolidation-foundation/spec.md`
**Build slug:** `consolidation-foundation`
**Branch:** `claude/learn-harbour-ui-B4k7a`
**Authored:** 2026-05-07
**Author:** architect (inline)
**Target builder:** sonnet
**Estimated effort:** 2-3 days, single PR
**Plan version:** v2 (post-ChatGPT-review tightenings)

---

## Table of contents

1. Executor notes
2. Model-collapse check
3. Architecture notes
4. Pre-existing violation handling
5. Stepwise implementation plan
6. Per-chunk detail
   - C1 — Modal extension + scroll-lock helper
   - C2 — Drawer + WorkspaceBadge + helpers
   - C3 — SortableTable + pure helpers + tests
   - C4 — useViewMode hook + ViewModeSwitcher
   - C5 — routes config + sidebar config + Layout refactor
   - C6 — FormFooter + PageShell + shared CSS
   - C7 — Doc-sync (architecture.md only)
7. Risks and mitigations
8. System invariants
9. Self-consistency check
10. Chunk size summary
11. Acceptance gate (whole-build)

---

## 1. Executor notes

> **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Per-chunk verification commands are restricted to:

- `npm run lint`
- `npm run typecheck`
- `npm run build:client` (only on chunks that touch `client/`)
- `npx tsx <colocated-test-path>` for any pure-function tests authored in the chunk

No other commands are valid Phase 2 verification.

This plan is implementation-only for the seven chunks defined in §6. Spec scope (§4 of `tasks/builds/consolidation-foundation/spec.md`) is the authoritative contract; this plan never relaxes it. If a chunk discovers a contradiction between spec and reality, the builder reports `PLAN_GAP` and the coordinator routes back to architect — the builder does NOT silently widen scope.

## 2. Model-collapse check

The four model-collapse questions:

1. Does this feature decompose into ingest → extract → transform → render?
2. Is each step doing something a frontier multimodal model could do in a single call?
3. If yes: can the whole pipeline collapse into one model call with a structured-output schema?

**Verdict: not applicable.** This spec ships frontend primitives — React components, TypeScript types, CSS classes, a hook, and a Layout refactor. There is no ingest pipeline, no extraction, no model in the loop at all. The model-collapse heuristic targets multi-stage data-processing pipelines; this work is structural UI plumbing. Reject collapse: there is nothing to collapse.

## 3. Architecture notes

### Decisions

**D1 — `AppRoute` brand type covers both static and parametric routes; the `AppRoutePattern` union remains the registry.**

Layout currently interpolates `activeClientId` and other identifiers into nav `to=` props at render time (e.g. `` `/admin/subaccounts/${activeClientId}/workspace` ``). A `string` literal-union of every concrete path the app navigates to is impossible — those paths are constructed dynamically. The spec's `AppRoute` union as drafted (`'/agents/:id/edit'` etc.) is a *route-pattern* type, useful for documenting the route map but unable to type-check the *concrete* string passed to React-Router's `<Link to>`.

**Pattern selected:** the route map ships as two cooperating types:

```typescript
// client/src/config/routes.ts
export const APP_ROUTE_PATTERNS = [
  '/',
  '/inbox',
  '/activity',
  '/agents',
  '/agents/:id/edit',
  '/admin/subaccounts/:subaccountId/workspace',
  '/admin/subaccounts/:subaccountId/scheduled-tasks',
  // ... all currently-navigated patterns extracted from Layout
] as const;

export type AppRoutePattern = (typeof APP_ROUTE_PATTERNS)[number];

/** A concrete URL produced by buildRoute or staticRoute. The brand prevents free-form strings from leaking past the type system. */
export type AppRoute = string & { readonly __brand: 'AppRoute' };

export function buildRoute<P extends AppRoutePattern>(
  pattern: P,
  params?: Record<string, string>,
): AppRoute {
  let out: string = pattern;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replace(`:${k}`, encodeURIComponent(v));
    }
  }
  // Dev-only guard: surface unresolved `:param` segments early.
  // Production keeps the placeholder behaviour (acceptable for Phase 0; A/B/C may tighten).
  if (process.env.NODE_ENV !== 'production' && /(?:^|\/):[A-Za-z_][A-Za-z0-9_]*/.test(out)) {
    // eslint-disable-next-line no-console
    console.warn('buildRoute: unresolved params in pattern', { pattern, params, result: out });
  }
  return out as AppRoute;
}

/** Static routes (no `:` segments) cast directly. The conditional type rejects parametric patterns at compile time. */
export function staticRoute<P extends AppRoutePattern>(
  pattern: P & (P extends `${string}:${string}` ? never : P),
): AppRoute {
  return pattern as AppRoute;
}
```

`NavItem.to` accepts `AppRoute`, the brand. Callers either pass `staticRoute('/inbox')` or `buildRoute('/admin/subaccounts/:subaccountId/workspace', { subaccountId: activeClientId })`. Static routes that pass a non-static pattern produce a TypeScript error at the call site. Parametric routes unify on `buildRoute`.

**Considered and rejected:** typing `to` as `string` and accepting that typo'd routes only fail at runtime — defeats the spec's "stale links surface as TypeScript errors" goal. Also rejected: requiring every parametric route to declare a constructor function — over-engineered for Phase 0 and inconsistent with the spec's "single source of truth" framing.

**Spec consequence:** the spec's `AppRoute` definition (§4.7, line ~387 `export type AppRoute = (typeof APP_ROUTES)[number];`) is implemented as `AppRoutePattern` (the literal union) plus `AppRoute` (the brand). Both names exist — the brand at the call site, the pattern type for the registry. This is a **clarification**, not a deviation; the spec's intent (stale links fail to compile) is preserved.

**D2 — Scroll-lock ownership uses a window-scoped mount counter on a `Symbol.for`-keyed property.**

The spec (§4.2 "Scroll-lock ownership") locks the contract: each overlay snapshots `document.body.style.overflow` at mount, applies `overflow: hidden`, and only restores on unmount if the mount count returns to zero. The implementation:

```typescript
// client/src/components/overlayScrollLock.ts (NEW, internal helper)
const COUNTER_KEY = Symbol.for('automation-os.overlay-scroll-lock.counter');
const SNAPSHOT_KEY = Symbol.for('automation-os.overlay-scroll-lock.snapshot');

interface LockWindow {
  [COUNTER_KEY]?: number;
  [SNAPSHOT_KEY]?: string;
}

// INVARIANT: COUNTER_KEY MUST NEVER be negative. Math.max(0, ...) defends against
// double-unmount or HMR-induced cleanup drift. If the counter ever drifts below zero,
// the snapshot may be lost and `overflow` resets to '' instead of the original value.
//
// INVARIANT: overlayScrollLock assumes exclusive ownership of document.body.style.overflow
// while any overlay is mounted. External mutation of `document.body.style.overflow` during
// lock lifetime is undefined behaviour — the snapshot restored on final release will revert
// the external change. Do NOT mutate body overflow from outside this helper.
export function acquireScrollLock(): void {
  const w = window as unknown as LockWindow;
  const current = Math.max(0, w[COUNTER_KEY] ?? 0);
  const next = current + 1;
  if (next === 1) {
    w[SNAPSHOT_KEY] = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  w[COUNTER_KEY] = next;
}

export function releaseScrollLock(): void {
  const w = window as unknown as LockWindow;
  // Clamp to zero defensively: a stray release without acquire (e.g. test teardown calling
  // cleanup twice) MUST NOT push the counter into negative territory.
  const current = Math.max(0, w[COUNTER_KEY] ?? 0);
  if (current <= 1) {
    document.body.style.overflow = w[SNAPSHOT_KEY] ?? '';
    delete w[SNAPSHOT_KEY];
    delete w[COUNTER_KEY];
  } else {
    w[COUNTER_KEY] = current - 1;
  }
}
```

Both `Modal.tsx` and `Drawer.tsx` call `acquireScrollLock()` from a `useEffect` mount and `releaseScrollLock()` from the cleanup. The `Symbol.for` registry is per-realm so the singleton survives module re-imports during HMR. The snapshot captures the original `overflow` value rather than naively restoring `''`.

**Considered and rejected:** managing the counter inside each overlay component (would diverge if Modal and Drawer ever drifted), and using a React context (over-engineered, and the lock is tied to the DOM not the component tree).

**D3 — `useViewMode` is a pure derivation hook; no shared store, no context, no Zustand.**

Spec §4.6 locks the side-effect table and the boolean-return + optional `onRequireClientSelection` callback contract. The hook reads existing state (`getActiveOrgId`, `getActiveClientId`, `system_admin_org_override` via auth helpers) and derives `viewMode`. Three consumers (Layout, Sidebar config consumer, ViewModeSwitcher control) each call `useViewMode()` independently — there is no shared store, the derivation is cheap, and React rendering memoises it.

**Considered and rejected:** Zustand or Context — adds plumbing for state that is already cleanly derived from existing identity state. The spec explicitly says "underlying state stays as-is, this is a UI surface on top, not a new identity model" (§3, Workspace/org/system view mode row).

**D4 — Sort comparator + filter-identity logic extracted as pure functions in a `*Pure.ts` sibling module.**

Spec §4.3 locks the comparator semantics (NaN guard, null-to-bottom, locale-aware string fallback) and the filter-value identity rule. Both are pure functions; both belong in a colocated `*Pure.ts` module with a `*Pure.test.ts` sibling. Pattern matches established codebase convention (`runStatusPure.ts`, `usePendingInterventionPure.ts`, `useTaskProjectionPure.ts`, `briefArtefactLifecyclePure.ts`).

```typescript
// client/src/components/sortableTablePure.ts
export function compareForSort(
  a: unknown, b: unknown,
  hint: 'string' | 'number' | 'mixed',
): number;

export function deriveFilterKey(
  value: unknown, columnKey: string,
): string;

export function applySortAndFilters<Row>(
  rows: Row[],
  sort: { key: string; dir: 'asc' | 'desc' } | null,
  filters: Record<string, Set<string>>,
  columns: ColumnDef<Row>[],
): Row[];
```

Tests live at `client/src/components/__tests__/sortableTablePure.test.ts`. Run via `npx tsx <path>` in C3.

**D5 — `<FormFooter>` injects no spacer; `<PageShell bottomPadding>` is the spacing contract.**

Spec §4.4 locks this verbatim. The plan defers strictly: `FormFooter` ships as a thin wrapper around the `.form-footer` / `.form-footer-inner` classes and renders nothing layout-affecting outside the fixed footer band. The "your last field is clipped" failure mode is documented in JSDoc and surfaces at G2 manual verification.

### Patterns applied

- **Branded type** (D1) — `AppRoute` brand prevents free-form strings from leaking past the type system.
- **`Symbol.for`-keyed singleton** (D2) — mount-counter survives module reload (HMR) and avoids global namespace collisions.
- **Pure-function extraction** (D4) — keeps sortable-table logic testable without rendering React.
- **Composition over hierarchy** — every primitive is a leaf; no wrapping abstractions.

### Patterns deliberately not applied

- **No new state-management library.** `useViewMode` derives from existing helpers; React's render-as-function-of-state handles propagation.
- **No new routing layer.** `buildRoute` is a tiny utility, not a router replacement.
- **No new icon system.** `NavItem.icon` continues to take a React node from the existing `Icons` map in `Layout.tsx`.

## 4. Pre-existing violation handling

`Layout.tsx` currently interpolates `activeClientId` and other identifiers into raw template-literal route strings (e.g. `` `to={`/admin/subaccounts/${activeClientId}/workspace`}` ``). Once `AppRoute` becomes a brand (D1), those interpolations become type errors at the `<NavItem to=...>` boundary. They are addressed in C5 (sidebar config + Layout refactor) by routing every `to=` through `buildRoute(...)` or `staticRoute(...)`. No separate baseline gate run is needed — TypeScript surfaces every site at build time.

If C5's `npm run typecheck` reports any concrete-route TypeScript error outside the rewritten `NAV_ITEMS` set (e.g. an inline `<Link to={...}>` elsewhere in `Layout.tsx`, breadcrumbs, CTA button), C5 fixes it in the same chunk by passing through `buildRoute` / `staticRoute`. Out-of-scope for C5: creating new branded utilities for unrelated routes outside Layout — those are A/B/C concerns. If the typecheck reports a `<Link>` outside Layout altogether (e.g. inside a page component), the chunk widens the `to` prop type to `AppRoute | string` at the call site and routes the existing string through; no migration of unrelated pages happens in this build.

This plan does NOT include a "Phase 0 baseline gate run". CI is the authoritative gate runner. If the integrated branch state has a pre-existing gate violation that this build accidentally re-flags, the violation surfaces in CI on PR open and the operator triages there.

## 5. Stepwise implementation plan

Seven chunks, ordered for forward-only dependencies. Two chunks (C1, C3, C6) are independent and could be parallelised by a future builder; this plan ships them sequentially because the build is single-developer.

| # | Chunk | Files | Depends on |
|---|---|---|---|
| C1 | Modal extension + scroll-lock helper | 2 created/modified | — |
| C2 | Drawer + WorkspaceBadge + helpers | 5 created | C1 (scroll-lock helper) |
| C3 | SortableTable + pure helpers + tests | 3 created | — |
| C4 | useViewMode hook + ViewModeSwitcher | 4 created | — |
| C5 | routes config + sidebar config + Layout refactor | 5 created/modified | C4 |
| C6 | FormFooter + PageShell + shared CSS | 3 created/modified | — |
| C7 | Doc-sync (architecture.md only) | 1 modified | C1-C6 |

C1 ships the scroll-lock helper because Modal is the first overlay to consume it. C2 reuses the helper. C5 depends on C4 only because `Layout.tsx` wires `useViewMode`'s `onRequireClientSelection` callback. All other chunks are pairwise independent.

The dependency graph is forward-only and acyclic: C1 → C2; C4 → C5; C7 closes after every other chunk.

## 6. Per-chunk detail

### Chunk C1 — Modal extension + scroll-lock helper

**spec_sections:** §4.1, §4.2 (scroll-lock contract cross-cuts both), §10 (deferred items inform what NOT to do).

**Logical responsibility:** extend `<Modal>` to support the new contracts and ship the scroll-lock primitive both overlays will consume.

**Files to create:**
- `client/src/components/overlayScrollLock.ts` — `acquireScrollLock()` and `releaseScrollLock()` per D2.

**Files to modify:**
- `client/src/components/Modal.tsx` — add `size`, `footer`, `bodyPadding`, `zIndex` props (additive only, existing call sites unaffected). Replace the hard-coded `z-[1000]` Tailwind class with the `zIndex` prop value; backdrop uses `zIndex - 1`. Wire `acquireScrollLock` / `releaseScrollLock` in the existing `useEffect`.

**Files NOT touched:** any existing call site that uses `<Modal>` today (the new props are all optional with safe defaults).

**Contracts (locked from spec §4.1):**

```typescript
interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  // Existing
  maxWidth?: number;
  disableBackdropClose?: boolean;
  // NEW
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'iframe';
  footer?: React.ReactNode;
  bodyPadding?: 'default' | 'none';
  zIndex?: number;
}
```

Size token map: `sm=480, md=720, lg=1024, xl=1280, iframe=calc(100vw - 64px)`. Default `zIndex=1000`. When both `size` and `maxWidth` are passed, `size` wins; emit `console.warn` only when `process.env.NODE_ENV !== 'production'`.

**Error handling:**
- No async paths; no error surfaces. Invalid `size` is a TypeScript error at the call site.
- `zIndex` precedence and `size` vs `maxWidth` precedence are documented in the JSDoc, not enforced at runtime beyond the dev warn.

**Test considerations:**
- No automated tests authored in C1 (component test framework is `none_for_now` per spec §8 / `docs/spec-context.md`).
- Manual verification at G2: open one of the existing Modal call sites (e.g. via `RuleConflictBanner`, `ExternalDocumentRebindModal`) and confirm it renders unchanged.

**Verification commands:**

```bash
npm run lint
npm run typecheck
npm run build:client
```

**Acceptance criteria:**
- `Modal.tsx` accepts the new props with the spec's defaults.
- `overlayScrollLock.ts` exports `acquireScrollLock` and `releaseScrollLock`; the counter survives mount-unmount-mount cycles (verified at G2 by opening any Modal twice in succession).
- All existing Modal call sites continue to type-check and behave identically (additive change confirmed by `npm run typecheck`).

### Chunk C2 — Drawer + WorkspaceBadge + helpers

**spec_sections:** §3 (audit row for Drawer / WorkspaceBadge), §4.2 (Drawer), §4.5 (WorkspaceBadge + `switchWorkspace` + `hashToColor`).

**Logical responsibility:** ship the right-hand drawer overlay and the workspace-identity badge with all helpers it depends on.

**Files to create:**
- `client/src/components/Drawer.tsx` — portal-rendered side-drawer per spec §4.2.
- `client/src/components/WorkspaceBadge.tsx` — pill / inline workspace identifier per spec §4.5.
- `client/src/lib/colorHash.ts` — `hashToColor(input, palette?)` deterministic palette hash per spec §4.5.
- `client/src/lib/workspace.ts` — `switchWorkspace(clientId, clientName)` helper that wraps `setActiveClient` + `window.location.reload()`.
- `client/src/lib/__tests__/colorHash.test.ts` — pure-function tests for `hashToColor`.

**Files NOT touched:** none in production code. (`AutomationPickerDrawer.tsx` keeps its bespoke implementation — the spec's audit row classifies it as page-specific, not a Drawer consumer.)

**Contracts (locked from spec §4.2 and §4.5):**

```typescript
// Drawer.tsx
interface DrawerProps {
  open: boolean;
  side?: 'right' | 'left';
  width?: number | string;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

// WorkspaceBadge.tsx
interface WorkspaceBadgeProps {
  clientId: string;
  clientName: string;
  variant?: 'pill' | 'inline';
  clickable?: boolean;
}

// colorHash.ts
export type Palette = ReadonlyArray<string>;
export const DEFAULT_WORKSPACE_PALETTE: Palette;
export function hashToColor(input: string, palette?: Palette): string;

// workspace.ts
export function switchWorkspace(clientId: string, clientName: string): void;
```

Drawer overlay-exclusivity invariant per spec §4.2: not enforced at primitive level (would need an OverlayManager, deferred per spec §10). Drawer applies its own focus trap; calls `acquireScrollLock` / `releaseScrollLock` from C1.

WorkspaceBadge `clickable` defaults to `true` if user has org-admin permission in the active org (read via existing `auth.ts` helpers). Pill variant uses `hashToColor(clientName)`. When `clickable` and active, click calls `switchWorkspace(clientId, clientName)` from `client/src/lib/workspace.ts`.

`hashToColor` algorithm: deterministic 32-bit FNV-1a over the input string, mod palette length. Pure function; identical input produces identical output. JSDoc states: "Reused wherever a stable visual identity per name is needed."

`switchWorkspace` implementation:

```typescript
// client/src/lib/workspace.ts
import { setActiveClient } from './auth';

/**
 * Switches the active workspace.
 *
 * INVARIANT: this is the ONLY allowed `window.location.reload()` call site for the
 * workspace-switch case. DO NOT call `window.location.reload()` anywhere else in the
 * codebase for workspace changes. Verified by the C2 pre-commit grep check.
 *
 * TEMPORARY: relies on a hard reload because Phase 0 does not yet have router-level
 * state refresh. A later phase replaces the reload with a targeted invalidation.
 */
export function switchWorkspace(clientId: string, clientName: string): void {
  if (!clientId) return; // defensive guard: no-op on empty id
  setActiveClient(clientId, clientName);
  window.location.reload();
}
```

**Error handling:**
- No async paths.
- `Drawer` with `open=false` renders nothing (no portal mount, no scroll lock acquired).
- `WorkspaceBadge` with empty `clientName` renders the pill with a fallback colour (`palette[0]`); does not throw.

**Test considerations (mandatory):**
- `client/src/lib/__tests__/colorHash.test.ts` — covers determinism (same input → same output across calls), palette wrap-around (input hash that exceeds palette length still produces a valid index), empty-string input (returns `palette[0]` without throwing), custom-palette override.

Run via:

```bash
npx tsx client/src/lib/__tests__/colorHash.test.ts
```

**Verification commands:**

```bash
npm run lint
npm run typecheck
npm run build:client
npx tsx client/src/lib/__tests__/colorHash.test.ts
```

**Acceptance criteria:**
- `Drawer` mounts as a portal, slides in from the right (or left if `side='left'`), Esc / backdrop click closes, focus is trapped, scroll-lock released on unmount.
- `WorkspaceBadge` renders as a pill or inline span; pill colour is deterministic from `clientName`; clickable variant calls `switchWorkspace` not `setActiveClient + window.location.reload()` directly.
- `colorHash` is pure and deterministic, tests pass.
- `switchWorkspace` is the only file in the repo that calls `window.location.reload()` for the workspace-switch case.

**Pre-commit grep check (run by builder before C2 commit):**

```bash
grep -rn "window.location.reload" client/src/ | grep -v "client/src/lib/workspace.ts"
```

If this returns any new call site introduced by C2, fix before commit. Pre-existing call sites are flagged in the C2 commit message as "pre-existing, not introduced by this chunk" but NOT modified in this chunk.

### Chunk C3 — SortableTable + pure helpers + tests

**spec_sections:** §4.3 (SortableTable contract + sort comparator semantics + filter-value identity + persistKey namespacing + stability contract).

**Logical responsibility:** ship the only generic sortable + filterable table primitive in the codebase, with the comparator and filter logic extracted as testable pure functions.

**Files to create:**
- `client/src/components/SortableTable.tsx` — the React component.
- `client/src/components/sortableTablePure.ts` — `compareForSort`, `deriveFilterKey`, `applySortAndFilters`. All pure.
- `client/src/components/__tests__/sortableTablePure.test.ts` — colocated unit tests.

**Files NOT touched:** none. SortableTable has no consumers in Phase 0; A/B/C wire it in.

**Contracts (locked from spec §4.3):**

```typescript
interface ColumnDef<Row> {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  width?: string;
  align?: 'left' | 'right' | 'center';
  getValue?: (row: Row) => string | number | null;
  render?: (row: Row) => React.ReactNode;
  getFilterOptions?: (rows: Row[]) => Array<{ value: string; label: string }>;
}

interface SortableTableProps<Row> {
  rows: Row[];
  columns: ColumnDef<Row>[];
  rowKey: (row: Row) => string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  emptyState?: React.ReactNode;
  onRowClick?: (row: Row) => void;
  persistKey?: string;
}
```

**Pure-function contracts:**

```typescript
// sortableTablePure.ts
export function compareForSort(
  a: unknown, b: unknown,
  hint: 'string' | 'number' | 'mixed',
): number;
// - 'number': Number(a) - Number(b); NaN guard falls back to localeCompare(String(a), String(b), undefined, { sensitivity: 'base' }).
// - 'string': localeCompare with sensitivity 'base'.
// - 'mixed': String(a) and String(b), then localeCompare.
// - null/undefined: returns the magic number that places the null at the bottom regardless of direction.

export function deriveFilterKey(value: unknown, columnKey: string): string;
// returns String(value ?? `__NULL__::${columnKey}`).

export function applySortAndFilters<Row>(
  rows: Row[],
  sort: { key: string; dir: 'asc' | 'desc' } | null,
  filters: Record<string, Set<string>>,
  columns: ColumnDef<Row>[],
): Row[];
// INVARIANT: relies on V8 stable sort (Node >= 12 / modern browsers). Any future change
// to the sort implementation MUST preserve sort stability — equal-key rows MUST retain
// insertion order across sort flips. Verified by sortableTablePure.test.ts.
// 1. Apply filters: row passes column's filter iff Set is empty (no filter) or contains deriveFilterKey(getValue(row), columnKey).
// 2. Stable sort: Array.prototype.sort (stable on V8 since 7.0).
//    Apply direction by negating the comparator output for 'desc'; null-to-bottom remains null-to-bottom in both directions.
// 3. Return new array (do not mutate input).
```

**Persistence behaviour:**
- `persistKey='spending-ledger'` → reads/writes `localStorage.getItem('table:v1:spending-ledger')`.
- The component owns the `table:v1:` prefix; callers pass the unprefixed identifier.
- **INVARIANT:** `persistKey` MUST be globally unique per table usage. Two distinct tables that share the same `persistKey` will silently corrupt each other's persisted sort/filter state. The recommended pattern is `<page>-<table-purpose>` (e.g. `spending-ledger`, `agents-list`, `subaccount-tasks`). This is documented in `SortableTable.tsx`'s JSDoc on the `persistKey` prop.
- Persisted shape: `{ sort: { key: string; dir: 'asc' | 'desc' } | null; filters: Record<string, string[]> }`. Filter sets serialise as arrays.
- Read on mount; if `JSON.parse` fails, treat as absent and start fresh (do NOT throw).
- Write debounced 200ms after sort/filter change; flush on unmount.

**Filter dropdown UX (locked from spec §4.3):**
- Stays open until Apply / Cancel / Esc / outside-click.
- Individual checkbox changes do NOT close.
- "Select all" is smart toggle (any unchecked → check all; all checked → uncheck all).
- Cancel restores snapshot taken on open.
- Filter committed only on Apply.
- Caret highlights when fewer items checked than total.

**Filter caret icon (resolves prototype round 14 visual feedback).** The trigger is a Material-style funnel SVG, not a text caret/arrow glyph. Use `currentColor` for `stroke` so the existing button colour states (default `slate-400`, hover `slate-700`, filtered `indigo-500`) drive the icon colour without per-state SVG variants:

```html
<button class="sf-caret-btn" aria-label="Filter">
  <svg viewBox="0 0 16 16" width="11" height="11" fill="none"
       stroke="currentColor" stroke-width="1.6"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2 3h12l-4.5 6v4l-3 1.5V9z"/>
  </svg>
</button>
```

Rationale: the original down-arrow caret read as "expand/dropdown" rather than "filter," and users found it ambiguous. The funnel matches the established Google / Material convention for filter affordances. `currentColor` keeps the styling DRY across the three button states.

**Error handling:**
- Bad column key in `initialSort` (no matching `key` in `columns`): silently ignore (no sort applied, no throw).
- Custom `getFilterOptions` that returns non-string `value`: TypeScript catches at compile time.
- Sort on a column with `getValue` undefined: comparator receives `undefined` for both sides → returns 0 (no reorder).
- localStorage unavailable (private browsing in some browsers): wrap in try/catch, fall back to in-memory state, no throw.

**Test considerations (mandatory pure-function tests):**

`client/src/components/__tests__/sortableTablePure.test.ts` covers:

- `compareForSort`:
  - two strings ('Apple' vs 'banana' under sensitivity:'base' → negative)
  - two numbers (3 vs 10 → -7)
  - mixed (1 vs 'foo' → falls through to string)
  - NaN inputs (`'abc'` numeric → falls through to string)
  - null vs anything (null sorts to bottom in both 'asc' and 'desc' directions)
- `deriveFilterKey`:
  - string value (`'hello'` → `'hello'`)
  - null (`__NULL__::columnKey` sentinel)
  - Date instance (uses `String(d)` deterministic stringification)
  - undefined (sentinel)
- `applySortAndFilters`:
  - empty filters
  - single-column filter
  - multi-column AND
  - sort + filter combined
  - null-bottom behaviour ('asc' and 'desc')
  - **stability check** — two rows with equal sort keys preserve insertion order over multiple sort flips

Run via:

```bash
npx tsx client/src/components/__tests__/sortableTablePure.test.ts
```

**Verification commands:**

```bash
npm run lint
npm run typecheck
npm run build:client
npx tsx client/src/components/__tests__/sortableTablePure.test.ts
```

**Acceptance criteria:**
- Sort comparator produces stable, deterministic output for all type-mix scenarios.
- Filter dropdown UX matches the spec: Apply commits, Cancel restores, Esc cancels, outside-click cancels.
- localStorage persistence reads/writes the `table:v1:` prefix; missing/corrupt values do not throw.
- Tests pass under `npx tsx`.

### Chunk C4 — useViewMode hook + ViewModeSwitcher

**spec_sections:** §4.6 (ViewModeSwitcher contract + side-effect table + illegal-transition handling).

**Logical responsibility:** derive the locked `ViewMode` discriminated union from existing identity state and ship the segmented control consumers attach to.

**Files to create:**
- `client/src/hooks/useViewMode.ts` — hook per spec §4.6.
- `client/src/hooks/useViewModePure.ts` — pure derivation helpers (`deriveViewMode`, `deriveAvailableModes`, `isLegalTransition`).
- `client/src/hooks/__tests__/useViewModePure.test.ts` — colocated tests for the pure helpers.
- `client/src/components/ViewModeSwitcher.tsx` — three-segment control per spec §4.6.

**Files NOT touched:** Layout (handled in C5).

**Contracts (locked from spec §4.6):**

```typescript
// useViewMode.ts
export type ViewMode = 'workspace' | 'org' | 'system';

export interface UseViewModeReturn {
  viewMode: ViewMode;
  availableModes: ReadonlyArray<ViewMode>;
  setViewMode: (next: ViewMode) => boolean;
}

export interface UseViewModeOptions {
  onRequireClientSelection?: () => void;
}

export function useViewMode(options?: UseViewModeOptions): UseViewModeReturn;

// useViewModePure.ts
export interface ViewModeContext {
  hasActiveClient: boolean;
  hasSystemOverride: boolean;
  isOrgAdmin: boolean;
  isSystemAdmin: boolean;
}

export function deriveViewMode(ctx: ViewModeContext): ViewMode;
export function deriveAvailableModes(ctx: ViewModeContext): ReadonlyArray<ViewMode>;
export function isLegalTransition(
  from: ViewMode, to: ViewMode, ctx: ViewModeContext,
): boolean;
```

**Derivation rules (locked):**
- `viewMode` is **derived state**, not persisted. Read from existing helpers in `client/src/lib/auth.ts`:
  - If `system_admin_org_override` is active → `'system'`.
  - Else if no active client AND user has org-admin permission → `'org'`.
  - Else → `'workspace'`.
- `availableModes`: filter the canonical `['workspace', 'org', 'system']` set by user permissions. Workspace-only user gets `['workspace']`; org admin gets `['workspace', 'org']`; system admin gets all three.

**Transition rules (the side-effect table is a refactor invariant per spec §4.6):**

| Call | Precondition | Side effects | Return |
|---|---|---|---|
| `setViewMode('org')` | user has org-admin | Clear `activeClient`. Disable `system_admin_org_override` if previously set. | `true` |
| `setViewMode('workspace')` | `activeClient` set | No mutation; mode flips. | `true` |
| `setViewMode('workspace')` | no `activeClient` | No mutation. Invoke `onRequireClientSelection?.()`. | `false` |
| `setViewMode('system')` | user has `system_admin` | Enable `system_admin_org_override`. | `true` |
| `setViewMode('system')` | user lacks `system_admin` | No mutation. | `false` |

The hook accepts `options.onRequireClientSelection` at construction. Internally, the hook reads existing identity helpers; the *write* side calls existing identity setters (`setActiveClient(null, null)`, `setActiveOrgOverride(...)` or equivalent).

**Component contract:**

```typescript
interface ViewModeSwitcherProps {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  availableModes?: ReadonlyArray<ViewMode>;
}
```

Renders a three-segment pill control. Active segment is filled; others are outline. Renders only segments listed in `availableModes`. If `availableModes.length === 1`, collapses to a plain label (no switching affordance).

**Error handling:**
- `setViewMode` always returns a boolean. The only "rejected" path is `'workspace'` with no `activeClient`, which invokes `onRequireClientSelection` if provided.
- `setViewMode('system')` without `system_admin` permission is a no-op + returns `false`. UI never renders this segment to a non-system-admin user, so the path is defence in depth.

**Test considerations (mandatory pure-function tests):**

`client/src/hooks/__tests__/useViewModePure.test.ts` covers:

- `deriveViewMode`:
  - workspace user (no override, no orgAdmin, hasActiveClient) → `'workspace'`
  - org admin with no active client → `'org'`
  - org admin with active client → `'workspace'`
  - system admin with override active → `'system'`
- `deriveAvailableModes`:
  - workspace user → `['workspace']`
  - org admin → `['workspace', 'org']`
  - system admin → `['workspace', 'org', 'system']`
- `isLegalTransition`: every cell in the spec §4.6 transition table (15 cases).

Run via:

```bash
npx tsx client/src/hooks/__tests__/useViewModePure.test.ts
```

**Verification commands:**

```bash
npm run lint
npm run typecheck
npm run build:client
npx tsx client/src/hooks/__tests__/useViewModePure.test.ts
```

**Acceptance criteria:**
- `useViewMode` returns the spec's `{ viewMode, setViewMode, availableModes }` shape.
- The transition table matches spec §4.6 verbatim, verified by `useViewModePure.test.ts`.
- `<ViewModeSwitcher>` collapses to a plain label when `availableModes.length === 1`.
- Tests pass under `npx tsx`.

### Chunk C5 — routes config + sidebar config + Layout refactor

**spec_sections:** §4.7 (sidebar nav config), §4.6 (Layout wires `onRequireClientSelection`), §4.8 (Layout shell classes — only the `<ViewModeSwitcher>` placement is in scope here; PageShell ships in C6).

**Logical responsibility:** extract `Layout.tsx`'s inlined nav into a typed config and wire `<ViewModeSwitcher>` above the existing client switcher in the sidebar. **No visual change.**

**Files to create:**
- `client/src/config/routes.ts` — `APP_ROUTE_PATTERNS` literal-tuple + `AppRoutePattern` union + `AppRoute` brand + `buildRoute` + `staticRoute` (per D1).
- `client/src/config/sidebar.ts` — `NavGroup`, `NavItemSpec` types + `buildNavItems(ctx)` factory that returns the filtered NavItem list given identity context.
- `client/src/config/__tests__/buildRoute.test.ts` — pure tests for `buildRoute`.
- `client/src/config/__tests__/buildNavItems.test.ts` — pure tests for `buildNavItems`.

**Files to modify:**
- `client/src/components/Layout.tsx` — replace inline JSX nav blocks with a render loop over `buildNavItems(ctx)`. Wire `<ViewModeSwitcher>` above the existing client switcher. Pass `onRequireClientSelection` to its existing client-picker open flow. Migrate every `<Link to=>` and `<NavItem to=>` from raw template-literal strings to `staticRoute(...)` / `buildRoute(...)`.

**Files NOT touched:** any page component. The refactor is internal to `Layout`; nav structure does not change.

**Why a `buildNavItems` factory and not a static `NAV_ITEMS` array?**

The nav structure is **not** static. It depends on:

- `viewMode` (workspace / org / system gates whole sections)
- `activeClientId` (interpolated into Workspace-section paths)
- `hasOrgPerm` / `hasClientPerm` (per-item visibility)
- `hasSidebarItem` (module-driven feature flags)
- Dynamic `navProjects` and `navAgents` lists (rendered as nav items)
- `reviewCount`, `incidentCount`, `liveAgentCount` (badges)
- `isSystemAdmin` (Platform section)

A static array literal cannot encode this. The factory pattern accepts the full identity context and returns the rendered list:

```typescript
// client/src/config/sidebar.ts
import type { ReactNode } from 'react';
import type { AppRoute } from './routes';

// INVARIANT: NavGroup declaration order IS the visual render order. `buildNavItems`
// MUST emit items in this group sequence:
//   top → work → projects → agents → company → clientpulse → organisation → platform → footer
// Reordering this union (or sorting the output by anything other than this sequence)
// is a visual regression and MUST fail the C5 visual-diff acceptance criterion.
export type NavGroup =
  | 'top'              // Home, New Task above sections
  | 'work'             // workspace mode work items
  | 'projects'         // dynamic project list
  | 'agents'           // dynamic agent list
  | 'company'          // company items
  | 'clientpulse'
  | 'organisation'
  | 'platform'         // system admin
  | 'footer';          // profile, sign-out

export interface NavItemSpec {
  group: NavGroup;
  kind: 'link' | 'button' | 'section-header';
  key: string;
  label?: string;
  to?: AppRoute;
  iconKey?: string;          // looked up in Layout's existing Icons map
  badge?: number;
  badgeLabel?: string;
  exact?: boolean;
  manageTo?: AppRoute;
  onClick?: () => void;
  permission?: string;       // optional permission key gate
  viewModes?: ReadonlyArray<'workspace' | 'org' | 'system'>;
  // Dynamic-list helpers
  iconNode?: ReactNode;      // for project colour chip / agent custom icon
}

export interface NavContext {
  isSystemAdmin: boolean;
  hasOrgContext: boolean;
  hasAnyOrgPerm: boolean;
  activeClientId: string | null;
  activeClientName: string | null;
  hasOrgPerm: (key: string) => boolean;
  hasClientPerm: (key: string) => boolean;
  hasSidebarItem: (slug: string) => boolean;
  viewMode: 'workspace' | 'org' | 'system';
  navProjects: Array<{ id: string; name: string; color: string; status: string }>;
  navAgents: Array<{ id: string; agentId: string; name: string; icon: string | null }>;
  reviewCount: number;
  liveAgentCount: number;
  incidentCount: number;
  // Side-effect callbacks owned by Layout
  onCreateProject: () => void;
  onCreateAgent: () => void;
  onOpenNewBrief: () => void;
  onLogout: () => void;
  onOpenConfigAssistant: () => void;
}

export function buildNavItems(ctx: NavContext): NavItemSpec[];
```

`Layout.tsx`'s nav JSX block reduces to roughly:

```tsx
{buildNavItems(ctx).map(spec => renderNavItem(spec))}
```

Where `renderNavItem` is a small Layout-internal helper that maps `NavItemSpec.kind` to the existing `<NavItem>` / `<NavButton>` / `<NavSection>` JSX (which stay in Layout because they use Tailwind classes and the existing Icons map).

**The "no visual change" invariant** is enforced by the JSX renderer staying byte-equivalent — only the *structure declaration* moves to `buildNavItems`.

**`AppRoute` migration in Layout:**

Every `to=` in Layout's existing JSX becomes either:

- `to={staticRoute('/inbox')}` for non-parametric paths.
- `to={buildRoute('/admin/subaccounts/:subaccountId/workspace', { subaccountId: activeClientId ?? '' })}` for parametric paths (the `?? ''` fallback prevents an undefined-id from corrupting the URL; nav items that require `activeClientId` are already conditionally rendered behind `activeClientId` truthy checks).

The `<NavItem>` component's `to` prop type changes from `string` to `AppRoute`. This is the breaking-change boundary; type-check catches every existing call site that doesn't migrate. Per the §4 Pre-existing violation handling section above, the migration is in-scope for C5.

**`<ViewModeSwitcher>` placement (locked from spec §3 audit row):**

> "Three-segment control (Workspace / Org / System) shown in the sidebar above the client switcher when the user has org-admin permissions."

In `Layout.tsx`, this is roughly between the org-picker block and the client-picker block in the sidebar. The exact placement: **above** the existing org / client switcher cluster. The control reads `useViewMode()` and writes through `setViewMode`. Layout passes `onRequireClientSelection: () => setShowClientPicker(true)` (or whatever flag opens the existing client picker) to the hook.

**Error handling:**
- `buildRoute` with a missing param: leaves the `:param` placeholder in the URL string. Acceptable for Phase 0; A/B/C may tighten if it bites.
- `buildNavItems` is pure; it does not throw.
- Layout's existing error paths (failed `/api/my-subscription` fetch, etc.) are unaffected.

**Test considerations (mandatory pure-function tests):**

`client/src/config/__tests__/buildRoute.test.ts` covers:

- parametric substitution (`/foo/:id` + `{ id: 'abc' }` → `/foo/abc`)
- missing param leaves placeholder unchanged
- encoding (`{ id: 'a/b' }` → `'a%2Fb'`)
- multiple params in one pattern

`client/src/config/__tests__/buildNavItems.test.ts` covers:

- workspace user (no orgs, no permissions) sees only `top` + `footer` groups.
- org admin with no `activeClientId` sees `top` + `organisation` + `footer`.
- org admin with `activeClientId` sees the full workspace nav (top + work + projects + agents + company + organisation + footer).
- system admin sees `platform` group.
- viewMode='org' suppresses workspace-section nav items even when `activeClientId` is set. **Concrete assertion:** with `viewMode: 'org'` + `activeClientId` truthy, `expect(items.some(i => i.group === 'work')).toBe(false)`, and equivalently for `i.group === 'projects'` and `i.group === 'agents'`. This catches the regression where a future edit accidentally wires workspace-section visibility to `activeClientId` truthiness only, ignoring `viewMode`.

**Verification commands:**

```bash
npm run lint
npm run typecheck
npm run build:client
npx tsx client/src/config/__tests__/buildRoute.test.ts
npx tsx client/src/config/__tests__/buildNavItems.test.ts
```

**Acceptance criteria:**
- `Layout.tsx` no longer contains inline nav-item JSX blocks; the nav is driven by `buildNavItems(ctx)`.
- Every `<Link>` and `<NavItem>` in Layout types its `to=` as `AppRoute` via `buildRoute` or `staticRoute`.
- `<ViewModeSwitcher>` is rendered above the existing client switcher and writes through `useViewMode`'s `setViewMode`.
- Visual diff between pre-C5 and post-C5 Layout is empty for the four user shapes (workspace user, org admin without client, org admin with client, system admin) — verified by manual G2 spot-check.

### Chunk C6 — FormFooter + PageShell + shared CSS

**spec_sections:** §4.4 (FormFooter), §4.8 (PageShell + shell classes + locked defaults).

**Logical responsibility:** ship the page-level layout primitives and the form-footer wrapper.

**Files to create:**
- `client/src/components/FormFooter.tsx` — thin wrapper per spec §4.4.
- `client/src/components/PageShell.tsx` — wrapper with `header`, `bottomPadding`, `maxWidth` props per spec §4.8.

**Files to modify:**
- `client/src/index.css` — add `.form-footer`, `.form-footer-inner`, `.page-shell`, `.page-content`, `.page-body` classes (around 12-15 lines of CSS).

**Files NOT touched:** any existing page (PageShell is opt-in for new A/B/C pages; existing pages keep their current layout).

**Contracts (locked from spec §4.4 and §4.8):**

```typescript
// FormFooter.tsx
interface FormFooterProps {
  innerMaxWidth?: number;            // default 720
  children: React.ReactNode;         // typically <Discard /> <Save /> <Delete />
}

// PageShell.tsx
interface PageShellProps {
  header?: React.ReactNode;
  children: React.ReactNode;
  bottomPadding?: number;            // override (e.g. 100 with FormFooter)
  maxWidth?: number;                 // default 1280
}
```

**CSS additions to `client/src/index.css`:**

```css
.page-shell { display: flex; flex-direction: column; min-height: 100%; }
.page-content { max-width: 1280px; margin: 0 auto; padding: 28px 28px; width: 100%; }
.page-body { padding: 28px 32px; flex: 1; }
.form-footer {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: white;
  border-top: 1px solid var(--border, #e2e8f0);
  padding: 14px 0;                /* horizontal padding lives on the inner band, not here */
  box-shadow: 0 -2px 8px rgba(0,0,0,0.04);
  z-index: 100;
}
.form-footer-inner {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 28px;                /* matches the form-body's 28px gutter */
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
}
```

**Padding model rationale (resolves prototype round 14 alignment bug).** Earlier iterations used `padding: 14px 28px` on `.form-footer` (outer) and no padding on `.form-footer-inner`. With `margin: 0 auto` centring the inner band inside the already-padded outer, the inner ended up offset 28px **left** of the form-body card column — Discard's left edge sat at `(viewport - 720)/2`, but the form card's left edge sat at `(viewport - 720)/2 + 28`. Visually the buttons were 28px to the left of where users expected.

The fix: move the 28px horizontal padding from outer to inner with `box-sizing: border-box` so the inner's `max-width: 720px` includes the padding. Now Discard's left edge lines up exactly with the card's left edge, and Delete's right edge (with `margin-left: auto`) lines up with the card's right edge. This is also consistent with the spec's locked default that `.page-content` and `.form-footer` share the same 28px gutter.

> Note: spec §4.4 currently shows the older padding model. The contract change is implementation-only (the visual contract — buttons aligned to form column — is unchanged). Update spec §4.4's CSS block to match if the spec is amended in a follow-up round.

`FormFooter` JSDoc states verbatim: "Pages using `<FormFooter>` MUST be wrapped in `<PageShell bottomPadding={100}>` (or larger). Without it, the last form field is visually clipped behind the footer. `<FormFooter>` does NOT inject a spacer div."

**Default max-width:** 1280px (locked). **Default horizontal padding:** 28px (locked). Both match the spec's locked defaults so all consumers share the same gutter and the fixed footer aligns flush with the page-content.

**Error handling:**
- No async paths.
- `bottomPadding={undefined}` → no extra bottom padding (page-content default applies).
- `maxWidth={undefined}` → 1280px default.
- `innerMaxWidth={undefined}` → 720px default.

**Test considerations:**
- No automated tests authored; the components are CSS-class wrappers. Visual verification at G2.

**Verification commands:**

```bash
npm run lint
npm run typecheck
npm run build:client
```

**Acceptance criteria:**
- `<FormFooter>` renders the `.form-footer` / `.form-footer-inner` structure with the prototype's visual style.
- `<PageShell>` accepts `header`, `bottomPadding`, `maxWidth` props and applies them.
- CSS additions in `index.css` are isolated to the spec-named classes; no existing class is modified.
- Existing pages render unchanged (no page imports `PageShell` yet — this is by design).

### Chunk C7 — Doc-sync (architecture.md only)

**spec_sections:** §7 row 7 ("Doc + handoff") — the `architecture.md` portion. Handoff is appended by the coordinator at Phase 2 close, not by this chunk.

**Logical responsibility:** update the documentation surface that materially changes once these primitives ship.

**Files to modify:**
- `architecture.md` — update the "Key files per domain" table (or equivalent index section) to reference the new components: `Drawer.tsx`, `SortableTable.tsx`, `WorkspaceBadge.tsx`, `ViewModeSwitcher.tsx`, `PageShell.tsx`, `FormFooter.tsx`, plus the route-map and sidebar-config files. Add a one-line entry per file.

**Files NOT touched (intentionally):**
- `KNOWLEDGE.md` — entries land here only if a non-obvious gotcha is encountered during implementation. The chunk does NOT pre-fill entries; the doc-sync gate (coordinator step 9) decides verdict per `docs/doc-sync.md`.
- `DEVELOPMENT_GUIDELINES.md` — no new invariant locked by Phase 0 that isn't already in spec §4.
- `docs/capabilities.md` — no product capability shipped (these are infrastructure primitives).
- `docs/frontend-design-principles.md` — no new principle introduced.
- `docs/spec-context.md` — no testing-posture change.
- `tasks/builds/consolidation-foundation/handoff.md` — Phase 2 section is appended by the coordinator at handoff time, not by this chunk.

**Acceptance criteria:**
- `architecture.md` "Key files per domain" lists every primitive shipped.
- Prose around frontend layout primitives (if any) is updated to point at `PageShell` as the canonical surface for new pages.

**Verification commands:**

```bash
npm run lint
npm run typecheck
```

(No `build:client` needed — markdown-only change.)

## 7. Risks and mitigations

### R1 — `AppRoute` brand migration in Layout breaks an unrelated `<Link>`

**Risk:** Layout has `<Link>` instances outside the nav block (breadcrumbs, CTA buttons, branding logo). Changing `<NavItem.to>` from `string` to `AppRoute` and migrating those is in scope for C5; missing one is a TypeScript error at C5 build time.

**Mitigation:** C5's `npm run typecheck` surfaces every site. The chunk fixes them in-place by routing through `buildRoute` / `staticRoute`. Pre-existing-violation handling guidance is in §4.

**Residual risk:** none — TypeScript is exhaustive on the brand cast.

### R2 — Scroll-lock mount counter in tests

**Risk:** test files that mount Modal or Drawer without unmounting could leak the counter into subsequent tests. Phase 0 ships no Modal/Drawer tests, so the immediate risk is zero, but A/B/C tests may bite.

**Mitigation:** the `releaseScrollLock` function is idempotent below zero (uses `current <= 1` guard). A test runner that doesn't unmount overlays still leaves `document.body.style.overflow = 'hidden'` if no other overlay opens before the test completes — but the value restores to the snapshot on the next mount-unmount cycle. Phase 0 documents this behaviour in JSDoc.

**Residual risk:** A/B/C may need a test-utility wrapper that calls `releaseScrollLock()` in `afterEach` if they introduce overlay testing. Out of scope for Phase 0.

### R3 — `buildNavItems` purity vs Layout's existing `useEffect`-driven side data

**Risk:** the nav uses `navProjects` and `navAgents` lists that are loaded asynchronously via `useEffect` API calls. `buildNavItems(ctx)` accepts these as inputs, so the function is pure — but the *re-render* on identity change has to happen. Layout already re-renders on the existing `useState` setters, so the factory invocation lands in the existing render path naturally.

**Mitigation:** keep all data fetching in Layout's existing `useEffect` blocks. `buildNavItems` is invoked synchronously in Layout's render with the current state values. No new fetch logic moves into the config layer.

**Residual risk:** none — the factory is a pure projection of state, not a state owner.

### R4 — `localStorage` write contention in SortableTable

**Risk:** rapid sort/filter changes trigger frequent `localStorage.setItem` calls; on slow disks or constrained browsers, writes may queue and a tab close mid-write could persist a partial value.

**Mitigation:** debounce writes 200ms after the last change, AND flush on `useEffect` cleanup (component unmount). On `JSON.parse` failure, treat as absent and start fresh. The `table:v1:` prefix ensures schema bumps invalidate cleanly without crash.

**Residual risk:** corrupt localStorage value at mount → user starts with default sort/filter. Acceptable degradation.

### R5 — `<ViewModeSwitcher>` segment gating inconsistent with current Layout permission gating

**Risk:** Layout currently shows the system-admin Platform section based on `user.role === 'system_admin'`. `useViewMode` derives `isSystemAdmin` from existing identity helpers — these need to agree. If they diverge, a system admin sees the System segment but no Platform section appears (or vice versa).

**Mitigation:** in C4, `useViewMode` reads from the same `auth.ts` helpers Layout uses (`isSystemAdmin = user.role === 'system_admin'` is the canonical check). C5's Layout refactor passes the existing `isSystemAdmin` flag into `NavContext` so both paths read from one source.

**Residual risk:** none — single source of truth at the auth-helper level.

### R6 — `switchWorkspace` reload swallowing in-flight state

**Risk:** the helper does `setActiveClient` then `window.location.reload()`. If the user has unsaved form state on another part of the page, the reload discards it.

**Mitigation:** out of scope for Phase 0 per the spec's deferred-items list (router-level refresh replaces the reload). The JSDoc warns: "TEMPORARY: relies on a hard reload because Phase 0 does not yet have router-level state refresh."

**Residual risk:** user data loss on workspace switch with unsaved state. Acceptable for Phase 0; A/B/C may re-evaluate when introducing dirty-form pages.

### R7 — Sort stability assumption

**Risk:** `Array.prototype.sort` stability is documented for V8 ≥ 7.0 and modern browsers, but a future runtime change (or a SortableTable consumer running on an old engine) could regress.

**Mitigation:** the JSDoc on `applySortAndFilters` explicitly states the V8 ≥ 7.0 dependency and the contract that any future implementation MUST preserve stability. Tests in `sortableTablePure.test.ts` verify stability across multiple sort flips — a regression in stability would cause the test to fail.

**Residual risk:** none for currently-shipping browsers.

### R8 — C5 Layout refactor accidentally changes nav item ordering or labels

**Risk:** `buildNavItems` is a translation of Layout's inline JSX. A typo or omitted permission gate could move an item, drop one, or surface one to a user who shouldn't see it.

**Mitigation:** C5's `buildNavItems.test.ts` covers the four user shapes (workspace, org admin without client, org admin with client, system admin) with concrete expected NavItemSpec arrays. The visual-diff acceptance criterion catches any rendering regression. Spec §8 manual-verification step requires "open two tabs, one before / one after, confirm pixel-equivalent rendering."

**Residual risk:** edge-case combinations (e.g. org admin with `hasSidebarItem('clientpulse') === true` but no `org.review.view` permission) may not be covered by the four shapes. Mitigation: the test file covers the dimensions independently; combinations outside the four shapes are a known gap, A/B/C iterates if a regression surfaces.

## 8. System invariants (preserved by this build)

These are existing invariants the spec must not violate:

1. **No backend changes.** No file under `server/` is modified; no migration is added. Spec §6 declares this explicitly.
2. **Existing pages render unchanged.** Modal extension is additive; Drawer / SortableTable / etc. are new and have zero existing consumers.
3. **No new permission keys.** Spec §6 declares this. `<WorkspaceBadge>` and `<ViewModeSwitcher>` read existing permissions.
4. **No new routes.** Spec §6 declares this. `routes.ts` documents existing routes; it does not add any.
5. **Three-tier identity model preserved.** `useViewMode` is a UI surface on existing identity state, not a new tier.
6. **`switchWorkspace` is the only `window.location.reload()` call site for workspace changes.** Verified by grep at end of C2.
7. **Test gates are CI-only.** No Phase-2 chunk runs `scripts/verify-*.sh`, `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, the umbrella `npm test`, or any `scripts/run-all-*.sh`.

## 9. Self-consistency check

- **Goals (spec §1) match implementation (chunks):** every primitive in spec §3's audit table has a chunk.
- **Every "must" / "guarantees" claim has a backing mechanism:** overlay-exclusivity carveout (D2 scroll-lock), brand-cast typing (D1), pure-comparator stability (D4 with test).
- **File inventory complete:** every component named in spec §4 appears in a chunk; the chunk's "Files to create" lists match spec §5.
- **Phase dependency graph clean:** C5 → C4, C7 → C1-C6, all others independent. Forward-only.
- **Deferred-items section in spec is honoured:** no Phase 0 chunk implements anything in spec §10 (Drawer animation polish, SortableTable backend persistence, virtualisation, multi-sort, mobile view-mode UX, Tabs primitive, Modal `maxWidth`-removal).
- **Testing posture matches spec §8:** pure-function tests only (`compareForSort`, `deriveFilterKey`, `applySortAndFilters`, `deriveViewMode`, `deriveAvailableModes`, `isLegalTransition`, `hashToColor`, `buildRoute`, `buildNavItems`); no React component tests, no E2E.
- **Permissions / RLS / execution model statement explicit:** deferred to spec §6 ("Not applicable, frontend-only"). Plan does not introduce any backend touch points.

## 10. Chunk size summary

| Chunk | Files modified or created | Logical responsibilities |
|---|---|---|
| C1 | 2 (Modal + scroll-lock helper) | 1 (Modal extension + scroll-lock primitive) |
| C2 | 5 (Drawer, WorkspaceBadge, colorHash, workspace, colorHash.test) | 1 (drawer + badge primitives) |
| C3 | 3 (SortableTable, sortableTablePure, sortableTablePure.test) | 1 (sortable table primitive) |
| C4 | 4 (useViewMode, useViewModePure, useViewModePure.test, ViewModeSwitcher) | 1 (view-mode primitive) |
| C5 | 5 (routes.ts, sidebar.ts, Layout.tsx, buildRoute.test, buildNavItems.test) | 1 (Layout config-driven nav) |
| C6 | 3 (FormFooter, PageShell, index.css) | 1 (page-level layout primitives) |
| C7 | 1 (architecture.md) | 1 (doc sync) |

Each chunk is ≤5 files OR ≤1 logical responsibility. C2, C4, C5 push the file-count boundary but stay within the responsibility boundary because each chunk's files are the tight set required to deliver one primitive end-to-end (component + helper + test).

## 11. Acceptance gate (whole-build)

The build is complete when:

1. All seven chunks committed and pushed.
2. G2 (`npm run lint && npm run typecheck`) passes on the integrated branch state.
3. `npm run build:client` produces a clean Vite bundle with no warnings introduced by this build.
4. All authored unit tests pass under `npx tsx`:
   - `client/src/lib/__tests__/colorHash.test.ts`
   - `client/src/components/__tests__/sortableTablePure.test.ts`
   - `client/src/hooks/__tests__/useViewModePure.test.ts`
   - `client/src/config/__tests__/buildRoute.test.ts`
   - `client/src/config/__tests__/buildNavItems.test.ts`
5. Manual G2 spot-check: every existing page that imports `Layout` or `Modal` renders without console errors. Spot-check around 10 pages including `SystemAgentsPage`, `WorkspaceMemoryPage`, `SubaccountAgentEditPage`, `AdminSkillsPage`.
6. Sidebar visual diff: open two tabs, one before / one after, confirm pixel-equivalent rendering for a workspace user, an org admin without active client, an org admin with active client, and a system admin.
7. ViewModeSwitcher: as workspace-only user, control collapses to label. As org admin, two segments. As system admin with override, switching to System works.
8. SortableTable manual smoke: deferred to first A/B/C consumer; no inline dev page is shipped (the operator deferred the `/dev/primitives` route per spec §10).
9. spec-conformance verdict: `CONFORMANT` or `CONFORMANT_AFTER_FIXES`.
10. pr-reviewer verdict: `APPROVED`.
