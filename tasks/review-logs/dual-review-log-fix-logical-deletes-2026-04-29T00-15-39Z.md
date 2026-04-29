# Dual Review Log — fix-logical-deletes

**Files reviewed:** server/services/delegationGraphService.ts, server/services/agentActivityService.ts, server/services/activityService.ts, server/services/scheduledTaskService.ts, server/services/knowledgeService.ts, server/services/orgAgentConfigService.ts, server/services/webLoginConnectionService.ts, server/services/subtaskWakeupService.ts, server/routes/llmUsage.ts, server/tools/config/configSkillHandlers.ts, server/tools/readDataSource.ts, KNOWLEDGE.md, tasks/todo.md
**Iterations run:** 2/3
**Timestamp:** 2026-04-29T00:15:39Z
**Branch:** fix-logical-deletes
**Codex CLI:** v0.125.0 (auth: ChatGPT, model: gpt-5.5)
**Commit at finish:** b57aeb1ef8d3c143ae4fe5a014bc14440d0114c9

---

## Iteration 1

### Codex finding

- **[P1]** `server/services/delegationGraphService.ts:50,95` — Allow nullable agent names in delegation graph rows.
  Changing `innerJoin(agents, ...)` to `leftJoin(...)` makes `agents.name` nullable, but the results are still pushed into `RunRow[]`, whose `agentName` field is typed as `string`. With `strict` TypeScript enabled, this breaks the server build for both the root and child delegation queries whenever the compiler sees `string | null` being assigned to `RunRow.agentName`. Either make the graph type nullable or coalesce a placeholder before pushing.

### Adjudication

```
[ACCEPT] server/services/delegationGraphService.ts:59,111 — `string | null` not assignable to `RunRow.agentName: string`
  Reason: Real, verified bug. Reproduced via `npx tsc --noEmit -p server/tsconfig.json`:
    - With branch changes: 65 errors total (63 pre-existing + 2 new at delegationGraphService.ts:59 and :111)
    - With branch changes stashed: 63 errors total (no delegationGraph errors)
  The two new errors are 100% attributable to this PR's `innerJoin → leftJoin` conversion.

  This is the same finding pr-reviewer raised as B1. The user's "false positive" verdict
  came from running `npx tsc --noEmit` against the *root* `tsconfig.json`, which only
  includes `client/src` — the server files are typechecked under `server/tsconfig.json`,
  which was never run. CLAUDE.md §4 (Verification Before Done) demands proof; the server
  config wasn't run, so the bug was missed.

  Fix chosen: JS-level coalesce `?? '(deleted agent)'` at the row push site (lines 59 and
  111). This:
    - Preserves the `RunRow.agentName: string` contract (no `delegationGraphServicePure.ts`
      change)
    - Preserves the `DelegationGraphNode.agentName: string` API contract (no client change
      to DelegationGraphView.tsx, RunTraceViewerPage.tsx, run-trace component types)
    - Provides a stable, human-readable placeholder that renders cleanly in the existing
      button label at DelegationGraphView.tsx:127
    - Aligns with CLAUDE.md §6 (smallest viable change — fix the issue, nothing more)
    - Aligns with CLAUDE.md §8.4 / DEVELOPMENT_GUIDELINES.md §8.4 (prefer existing
      primitives over new abstractions — no new "deleted-entity placeholder" service is
      introduced; a literal string is enough for two call sites)
```

### Implementation

Edited `server/services/delegationGraphService.ts`:
- Line 59 area: `agentName: rootDetail.agentName ?? '(deleted agent)'` with rationale comment
- Line 111 area: `agentName: child.agentName ?? '(deleted agent)'` with back-reference comment

### Post-fix verification

`npx tsc --noEmit -p server/tsconfig.json`:
- Pre-PR baseline: 63 errors
- Post-fix branch: 63 errors
- Delta attributable to soft-delete PR + this fix: 0 new errors

Both `delegationGraphService.ts` errors resolved. No new errors introduced.

## Iteration 2

Codex output (verbatim):

> "I did not find any discrete introduced bugs in the changed code. The soft-delete guards are applied consistently at the modified join sites, and the historical queries that switched to left joins preserve their primary records while suppressing deleted metadata."

No findings. Loop terminates.

## Iteration 3

(not reached — Iteration 2 returned clean)

---

## Changes Made

- `server/services/delegationGraphService.ts` — coalesce `agentName ?? '(deleted agent)'` at root and child row push to satisfy `RunRow.agentName: string` after the `innerJoin → leftJoin` conversion (2 edits, ~6 lines incl. comments)

## Rejected Recommendations

None — Codex raised exactly one finding, which was accepted.

---

**Verdict:** PR ready. The single Codex finding (real type error introduced by the soft-delete leftJoin conversion in `delegationGraphService`) was implemented with a minimal coalesce that preserves existing API contracts. Server typecheck delta vs. pre-PR baseline is zero. Iteration 2 returned clean. The pr-reviewer's earlier B1 finding was correct and not a false positive — running `tsc` from project root only covers `client/src`; the server requires `-p server/tsconfig.json` to surface the error. Worth recording in KNOWLEDGE.md if not already captured.
