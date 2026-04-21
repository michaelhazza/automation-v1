# PR Review Log — Live Agent Execution Log (Phase 1)

Commit: `c196f77` on `claude/build-agent-execution-spec-6p1nC`.
Reviewer: `pr-reviewer` subagent (2026-04-21).
Spec: `tasks/live-agent-execution-log-spec.md`.

Files reviewed: `migrations/0192_agent_execution_log.sql`, `shared/types/agentExecutionLog.ts`,
`server/services/agentExecutionEventService.ts`, `server/services/agentExecutionEventServicePure.ts`,
`server/services/agentRunPromptService.ts`, `server/services/agentRunPayloadWriter.ts`,
`server/lib/redaction.ts`, `server/lib/agentRunVisibility.ts`,
`server/lib/agentRunEditPermissionMaskPure.ts`, `server/lib/agentRunEditPermissionMask.ts`,
`server/lib/agentRunPermissionContext.ts`, `server/routes/agentExecutionLog.ts`,
`server/websocket/emitters.ts`, `server/websocket/rooms.ts`,
`server/config/rlsProtectedTables.ts`, `server/lib/env.ts`, `server/db/schema/agentRuns.ts`,
`server/db/schema/agentExecutionEvents.ts`, `server/db/schema/agentRunLlmPayloads.ts`,
`server/db/schema/agentRunPrompts.ts`, `server/services/agentExecutionEventEmitter.ts`,
`server/services/agentExecutionService.ts` (emission sites),
`server/jobs/orchestratorFromTaskJob.ts`, `server/tools/internal/requestClarification.ts`,
`server/services/llmRouter.ts` (TODO scaffold),
`client/src/pages/AgentRunLivePage.tsx`,
`client/src/components/agentRunLog/{Timeline,EventRow,EventDetailDrawer}.tsx`,
`client/src/App.tsx` (route registration),
`server/services/__tests__/agentExecutionEventServicePure.test.ts`.

---

## Table of contents

1. Blocking issues (§1–§5)
2. Strong recommendations (§6–§12)
3. Non-blocking improvements (§13–§18)
4. Author-question answers + verdict

---

## Blocking issues

### §1 — Missing soft-delete filter in label resolver (`memory_entry`, `skill`, `agent`)

File: `server/lib/agentRunEditPermissionMask.ts`, lines 56–62 (`memory_entry`), 94–98 (`skill`), 118–123 (`agent`).

`workspaceMemoryEntries`, `skills`, `agents` all carry `deleted_at`. The batched label resolver queries each without `isNull(table.deletedAt)`. A soft-deleted row either resolves to a stale label (row still exists) or silently drops — both wrong. Worse: the stale label may carry PII that was supposed to be gone.

Fix: Add `isNull(workspaceMemoryEntries.deletedAt)` on the `memory_entry` case, `isNull(skills.deletedAt)` on the `skill` org-rows query (systemSkills has no `deletedAt`), and `isNull(agents.deletedAt)` on the `agent` org-rows query.

### §2 — `emitEventLimitReachedIfFirst` splits seq allocation and insert without an explicit transaction

File: `server/services/agentExecutionEventService.ts`, lines 188–256 (appendEvent path) and 294–332 (emitEventLimitReachedIfFirst).

The seq-allocation `UPDATE agent_runs ... RETURNING next_event_seq` and the subsequent `INSERT INTO agent_execution_events` are two separate statements. When the ambient context is an open `withOrgTx` (the agent loop), they share the transaction — safe. But `emitEventLimitReachedIfFirst` may be invoked outside a transaction (the claim UPDATE then the INSERT as two round-trips), and this path has no critical-event retry wrapper. If the INSERT fails, the claim is committed and the one-shot cap signal is silently lost.

Fix: Wrap allocation + insert in `emitEventLimitReachedIfFirst` inside an explicit `tx.transaction(async (tx) => { ... })`. Or: throw on insert failure so the outer `appendEvent` retry path handles it.

### §3 — `run.completed` hardcodes `totalCostCents: 0` and `eventCount: 0`

File: `server/services/agentExecutionService.ts`, lines 1341–1344.

```ts
totalCostCents: 0,
// ...
eventCount: 0,
```

These are persisted into `agent_execution_events.payload`. Operators see "0 cost / 0 events" on `run.completed` — actively misleading. Both are available in-scope: cost via `getRunCostCentsFromLedger(run.id, orgId)` (already wired in `runCostBreaker.ts`), event count via `agent_runs.nextEventSeq` (already read in the preceding `UPDATE ... RETURNING`).

### §4 — Socket room join handler does not enforce `AGENTS_VIEW` — live-stream permission gap

File: `server/websocket/rooms.ts`, lines 87–98.

The current handler only checks org membership. A regular authenticated org user without `AGENTS_VIEW` can `join:agent-run` and receive every live `agent-run:execution-event` envelope — memory excerpts, tool inputs, clarification questions — even though the HTTP snapshot endpoint would deny them.

The "layered defence" comment in the code is incorrect. The HTTP endpoint is a pull surface; the socket is a push surface. Both need the same view-gate at the door.

Fix: In the handler, after org-ownership check, call `resolveAgentRunVisibility` using a socket-side equivalent of `buildUserContextForRun` (the socket already has `socket.data.user` + `socket.data.orgId` — issue the permission-cache lookup once per join). Reject silently when `!visibility.canView`.

### §5 — `subaccountPermissionsFor` is a stub returning empty set (interface trap)

File: `server/lib/agentRunPermissionContext.ts`, line 75.

```ts
subaccountPermissionsFor: (_sub: string) => new Set<string>(),
```

Not a live bug today (the resolvers don't call it), but the interface advertises the capability. Any future code calling `user.subaccountPermissionsFor(id)` silently gets a deny. Implement or remove from the interface.

---

## Strong recommendations

### §6 — `llm.requested` / `llm.completed` unwired — feature's "live" claim is materially hollow

File: `server/services/llmRouter.ts`, line 832 (TODO).

Without these two critical events:
- The timeline for any real agent run is `run.started → prompt.assembled → context.source_loaded(s) → run.completed` with nothing in between.
- The `agent_run_llm_payloads` table has zero rows.
- The "fetch full payload" CTA in `EventDetailDrawer` never has an event to link to.
- The retry logic + metric counters are dead code until wired.

Reviewer recommendation: treat as blocking for P1, or reinstate a feature flag to suppress the tab until this lands.

### §7 — `agentRunPromptService.persistAssembly` has a TOCTOU race on `assemblyNumber`

File: `server/services/agentRunPromptService.ts`, lines 40–48. Two statements (SELECT MAX then INSERT) without a lock. Agent loop is single-threaded per run today, so no live bug — but a future parallel-writer refactor gets a hard 500 from the UNIQUE index. Fix: mirror the event-seq pattern with `agent_runs.next_assembly_number`.

### §8 — Missing pure-test coverage for the `run.completed` payload values

No assertion that cost + event count values are plumbed through correctly. Resolved together with blocker §3.

### §9 — Empty `permissionMask` on live stream degrades live-event UX

File: `server/services/agentExecutionEventService.ts`, lines 372–405. View/Edit links never appear on live events until page reload. Fix (workaround): client issues targeted `GET .../events?fromSeq=N&limit=1` to backfill per-event masks. Better fix: attach user context to socket at join time + iterate room sockets at emit time.

### §10 — `prompt.assembled` layer attributions are coarse (most layers zero)

Only `master` + `taskContext` token counts; `orgAdditional`, `memoryBlocks`, `skillInstructions` always 0. Validator accepts this but the zeroes are misleading. Follow-up: refactor `buildSystemPrompt` to return per-layer offsets.

### §11 — `loadRunForVisibility` makes two sequential DB round-trips

File: `server/routes/agentExecutionLog.ts`, lines 51–88. Agent-runs + system-agents loaded separately; `buildUserContextForRun` runs twice per request. Merge via JOIN; pass materialised user context through.

### §12 — No retention job for `agent_execution_events` yet

Explicitly deferred to P3 in the spec. Index on `(organisation_id, created_at DESC)` already supports a future DELETE. Flag only.

---

## Non-blocking improvements

### §13 — Redaction walker array-root path shape

`server/lib/redaction.ts`: array roots produce `0.content` (no leading dot); object roots produce `key`. Internally consistent after `buildPayloadRow` prefixes with root-field names. Document the convention explicitly.

### §14 — `Buffer.byteLength` in pure-ish writer

`server/services/agentRunPayloadWriter.ts` line 51. Node-only. Works in tests. Either keep + remove "pure-ish" qualifier from the file comment, or swap to `new TextEncoder().encode(s).byteLength`.

### §15 — O(N²) JSON.stringify in `truncateGreatestFirst`

Recompute-on-each-truncation is bounded by number of truncatable string candidates (not message count). Not a hot-path concern at current scale. Existing comment explains the choice; leave it.

### §16 — `eventCount: 0` visible in EventDetailDrawer JSON dump

Symptom of blocker §3. Resolved by fixing §3.

### §17 — `requireVisibility` error handling

`asyncHandler` catches propagated errors correctly today. Would be cleaner with explicit try/catch inside `requireVisibility`. Nit.

### §18 — `AgentRunLivePage` route `Suspense` coverage

Covered by `ProtectedLayout`'s parent `Suspense`. Not a bug; add a comment to prevent future confusion.

---

## Author-question answers + verdict

- **Q1 (llmRouter TODO acceptable?)** — No. Blocks the feature's live claim. See §6.
- **Q2 (skipped emission sites)** — Lifecycle + prompt + context + clarification + orchestrator is a skeleton only. LLM bookends are the minimum bar for "live log".
- **Q3 (empty permissionMask safe?)** — Safe (no security leak) but degrades UX. See §9.
- **Q4 (coarse layer attributions)** — Useful as progress indicator; misleading as prompt-composition truth. See §10.
- **Q5 (socket room join comment enough?)** — No. Security gap. See §4 (blocker).
- **Q6 (seq allocation gap acceptable?)** — Gaps acceptable per spec §4.2. `emitEventLimitReachedIfFirst` atomicity is the separate concern — see §2.
- **Q7 (O(N²) truncation concern?)** — Not at current scale. See §15.
- **Q8 (redaction path shape consistent?)** — Yes. See §13.
- **Q9 (Buffer.byteLength in pure files?)** — Works; wording nit. See §14.

**Verdict:** Not ready to merge as-is. Four blockers must be fixed before PR:
1. Soft-delete filters missing from label resolver (§1).
2. Atomicity gap in `emitEventLimitReachedIfFirst` (§2).
3. `run.completed` hardcoded zero cost + event count (§3).
4. Socket room join lacking `AGENTS_VIEW` gate — security (§4).

The stub `subaccountPermissionsFor` (§5) should also be cleaned up. The llmRouter emission gap (§6) is borderline blocking — the feature as shipped delivers less than its marketing copy.
