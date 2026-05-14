# Iteration 1 — feat-split-layout spec review

**Spec:** `tasks/builds/feat-split-layout/spec.md`
**Codex output:** `tasks/review-logs/_codex_feat-split-layout_iter1c_2026-05-14T13-26-14Z.txt`

## Codex findings

### Finding 1 — important — accepted (mechanical)
- Section: §1 Goals vs §2 Non-goals / §9
- Description: §1 said "each hook tests one slice" — implies hooks get tests; contradicts pure-helpers-only testing posture.
- Classification: mechanical (cleanup of sloppy verb).
- Fix applied: replaced "tests" with "owns" in §1 line 29.

### Finding 2 — important — accepted (mechanical)
- Section: §5 / §10 Chunk 4 / §13
- Description: `OrgPicker.tsx` listed as both required (§5, §13) and optional (§10 Chunk 4, §14).
- Classification: mechanical (pick one contract).
- Fix applied: §5 entry rewritten as "conditional split out of IconRail (created only if IconRail.tsx > 200 LOC after Chunk 4)"; §13 acceptance now says absence is passing when the inline path was chosen.

### Finding 3 — critical — accepted (mechanical)
- Section: §7.8 / §8.1 / §8.5
- Description: §7.8 said org state "never crosses the chrome/host boundary" but §8 requires both IconRail and NewBriefModal to receive `orgs` as props.
- Classification: mechanical (clear single source of truth).
- Fix applied: §7.8 renamed to `useOrgList(isSystemAdmin)`; states the host owns the hook and passes `orgs` down to both consumers. Added `useOrgList.ts` to §5 inventory.

### Finding 4 — important — accepted (mechanical)
- Section: §5 / §7.8 / §13
- Description: Spec said "seven hooks" but introduced `useOrgList` as an eighth.
- Classification: mechanical (count alignment, follows from Finding 3).
- Fix applied: §10 Chunk 3 now says "eight hooks" and includes `useOrgList`.

### Finding 5 — important — accepted (mechanical)
- Section: §5 / §10 Chunk 1
- Description: `NavSectionAction` moved in Chunk 1 but not in §5 inventory.
- Classification: mechanical (file inventory drift).
- Fix applied: §10 Chunk 1 clarifies `NavSectionAction` stays inside `NavSection.tsx` (no separate file).

### Finding 6 — important — accepted (mechanical)
- Section: §6 tree / §10 Chunk 2 / §5
- Description: `<NavRegion>` referenced in tree and Chunk 2 but no `NavRegion.tsx` in §5.
- Classification: mechanical (terminology unification).
- Fix applied: All `<NavRegion>` references renamed to `<NavItemRenderer>` (which §5 already lists).

### Finding 7 — minor — accepted (mechanical clarification)
- Section: §7.4
- Description: `resyncBadges` named as "owned" but not in the returned contract — ambiguous whether it's exposed.
- Classification: mechanical (clarify intent).
- Fix applied: §7.4 now explicitly states `resyncBadges` is internal to the hook and intentionally NOT part of the returned contract.

### Finding 8 — minor — accepted (mechanical)
- Section: §7.1 / §12
- Description: `useViewMode` callbacks (`onRequireClientSelection`, `onClientCleared`) not contracted with concrete wirings.
- Classification: mechanical (name the wiring).
- Fix applied: §12 self-consistency now names them: `onRequireClientSelection: commandPalette.open`, `onClientCleared: identity.clearClient`.

### Finding 9 — nit — REJECTED (hallucination)
- Section: 1, 2, 4, 5, 6, 9, 10, 13 (Codex claim)
- Description: Codex claimed mojibake in budget thresholds, LOC targets, and section refs.
- Classification: hallucination.
- Reject reason: the spec file is clean UTF-8 (`file` confirms; direct Read shows proper unicode). The mojibake is Codex's own Windows-PowerShell stdin-encoding artifact while reading the file, not in the source. The spec contains intentional Unicode characters (em-dash, ≥, →) that are valid per the codebase's spec-doc convention (CLAUDE.md only forbids em-dashes in UI copy, not in agent-facing docs).

## Rubric findings (from my own pass)

### R1 — minor — accepted (mechanical)
- Section: §1 vs §6/§12
- Description: §1 cited "lines 563–612" for the cross-tenant safety; §6/§12 cited "lines 569–599" (the actual `targetSubaccountId` guard).
- Fix applied: §1 now cites the narrower 569–599 range and names the specific guard.

### R2 — minor — accepted (mechanical)
- Section: §6 tree caption vs §8.1
- Description: §6 tree passed `hasOrgPerm` as an IconRail prop; §8.1 contract uses `canCreateClient`.
- Fix applied: tree caption rewritten to match §8.1 prop names (`canCreateClient` instead of `hasOrgPerm`, plus `orgs` and `subaccounts` made explicit).

### R3 — minor — accepted (mechanical)
- Section: §10 Chunk 5
- Description: Cross-reference "§10.5 of this spec for risk" but §10 has no subsections (just chunks 1–6).
- Fix applied: redirected to "§12 self-consistency".

### R4 — minor — accepted (mechanical)
- Section: §2 Non-goals vs §9
- Description: §2 said tests cover "two pure helpers (avatarColor, buildBreadcrumbs)"; §9 explicitly excludes avatarColor as too trivial.
- Fix applied: §2 now matches §9 (one test file for `buildBreadcrumbs`; avatarColor + toInitials covered by visual smoke).

### R5 — nit — accepted (mechanical clarification)
- Section: §13 vs §1/§5/§10 Chunk 6
- Description: §13 sets ≤250 LOC ceiling but §1/§5/§10 Chunk 6 target 150–200 LOC.
- Fix applied: §13 acceptance line now reads as bound vs target ("target per §1/§5/§10 Chunk 6 is 150–200 LOC; 250 is the acceptance ceiling").

### R6 — directional / rejected
- Section: §3
- Description: §3 says "No new primitives invented" but introduces `breadcrumbs.ts`, `icons.tsx`, and 8 hooks.
- Classification: directional posturing question.
- Reject reason: per spec-context.md `accepted_primitives` list, "primitive" in this codebase means architectural primitive (`policyEngineService`, `withBackoff`, etc.) — pure file extractions of code that already exists in Layout.tsx don't qualify. §3's claim is defensible under the codebase's vocabulary. No fix needed.

## Frontmatter change
- `Status: draft` → `Status: reviewing` (spec is now under review).

## Iteration 1 Summary

- Mechanical findings accepted:  13 (8 Codex + 5 rubric)
- Mechanical findings rejected:  2 (Codex F9 mojibake, my R6 primitives wording)
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (pending Step 8b)
