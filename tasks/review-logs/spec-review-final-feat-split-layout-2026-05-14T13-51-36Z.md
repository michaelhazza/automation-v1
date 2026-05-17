# Spec Review Final Report

**Spec:** `tasks/builds/feat-split-layout/spec.md`
**Spec commit at start:** uncommitted (working tree)
**Spec commit at finish:** `8b0528d3`
**Spec-context commit:** `62497257bb53bc99cf55b9f442af951cf4ddd318`
**Iterations run:** 2 of 5
**Exit condition:** two-consecutive-mechanical-only
**Verdict:** READY_FOR_BUILD (2 iterations, 17 mechanical fixes applied, 0 directional findings, 0 deferred items)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 9 | 6 | 13 | 2 | 0 | 0 | 0 |
| 2 | 4 | 0 | 4 | 0 | 0 | 0 | 0 |

---

## Mechanical changes applied

### §1 Goals
- "each hook tests one slice" → "each hook owns one slice" (no orchestration-hook tests in scope).
- Cross-tenant safety line range tightened from "563–612" to "569–599" with explicit reference to the `targetSubaccountId` guard inside `handleNewBriefSubmit`.

### §2 Non-goals
- Test scope clarified to match §9: one Vitest unit file for `buildBreadcrumbs` only; `avatarColor`/`toInitials` explicitly excluded as trivial.

### §5 Target structure
- `useOrgList.ts` added to the hooks inventory (system-admin only; orgs list for IconRail OrgPicker + NewBriefModal).
- `OrgPicker.tsx` reclassified from "optional" to "conditional split — created only if IconRail.tsx > 200 LOC after Chunk 4".

### §6 Component tree
- IconRail tree caption rewritten to match §8.1 prop names (`canCreateClient` instead of `hasOrgPerm`; `orgs` and `subaccounts` made explicit).
- All `<NavRegion>` references renamed to `<NavItemRenderer>` (matches §5 inventory).
- NewBriefModal tree caption: `onCreated` → `onSubmitted` to match §8.5 contract.
- Host description now explicitly excepts the org-picker outside-click listener from the "all side effects move into hooks" rule (it stays inside IconRail/OrgPicker as local UI state).

### §7 Data and side-effect ownership
- §7.1 `useLayoutIdentity` now owns the subaccounts list and its org-scoped refetch effect (today's lines 380–391); returns `subaccounts: ClientOption[]`. Carries the existing eslint-disable rationale comments verbatim.
- §7.4 `useLayoutBadges` clarifies `resyncBadges` is internal to the hook (passed to `useSocketRoom` as reconnect callback) and intentionally NOT part of the returned contract.
- §7.8 renamed from "Org list" to `useOrgList(isSystemAdmin)`. Hook now lives at `client/src/hooks/useOrgList.ts`; host invokes it and passes `orgs` to both consumers. Removed the "kept inline in IconRail.tsx" alternative.

### §10 Migration plan
- Chunk 1: `NavSectionAction` clarified as staying inside `NavSection.tsx` (no separate file).
- Chunk 2: `<NavRegion>` references replaced with `<NavItemRenderer>`.
- Chunk 3: "seven hooks" → "eight hooks" (added useOrgList).
- Chunk 5: cross-reference "§10.5 of this spec for risk" redirected to "§12 self-consistency" (§10 has no subsections).

### §12 Self-consistency
- `useViewMode` wiring callbacks now contracted concretely: `onRequireClientSelection: commandPalette.open`, `onClientCleared: identity.clearClient`.

### §13 Acceptance criteria
- LOC bound clarified as ceiling vs target ("≤ 250 LOC; target per §1/§5/§10 Chunk 6 is 150–200 LOC; 250 is the acceptance ceiling").
- OrgPicker.tsx absence is now acceptance-passing when the inline path was chosen.

### Frontmatter
- `Status: draft` → `Status: reviewing`.

---

## Rejected findings

### Iter 1 — Codex Finding 9 (mojibake)
- **Section:** 1, 2, 4, 5, 6, 9, 10, 13 (Codex claim)
- **Description:** Codex claimed mojibake in budget thresholds, LOC targets, section refs.
- **Reason for rejection:** spec file is clean UTF-8 (verified by `file` command and direct Read showing proper unicode). The mojibake is Codex's own Windows-PowerShell stdin-encoding artifact while reading the file via `Get-Content`. The spec contains intentional Unicode (em-dash, ≥, →) that is valid per the codebase's spec-doc convention. CLAUDE.md's em-dash prohibition applies only to UI copy / labels / app-facing text — not to agent-facing docs.

### Iter 1 — Rubric R6 (primitives wording)
- **Section:** §3
- **Description:** §3 claim "No new primitives invented" while introducing `breadcrumbs.ts`, `icons.tsx`, and 8 hooks.
- **Reason for rejection:** per `docs/spec-context.md` `accepted_primitives` list, "primitive" in this codebase means architectural primitive (`policyEngineService`, `withBackoff`, etc.) — pure file extractions of code that already exists in Layout.tsx do not qualify as new primitives in this sense. §3's claim is defensible under the codebase's vocabulary.

---

## Directional and ambiguous findings (autonomously decided)

None. Across both iterations, zero findings required framing-assumption / convention / best-judgment adjudication. All findings were mechanical consistency / file-inventory / contract / cross-reference cleanups.

This is an unusually clean review: the spec author had already aligned the framing with `docs/spec-context.md` before submission — no test posture, no rollout posture, no abstraction conflicts.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review. Every finding raised was a mechanical consistency cleanup; none required framing adjudication. However:

- The review did not re-verify the framing assumptions in `docs/spec-context.md`. The spec is consistent with `runtime_tests: pure_function_only` (one Vitest unit file for `buildBreadcrumbs`) and with the "prefer existing primitives" rule (no new architectural primitives introduced). Re-read §1 Goals and §3 if you want to confirm intent has not drifted since drafting.
- The review did not catch directional findings that Codex and the rubric did not see. Two areas worth a human eye:
  - **Chunk 5 risk surface.** The cross-tenant safety in `handleNewBriefSubmit` (lines 569–599) is implementation-critical security logic. The spec correctly identifies it as the highest-risk piece. When implementing Chunk 5, manually verify the safety logic carries over verbatim — the spec correctly forbids reshaping it.
  - **Hook count growth.** Spec now lists 8 hooks (was 7 pre-review). If implementation surfaces a 9th, that is a signal to revisit the host's wiring complexity. The host should still be ≤ 250 LOC at the end.
- The review did not prescribe what to build next. The chunk order (1→6) is a reasonable bottom-up sequence and the dependency graph in the spec is acyclic.

**Recommended next step:** the spec is ready. Switch to Sonnet, invoke `architect` to break this into chunks aligned with §10's plan, then `feature-coordinator` for implementation. No further spec-review iterations needed.
