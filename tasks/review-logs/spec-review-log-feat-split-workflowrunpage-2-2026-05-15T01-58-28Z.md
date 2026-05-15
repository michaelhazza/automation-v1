# Spec Review Log — feat-split-workflowrunpage — Iteration 2

**Timestamp:** 2026-05-15T01-58-28Z
**Codex command:** `codex exec --skip-git-repo-check` with stdin-fed spec body.

## Findings & dispositions

**F1 — §6 vs §7 `selectedStepRunId` ownership** — Codex (important)
- Real contradiction: §6 said "derive selectedStepRunId local state" while §7 returned `selectedStepRunId` + `setSelectedStepRunId` from the hook.
- Classification: mechanical
- Disposition: ACCEPT — §6 rewritten so the host calls the hook which returns `selectedStepRunId` + setter (per §7), instead of declaring host-owned state.

**F2 — §2 vs §9 case-count drift** — Codex (minor)
- §2 said "three edge cases", §9 has 5 rows.
- Classification: mechanical
- Disposition: ACCEPT — §2 updated to "five cases tabled in §9".

**F3 — §8.1 vs §12.1 `ConfirmDialog` ownership** — Codex (important)
- Real wording inconsistency: §8.1 said header owns the modals; §12.1 said host owns them.
- Classification: mechanical
- Disposition: ACCEPT — §8.1 now states the header renders the modals and triggers `onCancel()` / `onReplay()` on confirm, while the host owns the action handlers and toasts. §12.1 wording updated to match.

**F4 — §8.1 `subaccountId` reason** — Codex (minor)
- `subaccountId` was tagged "for the back-link href and portal-toggle API call" but the portal-toggle API call lives in the host.
- Classification: mechanical
- Disposition: ACCEPT — comment trimmed to "for the back-link href only".

**F5 — §6 tree abbreviated** — Codex (minor)
- §6 tree showed `<RunHeader run, onCancel, onReplay, onPortalToggle />` but §8.1 requires `definition`, `stepRuns`, `socketConnected`, `subaccountId` too.
- Classification: mechanical
- Disposition: ACCEPT — §6 tree changed to `<RunHeader … />` with a pointer to §8.1 for the full prop surface.

**F6 — §12.1 portal-toggle ownership wording** — Codex (minor)
- The "kebab menu's JSX, which moves to `RunHeader`" sentence was confusing.
- Classification: mechanical
- Disposition: ACCEPT — rewritten as: the kebab UI and the two ConfirmDialog modals move to `RunHeader`; mutation + toast + refetch stays host-owned and is invoked via the three callbacks.

## Counts

- mechanical_accepted: 6
- mechanical_rejected: 0
- directional_or_ambiguous: 0
- reclassified_to_directional: 0

## Iteration 2 Summary

- Mechanical findings accepted:  6
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
- Spec commit after iteration:   (set after Step 8b commit)
