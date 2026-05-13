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

All originally-tracked deferred items closed by the 2026-05-13 deferred-sweep PR (branch `claude/close-deferred-pa-v1-13lHR`). Adversarial fixes (atomicity, cross-org filter, rate-cap scope, prompt-injection escape) shipped as code changes; spec-conformance gaps split between code amendments (CAL2, EA1, EA4, EA5, C3, CAL3-naming owner-mismatch, M9) and spec amendments (C4, T8, C1, EA3, M15-code-aligned, CAL3-naming error-code family). See:
- Code: `server/services/{eaDrafts,triggers,slack,calendar,homeWidget}/`, `server/services/actionService.ts`, `server/jobs/workflowGateStallNotifyJob.ts`, `server/config/actionRegistry/{calendar,slack}.ts`, `client/src/config/sidebar.ts`.
- Migration: `migrations/0343_ea_home_widget_spec_align.sql` — data-only seed update for EA template's `home_widget` + `default_org_skill_slugs`.
- Spec: `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md` — amendments dated 2026-05-13 in the header + inline in §§7.1, 7.4, 8.4, 13.4, 14.1.

#### Follow-up surfaced during the 2026-05-13 sweep

_(EA-V1-FOLLOWUP-1 resolved 2026-05-13 — ChatGPT PR #296 round 2 review (REVIEW-F2) made the substantive scope-reassessment that multiple drafts of the same kind per run is a real product flow. Idempotency key now carries a stable per-call discriminator (`targetRef` or hashed `{ kind, body }`); migration 0344 adds `UNIQUE(proposal_action_id)` on `ea_drafts` as defence-in-depth. Spec §7.5 + eighth-pass amendment block. See `tasks/review-logs/chatgpt-pr-review-claude-close-deferred-pa-v1-13lHR-2026-05-13T06-43-44Z.md` Round 2.)_

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

## Deferred from spec-conformance review — memory-improvements (2026-05-13)

**Captured:** 2026-05-13T05:41:00Z
**Source log:** `tasks/review-logs/spec-conformance-log-memory-improvements-2026-05-13T05-41-00Z.md`
**Spec:** `docs/superpowers/specs/2026-05-13-memory-improvements-spec.md`

- [ ] REQ #20 — `MemoryBlockSourcesPayload` shape diverges from spec §6.1 nested form
  - Spec section: §6.1
  - Gap: shipped payload is `{ blockId, blockSource, versionNumber, sources, reverseLineageByEntry? }` with flattened per-row fields; spec §6.1 names `{ blockId, blockVersionId, versionNumber, capturedAt, sources, reverseLineageByEntry? }` with nested `sourceEntry: { id, content, isDeleted } | null` / `sourceRun: { id, label, isDeleted } | null` per row plus separate `sourceRunLabelAtCapture` fallback.
  - Suggested approach: decide whether to reshape the response to match the spec's nested discriminated-union form (and update `MemoryBlockSourcesTab.tsx`) or to revise §6.1 to match the flattened form actually shipped. The flattened form is a reasonable simplification; the nested form is the published contract.

- [ ] REQ #38 — Missing `memoryUtilityAggregatorPure.ts` + test file named in spec §5.1 + §12.1
  - Spec section: §5.1, §12.1
  - Gap: spec file inventory and testing-posture both name `server/services/memoryUtilityAggregatorPure.ts` and `server/services/__tests__/memoryUtilityAggregatorPure.test.ts`. Neither was created; the aggregator logic was collapsed into the SQL CTE in migration 0345.
  - Suggested approach: either ship the JS aggregator + pure tests (mirroring `memoryUtilityDailySeriesPure.ts`) or update spec §5.1 + §12.1 to record the SQL-CTE-only approach as the chosen path. SQL aggregation in the MV is consistent with the testing posture (static gates primary), so spec-amend is the lighter-weight path.

- [ ] REQ #41 — `MemoryUtilityPayload` shape missing spec-named top-level fields
  - Spec section: §6.6
  - Gap: shipped response is `{ agents, dailySeries }`; spec §6.6 names three additional top-level fields — `organisationId`, `generatedAt` (ISO timestamp), `windowDays: 30`. The `agents[]` interface also omits `totalInjectedEntries`, `totalCitedEntries`, `totalInjectedBlocks`, `totalCitedBlocks` (present in DB rows but not declared on `AgentUtilityRow` — UI does not consume them).
  - Suggested approach: add the three top-level fields (route handler attaches `generatedAt: new Date().toISOString()`, hardcoded `windowDays: 30`, and the path-org as `organisationId`). Declare the four totals on `AgentUtilityRow` for type fidelity even if the UI does not display them.

- [ ] REQ #64 — Two new degraded reasons not surfaced via `RetrievalResult.degradedReason`
  - Spec section: §6.5
  - Gap: `RetrievalDegradedReason` union extended with both values (REQ #62 PASS) but emission sites in `retrievalService.ts` use `logger.warn(...)` only — they never set `RetrievalResult.degradedReason = 'retrieval.embedding_failed'` or `'retrieval.empty_after_semantic'` on the returned result. Spec §6.5 names `retrievalObservabilityService` as the consumer; run-trace UI reads `RetrievalResult.degradedReason`. As wired today, these events do not surface to the run trace.
  - Suggested approach: thread the degraded reason through to the returned `RetrievalResult` (e.g. mark `degraded: true` + set `degradedReason` on the legacy-fallback rank result) so the observability surface sees the event. Design choice: do we degrade the result wholesale on embedding failure, or only annotate it? The plan's intent is the annotation form.

- [ ] REQ #67 — `docs/capabilities.md` operator-facing utility-metric capability not added
  - Spec section: §5.3
  - Gap: `docs/capabilities.md` is in the changed-code set per `git status` but contains no entry for the memory-utility / lineage / AKR semantic-ranker capability. Spec §5.3 conditions the update on "if it's currently catalogued"; plan §10 Assumptions defers provisionally.
  - Suggested approach: draft a vendor-neutral, model-agnostic capability entry under Observability per the editorial rules in `docs/capabilities.md § Editorial Rules`, or confirm with the operator that no customer-facing capability is needed and remove the modified-file flag.

- [ ] REQ #68 — Opportunistic cleanup (env-overridable memory-block pool constants) not shipped
  - Spec section: §4 Opportunistic cleanup, §5.2
  - Gap: `MEMORY_BLOCK_TOP_K = 5` and the `* 3` multiplier in `server/services/memoryBlockService.ts:177` were not promoted to env-overridable constants in `server/config/limits.ts` (`MEMORY_BLOCK_POOL_MULTIPLIER`, default 3; `MEMORY_BLOCK_TOP_K`).
  - Suggested approach: explicitly opted out by the spec ("Not required for the spec to land"). Either ship as a standalone follow-up PR or close out as won't-do. No blocker.

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
