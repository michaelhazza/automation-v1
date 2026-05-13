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
