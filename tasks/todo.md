# tasks/todo.md — Curated Open Backlog

**Last refreshed:** 2026-05-13 (branch `claude/cleanup-todo-knowledge-5ALbK`)

Historical detail for every deferred review-log item lives in `tasks/todo-archive-2026-Q2.md` (verbatim copy of the pre-cleanup file). The source of truth for any single item is its underlying review log under `tasks/review-logs/`.

This file is the **curated** open backlog: cross-cutting items, genuinely-still-open feature gaps, and security/correctness items from recent builds that have not been closed. Anything not listed here is either closed (see git history / archive) or build-specific debt captured in `tasks/builds/<slug>/handoff.md`.

---

## How to use this file

- New items append at the bottom under a dated heading.
- Close items by removing them. Git history is the audit trail; do not leave `[x]` checkboxes lying around.
- When a build merges, its build-specific deferred items move to `tasks/builds/<slug>/handoff.md`. Only cross-cutting items survive into this file.
- If you need the full context for an item referenced here, grep the archive or open its review log directly.

---

## Feature-level open work

### Live Agent Execution Log (LAEL)

Spec: `tasks/live-agent-execution-log-spec.md`. Phase 1 merged on `claude/build-agent-execution-spec-6p1nC`. The following items were explicitly deferred per spec §11.4.

- [ ] **LAEL-P1-1** — Finish `llmRouter` `llm.requested` / `llm.completed` emission + `agent_run_llm_payloads` writer integration. Files: `server/services/llmRouter.ts` (TODO near `llmInflightRegistry.add()`), `server/services/agentRunPayloadWriter.ts`, `server/services/agentExecutionEventEmitter.ts`. Spec refs §4.5, §5.3, §5.7. Without this, the Live Log shows no "doing" phase between `prompt.assembled` and `run.completed`. Full deferred-item context in archive.
- [ ] **LAEL-P1-2** — Remaining P1 emission sites: `memory.retrieved` (workspaceMemoryService, memoryBlockService), `rule.evaluated` (decisionTimeGuidanceMiddleware), `skill.invoked` / `skill.completed` (skillExecutor), `handoff.decided` (agentExecutionService). All non-critical except `handoff.decided`. Spec §5.3 + §6.2.
- [ ] **LAEL-P2** — Edit audit trail (Phase 2). Migration `0194_agent_execution_log_edits.sql`, `agent_execution_log_edits` table, optional `triggeringRunId` query param on memory/rule/skill/data-source edit surfaces, `EditedAfterBanner` component on `AgentRunLivePage`. Spec §8.
- [ ] **LAEL-P3 / P3.1** — Retention tiering + cold archive restore (Phase 3). Spec §9 / §9.1.
- [ ] **LAEL-FUTURE-{1..6}** — Admin-visible drop/gap metrics; trigger-based FK enforcement on `agent_run_llm_payloads.run_id`; `run.created` boundary event; causal grouping for parallel writers; deeper `prompt.assembled` layer attributions; per-run payload-persistence kill-switch. Each item is non-blocking; see archive for full context.

### Hermes Tier 1 — execution-cost deferred follow-ups

Branch `claude/hermes-audit-tier-1-qzqlD` merged 2026-04-21.

- [ ] **H1** — Add `successfulCostCents` to `/api/runs/:runId/cost` response. Removes the cost-per-call divide-by-zero / failed-call bias trap. Touches `shared/types/runCost.ts`, `server/routes/llmUsage.ts`, `client/src/components/run-cost/RunCostPanel.tsx`.
- [ ] **H2** — Rollup-vs-ledger breaker asymmetry (Slack / Whisper). LLM path now uses direct-ledger breaker; Slack / Whisper still rely on `cost_aggregates` async rollup. Becomes a real consistency risk only if those paths become hot.
- [ ] **H3** — `runResultStatus='partial'` coupling to summary presence. Decide whether `!hasSummary` is a downgrade signal or an orthogonal field. Monitor production `partial` rates first.
- [ ] **§6.8 errorMessage gap** — `agentExecutionService.ts:1350-1368`. When `finalStatus === 'failed'` via the normal terminal path, `errorMessage: null` is passed to `extractRunInsights`. Thread `preFinalizeMetadata.errorMessage` into the call. Pre-existing limitation per spec §11.4.

### Sandbox isolation (PR #287)

- [ ] **SANDBOX-F1** — Real e2b publish/inspect wiring. Currently `templateDigest` falls back to placeholder `local-dev-*` value; publish workflow hard-fails until real e2b integration lands. Tracked by gate `verify-sandbox-template-version`.
- [ ] **SANDBOX-ADV-2.1** (likely-hole) — `templateVersion` from env var unvalidated at `server/services/executionBackends/ieeDevBackend.ts:131`. Audit rows can carry forged version strings. Fix: read pinned digest from `E2bSandbox.templateDigest`.
- [ ] **SANDBOX-ADV-3.1** (likely-hole) — Telemetry sequence allocator race silently drops events at `sandboxExecutionService.ts:63-73` + `sandboxHarvestService.ts:81-91`. `criticality='error'` events may be lost. Fix: `INSERT ... ON CONFLICT DO UPDATE SET sequence = ... RETURNING sequence` with retry, or advisory lock.
- [ ] **SANDBOX-ADV-6.1** (likely-hole) — Reconciliation hardcodes `credentialAliases: []` at `sandboxHarvestReconciliationJob.ts:183-187`. Latent until C13. Fix: add `credential_aliases` JSONB column to `sandbox_executions`.
- [ ] **SANDBOX-ADV-1.2 / 2.2 / 3.2 / 4.2 / 5.2** — Worth-confirming items: missing subaccount FKs on 5 new sandbox tables; inline-sandbox env-injection bypass via forged env object; race between provider success and ceiling-monitor `markForHarvest`; S3 path-traversal via filename; no per-tenant log-storage quota. Low priority; see archive for full context.
- [ ] **SANDBOX-R3-T1** (advisory) — Reconciliation eligibility uses Node `new Date()`; migrate to DB `SELECT NOW()` for consistency with ceiling monitor. `server/jobs/sandboxHarvestReconciliationJob.ts:72`. Single-file ~10-line change.

### Personal Assistant V1 (PR #291, merged 2026-05-12)

Spec-conformance review found schema/contract divergences. None block ship; all are "amend code OR amend spec" decisions.

- [ ] **REQ-C4** — `voice_profiles` schema diverges from spec §7.4 (missing `name`, `sources[]`, `source_config`, `refresh_config`; renames). Decide: migrate schema to spec, or amend spec to simpler shape.
- [ ] **REQ-CAL2** — Calendar `create_event` / `update_event` risk tier mismatch (code: Tier 6, spec: Tier 4). Confirm rubric.
- [ ] **REQ-T8** — Dedup key formats diverge from spec §7.1 (Slack + Calendar). Both work as unique keys; align one direction.
- [ ] **REQ-C1** — `ExternalSourceTriggerEvent` schema simplified from spec §7.1 (flat shape, no envelope). Confirm downstream consumer needs.
- [ ] **REQ-EA1** — EA default skill allowlist incomplete vs spec §13.2 (13 skills missing). Verify whether universal-skills covers them.
- [ ] **REQ-EA3** — Partial unique index axis differs (code: `(org, owner)`, spec: `(subaccount, owner)`). Multi-subaccount product intent decides.
- [ ] **REQ-EA4** — EA home_widget refreshPolicy is `every_5m`; spec says `on_login`. Reduce API load.
- [ ] **REQ-EA5** — EA home_widget `titleTemplate` hardcoded "Personal Assistant"; spec says `${agent.displayName}`. Required for §13.6 rename feature.
- [ ] **REQ-M15** — Personal nav group placement (top vs mid-list).
- [ ] **REQ-C3** — `slack.list_channels` Zod schema missing `types` filter.
- [ ] **REQ-CAL3-naming** — Calendar write-action error codes diverge (`missing_draft_context` vs `DRAFT_NOT_*`). Add owner-mismatch assertion either way.
- [ ] **REQ-M9** — Stall job 7-day proposal expiry path for EA-linked drafts.

### Personal Assistant V1 — adversarial findings

- [ ] **createDraftWithProposal non-atomic** (likely-hole) — `server/services/eaDrafts/eaDraftService.ts:58-88`. Refactor `actionService.proposeAction` to accept an optional `tx` parameter, or extract a shared helper.
- [ ] **dispatch() missing organisationId filter** (worth-confirming) — `server/services/triggers/externalSourceTriggers.ts:38-52`. Add `eq(integrationConnections.organisationId, ctx.organisationId)`.
- [ ] **dispatch() rate-cap count not scoped by organisationId** (worth-confirming) — same file, lines 87-97.
- [ ] **assembleThreadSummaryPrompt prompt-injection surface** (worth-confirming) — `server/services/slack/slackActionService.ts:267`. Sandbox / XML-escape Slack content before LLM passthrough when summarisation ships.

---

## Cross-cutting / infrastructure

### Auth & Security (pre-prod-boundary-and-brief-api)

- [ ] **In-memory rate limiting lost on restart; bypassed in multi-process** — `server/routes/auth.ts:14-30`. Originally captured in 2026-04-01 audit (#21). Pending Phase 2 of pre-prod-boundary-and-brief-api.
- [ ] **Multer memory storage accepts 500MB — OOM DoS risk** — `server/middleware/validate.ts:17-20`. Pending Phase 1 of pre-prod-boundary-and-brief-api.

### Test infrastructure

- [ ] **TI-001** — Make `build-code-graph-watcher.test.ts` parallel-safe.
- [ ] **TI-006** — Canonical subaccount UUID for integration fixtures.
- [ ] **TI-007** — Integration test conventions doc — real-DB vs mocked-DB rule.
- [ ] **TI-008** — Configure CI with a non-superuser app role for RLS coverage.

### CI gate hardening (Phase 4 pre-launch)

- [ ] **CHATGPT-R3-1** — Extend CI grep invariants to cover the remaining four pre-launch B.4 categories.
- [ ] **CHATGPT-R3-2** — Canonical error taxonomy: enumerate every `error.code` string in production and lock to a typed union.
- [ ] **CHATGPT-R3-6** — Audit event namespace consistency: extend `verify-audit-namespace.sh` to detect dynamic construction.
- [ ] **CHATGPT-R1-7** — OAuth state JWT window: tightened from 10min to 5min in pre-launch-phase-2. Revert pending telemetry — confirm 5min causes no real auth failures over 30 days, then close.

### Documentation / process

- [ ] **OAuth state security audit trail** — `auth.login.failure` / `auth.login.success` / OAuth state events / abuse events now live in `security_audit_events` (migration 0281). Architecture.md §Layer 4 documents the stream split. Operator action: confirm dashboards in Grafana / Mission Control surface the new stream before deprecating the legacy `audit_events` records.

---

## Known un-built / low-priority

These are noted to prevent re-discovery — none are urgent.

- Route files exceeding ~200 lines: `subaccounts.ts` (758L), `permissionSets.ts` (587L), `llmUsage.ts` (524L), `portal.ts` (502L). Split when domain-touching work lands.
- Auth tokens stored in localStorage (XSS risk — migrate to httpOnly cookies later).
- Silent promise rejections in `workspaceMemoryService.ts`.
- Missing cascade delete rules on parent-child task/agent relationships.
- Deprecated columns in agents schema (`sourceTemplateId`, `sourceTemplateVersion`).
- No refresh token rotation on OAuth integrations.

---

## Deferred spec decisions — personal-assistant-v2-operator

From `spec-reviewer` iteration 1 against `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md` (2026-05-13). Routed here per AUTO-DECIDED criteria (Step 7 priority 3 — most conservative option is to surface to operator).

- [ ] **PA-V2-OP-S1 (BLOCKS CHUNK 7)** — Choose the file-events backing-store schema strategy for the §5.7 file-event contract. The contract assumes a table with columns `(agent_run_id, path, version, content_sha256, storage_key, mime_type, size_bytes, emitted_by, emitted_at)` and a UNIQUE `(agent_run_id, path)` constraint. The existing `execution_files` table (`server/db/schema/executionFiles.ts`) is keyed on `executionId → executions.id`, has `file_name` / `file_type` / `storage_path` / `expires_at`, and lacks every column the contract assumes. Two candidates:
   - **(a) New table `operator_run_files`** keyed on `agent_run_id → agent_runs.id`. Cleanest semantically; adds one tenant-scoped table; gets a new RLS entry.
   - **(b) Extend `execution_files`** with the new columns + parallel `agent_run_id` FK + the UNIQUE constraint. Honours "prefer existing primitives" IF the architect determines this is the right abstraction level.
   
   The spec encodes this as §13 open question #1 and as a placeholder migration row (`migrations/0346_*`) in §4.1. The decision is required BEFORE Chunk 7 (live-file events: tool-call interceptor) can ship — Chunks 1–6 and 8–9 can proceed regardless. Architect input needed; this is not a mechanical fix. Spec-reviewer cannot pick the strategy autonomously because it changes the §6 RLS claim and the §4.1 migration shape.

- [ ] **PA-V2-OP-S2 (BLOCKS CHUNK 3)** — Choose the `delegation_outcomes` state-machine schema strategy. The §5.4 state machine and §9.4 terminal-event uniqueness guard assume a `status` column and `terminal_at` timestamp on `delegation_outcomes`. The current schema (`server/db/schema/delegationOutcomes.ts`) has only `outcome ('accepted'|'rejected')`, `delegationScope`, `delegationDirection`, and `createdAt`. Two candidates:
   - **(a) Extend `delegation_outcomes`** in migration 0345 — add `substep_status TEXT` + `terminal_at TIMESTAMPTZ NULL` + index. Conservative default; matches existing ledger concept.
   - **(b) New table `cross_owner_substep_state`** — separate state-machine table; refactor of the existing ledger.
   
   Spec-reviewer (iteration 3) recommends strategy (a). Operator/architect input needed; spec encodes both options in §13 open question #2.

- [ ] **PA-V2-OP-INFO-1** — The orchestrator routing module path was previously TBD in §4.3. Spec-reviewer resolved it to `server/tools/capabilities/capabilityDiscoveryHandlers.ts` (entry point: `executeCheckCapabilityGap`, dispatched by `server/services/skillExecutor.ts:1767-1770`). Informational only; recorded here so the next implementer/audit can confirm the path before Chunk 2 begins.

- [ ] **PA-V2-OP-INFO-2** — During spec authoring §13 listed an open authoring question: whether `runTraceProjectionForViewer` deserves a dedicated `*Pure.ts` split. Defers to the implementer's judgement on test surface during Chunk 3. No action needed pre-implementation.

---

## Blockers

_None active._

When you hit a stuck-detection condition (per CLAUDE.md §1), append a Blocker subsection here with: what was attempted, exact failure, root-cause hypothesis, what you'd try next.

---

## Pointers

- **Archive of historical deferred items:** `tasks/todo-archive-2026-Q2.md`
- **Per-build deferred items for unmerged work:** `tasks/builds/<slug>/handoff.md`
- **Source-of-truth review logs:** `tasks/review-logs/`
- **Lessons + corrections:** `KNOWLEDGE.md` + `tasks/lessons.md`
- **Ideas captured mid-session:** `tasks/ideas.md`
