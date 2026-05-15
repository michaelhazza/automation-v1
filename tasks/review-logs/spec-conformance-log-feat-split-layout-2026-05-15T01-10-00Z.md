# Spec Conformance Log

**Spec:** `tasks/builds/feat-split-layout/spec.md`
**Spec commit at check:** `557b4f64` (HEAD)
**Branch:** `claude/synthetos-personal-assistant-0kaIM`
**Base:** merge-base with `main`
**Scope:** all-of-spec — caller invoked the full feat-split-layout refactor verification.
**Changed-code set:** 27 files (Layout.tsx + 13 layout/ files + 8 hooks + 4 modals + 1 test)
**Run at:** 2026-05-15T01:10:00Z
**Commit at finish:** `835afa55`

---

## Table of contents

1. Summary
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional / ambiguous gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Cross-tenant safety verification
7. Acknowledged-deviation reconciliation
8. Next step

---

## 1. Summary

- Requirements extracted:     37
- PASS:                       35
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 2
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (2 directional gaps — both flagged in caller's "acknowledged deviations" but spec §1 forbids one, and the other is a prop-shape divergence from §8.2).

Both gaps are small. The host is 190 LOC (within 150-200 target); all eight hooks land with spec-named return contracts; cross-tenant safety logic is preserved verbatim; the breadcrumbs test file lands with all five named cases; lint, typecheck, build:client, and the named test all pass.

---

## 2. Requirements extracted (full checklist)

### §5 file inventory — host + chrome region files
- **REQ #1** Host `client/src/components/Layout.tsx` ≤ 250 LOC, target 150-200. → **PASS** (190 LOC; orchestration only: hooks, navCtx derivation, modal-flag state, return JSX, plus the WebSocket-init useEffect at lines 79-82 carried verbatim from pre-refactor).
- **REQ #2** `client/src/components/layout/IconRail.tsx`. → **PASS** (140 LOC; logo, conditional org picker, client avatars, active marker, new-client button, user avatar all inline per §10 Chunk 4).
- **REQ #3** `client/src/components/layout/SidebarShell.tsx`. → **PASS** (composition matches §6 tree: context header + ViewModeSwitcher + NavItemRenderer × 2 + footer with `support@synthetos.ai` mailto inlined).
- **REQ #4** `client/src/components/layout/NavItem.tsx`. → **PASS** (link variant; supports `to | icon | label | badge | badgeLabel | exact | manageTo`).
- **REQ #5** `client/src/components/layout/NavButton.tsx`. → **PASS**.
- **REQ #6** `client/src/components/layout/NavSection.tsx` hosts `NavSectionAction` per §10 Chunk 1. → **PASS**.
- **REQ #7** `client/src/components/layout/NavItemRenderer.tsx` with `renderNavItem` + `resolveIcon`. → **PASS** (special cases for `new-task` and `sign-out` keys preserved verbatim).
- **REQ #8** `client/src/components/layout/TrialCountdown.tsx`. → **PASS** (pure rendering; consumes `useTrialCountdown`).
- **REQ #9** `client/src/components/layout/BudgetAlertBanner.tsx`. → **PASS** (75/90/95% colour bands and copy preserved; returns null when alert or activeClientId is null).
- **REQ #10** `client/src/components/layout/TopBar.tsx`. → **PASS** (breadcrumb bar + GlobalAskBar conditional + Cmd-K trigger).
- **REQ #11** `client/src/components/layout/Breadcrumbs.tsx` — actual file is `BreadcrumbBar.tsx`. → **PASS-WITH-DEVIATION** (caller acknowledged Windows case-insensitive filesystem collision with `breadcrumbs.ts`; functionally identical; consumed by TopBar at the same call site).
- **REQ #12** `client/src/components/layout/OrgPicker.tsx` conditional. → **PASS** (IconRail is 140 LOC, under 200-LOC threshold; §5/§10 Chunk 4 say "absence is acceptance-passing" when inline path chosen).
- **REQ #13** `client/src/components/layout/icons.tsx` — `Ico` wrapper + `Icons` map. → **PASS**.
- **REQ #14** `client/src/components/layout/breadcrumbs.ts` — `SEG`, `UUID_RE`, `avatarColor`, `toInitials`, `buildBreadcrumbs`. → **PASS**.
- **REQ #15** `client/src/components/layout/modals/CreateProjectModal.tsx`. → **PASS** (form state internal; POST `/api/subaccounts/{id}/projects`; `onCreated(projectId)` callback).
- **REQ #16** `client/src/components/layout/modals/CreateAgentModal.tsx`. → **PASS** (icon picker preserved; two-step POST `/api/agents` then `/api/subaccounts/{id}/agents`; `onCreated(agentId)`).
- **REQ #17** `client/src/components/layout/modals/CreateClientModal.tsx`. → **PASS-WITH-CAVEAT** (POST `/api/subaccounts` + 403/409 error mapping; `onCreated(client: ClientOption)`; but see REQ #37 — pre-refactor optimistic `setSubaccounts` mutation dropped).
- **REQ #18** `client/src/components/layout/modals/NewBriefModal.tsx`. → **PASS** (cross-tenant safety logic preserved verbatim from pre-refactor lines 569-599 — see section 6 below).

### §7 hook contracts
- **REQ #19** `useLayoutIdentity(user)` returns `{ activeOrgId, activeOrgName, activeClientId, activeClientName, subaccounts, hasOrgContext, isSystemAdmin, selectOrg, selectClient, selectClientFromPalette, clearClient, logout }`. → **PASS** (exact contract; auto-set-org effect at lines 44-58; subaccounts refetch with verbatim eslint-disable rationale at lines 61-72; `selectOrg` calls `reconnectSocket()`; `selectClient`/`selectClientFromPalette` drop `systemAdminOrgOverride` with verbatim §4.6 rationale comment; `logout` order is `disconnectSocket()` THEN remove tokens THEN navigate, per §12).
- **REQ #20** `useLayoutPermissions(identity)` returns `{ hasAnyOrgPerm, hasOrgPerm, hasClientPerm }`. → **PASS** (`__system_admin__` and `__org_admin__` sentinels honoured; client perms also escalate via `orgPerms.has('__org_admin__')`).
- **REQ #21** `useSidebarConfig(identity)` returns `{ sidebarLoaded, hasSidebarItem }`. → **PASS** (`hasSidebarItem` returns false until loaded per §7.3 and §12).
- **REQ #22** `useLayoutBadges(identity)` returns `{ reviewCount, liveAgentCount, incidentCount, budgetAlert, dismissBudgetAlert }`. → **PASS** (`resyncBadges` is internal, passed to `useSocketRoom` reconnect callback at line 90; NOT exposed in return per §7.4; budget threshold 0.75/0.9/0.95 logic preserved).
- **REQ #23** `useNavLists(identity)` returns `{ navProjects, navAgents, refresh: { projects(), agents() } }`. → **PASS**.
- **REQ #24** `useCommandPaletteKeybind()` returns `{ cmdOpen, open(), close() }`. → **PASS**.
- **REQ #25** `useTrialCountdown()` returns `{ label, severity }`. → **PASS** (severity mapping `muted → text-slate-500`, `warn → text-amber-400`, `danger → text-red-400` matches pre-refactor inline mapping; thresholds at >7 / >2 / 2 / 1 / 0 days preserved with verbatim copy).
- **REQ #26** `useOrgList(isSystemAdmin)` returns `{ orgs }`. → **PASS** (short-circuits to `[]` when `!isSystemAdmin` per §7.8).

### §8 prop contracts
- **REQ #27** `<IconRail>` props per §8.1. → **PASS** (`user, identity, orgs, subaccounts, canCreateClient, onCreateClient`; outside-click listener preserved as local UI state per §6 exception).
- **REQ #28** `<SidebarShell>` props per §8.2. → **DIRECTIONAL_GAP** (spec lists `isSystemAdmin` and `activeOrgName` as separate props alongside `identity`; implementation only passes `identity` and reads `.isSystemAdmin` / `.activeOrgName` inside. Behaviourally identical because `identity` carries both fields. Spec contract diverges from implementation — see deferred item).
- **REQ #29** `<TopBar>` props per §8.3 → **PASS**.
- **REQ #30** `<Breadcrumbs>` props per §8.3 tail → **PASS**.
- **REQ #31** `<BudgetAlertBanner>` props per §8.4 → **PASS** (returns null when alert or activeClientId null; severity bands internal).
- **REQ #32** Modals props per §8.5 → **PASS** (all four modals accept the spec-named prop shapes).

### §9 pure-helper extraction + test
- **REQ #33** Vitest test `client/src/components/layout/__tests__/breadcrumbs.test.ts` with 5 cases. → **PASS** (all five cases present and pass: empty pathname → []; UUID after `subaccounts` → uses clientName; UUID without preceding `subaccounts` → skipped; SEG null → segment skipped; unknown segment → title-case fallback).

### §13 acceptance criteria
- **REQ #34** `npm run lint` clean. → **PASS** (0 errors).
- **REQ #35** `npm run typecheck` clean. → **PASS**.
- **REQ #36** `npm run build:client` clean. → **PASS** (2.85s).
- **REQ #37** Spec §1 "Preserve every user-visible behaviour" — icon-rail order, org picker, **client avatars + active-marker bar**, sidebar groups, breadcrumb derivation, budget banner thresholds, trial countdown copy, Cmd+K palette, four create-modal flows, cross-tenant safety. → **DIRECTIONAL_GAP** on "client avatars": optimistic subaccount-list addition on new-client create was dropped. Pre-refactor `Layout.tsx` line 1209 did `setSubaccounts(prev => [...prev, newEntry])` immediately after successful POST `/api/subaccounts`; new flow only sets activeClientId, so the icon does not appear until next refresh/org-change. Caller flagged this explicitly. Spec §1 forbids it.

---

## 3. Mechanical fixes applied

(None — both flagged gaps are directional design choices, not surgical additions.)

---

## 4. Directional / ambiguous gaps (routed to tasks/todo.md)

Both items appended to `tasks/todo.md` under "Deferred from spec-conformance review — feat-split-layout (2026-05-15)":

- **REQ #37** — Optimistic subaccount-list addition on new-client create dropped. Spec §1 forbids the behaviour delta. Suggested resolution: either add `addSubaccount` action to `useLayoutIdentity` and call it from `CreateClientModal.onCreated` before `selectClient`, OR add a one-line spec errata acknowledging the delta as intentional.
- **REQ #28** — `SidebarShell` prop-contract divergence (`isSystemAdmin` / `activeOrgName` not passed as separate props). Behaviour identical (identity carries both fields). Suggested resolution: drop the redundant prop entries from spec §8.2 (cleaner outcome since redundancy was likely a spec drafting oversight), OR add the two named props mechanically (small but adds dead prop-drilling).

---

## 5. Files modified by this run

- `tasks/todo.md` — new deferred section appended.
- `tasks/review-logs/spec-conformance-log-feat-split-layout-2026-05-15T01-10-00Z.md` — this log.

No code files were modified.

---

## 6. Cross-tenant safety verification (highest-risk piece per caller)

The `targetSubaccountId` guard inside `NewBriefModal.handleSubmit` (lines 39-46 of `client/src/components/layout/modals/NewBriefModal.tsx`) is identical to pre-refactor `Layout.tsx` lines 569-583:

```ts
const targetOrgId = briefOrgOverride?.id ?? identity.activeOrgId;
// When the user picks a different org without picking a subaccount, do
// NOT fall back to the current activeClientId — that subaccount belongs
// to the previous org and would create a cross-tenant tasks row.
const orgChanged = !!briefOrgOverride && briefOrgOverride.id !== identity.activeOrgId;
const targetSubaccountId =
  briefSubaccountOverride?.id ?? (orgChanged ? undefined : identity.activeClientId ?? undefined);
```

Additional defence-in-depth at modal-body lines 128-153: the subaccount picker is hidden entirely when `briefOrgOverride` differs from `identity.activeOrgId`, because the `subaccounts` list passed in still belongs to the previously active org. This second layer was also present pre-refactor and is preserved verbatim with its rationale comment.

The `X-Organisation-Id` override header is preserved (line 60-62 of `NewBriefModal.tsx`).

**Verdict on cross-tenant safety: byte-for-byte preserved.**

---

## 7. Acknowledged-deviation reconciliation

The caller listed three deviations:

1. **`BreadcrumbBar.tsx` instead of `Breadcrumbs.tsx`** — accepted as spec-conformant. Caller's rationale (Windows case-insensitive filesystem collision with `breadcrumbs.ts`) is reasonable; component is functionally identical; consumer (TopBar) correctly imports it. Spec's intent is satisfied. Logged as deviation, not gap.
2. **`OrgPicker.tsx` absence** — spec-conformant. §5 explicitly says file is conditional ("created only if IconRail.tsx > 200 LOC after Chunk 4; otherwise stays inline"). IconRail is 140 LOC. Absence is spec-correct.
3. **Optimistic subaccount addition dropped** — **NOT spec-conformant** despite caller acknowledgement. Spec §1 says "Preserve every user-visible behaviour: icon-rail order, ..., client avatars + active-marker bar". Pre-refactor optimistic-add was a user-visible behaviour. Caller's framing ("minor behavioural delta; not flagged by spec") is incorrect — §1 is the flag. Routed to `tasks/todo.md` for human decision.

---

## 8. Next step

**NON_CONFORMANT** — 2 directional gaps must be addressed by the main session before `pr-reviewer`. See `tasks/todo.md` § "Deferred from spec-conformance review — feat-split-layout (2026-05-15)". Both gaps are small; either can be resolved with a one-line spec errata note OR a small mechanical fix at the human's discretion. The host implementation, hook contracts, file inventory, cross-tenant safety, and test coverage are otherwise fully spec-conformant.
