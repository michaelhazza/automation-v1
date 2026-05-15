**Status:** reviewing
**Spec date:** 2026-05-15
**Last updated:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-workflowrunpage

# Split WorkflowRunPage along header / step-list / step-detail / HITL-bar seams

## 1. Goals

- Decompose `client/src/pages/subaccount/WorkflowRunPage.tsx` (952 LOC) into a thin host plus per-region files under `client/src/components/workflow-run/`, matching the convention established by batch-1 specs.
- Preserve every user-visible behaviour described in the file header comment: three-pane modal layout (header / left step list / right step detail), cancel-replay-portal kebab actions, HITL action bar (sticky), WebSocket live updates with REST fallback, 12s polling while disconnected on non-terminal runs.

## 2. Non-goals

- Visual change of any kind.
- WebSocket protocol change — `useSocketRoom('workflow-run', runId, events, onReconnectSync)` keeps the same eight event handlers, the same `onReconnectSync` resync callback, and the same reconnect semantics provided by `useSocket.ts`.
- New runtime tests beyond a single targeted Vitest file for `formatDuration` (the only pure helper this refactor extracts). The single test file covers the five cases tabled in §9. No frontend / API / E2E tests are added.

## 3. Existing primitives reused

| Primitive | Why reuse |
|---|---|
| `client/src/components/<feature>/` convention | Same as batch 1 |
| `client/src/components/ConfirmDialog.tsx` + `ui/HelpHint.tsx` | Already extracted |
| `client/src/hooks/useSocket.ts` (`useSocketRoom`, `useSocketConnected`) | Already extracted |
| `sonner` toast | Stays |
| `client/src/lib/api.ts` | Stays |
| `react-router-dom` Link / useNavigate / useParams | Stays |

No new cross-codebase / shared / design-system primitives invented. The new files under `client/src/components/workflow-run/` and the new hook under `client/src/hooks/useWorkflowRunEnvelope.ts` are feature-local extractions of code that already exists inline today — they are not reusable abstractions.

Spec-authoring checklist sections 0 (verify present state), 4 (permissions / RLS), 5 (execution-model sync/async/queued — the WS + polling fallback is described in §7 and preserved verbatim, not a new write path), and 10 (execution-safety contracts for new writes / state machines) are N/A for this frontend-only refactor.

## 4. Current structure (today)

`WorkflowRunPage.tsx` (952 LOC):

- File-header comment + type aliases (`StepType`, `SideEffectType`, `StepRunStatus`, `RunStatus`) + interfaces (`StepRun`, `StepDef`, `RunRow`, `Envelope`) at lines 24-120.
- Presentation constants (`TERMINAL_RUN_STATUSES`, `STATUS_COLORS`, `STATUS_DOT_COLORS`, `SIDE_EFFECT_COLORS`) at lines 124-162.
- Main page component `WorkflowRunPage` (166-834, ~670 LOC). Owns the entire envelope state, the default-selection logic, the WebSocket subscription (`useSocketRoom` with eight event handlers and `refresh` as `onReconnectSync`), the 12s polling fallback, the cancel / replay / portal-toggle kebab actions and their `ConfirmDialog` modals, and the inline HITL action bar logic.
- `formatDuration` (838-849) — pure helper for step timing.
- Inline `StepDetailPane` (851-952, ~100 LOC) — right-pane content for the selected step.

## 5. Target structure

```
client/src/pages/subaccount/WorkflowRunPage.tsx        ← host only (~180 LOC target)
client/src/components/workflow-run/
  ├─ types.ts                                          ← StepType, SideEffectType, StepRunStatus, RunStatus, StepRun, StepDef, RunRow, Envelope interfaces + STATUS_COLORS / STATUS_DOT_COLORS / SIDE_EFFECT_COLORS / TERMINAL_RUN_STATUSES constants
  ├─ format.ts                                         ← formatDuration helper
  ├─ __tests__/
  │   └─ format.test.ts                                ← five cases for formatDuration (see §9 table)
  ├─ RunHeader.tsx                                     ← name, version, status pill, kebab menu (Cancel / Replay / Portal toggle)
  ├─ StepDag.tsx                                       ← left-rail step list (read-only DAG)
  ├─ StepDetailPane.tsx                                ← extracted, was inline
  └─ HitlActionBar.tsx                                 ← sticky HITL bar for awaiting_input / awaiting_approval steps
client/src/hooks/
  └─ useWorkflowRunEnvelope.ts                         ← orchestrates the GET envelope + WS subscription + 12s polling fallback (see §7)
```

Host import path in `App.tsx` is unchanged.

## 6. Component tree

```
WorkflowRunPage (host, ~180 LOC)
│
├── <RunHeader … />                                              ← see §8.1 for the full prop list (abbreviated here)
├── two-pane body
│    ├── <StepDag … />                                            ← see §8.2
│    └── <StepDetailPane stepRun, stepDef />
└── <HitlActionBar stepRun, runId, stepDef, onActionTaken />     ← host renders this only when (selectedStep?.status === 'awaiting_input' || selectedStep?.status === 'awaiting_approval'); the component itself assumes a non-null actionable stepRun
```

The host's job: call `useWorkflowRunEnvelope(subaccountId, runId)` (which returns `selectedStepRunId` + `setSelectedStepRunId` as well as the envelope — see §7), compose the four region components, and supply the four header callbacks (`onCancel` / `onReplay` / `onPortalToggle` and the HITL `onActionTaken`) which all call `refetch()` on success.

## 7. Data-fetching ownership

### `useWorkflowRunEnvelope(subaccountId, runId)`

Signature: `useWorkflowRunEnvelope(subaccountId: string | undefined, runId: string | undefined): { envelope: Envelope | null; loading: boolean; error: string | null; refetch: () => Promise<void>; socketConnected: boolean; selectedStepRunId: string | null; setSelectedStepRunId(id: string | null): void }`.

Both params come from `useParams()` in the host. When either is missing, `refetch()` is a no-op (matches today's guard `if (!subaccountId || !runId) return;` at WorkflowRunPage.tsx:178).

Owns:
- `envelope: Envelope | null` state, `loading` / `error` state.
- Initial GET `/api/subaccounts/${subaccountId}/workflow-runs/${runId}/envelope` on mount.
- Default-selection logic preserved verbatim from WorkflowRunPage.tsx:187-196: prefer the existing selection if still present; else first `awaiting_*` step; else first `running` step; else first step.
- `useSocketRoom('workflow-run', runId, events, refetch)` subscription. The fourth argument is the `onReconnectSync` callback — when the socket reconnects, `refetch()` runs to pull a fresh REST baseline. The events map is verbatim from WorkflowRunPage.tsx:217-225: `Workflow:run:status`, `Workflow:run:bulk_fanout`, `Workflow:step:dispatched`, `Workflow:step:completed`, `Workflow:step:failed`, `Workflow:step:awaiting_input`, `Workflow:step:awaiting_approval`, `Workflow:step:run_now_skipped_replay` — each calls `refetch()`.
- 12s polling fallback effect — fires only while `!socketConnected && envelope?.run.status` is non-terminal (per `TERMINAL_RUN_STATUSES` in `types.ts`).
- `refetch()` callback exposed to consumers (action handlers call this after Cancel / Replay / Portal toggle / HITL action succeeds).

Returns: `{ envelope, loading, error, refetch, socketConnected, selectedStepRunId, setSelectedStepRunId }`. `selectedStepRunId` lives inside the hook so the default-selection logic stays co-located with the envelope it derives from.

**Not in the hook contract.** The topological sort that produces `orderedStepRuns` (today's `useMemo` at WorkflowRunPage.tsx:257-268) stays in the host across all six chunks of this refactor — it's a small derivation that doesn't need to move. Same for `stepDefById` and `selectedStep` (the resolved step record). The Deferred Items section flags promoting these into the hook if a second consumer emerges.

The host wires all action handlers (Cancel / Replay / Portal toggle / HITL approve / HITL reject / HITL respond) to call `refetch()` on success.

The WS room identifier is the `(roomType, roomId)` pair, not a colon-joined string. `useSocketRoom` emits `join:workflow-run` with `runId` as the payload and `leave:workflow-run` on cleanup — preserved verbatim from `client/src/hooks/useSocket.ts`.

## 8. Prop contracts

### 8.1 `<RunHeader>`
```
props: {
  run: RunRow;                       // from types.ts
  definition: Envelope['definition'];
  stepRuns: StepRun[];               // for the completedSteps / totalSteps line
  socketConnected: boolean;          // for the "⚠ polling" pill
  subaccountId: string;              // for the back-link href only
  onCancel(): void | Promise<void>;       // host's handleCancelRun is async; header invokes it from the Cancel ConfirmDialog
  onReplay(): void | Promise<void>;       // host's handleReplayRun is async; header invokes it from the Replay ConfirmDialog
  onPortalToggle(): void | Promise<void>; // host's portal-toggle handler is async; header invokes it from the kebab item
}
```
Renders the back-link, title block (name + version + onboarding / portal-visible pills), the metadata line (`completedSteps / totalSteps · mode … · started …`), the status pill, the optional `⚠ polling` indicator, the kebab dropdown (Cancel / Replay / Portal toggle / Edit template in Studio), and the run-error box.

Fields read off the props (no other implicit dependencies):
- Back-link href: `subaccountId ? '/admin/subaccounts/${subaccountId}' : '/'`
- Title: `definition?.name ?? run.WorkflowSlug ?? 'Workflow run'`; version pill from `definition?.version`.
- Onboarding / portal pills: `run.isOnboardingRun`, `run.isPortalVisible`.
- Metadata line: `stepRuns.filter(s => s.status === 'completed').length` / `definition?.steps?.length ?? stepRuns.length` · `run.runMode` · `run.startedAt`.
- Edit-template link: rendered only when `definition?.slug` is set; `to={'/system/workflow-studio?slug=' + encodeURIComponent(definition.slug)}` (preserved verbatim from WorkflowRunPage.tsx:552-561).
- Run-error box: rendered only when `run.error` is non-null; displays `run.error` plus optionally `run.failedDueToStepId` (preserved verbatim from WorkflowRunPage.tsx:566-576).
- Cancellable: `!TERMINAL_RUN_STATUSES.includes(run.status) && run.status !== 'cancelling'` (gates the kebab's "Cancel run" item). Owns the kebab open/closed local state, the document-level click-to-close effect, and the two `ConfirmDialog` modals for Cancel and Replay (the header renders the modals and triggers `onCancel()` / `onReplay()` on confirm; the host owns the action handlers themselves — `handleCancelRun` / `handleReplayRun` — which fire the toasts and call `refetch()`). `onPortalToggle()` is `async` because today's implementation awaits the PATCH before refetching — the host's handler does the PATCH + toast + `refetch()`, the header just invokes it.

### 8.2 `<StepDag>`
```
props: {
  stepRuns: StepRun[];               // already topologically ordered by the host
  stepDefById: Map<string, StepDef>;
  selectedStepRunId: string | null;
  onSelectStepRun(stepRunId: string): void;
}
```
Read-only DAG list. Renders the step rows with status dots and pills; click selects the step. No internal data fetch. The host passes `orderedStepRuns` (today's topological sort at WorkflowRunPage.tsx:257-268 — preserved verbatim).

### 8.3 `<StepDetailPane>`
```
props: {
  stepRun: StepRun;
  stepDef: StepDef | null;
}
```
Right-pane content. Renders step type / timing / input / output / error / depends-on sections. Prop shape is identical to today's inline component at WorkflowRunPage.tsx:851-857 — see §10 Chunk 3 note. No mutation handlers — those belong on `<HitlActionBar>` (which renders only when the step requires action).

The host renders this only when `selectedStep` is non-null; the "Select a step on the left to view its detail." placeholder stays in the host, matching today's `selectedStep ? <StepDetailPane … /> : <placeholder />` ternary at WorkflowRunPage.tsx:636-645.

### 8.4 `<HitlActionBar>`
```
props: {
  stepRun: StepRun;                  // non-null; host guards on stepRun.status before rendering
  stepDef: StepDef | null;           // for approvalPrompt rendering
  runId: string;
  onActionTaken(): Promise<void>;    // calls refetch() in the host
}
```
**Render contract.** The host decides whether to render `<HitlActionBar>` (guard: `selectedStep?.status === 'awaiting_input' || selectedStep?.status === 'awaiting_approval'`). The component itself does not re-check the status — it assumes the host's guard already passed and that `stepRun` is the actionable step. This keeps the conditional in one place and lets the component focus on the form state. (Today's host renders this same conditional inline at WorkflowRunPage.tsx:649-651, preserved verbatim.)

Owns the action-form local state internally (`inputFormOpen`, `inputFormData`, `editApproveOpen`, `editApproveData`, `actionSubmitting`, `actionError`) and the effect that resets the forms when `stepRun.id` changes (preserved from WorkflowRunPage.tsx:293-299).

Endpoints called (preserved verbatim from today's host):
- `POST /api/workflow-runs/${runId}/steps/${stepRunId}/input` with `{ data: parsed, expectedVersion: stepRun.version }` — the awaiting-input path.
- `POST /api/workflow-runs/${runId}/steps/${stepRunId}/approve` with `{ decision: 'approved' | 'rejected' | 'edited', editedOutput?: Record<string, unknown>, expectedVersion: stepRun.version }` — the awaiting-approval path.

On 2xx, the bar fires `onActionTaken()` which triggers the host's `refetch()`. On non-2xx, the bar surfaces the server's `response.data.error` message inline in `actionError`. Toast wording is preserved verbatim — see §12 for the inventory.

## 9. Pure-helper / constant extraction

Move `formatDuration` to `format.ts` (today's lines 838-849). Test file `__tests__/format.test.ts` is one Vitest file covering the five cases of the pure helper:

| Case | Input | Expected |
|---|---|---|
| Both timestamps present, sub-second | `formatDuration('2026-05-15T00:00:00.000Z', '2026-05-15T00:00:00.045Z')` | `'45ms'` |
| Both timestamps present, sub-minute | `formatDuration('2026-05-15T00:00:00.000Z', '2026-05-15T00:00:02.300Z')` | `'2.3s'` |
| Both timestamps present, multi-minute | `formatDuration('2026-05-15T00:00:00.000Z', '2026-05-15T00:01:23.000Z')` | `'1m 23s'` |
| `startedAt: null` | `formatDuration(null, '2026-05-15T00:00:00.000Z')` | `null` |
| `completedAt: null` (running step) | freezes `Date.now()` with `vi.useFakeTimers()` + `vi.setSystemTime('2026-05-15T00:00:02.300Z')`, calls `formatDuration('2026-05-15T00:00:00.000Z', null)` | `'2.3s'` |

The type aliases and interfaces at lines 24-120 (`StepType`, `SideEffectType`, `StepRunStatus`, `RunStatus`, `StepRun`, `StepDef`, `RunRow`, `Envelope`) plus the presentation constants at lines 124-162 (`TERMINAL_RUN_STATUSES`, `STATUS_COLORS`, `STATUS_DOT_COLORS`, `SIDE_EFFECT_COLORS`) move to `types.ts`. Each region file imports from `types.ts` directly — no barrel `index.ts` is introduced.

## 10. Migration plan

### Chunk 1 — Extract `types.ts` + `format.ts` + tests
- Create `types.ts` with the type aliases (`StepType`, `SideEffectType`, `StepRunStatus`, `RunStatus`), the interfaces (`StepRun`, `StepDef`, `RunRow`, `Envelope`), and the presentation constants (`TERMINAL_RUN_STATUSES`, `STATUS_COLORS`, `STATUS_DOT_COLORS`, `SIDE_EFFECT_COLORS`).
- Create `format.ts` with `formatDuration`.
- Create `__tests__/format.test.ts` (the five cases in §9).
- Update host imports.

### Chunk 2 — Extract `useWorkflowRunEnvelope` hook
- Create `client/src/hooks/useWorkflowRunEnvelope.ts`. Move envelope state, default-selection logic, mount fetch, `useSocketRoom` subscription (with `refetch` as the `onReconnectSync` callback), polling effect, refetch callback.
- Host replaces ~80 lines of state + effects with one hook call.
- **Interim state.** After Chunk 2, all action handlers (Cancel / Replay / Portal toggle / HITL submit-input / HITL approve / HITL reject) still live in the host and call `refetch()` on success. They will move out in Chunks 4 and 5; the host owns them in the meantime.

### Chunk 3 — Extract `StepDetailPane`
- Move the existing function at WorkflowRunPage.tsx:851-952 into its own file. Today's prop shape `{ stepRun: StepRun; stepDef: StepDef | null }` is preserved verbatim — that matches §8.3 above, no prop-shape change.

### Chunk 4 — Extract `RunHeader` + `StepDag`
- Create RunHeader.tsx with the back-link, title block, metadata line, status pill, polling indicator, kebab dropdown, run-error box, and the two `ConfirmDialog` modals. The header's `onCancel` / `onReplay` / `onPortalToggle` callbacks are wired by the host to the (still host-owned) `handleCancelRun` / `handleReplayRun` / portal-toggle async handlers.
- Create StepDag.tsx with the left-rail step list. The host passes `orderedStepRuns` (topological sort stays in the host until the hook absorbs it; it can move into the hook later if a second consumer needs it).

### Chunk 5 — Extract `HitlActionBar`
- Pull the sticky HITL bar logic out of the host into a dedicated file. The form-state effect, the `submitStepInput` / `decideApproval` action handlers, and the inline error rendering all move into the new component.
- On success they call `onActionTaken()` so the host's `refetch()` fires; on failure they surface the inline `actionError`.

### Chunk 6 — Verify + cleanup
- Run lint, typecheck, build:client, and `npx vitest run client/src/components/workflow-run/__tests__/format.test.ts`.
- Confirm host ≤ 200 LOC.
- Sweep unused imports.
- Confirm the `App.tsx` import path for `WorkflowRunPage` is unchanged and the default-export signature still matches `(_props: { user: User }) => JSX.Element`.

## 11. Deferred Items

- **Shared step-status badge component.** Today the StepDag and StepDetailPane both render their own status pills. A shared `<StepStatusBadge>` is tempting but defer until 3+ surfaces need it.
- **Promote `useWorkflowRunEnvelope` to a more generic `useRunEnvelope`** that other run-types could consume. No second consumer today; defer.
- **Move `orderedStepRuns` / `stepDefById` derivations into the hook.** Today (and after this refactor) they live in the host as small `useMemo` blocks. If a second consumer of the hook emerges or the host approaches the 200-LOC ceiling, fold them in.

## 12. Self-consistency

- WebSocket room: `useSocketRoom('workflow-run', runId, ...)` (the room identifier is the `(roomType, roomId)` pair handled inside `useSocket.ts`; preserved verbatim).
- WS event handlers — all eight (`Workflow:run:status`, `Workflow:run:bulk_fanout`, `Workflow:step:dispatched`, `Workflow:step:completed`, `Workflow:step:failed`, `Workflow:step:awaiting_input`, `Workflow:step:awaiting_approval`, `Workflow:step:run_now_skipped_replay`) — preserved verbatim, each calls `refetch()`.
- `onReconnectSync` is `refetch` — preserved verbatim.
- 12s polling fallback active only while disconnected AND non-terminal — preserved.
- Cancel / Replay / Portal-toggle / Edit-template kebab order — preserved.
- HITL bar sticky positioning — preserved.

### 12.1 Toast inventory (preserved verbatim)

| Trigger | Toast | Source location today |
|---|---|---|
| Submit step input succeeded | `toast.success('Input submitted')` | WorkflowRunPage.tsx:312 |
| Approval decision: approved | `toast.success('Step approved')` | WorkflowRunPage.tsx:338-344 |
| Approval decision: edited | `toast.success('Output edited and approved')` | WorkflowRunPage.tsx:338-344 |
| Approval decision: rejected | `toast.success('Step rejected')` | WorkflowRunPage.tsx:338-344 |
| Cancel run requested | `toast.success('Cancellation requested')` | WorkflowRunPage.tsx:359 |
| Cancel run failed | `toast.error(server.error ?? 'Failed to cancel run')` | WorkflowRunPage.tsx:362-365 |
| Replay run created | `toast.success('Replay run created')` | WorkflowRunPage.tsx:375 |
| Replay run failed | `toast.error(server.error ?? 'Failed to create replay run')` | WorkflowRunPage.tsx:380-383 |
| Portal toggle on | `toast.success('Published to portal')` | WorkflowRunPage.tsx:528-532 |
| Portal toggle off | `toast.success('Hidden from portal')` | WorkflowRunPage.tsx:528-532 |
| Portal toggle failed | `toast.error(server.error ?? 'Failed to toggle portal visibility')` | WorkflowRunPage.tsx:535-538 |

Toasts that move with their handler: the four HITL success toasts go to `HitlActionBar`. All seven other toasts (two cancel, two replay, three portal-toggle) stay in the host. Pattern: the kebab UI and the two `ConfirmDialog` modals move to `RunHeader`; the mutation + toast + `refetch()` implementation stays host-owned and is invoked via the `onCancel` / `onReplay` / `onPortalToggle` callbacks. This keeps the API mutations co-located with the `refetch()` they need to call.

**HITL failure path.** Today's HITL handlers (submit-input, approve, reject, edited-approve) do NOT fire a toast on failure — they surface `response.data.error` inline in `actionError` and leave the form open so the user can retry (WorkflowRunPage.tsx:314-321 + 346-353). This behaviour is preserved verbatim by `HitlActionBar`. Hence the inventory above lists only the four HITL success toasts.

## 13. Acceptance criteria

- Host shrinks to ≤ 200 LOC.
- §5 directory diff matches exactly: 4 region files (`RunHeader.tsx`, `StepDag.tsx`, `StepDetailPane.tsx`, `HitlActionBar.tsx`) + `types.ts` + `format.ts` + `__tests__/format.test.ts` under `client/src/components/workflow-run/`, plus `useWorkflowRunEnvelope.ts` under `client/src/hooks/`. No extras, no missing files.
- Mandatory automated checks (gate the merge): `npm run lint`, `npm run typecheck`, `npm run build:client`, and `npx vitest run client/src/components/workflow-run/__tests__/format.test.ts` all pass locally. The full CI suite runs as the pre-merge gate (per CLAUDE.md test-gates-are-CI-only).
- `App.tsx` import path for `WorkflowRunPage` unchanged; default-export signature still `(_props: { user: User }) => JSX.Element`.
- Author-side manual smoke (mandatory before opening the PR; not automated): run loads, step selection works, status pills correct, cancel / replay / portal actions fire and refresh, HITL approve / reject / edited approve / submit input actions succeed (success toasts fire, failure surfaces inline `actionError` with no toast), the "⚠ polling" indicator appears when the WS disconnects on a non-terminal run, and the 12s poll fires while disconnected.

## 14. Open questions

- None. Pattern established by batch 1; the contracts for subaccount-ID propagation, HITL endpoints, portal-toggle behaviour, and the eight WS event names are all pinned in §7 and §8 above.
