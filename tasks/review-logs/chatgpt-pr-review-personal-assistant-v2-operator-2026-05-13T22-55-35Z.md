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

## Round 3 — 2026-05-14T09:32Z

### ChatGPT Verdict
CHANGES_REQUESTED — 3 blockers (F9–F11) + 1 should-fix (T5).

### Findings

| # | Severity | Type | Triage | Recommendation | Status |
|---|----------|------|--------|----------------|--------|
| F9 | blocker | technical | service-layer projection still fails open on missing run row | IMPLEMENT — distinguish empty result; return empty page | applied |
| F10 | blocker | technical | terminal events can be lost if appendEvent fails after terminalAt set | IMPLEMENT — claim+emit pattern + retry pass | applied |
| F11 | blocker | technical | awaiting_initiator emit gate is read-then-write (race + retry-loss) | IMPLEMENT — atomic claim+emit pattern with stale-claim TTL | applied |
| T5 | should-fix | technical | manual substepStatusUpdatedAt writes are redundant given the trigger | IMPLEMENT — remove manual writes, rely on trigger | applied |

### Decisions log

**F9 — Service-layer projection still has the fail-open pattern**
- Triaged technical (privacy boundary).
- Recommendation: IMPLEMENT.
- Fix:
  - `server/services/agentExecutionEventService.ts:streamEvents` — when `runRows.length === 0`, return an empty page (`events: []`, `hasMore: false`, cursor high-water marks set to `fromSeq - 1` / `null`). Do NOT coerce missing-row to `null` for the projection.
  - `streamEventsByTask` — same pattern: when events exist but the joined run row is missing, return an empty projected page with cursor high-water marks taken from the raw page (so the client can advance past the gap).
- Rationale: the route-layer F6 fix prevents this for HTTP callers, but any direct service consumer would still fail open. The "two-layer enforcement" claim from the original spec requires BOTH layers to fail closed independently.

**F10 — Terminal event durability**
- Triaged technical (audit invariant).
- Recommendation: IMPLEMENT.
- Fix:
  - Migration `0351_delegation_outcomes_event_emit_audit.sql` adds `terminal_event_claim_at` + `terminal_event_emitted_at`.
  - `workflowGateStallNotifyJob.ts` rewritten: fail_parent + continue_without_substep branches now use the atomic claim+emit pattern. After the terminal-state UPDATE, call `claimTerminalEventEmit(rowId)` — atomic `UPDATE terminal_event_claim_at = NOW() WHERE id = $1 AND terminal_event_emitted_at IS NULL AND (terminal_event_claim_at IS NULL OR terminal_event_claim_at < NOW() - 5min) RETURNING id`. If 0 rows, skip (another sweep won). If 1 row, attempt appendEvent. On success, set `terminal_event_emitted_at = NOW()`. On failure, leave the claim set — `EVENT_CLAIM_STALE_AFTER_MS` (5 min) releases it for retry.
  - New `retryStrandedTerminalEmits()` helper runs at the start of every sweep, picking up rows where `(terminalAt IS NOT NULL AND terminal_event_emitted_at IS NULL AND crossOwnerApprovalTimeoutPolicy IS NOT NULL)`. Re-derives the event payload from `substep_status` + policy and re-emits via the same claim+emit helper.
- Rationale: terminal-event durability is an audit-trail issue. Without the audit column + retry pass, any crash between UPDATE-terminal and appendEvent permanently loses the `cross_owner_substep.completed` event for the substep. The retry pass at sweep start guarantees stranded terminals get their event landed within one sweep cycle of the stale-claim threshold.

**F11 — awaiting_initiator atomic claim**
- Triaged technical.
- Recommendation: IMPLEMENT.
- Fix:
  - Migration 0351 also adds `awaiting_initiator_event_claim_at` (the existing `awaiting_initiator_event_emitted_at` from migration 0350 is the second half of the pair).
  - `claimAwaitingInitiatorEventEmit(rowId)` helper applies the same UPDATE pattern. If the claim succeeds, attempt appendEvent; on success, set emitted_at. On failure, leave claim set for stale-claim retry.
- Rationale: replaces the prior read-then-write gate (`if (row.awaitingInitiatorEventEmittedAt !== null) skip; else append`) which was vulnerable to concurrent-sweep duplicate emission.

**Residual edge case (documented):** if a sweep successfully appends an event but then crashes between appendEvent and the emitted_at UPDATE, the stale-claim threshold (5 min) will release the claim and a future sweep will re-emit, producing a duplicate event. The window is small (single-process transient between adjacent DB writes). The full fix is event-idempotency support in `appendEvent` / `agent_execution_events` (out of scope; backlog item `PA-V2-EVENT-IDEMPOTENCY`).

**T5 — Trigger makes manual substepStatusUpdatedAt writes redundant**
- Triaged technical.
- Recommendation: IMPLEMENT.
- Fix: removed the manual `substepStatusUpdatedAt: new Date()` writes from the fail_parent and continue_without_substep UPDATE statements. The migration 0350 `BEFORE UPDATE` trigger handles the bump automatically. Code now consistently expresses "I'm changing substep_status; the column-tracking is the DB's job". The ask_initiator branch's no-op UPDATE remains unchanged — the trigger correctly doesn't bump because `substep_status IS NOT DISTINCT FROM` its own value.

### Verification (G3 — round-3 fix bundle)

- `npm run lint`: 0 errors, 896 warnings (back down by 1 from Round 1 baseline — likely a removed import).
- `npm run typecheck`: clean for touched files; only the 2 pre-existing `@react-pdf/renderer` errors persist.
- `npx vitest run server/services/__tests__/runTracePure.viewerProjection.test.ts server/services/__tests__/workflowGateStallNotifyJobPure.timeoutPolicyDecisionTree.test.ts`: 9/9 PASS.

### Files changed in Round 3

```
new:     migrations/0351_delegation_outcomes_event_emit_audit.sql
new:     migrations/0351_delegation_outcomes_event_emit_audit.down.sql
edit:    server/db/schema/delegationOutcomes.ts
edit:    server/jobs/workflowGateStallNotifyJob.ts (significant restructure + 2 new helpers + 1 new retry pass)
edit:    server/services/agentExecutionEventService.ts (streamEvents + streamEventsByTask)
edit:    tasks/todo.md (new backlog: PA-V2-EVENT-IDEMPOTENCY)
```

### Round-4 diff prep

After commit, regenerate `.chatgpt-diffs/pr299-round4-code-diff.diff` for the operator to paste into ChatGPT for Round 4.

## Round 4 — 2026-05-14T09:37Z

### ChatGPT Verdict
CHANGES_REQUESTED — 1 blocker (F12) + 1 should-fix (T6).

### Findings

| # | Severity | Type | Triage | Recommendation | Status |
|---|----------|------|--------|----------------|--------|
| F12 | blocker | technical | service-layer owner lookup not org-scoped | IMPLEMENT — scope by `opts.forUser.organisationId` | applied |
| T6 | should-fix | technical | retry pass fallback cast emits synthetic event for unsupported statuses | IMPLEMENT — tighten WHERE clause; drop fallback cast | applied |

### Decisions log

**F12 — Service-layer owner lookup not org-scoped**
- Triaged technical (cross-org tenancy boundary).
- Recommendation: IMPLEMENT.
- Fix:
  - `server/services/agentExecutionEventService.ts:streamEvents` — owner lookup WHERE clause changed to `and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, opts.forUser.organisationId))`. A cross-org runId now produces the same empty-result fail-closed path as a missing run.
  - `streamEventsByTask` — same fix for the deferred owner lookup. Task-scoped reads with events from another org's run produce an empty projected page.
  - No caller changes needed: `opts.forUser.organisationId` is already required on `PermissionMaskUserContext`, which both call-sites already construct from the authenticated user.
- Rationale: prior fix relied on RLS / session context being set correctly on the underlying `db` handle. That's an implicit assumption; the explicit org filter is the contract. Now a direct service caller can pass any runId from any org without leaking — the org filter at the projection-lookup layer ensures only same-org runs hit the projection.

**T6 — Retry pass fallback cast emits synthetic event for unsupported statuses**
- Triaged technical (defensive-emit correctness).
- Recommendation: IMPLEMENT.
- Fix:
  - `retryStrandedTerminalEmits()` WHERE clause tightened: `inArray(substepStatus, ['failed', 'partial'])` AND `inArray(crossOwnerApprovalTimeoutPolicy, ['fail_parent', 'continue_without_substep'])`.
  - The status-mapping switch now has an explicit defensive `else` that logs `terminal_retry_unexpected_status` and `continue`s — no synthetic event is emitted for unknown statuses (e.g. `rejected`, which the prior fallback cast would have emitted as `cross_owner_approval_timeout_retry`).
  - The `cross_owner_substep.completed` event payload's `status` field is the validator-allowed `'failed' | 'partial'` union (the prior `'success'` cast variant is now removed because no timeout-driven row ever transitions to `'success'` in this code path).
- Rationale: a synthetic event with `cross_owner_approval_timeout_retry` reason and an unsupported status would pass the type system but fail the `validateEventPayload` runtime check — and even if the validator accepted it, the audit trail would contain a misleading event. Tightening the WHERE clause makes the retry pass mirror the forward path's policy/status invariants exactly.

### Verification (G3 — round-4 fix bundle)

- `npm run lint`: 0 errors, 896 warnings (unchanged).
- `npm run typecheck`: clean for touched files; only the 2 pre-existing `@react-pdf/renderer` errors persist.
- `npx vitest run server/services/__tests__/runTracePure.viewerProjection.test.ts server/services/__tests__/workflowGateStallNotifyJobPure.timeoutPolicyDecisionTree.test.ts`: 9/9 PASS.

### Files changed in Round 4

```
edit:    server/services/agentExecutionEventService.ts (streamEvents + streamEventsByTask org-scoped owner lookup)
edit:    server/jobs/workflowGateStallNotifyJob.ts (retryStrandedTerminalEmits — tightened WHERE clause + defensive switch)
```

### Round-5 diff prep

After commit, regenerate `.chatgpt-diffs/pr299-round5-code-diff.diff` for the operator to paste into ChatGPT for Round 5.

## Round 5 — 2026-05-14T09:46Z

### ChatGPT Verdict
APPROVED — merge-ready.

### Findings

| # | Severity | Type | Triage | Recommendation | Status |
|---|----------|------|--------|----------------|--------|
| F12 | resolved | — | confirmed closed (Round 4 fix) | — | resolved |
| T6 | resolved | — | confirmed closed (Round 4 fix) | — | resolved |
| Residual | informational | technical | event-idempotency edge case | already backlogged | acknowledged |

### Decisions log

ChatGPT confirmed Round 4 fixes close F12 and T6 cleanly. The only outstanding item is the previously documented residual edge case (crash after `appendEvent` succeeds but before `*_event_emitted_at` updates → duplicate event after stale-claim window), which ChatGPT explicitly agrees is out of scope for this PR. Tracked as backlog item `PA-V2-EVENT-IDEMPOTENCY` (added in Round 3).

No new findings. No new fixes. No new diff regeneration needed — the branch HEAD at `7f622e99` is the merge candidate.

## Final Summary

- **Verdict:** APPROVED
- **Rounds:** 5
- **Findings applied:** 11 (F1, F2, F3, F4, F5, T1, F6, F7, F8, T3, T4, F9, F10, F11, T5, F12, T6 — F2 and T2 partially deferred per their nature)
- **Findings rejected:** 0
- **Findings deferred:** 4 (`PA-V2-WATCHER-HOST-BRIDGE`, `PA-V2-LIST-APPROVALS-V1-ARM`, `PA-V2-OPERATOR-TEMPLATE-PROMOTION`, `PA-V2-EVENT-IDEMPOTENCY` — all routed to `tasks/todo.md` with full remediation plans)
- **KNOWLEDGE.md updated:** yes (4 patterns added during Phase 2 — Phase 3 cross-check below)
- **architecture.md updated:** no — `n/a` (no service-boundary / route-pattern / agent-fleet / RLS-schema / run-continuity change introduced by the chatgpt-pr-review fixes; the V2 cross-ownership delegation pattern + capability-map V2 axis + universal-controller invariant are already documented from Phase 2)
- **capabilities.md updated:** no — `n/a` (no capability/skill/integration add/remove/rename; the PA standing-autonomous-operator bullet was added in Phase 2)
- **integration-reference.md updated:** no — `n/a` (no integration scope / status / OAuth provider / MCP preset change)
- **CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated:** no — `n/a` (no build-discipline / agent-fleet / locked-rule change)
- **spec-context.md updated:** `n/a` (this is a PR review, not a spec review)
- **frontend-design-principles.md updated:** no — `n/a` (no UI pattern / hard rule / worked example introduced)

### Files changed across all 5 rounds (Round 1 baseline → Round 4 final)

```
new:     migrations/0349_delegation_outcomes_substep_status_updated_at.sql / .down.sql
new:     migrations/0350_delegation_outcomes_substep_status_trigger.sql / .down.sql
new:     migrations/0351_delegation_outcomes_event_emit_audit.sql / .down.sql
deleted: migrations/0349_operator_run_files_missing_columns.sql / .down.sql (stale + unsafe per F2)

edit:    server/db/schema/delegationOutcomes.ts (3 new columns + trigger doc)
edit:    server/jobs/workflowGateStallNotifyJob.ts (major restructure — claim+emit pattern,
                                                    retry pass, F4/F8/F10/F11 fixes)
edit:    server/services/actionService.ts (F5 — Arm 2 removed)
edit:    server/services/agentExecutionEventService.ts (F9 + F12 — org-scoped fail-closed
                                                        on both stream functions)
edit:    server/services/runTracePure.ts (T3 docstring update)
edit:    server/services/__tests__/runTracePure.viewerProjection.test.ts (T1 — full allow-list)
edit:    server/routes/agentRuns.ts (F6 — three-state owner lookup + 404 fail-closed)
edit:    server/routes/taskEventStream.ts (F6 — three-state owner lookup + empty-page fail-closed)
edit:    infra/sandbox-templates/operator-session/file-watcher.js (F1 — statSync + contract comment)
edit:    infra/sandbox-templates/operator-session/README.md (T4 — DO NOT IMPORT warning)
edit:    tasks/review-logs/spec-conformance-log-personal-assistant-v2-operator-chunk-4-*.md
         (F5 deviation + F3 + F4 conformance notes)
edit:    tasks/todo.md (4 backlog items added)
```

### Verification at merge candidate (HEAD `7f622e99`)

- `npm run lint`: 0 errors, 896 warnings (all pre-existing — zero new lint errors introduced across 5 rounds).
- `npm run typecheck`: clean for all touched files; only the 2 pre-existing `@react-pdf/renderer` errors persist (acknowledged in the Phase 2 handoff).
- `npx vitest run server/services/__tests__/runTracePure.viewerProjection.test.ts server/services/__tests__/workflowGateStallNotifyJobPure.timeoutPolicyDecisionTree.test.ts`: 9/9 PASS.

### Open items at merge

All routed to `tasks/todo.md` with full remediation plans:
- `PA-V2-LIST-APPROVALS-V1-ARM` (F5)
- `PA-V2-WATCHER-HOST-BRIDGE` (F1)
- `PA-V2-OPERATOR-TEMPLATE-PROMOTION` (T2)
- `PA-V2-EVENT-IDEMPOTENCY` (F10/F11 residual)

## Round 6 — 2026-05-14T10:00Z (post-S2-merge adversarial pass)

### Context
After ChatGPT Round 5 returned APPROVED, the branch did an S2 sync that brought
in main's PR #297 (`iee-browser-on-e2b`). The sync forced a 6-migration renumber
of all PA-V2 migrations (0346–0351 → 0351–0356). ChatGPT Round 6 ran a focused
post-merge adversarial pass for merge-introduced drift, not a full re-review.

### ChatGPT Verdict
CHANGES_REQUESTED — 3 blockers (F13–F15) + 1 should-fix (T7).

### Findings

| # | Severity | Type | Triage | Recommendation | Status |
|---|----------|------|--------|----------------|--------|
| F13 | blocker | technical | EA migration still at 0345; out of sequence after merge | IMPLEMENT — rename to 0357 | applied |
| F14 | blocker | technical | operatorRunFiles.ts has 2 bare relative imports (no `.js`) | IMPLEMENT — add `.js` extensions | applied |
| F15 | blocker | technical | crossOwnerDelegationRequestAssembler.build() updates all open delegation rows for a run | IMPLEMENT — add `delegationOutcomeId` param, scope UPDATE by id | applied |
| T7 | should-fix | technical | capability-map gate misses absent JSONB keys (jsonb_typeof NULL is NULL, not != 'array') | IMPLEMENT — add `?` key-existence guard | applied |

### Decisions log

**F13 — Migration 0345 out of sequence after main merge**
- Triaged technical (migration-ordering hygiene).
- Recommendation: IMPLEMENT.
- Fix: renamed `migrations/0345_ea_controller_style_native_and_operator.sql` (+ `.down.sql`) to `0357_*`. Updated references in:
  - migration file headers ("Migration 0357: Flip EA ...")
  - `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md` (4 references: §4.1 row, §3.6 Phase 0 row, §8 chunk 1 prereqs, §9.1 idempotency table)
  - `tasks/builds/personal-assistant-v2-operator/plan.md` (5 references in Chunk 1 file inventory, scope audit note, error-handling, Chunk 5 prerequisites, and the risk-table reversibility row)
- Historical review logs (`spec-conformance-log-*-2026-05-13T*.md`) left intact with their stale `0345` references; the verdicts stand and the audit trail is preserved. New review logs will reference 0357.

**F14 — operatorRunFiles.ts bare relative imports**
- Triaged technical (NodeNext module-resolution compile failure waiting to bite).
- Recommendation: IMPLEMENT.
- Fix: `server/db/schema/operatorRunFiles.ts` — added `.js` extensions to `./organisations` and `./agentRuns` imports. Matches the existing pattern on `./users.js` + `./subaccounts.js` in the same file and ADR-0020 (test conventions — Vitest only, `__tests__/` folder, `.js` relative imports).

**F15 — Assembler.build() updates all open delegation outcomes for a run**
- Triaged technical (behavioural correctness; affects dead code today, would have shipped wrong-by-construction).
- Recommendation: IMPLEMENT.
- Fix: `server/services/crossOwnerDelegationRequestAssembler.ts:build()` — added a required `delegationOutcomeId: string` parameter (positional, after `parentRun`). The UPDATE WHERE clause now scopes by `id = $delegationOutcomeId` (plus org filter + `terminal_at IS NULL` guard), not by `run_id`. A parent run with multiple concurrent open delegations no longer has its timeout policy applied to every row.
- No caller changes required: the function has no production callers today (it's wired-when-needed dead code, same as `deriveApproverUserId`). When wired, the caller will pass the specific outcome id derived from the delegation event being processed.

**T7 — Capability-map gate misses absent keys**
- Triaged technical (CI-gate correctness).
- Recommendation: IMPLEMENT.
- Fix: `scripts/gates/verify-capability-map-shape.sh` — invariants 3 and 4 now combine `NOT (capability_map ? '<key>')` (key-existence check) with the type assertion. Previously `jsonb_typeof(capability_map->'<key>')` returned SQL NULL for absent keys, and `NULL != 'array'` evaluates to NULL (not TRUE), so missing fields slipped through. Updated FAIL message to "absent or non-array" to make the new coverage explicit.

### Verification (G3 — round-6 fix bundle)

- `npm run lint`: 0 errors, 899 warnings (unchanged from post-merge baseline).
- `npm run typecheck`: clean for all touched files; only the 2 pre-existing `@react-pdf/renderer` errors.
- `npx vitest run` on the four V2 pure-test files: 24/24 PASS.

### Files changed in Round 6

```
renamed: migrations/0345_ea_controller_style_native_and_operator.sql → 0357_*.sql (+ .down.sql)
edit:    docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md
edit:    tasks/builds/personal-assistant-v2-operator/plan.md
edit:    server/db/schema/operatorRunFiles.ts
edit:    server/services/crossOwnerDelegationRequestAssembler.ts
edit:    scripts/gates/verify-capability-map-shape.sh
```

### Round-7 diff prep

After commit, regenerate `.chatgpt-diffs/pr299-round7-code-diff.diff` for the operator to paste into ChatGPT for Round 7 (or `done` if no further findings).
