# Spec Review Log — Iteration 1 — feat-split-usagepage

**Timestamp:** 2026-05-14T13-25-50Z
**Spec:** `tasks/builds/feat-split-usagepage/spec.md`
**Spec-context staleness:** GREEN (3 days)
**Codex output captured:** 22 findings

---

## Classification + adjudication

### Codex findings

**#1 — §5/§10 ChevLeft/ChevRight placement contradiction.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: Chunk 2 now says ChevLeft/ChevRight stay in `UsagePage.tsx` until Chunk 3; Chunk 3 says `MonthNavigator.tsx` absorbs them with byte-for-byte SVG.

**#2 — "12 interfaces + Tab union" mismatch.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §4 and §5 now state "11 interfaces + `Tab` union + `FallbackChainEntry` type alias". Chunk 1 updated.

**#3 (critical) — §7 hook return missing `nextCursorId`.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §7 routing block now lists `nextCursorId`. §6 tree and §8.8 sub-component prop for `<RoutingLogTable>` also updated to carry `nextCursorId`.

**#4 — `routing.selected` vs `selectedRequest` naming drift.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §7 standardised on `selectedRequest`. Added note that there's no `routing.selected`.

**#5 — §6 tree uses `selected`/`onSelect`, §8.8 uses `selectedRequest`/`onSelectRequest`.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §6 tree updated to `selectedRequest`/`onSelectRequest`.

**#6 — §8.8 `<RoutingLogTable>` has both `loading` and `tabLoading`.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §8.8 expanded into a full prop contract; only `tabLoading` remains (matching today's single shared flag).

**#7 — `<RoutingLogTable>` shorthand untyped props.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §8.8 sub-components now have fully spelled-out props with TypeScript types.

**#8 — IEE filter keys `types`/`statuses` plural assumed to be wrong.**
- Classification: mechanical
- Disposition: REJECT
- Reason: Verified against current code (UsagePage.tsx lines 274–280, 335–338). Filter state and query-param keys are byte-identical (`types`, `statuses`, `minCostCents`, `search`). Codex misread; spec is already correct.

**#9 — `setRoutingFilters`/`setIeeFilters` update-loop concern.**
- Classification: directional (ambiguous, treated as directional)
- Signal match: "introduce a new cross-cutting contract" (this is over-specification for a refactor)
- Disposition: AUTO-REJECT (framing)
- Reason: Pure refactor preserving behaviour. Today's filter setters are simple setState; the spec already mandates "Spec preserves the current behaviour". Adding a defensive contract over a simple setter is over-engineering and conflicts with `pre-production` + "prefer existing primitives" framing.

**#10 — `[subaccountId, month]` effect deps not explicit.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §7 now states the effect dependencies explicitly as `[subaccountId, month]`.

**#11 — Initial-tab default-load behaviour unstated.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §7 now states `tab` initialises to `'overview'` and the effect loads on mount.

**#12 — Chunk 4 hook extraction creates dependency bug.**
- Classification: mechanical (but on second look) → RECLASSIFIED → REJECT
- Reason: Codex misread the chunk plan. Chunk 4 moves the state INTO the hook; the host destructures the same names from the hook return. Inline JSX continues to read the same names because destructuring exposes them at the same scope. No temporary aliases are needed — this is just standard React hook extraction.

**#13 — `RequestDetailDrawer` extraction timing.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: Chunk 5 now explicitly says RoutingTab + RequestDetailDrawer stay inline until Chunk 6.

**#14 — Acceptance criteria missing default export + `embedded` prop check.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §13 now requires verifying the default export and `{ user, embedded? }` signature unchanged.

**#15 (important) — `isCurrent` vs `thisMonth` MonthNavigator prop contradiction.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §6 tree updated to `thisMonth` (matching §8.1).

**#16 — `nextMonth` test time-injection unstated.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §9 test-table row for `nextMonth` now specifies `vi.useFakeTimers()` + `vi.setSystemTime(new Date('2026-05-14T00:00:00Z'))`.

**#17 — "one assertion per helper" wording.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §9 reformatted as a table of "one focused `describe` block per helper" with the specific cases enumerated.

**#18 (important) — §3 says "No new primitives invented" contradicts §5 new files.**
- Classification: mechanical (wording drift)
- Disposition: ACCEPT
- Fix: §3 now clarifies "No new cross-codebase primitives" and explicitly tags the new files as "feature-local components or hook".

**#19 — Chunk 3 missing SVG byte-preservation invariant.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: Chunk 3 now states the chevron SVG polyline points must be copied verbatim.

**#20 — `setSelectedRequest(null)` "after" routing fetch ambiguous timing.**
- Classification: mechanical
- Disposition: REJECT
- Reason: Verified against current code (line 319). `setSelectedRequest(null)` runs AFTER `await Promise.all` resolves and AFTER both setters fire. Spec phrasing "after a routing fetch" already matches today. No ambiguity worth resolving.

**#21 — Missing final inventory diff.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §13 now requires "no extras and no missing files" against §5 after Chunk 7.

**#22 — "No open questions" wording.**
- Classification: rejected (meta-finding subsumed by #3/#15/#16 fixes).
- Disposition: REJECT
- Reason: All concrete underlying gaps are addressed by accepting #3, #15, #16 above. §14 "None." correctly survives.

### Rubric findings (this agent's own pass)

**R1 — LOC drift: spec says 1,284 LOC, file is 1,280 LOC.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §1 updated to 1,280 LOC.

**R2 — Spec-authoring checklist N/A sections not declared inline.**
- Classification: mechanical
- Disposition: ACCEPT
- Fix: §3 now adds a one-line N/A declaration for checklist sections 0, 4, 5, 10.

---

## Iteration 1 counts

- Mechanical findings accepted:  16  (Codex #1, #2, #3, #4, #5, #6, #7, #10, #11, #13, #14, #15, #16, #17, #18, #19, #21 + Rubric R1, R2 = 19; minus duplicates among the ones rolled into single edits, but counting them as discrete adjudications: 17 Codex + 2 rubric = 19. For the stopping-heuristic numerator the field is **mechanical findings adjudicated as ACCEPT**: 19.)
- Mechanical findings rejected:  3  (Codex #8, #20, #22)
- Directional findings:           0
- Ambiguous findings:             0 (reduced — #9 routed as directional; #12 reclassified to reject)
- Reclassified → directional:    1  (#9)
- Reclassified → rejected:       1  (#12)
- Autonomous decisions (directional/ambiguous): 1 (#9 → AUTO-REJECT framing)
  - AUTO-REJECT (framing):    1
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0

**Stopping-heuristic relevant counts:**
- `mechanical_accepted = 19`
- `mechanical_rejected = 3`
- `directional_or_ambiguous = 1`

## Spec commit after iteration

Working tree (spec was uncommitted at start; user has explicit no-auto-commit preference for non-review-agent-managed files; but this IS a review agent, so the auto-commit-and-push rule from Step 8b applies).
