# Wave 5 Session M — LAEL Phase 1 + 2 + Hermes Tier 1 — Implementation Plan

**Plan author:** architect
**Plan date:** 2026-05-16
**Spec:** `tasks/builds/wave-5-lael-phase-1-and-2/spec.md` (Status: `READY_FOR_BUILD`)
**Build slug:** `wave-5-lael-phase-1-and-2`
**Branch:** `claude/lael-phase-1-and-2` (cut from `origin/main` at `86730eea`)
**Class:** Significant
**Estimated chunks:** 10 always-on + 0 conditional (H3/§6.8 verified closed during plan authoring; see Chunk-0 findings).

---

## Table of contents

1. Executor notes
2. Model-collapse check
3. Architecture Notes
4. Stepwise Implementation Plan
5. Per-Chunk Detail
   - Chunk 0 — Preflight sweep + spec amendment
   - Chunk 1 — `memory.retrieved` emissions
   - Chunk 2 — `rule.evaluated` emission
   - Chunk 3 — `skill.invoked` + `skill.completed` emissions
   - Chunk 4 — `handoff.decided` emission (CRITICAL)
   - Chunk 5 — Phase 2 migration + schema + RLS manifest + shared type
   - Chunk 6 — Phase 2 plumbing + `/edits` endpoint
   - Chunk 7 — `EditedAfterBanner` + `AgentRunLivePage` integration
   - Chunk 8 — H1 `successfulCostCents`
   - Chunk 9 — Doc-sync
6. UX Considerations
7. Risks & Mitigations
8. Self-consistency pass
9. Appendix — Chunk-to-spec section traceability

---

## 1. Executor notes

Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

Per-chunk allowed verification commands: `npm run lint`, `npm run typecheck` (or `npx tsc --noEmit`), `npm run build:server` / `npm run build:client` when relevant, and `npx vitest run <single test file path>` for tests authored in that chunk.

---

## 2. Model-collapse check

The three §pre-plan questions, answered explicitly:

1. **Does this feature decompose into ingest → extract → transform → render?** No. The feature is observability instrumentation (emit events at hooks), one new audit table with attribution plumbing, one new cost field, and a UI banner. None of those steps is "have a model do work" — they are deterministic writes and reads.
2. **Is each step doing something a frontier multimodal model could do in a single call?** No. The work is structured persistence + UI integration. No step is interpretive enough to even be addressable by an LLM.
3. **Can the pipeline collapse into one model call with a structured-output schema?** No. There is no model call in this build.

**Decision:** Model-collapse is not applicable. Build proceeds as a deterministic multi-chunk instrumentation programme.

---

## 3. Architecture Notes

### Primary decisions

**A1. Emit via existing primitives — never invent new ones.**
All new emissions ride on the already-shipped `tryEmitAgentEvent` (fire-and-forget) / `await emitAgentEvent` / `await appendEvent` triad. The taxonomy in `shared/types/agentExecutionLog.ts` already covers every event we emit; the validator in `agentExecutionEventServicePure.ts::validateEventPayload` already accepts the payloads. Considered and rejected: introducing per-domain emitter wrappers (e.g. `emitMemoryRetrieved`) — adds an indirection layer with no testable benefit and a wider surface for `tryEmitAgentEvent` divergence.

**A2. Critical-tier emission uses `await emitAgentEvent` (the awaitable wrapper), not `await appendEvent` directly.**
Spec §4.4 says "use `appendEvent` directly … mirroring the awaited pattern used by `run.completed` and `run.started`." Inspection shows `run.completed` (`runLifecycle/complete.ts:190`) and `run.started` (`runLifecycle/persistRun.ts:141`) both use `tryEmitAgentEvent` (fire-and-forget), NOT a direct `appendEvent` await — the wrapper's `emitAgentEvent` is the right awaitable equivalent. We document the discrepancy here so spec readers don't misread it: critical-tier emission in this build awaits `emitAgentEvent(...)` (catches its own throws, logs, never re-throws into the caller). Spec §7.2 is satisfied — emit is awaited before the handoff service returns control to the loop.

**A3. Handoff decision point lives in `skillExecutor/pipeline.ts::enqueueHandoff()`, NOT `agentRunHandoffService.ts`.**
Chunk-0 finding (see below). The spec's file pointer is incorrect; the architect-author target relocates the chunk 4 emission to `pipeline.ts` post-commit. `agentRunHandoffService.ts` builds the handoff JSON snapshot stored in `agent_runs.handoff_json` at run COMPLETION — it is read-only over agent_runs / task_activities and is not the dispatch decision point.

**A4. Phase 2 attribution is "active-attribution-only".**
The audit row is only written when the route caller supplies `?triggeringRunId=…`. Edits made outside the LAEL link path do NOT generate audit rows. Spec §5.2 is explicit; we restate the invariant here because it shapes the chunk 6 contract surface (no inferred attribution, no backfill, no scanner job).

**A5. Phase 2 scope is reduced to two edit surfaces today: workspace memory entries and memory blocks.**
Chunk-0 finding: policy-rule and data-source edit surfaces do not exist in the codebase today (no PATCH route, no service, no frontend drawer). The spec's §5.2 assumed four surfaces; the codebase has at most two we can plumb without inventing new edit routes that weren't in scope of the spec. Chunk 0 records the reduction; the omitted two land in deferred items.

**A6. EditedAfterBanner reads via a thin lightweight endpoint, not via the existing events snapshot.**
Spec §5.3 — `GET /api/agent-runs/:runId/edits`. Considered and rejected: extending the snapshot endpoint to inline the edits — would couple two unrelated read shapes and force any new edit consumer to refetch the events page. The new endpoint reuses `resolveAgentRunVisibility` (same `AGENTS_VIEW` gate) so the permission surface is unchanged.

**A7. `successfulCostCents` is computed at query time, never persisted.**
H1 adds a `SUM(cost_cents) FILTER (WHERE status IN ('success', 'partial'))` aggregate in the route handler — no new column on `agent_runs` or `llm_requests`, no new column on the cost-rollup tables. The field is additive on the response.

**A8. No feature flag, no env-var toggle, no shadow rollout.**
Per LAEL §11.5 (`commit_and_revert`). Emergency disable is `git revert` on the chunk that added a given emission site.

### Primitives-reuse search (per spec-authoring-checklist § Section 1)

| Proposing | Found existing? | Decision |
|---|---|---|
| New emitter wrapper | `tryEmitAgentEvent` + `emitAgentEvent` + `appendEvent` already exist | Reuse |
| New event taxonomy / payload union | `shared/types/agentExecutionLog.ts` covers every event type we emit | Reuse — no extension |
| New validator helper | `agentExecutionEventServicePure.ts::validateEventPayload` already handles all branches | Reuse — no extension |
| New cost-tracking column / table | `llm_requests.status` + `llm_requests.cost_cents` already exist with the filter shape we need | Reuse via SQL aggregate; no new column |
| New permission key for the edits endpoint | `AGENTS_VIEW` already gates the run | Reuse via `resolveAgentRunVisibility` |
| Edit-audit primitive (entry-bound) | None exists; the new `agent_execution_log_edits` table is the new primitive | Invent — see Chunk 5 justification |

The only new primitive in this build is the `agent_execution_log_edits` table (Chunk 5). Every other piece is a reuse of an existing primitive.

### Chunk-0 verification findings — load-bearing

These are the verification outcomes the architect ran while drafting this plan. The chunk-0 actor (Builder during Chunk 0) re-runs the same checks and either confirms or updates the plan via a spec amendment.

| Item | Spec claim | Verified outcome | Action |
|---|---|---|---|
| H3 orthogonality | likely done | **Closed.** `complete.ts:99-107` confirms `hasSummary` is the side-channel; `computeRunResultStatus` is called without it. `complete.ts:206-220` emits `run.terminal.summary_missing` only when `!hasSummary`. | **No Chunk 9A.** Spec §6.2 needs a 1-line edit: change "likely done — chunk-0 confirms" to "verified done 2026-05-16 by plan author". |
| §6.8 errorMessage threading | likely done | **Closed.** `complete.ts:476-499` — `threadedErrorMessage = derivedRunResultStatus === 'failed' ? preFinalizeRow?.errorMessage ?? null : null` then passed into `workspaceMemoryService.extractRunInsights` as `extractionOutcome.errorMessage`. A `run.terminal.extracted_with_errorMessage` side-channel emits when threading fires. | **No Chunk 9B.** Spec §6.3 needs the same 1-line edit. |
| Migration number | expected 0367 | Confirmed. Highest migration at branch-cut is `0366_admin_role_dml_grants.sql`. Slot 0367 is free. | Use 0367 in Chunk 5. Rebase guard in Chunk 5 verification. |
| HandlerContext shape | "carries runId + tenant scope" | Partially correct. `HandlerContext` (per architecture.md and `server/services/handlerContextTypes.ts`) does NOT carry `runId` — it carries `workflowEngine` + `skillExecutor` value-import wrappers only (cycle-break primitive). What carries `runId` is the **second parameter** `SkillExecutionContext` (defined in `skillExecutor/context.ts`) which threads `runId`, `organisationId`, `subaccountId`, `agentId`, etc. Every handler signature is `(input, context: SkillExecutionContext, handlerContext?: HandlerContext)`. | **Chunk 3 emits from the registry's `execute` dispatcher using `context.runId` etc.** — not via `HandlerContext`. Spec §4.3 paragraph needs a 1-line clarification. |
| Handoff dispatch location | `agentRunHandoffService.ts` | **Incorrect.** `agentRunHandoffService.ts` builds the handoff *JSON snapshot* stored in `agent_runs.handoff_json` at run COMPLETION (read sources: `agent_runs`, `agent_run_messages`, `task_activities`, `task_deliverables`, `review_items`, `tasks` — see file header). The actual handoff dispatch decision point is `skillExecutor/pipeline.ts::enqueueHandoff()` (the function that inserts the child run row and enqueues the pg-boss `agent-handoff-run` job). Called from `skillExecutor/handlers/handoff.ts::executeSpawnSubAgents`. | **Chunk 4 emits `handoff.decided` inside `pipeline.ts::enqueueHandoff` immediately after `db.transaction` commits — i.e. after the child run row exists and the pg-boss job is enqueued.** Spec §4.4 and §8 file table need updates to point at `pipeline.ts`. |
| Edit-surface frontend files | four `*EditDrawer.tsx` files | **None exist.** Searched `client/src/**` — no `MemoryEditDrawer*`, no `MemoryBlockEditDrawer*`, no `PolicyRuleEditDrawer*`, no `DataSourceEditDrawer*`. Memory has `MemoryBlockDetailPage.tsx` + `MemoryReviewQueuePage.tsx`; policy rules and data sources have no edit UI in the client at all. | **Phase 2 scope reduced from four entities to two: memory blocks + workspace memory summary.** Policy-rule and data-source edit surfaces go to Deferred Items. Spec §5.2 / §5.3 / §8 / §11 need edits in Chunk 0. |
| Edit-surface backend routes | four route files | **Two exist (partially).** `server/routes/workspaceMemory.ts` — has `PUT /api/subaccounts/:subaccountId/memory` (summary edit) and DELETE on entries, but **no PATCH on per-entry**. `server/routes/memoryBlocks.ts:117` — has `PATCH /api/memory-blocks/:id`. No `server/routes/policyRules.ts`, no `server/routes/dataSources.ts`. No `server/services/policyRuleService.ts`, no `server/services/dataSourceService.ts`. | **Memory blocks: ready for plumbing (existing PATCH).** **Memory entries: needs a new PATCH route OR scope-reduce to "summary edit triggers audit row".** Plan opts for the smaller surface: audit row writes on the existing memory-block PATCH and on the existing workspaceMemory summary PUT. Memory-entry per-row PATCH is a separate add and is descoped to a follow-up. Spec §5.2 / §5.3 / §8 / §11 need edits in Chunk 0. |
| AgentRunLivePage integration surface | banner mounts on past runs | Confirmed. Page at `client/src/pages/AgentRunLivePage.tsx` renders `Timeline` + `EventDetailDrawer`. Banner mount point is between the run-meta header and the timeline. The page already gates "live vs past" by `runMeta.status` terminal-vs-not — banner short-circuits when status is non-terminal. | No spec change; integrate per Chunk 7. |

**Result: Chunks 9A and 9B are absent (H3 + §6.8 verified closed).** **Phase 2 scope is reduced from four to two entities.** **Chunk 4 emission location is corrected.** Final chunk count: **10** (was "10 always-on + 0 conditional"). The reduction does not change the chunk count — it changes the scope of Chunks 5–7.

---

## 4. Stepwise Implementation Plan

### Dependency-ordering note

The chunks form a partial order:

```
Chunk 0 (sweep + spec amendment)  ── must complete first
                  │
        ┌─────────┼─────────┬─────────┬─────────┐
        ▼         ▼         ▼         ▼         ▼
   Chunk 1   Chunk 2   Chunk 3   Chunk 4   Chunk 8
   memory    rule      skill     handoff   H1 cost
   .retrvd   .evald    *         .decided  field
   emit      emit      emit      (CRIT)
        │         │         │         │         │
        └─────────┴─────────┴─────────┴─────────┘
                  │
                  ▼
              Chunk 5 (Phase 2 migration + schema + RLS manifest)
                  │
                  ▼
              Chunk 6 (Phase 2 plumbing — routes + services + types + /edits endpoint)
                  │
                  ▼
              Chunk 7 (EditedAfterBanner + AgentRunLivePage integration)
                  │
                  ▼
              Chunk 9 (doc-sync — architecture.md + KNOWLEDGE.md if needed)
```

- **Chunk 0 is the gate.** Spec amendments land before any other chunk starts.
- **Chunks 1–4 + 8 are forward-independent.** They each touch a different production file and can be implemented in any order or in parallel after Chunk 0.
- **Chunk 5 must precede Chunk 6** — the table must exist before the route handlers write to it.
- **Chunk 6 must precede Chunk 7** — the endpoint in Chunk 6 is the banner's data source.
- **Chunk 9 (doc-sync) is last** — gathers behaviour changes from 1–8.

### Chunks (named, not numbered-only)

- **Chunk 0** — Preflight sweep + spec amendment (no production code)
- **Chunk 1** — `memory.retrieved` emissions (hybrid retrieval + memory-block injection)
- **Chunk 2** — `rule.evaluated` emission (decisionTimeGuidanceMiddleware)
- **Chunk 3** — `skill.invoked` + `skill.completed` emissions (skillExecutor registry boundary)
- **Chunk 4** — `handoff.decided` emission (critical, awaited; `pipeline.ts::enqueueHandoff`)
- **Chunk 5** — Phase 2 migration + Drizzle schema + RLS manifest + shared type
- **Chunk 6** — Phase 2 plumbing: `triggeringRunId` on memory-block PATCH + workspaceMemory summary PUT; `/edits` endpoint
- **Chunk 7** — `EditedAfterBanner` component + `AgentRunLivePage` integration
- **Chunk 8** — H1 `successfulCostCents` (type + route + pure + panel + tests)
- **Chunk 9** — Doc-sync (architecture.md + capabilities.md conditional + KNOWLEDGE.md conditional)

---

## 5. Per-Chunk Detail

### 5.0 Chunk 0 — Preflight sweep + spec amendment

**spec_sections:** §3.1, §3.2, §6.2, §6.3, §8, §10 (verification step), §11

**Public interface this chunk exposes:** none (no production code). The chunk produces a documented amendment to `tasks/builds/wave-5-lael-phase-1-and-2/spec.md` and a verification log at `tasks/builds/wave-5-lael-phase-1-and-2/verification-log.md`.

**What stays hidden behind it:** all the grep + file-read evidence, the exact line numbers confirming H3 / §6.8 closure, the migration-number rebase decision, the inventory diff between spec §8 and reality.

**Files to create or modify:**

- `tasks/builds/wave-5-lael-phase-1-and-2/verification-log.md` (new) — record evidence per spec-authoring-checklist § Section 0 (`verified open|closed by <commit>`).
- `tasks/builds/wave-5-lael-phase-1-and-2/spec.md` (modify) — apply the seven amendments below.

**Spec amendments to apply (mechanical):**

1. **§3.1 row 13 (Hermes H3):** change `Status: likely done — chunk-0 confirms` → `Status: verified done 2026-05-16` and remove the "chunk-0 confirms" note. Add evidence line numbers (`complete.ts:99-107`, `:206-220`).
2. **§3.1 row 14 (Hermes §6.8):** change `Status: likely done — chunk-0 confirms` → `Status: verified done 2026-05-16`. Add evidence line numbers (`complete.ts:476-499`).
3. **§3.2 rows referring to policy-rule and data-source edit surfaces:** add a note "Note: policy-rule and data-source edit surfaces do not exist in the codebase as of 2026-05-16 — Phase 2 scope reduced to memory blocks + workspace memory summary. Original four-surface plumbing deferred per §11."
4. **§4.3 paragraph "Run-context"**: change `HandlerContext already carries runId, organisationId, subaccountId per Session H` → `SkillExecutionContext (the second parameter alongside HandlerContext) carries runId, organisationId, subaccountId — handlers always receive both. HandlerContext is the cycle-break primitive (workflowEngine + skillExecutor wrappers) and does not carry tenant scope.`
5. **§4.4 paragraph "Where" + §8 file table row:** change emission location from `server/services/agentRunHandoffService.ts` → `server/services/skillExecutor/pipeline.ts::enqueueHandoff` (post-commit). Add a footnote: "agentRunHandoffService.ts is unrelated — it builds the handoff JSON snapshot at run completion (read-only over agent_runs / task_activities / etc.) and is NOT the dispatch decision point."
6. **§5.2 + §5.3 + §8:** remove policy-rule and data-source edit-surface rows from the Files-to-change inventory. Update the four-surfaces enumeration in §5.2 to two surfaces (memory blocks + workspace memory summary). Update §11 (Deferred Items) to add: "Policy-rule edit audit trail (no edit surface today); Data-source edit audit trail (no edit surface today); Per-entry memory-entries audit (no PATCH route today)." Reduce Phase 2 chunk-6 scope description accordingly.
7. **§6.2 + §6.3:** remove the "Chunk-0 task" bullets; replace with "Verified closed by plan author 2026-05-16 — no chunk needed".

**Module shape — none.** This chunk produces documentation only.

**Contracts:** none.

**Error handling:** if the chunk-0 actor (builder during Chunk 0) finds that the verification outcomes diverge from this plan's table (e.g. someone re-introduced H3 demotion in a Wave-5 K/L/N concurrent session), the chunk produces a new Chunk 9A or 9B and inserts it in the dependency order between Chunk 4 and Chunk 5.

**Test considerations:** none — no production code touched.

**Dependencies:** none.

**Acceptance criteria:**
- `tasks/builds/wave-5-lael-phase-1-and-2/verification-log.md` exists and records the seven verification outcomes with file:line evidence.
- `spec.md` Status header reflects `accepted` (was `reviewing`).
- The seven amendments above are applied.
- A grep for `MemoryEditDrawer|PolicyRuleEditDrawer|DataSourceEditDrawer` in `spec.md` returns zero hits (or only inside the §11 Deferred section).

**Verification commands:** `npm run lint` on `.md` files is not meaningful — manual review only.

### 5.1 Chunk 1 — `memory.retrieved` emissions

**spec_sections:** §4.1, §7.1, §7.2 (non-critical tier), §9 (no new tests).

**Public interface this chunk exposes:** two side-effect calls to `tryEmitAgentEvent` — no exported API change. The retrieval functions (`workspaceMemoryService.hybridRetrieve` and `memoryBlockService.getBlocksForInjection`) keep their existing signatures and return values unchanged.

**What stays hidden behind it:** the top-N excerpt truncation (240 chars), the score selection logic, the empty-array null-`linkedEntity` decision, the `runId == null` skip path for non-agent callers.

**Files to create or modify:**

- `server/services/workspaceMemoryService/hybridRetrieval.ts` (modify) — emit `memory.retrieved` at the **return** boundary of the hybrid-retrieve function. Read `runId`/`organisationId`/`subaccountId` from the existing function arguments. Skip silently if `runId == null` (admin tooling / config-assistant call sites).
- `server/services/memoryBlockService.ts` (modify) — emit `memory.retrieved` at the **return** boundary of `getBlocksForInjection`. Same `runId == null` skip.

**Module shape:**

- *Public interface:* unchanged — both functions retain their existing return shape.
- *Hidden:* the emission call (`tryEmitAgentEvent`), the payload-construction (truncate excerpt to 240 chars, slice top 5), the linkedEntity selection.

**Contracts:**

Payload (already covered by `shared/types/agentExecutionLog.ts` `MemoryRetrievedPayload` and validator branch in `agentExecutionEventServicePure.ts::validateEventPayload`):

```ts
{
  eventType: 'memory.retrieved',
  critical: false,
  queryText: string,           // the input query (untruncated; persistence layer caps total payload bytes)
  retrievalMs: number,         // wall-clock duration of the retrieval call
  topEntries: Array<{
    id: string,
    score: number,             // ranking score from the hybrid ranker
    excerpt: string,           // first 240 chars of the entry text
  }>,                          // length ≤ 5
  totalRetrieved: number,      // pre-top-N count
}
```

`linkedEntity` (top-level on the `AppendEventInput`, not inside payload):
- workspaceMemoryService → `{ type: 'memory_entry', id: topEntries[0].id }` when non-empty; `null` otherwise.
- memoryBlockService → `{ type: 'memory_block', id: topEntries[0].id }` when non-empty; `null` otherwise.

`sourceService` tag: `'workspaceMemoryService'` or `'memoryBlockService'`.

**Error handling:**

- Emission throws are swallowed by `tryEmitAgentEvent` (existing contract). The retrieval call's return value is never affected.
- `runId == null` (non-agent callers): emit is skipped silently. No log, no metric — this is the documented expected path for admin tooling.

**Test considerations:**

- Pure helper used? No new pure helper. The taxonomy validator already covers `memory.retrieved`, and existing tests at `server/services/__tests__/agentExecutionEventServicePure.test.ts` pin it.
- **No new tests in this chunk.** Spec §9 says no new tests on emission sites.

**Dependencies:** Chunk 0.

**Acceptance criteria:**
- `grep "tryEmitAgentEvent" server/services/workspaceMemoryService/hybridRetrieval.ts` returns ≥1 hit.
- `grep "tryEmitAgentEvent" server/services/memoryBlockService.ts` returns ≥1 hit at `getBlocksForInjection`.
- `npm run typecheck` passes.
- `npm run lint` passes.

**Verification commands:** `npm run lint`, `npm run typecheck`.

### 5.2 Chunk 2 — `rule.evaluated` emission

**spec_sections:** §4.2, §7.1.

**Public interface this chunk exposes:** none — emission is internal to the middleware.

**What stays hidden behind it:** the no-rule-matched fallback (`matchedRuleId: null`), the boolean `guidanceInjected`.

**Files to create or modify:**

- `server/services/middleware/decisionTimeGuidanceMiddleware.ts` (modify) — emit `rule.evaluated` after rule-match evaluation completes. One emission per tool-call evaluation. Read `runId`/`organisationId`/`subaccountId` from the tool-call envelope (already in scope).

**Module shape:**

- *Public interface:* unchanged.
- *Hidden:* the per-evaluation emission.

**Contracts:**

Payload (existing taxonomy + validator):

```ts
{
  eventType: 'rule.evaluated',
  critical: false,
  toolSlug: string,
  matchedRuleId: string | null,
  decision: 'auto' | 'review' | 'block',
  guidanceInjected: boolean,
}
```

`linkedEntity`: `{ type: 'policy_rule', id: matchedRuleId }` when non-null; otherwise `null`.

`sourceService` tag: `'decisionTimeGuidanceMiddleware'`.

**Error handling:** swallowed by `tryEmitAgentEvent`. The middleware's decision return is never affected.

**Test considerations:** no new tests (validator already covers `rule.evaluated`).

**Dependencies:** Chunk 0.

**Acceptance criteria:**
- `grep "tryEmitAgentEvent" server/services/middleware/decisionTimeGuidanceMiddleware.ts` returns ≥1 hit.
- `npm run typecheck` passes.

**Verification commands:** `npm run lint`, `npm run typecheck`.

### 5.3 Chunk 3 — `skill.invoked` + `skill.completed` emissions

**spec_sections:** §4.3, §7.1 (uniform per-handler coverage via executor boundary).

**Public interface this chunk exposes:** none — emission is internal to the skill-executor registry. Handlers do NOT get a new contract.

**What stays hidden behind it:** the wrap-around-handler emission pattern; the try/finally that ensures `skill.completed` fires even on handler throw; the `skillId` resolution for `linkedEntity` (system skills with slug-only identity get `linkedEntity: null`); the redaction of `input` (which is the writer's responsibility, not this chunk's).

**Files to create or modify:**

- `server/services/skillExecutor/registry.ts` (modify) — modify the `skillExecutor.execute` dispatch wrapper to emit `skill.invoked` immediately before the handler call and `skill.completed` in a try/finally after. Read `runId`/`organisationId`/`subaccountId`/`agentId` from the `context: SkillExecutionContext` parameter (already in scope). Skip silently when `context.runId == null` (skill-studio sandbox, dev-context tooling).

**Module shape:**

- *Public interface:* `skillExecutor.execute(params)` signature unchanged. `SKILL_HANDLERS` map unchanged. No handler file is touched.
- *Hidden:* the executor-side `skill.invoked` / `skill.completed` envelope; the try/finally ordering; the linkedEntity null fallback.

**Contracts:**

Payload — invoked (existing taxonomy + validator):

```ts
{
  eventType: 'skill.invoked',
  critical: false,
  skillSlug: string,
  skillName: string,           // human-readable (defaults to slug when no friendlier name)
  input: unknown,              // pre-redaction; redaction happens in the writer
  reviewed: boolean,           // true when the action passed proposeReviewGatedAction
  actionId: string | null,     // when the call created an action row
}
```

Payload — completed (existing taxonomy + validator; optional discriminator fields covered by validator at `agentExecutionEventServicePure.ts:267-293`):

```ts
{
  eventType: 'skill.completed',
  critical: false,
  skillSlug: string,
  durationMs: number,
  outcome: 'success' | 'failure' | 'skipped' | 'fallback',
  // Optional discriminators populated when the handler returns them:
  skillType?: string,
  errorCode?: string,
  provider?: string,
  connectionKey?: string,
  idempotent?: boolean,
}
```

`linkedEntity`: `{ type: 'skill', id: skillId }` when resolvable; `null` otherwise.

`sourceService` tag: `'skillExecutor'`.

**Error handling:**

- Both emissions go through `tryEmitAgentEvent`. Handler-side errors do NOT swallow the `skill.completed` emit — the try/finally ensures it fires.
- `context.runId == null`: skip silently (skill-studio sandbox, dev-context tooling).
- Handler throw path: `skill.completed` fires with `outcome: 'failure'` and `errorCode` if available; the throw propagates to the caller unchanged.

**Test considerations:**

- No new tests on the emission. The validator's existing branch coverage in `agentExecutionEventServicePure.test.ts` pins both payloads. A targeted Vitest is **not** required for this chunk — emission is plumbing only.

**Dependencies:** Chunk 0.

**Acceptance criteria:**
- `grep "tryEmitAgentEvent" server/services/skillExecutor/registry.ts` returns ≥2 hits (one for invoked, one for completed).
- All 30+ handlers are covered transparently (no handler-file edit).
- `npm run typecheck` passes.
- `npm run lint` passes.
- The existing `server/services/skillExecutor/__tests__/registry.handlerContextForwarding.test.ts` continues to pass (sanity check that wrapper doesn't break HandlerContext forwarding).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/skillExecutor/__tests__/registry.handlerContextForwarding.test.ts`.

### 5.4 Chunk 4 — `handoff.decided` emission (CRITICAL, awaited)

**spec_sections:** §4.4, §7.2 (critical-event invariant).

**Public interface this chunk exposes:** none — emission is internal to `enqueueHandoff`.

**What stays hidden behind it:** the await positioning (post-commit), the one-inline-retry-with-50ms-backoff path (lives inside `appendEvent`, not at this call site), the silent-skip when the enqueue failed (no decision, nothing to record).

**Files to create or modify:**

- `server/services/skillExecutor/pipeline.ts` (modify) — emit `handoff.decided` inside `enqueueHandoff`, in the success branch only (after `db.transaction` resolves and after `createEvent('agent.handoff.enqueued', …)`). Use `await emitAgentEvent(...)` (the awaitable wrapper) — NOT `tryEmitAgentEvent`. The current `enqueueHandoff` does not have access to a `parentRunId` field by name (it has `sourceRunId`); the emission's `parentRunId` is `req.sourceRunId`.

**Module shape:**

- *Public interface:* `enqueueHandoff(req: HandoffRequest)` return type unchanged. The function remains `Promise<HandoffEnqueueResult>`.
- *Hidden:* the awaited emission; the depth/parent-run mapping for the payload.

**Contracts:**

Payload (existing taxonomy + validator):

```ts
{
  eventType: 'handoff.decided',
  critical: true,
  targetAgentId: string,       // = req.agentId
  reasonText: string,          // = req.handoffContext ?? '' (handoffContext is optional)
  depth: number,               // = req.handoffDepth (the NEW depth, post-increment)
  parentRunId: string,         // = req.sourceRunId
}
```

`linkedEntity`: `{ type: 'agent', id: req.agentId }`.

`sourceService` tag: `'skillExecutor'` (the file's existing source-service tag — see §A3 architecture note above for why this differs from spec §4.4's `'agentRunHandoffService'`).

**Error handling:**

- `emitAgentEvent` already catches internal throws and logs them via `logger.warn('agentExecutionEventEmitter.unexpected_throw', …)`. The handoff service therefore never throws on emission failure.
- The awaited contract per LAEL §4.1: emit completes before the function returns the success result. The one-inline-retry-with-50ms-backoff lives inside `appendEvent` and we inherit it for free.
- **No emission on failure paths.** When `enqueueHandoff` returns `{ enqueued: false, reason }`, no `handoff.decided` event fires — there's no decision to record. The existing `logger.warn('handoff.depth_cap_rejected', …)` continues to carry the rejection signal.

**Test considerations:**

- This is a critical-tier emission and per LAEL §4.1 the emit is awaited before the function returns. A targeted Vitest is recommended here to lock the await contract: assert that calling `enqueueHandoff` does not resolve until `emitAgentEvent` resolves. Pure-style — mock `appendEvent` to capture order.
- **New test file:** `server/services/skillExecutor/__tests__/enqueueHandoffEmissionPure.test.ts` — single Vitest spec with 2 cases: (a) success enqueue → emit fires + awaited; (b) failure enqueue (depth_cap) → no emit. The test mocks `appendEvent` via a `vi.spyOn` on the module export; the existing emitter logs are silenced by mocking the `logger` object directly (per DEVELOPMENT_GUIDELINES §7).

**Dependencies:** Chunk 0.

**Acceptance criteria:**
- `grep "emitAgentEvent\|tryEmitAgentEvent" server/services/skillExecutor/pipeline.ts` returns ≥1 hit using `emitAgentEvent` (awaited form).
- `enqueueHandoff` is the only call site emitting `handoff.decided`.
- New Vitest passes.
- `npm run typecheck` passes.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/skillExecutor/__tests__/enqueueHandoffEmissionPure.test.ts`.

### 5.5 Chunk 5 — Phase 2 migration + Drizzle schema + RLS manifest + shared type

**spec_sections:** §5.1, §7.1 (Permissions/RLS), §8.

**Public interface this chunk exposes:**
- New table `agent_execution_log_edits` (columns + RLS policy + indexes).
- New Drizzle schema export `agentExecutionLogEdits` from `server/db/schema/index.ts`.
- New shared type `AgentExecutionLogEdit` exported from `shared/types/agentExecutionLogEdits.ts`.
- New manifest entry in `server/config/rlsProtectedTables.ts`.

**What stays hidden behind it:** the partial unique index (if any), the index choice for `(run_id, edited_at)` to support the `/edits` endpoint, the soft-delete posture (none — audit rows are append-only).

**Files to create or modify:**

- `migrations/0367_agent_execution_log_edits.sql` (new) — CREATE TABLE, indexes, RLS policy (canonical org-isolation shape per architecture.md § RLS), GRANTs.
- `migrations/0367_agent_execution_log_edits.down.sql` (new) — DROP TABLE.
- `server/db/schema/agentExecutionLogEdits.ts` (new) — Drizzle table definition mirroring the migration.
- `server/db/schema/index.ts` (modify) — re-export.
- `server/config/rlsProtectedTables.ts` (modify) — add `{ tableName: 'agent_execution_log_edits', policyMigration: '0367_…', orgColumn: 'organisation_id' }`.
- `shared/types/agentExecutionLogEdits.ts` (new) — `AgentExecutionLogEdit` response type matching the §5.3 API projection.

**Module shape:**

- *Public interface:* the table columns + the shared type. Both are read-stable contracts consumed by Chunks 6 + 7.
- *Hidden:* index strategy, RLS policy wording (canonical).

**Contracts:**

Migration (`0367_agent_execution_log_edits.sql`):

```sql
CREATE TABLE agent_execution_log_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid REFERENCES subaccounts(id),       -- nullable; mirror parent run scope
  run_id uuid NOT NULL REFERENCES agent_runs(id),       -- the run that triggered the edit
  entity_type text NOT NULL,                             -- LinkedEntityType discriminator
  entity_id uuid NOT NULL,
  edited_at timestamptz NOT NULL DEFAULT now(),
  edited_by_user_id uuid NOT NULL REFERENCES users(id),
  edit_summary text NOT NULL,                            -- human-readable, written by the edit surface
  before_snapshot jsonb,                                 -- nullable; populated only where the edit surface returns it cheaply
  after_snapshot jsonb,                                  -- same
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_execution_log_edits_run_idx
  ON agent_execution_log_edits (run_id, edited_at DESC);

CREATE INDEX agent_execution_log_edits_entity_idx
  ON agent_execution_log_edits (entity_type, entity_id, edited_at DESC);

ALTER TABLE agent_execution_log_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_execution_log_edits FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_execution_log_edits_org_isolation
  ON agent_execution_log_edits
  USING (organisation_id = current_setting('app.organisation_id')::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id')::uuid);

GRANT SELECT, INSERT ON agent_execution_log_edits TO synthetos_app_role;
```

Drizzle schema (`server/db/schema/agentExecutionLogEdits.ts`): standard Drizzle definition matching the SQL above; FKs reference the existing `organisations`, `subaccounts`, `agentRuns`, `users` exports.

Shared type (`shared/types/agentExecutionLogEdits.ts`):

```ts
import type { LinkedEntityType } from './agentExecutionLog';

export interface AgentExecutionLogEdit {
  entityType: LinkedEntityType;
  entityId: string;
  editedAt: string;             // ISO timestamp
  editedByUserId: string;
  editSummary: string;
}
```

Note: `before_snapshot` / `after_snapshot` are NOT in the projection (spec §5.3, deferred to a diff viewer in §11).

**Error handling:** migration errors (FK to a missing parent, RLS misconfig) are caught by the migration runner. No runtime error handling required at this layer.

**Test considerations:**

- No new tests. RLS coverage is asserted by the existing CI gate `verify-rls-coverage.sh` against the manifest entry.
- Schema-vs-migration column-set parity: trust the existing convention (Drizzle file mirrors SQL); CI's `verify-schema-matches-migration` gate handles drift.

**Dependencies:** Chunk 0.

**Acceptance criteria:**
- Migration files exist with `0367_agent_execution_log_edits.sql` (and the `.down.sql`).
- `npm run db:generate` does not produce a drift diff against the schema file.
- Manifest entry exists in `rlsProtectedTables.ts`.
- The shared type compiles (`npm run typecheck`).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run db:generate` (verify the generated file matches the hand-written 0367 migration — Drizzle's auto-generate will skip new tables defined manually if names match exactly).

### 5.6 Chunk 6 — Phase 2 plumbing: `triggeringRunId` + `/edits` endpoint

**spec_sections:** §5.2 (reduced scope: memory blocks + workspace memory summary), §5.3 (API projection), §7.1.

**Public interface this chunk exposes:**
- `GET /api/agent-runs/:runId/edits` — new read endpoint, gated by `resolveAgentRunVisibility` AGENTS_VIEW.
- `PATCH /api/memory-blocks/:id?triggeringRunId=<uuid>` — existing route gains an optional query param.
- `PUT /api/subaccounts/:subaccountId/memory?triggeringRunId=<uuid>` — existing route gains an optional query param.
- `memoryBlockService.updateBlock(...)` — gains an optional `triggeringRunId` argument that, when present, writes an audit row inside the same transaction as the block update.
- `workspaceMemoryService.updateSummary(...)` — same shape.

**What stays hidden behind it:** the audit-row write transaction, the `principalContext` propagation (already established by the route's auth chain), the Zod validation of `triggeringRunId` (must be a UUID).

**Files to create or modify:**

- `server/routes/memoryBlocks.ts` (modify) — accept optional `?triggeringRunId=<uuid>` query param on the PATCH route at line 117; validate via Zod; pass through to `memoryBlockService.updateBlock(...)`.
- `server/services/memoryBlockService.ts` (modify) — `updateBlock(...)` gains optional `triggeringRunId?: string` parameter; when present, write an `agent_execution_log_edits` row inside the same transaction as the block update; compute `editSummary` as a short human-readable string (e.g. `"Updated content (NNN→MMM chars)"` or `"Renamed: <old> → <new>"`).
- `server/routes/workspaceMemory.ts` (modify) — accept optional `?triggeringRunId=<uuid>` on the existing PUT `/api/subaccounts/:subaccountId/memory` route at line 39; pass through.
- `server/services/workspaceMemoryService.ts` (modify) — `updateSummary(...)` gains optional `triggeringRunId` arg; audit-row write inside the existing transaction.
- `server/routes/agentExecutionLog.ts` (modify) — add a new `GET /api/agent-runs/:runId/edits` handler. Inline simple SELECT (no new service file per architecture.md § "When to create a new service"). Gate via `resolveAgentRunVisibility` AGENTS_VIEW (same as the existing 3 GETs in this file).

**Module shape:**

- *Public interface:* the three URL endpoints + the two service function signatures. The shared type from Chunk 5 is the response shape.
- *Hidden:* the editSummary string formatting; the UUID validation; the `triggeringRunId` short-circuit (skip audit write when absent); the transaction boundary; the audit-row column derivation (entityType/entityId from the block/summary scope).

**Contracts:**

Route — `GET /api/agent-runs/:runId/edits`:
- Auth: `authenticate` → `resolveAgentRunVisibility(req.orgId!, runId, req.user)` → `AGENTS_VIEW`.
- Response: `200 { edits: AgentExecutionLogEdit[] }`.
- Errors: `404` when the run is invisible to the caller; `403` when the org doesn't match; `400` when `:runId` is not a UUID.
- Order: `edited_at DESC, id ASC` (stable tiebreaker per DEVELOPMENT_GUIDELINES §8.34).
- No pagination in v1 — edits per run are bounded by user behaviour; if a real cap is needed it ships in a follow-up.

Service shape addition — `memoryBlockService.updateBlock`:

```ts
async function updateBlock(args: {
  organisationId: string;
  blockId: string;
  changes: Partial<MemoryBlock>;
  actor: { userId: string; … };
  triggeringRunId?: string;     // NEW
}): Promise<MemoryBlock>;
```

When `triggeringRunId` is present, inside the same `withOrgTx` that updates the block:

```ts
await tx.insert(agentExecutionLogEdits).values({
  organisationId,
  subaccountId,                                   // from run lookup or block scope
  runId: triggeringRunId,
  entityType: 'memory_block',
  entityId: blockId,
  editedByUserId: actor.userId,
  editSummary: buildEditSummary(prev, changes),
});
```

Service shape addition — `workspaceMemoryService.updateSummary`: same pattern, `entityType: 'workspace_memory'` (or `'memory_summary'` — exact value pinned during Chunk 6 implementation against the existing `LinkedEntityType` union; chunk-0 confirms the union member).

**Error handling:**

- If the route receives `?triggeringRunId=` with a non-UUID, Zod rejects → 400.
- If the audit-row INSERT fails (FK violation: run doesn't exist or belongs to a different org), the **whole transaction aborts** — the block/summary update is rolled back. Caller sees a 500 / 409 envelope per the existing error mapping. This is the deliberate posture: a Phase 2 audit failure must NOT silently drop attribution.
  - Rationale: the route only writes the audit row when the caller explicitly opted in via `?triggeringRunId=`. If we can't write it, the caller's intent ("this is a run-linked edit") cannot be honoured, so the edit must fail.
- When `triggeringRunId` is absent, the existing edit path runs unchanged. No audit row, no risk.
- The `/edits` endpoint never inserts. Read-only.

**Test considerations:**

- **Targeted Vitest:** `server/routes/__tests__/agentExecutionLogEditsRoutePure.test.ts` — pure helper test for the response-shape mapper (row → `AgentExecutionLogEdit`). 2 cases: full row, sparse row (`before_snapshot`/`after_snapshot` absent).
- **Targeted Vitest:** `server/services/__tests__/memoryBlockServiceEditsPure.test.ts` — pure helper test for `buildEditSummary(prev, changes)` covering: content-length delta, name change, no-op edge case. 3 cases.
- No DB-touching tests (per posture).

**Dependencies:** Chunk 5.

**Acceptance criteria:**
- `GET /api/agent-runs/:runId/edits` returns the expected shape via manual smoke (curl) — though this is not automated.
- Existing `memoryBlocks` and `workspaceMemory` integration tests (if they exist) continue to pass with the optional parameter.
- New pure tests pass.
- `npm run typecheck` and `npm run lint` pass.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/routes/__tests__/agentExecutionLogEditsRoutePure.test.ts`, `npx vitest run server/services/__tests__/memoryBlockServiceEditsPure.test.ts`.

### 5.7 Chunk 7 — `EditedAfterBanner` component + `AgentRunLivePage` integration

**spec_sections:** §5.3 (banner shape + scope limitation), §6.5 of LAEL canonical.

**Public interface this chunk exposes:**
- React component `EditedAfterBanner` at `client/src/components/agentRunLog/EditedAfterBanner.tsx`.
- One mount point on `AgentRunLivePage` (visible only when `runMeta.status` is terminal — past runs).

**What stays hidden behind it:** the fetch helper for `/api/agent-runs/:runId/edits`, the loading/empty/error states, the user-display-name resolution helper, the React useEffect cancellation guard (per DEVELOPMENT_GUIDELINES §8.37).

**Files to create or modify:**

- `client/src/components/agentRunLog/EditedAfterBanner.tsx` (new) — React functional component. Props: `{ runId: string; isTerminal: boolean }`. Internal state: `edits: AgentExecutionLogEdit[] | null` (null = not yet loaded, `[]` = loaded-empty). Renders nothing when `!isTerminal` or `edits === null` or `edits.length === 0`. Renders a non-emoji info banner listing each edit ("Memory block 'X' edited by Y at Z: <summary>") otherwise.
- `client/src/pages/AgentRunLivePage.tsx` (modify) — mount the banner between the run-meta header and the timeline component. Pass `isTerminal` based on `runMeta.status` being a terminal status.

**Module shape:**

- *Public interface:* one component, one prop shape.
- *Hidden:* the fetch, cancellation guard, ordering, copy formatting, user-name resolution.

**Contracts:**

Component contract:

```ts
interface EditedAfterBannerProps {
  runId: string;
  isTerminal: boolean;          // when false, the component renders nothing
}
```

Fetch contract (consumes the Chunk 6 endpoint):

```
GET /api/agent-runs/:runId/edits → { edits: AgentExecutionLogEdit[] }
```

Display strings (no emojis, no em-dashes per user preferences):
- `Memory block "<name>" edited by <displayName> at <localTime>: <editSummary>`
- `Memory summary edited by <displayName> at <localTime>: <editSummary>`

Empty state: render nothing (per spec §5.3 — banner only appears when there is at least one edit attributed to this run).

**Error handling:**

- Fetch failure: render nothing. The banner is informational; an absent banner is the same as a no-edits banner. Log to `console.warn` for observability (per DEVELOPMENT_GUIDELINES §8.36 — no silent catch).
- `isTerminal === false`: short-circuit early. No fetch. Matches spec §5.3 ("Used on AgentRunLivePage for past runs only").
- useEffect cancellation: per DEVELOPMENT_GUIDELINES §8.37, a `cancelled` boolean checked before `setState`.

**Test considerations:**

- No new tests. Per DEVELOPMENT_GUIDELINES §7 (`frontend_tests: none_for_now`), frontend components are not tested at this posture. The branch logic for `isTerminal` is trivially verifiable.

**Dependencies:** Chunk 6 (the `/edits` endpoint must exist).

**Acceptance criteria:**
- `EditedAfterBanner.tsx` exists and exports a named React component.
- `AgentRunLivePage.tsx` mounts it conditionally on terminal status.
- `npm run build:client` succeeds.
- `npm run typecheck` succeeds.
- `npm run lint` succeeds.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:client`.

### 5.8 Chunk 8 — H1 `successfulCostCents`

**spec_sections:** §6.1.

**Public interface this chunk exposes:**
- `RunCostResponse` gains a `successfulCostCents: number` field (always present, zero default).
- `RunCostPanelPure` gains a branch output indicating whether to render the secondary "Successful: $X.XX" line.

**What stays hidden behind it:** the SQL aggregate FILTER, the panel's conditional render JSX, the dollar formatting helper.

**Files to create or modify:**

- `shared/types/runCost.ts` (modify) — add `successfulCostCents: number` to the `RunCostResponse` interface with the §6.1 comment block.
- `server/routes/llmUsage.ts` (modify) — aggregate query gains `SUM(cost_cents) FILTER (WHERE status IN ('success', 'partial')) AS successful_cost_cents` from the `llm_requests_all` view; zero default when row is absent; field returned on the response.
- `client/src/components/run-cost/RunCostPanelPure.ts` (modify) — branch logic: when `successfulCostCents !== totalCostCents`, the pure module returns a secondary-line payload `{ label: 'Successful', amountCents: successfulCostCents }`; otherwise returns `null` for the secondary line.
- `client/src/components/run-cost/RunCostPanel.tsx` (modify) — consume the pure module's branch output; render the optional secondary line as `Successful: $X.XX` with no em-dash.
- `client/src/components/run-cost/__tests__/RunCostPanel.test.ts` (modify) — three new Vitest cases per §6.1:
  - `total === successful` (any value, including both zero): no secondary line rendered (`queryByText('Successful:')` returns null).
  - `successful < total` AND `successful > 0`: secondary line rendered with exact text `Successful: $X.XX` (formatted dollar).
  - `successful === 0` AND `total > 0`: secondary line rendered with exact text `Successful: $0.00`.

**Module shape:**

- *Public interface:* the response field, the panel render decision.
- *Hidden:* the SQL FILTER clause; the dollar-format helper; the React render branch.

**Contracts:**

Response type addition (`shared/types/runCost.ts`):

```ts
export interface RunCostResponse {
  // ... existing fields ...
  /**
   * SUM(cost_cents) WHERE status IN ('success', 'partial').
   * Always present; zero when no successful calls.
   * Per Hermes Tier 1 H1: counts only successful + partial ledger rows,
   * giving cost-per-call calculations a denominator that excludes failed retries.
   */
  successfulCostCents: number;
}
```

SQL change (`server/routes/llmUsage.ts`):

```sql
SELECT
  …existing…,
  COALESCE(SUM(cost_cents) FILTER (WHERE status IN ('success', 'partial')), 0) AS successful_cost_cents
FROM llm_requests_all
WHERE run_id = $1 AND organisation_id = $2
```

Pure module branch (`RunCostPanelPure.ts`):

```ts
export function chooseSecondaryCostLine(
  totalCostCents: number,
  successfulCostCents: number,
): { label: string; amountCents: number } | null {
  if (successfulCostCents === totalCostCents) return null;
  return { label: 'Successful', amountCents: successfulCostCents };
}
```

**Error handling:**

- Missing column / view doesn't exist: route returns 500 via existing asyncHandler envelope. Defensive coding not warranted; the `llm_requests_all` view has been stable since pre-LAEL.
- Field is additive; downstream consumers that ignore it continue to work unchanged.

**Test considerations:**

- **Three Vitest cases per spec §6.1** in `RunCostPanel.test.ts` — pure-component test against the existing test fixture pattern. Use `vitest` + `@testing-library/react` already in scope at this file. Assert exact label string `"Successful: $X.XX"` per spec.

**Dependencies:** Chunk 0.

**Acceptance criteria:**
- `grep "successfulCostCents" shared/types/runCost.ts` returns 1 hit.
- `grep "successful_cost_cents" server/routes/llmUsage.ts` returns 1 hit.
- All three new Vitest cases pass.
- `npm run typecheck`, `npm run lint`, `npm run build:client` pass.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:client`, `npx vitest run client/src/components/run-cost/__tests__/RunCostPanel.test.ts`.

### 5.9 Chunk 9 — Doc-sync

**spec_sections:** §8 (doc-sync rows).

**Public interface this chunk exposes:** none — documentation only.

**What stays hidden behind it:** the editorial decisions about what changed customer-visibly.

**Files to create or modify:**

- `architecture.md` (modify) — one-line update under "Agent Execution Log" / agent-execution-observability key files row noting Phase 2 audit trail + H1 field. Add `agent_execution_log_edits` to the relevant key-files-per-domain row.
- `docs/capabilities.md` (modify, conditional) — only if Phase 2 changes the customer-facing surface (a banner appears on the run page when entities were edited). Per the editorial rules in docs/capabilities.md, a one-line addition under "Agent Supervision" capturing "Edit attribution on past run pages". If no surface-visible change, leave unchanged.
- `KNOWLEDGE.md` (modify, conditional) — append a lesson IF Chunk 0 surfaced a non-obvious finding worth pinning (e.g. the `agentRunHandoffService.ts`-vs-`pipeline.ts::enqueueHandoff` distinction). The architect's strong recommendation: yes, append this lesson — it is the kind of file-location mis-pointer that costs future builds an architect cycle.

**Module shape:** none.

**Contracts:** none.

**Error handling:** none.

**Test considerations:** none.

**Dependencies:** Chunks 1–8 complete (so the doc edits reflect what actually shipped).

**Acceptance criteria:**
- The architecture.md edit is in the same commit as the chunk completion.
- If `docs/capabilities.md` is updated, the new line is vendor-neutral per editorial rules.
- If `KNOWLEDGE.md` is updated, it follows the existing entry format.

**Verification commands:** `npm run lint` (markdown), manual review.

---

## 6. UX Considerations

**The only UI surface in this build is the `EditedAfterBanner` (Chunk 7).** All other chunks are server-side instrumentation or schema.

For the banner:

- **States to handle:**
  - Loading: render nothing (no skeleton — the banner is opportunistic, not load-bearing).
  - Empty (no edits): render nothing.
  - Populated: render the banner with one line per edit.
  - Error: render nothing; `console.warn` for observability.

- **Permissions gate:** inherits `AGENTS_VIEW` from the parent page's `resolveAgentRunVisibility` chain. The endpoint also gates server-side. No new permission key.

- **Real-time updates:** none. The banner is for past runs only — when the run is terminal, edits are unlikely to occur mid-view, and the spec does not require live updates. Spec §5.3 says "past runs only (no need to flash on live runs)".

- **Copy rules per user preferences:**
  - No emojis.
  - No em-dashes — use commas, colons, or rewrite.
  - Example: `Memory block "Q4 priorities" edited by Alex at 2026-05-16 14:32: content updated`.

---

## 7. Risks & Mitigations

| # | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | **Wave-5 concurrent-session merge conflict.** Sessions K/N may touch `skillExecutor/pipeline.ts` or `server/services/middleware/decisionTimeGuidanceMiddleware.ts` between this branch's chunks and merge. | Medium | Medium | (a) Per spec §7.4 — if M lands first, K/N rebase; if N is mid-migration, N rebases M's emissions into the post-migration query shape. (b) The emission additions are localised single-statement insertions; rebase friction is low even on contended files. (c) Chunk-0 verification log captures the pre-change file state for diff-evidence in PR. |
| R2 | **`agentRunHandoffService.ts`-vs-`pipeline.ts` confusion at review time.** Reviewer may flag "spec said agentRunHandoffService, code touched pipeline.ts." | High | Low | (a) Chunk 0 amends the spec to point at `pipeline.ts`. (b) Architecture note A3 in this plan documents the rationale in plain English. (c) PR description references the verification log. |
| R3 | **Critical-tier emission slows handoff dispatch.** `enqueueHandoff` becomes await-blocked on the new emission; if the events table is hot, handoff latency increases. | Low | Medium | (a) `appendEvent` already has the one-inline-retry-with-50ms-backoff contract — the slow path is bounded. (b) The handoff dispatch is already async (pg-boss enqueue + transaction); adding one DB write inside a separate appendEvent call adds milliseconds, not seconds. (c) If this turns out hot, the mitigation is to demote to `tryEmitAgentEvent` and accept the LAEL §4.1 critical-tier degradation — not a code change in this build. |
| R4 | **Audit-row write inside the edit transaction fails the whole edit.** Chunk 6 deliberately aborts the edit transaction when the audit row's FK violates (e.g. wrong-org `triggeringRunId`). A malicious or buggy client could DoS the edit path by sending bad `triggeringRunId`. | Low | Low | (a) The `triggeringRunId` is UUID-validated and visibility-gated at the route layer before reaching the service; a wrong-org runId fails Zod or fails the visibility check, not the FK. (b) The FK violation is the last-resort safety net — it should be unreachable in practice. (c) The cost of a 500 here is bounded: the user retries without the runId and the edit succeeds. |
| R5 | **`successfulCostCents` aggregate scans the same view twice on hot run-cost paths.** The existing query already aggregates `totalCostCents`; adding the `FILTER` doubles the cost on the same scan. | Low | Low | (a) Postgres `FILTER` clause on a single `SUM` is a sub-microsecond addition — the planner runs both aggregates in one pass. No new scan. (b) Manual EXPLAIN ANALYZE during Chunk 8 if a reviewer asks. |
| R6 | **`memory.retrieved` emission fires from non-agent callers and floods the log with `runId == null` skipped paths.** | Low | Low | The skip is silent (no log, no metric). The dropped emit cost is one branch check. Verified at code-review time. |
| R7 | **Phase-2 scope-reduction (4 entities → 2) is misread by a future reader.** Someone reads §5.2 in 6 months and expects policy-rule + data-source attribution. | Medium | Low | Spec §11 Deferred Items captures the omission with explicit reasoning ("no edit surface today"). Chunk 0 verification log records the search evidence. The next builder who adds a policy-rule or data-source edit surface will see the deferred item and plumb the audit row at that time. |
| R8 | **EditedAfterBanner's `isTerminal` check uses `runMeta.status` which is a string from the server.** A new terminal status added later (e.g. `loop_detected`) needs the banner to recognise it. | Low | Low | The check uses the existing inclusive `isTerminalRunStatus` helper (already exported from `shared/runStatus.ts`). No bespoke string list. |
| R9 | **Migration 0367 number collision with concurrent Wave-5 sessions.** | Medium | Low | (a) Chunk 5 includes a pre-flight rebase check (grep `migrations/036[7-9]*.sql` immediately before committing the migration file). (b) If collision: rename to next free number and update the manifest's `policyMigration` field in the same commit. KNOWLEDGE.md [2026-05-08] pattern entry already covers this case. |

---

## 8. Self-consistency pass

Per spec-authoring-checklist § Section 8 — final read-through focused on contradictions.

| Goal (from spec §12) | Mechanism in this plan | Consistent? |
|---|---|---|
| Close LAEL-P1-1 (`llm.requested`/`llm.completed`) | already merged; chunk-0 confirms | Yes — no chunk needed |
| Close LAEL-P1-2 (memory/rule/skill/handoff emissions) | Chunks 1, 2, 3, 4 | Yes |
| Close LAEL-P2 (edit audit trail) | Chunks 5, 6, 7 — scope reduced from 4 entities to 2 per Chunk-0 finding | Yes — with documented reduction |
| Close Hermes H1 | Chunk 8 | Yes |
| Verify/close Hermes H3 + §6.8 | verified closed by plan author; spec amended in Chunk 0 | Yes — no chunks needed |
| No new permission key | the new `/edits` endpoint reuses AGENTS_VIEW via `resolveAgentRunVisibility` | Yes |
| No feature flag | rollout is `git revert` per chunk | Yes |
| RLS coverage | new table goes into the manifest in Chunk 5 (same commit as the migration) | Yes |
| Concurrent-session deconfliction (Wave 5 K/L/N) | R1 + R2 in the risk register; chunk-0 captures the pre-change file state | Yes |

**Source-of-truth audit** (per spec-authoring-checklist § Section 3 / Section 8):

- The single source of truth for the `agent_execution_log_edits` schema is `migrations/0367_agent_execution_log_edits.sql`. Drizzle schema mirrors it. The shared type mirrors the API projection only (not the raw column set — snapshots are excluded).
- The single source of truth for "what events exist" is `shared/types/agentExecutionLog.ts` + `agentExecutionEventServicePure.ts`. This build adds zero new event types; only emission sites for already-defined types.
- The single source of truth for "is a run terminal" is `shared/runStatus.ts::isTerminalRunStatus`. Banner Chunk 7 uses it.

**Goal-vs-implementation check:**

- Goal: "additive emissions, no behavioural change to existing code paths." Implementation: every emission in Chunks 1–4 is a single function call at a return boundary; no signature changes, no return-value changes. ✓
- Goal: "Phase 2 audit trail is opt-in via `triggeringRunId`." Implementation: when `triggeringRunId` is absent the existing edit path runs unchanged; when present, the audit row writes inside the same tx. ✓
- Goal: "H1 is additive on the response." Implementation: new field, zero default, no consumer change required. ✓

**Inventory counts** — reconciled against the plan body (per spec-authoring-checklist § Section 8 numeric-count pass):

- **10 chunks** (Chunks 0–9). ✓ Matches the dependency-ordering diagram.
- **1 new migration** (0367). ✓
- **1 new table** (`agent_execution_log_edits`). ✓
- **1 new shared type file** (`shared/types/agentExecutionLogEdits.ts`). ✓
- **1 new React component** (`EditedAfterBanner.tsx`). ✓
- **1 new endpoint** (`GET /api/agent-runs/:runId/edits`). ✓
- **2 entities under Phase 2 audit** (memory_block, memory_summary). ✓
- **3 new Vitest test files** (Chunk 4 emission, Chunk 6 route-mapper pure, Chunk 6 buildEditSummary pure). Chunk 8 modifies an existing test file rather than creating a new one. ✓
- **5 emission sites** added (`memory.retrieved` × 2, `rule.evaluated` × 1, `skill.invoked` + `skill.completed` × 1 wrapper, `handoff.decided` × 1). ✓ — counted as 5 sites; 2 of them (`memory.retrieved`) live in different files but emit the same event type.

No mismatched counts.

---

## 9. Appendix — Chunk-to-spec section traceability

| Chunk | Spec sections | Files touched (counts) |
|---|---|---|
| 0 | §3.1 §3.2 §6.2 §6.3 §8 §10 §11 | 2 (spec.md, verification-log.md) |
| 1 | §4.1 §7.1 §7.2 §9 | 2 |
| 2 | §4.2 §7.1 | 1 |
| 3 | §4.3 §7.1 | 1 |
| 4 | §4.4 §7.2 | 2 (pipeline.ts + new test file) |
| 5 | §5.1 §7.1 §8 | 6 (migration + .down + schema + index + manifest + shared type) |
| 6 | §5.2 §5.3 §7.1 | 7 (memoryBlocks route, memoryBlockService, workspaceMemory route, workspaceMemoryService, agentExecutionLog route, 2 new test files) |
| 7 | §5.3 §6.5 (LAEL) | 2 (new component + AgentRunLivePage) |
| 8 | §6.1 | 5 (runCost type + llmUsage route + RunCostPanelPure + RunCostPanel + test file) |
| 9 | §8 doc-sync rows | up to 3 (architecture.md mandatory; capabilities.md + KNOWLEDGE.md conditional) |

Total production files modified or created across Chunks 1–8: **~28 files**, well within the ABCd "Build = S" sizing in spec §2.1.

---

*End of plan — Wave 5 Session M LAEL Phase 1 + 2 + Hermes Tier 1.*
