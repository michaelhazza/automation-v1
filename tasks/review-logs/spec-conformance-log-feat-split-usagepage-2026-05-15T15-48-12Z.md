# Spec Conformance Log

**Spec:** `tasks/builds/feat-split-usagepage/spec.md`
**Spec commit at check:** working-tree (uncommitted at time of check; current HEAD `fe541167`)
**Branch:** `claude/synthetos-personal-assistant-0kaIM`
**Base:** `b9794194` (merge-base with main)
**Scope:** all spec (single-phase frontend refactor, completed implementation; caller confirmed via invocation)
**Changed-code set:** 24 files (1 modified `UsagePage.tsx` host + 23 new files under `client/src/components/usage/` and `client/src/hooks/useUsageData.ts`)
**Run at:** 2026-05-15T15:48:12Z
**Commit at finish:** `960bc282`

---

## Summary

- Requirements extracted:     34
- PASS:                       34
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** CONFORMANT

---

## Requirements extracted (full checklist)

### §5 file inventory (target structure)

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1  | `client/src/components/usage/types.ts` exists with 11 interfaces + `Tab` + `FallbackChainEntry` + `RoutingFilters` + `IeeFilters` | PASS | `types.ts` lines 1–156 — all 11 interfaces present, `Tab` (135), `FallbackChainEntry` (137), `RoutingFilters` (139–149), `IeeFilters` (151–156) |
| 2  | `client/src/components/usage/format.ts` exists with 7 helpers | PASS | `format.ts` lines 3–48 — `formatCents`, `formatTokens`, `monthLabel`, `prevMonth`, `nextMonth`, `parseFallbackChain`, `anomalyColor` |
| 3  | `client/src/components/usage/constants.ts` exists with 4 colour maps + `SHIMMER_CLASS` | PASS | `constants.ts` lines 1–10 — `ANOMALY_THRESHOLDS`, `TIER_COLORS`, `REASON_COLORS`, `STATUS_COLORS`, `SHIMMER_CLASS` (byte-for-byte vs spec quote) |
| 4  | `client/src/components/usage/__tests__/format.test.ts` exists with cases per §9 table | PASS | `format.test.ts` lines 5–161 — `describe` per helper; 30 tests passing |
| 5  | `MonthNavigator.tsx` exists | PASS | file present, props match §8.1 |
| 6  | `SummaryCards.tsx` exists | PASS | file present, props match §8.2 |
| 7  | `BudgetBars.tsx` exists | PASS | file present, props match §8.3 |
| 8  | `TabBar.tsx` exists | PASS | file present, props match §8.5 |
| 9  | `atoms/BudgetBar.tsx` exists | PASS | preserved verbatim from host |
| 10 | `atoms/SummaryCard.tsx` exists | PASS | file present |
| 11 | `atoms/DistributionBar.tsx` exists | PASS | file present |
| 12 | `atoms/Badge.tsx` exists | PASS | file present |
| 13 | `atoms/FilterSelect.tsx` exists | PASS | file present |
| 14 | `atoms/FilterText.tsx` exists | PASS | file present |
| 15 | `atoms/DetailField.tsx` exists | PASS | file present |
| 16 | `tabs/OverviewTab.tsx` exists | PASS | file present, props match §8.6 |
| 17 | `tabs/AgentsTab.tsx` exists | PASS | file present, props match §8.7 |
| 18 | `tabs/ModelsTab.tsx` exists | PASS | file present, props match §8.7 |
| 19 | `tabs/RunsTab.tsx` exists | PASS | file present, props match §8.7 |
| 20 | `tabs/IeeTab.tsx` exists | PASS | file present; takes `loading` (not `tabLoading`) per §8.9 |
| 21 | `tabs/RoutingTab.tsx` exists | PASS | file present, props match §8.8 |
| 22 | `tabs/RoutingAnomalies.tsx` exists | PASS | file present; Economy Usage card uses slate band regardless of value (§12) |
| 23 | `tabs/RoutingDistribution.tsx` exists | PASS | file present; renders 4 DistributionBars + latency summary |
| 24 | `tabs/RoutingFilters.tsx` exists | PASS | file present; props `{ dist, filters, onFilterChange }` per §8.8 |
| 25 | `tabs/RoutingLogTable.tsx` exists | PASS | file present; props match §8.8 sub-component contract |
| 26 | `tabs/RequestDetailDrawer.tsx` exists | PASS | file present; `{ request, onClose }` per §8.8 |
| 27 | `client/src/hooks/useUsageData.ts` exists per §7 contract | PASS | hook returns shape exactly per §7 (lines 118–147) |

### §7 hook behaviour

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 28 | Summary+daily effect deps `[subaccountId, month]`; parallel `Promise.all` over the two endpoints | PASS | `useUsageData.ts` lines 42–52 |
| 29 | `loadTab` deps `[subaccountId, month, routingFilters, ieeFilters]` and 5-branch switch (agents/models/runs/routing/iee) | PASS | lines 54–103 |
| 30 | `selectRequest`/`setSelectedRequest` cleared inside routing branch of `loadTab` (§12 invariant) | PASS | line 77 — `setSelectedRequest(null)` after fetch |
| 31 | Shared `tabLoading` across routing/IEE (§12 invariant — do NOT split) | PASS | single `tabLoading` state at line 25; exposed under both `routing.tabLoading` (133) and `iee.tabLoading` (139) — same underlying value |
| 32 | IEE `from`/`to` derived from page-level `month` at fetch time (§12 invariant) | PASS | lines 82–85 |

### §8/§9 explicit contract changes

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 33 | `<IeeTab>` prop renamed `tabLoading` → `loading` (§8.9) | PASS | `IeeTab.tsx` line 8 `loading: boolean`; host line 123 `loading={data.iee.tabLoading}`; no `tabLoading` reference in IeeTab.tsx |
| 34 | `<RoutingTab>` no longer takes `shimmer` prop (§9 final note) | PASS | grep on RoutingTab.tsx for `shimmer` returns no hits; `SHIMMER_CLASS` imported directly from `constants` inside RoutingTab and atoms that need it |

### §13 acceptance criteria

- Host shrunk to ≤ 220 LOC — **PASS** (127 LOC).
- Host still default-exports `UsagePage({ user, embedded? })` — **PASS** (line 21).
- `App.tsx` and `AdminSubaccountDetailPage.tsx` import sites compile unchanged — **PASS** (both sites read `import('./pages/UsagePage')` / `import('./UsagePage')` and pass `{ user, embedded }`).
- `npm run lint` — **PASS** (0 errors, 902 pre-existing warnings unrelated to this change).
- `npm run typecheck` — **PASS** (clean).
- `npm run build:client` — **PASS** (builds; `UsagePage-*.js` chunk emitted at 43.95 kB).
- `npx vitest run client/src/components/usage/__tests__/format.test.ts` — **PASS** (30/30 tests).

---

## Mechanical fixes applied

None. The implementation satisfies every named requirement on first read.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

None.

---

## Files modified by this run

None.

---

## Next step

CONFORMANT — no gaps, proceed to `pr-reviewer`.

Notes for the reviewer:

- The agents/models/runs tabs read `data.routing.tabLoading` rather than a hypothetical `data.tabLoading`. This is intentional and matches §7: routing and IEE share a single underlying `tabLoading` state, exposed under both `routing.tabLoading` and `iee.tabLoading` for ergonomic scoping. Same flag; different access paths.
- The `IeeTab` prop rename (`tabLoading` → `loading`) per §8.9 is the only contract change vs. today; verified in IeeTab.tsx and at the host call site (UsagePage.tsx line 123).
- `<RoutingTab>` no longer takes `shimmer`; atoms now import `SHIMMER_CLASS` from `constants.ts` directly (verified in `AgentsTab`, `ModelsTab`, `RunsTab`, `SummaryCards`, `RoutingTab`, `RoutingLogTable`, host).
- `RoutingFilters` and `IeeFilters` types per §8.0 live in `types.ts` and are imported by hook, host, and the routing/IEE sub-components.
- Host LOC = 127, well inside the §13 ≤ 220 ceiling (spec target 150–200).
