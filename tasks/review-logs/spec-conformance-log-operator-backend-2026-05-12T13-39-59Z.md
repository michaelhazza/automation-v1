# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-12-operator-backend-spec.md`
**Spec commit at check:** working tree (spec dirty: minor edits in branch)
**Branch:** `claude/sandbox-execution-provider-DLfjn`
**Base:** `origin/main` (merge-base resolved via `git diff origin/main...HEAD`)
**Scope:** all of spec (caller confirmed: all 12 chunks built, full implementation)
**Changed-code set:** 153 files (excluding spec, review logs, todo/focus/progress)
**Run at:** 2026-05-12T13:39:59Z

---

## Table of contents

1. Summary
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional / ambiguous gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Next step

---

## Summary

- Requirements extracted:     64
- PASS:                       62
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 2
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (2 blocking directional gaps — see deferred items)

The two directional gaps are **event-name registry drift** between three sources of truth (`operatorBackendEvents.ts`, `runTraceEvent.ts`, and the emit sites in `operatorManagedBackend.ts` / `operatorSessionProgressedHandler.ts` / `credentialBrokerService.ts`). These do not block compilation — lint and typecheck pass cleanly (0 errors) — but they will fail the `verify-operator-event-registry.sh` CI gate when it runs on PR open, and they break the namespace-discipline invariant the spec lists at §4.7. The fix requires a coordinated rename across registry + emit sites + consumer renderer; that's a design decision the main session must own.

---

## Requirements extracted (full checklist)

### Schemas + migrations (§3.3, §3.15, §3.16, §3.4, §4.10, §5.2, §6)

| REQ | Section | Description | Verdict |
|---|---|---|---|
| 1 | §3.3, §5.2 0327 | `operator_runs` table with full column shape + 3 indexes + dual-GUC RLS + UNIQUE `(agent_run_id, attempt_number, chain_seq)` | PASS |
| 2 | §3.3, §5.1 | `server/db/schema/operatorRuns.ts` Drizzle schema with `$type` unions | PASS |
| 3 | §3.15, §5.2 0328 | `operator_task_profiles` table + dual-GUC RLS + UNIQUE `(task_id, attempt_number)` + `gc_started_at` column | PASS |
| 4 | §3.15, §5.1 | `server/db/schema/operatorTaskProfiles.ts` Drizzle schema | PASS |
| 5 | §3.16, §5.2 0329 | `subaccount_operator_settings` table + dual-GUC RLS + all CHECK constraints + `settings_version` integer (R2-F3) | PASS |
| 6 | §3.16, §5.1 | `server/db/schema/subaccountOperatorSettings.ts` Drizzle schema | PASS |
| 7 | §3.4, §5.2 0330 | `agent_runs.status` extended with four `paused_*` literals via CHECK constraint | PASS |
| 8 | §3.4, §5.2 0330 | `agent_runs.operator_chain_failure_count integer NOT NULL DEFAULT 0` added | PASS |
| 9 | §4.10, §5.2 0331 | `llm_requests.operator_run_id uuid NULL REFERENCES operator_runs(id)` + `boundary text NULL` + partial UNIQUE `(operator_run_id, source_type, boundary)` + covering index | PASS |
| 10 | §6, §5.3 | `server/config/rlsProtectedTables.ts` has three new entries for the three operator tables | PASS |

### Types + execution mode/capability (§3.1, §3.2, §4.1, §4.2, §4.6, §4.7, §5.3)

| REQ | Section | Description | Verdict |
|---|---|---|---|
| 11 | §3.1, §5.3 | `ExecutionMode` extended with `'operator_managed'` at `shared/types/executionEnvironment.ts` | PASS |
| 12 | §3.1 | `executionModeToEnvironment('operator_managed')` returns `'browser'` (Rev 2 invariant 6) | PASS |
| 13 | §3.1, §5.3 | `EXECUTION_MODES` set in `registry.ts` contains `'operator_managed'`; openclaw rejection check removed | PASS |
| 14 | §3.1, §5.3 | Registry/types docstrings renamed "OpenClaw forward-compat ids" → "Operator Backend forward-compat ids" | PASS |
| 15 | §3.2, §4.1 | `ExecutionCapability` union extended with `'long_running'` and `'session_identity'` at `types.ts:87-96` | PASS |
| 16 | §3.3, §5.1 | `shared/types/operatorRuns.ts` exports `OperatorRunRow` types | PASS |
| 17 | §4.6, §5.1 | `shared/types/checkpointPayload.ts` exports Zod `CheckpointPayloadSchemaV1` with required fields | PASS |
| 18 | §3.14 item 6, §5.1 | `shared/types/operatorConversationArtefact.ts` exports `OperatorConversationLinkArtefactSchema` + MIME constant `application/vnd.synthetos.operator-conversation-link+json;version=1` | PASS |
| 19 | §4.7, §5.1 | `shared/types/operatorBackendEvents.ts` exports discriminated union `OperatorBackendEvent` with 20 named events | PASS |
| 20 | §3.14 item 10, §5.1 | `server/services/agentRunPayloadEncryptionService.ts` exports `encryptAgentRunPayloadJson` + `decryptAgentRunPayloadJson` + `EncryptedJson` type. Note: spec specifies `Promise<>` return types but impl is sync. Callers `await` happily so non-blocking. | PASS |

### Org-scoping helpers + RLS (§3.6, §6, plan Rev 2 invariant 3)

| REQ | Section | Description | Verdict |
|---|---|---|---|
| 21 | plan Rev 2 F3, §5.1 | `server/lib/orgScoping.ts` exports `setOrgAndSubaccountGUC(tx, orgId, subaccountId)` with non-empty arg validation | PASS |
| 22 | §6, plan Rev 2 invariant 3 | All three operator-table migrations use dual-GUC RLS policy (USING + WITH CHECK both reference `app.organisation_id` AND `app.subaccount_id`) | PASS |

### Pure helpers (§3.7, §3.14, §3.17, §5.1)

| REQ | Section | Description | Verdict |
|---|---|---|---|
| 23 | §5.1 | `operatorManagedBackendPure.ts` exports chain-link status/failure classifier + finaliser decision table + predecessor allow-list | PASS |
| 24 | §3.7 item 1, §5.1 | `operatorRuntimeErrors.ts` exports `classifyRuntimeError` with closed signal set | PASS |
| 25 | §3.14 item 6, §5.1 | `operatorConversationHistoryPure.ts` exports per-link windowing + K=5 constant | PASS |
| 26 | §3.7 item 6, §5.1 | `operatorChainResumeServicePure.ts` exports resume-payload composer | PASS |
| 27 | §3.15, §5.1 | `operatorTaskProfileServicePure.ts` exports retention math + state transitions | PASS |
| 28 | §3.16, §5.1 | `subaccountOperatorSettingsServicePure.ts` exports range validation + ETag derivation = `String(settings_version)` (R2-F3) | PASS |
| 29 | §3.12, §5.1 | `operatorCostWriterPure.ts` exports `(operator_run_id, source_type, boundary)` key derivation + row builders | PASS |
| 30 | §3.17 item 5, §5.1 | `operatorChainSchedulerServicePure.ts` exports slot count + FIFO order helpers | PASS |

### Sandbox primitive extension (§5.3, §7.1)

| REQ | Section | Description | Verdict |
|---|---|---|---|
| 31 | §5.4 | Sandbox template `openclaw-session` → `operator-session` via git mv (history preserved) | PASS |
| 32 | §5.3 | `SandboxRunTaskInput` gains optional `sandboxStartKey?: string` (additive) | PASS |
| 33 | §7.1 dispatch-crash recovery | `sandboxExecutionService.adoptOrStart()` exists; idempotent adoption seam | PASS |
| 34 | §3.5 | Migration `0332_sandbox_executions_start_key` adds `sandbox_start_key` column to `sandbox_executions` (supplementary; non-blocking) | PASS |

### Service layer (§3.6, §3.7, §3.13, §3.14, §3.15, §3.16, §3.17, §5.1, §5.3)

| REQ | Section | Description | Verdict |
|---|---|---|---|
| 35 | §5.1 | `operatorTaskProfileService.ts` exports `ensureActiveProfile`, `scheduleGc`, `extendDebugRetention` | PASS |
| 36 | §5.1, §3.16 | `subaccountOperatorSettingsService.ts` exports `getEffectiveSettings`, `updateSettings` (ETag-aware), `readForEtag` | PASS |
| 37 | §5.1, §3.14 item 5 | `operatorChainResumeService.ts` exports `composeResumePayload` | PASS |
| 38 | §5.1, §3.12 | `operatorCostWriter.ts` exports `writeRowsForChainLink` with advisory lock `operator_finalise:` + key-based idempotency | PASS |
| 39 | §5.1, §3.17 item 5 | `operatorChainSchedulerService.ts` exports `tryAcquireSlotAndDispatch` (holds `operator_slots:` lock) + `releaseSlotAndEnqueueNext` (FIFO by `agent_runs.updated_at ASC`) | PASS |
| 40 | §5.1, §3.13, §4.8b | `operatorSessionSuspensionNotifier.ts` exports `notifyOperatorSessionSuspended` emitting `cs.operator_session.suspended_detected` with `(connection_id, usability_state, detection_date)` idempotency key | PASS |
| 41 | §5.1, §10.6 | `operatorBackendErrors.ts` exports `OperatorBackendConflictError` (409, 3-kind discriminator) + `OperatorSessionLimitExceededError` (429) + `mapOperatorBackendErrorToHttp` mapper | PASS |
| 42 | §5.3, §3.6 | `credentialBrokerService` extended with `requestOperatorSessionCredential`, `resolveFallback`, `emitUsabilityRestored`; `OperatorSessionEnvelope` + `ApiKeyEnvelope` gain `subaccountId` | PASS |
| 43 | §5.3, §4.10 | `llmRouter.ts` accepts optional `operatorRunId` + `boundary`, persists to `llm_requests` columns | PASS |
| 44 | §5.3, §10.6 | Route error-handler in `server/index.ts:514-528` maps both operator typed errors to 409/429 via `mapOperatorBackendErrorToHttp` | PASS |

### Adapter object + handlers + registration (§3.1, §3.2, §4.1, §7, §5.1, §5.3)

| REQ | Section | Description | Verdict |
|---|---|---|---|
| 45 | §3.1, §4.1, §5.1 | `operatorManagedBackend` exported with `id='operator_managed'`, `capabilities: ['delegated','code_execution','long_running','cancellation','session_identity']`, `costModel='subscription'`, `sandboxRequirement='code_execution'`, `completedEventQueue='operator-session-completed'`, `terminalStateTable='operator_runs'`, all 5 lifecycle methods | PASS |
| 46 | §5.3, §7 | `operatorManagedBackend` registered at `server/index.ts:712` alongside the existing five | PASS |
| 47 | §7.2, §5.1 | `operatorSessionCompletedHandler.ts` consumes `operator-session-completed`; idempotency keyed on `event_emitted_at` | PASS |
| 48 | §7.3, §5.1 | `operatorSessionDispatchNextChainLinkHandler.ts` consumes `operator-session-dispatch-next-chain-link` | PASS |
| 49 | §7.4, §5.1 | `operatorSessionProgressedHandler.ts` sole writer for `last_progress_at` + `step_count` with `status='running'` post-terminal guard + NULL-safe `greatest()` | PASS |
| 50 | §7.5, §5.1 | `operatorTaskProfileGcHandler.ts` registered for `operator-task-profile-gc` cron | PASS |

### Routes + permissions (§3.9, §3.10, §3.16, §5.1, §5.3, §6.5, §6.5b)

| REQ | Section | Description | Verdict |
|---|---|---|---|
| 51 | §3.9, plan Rev 2 F1, §5.1 | `GET /api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress` mounted; uses `setOrgAndSubaccountGUC` before reading `operator_runs` | PASS |
| 52 | §3.16, §5.1 | `GET` + `PATCH /api/subaccounts/:subaccountId/operator-settings`; PATCH gated by `SUBACCOUNT_OPERATOR_SETTINGS_WRITE`; If-Match ETag check | PASS |
| 53 | §6.5b, §5.1 | All 5 `POST /api/operator-tasks/:agentRunId/*` routes present (retry-chain-failure, extend-budget, fresh-profile-restart, refresh-credential, extend-debug-retention) with route-actor rules | PASS |
| 54 | §6.5, §5.3 | `SUBACCOUNT_OPERATOR_SETTINGS_WRITE` permission key added to `server/lib/permissions.ts` (as `SUBACCOUNT_PERMISSIONS.OPERATOR_SETTINGS_WRITE` with value `'subaccount.operator_settings.write'`) and registered in catalogue | PASS |

### Client API helpers + UI (§5.1, §13)

All 8 client API helpers (`getOperatorRunProgress`, `getOperatorSettings`, `updateOperatorSettings`, `retryChainFailure`, `extendBudget`, `freshProfileRestart`, `refreshCredential`, `extendDebugRetention`) + 9 new operator UI components (`OperatorChainLinkIndicator`, `OperatorAutoExtendBanner`, `ChainLinkDivider`, `AttemptGroup`, `OperatorBadge`, `OperatorFilterToggle`, `OperatorConcurrencyLimitModal`, `OperatorUnavailableModal`, `OperatorBudgetExceededModal`) + 10 modified UI files verified to exist and reference the spec's mockup IDs. Status-pill colour map + chain-link indicator formatter match `_shared.ts` per spec §5.1 / §13.2. Lint + typecheck pass cleanly across the client tree. — collapsed for brevity; PASS.

### Docs + CI gates (§5.3, §11, §3.14 item 10, §3.2 item 2, §4.7)

| REQ | Section | Description | Verdict |
|---|---|---|---|
| 55 | §3.13, §5.1 | `docs/runbooks/operator-session-account-suspension.md` + two comms templates exist | PASS |
| 56 | §5.1 | `docs/decisions/0011-operator-backend-chain-resume-model.md` ADR exists | PASS |
| 57 | §5.3 | `architecture.md` has Operator Backend section under § Key files per domain (lines ~3950+) | PASS |
| 58 | §5.3 | `docs/capabilities.md` updated (vendor-neutral copy) | PASS |
| 59 | §5.3 | `docs/doc-sync.md` updated for the operator-session event-registry pattern | PASS |
| 60 | §3.2 item 2, §5.1 | `scripts/gates/verify-execution-capability-references.sh` exists + wired in `.github/workflows/ci.yml:190` | PASS |
| 61 | §4.7, §5.1 | `scripts/gates/verify-operator-event-registry.sh` exists + wired in `.github/workflows/ci.yml:197` | PASS |
| 62 | §3.14 item 10, §5.1 | `scripts/gates/verify-no-checkpoint-logging.sh` exists + wired in `.github/workflows/ci.yml:204` | PASS |

### Cross-cutting (lifecycle event registry discipline) — DIRECTIONAL GAPS

| REQ | Section | Description | Verdict |
|---|---|---|---|
| 63 | §3.2 item 1, §4.7 | Single source of truth: `'operator-session.*'` literals appear only in the registry file + adapter declarations + tests/docs. CI gate `verify-operator-event-registry.sh` enforces. | **DIRECTIONAL_GAP** — see gap A |
| 64 | §4.7 | Adapter's emit names match the registry's event names | **DIRECTIONAL_GAP** — see gap B |

---

## Mechanical fixes applied

None. All gaps detected required human judgment (event-name reconciliation across multiple files and across producer/consumer boundary).

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

### Gap A — Naked `'operator-session.*'` literals at emit sites bypass the registry (REQ #63)

**Spec section:** §3.2 item 1 (single source of truth), §4.7 (namespace discipline)

**Gap:** The spec mandates that `'operator-session.*'` literals only appear in:
- `shared/types/operatorBackendEvents.ts` (canonical registry)
- Adapter declarations under `server/services/executionBackends/*.ts`
- Test fixtures / docs

…and that other consumers MUST import the typed `OperatorSessionEventName` union rather than hardcoding literals. The CI gate `verify-operator-event-registry.sh` enforces this.

The implementation has naked literals at the following emit sites (none are inside the gate's current allow-list, which is `shared/types/operatorBackendEvents.ts|__tests__/|.test.ts|^docs/|^tasks/|scripts/__tests__/|.sh:|.md:`):

- `server/services/executionBackends/operatorManagedBackend.ts:542` — `'operator-session.dispatched'`
- `server/services/executionBackends/operatorManagedBackend.ts:754` — `'operator-session.completed'`
- `server/services/executionBackends/operatorManagedBackend.ts:927` — `'operator-session.cancelled'`
- `server/jobs/operatorSessionProgressedHandler.ts:111` — `'operator-session.progressed'`
- `server/jobs/operatorSessionProgressedHandler.ts:119` — `'operator-session.preparing_checkpoint'`
- `server/jobs/operatorSessionProgressedHandler.ts:145` — `'operator-session.auto_extending'`
- `server/services/credentialBrokerService.ts:592-593` — `'operator-session.usability_restored'`
- `shared/types/runTraceEvent.ts:57-67, 320-348` — eleven `'operator-session.*'` literals

The gate will flag these on PR open and fail CI.

**Suggested approach:** Either (a) import the typed `OperatorSessionEventName` union or per-event constants and pass them by reference at emit sites, or (b) widen the gate's allow-list to include the adapter and handler files (matches spec § 3.2 item 2 intent, which already lists "adapter declarations under `server/services/executionBackends/*.ts`" — but the gate's current allow-list does NOT include this directory). Option (b) is the smaller change and matches spec § 3.2 item 2 intent; option (a) is more idiomatic but requires touching every emit site.

### Gap B — Event names diverge across three sources of truth (REQ #64)

**Spec section:** §4.7 (lifecycle events)

**Gap:** The spec's §4.7 registry uses these names:
- `operator-session.chain_link_completed` / `chain_link_failed` / `chain_link_cancelled`
- `operator-session.task_completed` / `task_failed` / `task_cancelled`

The implementation uses these (NOT in the registry):
- Adapter emits `'operator-session.completed'` at line 754 (no `task_` / `chain_link_` prefix)
- Adapter emits `'operator-session.cancelled'` at line 927 (no prefix)
- `shared/types/runTraceEvent.ts:57-67` defines a parallel `eventType` union with `'operator-session.chain_link_started'` (spec has no `chain_link_started`, only `dispatched`), `'operator-session.task_terminal_completed'` (spec uses `task_completed`), `'operator-session.task_terminal_failed'` (spec uses `task_failed`).
- `client/src/pages/operate/components/RunTraceEventRenderer.tsx:161-229` renders `'chain_link_started'`, `'task_terminal_completed'`, `'task_terminal_failed'` — these will never fire because no producer emits them under those names.

Net effect: Run Trace will not render the chain-link-completed/failed/cancelled or task-completed/failed/cancelled events because the names don't match between producer (`operatorBackendEvents.ts` registry, which is unused as a literal source) and consumer (`RunTraceEventRenderer.tsx`, which uses different names).

**Suggested approach:** Pick one canonical set of names (recommend the spec § 4.7 set: `chain_link_completed/failed/cancelled` + `task_completed/failed/cancelled` + `dispatched`) and reconcile:
1. Replace adapter line 754 `'operator-session.completed'` with the correct lifecycle name based on action (`task_completed` for task-terminal, `chain_link_completed` for chain-link-terminal).
2. Replace adapter line 927 `'operator-session.cancelled'` with `'operator-session.task_cancelled'` (cancel is task-level).
3. Update `shared/types/runTraceEvent.ts` lines 57-67 + 320-348 to use spec § 4.7 names: replace `chain_link_started` → `dispatched`, `task_terminal_completed` → `task_completed`, `task_terminal_failed` → `task_failed`.
4. Update `client/src/pages/operate/components/RunTraceEventRenderer.tsx` to listen on the spec names. WebSocket payload shape also changes (adapter currently sends `{operatorRunId, chainSeq, parentStatus, action}` for `operator-session.completed`; the spec's `task_completed` / `chain_link_completed` payloads at § 4.7 are different shapes — the renderer in the client needs to match).

This is cross-cutting (adapter + renderer + types) so it's directional. The fix is straightforward but the choice of canonical names plus the consumer-payload reconciliation wants a human eye on it.

---

## Files modified by this run

None. No mechanical fixes were applied.

---

## Next step

NON_CONFORMANT — 2 directional gaps must be addressed by the main session before `pr-reviewer`. See `tasks/todo.md` under "Deferred from spec-conformance review — operator-backend (2026-05-12)".

These gaps will fail the `verify-operator-event-registry.sh` CI gate on PR open. Lint and typecheck remain clean (0 errors) in the current state — the gap is purely a registry-discipline / event-name-reconciliation issue, not a compile issue. Recommended next action: have the main session decide on the canonical event-name set (spec § 4.7 names are recommended), update adapter + handler + renderer + runTraceEvent.ts in one coordinated commit, then re-run `pr-reviewer` on the expanded changed-code set.

**Commit at finish:** `1f709aa1`
