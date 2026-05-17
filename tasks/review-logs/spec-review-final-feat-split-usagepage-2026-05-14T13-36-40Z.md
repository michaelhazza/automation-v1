# Spec Review Final Report

**Spec:** `tasks/builds/feat-split-usagepage/spec.md`
**Spec commit at start:** uncommitted (working tree at session start)
**Spec commit at finish:** `1026651158996dbb7bbf6ff693ba5555e955a779`
**Spec-context commit:** `645a2462e90a722a170ab5bed9718ddab17d6f15`
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 22 | 2 | 19 | 3 | 1 | 0 | 0 (1 routed to tasks/todo.md) |
| 2 | 6 | 0 | 6 | 0 | 0 | 0 | 0 |
| 3 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |

---

## Mechanical changes applied (across all iterations)

### §1 Goals
- LOC corrected from 1,284 to 1,280 (matches actual `UsagePage.tsx` size).

### §3 Existing primitives this spec reuses
- `RunActivityChart` row clarified: the daily array is passed via the `data` prop (`<RunActivityChart data={daily} />`).
- "No new primitives" reworded to "No new cross-codebase primitives" — new files are feature-local components or hook, not shared abstractions.
- Added a one-line declaration that spec-authoring checklist sections 0, 4, 5, 10 are N/A for this frontend-only refactor.

### §4 Current structure
- Type-count fixed: "11 interfaces + `Tab` union + `FallbackChainEntry` type alias" (was "12 interfaces + Tab union").

### §5 Target structure
- `types.ts` now lists 11 interfaces + `Tab` union + `FallbackChainEntry` + `RoutingFilters` + `IeeFilters`.
- `__tests__/format.test.ts` added to the tree (was referenced in §9/§13 but missing from §5).
- `constants.ts` row now lists `SHIMMER_CLASS`.

### §6 Component tree
- `<MonthNavigator>` props corrected from `isCurrent` to `thisMonth` (matches §8.1).
- `<RunActivityChart>` shown with concrete prop `data={daily}`.
- `<RoutingTab>` props aligned to §8.8: `selectedRequest`/`onSelectRequest` (was `selected`/`onSelect`), `tabLoading` (was `loading`), added `nextCursorId`.
- `<RoutingLogTable>` sub-component aligned to §8.8: `selectedRequest`/`onSelectRequest`/`tabLoading`/`nextCursorId`.
- `<RequestDetailDrawer>` render condition reworded from `selected` to `selectedRequest`.
- `<BudgetBars>` prop names tightened to `monthlySpent`/`todaySpent` (was `monthly`/`today`).

### §7 useUsageData hook contract
- Effect dependencies explicitly listed as `[subaccountId, month]`.
- Hook routing return now lists `nextCursorId` (was missing).
- Hook routing return uses `selectedRequest` (was inconsistently `selected`).
- Added explicit note about initial-mount behaviour: `tab` defaults to `'overview'`, effect loads it on mount.
- Disambiguation line: "There is no `routing.selected` field — that name was a placeholder in earlier drafts."

### §8 Prop contracts
- New §8.0 "Shared filter types" defining `RoutingFilters` (9 optional string keys matching today's `<FilterSelect>` / `<FilterText>` rows) and `IeeFilters` (4 required string keys).
- §8.1 `<MonthNavigator>` clarifies that `thisMonth` and `nextMonth`'s internal `new Date()` derivation are intentionally independent (preserves today's behaviour, including the cross-midnight-month-end edge case).
- §8.8 `<RoutingTab>` and `<RoutingFilters>` props use named `RoutingFilters` type.
- §8.8 `<RoutingLogTable>` fully spelled out with TypeScript types; duplicated `loading`/`tabLoading` resolved to single `tabLoading`.
- §8.9 `<IeeTab>` uses named `IeeFilters` type and `onFilterChange(next: IeeFilters): void`.

### §9 Pure-helper extraction
- Reformatted "one assertion per helper" into a per-helper case table with explicit edge cases.
- `nextMonth` row specifies `vi.useFakeTimers()` + `vi.setSystemTime(new Date('2026-05-14T00:00:00Z'))` to control time.
- `constants.ts` paragraph now exports `SHIMMER_CLASS` (the host-local `shimmer` string at UsagePage.tsx line 354) byte-for-byte and removes the prop-drilling of `shimmer` into `<RoutingTab>`.

### §10 Migration plan
- Chunk 1 updated: extracts `RoutingFilters` + `IeeFilters` aliases and `SHIMMER_CLASS` constant alongside the existing 11 interfaces and `Tab` union.
- Chunk 2 clarifies `ChevLeft`/`ChevRight` stay in `UsagePage.tsx` until Chunk 3.
- Chunk 3 mandates byte-for-byte chevron SVG polyline preservation.
- Chunk 5 explicitly notes `RoutingTab` + `RequestDetailDrawer` remain inline until Chunk 6.
- Chunk 7 adds a concrete byte-for-byte verification step: copy-paste-and-eyeball-diff plus side-by-side rendering against a pre-refactor screenshot.

### §11 Deferred Items
- `<Shimmer>` atom entry clarified: THIS refactor exports the class string as a constant, but does NOT introduce a component atom.

### §13 Acceptance criteria
- Added requirement to verify the host still default-exports `UsagePage` with the `{ user: User; embedded?: boolean }` signature.
- Added requirement that the §5 directory diff has "no extras and no missing files" after Chunk 7.

---

## Rejected findings

| # | Section | Codex finding | Reason for rejection |
|---|----|----|----|
| Iter 1 #8 | §8.9 | IEE filter keys may be wrong | Verified against UsagePage.tsx lines 274–280, 335–338: spec already matches today's filter keys byte-for-byte. |
| Iter 1 #12 | Chunk 4 | Hook extraction creates dependency bug | Codex misread; standard React hook destructure preserves the same variable names at the host scope. No alias layer needed. |
| Iter 1 #20 | §12 | `setSelectedRequest(null)` timing ambiguous | Verified UsagePage.tsx line 319: clear runs AFTER `await Promise.all` resolves AND AFTER both setters fire. Spec phrasing "after a routing fetch" is accurate. |
| Iter 1 #22 | §14 | "No open questions" wording | Meta-finding subsumed by the concrete fixes (#3, #15, #16); "None." is correct after those land. |

---

## Directional and ambiguous findings (autonomously decided)

| Iter | Finding | Classification | Decision | Rationale |
|---|---|---|---|---|
| 1 | Codex #9: `setRoutingFilters` / `setIeeFilters` update-loop contract | directional (ambiguous → directional for safety) | AUTO-REJECT (framing) | Pure refactor preserving today's plain `setState` behaviour. Adding a defensive contract over a simple setter is over-specification for pre-production / rapid-evolution framing. Routed to `tasks/todo.md` under `## Deferred spec decisions — feat-split-usagepage (2026-05-14)`. |

No AUTO-DECIDED (best-judgment) items. All directional findings rejected against the framing assumptions.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across three iterations. Every directional finding that surfaced was auto-resolved against the spec-context framing assumptions. The two-consecutive-mechanical-only-rounds exit condition fired at iteration 3, indicating the spec has converged on its current framing.

However:

- The review did not re-verify the framing assumptions. This is a pure-refactor spec authored under a "rapid evolution, no live users, no UX change" framing. If the product context has shifted since the spec was authored on 2026-05-14, re-read the spec's §1 Goals and §2 Non-goals sections yourself before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Chunk sequencing is fixed by the spec; whether to start now or queue behind another sprint is your call.

**Recommended next step:** read §1, §2, §11, §13 one more time, confirm the headline goals match your current intent, then proceed to plan-breakdown via `architect`.
