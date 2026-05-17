# Spec Review Log — Iteration 2 — feat-split-usagepage

**Timestamp:** 2026-05-14T13-33-01Z
**Spec:** `tasks/builds/feat-split-usagepage/spec.md`
**Codex output captured:** 6 findings

---

## Classification + adjudication

### Codex findings

**#1 (important) — `__tests__/format.test.ts` missing from §5 tree but required in §9/§13.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §5 tree now lists the `__tests__/format.test.ts` file.

**#2 (important) — §3 says `RunActivityChart` takes `daily: DayBucket[]`; tree shows `<RunActivityChart data />`.**
- Classification: mechanical (verified against UsagePage.tsx line 477: actual prop is `data`)
- Disposition: ACCEPT
- Fix: §3 reworded to clarify the daily array is passed via the `data` prop. §6 tree now reads `<RunActivityChart data={daily} />`.

**#3 (important) — `routingFilters` typed as `Record<string, string>` loses key information.**
- Classification: mechanical (matches existing IEE pattern that names its filter shape inline)
- Disposition: ACCEPT
- Fix: Added new §8.0 "Shared filter types" naming `RoutingFilters` and `IeeFilters` aliases. §8.8 routing props and §8.9 IEE props use the named types. Chunk 1 explicitly adds these two aliases to `types.ts`. Behaviour unchanged.

**#4 (minor) — `IeeTab` `onFilterChange(next): void` has untyped `next`.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §8.9 now reads `onFilterChange(next: IeeFilters): void`.

**#5 (minor) — `thisMonth` (host-derived) and `nextMonth(ym)` (helper-internal) both call `new Date()` independently.**
- Classification: mechanical (clarifying intent of a preserved behaviour)
- Disposition: ACCEPT
- Fix: §8.1 now explicitly notes the two derivations are independent today and the spec preserves that. Includes an explicit "do NOT plumb `thisMonth` into `nextMonth`" line to prevent silent behaviour change.

**#6 (minor) — "Byte-for-byte" preservation invariant lacks a concrete verification step.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: Chunk 7 now includes a concrete copy-paste-and-eyeball-diff verification step plus side-by-side rendering against a pre-refactor screenshot.

### Rubric findings (this agent's own pass)

None this iteration. The spec's structural issues were addressed in iteration 1; this iteration is fine-grained type tightening and clarifying preserved-behaviour invariants.

---

## Iteration 2 counts

- Mechanical findings accepted:  6  (Codex #1–#6)
- Mechanical findings rejected:  0
- Directional findings:           0
- Ambiguous findings:             0
- Reclassified → directional:    0
- Autonomous decisions:           0

**Stopping-heuristic relevant counts:**
- `mechanical_accepted = 6`
- `mechanical_rejected = 0`
- `directional_or_ambiguous = 0`

Iteration 2 is a clean mechanical-only round. If iteration 3 is also mechanical-only OR produces nothing, the loop exits.

## Spec commit after iteration

(Will be filled after Step 8b commit.)
