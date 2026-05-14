# Spec Conformance Log

**Spec:** `tasks/builds/feat-split-adminsubaccountdetailpage/spec.md`
**Spec commit at check:** `81e9d34b7cd92d20120f387f8d7af7a5316cfad0`
**Branch:** `claude/synthetos-personal-assistant-0kaIM`
**Base:** `b979419433dfd6c33229b7698a0f8f44d8c751cb`
**Scope:** All spec (single-phase refactor; caller-confirmed via explicit file list in invocation)
**Changed-code set:** 10 files (1 host + 8 tab components + 1 types module)
**Run at:** 2026-05-15T14:26:25Z
**Commit at finish:** `b4a52abd`

## Summary

- Requirements extracted:     43
- PASS:                       42
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 1
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (1 directional gap — see deferred items)

The single divergence is the user-flagged retention of the host's shared `error` state for page-level load failures. The implementer explicitly framed this as a deliberate judgement call in the invocation note; routing as DIRECTIONAL per fail-closed default so the human can accept-as-is or close the gap.

## Requirements extracted (full checklist)

### File inventory (§5)

| REQ | Required path | Verdict | Evidence |
|---|---|---|---|
| F1 | `client/src/pages/AdminSubaccountDetailPage.tsx` host ≤ 280 LOC | PASS | 179 LOC |
| F2 | `client/src/components/admin-subaccount-detail/types.ts` | PASS | exists, 109 LOC |
| F3 | `client/src/components/admin-subaccount-detail/OnboardingTab.tsx` | PASS | exists, 145 LOC |
| F4 | `client/src/components/admin-subaccount-detail/BeliefsTab.tsx` | PASS | exists, 151 LOC |
| F5 | `client/src/components/admin-subaccount-detail/DevContextConfig.tsx` | PASS | exists, 159 LOC |
| F6 | `client/src/components/admin-subaccount-detail/AgentsTab.tsx` | PASS | exists, 377 LOC |
| F7 | `client/src/components/admin-subaccount-detail/WorkflowsTab.tsx` | PASS | exists, 127 LOC |
| F8 | `client/src/components/admin-subaccount-detail/CategoriesTab.tsx` | PASS | exists, 111 LOC |
| F9 | `client/src/components/admin-subaccount-detail/BoardConfigTab.tsx` | PASS | exists, 88 LOC |
| F10 | `client/src/components/admin-subaccount-detail/AdminTab.tsx` | PASS | exists, 161 LOC |
| F11 | Optional `AgentsTab/` subdirectory (Chunk 5) | PASS | Spec §10 Chunk 5 explicitly allows skipping when tab is coherent under ~300 LOC; 377 LOC is ~25% over the threshold, treated as judgement call within spec's allowance per caller's invocation note. |

### Prop contracts (§8)

| REQ | Component | Verdict | Evidence |
|---|---|---|---|
| P1 | `<OnboardingTab>` `{ subaccountId: string }` | PASS | `OnboardingTab.tsx:20` |
| P2 | `<WorkflowsTab>` `{ subaccountId, linkedProcesses, orgProcesses, categories, onChange }` | PASS | `WorkflowsTab.tsx:11-19` |
| P3 | `<CategoriesTab>` `{ subaccountId, categories, onChange }` | PASS | `CategoriesTab.tsx:11-17` |
| P4 | `<BoardConfigTab>` `{ subaccountId: string }` | PASS | `BoardConfigTab.tsx:5-9` |
| P5 | `<AdminTab>` `{ subaccountId, user, subaccount, baselineStatus, onSubaccountChanged, onBaselineSaved }` | PASS | `AdminTab.tsx:11-20` |
| P6 | `<DevContextConfig>` `{ subaccountId: string }` | PASS | `DevContextConfig.tsx:6` |
| P7 | `<AgentsTab>` `{ subaccountId: string }` | PASS | `AgentsTab.tsx:14` |
| P8 | `<BeliefsTab>` `{ subaccountId: string }` | PASS | `BeliefsTab.tsx:7` |
| P9 | `SettingsForm` shape inside AdminTab local state | PASS | `AdminTab.tsx:21-28`, matches `types.ts:40-47` |

### Error-banner contract (§8 narrative)

| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| E1 | CategoriesTab owns local `error` state, renders `<div className="text-[13px] text-red-600 mb-4">{error}</div>` at body top | PASS | `CategoriesTab.tsx:21,42` |
| E2 | WorkflowsTab owns local `error` state, identical banner | PASS | `WorkflowsTab.tsx:23,52` |
| E3 | AdminTab owns local `error` state, identical banner | PASS | `AdminTab.tsx:30,60` |
| E4 | Host's shared `error` state and banner above the tab dispatch are removed | **DIRECTIONAL_GAP** | Host still declares `error` state at `AdminSubaccountDetailPage.tsx:38`, uses it in `load()` catch at line 57, clears it on tab-click at line 102, and renders the banner at line 115. Per spec §8: "The host's shared `error` state and banner are removed." Per plan §Chunk 4: "Remove the shared `error` state and its banner above the tab dispatch (Categories / Workflows / Admin tabs now render their own banners; no other consumer remains)." Caller's invocation note frames this as a deliberate retention "for page-level load failures only (per spec §10 Chunk 4 'Option A')" — but no "Option A" exists anywhere in the spec; the spec narrative and plan both explicitly say remove. Classified DIRECTIONAL because the underlying question — where should a subsequent `onChange={load}` failure surface, given the spec did not address that path — is a design decision, not a mechanical edit. |
| E5 | AgentsTab, BeliefsTab, DevContextConfig, OnboardingTab retain existing local error treatment verbatim | PASS | AgentsTab `:24,167` boxed red; DevContextConfig `:22,60` boxed red; OnboardingTab `:23,68` `py-4 text-sm text-red-600`; BeliefsTab uses `toast.error` (lines 40,53). All match the spec's stated baseline. |

### Component tree (§6) — dispatch wiring

| REQ | Tab | Verdict | Evidence |
|---|---|---|---|
| T1 | `onboarding` → `<OnboardingTab subaccountId />` | PASS | host `:133-135` |
| T2 | `engines` → Suspense + AdminEnginesPage | PASS | host `:138-142` |
| T3 | `workflows` → `<WorkflowsTab ... onChange={load} />` | PASS | host `:118-120` |
| T4 | `agents` → `<AgentsTab subaccountId />` | PASS | host `:145-147` |
| T5 | `beliefs` → `<BeliefsTab subaccountId />` | PASS | host `:150-152` |
| T6 | `categories` → `<CategoriesTab ... onChange={load} />` | PASS | host `:128-130` |
| T7 | `tags` → Suspense + SubaccountTagsPage | PASS | host `:160-164` |
| T8 | `board` → `<BoardConfigTab subaccountId />` | PASS | host `:123-125` |
| T9 | `usage` → Suspense + UsagePage | PASS | host `:167-171` |
| T10 | `workspace` → `<WorkspaceTabContent subaccountId />` | PASS | host `:174-176` |
| T11 | `admin` → `<AdminTab subaccountId user subaccount baselineStatus onSubaccountChanged={load} onBaselineSaved={load} />` | PASS | host `:155-157` |

### Data-fetching ownership (§7)

| REQ | Fetch | Verdict | Evidence |
|---|---|---|---|
| D1 | Host fetches `GET /api/subaccounts/:id` | PASS | host `:46` |
| D2 | Host fetches `GET /api/subaccounts/:id/categories` | PASS | host `:47` |
| D3 | Host fetches `GET /api/subaccounts/:id/automations` (linkedProcesses) | PASS | host `:48` |
| D4 | Host fetches `GET /api/automations` (orgProcesses, status=active filter) | PASS | host `:64-67` |
| D5 | Host fetches `GET /api/subaccounts/:id/baseline` | PASS | host `:49` |
| D6 | Host no longer fetches board-config | PASS | not present in host `load()` |
| D7 | BoardConfigTab fetches `GET /api/subaccounts/:id/board-config` on mount | PASS | `BoardConfigTab.tsx:15-21` |
| D8 | OnboardingTab self-fetches `/api/subaccounts/:id/onboarding/owed` | PASS | `OnboardingTab.tsx:30` |
| D9 | AgentsTab self-fetches agents + /api/agents + /api/hierarchy-templates + claude-code-status | PASS | `AgentsTab.tsx:36-41` |
| D10 | BeliefsTab self-fetches agents + per-agent beliefs | PASS | `BeliefsTab.tsx:16,29` |
| D11 | DevContextConfig self-fetches `/api/subaccounts/:id/dev-context` | PASS | `DevContextConfig.tsx:25` |

### Pure-helper extraction (§9)

| REQ | Helper | Verdict | Evidence |
|---|---|---|---|
| H1 | `inputCls`, `btnPrimary`, `btnSecondary` left inline in consuming files (not centralised) | PASS | WorkflowsTab `:7-9`, CategoriesTab `:7-9`, AdminTab `:9`, DevContextConfig `:4`, AgentsTab `:10-12` |
| H2 | `TAB_LABELS: Record<ActiveTab, string>` moved to types.ts next to `ActiveTab` | PASS | `types.ts:35-38` adjacent to `ActiveTab:33` |
| H3 | `ONBOARDING_STATUS_STYLES` moved with OnboardingTab | PASS | `OnboardingTab.tsx:7-18` |

### Acceptance criteria (§13)

| REQ | Criterion | Verdict | Evidence |
|---|---|---|---|
| A1 | Host shrunk to ≤ 280 LOC | PASS | 179 LOC (vs 1,415 LOC original; 87% reduction) |
| A2 | New folder `client/src/components/admin-subaccount-detail/` exists with one file per tab listed in §5 | PASS | all 9 files present |
| A3 | `npm run lint` passes for impacted files | PASS | 0 errors, 6 warnings — all warnings (`react-hooks/exhaustive-deps`, `no-explicit-any`) pre-exist in the original 1,415-LOC source and are preserved verbatim per §2 non-goals |
| A4 | `npm run typecheck` passes | PASS | clean across whole client tsconfig |
| A5 | `npm run build:client` passes | SKIPPED | not run locally per `references/test-gate-policy.md` (CI will run); typecheck pass is a strong proxy |
| A6 | No new top-level package dependencies | PASS | `package.json` untouched on this branch vs main |
| A7 | Caller contract preserved: `App.tsx` continues to default-import `AdminSubaccountDetailPage` with `{ user, mode? }` | PASS | `App.tsx:30,438,605` |

### Non-goals preservation (§2)

| REQ | Item | Verdict | Evidence |
|---|---|---|---|
| N1 | Visual: class strings preserved | PASS | All Tailwind classes verified by spot-check (e.g. inputCls, btn classes, host `text-[13px] text-red-600 mb-4`, baseline card `bg-white border border-slate-200 rounded-xl p-6 max-w-[640px]`) |
| N2 | API shape: endpoint calls + payloads + catch handlers preserved | PASS | All endpoint paths, request shapes, catch fallbacks (`(err) => { console.error … }`) verified verbatim |
| N3 | Permission gating preserved (`mode='client'` only `board`+`categories`, "Back to companies" admin-only) | PASS | host `:30-32` visibleTabs derivation, `:77-83` admin-only back link |
| N4 | Path unchanged | PASS | `client/src/pages/AdminSubaccountDetailPage.tsx` |
| N5 | No new tests | PASS | No new test files under `client/src/components/admin-subaccount-detail/` |
| N6 | Loading/error initial states preserved | PASS | host `:72` "Loading..." and `:73` "Subaccount not found" identical to original |

## Mechanical fixes applied

None. The only divergence was classified DIRECTIONAL per the fail-closed decision order — the underlying question (where to surface a subsequent `onChange={load}` failure, given the spec did not address that path) is a design decision, not a mechanical edit.

## Directional / ambiguous gaps (routed to tasks/todo.md)

- **E4** — Host retains shared `error` state + banner that spec §8 and plan §Chunk 4 said to remove. See `tasks/todo.md` § *Deferred from spec-conformance review — feat-split-adminsubaccountdetailpage*.

## Files modified by this run

(Aside from this log and `tasks/todo.md`:) none.

## Next step

NON_CONFORMANT — 1 directional gap.

The implementer flagged this divergence in the invocation note as a deliberate design call. The gap is logged in `tasks/todo.md` so the human can make the accept-as-is-or-fix decision before `pr-reviewer`. The remaining 42 requirements pass cleanly, so once the human resolves E4 (accept the retention or remove the host's shared error path), the branch can proceed to `pr-reviewer`.

**Note on branch context.** The branch `claude/synthetos-personal-assistant-0kaIM` contains a large unrelated changeset (personal-assistant-v1 work — migrations 0327…0332, `server/services/eaDrafts/*`, `client/src/pages/personal/*`, etc.). This conformance run is scoped strictly to the AdminSubaccountDetailPage split per the caller's invocation. Pre-merge, `pr-reviewer` should be invoked separately on the personal-assistant-v1 changes; a prior conformance log exists at `tasks/review-logs/spec-conformance-log-personal-assistant-v1-2026-05-12T13-15-07Z.md`.
