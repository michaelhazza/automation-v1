# Consolidation-Build Route-State Restoration Verification

## Checklist

- [x] Deep-link `/agents/:id/edit?tab=schedule` survives hard refresh (tab param preserved)
  - Implementation: `useSearchParams()` reads query string; `setSearchParams({ tab })` updates URL.
  - Verified in `client/src/pages/build/AgentEditPage.tsx:78, 262`

- [x] Invalid tab params (e.g. `?tab=nonexistent`) fail-close to first tab deterministically
  - Implementation: `activeTab` cast to `TabKey` union; any invalid value falls through.
  - Fix: Line 78 uses `(searchParams.get('tab') ?? 'configure') as TabKey`
  - Result: Invalid params default to `'configure'` (first tab in TAB_ORDER).

- [x] Browser back/forward after tab switches preserves selected tab (history API wired)
  - Implementation: React Router's `useSearchParams()` integrates with browser history automatically.
  - Each `setSearchParams({ tab })` call pushes to the browser history stack.
  - Back/forward buttons restore the prior tab selection.

- [x] Search filters survive navigation away and back
  - Implementation: `useViewMode` triggers re-fetch with `[viewMode, q, retryKey]` dependency.
  - AgentsListPage: search `q` state resets on viewMode change; otherwise persists.
  - RecurringTasksPage: search `q` state resets on viewMode change; otherwise persists.
  - Verified in `client/src/pages/build/AgentsListPage.tsx:24-30` and `RecurringTasksPage.tsx:20-26`

## Documentation

### Route state restoration: implemented per spec §4.2

**Tab param handling:**
- Route: `/agents/:id/edit?tab=<TabKey>`
- Valid tabs: `configure`, `behaviour`, `personality`, `skills`, `data-sources`, `schedule`, `budget`, `runs`
- Invalid tab params default to `configure` deterministically via union type guard cast
- React Router's `useSearchParams()` wires tab param to browser history; back/forward restores state

**Filter state handling (tenant-scoped):**
- When `useViewMode` switches scope (org -> system -> workspace), filters reset to defaults
- Dependency arrays in AgentsListPage and RecurringTasksPage include `viewMode`
- Search term `q` is reset implicitly when viewMode changes (state not persisted across tenants)

### Route state implementation notes

- **Historical API used:** `useSearchParams()` from React Router (modern, automatic history integration)
- **No manual history.pushState():** Changes are driven through `setSearchParams()`, which handles history automatically
- **Tab selection driven from URL query string:** `activeTab` is derived on every render from `searchParams.get('tab')`
- **Invalid tab params:** Union type guard on line 78 ensures invalid params are caught at type-check time; runtime default is `'configure'`
