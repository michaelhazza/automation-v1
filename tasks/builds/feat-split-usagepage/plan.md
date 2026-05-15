# Plan — feat-split-usagepage

**Spec:** `tasks/builds/feat-split-usagepage/spec.md`
**Source file:** `client/src/pages/UsagePage.tsx` (1,280 LOC)
**Target host LOC:** ≤ 220 (target 150–200)

## Chunk 1 — `types.ts`, `format.ts`, `constants.ts`

**Files to create:**
- `client/src/components/usage/types.ts` — all 11 interfaces (`UsageSummary`, `CostAggregate`, `WorkspaceLimits`, `AgentUsageRow`, `ModelUsageRow`, `RunCostRow`, `DayBucket`, `RoutingDistribution`, `RoutingLogItem`, `IeeUsageRow`, `IeeUsageSummary`) + `Tab` union + `FallbackChainEntry` + new `RoutingFilters` and `IeeFilters` named types per spec §8.0.
- `client/src/components/usage/format.ts` — 7 pure helpers (`formatCents`, `formatTokens`, `monthLabel`, `prevMonth`, `nextMonth`, `parseFallbackChain`, `anomalyColor`).
- `client/src/components/usage/constants.ts` — `ANOMALY_THRESHOLDS`, `TIER_COLORS`, `REASON_COLORS`, `STATUS_COLORS`, `SHIMMER_CLASS` (byte-for-byte from host line 354).
- `client/src/components/usage/__tests__/format.test.ts` — Vitest covering edge cases per spec §9 table.

**Files to modify:** Host removes those declarations and imports them from the new modules.

## Chunk 2 — Atoms

**Files to create under `client/src/components/usage/atoms/`:**
- `BudgetBar.tsx` (from host ~165-191)
- `SummaryCard.tsx` (from host ~862-870)
- `DistributionBar.tsx` (from host ~905-932)
- `Badge.tsx` (from host ~899-903)
- `FilterSelect.tsx` (from host ~1164-1175)
- `FilterText.tsx` (from host ~1177-1188)
- `DetailField.tsx` (from host ~1273-1280)

Host keeps the imports.

## Chunk 3 — Chrome

**Files to create:**
- `client/src/components/usage/MonthNavigator.tsx` — props `{ month, thisMonth, onPrev, onNext }`. Absorbs `ChevLeft` + `ChevRight` SVGs inline.
- `client/src/components/usage/SummaryCards.tsx` — props `{ summary, loading }`. The 4-card grid (host ~392-453).
- `client/src/components/usage/BudgetBars.tsx` — props `{ monthlySpent, todaySpent, monthLimit, dailyLimit }`. Returns null when both limits null.
- `client/src/components/usage/TabBar.tsx` — props `{ active, onChange }`. Internal tabs array.

## Chunk 4 — `useUsageData` hook

**Files to create:**
- `client/src/hooks/useUsageData.ts` — owns summary/daily fetch effect, per-tab state, `loadTab(t)`, `setRoutingFilters`, `setIeeFilters`, `routingLoadMore()`, `selectRequest()`. Returns shape per spec §7.

**Files to modify:** Host replaces ~15 useState + 2 useEffect blocks with one hook call.

## Chunk 5 — 5 simple tabs (Overview, Agents, Models, Runs, IEE)

**Files to create under `client/src/components/usage/tabs/`:**
- `OverviewTab.tsx` — props `{ month, summary }`.
- `AgentsTab.tsx` — props `{ rows, loading }`.
- `ModelsTab.tsx` — props `{ rows, loading }`.
- `RunsTab.tsx` — props `{ rows, loading, subaccountId }`.
- `IeeTab.tsx` — props `{ rows, summary, loading, filters, onFilterChange }`. Note: renames `tabLoading` prop to `loading`.

Host replaces the inline tab JSX with these component invocations.

## Chunk 6 — RoutingTab + internal split

**Files to create under `client/src/components/usage/tabs/`:**
- `RoutingTab.tsx` — orchestrator per spec §8.8. Composes the 5 sub-components.
- `RoutingAnomalies.tsx` — 3 anomaly cards.
- `RoutingDistribution.tsx` — 4 DistributionBars + latency summary.
- `RoutingFilters.tsx` — filter row.
- `RoutingLogTable.tsx` — table + Load-more.
- `RequestDetailDrawer.tsx` — drawer.

Note: `<RoutingTab>` no longer takes a `shimmer` prop — atoms import `SHIMMER_CLASS` from constants directly.

## Chunk 7 — Cleanup + verify

- Remove unused imports from host.
- Confirm host ≤ 220 LOC.
- Run lint, typecheck, build:client, `npx vitest run client/src/components/usage/__tests__/format.test.ts`.

## Notes

- Preserve every Tailwind class, SVG path, and behavioural detail verbatim.
- Cursor pagination (`nextCursor` + `nextCursorId` pair) preserved.
- Shared `tabLoading` across routing/IEE preserved (single flag — at most one tab active at a time).
- `embedded` prop hides only the title block.
- The `IeeTab` prop renames `tabLoading` to `loading` — this is the only contract change.
- No `.js` suffixes on relative imports (matches client/src/components/ convention).
