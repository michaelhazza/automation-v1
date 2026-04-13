# Spec Review HITL Checkpoint — Iteration 2

**Spec:** `docs/robust-scraping-engine-spec.md`
**Spec commit:** `71ce9477d60b24a88cde7a332258934ed413f9a8`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 2 of 5
**Timestamp:** 2026-04-13T00:00:00Z (resumed from iteration 1 HITL; 11 mechanical findings applied before this checkpoint)

This checkpoint blocks the review loop. The loop will not proceed to iteration 3 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Finding 2.1 — No named file for scheduled-run comparison logic

**Classification:** directional
**Signal matched (if directional):** Architecture signals: "Introduce a new abstraction / service / pattern" — deciding which file handles the `monitor_webpage` scheduled task execution is an architectural placement decision
**Source:** Codex
**Spec section:** §7d (`executeMonitorWebpage`), Summary of Files Changed

### Codex's finding (verbatim)

> The spec assigns recurring-run comparison logic to "the Strategic Intelligence Agent" but the file inventory names no runtime file where scheduled-task execution or baseline comparison logic is implemented, leaving the implementation location incomplete.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would: in §7d step 7, add a note that the scheduled-run logic runs inside the agent execution path — specifically, the Strategic Intelligence Agent's AGENTS.md prompt (already being updated in §11a) tells the agent what to do on each run. No additional runtime file is needed for the comparison logic itself because the agent (not a job handler) performs the comparison. The only runtime hook is the existing `scheduled_tasks` job runner that triggers the agent run — that runner already exists and is not being modified. I would add a sentence to §7d step 7: "Note: no new service file is required for this path — the comparison logic runs inside the agent's execution context, driven by its updated system prompt. The existing scheduled task runner (`server/jobs/scheduledTaskRunner.ts` or equivalent) triggers the agent run as it would for any other scheduled task." I would also add `server/jobs/scheduledTaskRunner.ts` (or the actual file name) to the "Modified files" table with a Phase 4 note.

### Reasoning

The spec says "the Strategic Intelligence Agent reads the scheduled task metadata and calls scrape_structured" — this is agent-level behaviour, not a new service. However, there IS a question about whether the existing scheduled task runner correctly handles `taskType: 'monitor_webpage'` or whether it needs a new case/handler. If it's just the agent doing the work (no code change to the runner needed), then the spec is complete as-is and this finding should be rejected. If the runner needs a new `taskType` case, that's a new file or edit that should be named. This is an architecture placement decision — the human needs to confirm whether the existing scheduled task runner already handles arbitrary `taskType` values by triggering an agent run, or whether a new case is needed.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason.

```
Decision: apply-with-modification
Modification (if apply-with-modification): Reject the "new file needed" concern — the existing scheduledTaskService.fireOccurrence() is fully generic and calls agentExecutionService.executeRun() with the assigned agent; no new runtime file or taskType case is required. However, fix the spec's references to "scheduledTask.metadata" in §7d — the scheduledTasks schema has no metadata column. The monitor_webpage handler must write url, watch_for, fields, and selectorGroup as structured text into the scheduled task's brief field. The agent receives brief via the task card created by fireOccurrence. Update §7d step 3 to say: "Store the monitoring config as structured text in the scheduled task brief (not a metadata field — the schema has no metadata column). Example brief: 'Monitor URL: <url>. Watch for: <watch_for>. Fields: <fields>. Selector group: <selectorGroup>.'" Also add a note: "No new runtime file is required for scheduled-run comparison logic. The existing scheduled task runner (scheduledTaskService.fireOccurrence) fires the Strategic Intelligence Agent generically; the agent reads the task brief to recover monitoring config and calls scrape_structured."
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 3.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.
