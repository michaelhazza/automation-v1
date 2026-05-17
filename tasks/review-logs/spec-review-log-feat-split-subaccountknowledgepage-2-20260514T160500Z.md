# Spec Review Iteration 2 Log — feat-split-subaccountknowledgepage

## Codex findings (8) — classification

- C2.1 mechanical — "Three real endpoints" but lists 4 → applied (changed to "Three GET endpoints feed the page, plus the mutating endpoints")
- C2.2 mechanical — §7 contradicts itself on "flips activeTab first" vs "cross-tab case cannot happen" → applied (rewrote to clarify the buttons render only on the matching active tab; no cross-tab dispatch path)
- C2.3 mechanical — §8.3 prose refers to `onPromoted` but actual prop is `onPromotedToReference` + parallel-Promise.all sequence inconsistency → applied (rewrote sequence to sequential await; renamed all references)
- C2.4 mechanical — Unmount race when `onTabSwitchTo` precedes `loadInsights()` → applied (reordered sequence: mutate first, then switch tab; dropped local loadInsights() refetch because next mount re-fetches; explicitly framed as consistent with the existing §6 unmount delta)
- C2.5 mechanical — §5 `atoms/` allowance vs "only RenameReferenceModal allowed" contradiction → applied (clarified: both `RenameReferenceModal.tsx` AND `atoms/` are allowed conditional additions; neither is created speculatively)
- C2.6 mechanical — `ref` prop name collides with React's reserved `ref` → applied (renamed to `reference: Reference`)
- C2.7 mechanical — `onMutated(): void` typed but awaited → applied (changed to `Promise<void>` for `onMutated` and `onPromotedToReference`)
- C2.8 mechanical — `openCreateOnMount` consume-timing under-specified → applied (added the exact `useEffect(... [openCreateOnMount])` pattern in §8.2 with cross-reference from §8.4)

## Rubric findings — classification

- Rubric R2.1 mechanical — §6 component tree was missing `openCreateOnMount` and `onCreateConsumed` props on `<ReferencesTab>` and `<BlocksTab>` → applied
- Rubric R2.2 mechanical — §7 still contained stale "tab-switch BEFORE onMutated()" ordering language that contradicted the new §8.2 / §8.4 reorder → applied (re-synced §7 prose with §8 contracts)
- Rubric R2.3 mechanical — §10 Chunk 3 done-when said "and refetches insights" which contradicts the dropped local refetch → applied

## Counts

- mechanical_accepted: 11 (8 Codex + 3 rubric)
- mechanical_rejected: 0
- directional_or_ambiguous: 0
- reclassified: 0

## Iteration 2 Summary

- Mechanical findings accepted:  11
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
- Spec commit after iteration:   (pending commit)
