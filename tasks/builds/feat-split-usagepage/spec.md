**Status:** draft
**Spec date:** 2026-05-14
**Last updated:** 2026-05-14
**Author:** Michael
**Build slug:** feat-split-usagepage

# Split UsagePage along tab and tab-internal seams

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

- Decompose `client/src/pages/UsagePage.tsx` (1,280 LOC) into a thin host plus one file per tab (overview, agents, models, runs, routing, IEE) plus a shared usage-formatting helper module, matching the established `client/src/components/<feature>/` extraction convention.
- Extract the data-orchestration logic into a hook so the host stays declarative (and so embedded vs. standalone rendering of the page is easier to reason about).
- Preserve every user-visible behaviour: 4 summary cards, budget bars (75 / 90% thresholds), `RunActivityChart` (14-day rolling window), 6 tabs with their exact labels and order, monthly picker behaviour (current month is rightmost; `nextMonth` clamps at the current month), per-tab loading shimmers, routing tab's anomaly-flag colour bands (5/15% fallback, 10/25% escalation), filter UX, cursor-paginated routing log "Load more", request-detail drawer fields, IEE filters + summary + table.
- Preserve the caller contract. `UsagePage` is imported in two places:
  - `client/src/App.tsx` — standalone usage page
  - `client/src/pages/AdminSubaccountDetailPage.tsx` — embedded inside the "Usage & Costs" tab via lazy import, passes `embedded={true}` to hide the page-level title block.
  Both keep working without edits.

## 2. Non-goals

- Visual change. All Tailwind classes, SVG paths, colour bands, dimensions, shimmer animation timings stay byte-for-byte.
- API change. Every endpoint, query-param, response-field default-and-coalesce (`?? 0`, `?? []`) preserved.
- Routing tab data-flow change. Cursor pagination (`nextCursor` + `nextCursorId`) stays exactly as today, including the `Load more` accumulator pattern in `onLoadMore`.
- IEE tab inheritance from the page-level month picker stays — IEE re-derives `from` / `to` from `month` at fetch time, exactly as today.
- New tests beyond pure-helper coverage. Per `docs/spec-context.md` (`frontend_tests: none_for_now`), no UI tests are added. Pure helpers (`formatCents`, `formatTokens`, `monthLabel`, `prevMonth`, `nextMonth`, `parseFallbackChain`, `anomalyColor`) get one targeted Vitest file.

## 3. Existing primitives this spec reuses

| Primitive | Why reuse |
|---|---|
| `client/src/components/<feature>/` folder convention | Mirrors `pulse/`, `clientpulse/`, `skill-analyzer/`, `baseline/` |
| `client/src/components/ActivityCharts.tsx` → `RunActivityChart` | Already extracted; receives the `daily: DayBucket[]` array via its `data` prop (`<RunActivityChart data={daily} />`); not touched |
| `client/src/lib/api.ts` axios wrapper | All fetch calls keep using it |
| `useParams` from `react-router-dom` | Host page keeps reading `subaccountId` |
| `client/src/lib/formatMoney.ts` | **Not yet used here.** Today UsagePage has its own `formatCents` / `formatTokens`. See §11 — consolidating to the shared helper is deferred to avoid behavioural drift in this refactor. |

No new cross-codebase primitives invented in this refactor. Every new file under `client/src/components/usage/` and the `useUsageData` hook is a feature-local component or hook (scoped to the usage page), not a shared abstraction. Consolidating with `formatMoney.ts` is deliberately deferred to keep blast radius small.

The spec-authoring checklist sections 0 (verify present state), 4 (RLS), 5 (execution model), and 10 (execution-safety contracts) are N/A for this frontend-only refactor — no migrations, no new tenant-scoped tables, no new write paths.

## 4. Current structure (today)

`UsagePage.tsx` contains:

- **Type declarations** (~120 LOC) for: 11 interfaces — `UsageSummary`, `CostAggregate`, `WorkspaceLimits`, `AgentUsageRow`, `ModelUsageRow`, `RunCostRow`, `DayBucket`, `RoutingDistribution`, `RoutingLogItem`, `IeeUsageRow`, `IeeUsageSummary` — plus two type aliases: `Tab` union and `FallbackChainEntry`.
- **Pure helpers** (~30 LOC): `formatCents`, `formatTokens`, `monthLabel`, `prevMonth`, `nextMonth`, `parseFallbackChain`, `anomalyColor`.
- **Constants**: `ANOMALY_THRESHOLDS`, `TIER_COLORS`, `REASON_COLORS`, `STATUS_COLORS`.
- **Inline atoms**: `ChevLeft`, `ChevRight`, `BudgetBar`, `TabBar`, `SummaryCard`, `Badge`, `DistributionBar`, `FilterSelect`, `FilterText`, `DetailField`.
- **Inline tab components**:
  - `IeeTab` (lines 751–860, ~110 LOC) — filters + 4 summary cards + runs table.
  - `RoutingTab` (lines 951–1160, ~210 LOC) — anomaly flags + distribution charts + filter bar + log table + request-detail drawer trigger.
  - `RequestDetailDrawer` (lines 1192–1280, ~88 LOC) — fields + provider routing + fallback chain timeline + tokens-and-cost + audit hashes.
- **Main `UsagePage` component** (lines 248–732, ~485 LOC):
  - State for: `month`, `tab`, `summary`, `agents`, `models`, `runs`, `daily`, `loading`, `tabLoading`, routing-tab state (5 fields), IEE-tab state (3 fields).
  - Two effects: load-summary-and-daily on month change; `loadTab` on tab change (the `loadTab` callback contains a 6-branch switch on `t`).
  - Inline JSX for header, summary-cards grid, budget bars wrapper, run-activity chart, `<TabBar />`, and per-tab inline JSX for overview / agents / models / runs / routing / IEE.

## 5. Target structure

```
client/src/pages/UsagePage.tsx                          ← host only (~150–200 LOC target)
client/src/components/usage/
  ├─ types.ts                                           ← 11 interfaces + `Tab` union + `FallbackChainEntry` + `RoutingFilters` + `IeeFilters` type aliases
  ├─ format.ts                                          ← formatCents, formatTokens, monthLabel, prevMonth, nextMonth, parseFallbackChain, anomalyColor
  ├─ constants.ts                                       ← ANOMALY_THRESHOLDS, TIER_COLORS, REASON_COLORS, STATUS_COLORS, SHIMMER_CLASS
  ├─ __tests__/
  │   └─ format.test.ts                                 ← Vitest tests for the 7 pure helpers (§9)
  ├─ MonthNavigator.tsx                                 ← prev/next + month label (uses ChevLeft/ChevRight inline)
  ├─ SummaryCards.tsx                                   ← the 4-card row (Month Spend, Today, LLM Requests, Tokens Used)
  ├─ BudgetBars.tsx                                     ← wrapper that renders 1-2 BudgetBar instances when limits exist
  ├─ BudgetBar.tsx                                      ← single bar atom (preserved verbatim)
  ├─ TabBar.tsx                                         ← tab nav
  ├─ tabs/
  │   ├─ OverviewTab.tsx                                ← invoice summary + run-limit card
  │   ├─ AgentsTab.tsx                                  ← agents table + footer totals
  │   ├─ ModelsTab.tsx                                  ← models table
  │   ├─ RunsTab.tsx                                    ← runs table
  │   ├─ RoutingTab.tsx                                 ← orchestrates the routing region
  │   ├─ RoutingAnomalies.tsx                           ← three anomaly cards
  │   ├─ RoutingDistribution.tsx                        ← four DistributionBars + latency summary
  │   ├─ RoutingFilters.tsx                             ← filter row
  │   ├─ RoutingLogTable.tsx                            ← log table + Load-more
  │   ├─ RequestDetailDrawer.tsx                        ← drawer
  │   └─ IeeTab.tsx                                     ← filters + 4 cards + table
  └─ atoms/
      ├─ DistributionBar.tsx
      ├─ Badge.tsx
      ├─ FilterSelect.tsx
      ├─ FilterText.tsx
      ├─ DetailField.tsx
      └─ SummaryCard.tsx
client/src/hooks/
  └─ useUsageData.ts                                    ← orchestrates summary + daily + per-tab fetches, exposes loadTab(t)
```

Host import paths in `App.tsx` and `AdminSubaccountDetailPage.tsx` are unchanged.

## 6. Component tree and ownership

```
UsagePage  (host — ~150–200 LOC)
│
├── header
│    ├── (when !embedded) Title + subtitle               ← inline
│    └── <MonthNavigator month, thisMonth, onPrev, onNext />
├── <SummaryCards summary, loading />
├── <BudgetBars monthlySpent, todaySpent, monthLimit, dailyLimit /> ← renders null when both limits absent
├── <RunActivityChart data={daily} />                    ← unchanged primitive (`data` is the existing prop name)
├── <TabBar active, onChange />
└── tab body — dispatch by active tab
    ├── overview → <OverviewTab month, summary />
    ├── agents   → <AgentsTab rows, loading />
    ├── models   → <ModelsTab rows, loading />
    ├── runs     → <RunsTab rows, subaccountId, loading />
    ├── routing  → <RoutingTab subaccountId, month, distribution, log, nextCursor, nextCursorId, loadingMore, selectedRequest, filters, tabLoading, onFilterChange, onLoadMore, onSelectRequest />
    │              ├── <RoutingAnomalies dist />
    │              ├── <RoutingDistribution dist />
    │              ├── <RoutingFilters dist, filters, onFilterChange />
    │              ├── <RoutingLogTable log, selectedRequest, tabLoading, onSelectRequest, nextCursor, nextCursorId, loadingMore, onLoadMore />
    │              └── <RequestDetailDrawer request, onClose />   (rendered conditionally on `selectedRequest`)
    └── iee      → <IeeTab rows, summary, loading, filters, onFilterChange />
```

`atoms/` files are small leaf components consumed inside several tabs (e.g. `DistributionBar` and `Badge` are used inside `RoutingDistribution`, `RoutingLogTable`, and `RequestDetailDrawer`).

## 7. Data-fetching ownership

All fetch logic moves into a single hook so the host's render is declarative.

### `useUsageData(subaccountId, month)`

Owns:
- `summary` state, plus the effect that fetches `GET /api/subaccounts/:id/usage/summary?month=` and `GET /api/agent-activity/daily?subaccountId=&sinceDays=14` in parallel. Effect dependencies: `[subaccountId, month]` — exactly as today (the daily call's request body uses only `subaccountId`/`sinceDays`, but the effect re-runs on `month` change too so the summary + daily pair stays in sync with the page-level month).
- Per-tab state: `agents`, `models`, `runs`, `routingDist`, `routingLog`, `routingNextCursor`, `routingNextCursorId`, `selectedRequest`, `routingFilters`, `routingLoadingMore`, `ieeRows`, `ieeSummary`, `ieeFilters`.
- `loading` (initial page-level load) and `tabLoading` (per-tab swap load).
- The `loadTab(tab)` callback containing the six branches.
- The `onLoadMore()` action for the routing log.
- `setRoutingFilters`, `setIeeFilters` for the two tabs that own filters.
- `setSelectedRequest` for the routing detail drawer.

Returns:
```
{
  // Page-level
  summary, daily, loading,
  // Per-tab data
  agents, models, runs,
  routing: { distribution, log, nextCursor, nextCursorId, loadingMore, selectedRequest, filters, tabLoading },
  iee:     { rows, summary, filters, tabLoading },
  // Per-tab actions
  loadTab(tab),                            // host calls in tab-change effect
  setRoutingFilters(filters),
  setIeeFilters(filters),
  routingLoadMore(),
  selectRequest(request | null),
}
```

Note: the hook exposes `routing.selectedRequest` (matching the §8.8 prop name) and the action `selectRequest`. There is no `routing.selected` field — that name was a placeholder in earlier drafts.

The host wires `useEffect(() => { loadTab(tab); }, [tab, loadTab])` exactly as today. `tab` initialises to `'overview'`, so the overview tab loads on mount.

The hook keeps the `loadTab` dependency on `[subaccountId, month, routingFilters, ieeFilters]` to preserve today's refetch semantics (filter changes re-trigger the tab fetch).

The two fetch effects today happen to share a single `tabLoading` boolean across routing and IEE. The hook preserves this — both tabs share the same loading flag because at most one tab is active at a time. Spec preserves the current behaviour; do not split into per-tab loading flags.

## 8. Prop contracts at each new boundary

### 8.0 Shared filter types (in `types.ts`)

```
type RoutingFilters = {
  provider?:        string;
  routingReason?:   string;
  capabilityTier?:  string;
  executionPhase?:  string;
  status?:          string;
  wasDowngraded?:   string;        // 'true' | 'false' | '' as today
  wasEscalated?:    string;        // 'true' | 'false' | '' as today
  agentName?:       string;
  runId?:           string;
};

type IeeFilters = {
  types:        string;            // comma-separated, e.g. 'browser,dev'
  statuses:     string;            // comma-separated, e.g. 'completed,failed'
  minCostCents: string;
  search:       string;
};
```

`RoutingFilters` keys are the exact set today's `<FilterSelect>` / `<FilterText>` rows write to via `setFilter(key, value)` (today's UsagePage lines 1046–1054). The fields are optional because the current code starts with `{}` and only sets keys as the user interacts; the spread `{ month, ...routingFilters }` into the GET-params object continues to omit absent keys.

`IeeFilters` mirrors today's inline literal type at UsagePage.tsx lines 275–280.

Both types live in `client/src/components/usage/types.ts` and are imported by the hook, the parent `<RoutingTab>` / `<IeeTab>`, and (for routing only) the `<RoutingFilters>` sub-component.

### 8.1 `<MonthNavigator>`

```
props: {
  month: string;                  // 'YYYY-MM'
  thisMonth: string;              // 'YYYY-MM' — passed in so the host owns "what is now"
  onPrev(): void;
  onNext(): void;
}
```
Right-arrow disabled when `month >= thisMonth`. Uses the existing `monthLabel` helper for display.

Note: today's host derives `thisMonth = new Date().toISOString().slice(0, 7)` once at mount, while `nextMonth(ym)` independently calls `new Date()` inside the helper. Both derivations are time-of-day sensitive but agree for any single session. The spec preserves this behaviour — `thisMonth` stays a host-level constant for the disabled-state check, and `nextMonth` keeps its current self-contained clamp. Do NOT plumb `thisMonth` into `nextMonth`; doing so would silently change behaviour for the very-rare cross-midnight-at-month-end edge case.

### 8.2 `<SummaryCards>`

```
props: {
  summary: UsageSummary | null;
  loading: boolean;
}
```
Renders 4 cards. While loading, each value slot renders a shimmer block. Card layout and copy preserved verbatim.

### 8.3 `<BudgetBars>`

```
props: {
  monthlySpent: number;
  todaySpent: number;
  monthLimit: number | null;
  dailyLimit: number | null;
}
```
Returns null if both limits are null. Otherwise renders the wrapper card with one or two `<BudgetBar>` instances.

### 8.4 `<BudgetBar>`

```
props: { spent: number; limit: number | null; label: string }
```
Same atomic as today, but file-scoped.

### 8.5 `<TabBar>`

```
props: { active: Tab; onChange(next: Tab): void }
```
Tabs list is owned internally (same labels in same order). No prop change vs. today.

### 8.6 `<OverviewTab>`

```
props: { month: string; summary: UsageSummary | null }
```
Renders invoice-summary card and the conditional run-limits card.

### 8.7 `<AgentsTab>` / `<ModelsTab>` / `<RunsTab>`

```
<AgentsTab>: { rows: AgentUsageRow[]; loading: boolean }
<ModelsTab>: { rows: ModelUsageRow[]; loading: boolean }
<RunsTab>:   { rows: RunCostRow[];   loading: boolean; subaccountId: string }
```
Each renders a table; shimmer rows during loading; empty-state copy preserved.

### 8.8 `<RoutingTab>` (orchestrator)

```
props: {
  subaccountId: string;
  month: string;
  distribution: RoutingDistribution | null;
  log: RoutingLogItem[];
  nextCursor: string | null;
  nextCursorId: string | null;
  loadingMore: boolean;
  selectedRequest: RoutingLogItem | null;
  filters: RoutingFilters;
  tabLoading: boolean;
  onFilterChange(f: RoutingFilters): void;
  onLoadMore(): void;
  onSelectRequest(r: RoutingLogItem | null): void;
}
```

Internally composes `<RoutingAnomalies>`, `<RoutingDistribution>`, `<RoutingFilters>`, `<RoutingLogTable>`, and (conditionally) `<RequestDetailDrawer>`. The shape mirrors today's `RoutingTabProps` so the prop migration is mechanical.

Sub-component props:
- `<RoutingAnomalies>`: `{ dist: RoutingDistribution }` — renders only when `dist.totalRequests > 0`.
- `<RoutingDistribution>`: `{ dist: RoutingDistribution }` — four `DistributionBar`s + latency summary.
- `<RoutingFilters>`: `{ dist: RoutingDistribution | null; filters: RoutingFilters; onFilterChange(next: RoutingFilters): void }`.
- `<RoutingLogTable>`:
  ```
  {
    log: RoutingLogItem[];
    selectedRequest: RoutingLogItem | null;
    tabLoading: boolean;                                  // single shared loading flag — same value passed from <RoutingTab>
    nextCursor: string | null;
    nextCursorId: string | null;
    loadingMore: boolean;
    onSelectRequest(r: RoutingLogItem | null): void;
    onLoadMore(): void;
  }
  ```
- `<RequestDetailDrawer>`: `{ request: RoutingLogItem; onClose(): void }` — moves wholesale.

### 8.9 `<IeeTab>`

```
props: {
  rows: IeeUsageRow[];
  summary: IeeUsageSummary | null;
  loading: boolean;
  filters: IeeFilters;
  onFilterChange(next: IeeFilters): void;
}
```
Renames `tabLoading` prop to `loading` for consistency with the other tabs. Internal `setF(key, value)` helper preserved.

## 9. Pure-helper extraction

All helpers move to `client/src/components/usage/format.ts`:

- `formatCents(cents: number | null | undefined): string`
- `formatTokens(n: number | null | undefined): string`
- `monthLabel(ym: string): string`
- `prevMonth(ym: string): string`
- `nextMonth(ym: string): string` — preserves clamp-at-current-month behaviour
- `parseFallbackChain(raw: string | null): FallbackChainEntry[] | null` — preserves JSON-parse-or-null behaviour
- `anomalyColor(value: number, thresholds: { warn: number; danger: number }): string`

Test file: `client/src/components/usage/__tests__/format.test.ts` — one focused `describe` block per helper, each with the edge cases below.

| Helper | Cases to cover |
|---|---|
| `formatCents` | `null` and `undefined` return `'—'`; `0` → `'$0.00'`; `< 100` → `'$0.NN'` with padding; `>= 100` → `'$X.YY'` with `toLocaleString` formatting and 2-fraction-digit padding |
| `formatTokens` | `null` and `undefined` return `'—'`; sub-1k integer formatted as-is; `>= 1_000` → `'NK'`; `>= 1_000_000` → `'N.NM'` |
| `monthLabel` | `'2026-01'` → `'January 2026'`; `'2026-12'` → `'December 2026'` |
| `prevMonth` | `'2026-05'` → `'2026-04'`; `'2026-01'` → `'2025-12'` (year rollover) |
| `nextMonth` | Forward: `'2026-04'` → `'2026-05'` when current month is May 2026 or later. Clamp: when input is the current month, output equals current month (never advances past it). The test uses `vi.useFakeTimers()` + `vi.setSystemTime(new Date('2026-05-14T00:00:00Z'))` to control `new Date()` inside `nextMonth`; teardown calls `vi.useRealTimers()`. |
| `parseFallbackChain` | `null` input returns `null`; valid JSON array returns the parsed array; malformed JSON returns `null` (no throw); non-array JSON returns `null` |
| `anomalyColor` | Value below `warn` returns slate band; value `>= warn` and `< danger` returns amber band; value `>= danger` returns red band |

Constants move to `constants.ts`: `ANOMALY_THRESHOLDS`, `TIER_COLORS`, `REASON_COLORS`, `STATUS_COLORS`, and `SHIMMER_CLASS`. The `SHIMMER_CLASS` string is today's host-local `shimmer` constant (UsagePage.tsx line 354) — `'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-lg'` — copied byte-for-byte. Every extracted tab and atom that needs the shimmer string imports `SHIMMER_CLASS` directly from `constants.ts`; this removes today's prop-drilling of `shimmer` into `<RoutingTab>` (UsagePage.tsx line 701, `RoutingTabProps.shimmer: string`) — the new `<RoutingTab>` does not take a `shimmer` prop. No tests — they are static lookup tables.

## 10. Migration plan (chunked)

Each chunk is independently revertible. Order: types and helpers first, atoms second, simple tabs third, routing tab last (most complex internal split).

### Chunk 1 — Extract `types.ts`, `format.ts`, `constants.ts`

- Move all 11 interfaces + `Tab` union + `FallbackChainEntry` type alias to `client/src/components/usage/types.ts`.
- Add two new named type aliases to `types.ts`: `RoutingFilters` and `IeeFilters` per §8.0. `RoutingFilters` replaces today's inline `Record<string, string>` annotation on the host's `routingFilters` state and on all routing prop sites; `IeeFilters` replaces today's inline literal type on the host's `ieeFilters` state and on the `IeeTab` filter props. Behaviour is unchanged — keys remain the same — only the type-annotation is tightened.
- Move all 7 pure helpers to `format.ts`. Add `__tests__/format.test.ts` per §9.
- Move the four colour-map constants to `constants.ts`. Also export `SHIMMER_CLASS` — today's host-scoped `shimmer` string at UsagePage.tsx line 354, copied byte-for-byte. This removes the `shimmer` prop drilled into `<RoutingTab>` today; subsequent chunks (5, 6) import `SHIMMER_CLASS` directly from `constants.ts` in each tab/atom that needs it.
- Host imports from new paths.
- **Done when:** host file shrinks by ~150 LOC; `npx vitest run client/src/components/usage/__tests__/format.test.ts` passes; lint + typecheck + build:client clean.

### Chunk 2 — Extract atoms

- Move `BudgetBar`, `SummaryCard`, `DistributionBar`, `Badge`, `FilterSelect`, `FilterText`, `DetailField` to dedicated files under `client/src/components/usage/atoms/`.
- `ChevLeft` / `ChevRight` stay inline in `UsagePage.tsx` for now; they move into `MonthNavigator.tsx` in Chunk 3 (they're not reused elsewhere).
- **Done when:** atoms render via imports; host file lighter; visible behaviour unchanged.

### Chunk 3 — Extract chrome (`MonthNavigator`, `SummaryCards`, `BudgetBars`, `TabBar`)

- Create the four chrome components per §8.1–§8.5.
- `MonthNavigator.tsx` absorbs the inline `ChevLeft` / `ChevRight` SVG components verbatim (polyline points and stroke attributes copied unchanged from today's UsagePage).
- Host renders become `<MonthNavigator … />`, `<SummaryCards … />`, `<BudgetBars … />`, `<TabBar … />`.
- **Done when:** the chrome row above the tab body is composed entirely of named components; chevron SVG byte-for-byte identical to today.

### Chunk 4 — Extract `useUsageData` hook

- Create `client/src/hooks/useUsageData.ts` with the contract in §7.
- Host's two `useEffect`s collapse into hook calls.
- The host owns `tab` and `month` local state plus the `useEffect(() => loadTab(tab), [tab, loadTab])` wiring.
- **Done when:** the host's body is mostly: state declarations + hook call + return JSX; fetch behaviour unchanged; routing-filter and IEE-filter refetch semantics preserved.

### Chunk 5 — Extract `OverviewTab`, `AgentsTab`, `ModelsTab`, `RunsTab`, `IeeTab`

- Create one file per tab under `client/src/components/usage/tabs/`.
- Host dispatches to each component with the props in §8.
- `RoutingTab` + `RequestDetailDrawer` remain inline in `UsagePage.tsx` for this chunk; they move in Chunk 6.
- **Done when:** all five tabs render identically; loading shimmers, empty-state copy, footer totals all preserved.

### Chunk 6 — Extract `RoutingTab` and its internal split

- Move `RoutingTab` to `tabs/RoutingTab.tsx` first as a thin orchestrator.
- Split out `RoutingAnomalies.tsx`, `RoutingDistribution.tsx`, `RoutingFilters.tsx`, `RoutingLogTable.tsx`, `RequestDetailDrawer.tsx` per §5.
- The orchestrator becomes a ~40-line layout file.
- **Done when:** every routing tab feature works: anomaly cards bands (5/15 / 10/25), four distribution bars, filter clear-all, request row click toggles drawer, "Load more" appends to existing log, drawer fallback-chain timeline renders dots and errors.

### Chunk 7 — Final cleanup and verify

- Confirm host is 150–200 LOC: imports, params + state, `useUsageData` call, return JSX composing chrome + tabs.
- Confirm `embedded` prop still hides the header-title block.
- Run lint + typecheck + build:client + `npx vitest run client/src/components/usage/__tests__/format.test.ts`.
- **Byte-for-byte verification of the §2 invariant** (Tailwind class strings, SVG path data, colour bands, shimmer animation timings): for each extracted component, the implementer copy-pastes the JSX (including `className=` strings) from `UsagePage.tsx` verbatim into the new file. Before declaring the chunk done, the implementer eyeballs the diff between the original block and the extracted component to confirm no class string was reformatted, abbreviated, or rewritten — and renders both the standalone usage page and the embedded subaccount-detail usage tab side-by-side against a pre-refactor screenshot of the same view to catch any visual drift.
- Manual smoke: standalone `/admin/subaccounts/:id/usage` and embedded usage tab inside `AdminSubaccountDetailPage` both render identically; month picker works; all six tabs render; routing filters + Load-more work; IEE filters work.

## 11. Deferred Items

- **Consolidate `formatCents` / `formatTokens` with `client/src/lib/formatMoney.ts`.** The two could share a helper; deferring because the call surface here uses a few subtle conventions (`'—'` for nullish, sub-$1.00 padding, etc.) and verifying drift across all current consumers is unrelated to the LOC pressure. Reason: scope discipline.
- **Centralise tab-bar primitive shared with `AdminSubaccountDetailPage`.** Both pages render almost-identical tab bars. Defer until a third page needs the same primitive. Reason: premature abstraction otherwise.
- **Replace inline shimmer string with a reusable `<Shimmer>` atom.** This refactor exports the shimmer string as `SHIMMER_CLASS` from `constants.ts` (so every extracted tab uses the same value), but does NOT introduce a `<Shimmer>` component atom — callers still build divs and apply the class string themselves, exactly as today. A future refactor can extract the small `<Shimmer width height ...>` atom; not in scope here.
- **Move `RoutingFilters` to controlled-via-URL filters.** Would let users bookmark filtered views. Out of scope; product decision needed first.

## 12. Self-consistency check

- `embedded` prop hides only the title block — preserved.
- `monthLabel(month)` and `nextMonth(month)` clamp semantics — preserved.
- `tabLoading` is shared across routing and IEE tabs because at most one is active — preserved (do NOT split into separate loading flags).
- Routing log cursor pagination: `nextCursor` + `nextCursorId` pair passed together; on load-more, `cursorId` is non-null when `cursor` is — preserved.
- Routing `setSelectedRequest(null)` is called from inside `loadTab('routing')` to clear drawer when tab is re-fetched — preserved (handled by `useUsageData` after a routing fetch).
- IEE `from` / `to` are derived from the page-level `month` at fetch time; the IEE tab does not own a separate month picker — preserved.
- The `tab === 'routing'` branch in `loadTab` does two parallel fetches (`distribution` + `log`); the IEE branch is a single fetch returning `rows` and `summary` — preserved.
- Anomaly thresholds: fallback 5/15, escalation 10/25; "Economy Usage" anomaly card uses a special slate-50 colour band regardless of value (today's lines 977–979) — preserved.

## 13. Acceptance criteria

- `git diff client/src/pages/UsagePage.tsx` shows the host shrunk to ≤ 220 LOC; the file contains imports, the component body, `useState` for `month` / `tab`, the `useUsageData` hook call, the tab-change effect, and the return JSX (composition of chrome + tab body).
- The host still default-exports a `UsagePage` component that accepts `{ user: User; embedded?: boolean }` — same signature as today, so `App.tsx` and `AdminSubaccountDetailPage.tsx` import sites compile unchanged.
- New folder `client/src/components/usage/` exists with the file listing in §5. After Chunk 7, the directory diff against §5 contains no extras and no missing files.
- New hook `client/src/hooks/useUsageData.ts` exists per §7.
- New test file `client/src/components/usage/__tests__/format.test.ts` exists with the cases in §9.
- `npm run lint`, `npm run typecheck`, `npm run build:client`, `npx vitest run client/src/components/usage/__tests__/format.test.ts` all pass.
- Manual smoke through:
  - Standalone usage page + embedded inside subaccount-detail "Usage & Costs" tab — both render identically.
  - Month navigator: previous goes back; next is disabled at current month; selecting a past month re-fetches summary, daily, and current tab data.
  - All 6 tabs: shimmer loading, then populated data; empty states render correct copy.
  - Routing tab: anomaly cards show correct band colours; filters can be set + cleared; selecting a request opens the drawer; Load-more appends.
  - IEE tab: filters update fetch params; summary cards reflect totals; runs table renders status badges and failure reasons.

## 14. Open questions

- None. The decomposition is mechanical and the existing `pulse/` and `clientpulse/` precedents answer every "where does X go" question.
