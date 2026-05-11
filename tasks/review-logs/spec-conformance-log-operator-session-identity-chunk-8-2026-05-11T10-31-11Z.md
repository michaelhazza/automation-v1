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
