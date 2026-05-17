# Spec Review Final Report

**Spec:** `tasks/builds/feat-split-adminsubaccountdetailpage/spec.md`
**Spec commit at start:** untracked (working tree)
**Spec commit at finish:** `81e9d34b`
**Spec-context commit:** `62497257`
**Iterations run:** 2 of 5
**Exit condition:** two-consecutive-mechanical-only
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 5 | 4 | 9 | 0 | 0 | 0 | none |
| 2 | 3 | 0 | 3 | 0 | 0 | 0 | none |

---

## Mechanical changes applied

### §1 — Goals
- LOC count corrected from 1,430 to 1,415 (matches actual file).

### §2 — Non-goals
- New non-goal added: tab-switch draft-state preservation is not in scope. Points to §12 for the full acknowledged-delta rationale.

### §3 — Existing primitives this spec reuses
- Added a reuse-table row for `client/src/components/BoardColumnEditor.tsx` (consumed by extracted `BoardConfigTab`).

### §6 — Component tree and ownership
- `board` tree row updated: `<BoardConfigTab subaccountId />` (no `columns` prop, no `onChange`) — reflects the §8.4 self-contained contract.
- `workspace` tree row updated: `<WorkspaceTabContent subaccountId />` (was previously missing the prop).
- `admin` tree row rewritten to match the new §8.5 prop contract: `<AdminTab subaccountId, user, subaccount, baselineStatus, onSubaccountChanged, onBaselineSaved />`.

### §7 — Data-fetching ownership
- Corrected the factually-wrong claim that the host's `baselineStatus` drives `BaselineStatusBadge` in the header. The badge self-fetches; the host's `baselineStatus` only drives AdminTab's manual-entry card conditional.
- `BoardConfigTab` moved from "Mixed ownership" to "Moves to tab components (self-fetched on mount)" — eliminates the controlled-vs-locally-synced ambiguity Codex flagged.
- `Subaccount` ownership clarified: host still fetches, but AdminTab owns the `settingsForm` derived from it; AdminTab calls `onSubaccountChanged` after a successful save so the host re-fetches and the new value cascades back.
- Rationale paragraph rewritten to reflect that `BoardConfigTab` is now fully self-contained.

### §8 — Prop contracts at each new boundary
- New "Error-banner contract" paragraph added at the top of §8, scoped to ONLY WorkflowsTab / CategoriesTab / AdminTab (the three tabs whose error path previously sat on the host). Explicitly preserves the existing local error treatments of AgentsTab, BeliefsTab, DevContextConfig, OnboardingTab (no visual change per §2).
- §8.4 (`BoardConfigTab`) rewritten: props are now `{ subaccountId: string }`; fully self-contained.
- §8.5 (`AdminTab`) rewritten: props are `subaccountId, user, subaccount, baselineStatus, onSubaccountChanged, onBaselineSaved`. `SettingsForm` is now AdminTab-local, not a prop. AdminTab owns `settingsForm`, `settingsSaved`, settings-scoped `error`, and `handleSaveSettings`. Resyncs on `subaccount` prop change.

### §10 — Migration plan (chunked)
- Chunk 2 (`WorkflowsTab` / `CategoriesTab`) — added explicit note that each tab owns its own local `error` state per the §8 error-banner contract.
- Chunk 3 (`BoardConfigTab`) — rewritten to reflect full self-containment (no `columns` prop, no `onChange` callback, tab owns the `GET /board-config` fetch).
- Chunk 4 (`AdminTab`) — rewritten: `settingsForm`, `settingsSaved`, settings-scoped `error`, and `handleSaveSettings` all move into the tab. Host stops owning all four. Tab seeds from `subaccount` prop on mount and resyncs on prop change.
- Chunk 6 (verify & clean up) — slimmer host load described; added a positive-confirmation bullet listing the state the host no longer holds; updated cleanup list to include `BoardColumnEditor`, `ManualBaselineForm`, `AdminBaselineResetButton`, etc.

### §12 — Self-consistency check
- Added a bullet codifying the new per-tab error-banner location.
- Added a detailed "Acknowledged behaviour delta" bullet for tab-switch draft-state loss, with rationale for why preservation isn't worth the architectural cost; instructs the implementer to call it out in the PR description.

### §13 — Acceptance criteria
- Smoke-test criterion split by mode: admin-mode lists all 11 tabs; client-mode lists only `board` and `categories` (plus a check that "Back to companies" is hidden).
- Import criterion rewritten to "no new top-level package dependencies" rather than the previously impossible "no new imports of axios / react-router / `User`". Intent (no new npm dependencies) preserved; achievability restored.

---

## Rejected findings

None. Every Codex finding and every rubric finding across both iterations was accepted and applied.

---

## Directional and ambiguous findings (autonomously decided)

None across either iteration. Codex did not surface any rollout / testing-posture / scope / framing concerns. This is unsurprising for a pure refactor under the project's "preserve existing behaviour, no new tests" posture — the spec is mechanical by nature and Codex's pushback was correctly bounded to contract-shape and acceptance-criterion issues.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review. However:

- The review did not re-verify the framing assumptions at the top of this spec. If the project context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's framing sections yourself before calling this implementation-ready. The framing here is light because the refactor is mechanical: §1 (goals), §2 (non-goals), §11 (deferred items), §12 (self-consistency). All consistent with `docs/spec-context.md` as of 2026-05-11.
- The review did not catch directional findings that Codex and the rubric did not see. The one place where a directional judgement was made autonomously was the §12 "acknowledged behaviour delta" for tab-switch draft-state loss — the human should confirm this is acceptable. The §2 / §12 wording makes the trade-off explicit so the human can challenge it before the PR ships.
- The review did not prescribe sprint sequencing. The §10 chunk plan is independently revertible and the chunks are ordered by dependency — but whether all 6 chunks ship in one PR or are split is a human call.

**Recommended next step:** read §2 (non-goals), §12 (acknowledged behaviour delta), and the new §8 error-banner contract one more time to confirm the trade-offs are acceptable. Then proceed to implementation — the chunk plan is ready.
