# Sprint 3A Resume State — paused for 33 min break

Created: 2026-04-09, paused mid-session. Resume by re-reading this file
top-to-bottom, then executing the "Next action" block at the bottom.

## Where we are in the Sprint 3A pipeline

- **Chunk A–I**: all committed prior to this session (see tasks/sprint-3-plan.md).
- **pr-reviewer pass**: already run; reported 4 blocking + 5 strong + 5 non-blocking findings.
- **Current phase**: applying the pr-reviewer fixes AND also clearing the 21 pre-existing baseline gate failures (explicit user request: "Fix these issues whilst we are here.").
- **Branch**: `claude/sprint-3-handoff-cOHYM` (per SDK instructions, all commits go here).

## Completed in this session (all in working tree, NOT committed yet)

### pr-reviewer fixes

1. B1 — `streamMessages(runId, organisationId, opts)` signature. Callers:
   - `server/services/toolCallsLogProjectionService.ts` — `project(runId, organisationId)`
   - `server/services/agentExecutionService.ts` line ~1016 — passes `request.organisationId`
   - `server/services/agentExecutionService.ts` `resumeAgentRun` — passes `runRow.organisationId`
2. B2 — `agentScheduleService.ts` migrated 4 pg-boss workers to `createWorker` (ALS-safe).
3. B3 — removed `Math.max(messageCursor, 0)` clamp in `persistCheckpoint`; `resumeAgentRun` skips `streamAgentRunMessages` when `checkpoint.messageCursor < 0`; doc on `AgentRunCheckpoint.messageCursor` in `middleware/types.ts`.
4. B4 — `resumeAgentRun` uses `getOrgScopedDb('agentExecutionService.resumeAgentRun')`; defence-in-depth org filter on `subaccount_agents` lookup (`agent_run_snapshots` has no org column — FK-cascade).
5. R3 — `persistCheckpoint` clones a `snapshotCtx` rather than mutating `mwCtx`.
6. R4 — `agentRunCleanupJob.ts` uses `RETURNING id` and counts the returned rows.
7. R5 — already covered by `reflectionLoopPure.test.ts` line 208.
8. N1 — `nextSequenceNumber` doc clarified as MAX, not next.
9. N2 — `agent-run-cleanup` schedule moved from `0 3 * * *` to `0 4 * * *` in `queueService.ts`.
10. N3 — documented the stubbed budget args in `resumeAgentRun`'s buildResumeContext call.
11. N4 — added `assistantIndex` heuristic comment in `toolCallsLogProjectionServicePure.ts`.
12. N5 — verified `migrations/_down/0085_policy_rules_confidence_guidance.sql` exists.
13. R2 — expanded dedup doc in `decisionTimeGuidanceMiddleware.ts` (WeakMap lifetime, fingerprint-in-key rationale, resume semantics).
14. R1 — skipped (streamMessages is impure, integration test too heavy, conditions are trivial).

### Baseline gate failure cleanup

15. Restored 5 `docs/*.json` manifests from commit `9f22f4ab15b05c10525a7eb270f13e4379785536^`:
    scope-manifest.json, env-manifest.json, data-relationships.json, service-contracts.json, ui-api-deps.json.
    This fixed 15 of the 21 blocking failures.
16. `verify-async-handler` regression cleared: wrapped slack and teamwork webhook handlers
    in `asyncHandler` (`server/routes/webhooks/slackWebhook.ts`, `server/routes/webhooks/teamworkWebhook.ts`).
    The remaining baseline=1 entry is `webhooks.ts:27`.

## In-progress when we paused

**verify-no-db-in-routes**: baseline 19, current 20 (+1). Discovered 6 files
import `db` but never use it — any one removal clears the regression; all 6
is the right cleanup:

- `server/routes/agentTriggers.ts` line 6
- `server/routes/boardConfig.ts` line 7
- `server/routes/githubApp.ts` line 20
- `server/routes/systemExecutions.ts` line 4
- `server/routes/systemUsers.ts` line 4
- `server/routes/webhookAdapter.ts` line 3

Do NOT touch `agentInbox.ts` — that file DOES use `db` at lines 33 and 65,
so removing its import would break the build.

Each removal is a single-line Edit: match `import { db } from '../db/index.js';\n`
and replace with empty. Read each file first with the `Read` tool before editing.

## Still to do after resuming

### Remaining 4 code-level gate regressions (all pre-existing drift)

1. `verify-org-scoped-writes` — baseline 44, current 50 (+6). First violation:
   `server/services/queueService.ts:210` — `workflowEngines.id` lookup missing
   org filter. Get the full list: `bash scripts/verify-org-scoped-writes.sh 2>&1 | grep ❌ | head -20`.

2. `verify-no-direct-role-checks` — baseline 10, current 12 (+2). First violation:
   `server/routes/agents.ts:44` — replace inline `req.user!.role !== 'system_admin'`
   with `requireSystemAdmin` middleware. Run the gate for the other +1.

3. `verify-permission-scope` — baseline 15, current 19 (+4). First violation:
   `server/routes/hierarchyTemplates.ts:107` — route has `:subaccountId` but uses
   `requireOrgPermission`. Swap to `requireSubaccountPermission`. Run gate for the other +3.

4. `verify-input-validation` — baseline 39, current 40 (+1). First violation:
   `server/routes/webhooks.ts:73` — POST handler accesses `req.body` without Zod.
   This is the SAME file as the async-handler baseline=1 entry (line 27). Consider
   refactoring both at once: wrap line 27 in asyncHandler AND add validateBody at
   line 73, dropping two baselines to 0.

### Final verification sequence

1. `npm run build:server` — must be clean
2. `npm run test:unit` — must be 21 PASS / 0 FAIL
3. `GUARD_BASELINE=true bash scripts/run-all-gates.sh` — must be 32 passed, 0 blocking
4. Commit with clear Sprint 3 + baseline-cleanup message
5. Push to `claude/sprint-3-handoff-cOHYM`
6. Dual-reviewer pass
7. STOP before creating PR (user must explicitly request it)

## Key uncommitted files (as of pause)

Run `git status` to confirm. Expected list:

server/services/agentExecutionService.ts
server/services/agentRunMessageService.ts
server/services/agentScheduleService.ts
server/services/toolCallsLogProjectionService.ts
server/services/toolCallsLogProjectionServicePure.ts
server/services/queueService.ts
server/services/middleware/types.ts
server/services/middleware/decisionTimeGuidanceMiddleware.ts
server/jobs/agentRunCleanupJob.ts
server/routes/webhooks/slackWebhook.ts
server/routes/webhooks/teamworkWebhook.ts
docs/scope-manifest.json (restored)
docs/env-manifest.json (restored)
docs/data-relationships.json (restored)
docs/service-contracts.json (restored)
docs/ui-api-deps.json (restored)

Plus whatever was already on the branch from earlier Sprint 3A chunks.

## Next action on resume (copy this exactly)

1. `git status` to confirm working tree matches the list above.
2. Remove unused `db` imports from the 6 route files listed under "In-progress".
   Read each file first, then Edit to strip the import line.
3. `bash scripts/verify-no-db-in-routes.sh` — confirm count dropped below 20.
4. Work through the 4 remaining code-level gate regressions in the order listed.
5. Run final verification sequence.
6. Commit + push to `claude/sprint-3-handoff-cOHYM`.
7. Dual-reviewer pass.
8. STOP.

## Todo snapshot

- [x] B1 caller updates
- [x] B4 resumeAgentRun getOrgScopedDb
- [x] B3 messageCursor -1 sentinel
- [x] R3 persistCheckpoint purity
- [x] R4 cleanup job rowCount fix
- [x] R5 reflection test coverage confirmed
- [x] N2 stagger cleanup schedule
- [x] N1 nextSequenceNumber doc
- [x] R2 decisionTimeGuidance dedup doc
- [x] N3 resumeAgentRun budget stub doc
- [x] N4 assistantIndex heuristic comment
- [x] N5 0085 down migration verified
- [x] R1 skipped
- [x] Restore 5 docs manifests
- [x] async-handler regression cleared
- [ ] no-db-in-routes regression (6 unused-import removals)
- [ ] org-scoped-writes +6 regressions
- [ ] no-direct-role-checks +2 regressions
- [ ] permission-scope +4 regressions
- [ ] input-validation +1 regression
- [ ] Final build + test + gates
- [ ] Commit + push
- [ ] Dual-reviewer pass
