# Iteration 2 — feat-split-layout spec review

**Spec:** `tasks/builds/feat-split-layout/spec.md`
**Codex output:** `tasks/review-logs/_codex_feat-split-layout_iter2_2026-05-14T13-51-36Z.txt`

## Codex findings

### Finding 1 — important — accepted (mechanical)
- Section: §6, §7, §8.1, §8.5
- Description: `subaccounts` referenced as a prop on `<IconRail>` and `<NewBriefModal>` but no hook in §7 owned the subaccount list / fetch.
- Classification: mechanical (real ownership gap).
- Fix applied: §7.1 `useLayoutIdentity` now explicitly owns the subaccounts list and the existing org-scoped refetch effect (today's lines 380–391); returns `subaccounts: ClientOption[]` and carries the eslint-disable rationale comments verbatim.

### Finding 2 — important — accepted (mechanical)
- Section: §6 tree vs §8.5
- Description: §6 tree passes `onCreated` to NewBriefModal but §8.5 contract uses `onSubmitted`.
- Classification: mechanical (naming alignment).
- Fix applied: §6 tree caption now uses `onSubmitted`.

### Finding 3 — minor — accepted (mechanical clarification)
- Section: §4, §6, §7
- Description: Org-picker outside-click listener has no assigned owner in target; §6 says "all side effects move into hooks" but `OrgPicker` may stay inline.
- Classification: mechanical (declare local-UI ownership).
- Fix applied: §6 host description now carries an explicit exception — the org-picker outside-click listener is local UI state for the picker popover and stays inside `IconRail` (or `OrgPicker` if extracted). The rule is now "all CROSS-COMPONENT side effects move into hooks".

### Finding 4 — nit — accepted (mechanical)
- Section: §2, §9
- Description: "covered by visual smoke" was loose phrasing for the untested helpers.
- Classification: mechanical (replace loose phrasing).
- Fix applied: §9 now says `avatarColor` and `toInitials` are intentionally left untested by this spec because they are trivial display helpers — with one-sentence description of each so a future reader understands why.

## Rubric findings (my pass)

None new. The iter-1 fixes held and didn't introduce contradictions. The §6 tree caption + §8.1 IconRail contract align (both list `user`, `identity`, `orgs`, `subaccounts`, `canCreateClient`, `onCreateClient` after iter-1 R2 + iter-2 F1).

## Iteration 2 Summary

- Mechanical findings accepted:  4 (4 Codex)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (pending Step 8b)
