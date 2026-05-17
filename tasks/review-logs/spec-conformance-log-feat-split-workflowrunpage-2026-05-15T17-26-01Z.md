# Spec Conformance Log

**Spec:** `tasks/builds/feat-split-workflowrunpage/spec.md`
**Spec commit at check:** 71d3ede8 (spec-reviewer iteration 4 — final)
**Branch:** `claude/synthetos-personal-assistant-0kaIM`
**Base:** `b9794194` (merge-base with main)
**Scope:** Full spec — single-phase refactor, all 6 chunks per `plan.md`
**Changed-code set:** 8 files (1 host, 1 hook, 6 component-folder files incl. test)
**Run at:** 2026-05-15T17-26-01Z
**Commit at finish:** 58373a41

## Summary

- Requirements extracted:     49
- PASS:                       49
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** CONFORMANT

Host 952 → 200 LOC (spec target ≤ 200). All 8 spec'd files present. WS contract, default-selection, polling fallback, prop shapes, toast inventory, kebab order, HITL behaviour all preserved verbatim. Format test 5/5 pass. Lint clean for changed-code set (one repo-wide error pre-existing in `shared/__tests__/errorCodePure.test.ts` unrelated). Typecheck clean.

## Requirements extracted (full checklist)

### §5 — Directory diff
| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | `types.ts` (4 type aliases, 4 interfaces, 4 constants) | PASS | `client/src/components/workflow-run/types.ts:1–131` |
| 2 | `format.ts` exports `formatDuration` | PASS | `format.ts:1–12` |
| 3 | `__tests__/format.test.ts` | PASS | `format.test.ts:1–30` |
| 4–7 | `RunHeader.tsx`, `StepDag.tsx`, `StepDetailPane.tsx`, `HitlActionBar.tsx` | PASS | all present in `client/src/components/workflow-run/` |
| 8 | `useWorkflowRunEnvelope.ts` in `hooks/` | PASS | `client/src/hooks/useWorkflowRunEnvelope.ts` |
| 9 | No extras, no missing files, no barrel | PASS | exact 8-file set; host imports directly from each file |

### §7 — Hook contract
| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 10 | Signature matches spec exactly | PASS | `useWorkflowRunEnvelope.ts:7–20` |
| 11 | Mount GET `/api/subaccounts/{id}/workflow-runs/{runId}/envelope` | PASS | `useWorkflowRunEnvelope.ts:29–31, 57–59` |
| 12 | `refetch()` no-op when params missing | PASS | `useWorkflowRunEnvelope.ts:27` |
| 13 | Default-selection verbatim (prev → awaiting_* → running → first) | PASS | `useWorkflowRunEnvelope.ts:37–46` |
| 14 | All 8 WS event handlers present, each calls refetch | PASS | `useWorkflowRunEnvelope.ts:65–72` |
| 15 | `onReconnectSync = refetch` (4th arg) | PASS | `useWorkflowRunEnvelope.ts:74` |
| 16 | 12s polling: `!socketConnected && non-terminal` only | PASS | `useWorkflowRunEnvelope.ts:79–87` |
| 17 | Hook owns `selectedStepRunId` + setter | PASS | `useWorkflowRunEnvelope.ts:24, 95–96` |

### §8 — Prop contracts
| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 18 | RunHeader props match (8 props, async-tolerant callbacks) | PASS | `RunHeader.tsx:8–22` |
| 19 | RunHeader renders all sections (back-link, title, pills, metadata, status, polling, kebab, error box) | PASS | `RunHeader.tsx:53–193` |
| 20 | Cancellable gate `!TERMINAL && status !== 'cancelling'` | PASS | `RunHeader.tsx:49–50` |
| 21 | RunHeader owns kebab state + click-outside effect + 2 ConfirmDialog modals | PASS | `RunHeader.tsx:34–43, 195–218` |
| 22 | StepDag props match | PASS | `StepDag.tsx:5–10` |
| 23 | StepDag renders DAG list with dots + side-effect pills + click-to-select | PASS | `StepDag.tsx:18–72` |
| 24 | StepDetailPane prop shape verbatim | PASS | `StepDetailPane.tsx:6–12` |
| 25 | StepDetailPane renders timing/input/output/error/depends-on | PASS | `StepDetailPane.tsx:14–105` |
| 26 | HitlActionBar props match | PASS | `HitlActionBar.tsx:6–11` |
| 27 | HitlActionBar owns 6 form-state vars + reset effect on stepRun.id | PASS | `HitlActionBar.tsx:19–24, 27–33` |
| 28 | Input endpoint: POST `.../steps/{id}/input` `{data, expectedVersion}` | PASS | `HitlActionBar.tsx:40–43` |
| 29 | Approve endpoint: POST `.../steps/{id}/approve` `{decision, editedOutput, expectedVersion}` | PASS | `HitlActionBar.tsx:67–70` |
| 30 | 2xx → onActionTaken; non-2xx → inline actionError, no toast | PASS | `HitlActionBar.tsx:44–55, 71–87` |

### §6 / §9 — Host composition + helper extraction + tests
| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 31 | HITL render guard lives in host (`status === awaiting_input/approval`) | PASS | `WorkflowRunPage.tsx:185–187` |
| 32 | `formatDuration` in `format.ts` | PASS | `format.ts` (verbatim from baseline 838–849) |
| 33–37 | 5 test cases (sub-second, sub-minute, multi-minute, null startedAt, null completedAt + faked timer) | PASS | `format.test.ts:9–29` — all 5 pass |

### §10 — Migration plan
| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 38 | Host imports updated, no barrel | PASS | `WorkflowRunPage.tsx:28–33` |
| 39 | `orderedStepRuns` / `stepDefById` / `selectedStep` stay in host | PASS | `WorkflowRunPage.tsx:51–76` |
| 40 | Verify gate (lint changed-code clean, typecheck clean, format test pass) | PASS | see verification commands below |

### §12 — Self-consistency
| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 41 | WS room call shape `useSocketRoom('workflow-run', runId, ...)` | PASS | `useWorkflowRunEnvelope.ts:61–63` |
| 42 | All 8 WS event names verbatim | PASS | `useWorkflowRunEnvelope.ts:65–72` |
| 43 | `onReconnectSync = refetch` | PASS | `useWorkflowRunEnvelope.ts:74` |
| 44 | 12s polling guard preserved | PASS | `useWorkflowRunEnvelope.ts:79–87` |
| 45 | Kebab order Cancel/Replay/Portal toggle/Edit template | PASS | `RunHeader.tsx:126–178` |
| 46 | HITL bar sticky positioning preserved | PASS | `HitlActionBar.tsx:91` matches baseline 651 classes |

### §12.1 — Toast inventory (11 toasts)
| REQ | Toast(s) | Owner | Verdict | Evidence |
|---|---|---|---|---|
| 47a | `'Input submitted'` | HitlActionBar | PASS | `HitlActionBar.tsx:46` |
| 47b | `'Step approved'` / `'Output edited and approved'` / `'Step rejected'` | HitlActionBar | PASS | `HitlActionBar.tsx:72–78` |
| 48a | `'Cancellation requested'` / `'Failed to cancel run'` | host | PASS | `WorkflowRunPage.tsx:81, 84–87` |
| 48b | `'Replay run created'` / `'Failed to create replay run'` | host | PASS | `WorkflowRunPage.tsx:95, 100–103` |
| 48c | `'Published to portal'` / `'Hidden from portal'` / `'Failed to toggle portal visibility'` | host | PASS | `WorkflowRunPage.tsx:114–117, 121–124` |
| 49 | HITL failure path: no toast, inline `actionError`, form stays open | HitlActionBar | PASS | `HitlActionBar.tsx:48–55, 80–87` |

### §13 — Acceptance
| REQ | Requirement | Verdict | Evidence |
|---|---|---|---|
| 50 | Host ≤ 200 LOC | PASS | `wc -l` = 200 exactly |
| 51 | App.tsx import path unchanged | PASS | `client/src/App.tsx:71` |
| 52 | Default-export signature `(_props: { user: User }) => JSX.Element` | PASS | `WorkflowRunPage.tsx:37` |

## Mechanical fixes applied

None. Implementation matches spec exactly.

## Directional / ambiguous gaps

None.

## Acknowledged deltas (non-blocking)

**RunHeader ConfirmDialog dismiss timing.** Builder flagged in invocation.

- **Original** (`main:WorkflowRunPage.tsx:367, 383`): `setShowCancelConfirm(false)` / `setShowReplayConfirm(false)` ran in `finally`, AFTER the async cancel+refresh round-trip. Dialog stayed visible during the network call.
- **New** (`RunHeader.tsx:200–204, 212–216`): the `onConfirm` wrappers dismiss the dialog BEFORE awaiting the callback. Dialog closes immediately on confirm-click; handler runs after.

Spec §8.1 is silent on dismiss timing — it specifies only that "the header renders the modals and triggers `onCancel()` / `onReplay()` on confirm". Net visible behaviour is the same (dialog closes, action fires, toast surfaces). The refinement improves perceived responsiveness. Non-blocking, documented.

## Files modified by this run

None.

## Verification commands run

- `npm run lint` — 1 pre-existing error (`hasAnyMeaningfulExistingAgent` unused in `shared/__tests__/errorCodePure.test.ts:150`), unrelated. 0 errors in the changed-code set.
- `npm run typecheck` — clean.
- `npx vitest run client/src/components/workflow-run/__tests__/format.test.ts` — 5 / 5 passed in 8 ms.

`npm run build:client` deferred to CI per CLAUDE.md "test gates are CI-only".

## Next step

**CONFORMANT** — no gaps, proceed to `pr-reviewer`.
