# Pre-Test Audit Remediation — Task List

**Spec:** `./spec.md`
**Branch:** `claude/prioritize-audit-recommendations-rREha`
**Commit cadence:** one commit per task. Verify (`npx tsc --noEmit` + targeted unit tests) before each commit.

---

## Task 1 — BA prompt: ban absolute time estimates
**Goal G4.** Smallest, lowest-risk task; ships first to prove the commit cadence.

- [ ] Edit `companies/automation-os/agents/business-analyst/AGENTS.md`: append the **Estimates** paragraph from spec §4.4 under existing constraints.
- [ ] Verify: re-read the file; confirm no other agent prompts referenced absolute timelines (grep).
- [ ] Commit: `chore(ba): forbid absolute time estimates in BA agent prompt`

---

## Task 2 — Shared `cancelling` status
**Foundation for Task 3 + 4.**

- [ ] `shared/runStatus.ts`: add `CANCELLING: 'cancelling'` to `AGENT_RUN_STATUS`; include in `IN_FLIGHT_RUN_STATUSES`.
- [ ] `client/src/lib/runStatus.ts`: mirror the change (this file duplicates the shared enum for the client bundle).
- [ ] `server/db/schema/agentRuns.ts`: extend the TS `$type<...>` union on `status` to include `'cancelling'`.
- [ ] Verify: `npx tsc --noEmit` clean.
- [ ] Commit: `feat(runs): add 'cancelling' non-terminal agent run status`

---

## Task 3 — Cancel service + route
**Goal G2.** Backend half of the kill switch.

- [ ] New file `server/services/agentRunCancelService.ts` per spec §4.2 (terminal-idempotent; org-scoped read; IEE branch updates `iee_runs` gated on status; non-IEE branch flips agent_runs to `cancelling`).
- [ ] `server/routes/agentRuns.ts`: add `POST /api/agent-runs/:runId/cancel` route per spec.
- [ ] `server/services/agentExecutionService.ts` outerLoop (line ~2337): add cancel-status PK read at top of each iteration; break with `finalStatus = 'cancelled'` if `status === 'cancelling'`.
- [ ] Verify `finaliseAgentRunFromIeeRun` already maps `iee_runs.cancelled` → `agent_runs.cancelled`; if not, add the case.
- [ ] New unit test `server/tests/services/agentRunCancelService.unit.ts` per spec §7.
- [ ] Verify: `npx tsc --noEmit` + new unit test passes (`npx tsx server/tests/services/agentRunCancelService.unit.ts`).
- [ ] Commit: `feat(agent-runs): user-triggered cancel endpoint + service`

---

## Task 4 — Cancel UI
**Goal G3.** Frontend half of the kill switch.

- [ ] New component `client/src/components/AgentRunCancelButton.tsx` per spec §4.3.
- [ ] `client/src/pages/AgentRunLivePage.tsx`: render the button in the page header; pass `runId`, current `status`, and an `onCancelled` that refetches.
- [ ] `client/src/pages/AdminSubaccountDetailPage.tsx`: render the button inline on each in-flight agent run row.
- [ ] Verify: `npm run build:client`; manually walk through one run as system_admin / org_admin / subaccount admin (described in spec §G3) — note any UI gaps in `tasks/todo.md`.
- [ ] Commit: `feat(ui): cancel button on agent run views (system / org / subaccount admin)`

---

## Task 5 — IEE dev observation: extend schema + executor state
**Goal G1, part 1.** Pure type/structure work, no behaviour change yet.

- [ ] `shared/iee/observation.ts`: add the optional `lastChecks` field per spec §4.1.
- [ ] `worker/src/dev/executor.ts`: add a `lastChecks` slot on the executor closure; populate from a stub `runQualityChecks()` that returns `undefined` for now; include `lastChecks` in `observe()`.
- [ ] Verify: `npx tsc --noEmit` clean.
- [ ] Commit: `feat(iee): extend observation schema with lastChecks field`

---

## Task 6 — IEE quality-check runner + initialCommands wiring
**Goal G1, part 2.** Make the slot meaningful.

- [ ] New file `worker/src/dev/qualityChecks.ts`: `runQualityChecks(workspaceDir, config)` per spec §4.1 — runs lint / typecheck / test commands via existing `runShellCommand`, returns the structured object, output truncated to 1500 chars.
- [ ] New file `worker/src/config/devChecks.ts`: `DEV_TASK_DEFAULT_CHECKS` per spec.
- [ ] `worker/src/dev/executor.ts`:
  - Run `initialCommands` once after `createWorkspace`, before returning the executor; capture exit codes.
  - After every `write_file` and `git_commit`, call `runQualityChecks` and store the result on the closure.
  - Read check config from `payload.task.checks`, falling back to `DEV_TASK_DEFAULT_CHECKS` (test left undefined).
- [ ] `shared/iee/jobPayload.ts`: extend the dev task payload type with optional `checks: { lintCommand?, typecheckCommand?, testCommand? }`.
- [ ] `worker/src/handlers/devTask.ts`: thread `payload.task.checks` into `buildDevExecutor`.
- [ ] New unit test `worker/tests/dev/qualityChecks.unit.ts` per spec §7.
- [ ] Verify: `npx tsc --noEmit` + new unit test (`npx tsx worker/tests/dev/qualityChecks.unit.ts`).
- [ ] Commit: `feat(iee): wire initialCommands + auto-run lint/typecheck after writes`

---

## Task 7 — IEE system prompt: announce checks
**Goal G1, part 3.** Tell the agent the checks exist.

- [ ] `worker/src/loop/systemPrompt.ts`: add a QUALITY CHECKS section per spec §4.1 — describes the `lastChecks` field shape and instructs the agent not to call `done` while any configured check is failing.
- [ ] Verify: `npx tsc --noEmit`.
- [ ] Commit: `feat(iee): instruct agent on quality checks via system prompt`

---

## Final verification

- [ ] Confirm no spec sections were skipped: walk the goals G1–G4 in spec §2 and tick each off against the implemented commits.
- [ ] Push the branch: `git push -u origin claude/prioritize-audit-recommendations-rREha`.
- [ ] Surface PR-readiness to the user (do NOT auto-create a PR).

---

## Sequencing rationale

Order is risk-ascending: Task 1 is a doc edit (proves the loop), Task 2 unblocks 3+4 with type changes, Tasks 3+4 deliver the kill switch in two commits (server, then UI), Tasks 5–7 deliver the toolchain in three small commits (schema → behaviour → prompt). Each task is independently revertable; nothing in a later task changes a file owned by an earlier task in a way that would force re-verification.
