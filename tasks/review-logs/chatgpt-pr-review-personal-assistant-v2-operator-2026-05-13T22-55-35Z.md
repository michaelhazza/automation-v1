# ChatGPT PR Review — personal-assistant-v2-operator

## Session Info

- **PR:** [#299](https://github.com/michaelhazza/automation-v1/pull/299) — Personal Assistant V2 (Operator Mode)
- **Branch:** `claude/personal-assistant-post-merge-audit`
- **Build slug:** `personal-assistant-v2-operator`
- **Spec:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md` (APPROVED at `e27a218a`)
- **Mode:** manual
- **Started:** 2026-05-13T22:55:35Z
- **Coordinator:** finalisation-coordinator (inline, no SendMessage available in this environment — chatgpt-pr-review sub-agent was bootstrapped but its session continuation is handled directly by the coordinator)
- **Diff baseline (Round 1):** `.chatgpt-diffs/pr299-round1-code-diff.diff` (67 files, 204 KB)

## Round 1 — 2026-05-13T22-55-35Z

### ChatGPT Verdict
CHANGES_REQUESTED — 5 blockers (F1–F5) + 2 should-fix (T1–T2).

### Findings

| # | Severity | Type | Triage | Recommendation | Status |
|---|----------|------|--------|----------------|--------|
| F1 | blocker | technical | watcher IPC content gap | IMPLEMENT (partial) — fix wasteful read; document metadata-only contract; backlog host bridge | applied |
| F2 | blocker | technical | migration 0349 stale + unsafe down | IMPLEMENT — delete the migration entirely (columns already in 0348) | applied |
| F3 | blocker | technical | timeout window uses createdAt | IMPLEMENT — new column `substep_status_updated_at`, sweep filters on it | applied |
| F4 | blocker | technical | ask_initiator non-atomic event emit | IMPLEMENT — proposeAction first, gate event on `isNew` | applied |
| F5 | blocker | technical | Arm 2 over-broad visibility | IMPLEMENT — remove Arm 2 entirely; explicit-approver only; backlog V1 arm | applied |
| T1 | should-fix | technical | projection test asserts narrower set than impl | IMPLEMENT — update test to assert full allowed set | applied |
| T2 | should-fix | technical | template placeholder vs runtime logic | DEFER — README/Dockerfile/entrypoint all say PLACEHOLDER; promote-to-built routed to backlog | deferred |

### Decisions log

**F1 — Watcher IPC content gap**
- Triaged technical (internal contract / no user-visible change).
- Recommendation: IMPLEMENT (partial). The watcher already runs as a placeholder (template is documented as not-built-by-CI, README explicitly says real implementation lands with operator-backend infra pipeline). The watcher's `process.send` is guarded — in placeholder mode it logs and drops. The PR is consistent with that framing, BUT the IPC payload shape didn't match what `handleWatcherEvent` consumes (no `content: Buffer`), and the watcher was wastefully `readFileSync`-ing the whole file just to capture size.
- Fix:
  - `infra/sandbox-templates/operator-session/file-watcher.js`: replaced `fs.readFileSync` with `fs.statSync(resolvedPath).size`. Added comments stating the IPC payload is metadata-only by design and the host-side IPC bridge (which reads file content from the sandbox shared volume) is part of a separate operator-backend infra deliverable.
  - Backlog: `PA-V2-WATCHER-HOST-BRIDGE` — host-side IPC handler that reads content from sandbox volume and invokes `handleWatcherEvent` with the canonical input.
- Rationale: shipping content over IPC was rejected as a design choice (Node IPC has no size guarantee; large files would block the channel). Reading via shared volume on the host side is the right architecture.

**F2 — Migration 0349 stale + unsafe**
- Triaged technical (migration safety).
- Recommendation: IMPLEMENT.
- Fix: deleted `migrations/0349_operator_run_files_missing_columns.{sql,down.sql}`. Migration 0348 already includes `owner_user_id` and `subaccount_id` columns (lines 43-44 of `0348_operator_run_files.sql`). The 0349 down would have dropped columns that belong to 0348.

**F3 — Timeout window uses createdAt**
- Triaged technical (correctness of timeout sweep).
- Recommendation: IMPLEMENT.
- Fix:
  - New migration `0349_delegation_outcomes_substep_status_updated_at.{sql,down.sql}` — adds `substep_status_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`.
  - `server/db/schema/delegationOutcomes.ts` — adds `substepStatusUpdatedAt` field with `.defaultNow().notNull()`.
  - `server/jobs/workflowGateStallNotifyJob.ts` — sweep filter changed from `lt(delegationOutcomes.createdAt, cutoff)` to `lt(delegationOutcomes.substepStatusUpdatedAt, cutoff)`. The `fail_parent` and `continue_without_substep` UPDATE statements now also set `substepStatusUpdatedAt: new Date()`. The `ask_initiator` race-claim UPDATE deliberately does NOT touch `substepStatusUpdatedAt` because the status is unchanged (the row stays open; dedupe is handled by `actionService.proposeAction` idempotency).

**F4 — ask_initiator non-atomic event emit**
- Triaged technical (race window on duplicate event emission).
- Recommendation: IMPLEMENT.
- Fix: swapped order in `crossOwnerApprovalTimeoutSweep` ask_initiator branch. `actionService.proposeAction` (DB-unique-constraint-deduped) now runs FIRST; the returned `isNew` boolean gates `appendEvent`. When `isNew=true`, this sweep's insert won — emit the event. When `isNew=false`, an earlier sweep already emitted — skip. Eliminates the SELECT-then-INSERT race window where two concurrent sweeps would both observe "no existing action" and both append the event.

**F5 — Arm 2 over-broad visibility**
- Triaged technical (privacy boundary).
- Recommendation: IMPLEMENT.
- Fix: removed Arm 2 from `listPendingApprovalsForUser` in `server/services/actionService.ts`. Function now returns only explicit-approver pending approvals (`approver_user_id = $userId`). Docstring updated to clarify scope; V1 initiator-defaulted approvals (`approver_user_id IS NULL`) are NOT returned by this reader and remain on the existing V1 approval-queue path.
- Rationale: the function has no production callers yet — it was added for cross-owner approval queue reads. The spec's "V1 initiator predicate" was never implemented; Arm 2 as shipped would have exposed every `IS NULL` action in the org/subaccount to any caller. Removing Arm 2 narrows scope to the correct V2 surface and avoids shipping a known-broken privacy boundary.
- Backlog: `PA-V2-LIST-APPROVALS-V1-ARM` — wire the V1 initiator predicate (JOIN through `agent_runs` to derive the run's initiator) when the V1 default-approver queue reader actually needs this function.
- Also updated `tasks/review-logs/spec-conformance-log-personal-assistant-v2-operator-chunk-4-2026-05-13T12-18-54Z.md` to record the deviation: item #7 ("Arm 2 V1 initiator predicate") is downgraded from PASS to DEVIATION (deferred to backlog).

**T1 — Projection test asserts narrower set than impl**
- Triaged technical (test correctness).
- Recommendation: IMPLEMENT.
- Fix: `server/services/__tests__/runTracePure.viewerProjection.test.ts` — `non-owner view` test now asserts the full allowed set (`cross_owner_substep.*` plus `delegation_spawned`, `delegation_completed`, `review_requested`, `review_decided`, `run_started`, `run_terminated`) and explicitly verifies that other event types (`tool_call.completed`, `agent_run.started`) are redacted. Test description updated to match the broader vocabulary. The widened projection is the deliberate post-spec-review decision (§5.4 — lifecycle events carry no owner-private payload).

**T2 — Template placeholder vs active runtime logic**
- Triaged technical (CI-coverage scope question).
- Recommendation: DEFER.
- Rationale: `infra/sandbox-templates/operator-session/README.md` explicitly states the template is placeholder scaffolding not built/scanned/tested by V1 CI; the Dockerfile and entrypoint.sh both carry PLACEHOLDER banners; `CURRENT_VERSION` is `0.1.0-file-watcher`. The README says real implementation lands with the operator-backend spec. The PR is consistent with that framing. Promoting the template to a built/scanned/tested artefact is an operator-backend infra deliverable and out of scope for this build.
- Backlog: `PA-V2-OPERATOR-TEMPLATE-PROMOTION` — promote `infra/sandbox-templates/operator-session/` to a CI-built template with version coherence, scan coverage, and integration tests once the operator-backend spec activates it.

### Verification (G3 — round-1 fix bundle)

- `npm run lint`: 0 errors, 897 warnings (+1 from baseline; all pre-existing-style warnings — no new errors).
- `npm run typecheck`: clean for the touched files; only 2 pre-existing `@react-pdf/renderer` errors persist (acknowledged in the Phase 2 handoff).
- `npx vitest run server/services/__tests__/runTracePure.viewerProjection.test.ts server/services/__tests__/workflowGateStallNotifyJobPure.timeoutPolicyDecisionTree.test.ts`: 9/9 PASS.

### Files changed in Round 1

```
deleted: migrations/0349_operator_run_files_missing_columns.sql
deleted: migrations/0349_operator_run_files_missing_columns.down.sql
new:     migrations/0349_delegation_outcomes_substep_status_updated_at.sql
new:     migrations/0349_delegation_outcomes_substep_status_updated_at.down.sql
edit:    server/db/schema/delegationOutcomes.ts
edit:    server/jobs/workflowGateStallNotifyJob.ts
edit:    server/services/actionService.ts
edit:    server/services/__tests__/runTracePure.viewerProjection.test.ts
edit:    infra/sandbox-templates/operator-session/file-watcher.js
edit:    tasks/todo.md (backlog additions: PA-V2-WATCHER-HOST-BRIDGE, PA-V2-LIST-APPROVALS-V1-ARM, PA-V2-OPERATOR-TEMPLATE-PROMOTION)
edit:    tasks/review-logs/spec-conformance-log-personal-assistant-v2-operator-chunk-4-2026-05-13T12-18-54Z.md (item #7 → DEVIATION)
```

### Round-2 diff prep

After commit, regenerate `.chatgpt-diffs/pr299-round2-code-diff.diff` for the operator to paste into ChatGPT for Round 2.

## Round 2 — 2026-05-14T09:13Z

### ChatGPT Verdict
CHANGES_REQUESTED — 3 new blockers (F6–F8) + 2 should-fix (T3–T4).

### Findings

| # | Severity | Type | Triage | Recommendation | Status |
|---|----------|------|--------|----------------|--------|
| F6 | blocker | technical | projection fail-open on `undefined` owner lookup | IMPLEMENT — distinguish `undefined` from `null`; fail closed | applied |
| F7 | blocker | technical | substep_status_updated_at write-side invariant not enforced centrally | IMPLEMENT — DB trigger auto-bumps on substep_status change | applied |
| F8 | blocker | technical | event durability: action-insert-success + event-append-fail loses event | IMPLEMENT — independent emit-audit column; sweep retries | applied |
| T3 | should-fix | technical | runTracePure docstring stale vs implementation | IMPLEMENT — updated docstring + caller contract for `undefined` | applied |
| T4 | should-fix | technical | template placeholder vs runtime logic | IMPLEMENT (partial) — added prominent README warning + import-prevention note | applied |

### Decisions log

**F6 — Projection fail-open on undefined owner lookup**
- Triaged technical (privacy boundary).
- Recommendation: IMPLEMENT.
- Fix:
  - `server/routes/agentRuns.ts:751` — `getRunOwnerUserId` result captured into `ownerLookup`; `=== undefined` branch returns 404 `RUN_NOT_FOUND` and the projection only runs against valid `null | string`.
  - `server/routes/taskEventStream.ts:104` — `=== undefined` branch returns an empty events page with the existing cursor high-water marks preserved (same pattern as fully-redacted non-owner pages, so the client can advance past the missing window without re-polling).
  - `server/services/runTracePure.ts` docstring — updated to lock the three-state contract: callers MUST handle `undefined` at the route layer and never pass it to the projection.
- Rationale: `getRunOwnerUserId` returns three states (`string | null | undefined`). Collapsing `undefined` → `null` via `?? null` made every failed-or-cross-org owner lookup fall into the `ownerUserId === null` "subaccount-owned, return all events" branch of the projection — a fail-open on a privacy boundary.

**F7 — substep_status_updated_at not centrally enforced**
- Triaged technical (correctness invariant).
- Recommendation: IMPLEMENT.
- Fix: new migration `0350_delegation_outcomes_substep_status_trigger.sql` adds a `BEFORE UPDATE` trigger gated on `NEW.substep_status IS DISTINCT FROM OLD.substep_status` that auto-bumps `substep_status_updated_at`. The trigger is the DB-layer guarantee — future writers cannot transition `substep_status` without the timestamp moving. No-op race-claim UPDATEs (where `substep_status` is set to its own current value) do NOT trigger the bump, preserving the existing ask_initiator semantics.
- Rationale: documenting an invariant in a migration comment is not enforcement. A trigger guarantees the invariant on every transition, including future writers we don't know about yet. The three existing direct `.set({ substepStatus, substepStatusUpdatedAt })` calls in `workflowGateStallNotifyJob.ts` are now redundant-but-harmless; the trigger would set the timestamp anyway.

**F8 — Event durability on action-insert-success + event-append-fail**
- Triaged technical (audit/replay durability).
- Recommendation: IMPLEMENT.
- Fix:
  - Migration 0350 also adds nullable `awaiting_initiator_event_emitted_at TIMESTAMP WITH TIME ZONE NULL`.
  - Drizzle schema `server/db/schema/delegationOutcomes.ts` adds `awaitingInitiatorEventEmittedAt` field.
  - `crossOwnerApprovalTimeoutSweep` ask_initiator branch restructured: (1) `actionService.proposeAction` runs unconditionally (idempotent via DB unique constraint); (2) on proposeAction failure, `continue` (next sweep retries from scratch); (3) on success, check the row's `awaitingInitiatorEventEmittedAt` — if NULL, append the event and immediately UPDATE the column to `NOW()`; if non-NULL, log + skip.
  - Net effect: action insert and event emit are now independently durable. If proposeAction succeeds but appendEvent throws, the column stays NULL and the next 24h sweep retries the event emission alone.
- Rationale: the Round 1 fix solved the duplicate-event race but introduced an event-loss failure mode. The audit column gives appendEvent its own retry signal independent of proposeAction's idempotency.

**T3 — runTracePure docstring stale**
- Triaged technical.
- Recommendation: IMPLEMENT.
- Fix: docstring on `runTraceProjectionForViewer` rewritten — full allow-list named, payload-purity invariant called out for any new additions, and a new "Caller contract" block documents the three-state `ownerUserId` semantics (pinned by F6).

**T4 — Placeholder template still looks active**
- Triaged technical.
- Recommendation: IMPLEMENT (partial — README banner is the right immediate fix; promotion stays backlog).
- Fix: prepended a bold warning to `infra/sandbox-templates/operator-session/README.md` — "DO NOT IMPORT OR EXECUTE THIS TEMPLATE FROM PRODUCTION CODE", explicit reference to `PA-V2-WATCHER-HOST-BRIDGE`, explicit reference to `PA-V2-OPERATOR-TEMPLATE-PROMOTION`.
- A grep-gate (CI rule rejecting imports from `infra/sandbox-templates/operator-session/`) is overkill for V1 because there are zero callers today; the README warning is the cheaper defence. Adding the gate is part of `PA-V2-OPERATOR-TEMPLATE-PROMOTION` when the template is activated.

### Verification (G3 — round-2 fix bundle)

- `npm run lint`: 0 errors, 897 warnings (unchanged from baseline pre-Round-1).
- `npm run typecheck`: clean for touched files; only the 2 pre-existing `@react-pdf/renderer` errors persist.
- `npx vitest run server/services/__tests__/runTracePure.viewerProjection.test.ts server/services/__tests__/workflowGateStallNotifyJobPure.timeoutPolicyDecisionTree.test.ts`: 9/9 PASS.

### Files changed in Round 2

```
new:     migrations/0350_delegation_outcomes_substep_status_trigger.sql
new:     migrations/0350_delegation_outcomes_substep_status_trigger.down.sql
edit:    server/db/schema/delegationOutcomes.ts
edit:    server/jobs/workflowGateStallNotifyJob.ts
edit:    server/routes/agentRuns.ts
edit:    server/routes/taskEventStream.ts
edit:    server/services/runTracePure.ts
edit:    infra/sandbox-templates/operator-session/README.md
```

### Round-3 diff prep

After commit, regenerate `.chatgpt-diffs/pr299-round3-code-diff.diff` for the operator to paste into ChatGPT for Round 3.
