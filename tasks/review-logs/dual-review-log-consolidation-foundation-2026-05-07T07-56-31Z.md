# Dual Review Log — consolidation-foundation

**Files reviewed:** `claude/learn-harbour-ui-B4k7a` branch vs `main` — Phase 2 frontend foundation diff (11 new components, 2 libs, 2 hooks, 2 configs, 5 test files; modifications to Modal, Layout, auth, api, index.css)
**Iterations run:** 3/3
**Timestamp:** 2026-05-07T07:56:31Z
**Reviewer:** Codex `gpt-5.5` via `codex review --base main`
**Adjudicator:** Claude Opus 4.7 (1M)

---

## Iteration 1

### Codex findings

1. **[P2]** `client/src/hooks/useViewMode.ts:107` — `setViewMode('org')` removes `activeClient` from localStorage but Layout's React mirror state (`activeClientId`/`activeClientName`) is not synchronised, so downstream effects keep the stale client.
2. **[P2]** `client/src/hooks/useViewMode.ts:115` — Selecting a client via the icon rail or command palette does not clear `systemAdminOrgOverride`. A system admin can select a workspace and remain in System mode.
3. **[P2]** `client/src/components/SearchBox.tsx:37-39` — When the parent resets `value` while a debounce timer is pending, the effect updates `local` but leaves the timer alive. The timer later fires `onChange` with the stale typed value, undoing the parent's reset.

### Adjudication

- **[ACCEPT] useViewMode.ts:107 — Layout state sync.**
  Reason: Real bug introduced by the C4 refactor. Spec §4.6 makes the side-effect contract clear. The cleanest bounded fix is a new `onClientCleared` callback option in `UseViewModeOptions` that Layout wires to its mirror `setActiveClientIdState(null)` / `setActiveClientNameState(null)` — minimal API surface, no scope creep.

- **[ACCEPT] useViewMode.ts:115 — system override clear on workspace selection.**
  Reason: Real bug; overlaps with prior `adversarial-reviewer` finding. Bounded mechanical fix: clear `systemAdminOrgOverride` in `handleSelectClient` (icon rail) and `handleSelectClientFromPalette` (command palette). Also fixed the related pre-existing finding that the command palette did not call `setActiveClient` to persist (React state only).

- **[ACCEPT] SearchBox.tsx:37 — cancel pending debounce on external value change.**
  Reason: Real, trivial 4-line fix. Clear the timer in the value-sync effect before updating `local`.

### Changes

- `client/src/hooks/useViewMode.ts` — added `onClientCleared` callback option; invoked after `setViewMode('org')` clears the client.
- `client/src/components/Layout.tsx` — wired `onClientCleared`; `handleSelectClient` and `handleSelectClientFromPalette` clear the system override; command-palette path now persists via `setActiveClient(...)`.
- `client/src/components/SearchBox.tsx` — value-sync effect cancels any pending debounce timer.

Lint: 0 errors. Typecheck: clean. Committed at `b53fe9f5`.

---

## Iteration 2

### Codex findings

1. **[P2]** `client/src/hooks/useViewMode.ts:120-122` — `setViewMode('workspace')` from System mode (system admin with active client) marks the transition legal but does not mutate identity state. `deriveViewMode` then returns `'system'` again on the next render (priority rule), so the switcher cannot leave System mode via the Workspace segment.

### Adjudication

- **[ACCEPT] workspace transition must clear systemAdminOrgOverride.**
  Reason: Real, reachable bug. The spec §4.6 transition table said "No mutation to identity state" for `setViewMode('workspace')`, but that wording is internally inconsistent with the priority rule (`system > org > workspace`). The transition is only effective if the override is cleared. Fix: clear `systemAdminOrgOverride` in the workspace transition (mirrors the org-transition behaviour). Also corrected the spec table — minimal in-scope doc update since the spec belongs to this same build.

### Changes

- `client/src/hooks/useViewMode.ts` — workspace transition clears `systemAdminOrgOverride` if set.
- `tasks/builds/consolidation-foundation/spec.md` — §4.6 transition-table row for `setViewMode('workspace')` updated to match.

Lint: 0 errors. Typecheck: clean. Committed at `c34c19b0`.

---

## Iteration 3

### Codex findings

1. **[P2]** `client/src/components/SortableTable.tsx:128` — When a user checks "Select all" and applies the dropdown, the table stores every current option as the active filter. This breaks the canonical no-filter representation (empty Set), causes the caret (size < options.length) and `Clear filters` button (size > 0) to disagree about whether a filter is active, and silently filters out any value that appears in newly-added rows or after a persisted-state reload against changed data.
2. **[P2]** `client/src/hooks/useViewModePure.ts:31` — A stale `systemAdminOrgOverride` flag in localStorage after a role downgrade derives `viewMode = 'system'` even though `deriveAvailableModes` excludes System. The sidebar enters an inconsistent mode with no active switcher segment and hidden workspace items.

### Adjudication

- **[ACCEPT] FilterDropdown normalises all-selected to empty Set.**
  Reason: Real correctness bug with three concrete failure modes (silent filter on new data, caret/Clear-filters UI inconsistency, persisted-state replay against changed data). Bounded fix in `FilterDropdown.handleApply`: detect "all selected" and pass `new Set<string>()` to `onApply` instead. Other consumers and `applySortAndFilters` already treat `size === 0` as no filter, so this aligns the apply path with the existing canonical representation.

- **[ACCEPT] deriveViewMode requires isSystemAdmin to return 'system'.**
  Reason: Real defence-in-depth correctness fix. One-line change: `if (ctx.hasSystemOverride && ctx.isSystemAdmin) return 'system';`. Added two regression tests for stale-flag-without-isSystemAdmin scenarios. Test count: 24 → 26, all passing.

### Changes

- `client/src/components/SortableTable.tsx` — `FilterDropdown.handleApply` normalises "all selected" to an empty Set.
- `client/src/hooks/useViewModePure.ts` — `deriveViewMode` requires `isSystemAdmin` for `'system'`; JSDoc updated.
- `client/src/hooks/__tests__/useViewModePure.test.ts` — added two regression tests for stale-override-flag cases.

Lint: 0 errors. Typecheck: clean. Pure tests: 26/26 pass. Will be committed with this log.

---

## Changes Made

- `client/src/components/Layout.tsx` — `onClientCleared` wiring; system-override clear in two client-selection paths; command-palette persists to localStorage; imports `getSystemAdminOrgOverride`/`setSystemAdminOrgOverride`.
- `client/src/components/SearchBox.tsx` — value-sync effect cancels pending debounce timer.
- `client/src/components/SortableTable.tsx` — `FilterDropdown.handleApply` normalises all-selected to empty Set.
- `client/src/hooks/useViewMode.ts` — `onClientCleared` callback option; workspace transition clears `systemAdminOrgOverride`; org transition invokes `onClientCleared`.
- `client/src/hooks/useViewModePure.ts` — `deriveViewMode` guards `'system'` on `isSystemAdmin`; JSDoc updated.
- `client/src/hooks/__tests__/useViewModePure.test.ts` — two new regression tests (downgraded-user with stale override flag).
- `tasks/builds/consolidation-foundation/spec.md` — §4.6 transition-table row for `setViewMode('workspace')` reflects override-clear behaviour.

## Rejected Recommendations

None — every Codex finding across all three iterations was accepted. Each finding identified a real correctness issue introduced by the Phase 2 refactor (or, in iteration 2, a latent inconsistency in the spec table itself). All fixes were bounded to existing files and existing call sites; no new abstractions or refactors outside the consolidation-foundation diff.

Adjudication did, however, narrow scope on iteration 1 finding #2 (system override clear): Codex flagged it as a `useViewMode.ts` issue, but the actual fix is in `Layout.tsx` because the icon-rail and command-palette client-selection paths bypass the hook entirely. Implementing it inside `useViewMode` would have required Layout to route every client selection through `setViewMode('workspace')`, which is a larger behavioural change than warranted.

---

## Items for the user to validate manually

- **G2 visual verification (out of scope per the task brief)** — the user runs the dev server themselves. Suggested manual checks:
  1. As a system admin in System mode with an active client: click "Workspace" in the switcher → verify the mode actually changes (the new workspace-transition fix).
  2. As a system admin in System mode: click a client from the icon rail OR the command palette (Cmd+K) → verify mode flips to Workspace and the system-override badge disappears.
  3. On a list with `SearchBox` + a "Clear filters" button: type a query, immediately click Clear → verify the search input does NOT briefly re-populate after ~200ms.
  4. On any `SortableTable` with a filter dropdown: open a filter, click "Select all", click Apply → verify (a) the caret is grey, not indigo; (b) the "Clear filters" button does NOT appear; (c) if a row is added later with a brand-new value in that column, the row IS visible (not silently filtered).
- **Adversarial-reviewer's outstanding findings** (not in this dual-review's scope): client-side permission guard for `/clientpulse/*` and `/reports/*` route trees in `App.tsx`; cross-tab `storage` listener for `useViewMode`; `system_admin` `X-Organisation-Id` header trust model. These are pre-existing or scope-expanding and were intentionally left for a follow-up pass.

---

**Verdict:** APPROVED (3 iterations, 6 fixes applied, 0 rejected)

**Commits:**
- `b53fe9f5` — iter1 fixes (Layout state sync, system override clear, SearchBox stale debounce)
- `c34c19b0` — iter2 fixes (workspace transition clears system override; spec table corrected)
- `ca1ac9f4` — iter3 fixes + this log (FilterDropdown normalisation, deriveViewMode isSystemAdmin guard)
