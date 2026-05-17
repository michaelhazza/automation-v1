# Spec Review Log — feat-split-workflowrunpage — Iteration 1

**Timestamp:** 2026-05-15T01-58-28Z
**Codex command:** `codex exec --skip-git-repo-check "<review prompt>"` (stdin-fed spec body; the legacy `codex review --file` flag is not supported in the installed Codex CLI build)

## Findings & dispositions

### Codex findings

**F1 — §5 hook listed in two places** — Source: Codex
- Description: `useWorkflowRunEnvelope.ts` appears under both `client/src/components/workflow-run/` and `client/src/hooks/`.
- Classification: mechanical
- Disposition: ACCEPT — listed once under `client/src/hooks/` only; the `workflow-run/` directory drops the duplicate entry.

**F2 — §6 tree shows `onActionTaken` on `<StepDetailPane>` but §8.3 omits it** — Source: Codex
- Classification: mechanical
- Disposition: ACCEPT — removed `onActionTaken` from §6 tree; rewrote tree to align with §8 prop names (`stepRuns`, `stepDefById`, `selectedStepRunId`, `onSelectStepRun`, etc.).

**F3 — §3 "No new primitives invented" contradicts §5 file additions** — Source: Codex
- Classification: mechanical (same pattern resolved in batch-1 UsagePage spec)
- Disposition: ACCEPT — clarified "No new cross-codebase / shared / design-system primitives" wording. Also added a one-line declaration that checklist §0/§4/§5/§10 are N/A for this frontend-only refactor.

**F4 — §7 vs §12 WS room/event naming inconsistency** — Source: Codex
- Classification: mechanical
- Disposition: ACCEPT — §7 now states the actual `useSocketRoom('workflow-run', runId, events, refetch)` signature, lists all eight real event names from WorkflowRunPage.tsx:217-225 verbatim, and explains the `(roomType, roomId)` pair identity. §12 toast inventory + room/event bullets updated to match.

**F5 — §2 tests language vs §9/§10/§13 requirement** — Source: Codex
- Classification: mechanical
- Disposition: ACCEPT — §2 now declares the single Vitest file as the only runtime test added (matches §9 five cases and §13 acceptance line). Removed the "if it grows" hedge.

**F6 — Hook signature missing `subaccountId`** — Source: Codex (critical)
- Classification: mechanical (load-bearing claim without supporting mechanism)
- Disposition: ACCEPT — signature changed to `useWorkflowRunEnvelope(subaccountId, runId)` matching today's `useParams<{ subaccountId; runId }>()`. No-op guard pinned. Default-selection logic pinned line-for-line from WorkflowRunPage.tsx:187-196. Return type extended to expose `selectedStepRunId`/`setSelectedStepRunId` so the default-selection lives with the envelope it derives from.

**F7 — `<RunHeader>` onPortalToggle contract** — Source: Codex
- Classification: mechanical (pin behaviour preserved from today)
- Disposition: ACCEPT — §8.1 expanded to list every prop the header reads (`run`, `definition`, `stepRuns`, `socketConnected`, `subaccountId`) and to document that `onPortalToggle()` is `async` because today's host awaits the PATCH before refetching. The host owns the PATCH + toasts; the header just invokes the callback.

**F8 — `<HitlActionBar>` API contract** — Source: Codex (critical)
- Classification: mechanical (pin endpoints + payload shapes already in code)
- Disposition: ACCEPT — §8.4 now lists both endpoints (`POST /api/workflow-runs/${runId}/steps/${stepRunId}/input` and `…/approve`), both payload shapes including `expectedVersion: stepRun.version`, and which form-state lives inside the component vs the host.

**F9 — Chunk 2 vs Chunk 5 interim ownership gap** — Source: Codex
- Classification: mechanical
- Disposition: ACCEPT — Chunk 2 now ends with an "Interim state" paragraph stating that all action handlers stay in the host calling `refetch()` until Chunks 4-5 move them.

**F10 — Chunk 3 "no prop-shape change" vs §8.3 new shape** — Source: Codex
- Classification: mechanical
- Disposition: ACCEPT — §8.3 corrected to `{ stepRun: StepRun; stepDef: StepDef | null }` (matches today's inline at WorkflowRunPage.tsx:851-857); Chunk 3 wording reconciled.

**F11 — "All G1 gates green" undefined** — Source: Codex
- Classification: mechanical
- Disposition: ACCEPT — §13 expanded to list the four commands that run locally; explicit "CI runs the full gate suite" note added so the spec doesn't accidentally instruct local gate execution (per CLAUDE.md test-gates-are-CI-only rule).

**F12 — Toast inventory missing** — Source: Codex
- Classification: mechanical
- Disposition: ACCEPT — §12.1 added with eleven toast rows (location + verbatim string) plus a sentence on which toasts move with `HitlActionBar` vs which stay in the host.

**F13 — §13 acceptance count ambiguous from F1 duplication** — Source: Codex
- Classification: mechanical (cascade fix from F1)
- Disposition: ACCEPT — §13 directory-diff line now lists exact file names and locations, no count ambiguity.

**F14 — §14 "None" not credible** — Source: Codex
- Classification: mechanical (cascade fix from F6/F7/F8)
- Disposition: ACCEPT — §14 wording tightened to point at the now-pinned contracts in §7 and §8.

### Rubric findings (own pass)

**R1 — Frontmatter status update** — Source: Rubric (Section 11)
- Classification: mechanical
- Disposition: ACCEPT — `Status:` changed from `draft` to `reviewing` because the spec is now in the reviewer loop.

**R2 — Spec didn't mention `onReconnectSync` callback that today's code passes** — Source: Rubric (load-bearing claim without mechanism)
- Classification: mechanical
- Disposition: ACCEPT — folded into F4's fix; §7 now pins `refetch` as the `onReconnectSync` callback and §12 lists it as a preserved bullet.

**R3 — Presentation constants (`STATUS_COLORS`, `STATUS_DOT_COLORS`, `SIDE_EFFECT_COLORS`, `TERMINAL_RUN_STATUSES`) referenced in prose but missing from §5 inventory** — Source: Rubric (file-inventory drift)
- Classification: mechanical
- Disposition: ACCEPT — `types.ts` row in §5 now lists the four constants alongside the interfaces. Chunk 1 wording updated to include them.

**R4 — §4 "current structure" line counts loose** — Source: Rubric
- Classification: mechanical
- Disposition: ACCEPT — §4 tightened to reflect that the type block runs to line 120 (the four interfaces follow the four aliases) and the presentation constants live at lines 124-162.

## Counts

- mechanical_accepted: 14 (F1-F14, all accepted with the noted refinements) + 4 (R1-R4)
- mechanical_rejected: 0
- directional_or_ambiguous: 0
- reclassified_to_directional: 0

## Iteration 1 Summary

- Mechanical findings accepted:  18
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
- Spec commit after iteration:   (set after Step 8b commit)
