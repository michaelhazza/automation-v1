# Pre-Test Audit Remediation — Dev Spec

**Status:** Draft → in implementation
**Branch:** `claude/prioritize-audit-recommendations-rREha`
**Trigger:** Audit of "AI coding podcast" recommendations against the live codebase identified three NOW items to land before closing dev and starting major testing.

---

## Table of contents

1. Background
2. Goals (verifiable assertions)
3. Non-goals
4. Architecture
   - 4.1 Toolchain in IEE dev loop
   - 4.2 Cancel agent runs
   - 4.3 UI exposure (system / org / subaccount admin)
   - 4.4 BA prompt guardrail
5. Data model changes
6. Risks and mitigations
7. Testing posture
8. Open questions

---

## 1. Background

Three audits surfaced gaps in the platform that are cheap to close and meaningfully reduce production-quality risk before testing:

1. **IEE dev_task workspace has zero quality-tool bindings.** The agent can write code, commit it, and report success without ever running lint, typecheck, or tests. `initialCommands` is dead code (passed in, never executed). Observation feedback contains no quality signal.
2. **Agent runs cannot be cancelled.** Workflow runs have `/cancel`; agent runs do not. A runaway agent has to burn through its budget or timeout to stop. The IEE schema already pre-figures this (see `server/db/schema/ieeRuns.ts` § "Deferred Step 8 — user-initiated cancellation handler") so the data model is ready.
3. **BA agent has no explicit ban on absolute time estimates.** Today the constraint is implicit (BA scope is "WHAT not HOW"). One defensive line in the prompt prevents drift.

Out of scope (deferred to LATER bucket): semantic code indexing, agent-A→B→A cycle detector, JSON schema validation on QA output, first-class confidence column on the actions table.

---

## 2. Goals (verifiable assertions)

- **G1.** When an agent in `iee_dev` mode writes a file, the next observation includes structured results from configured quality checks (`checks.lint`, `checks.typecheck`, `checks.test`), each with `exitCode`, `passed`, and a truncated `output`. Verified by a worker unit test.
- **G2.** A user with `org.agents.edit` can `POST /api/agent-runs/:runId/cancel` and the run transitions to a terminal `cancelled` status within ≤ one IEE step (delegated runs) or one in-process loop iteration (API runs). Verified by a service unit test using a fake IEE worker tick.
- **G3.** The cancel button is visible on the live agent run view to: system admin viewing any run; org admin viewing org-scoped runs; subaccount admin viewing subaccount-scoped runs. Verified manually by exercising each role's UI.
- **G4.** The Business Analyst agent prompt explicitly forbids absolute time estimates. Verified by reading `companies/automation-os/agents/business-analyst/AGENTS.md`.

---

## 3. Non-goals

- Replacing grep with a semantic code index.
- Adding new agent-cycle detection beyond the existing handoff-depth limit.
- Changing the QA agent's output schema (already excellent).
- Adding cancel for completed runs (cancel is in-flight only — idempotent if already terminal).
- Building a new "system admin agent runs" page from scratch — system admin reads runs through the existing org/subaccount surfaces.

---

## 4. Architecture

### 4.1 Toolchain in IEE dev loop

Three additions, surgical:

1. **Wire `initialCommands`.** In `worker/src/dev/executor.ts::buildDevExecutor`, run each `initialCommands[i]` once via `runShellCommand` after workspace creation, before returning the executor. Failures of any initial command set `lastCommandOutput` / `lastCommandExitCode` and surface in the first observation.
2. **Auto-run quality checks after `write_file` and `git_commit`.** A new `runQualityChecks(workspaceDir, config)` helper invokes a configurable trio: `lintCommand`, `typecheckCommand`, `testCommand` (each optional; if not configured, skipped). Each yields `{ command, exitCode, passed, output }` (output truncated to 1500 chars). Results are stashed on the executor and returned in the next observation.
3. **Extend `Observation` schema** with an optional `lastChecks` field:
   ```ts
   lastChecks: z.object({
     lint:      z.object({ exitCode: z.number().int(), passed: z.boolean(), output: z.string().max(1500) }).optional(),
     typecheck: z.object({ exitCode: z.number().int(), passed: z.boolean(), output: z.string().max(1500) }).optional(),
     test:      z.object({ exitCode: z.number().int(), passed: z.boolean(), output: z.string().max(1500) }).optional(),
   }).optional(),
   ```
4. **System prompt update.** `worker/src/loop/systemPrompt.ts` adds a QUALITY CHECKS section telling the agent these results appear in the observation after every `write_file` and `git_commit`, and that it should not call `done` while any configured check is failing.

**Configuration source.** Quality-check commands are read from `payload.task.checks` at job-payload level (added to `shared/iee/jobPayload.ts`'s dev task type). Sensible defaults live in `worker/src/config/devChecks.ts`:

```ts
export const DEV_TASK_DEFAULT_CHECKS = {
  lintCommand:      'npm run -s lint --if-present',
  typecheckCommand: 'npx tsc --noEmit --pretty false',
  testCommand:      undefined, // tests gated by explicit opt-in to avoid running long suites by default
};
```

Each command is opt-in by passing the field; defaults are conservative (lint + typecheck on, test off) and `--if-present` makes lint a no-op when no script is configured.

**No git_commit blocking** in this iteration. Surfacing failures in the observation + system prompt instruction is enough — the LLM can self-correct and the user sees the failures in the run trace. Hard-blocking commits introduces complexity (forced-override paths) we can defer until we observe real behaviour.

### 4.2 Cancel agent runs

Three layers — service, route, worker hook.

**Service.** `agentRunService.cancelRun(orgId, runId, userId)` (new file `server/services/agentRunCancelService.ts`):

1. Read agent run row; 404 if not found or `organisationId !== orgId`.
2. If `isTerminalRunStatus(status)` → return idempotently (no-op).
3. Set `agent_runs.status = 'cancelling'` (a NEW non-terminal sentinel — see §4.2.1) and `updatedAt = now`.
4. If `ieeRunId` is non-null:
   - Update `iee_runs SET status = 'cancelled', completedAt = now, failureReason = 'cancelled' WHERE id = $1 AND status IN ('pending','running')` — gated to preserve the terminal-finality contract.
   - Enqueue an `iee-run-completed` event so `finaliseAgentRunFromIeeRun` runs and parks the parent agent run on `cancelled`.
5. If non-IEE (in-process loop): the loop's per-iteration check (§4.2.2) reads the row and exits.
6. Log a structured event `agent_run.cancel_requested`.

**Route.** `server/routes/agentRuns.ts` adds:

```ts
router.post(
  '/api/agent-runs/:runId/cancel',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    await agentRunCancelService.cancelRun(req.orgId!, req.params.runId, req.user!.id);
    res.json({ ok: true, status: 'cancelling' });
  }),
);
```

Permission semantics — `requireOrgPermission(AGENTS_EDIT)` (already used by `/run`) means:
- **system_admin / org_admin** bypass unconditionally.
- **subaccount admin** with `org.agents.edit` granted via their permission set is allowed.
- **subaccount-scoped runs** are still org-scoped at the row level (every `agent_runs` row has `organisationId`); the service double-checks `agent_runs.organisationId = orgId` to prevent cross-org cancels.

**Worker hook (IEE).** Already covered. `assertWorkerOwnership` (`worker/src/persistence/runs.ts:249`) already returns `false` when `row.status !== 'running'` — flipping `iee_runs.status` to `cancelled` will cause the worker's per-step ownership check to fail and the loop exits cleanly via the existing `ownership_lost` path. We extend `finaliseAgentRunFromIeeRun` to map `iee_runs.status='cancelled'` → `agent_runs.status='cancelled'`.

#### 4.2.2 In-process loop hook (non-IEE)

In `agentExecutionService.ts` outerLoop (line 2337), at the top of each iteration after the existing budget check, add a cheap `SELECT status FROM agent_runs WHERE id=$1` and break with `finalStatus = 'cancelled'` if status is `cancelling`. Cost: one PK read per iteration. Cadence ≈ one LLM call → one cancel check, well within the SLO.

#### 4.2.1 New `cancelling` status

`shared/runStatus.ts::AGENT_RUN_STATUS` gains `CANCELLING: 'cancelling'`. It is in the IN_FLIGHT bucket (not terminal). The agent_runs schema's TS status enum is extended (column is `text`, no DB enum migration needed). Existing terminal-status callers are unaffected.

### 4.3 UI exposure (system / org / subaccount admin)

Three call sites, one shared component.

**Shared component.** `client/src/components/AgentRunCancelButton.tsx`:
- Props: `runId: string`, `status: AgentRunStatus`, `onCancelled: () => void`.
- Hidden if `isTerminalRunStatus(status)` or `status === 'cancelling'`.
- Confirms via existing `ConfirmDialog`, posts to `/api/agent-runs/:runId/cancel`, then calls `onCancelled()`.
- Surfaces server errors via toast.

**Call sites:**

1. **`AgentRunLivePage.tsx`** — primary live view used by everyone (system admin, org admin, subaccount admin all land here when they click into a run). Render the cancel button in the page header next to the status badge. The route is permission-gated server-side; the button hides itself based on status, not role.
2. **`AdminSubaccountDetailPage.tsx`** — already renders in-flight runs (the `cancelling` status mapping at line 1242 is unused today). Add an inline cancel control on each in-flight row.
3. **`AdminAgentsPage.tsx`** — system-admin entry-point that shows in-flight run counts. We rely on existing "view runs" navigation into `AgentRunLivePage` (which has the button) — no inline button needed there.

**Why one shared button is enough.** All three roles converge on `AgentRunLivePage` for any individual run. The role-specific surfaces (subaccount detail, admin agents page) only need a list-level affordance for the inline case (subaccount admin), which is a thin reuse of the same component.

### 4.4 BA prompt guardrail

One paragraph addition to `companies/automation-os/agents/business-analyst/AGENTS.md` under existing constraints:

> **Estimates.** Never produce absolute time estimates (hours, days, weeks, sprints, or calendar dates). Effort sizing is the Dev Agent's responsibility and uses relative complexity (TRIVIAL / STANDARD / SIGNIFICANT / MAJOR). If a stakeholder asks for a timeline, surface the open questions that would need to close before sizing is possible.

---

## 5. Data model changes

| Table        | Change                                                                  | Migration |
|--------------|-------------------------------------------------------------------------|-----------|
| `agent_runs` | TS status enum gains `'cancelling'` (column is `text`, no DB enum).      | None — type-only. |
| `iee_runs`   | No change — `'cancelled'` already in the schema.                        | None.     |

No new tables, no new columns. Lowest-risk schema posture.

---

## 6. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Auto-running typecheck/lint after every write_file slows the loop. | Both are short for small workspaces; output is capped at 1500 chars; tests are off by default. We'll observe step duration and adjust. |
| `npm run -s lint --if-present` runs nothing when no lint script exists — silent no-op risk. | The result includes `exitCode: 0, output: '<no script>'`. The system prompt tells the agent the absence of a configured check is normal. |
| Cancelling a run mid-tool-call leaves stale side-effects (DB writes, integrations). | Out of scope for this iteration. The `cancelled` terminal state is best-effort stop — same semantics as workflow run cancel today. Documented in the cancel route's response. |
| In-process status poll adds DB load. | One PK read per loop iteration. Existing iteration already does multiple reads; impact is negligible. |
| BA prompt change leaks into running agents. | Prompt is read fresh per run; no cache to invalidate. |

---

## 7. Testing posture

Per CLAUDE.md gate-cadence rule: no `npm run test:gates` mid-iteration. Per-task verification uses:
- `npx tsc --noEmit` after any TS change.
- `bash scripts/run-all-unit-tests.sh` (or single targeted `npx tsx`) for unit tests.
- `npm run build:client` if client touched.

New unit tests:
- `worker/tests/dev/qualityChecks.unit.ts` — `runQualityChecks` invokes configured commands, surfaces results, handles missing scripts.
- `server/tests/services/agentRunCancelService.unit.ts` — terminal idempotency, IEE path sets `iee_runs.cancelled`, non-IEE path flips `agent_runs.cancelling`, cross-org rejection.

---

## 8. Open questions

None blocking. The defaults in §4.1 (lint + typecheck on, test off) are deliberately conservative; we can flip the test default later once we have signal from real runs.
