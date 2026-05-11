# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md`
**Plan:** `tasks/builds/operator-session-identity/plan.md` § Chunk 8
**Spec commit at check:** `7f7db4d1` (HEAD; spec file unchanged in this chunk)
**Branch:** `claude/evolve-session-identity-brief-17LO4`
**Base:** `2885319b` (end of Chunk 7)
**Head before fix:** `76277bf9` (end of Chunk 8 as committed)
**Scope:** Chunk 8 only — App Integrations tab (client)
**Mapped spec sections:** §5.4, §6, §8.12, §12 Chunk 8, §17.7
**Changed-code set:** 3 new files
- `client/src/pages/govern/components/AppIntegrationsTab.tsx`
- `client/src/pages/govern/components/ConnectAppModal.tsx`
- `client/src/pages/govern/components/ManageMultiConnectDrawer.tsx`

Plus one pre-existing referenced contract:
- `client/src/pages/govern/components/DisconnectConfirmDialog.tsx` (carried over from `consolidation-govern`; not modified in this chunk)

**Run at:** 2026-05-11T10:31:11Z
**Commit at finish:** `52fa61bb`

---

## Summary

| Metric | Count |
|---|---|
| Requirements extracted | 13 |
| PASS | 9 |
| MECHANICAL_GAP → fixed | 1 |
| DIRECTIONAL_GAP → deferred | 3 |
| AMBIGUOUS → deferred | 0 |
| OUT_OF_SCOPE → skipped | 0 |

**Verdict:** **NON_CONFORMANT** — 3 directional gaps require human resolution before the chunk can be merged. See `tasks/todo.md` § "Deferred from spec-conformance review — operator-session-identity (2026-05-11)".

The mechanical fix (vocabulary cleanup) was applied in-session. Lint and typecheck both pass.

---

## Requirements extracted (full checklist)

| # | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 1 | §5.4 + plan | Card grid with two sections "Your connected apps" + "Apps you can connect", mutually exclusive | PASS | `AppIntegrationsTab.tsx:256-257, 315-351` |
| 2 | §5.4 + plan | Category filter chips above the grid, derived from static `APP_CATEGORIES` constant in the component file | PASS | `AppIntegrationsTab.tsx:14, 280-295` |
| 3 | §5.4 + plan | NO "OAuth" / "API Key" / "MCP" / "Cookie" labels visible anywhere | MECHANICAL_GAP → fixed | `ManageMultiConnectDrawer.tsx:309` (footer copy mentioned "OAuth") |
| 4 | Plan | Per-app variant map keyed for gmail, hubspot, slack, gohighlevel, teamwork, google_drive, outlook, google_calendar, microsoft_calendar | PASS | `ConnectAppModal.tsx:29-91` (key `ghl` maps to `AppDefinition.id = 'ghl'`, display name "GoHighLevel") |
| 5a | Plan §Chunk 8 | Per-connection actions in drawer: Test / **Edit label** / Disconnect | DIRECTIONAL_GAP | `ManageMultiConnectDrawer.tsx:174-194` — only Test and Disconnect present; no "Edit label" |
| 5b | Plan §Chunk 8 | Drawer opens only when card has ≥2 connections; single-connection cards route to "existing single-connection detail" | DIRECTIONAL_GAP | `AppIntegrationsTab.tsx:184-189` — opens drawer regardless of count; single-connection detail belongs to Chunk 10 wiring |
| 6 | Plan | Card content: letter-form avatar, name, category, status, CTA | PASS | `AppIntegrationsTab.tsx:165-198` |
| 7 | §5.4 + plan | Section-membership computed from `listConnections`; mutual exclusivity enforced | PASS | `AppIntegrationsTab.tsx:256-257` |
| 8 | Plan | Uses `listConnections` from `governApi.ts` | PASS | `AppIntegrationsTab.tsx:5, 233` |
| 9 | Plan §Chunk 8 + §17.8 | Drawer uses shared `DisconnectConfirmDialog`; type-to-confirm with subscription/connection label | DIRECTIONAL_GAP | `ManageMultiConnectDrawer.tsx:42-93` — inlines its own `DisconnectConfirmInline` (no type-to-confirm); `DisconnectConfirmDialog.tsx:32` gates on literal `"disconnect"`, not the connection label |
| 10 | §5.4 + plan | Per-app vocabulary: Gmail "Continue to Google"; HubSpot "Connect HubSpot" + "Private App Token" | PASS | `ConnectAppModal.tsx:31, 37-41` |
| 11 | §6 vocabulary palette | No "Add Connection" generic chooser, no "Operator Controller", no "sanctioned" jargon | PASS | grep negative across all three files |
| 12 | §17.7 | App Integrations card grid sections are mutually exclusive | PASS | duplicates REQ #1 evidence |
| 13 | Plan §Chunk 8 "Files to create" | Three new files at named paths exist | PASS | All three present at the spec-named paths |

---

## Mechanical fixes applied

### `client/src/pages/govern/components/ManageMultiConnectDrawer.tsx`

- **Line 309** — Removed forbidden "OAuth" label from user-visible footer copy. The plan explicitly states "NO 'OAuth' / 'API Key' / 'MCP' / 'Cookie' labels visible anywhere." The dependent clause "OAuth connections use the provider sign-in; there is no credential to paste inline." was also factually incorrect for API-key apps (HubSpot variant), so dropping it tightens the copy.
  - Before: `"To rotate credentials, disconnect and reconnect. OAuth connections use the provider sign-in; there is no credential to paste inline."`
  - After: `"To rotate credentials, disconnect and reconnect."`

Re-verification: `npm run lint` (0 errors), `npm run typecheck` (0 errors). File re-read confirmed change landed cleanly.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

- **REQ #5a** — Drawer missing the per-connection "Edit label" action named by the plan. Needs a server-side endpoint decision (label-only PATCH route does not yet exist in `governApi`) before the UI can land.
- **REQ #5b** — Drawer opens for any connection count, not only ≥2 as the plan specifies. Depends on Chunk 10's "single-connection detail" surface; route decision is cross-chunk.
- **REQ #9** — Drawer does not use the shared `DisconnectConfirmDialog`; uses an inlined confirm with no type-to-confirm gate. Separately, the pre-existing `DisconnectConfirmDialog` gates on the literal `"disconnect"` rather than the connection label that §17.8 specifies — a cross-chunk decision touching Chunks 7, 8, 9.

All three deferred items appended to `tasks/todo.md` under the dedicated heading.

---

## Notes on the pre-existing `DisconnectConfirmDialog.tsx`

Per the caller's instruction, the file was NOT modified in Chunk 8 because it already exists from a prior PR (`tasks/builds/consolidation-govern/spec.md §4.10`). Its contract observed:

- Type-to-confirm pattern: **present** (`DisconnectConfirmDialog.tsx:84-98`) but gated on the literal string `"disconnect"`, not on the subscription/connection label.
- Disabled CTA until input matches: **present** (`DisconnectConfirmDialog.tsx:32, 115`).
- Impact summary (agents/tasks/workflows): **present** (`DisconnectConfirmDialog.tsx:63-82`).

Net: the dialog supports a type-to-confirm flow, but the confirmation token differs from §17.8's wording. This was flagged as part of REQ #9 above (cross-chunk decision needed).

---

## Out-of-scope observations (not conformance gaps; for `pr-reviewer`)

Captured for `pr-reviewer` rather than acted on here:

- `AppIntegrationsTab.tsx:129` — avatar `className` contains an invalid Tailwind class `justify-content-center` immediately before the valid `justify-center`. Harmless because the valid class follows, but should be cleaned up.
- `ManageMultiConnectDrawer.tsx:100, 300` — `ConnRow` declares an `onAddAnother` prop and receives it via spread, but never uses it. Dead prop.

These are code-quality issues, not spec gaps.

---

## Files modified by this run

- `client/src/pages/govern/components/ManageMultiConnectDrawer.tsx` (footer copy)
- `tasks/todo.md` (appended deferred-items section)

---

## Next step

**NON_CONFORMANT — 3 directional gaps must be addressed by the main session before `pr-reviewer`.** See `tasks/todo.md` under "Deferred from spec-conformance review — operator-session-identity (2026-05-11)". Two of the three gaps (REQ #5b, REQ #9) require cross-chunk coordination (Chunks 9, 10) before they can be resolved cleanly. The "Edit label" gap (REQ #5a) requires a product decision on whether label editing ships in V1 and a corresponding server route.

Because mechanical fixes modified the changed-code set, `pr-reviewer` (when invoked) should run against the post-fix state.

---

## Follow-up re-verification — 2026-05-11T10:48:37Z

**Trigger:** Caller requested re-verification of Chunk 8 after fix commit `154f550a` ("chunk 8 review fixes — OAuth endpoint, subaccountId, shared disconnect dialog").

**Updated commit range:** `2885319b..154f550a` (Chunk 8 commit `76277bf9` + auto-fix commits `52fa61bb`/`8e280f12` + fix commit `154f550a`).

**HEAD at re-check:** `154f550a`

### Status of previously deferred gaps

| REQ | Prior verdict | Re-check verdict | Notes |
|---|---|---|---|
| #5a — "Edit label" action in 3-dot menu | DIRECTIONAL_GAP | **DEFERRED for V1 (accepted)** | No backend endpoint exists for label-only PATCH; same posture as Chunk 7's master toggle gap. Source file carries an in-line marker comment `// V1: label edit deferred (no backend endpoint)` at `ManageMultiConnectDrawer.tsx:122`. Caller explicitly instructed: do NOT auto-fix. `tasks/todo.md` entry remains open as the record of the deferral. |
| #5b — drawer opens for all connection counts, not only ≥2 | DIRECTIONAL_GAP | **DEFERRED to Chunk 10 (accepted)** | Chunk 10 owns the wiring between cards and single-connection detail; the branch decision lives there, not in Chunk 8. Caller explicitly instructed: do NOT auto-fix. `tasks/todo.md` entry remains open. |
| #9 — drawer should use shared `DisconnectConfirmDialog` | DIRECTIONAL_GAP | **RESOLVED (drawer side)** | Verified — see evidence block below. |

### REQ #9 resolution evidence

- `ManageMultiConnectDrawer.tsx:9` — imports the shared dialog: `import { DisconnectConfirmDialog } from './DisconnectConfirmDialog';`
- `ManageMultiConnectDrawer.tsx:315-325` — mounts the shared dialog at the bottom of the drawer portal, gated by local `disconnectTarget` state.
- `ConnRow` (`ManageMultiConnectDrawer.tsx:31-136`) — the per-row Disconnect button now calls `onDisconnectRequest(connection)` which lifts the connection up to the drawer's `setDisconnectTarget`, which mounts the shared dialog.
- Previously inlined `DisconnectConfirmInline` component is **deleted** — file shrank from 397 → 329 lines; full-file grep finds no remaining inline confirm-dialog code.
- The shared `DisconnectConfirmDialog.tsx:32` carries the type-to-confirm gate (`canConfirm = ... && (impactCount === 0 || confirmText === 'disconnect')`) and the agents/tasks/workflows impact summary (lines 63-82) that the prior inline implementation lacked.

**Residual cross-chunk concern:** the shared dialog still gates on the literal string `"disconnect"` rather than on the connection label as §17.8 prescribes. This is a pre-existing concern in `DisconnectConfirmDialog.tsx` carried over from `consolidation-govern` and touches Chunks 7, 8, and 9. The `tasks/todo.md` REQ #9 entry already captures this sub-point; updated below to reflect that the drawer-side gap is closed while the dialog-gating sub-point remains open as a separate cross-chunk decision.

### Sanity-check on previously-PASSing requirements

Re-verified by reading the post-fix files. None regressed:

| REQ | Re-check |
|---|---|
| #1 / #12 — mutually-exclusive sections | PASS — `AppIntegrationsTab.tsx:256-257, 315-351` unchanged in semantics |
| #2 — `APP_CATEGORIES` chip filter | PASS — `AppIntegrationsTab.tsx:14, 280-295` |
| #3 — no "OAuth"/"API Key"/"MCP"/"Cookie" labels visible | PASS — the prior footer-string fix held; grep confirms only code-side identifiers/comments contain these terms |
| #4 — variant map for all 9 providers | PASS — `ConnectAppModal.tsx:30-92` lists gmail/hubspot/slack/ghl/teamwork/google_drive/outlook/microsoft_calendar/google_calendar |
| #6 — card content (avatar/name/category/status/CTA) | PASS — `AppIntegrationsTab.tsx:159-201` |
| #7 — section membership from `listConnections` | PASS — `AppIntegrationsTab.tsx:230-257` |
| #8 — uses `listConnections` from `governApi.ts` | PASS — both tab (line 5) and drawer (line 6, fetches its own live list now — fix item B4) |
| #10 — per-app vocabulary (Gmail "Continue to Google"; HubSpot "Connect HubSpot" + "Private App Token") | PASS — `ConnectAppModal.tsx:32, 38-42` |
| #11 — no "Add Connection" / "Operator Controller" / "sanctioned" | PASS — grep returns 0 hits |
| #13 — three named files exist | PASS — all three present; an additional shared helper `_utils.ts` was added (not a forbidden addition; not a deletion) |

### Out-of-scope code-quality observations from prior log

Both incidentally addressed by the fix commit (commit message items B5 + S4):

- `AppIntegrationsTab.tsx:129` invalid Tailwind class `justify-content-center` — **FIXED** (line now reads cleanly with only valid Tailwind classes).
- `ManageMultiConnectDrawer.tsx` unused `onAddAnother` prop on `ConnRow` — **FIXED** (`ConnRowProps` no longer declares it).

These were not blocking gaps, but worth noting that the fix commit cleared them.

### Verification commands re-run

- `npm run lint` — 0 errors; 899 warnings (pre-existing across the repo, none new from Chunk 8 files)
- `npm run typecheck` — clean (no output, exit 0)

### Files touched in this re-verification

- `tasks/review-logs/spec-conformance-log-operator-session-identity-chunk-8-2026-05-11T10-31-11Z.md` — this follow-up section appended; prior content unchanged
- `tasks/todo.md` — REQ #9 entry updated to reflect drawer-side resolution and narrow the open scope to the cross-chunk dialog-gating sub-point; REQ #5a and REQ #5b annotated as "deferred — accepted" (no new entries added; no duplicates introduced)

### Updated summary

| Metric | Count (post-fix) |
|---|---|
| Requirements re-checked | 13 |
| PASS | 10 (was 9; #9 now PASS for the drawer-side requirement) |
| DEFERRED — accepted V1 limitation | 2 (#5a "Edit label", #5b drawer-vs-single-detail routing) |
| Cross-chunk open | 1 (the literal-"disconnect" gate inside the shared dialog — Chunks 7/8/9) |

### Revised verdict

**CONFORMANT (with documented deferrals)** for Chunk 8 in isolation. The Chunk-8-scoped portion of REQ #9 (drawer uses the shared dialog) is satisfied; the remaining gating-token concern is a cross-chunk decision that does not belong to Chunk 8 and is already routed in `tasks/todo.md`.

`pr-reviewer` may now run on the post-fix state. No further mechanical fixes are required from this agent.

**Commit at finish:** `9f9a34a4`
