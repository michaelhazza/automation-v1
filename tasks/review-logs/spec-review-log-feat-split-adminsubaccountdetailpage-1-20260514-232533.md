# Spec Review Iteration 1 — feat-split-adminsubaccountdetailpage

**Spec path:** `tasks/builds/feat-split-adminsubaccountdetailpage/spec.md`
**Codex version:** 0.125.0
**Iteration:** 1 of 5
**Timestamp:** 20260514-232533

---

## Codex output summary

Codex returned 5 substantive findings (4× P2, 1× P3) plus the verdict "not implementation-ready." Findings target boundary contracts (props, state ownership), a §13 acceptance criterion that conflicts with §5/§8 extraction, and one factually-incorrect claim about baseline-status ownership.

Codex raw output saved at: `C:\Users\micha\.claude\projects\c--Files-Projects-automation-v1-3rd\c3c4c92c-76aa-4bd3-8c42-893f0acc860b\tool-results\brqdrv5tv.txt`

---

## Findings (after rubric pass)

### FINDING #1 — Import acceptance criterion is unachievable

- Source: Codex P2
- Section: §13 (line 307)
- Description: §13 forbids "new imports of axios, react-router, or User outside files that were already using them" — but extracted tab files MUST import these (OnboardingTab uses `<Link>`, AdminTab takes `user: User`, every tab uses `api`).
- Codex's suggested fix: rephrase the criterion so it's achievable.
- Classification: **mechanical** — internal contradiction within the spec; intent is clear (no NEW top-level package dependencies introduced by the refactor).
- Disposition: auto-apply.

### FINDING #2 — AdminTab `settingsSaved` ownership conflict

- Source: Codex P2
- Section: §8.5 (lines 196–202) vs §10 Chunk 4 (lines 269–270)
- Description: §10 says "Move `settingsSaved` state into the tab"; §8.5 still requires the host to pass `saved: string`. Two ownership models, contradictory.
- Codex's suggested fix: pin one contract.
- Classification: **mechanical** — fix is mechanical: keep `settingsSaved` in the host next to `handleSaveSettings` (the host already owns the form state and the save handler per §8.5); remove the "move settingsSaved into the tab" wording from §10 Chunk 4.
- Disposition: auto-apply.

### FINDING #3 — Workflow / category / settings error propagation has no surface after extraction

- Source: Codex P2 (expanded by rubric to cover settings / board / categories)
- Section: §8.2 / §8.3 / §8.4 / §8.5
- Description: Today, `handleCreateCategory`, `handleCreateLink`, `handleSaveSettings` all call host `setError`, rendered in the shared error banner at line 244. After extraction with only `onChange` callbacks, these errors have nowhere to surface. Tab-switch also calls `setError('')` to clear (line 231).
- Codex's suggested fix: add error callback or specify identical local error surface.
- Classification: **mechanical** — pin the error contract.
- Adjudication: the simplest model that preserves visible behaviour is "each extracted tab renders its own error message locally; the host's shared `error` banner above the tab dispatch is retired in favour of per-tab local rendering". This avoids prop-drill for a callback that only one consumer uses, and matches existing self-contained tabs (AgentsTab, BeliefsTab already do this with their internal `error` state at lines 589, 963). Tab-switch clearing is preserved automatically because each tab unmounts.
- Disposition: auto-apply. Add a §12-consistent note that the host's `error` banner is removed and each extracted tab renders its own local error banner using the same Tailwind classes.

### FINDING #4 — BoardConfigTab controlled-vs-uncontrolled ambiguity

- Source: Codex P2
- Section: §8.4 (lines 180–187), §10 Chunk 3 (lines 261–265)
- Description: §8.4 makes `columns` a prop AND says `boardColumns` local state becomes internal; §10 Chunk 3 relies on host refetching board config. Without a sync contract, host refreshes may not propagate or may overwrite in-progress edits.
- Codex's suggested fix: specify controlled `columns/onColumnsChange` model or `initialColumns` + explicit sync trigger.
- Classification: **mechanical** — but the best fix is even simpler: today, the host fetches `/board-config` ONLY for the board tab. Move the fetch into `BoardConfigTab` itself, making it fully self-contained (no `columns` prop, no `onChange` callback). This eliminates the ambiguity entirely and matches the §7 "fully self-contained" pattern used by AgentsTab/BeliefsTab/OnboardingTab.
- Disposition: auto-apply — update §7, §8.4, §10 Chunk 3 to make `BoardConfigTab` fully self-contained.

### FINDING #5 — Baseline-status ownership claim is factually wrong

- Source: Codex P3
- Section: §7 (lines 122–124)
- Description: §7 claims host `baselineStatus` "drives `BaselineStatusBadge` in header." It doesn't — the badge self-fetches `/api/subaccounts/:id/baseline` (verified in `client/src/components/baseline/BaselineStatusBadge.tsx`). Host's `baselineStatus` only drives the admin-tab manual-entry card conditional.
- Classification: **mechanical** — factual correction.
- Disposition: auto-apply.

### FINDING #6 (rubric) — LOC drift in §1

- Source: Rubric (file-inventory drift)
- Section: §1
- Description: §1 cites 1,430 LOC; actual file is 1,415 LOC.
- Disposition: auto-apply.

### FINDING #7 (rubric) — §6 component tree props out of sync with §8.5

- Source: Rubric (file-inventory drift / contract drift)
- Section: §6 (line 113)
- Description: §6 lists `<AdminTab subaccountId, settings, baselineStatus, user, onSettingsSaved, onBaselineSaved />` — `onSettingsSaved` doesn't exist in §8.5; §8.5 has `onSettingsChange` + `onSettingsSave`. The tree also omits `saved`.
- Disposition: auto-apply.

### FINDING #8 (rubric) — `<WorkspaceTabContent />` props missing in §6 tree

- Source: Rubric (file-inventory drift)
- Section: §6 (line 112)
- Description: §6 shows `<WorkspaceTabContent />` with no props; actual usage is `<WorkspaceTabContent subaccountId={subaccountId} />`.
- Disposition: auto-apply.

### FINDING #9 (rubric) — `BoardColumnEditor` not listed in §3 reuse table

- Source: Rubric (missing primitive listing)
- Section: §3
- Description: After extracting `BoardConfigTab`, the new file imports `BoardColumnEditor`. Not currently listed in §3's reuse table.
- Disposition: auto-apply — add row to §3.

---

## Adjudication log

### [ACCEPT] §1 — LOC drift
- Fix applied: change "1,430 LOC" to "1,415 LOC".

### [ACCEPT] §3 — Add BoardColumnEditor to reuse table
- Fix applied: add a row noting `client/src/components/BoardColumnEditor.tsx` is reused by `BoardConfigTab`.

### [ACCEPT] §6 — AdminTab tree props out of sync
- Fix applied: rewrite the `admin` tree row to match §8.5 (`subaccountId, user, settings, saved, baselineStatus, onSettingsChange, onSettingsSave, onBaselineSaved`).

### [ACCEPT] §6 — WorkspaceTabContent missing subaccountId prop
- Fix applied: change to `<WorkspaceTabContent subaccountId />`.

### [ACCEPT] §7 — Correct baseline-status ownership claim
- Fix applied: clarify that `BaselineStatusBadge` self-fetches; the host's `baselineStatus` only drives the admin-tab manual-entry card conditional. Update the "Stays on host" bullet accordingly.

### [ACCEPT] §7, §8.4, §10 Chunk 3 — Make BoardConfigTab fully self-contained
- Fix applied: move `boardColumns`, board fetch, and the three handlers entirely into the tab. Remove `columns` prop from §8.4 — props become `{ subaccountId: string }`. Remove board config from host `load()`. Update §10 Chunk 3 to reflect.

### [ACCEPT] §8.2 / §8.3 / §8.5 / §10 — Pin local error surface per tab
- Fix applied: add a paragraph at the top of §8 stating that each extracted tab renders its own local error banner (same Tailwind class as today's host banner); remove the host's shared `error` state and banner. Update §12 self-consistency check to note this. Tab-switch clearing happens implicitly via unmount.

### [ACCEPT] §8.5 / §10 Chunk 4 — AdminTab settingsSaved stays on host
- Fix applied: clarify in §10 Chunk 4 that `settingsSaved` stays on the host (next to `handleSaveSettings`). §8.5's `saved: string` prop is the contract.

### [ACCEPT] §13 — Make import criterion achievable
- Fix applied: rephrase to "No new top-level package dependencies added to package.json by this refactor; new tab files MAY import existing packages (react-router-dom, axios via api, ../lib/auth) as needed."

---

## Iteration 1 Summary

- Mechanical findings accepted: 9
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 0
- Spec commit after iteration: `7be1b1ca`
