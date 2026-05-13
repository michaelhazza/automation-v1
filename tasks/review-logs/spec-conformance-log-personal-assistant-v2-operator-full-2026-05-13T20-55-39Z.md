# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`
**Spec commit at check:** `e27a218a` (APPROVED) per `tasks/builds/personal-assistant-v2-operator/plan.md`
**Branch:** `claude/personal-assistant-post-merge-audit`
**Base:** merge-base `72f2849316a1bfe56325471579c85d9afddca062` with `main`
**Scope:** all-of-spec (post-merge audit; caller-confirmed full coverage of chunks 1a, 1b, 2, 3, 4, 5, 6, 7, 8, 9)
**Changed-code set:** 459 files changed since merge-base; spec-relevant V2 files audited explicitly
**Run at:** 2026-05-13T20:55:39Z

---

## Contents

1. Summary
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Next step

---

## 1. Summary

- Requirements extracted:     ~54 subcomponents (per spec §4 inventory)
- PASS:                       46
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 8
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT — 8 directional gaps must be triaged by the operator before merge. See `tasks/todo.md` § "Deferred from spec-conformance review — personal-assistant-v2-operator (2026-05-13)".

Most spec items land cleanly. The eight gaps cluster into three failure modes:
- One schema divergence (`subaccount_id` nullability) — concrete, fixable with one corrective migration.
- Three runtime-integration gaps (`startSession` + `handleFileWriteToolCall` + sandbox IPC) — all in the boundary between V1 CI and the infra-managed operator runtime. They share the same root cause and can be resolved by one decision: either ship the runtime wiring or document the deferral explicitly.
- Four design-call gaps (bundler data source, payload field naming, projection allow-list, recompute-in-tx) — each needs a small spec-vs-code arbitration before being closed.

None of the gaps falsify the spec's load-bearing invariants. The cross-owner privacy boundary, two-axis matcher, approval-routing column, idempotent UPSERT, and event-criticality registry are all correctly implemented.

---

## 2. Requirements extracted (full checklist)

| # | Section | Subcomponent | Verdict | Evidence |
|---|---|---|---|---|
| 1 | §4.1 mig 0345 | EA controller_style flip + idempotent predicate | PASS | `migrations/0345_ea_controller_style_native_and_operator.sql` |
| 2 | §4.1 mig 0346 | `actions.approver_user_id` + FK ON DELETE RESTRICT | PASS | `migrations/0346_actions_approver_user_id.sql` |
| 3 | §4.1 mig 0347 | `delegation_outcomes` 3 cols + partial index + 10-value CHECK | PASS | `migrations/0347_delegation_outcomes_cross_owner_state.sql` |
| 4 | §4.1 mig 0348 | `operator_run_files` table + UNIQUE + 4 CHECKs + RLS policy | PASS schema; DIRECTIONAL on `subaccount_id` nullability | `migrations/0348_operator_run_files.sql` + `migrations/0349_*` |
| 5 | §4.2 | `operatorSandboxFileEventBridge.ts` — canonical UPSERT, R2 upload, event emit | PASS | `server/services/operatorSandboxFileEventBridge.ts:73-145` |
| 6 | §4.2 | `operatorSandboxFileEventBridgePure.ts` — version derivation, sha256, dedupe, path safety | PASS | `server/services/operatorSandboxFileEventBridgePure.ts` |
| 7 | §4.2 | `crossOwnerDelegationAuthorisation.ts` — two-layer fail-closed | PASS | `server/services/crossOwnerDelegationAuthorisation.ts` |
| 8 | §4.2 | `crossOwnerDelegationAuthorisationPure.ts` — possessive regex, normalisation | PASS | `server/services/crossOwnerDelegationAuthorisationPure.ts` |
| 9 | §4.2 | `crossOwnerDelegationRequestAssembler.ts` — writes `cross_owner_approval_timeout_policy` | PASS | `server/services/crossOwnerDelegationRequestAssembler.ts` |
| 10 | §4.2 | `crossOwnerDelegationRequestAssemblerPure.ts` — `deriveTimeoutPolicy` + `deriveDelegationScope` | PASS | `server/services/crossOwnerDelegationRequestAssemblerPure.ts` |
| 11 | §4.2 | `operatorSessionInitialContextBundler.ts` — DB reads + bundle assembly | PASS structure; DIRECTIONAL on timezone source | `server/services/operatorSessionInitialContextBundler.ts:115-128` |
| 12 | §4.2 | `operatorSessionInitialContextBundlerPure.ts` — 4096-byte trim algorithm | PASS | `server/services/operatorSessionInitialContextBundlerPure.ts` |
| 13 | §4.2 | `runTracePure.ts` — viewer projection | PASS event filter; DIRECTIONAL on per-state timestamp allow-list | `server/services/runTracePure.ts` |
| 14 | §4.3 | `capabilityMapService` — `owner_user_id`, `matchCapability`, recompute helper | PASS | `server/services/capabilityMapService.ts:119-279, 290-329` |
| 15 | §4.3 | `integrationReferenceService` thread-through | PASS (spec said "drop if no change needed"; no change needed) | `server/services/integrationReferenceService.ts` |
| 16 | §4.3 | `operatorSessionLifecycleService.startSession` wiring | DIRECTIONAL | exported but zero callers |
| 17 | §4.3 | `operatorSessionService.handleFileWriteToolCall` wiring | DIRECTIONAL | exposed at `:625-637` but zero callers |
| 18 | §4.3 | `agentExecutionService` EA no-op | PASS (no change needed per spec) | unchanged on branch |
| 19 | §4.3 | `actionService` — `approverUserId` write + union read | PASS | `server/services/actionService.ts:111, 202, 666-713` |
| 20 | §4.3 | `workflowGateStallNotifyJob` — timeout-policy tree + `ask_initiator` branch | PASS | `server/jobs/workflowGateStallNotifyJob.ts:128-297` |
| 21 | §4.3 | `controllerStyleResolver` no-op | PASS | not modified on branch |
| 22 | §4.3 | `capabilityDiscoveryHandlers` — RoutingContext + addressing parser | PASS (incl. untrusted-client discard) | `server/tools/capabilities/capabilityDiscoveryHandlers.ts:340-520` |
| 23 | §4.3 | `skillExecutor` no-op | PASS | not modified on branch |
| 24 | §4.3 | `agentExecutionEventService` — projection invocation at both list reads | PASS | `server/services/agentExecutionEventService.ts:738-741, 867-870` |
| 25 | §4.3 | `taskEventStream` route — projection invocation | PASS | `server/routes/taskEventStream.ts:124-127` |
| 26 | §4.3 | `agentRuns` route — projection invocation | PASS | `server/routes/agentRuns.ts:760-763` |
| 27 | §4.3 | `rlsProtectedTables` registers `operator_run_files` | PASS | `server/config/rlsProtectedTables.ts:1302-1308` |
| 28 | §4.4 | `verify-capability-map-shape.sh` exists + executable | PASS | `scripts/gates/verify-capability-map-shape.sh` |
| 29 | §4.5 | Sandbox watcher + path-safety + redacted logging | PASS code; DIRECTIONAL on IPC wiring | `infra/sandbox-templates/operator-session/file-watcher.js` |
| 30 | §4.6 | `shared/types/routingContext.ts` | PASS | `shared/types/routingContext.ts` |
| 31 | §4.6 | `shared/types/capabilityMap.ts` | PASS | `shared/types/capabilityMap.ts` |
| 32 | §4.6 | `shared/types/operatorEvents.ts` — 4 variants | PASS variants; DIRECTIONAL on payload field shape | `shared/types/operatorEvents.ts` |
| 33 | §4.6 | `shared/types/crossOwnerApproval.ts` — timeout policy + pause reasons | PASS | `shared/types/crossOwnerApproval.ts` |
| 34 | §4.6 | `agentExecutionLog.ts` criticality registry — 4 new entries | PASS | `shared/types/agentExecutionLog.ts:508-511` |
| 35 | §4.7 | `architecture.md` doc-sync — universal invariant + cross-owner section + capability-map | PASS | `architecture.md:294, 4092, 4216-4228` |
| 36 | §4.7 | master brief universal-invariant note | PASS (lands under §5/§12 cluster, not literal §5.6) | `docs/synthetos-governed-agentic-os-brief-v1.2.md:315` |
| 37 | §4.7 | `docs/capabilities.md` "standing autonomous operator" entry | PASS (vendor-neutral, no em-dashes) | `docs/capabilities.md:550` |
| 38 | §4.7 | `KNOWLEDGE.md` pattern extractions | PASS | `KNOWLEDGE.md:1200, 1230, 1236` |
| 39 | §4.8 | `server/db/schema/operatorRunFiles.ts` Drizzle schema | PASS structure; DIRECTIONAL on `.notNull()` on `subaccount_id` | `server/db/schema/operatorRunFiles.ts` |
| 40 | §5.1 | Capability-map shape extension + source-of-truth precedence | PASS | shape lands; gate `verify-capability-map-shape.sh` catches drift |
| 41 | §5.2 | RoutingContext + matcher rule (two-axis) | PASS | `server/services/capabilityMapService.ts:254-280` |
| 42 | §5.3 | Addressing parser — `@PA`/`@MyAssistant`/`@<DisplayName>`, collision, 0.15 boost, unsupported_cross_owner | PASS | `server/tools/capabilities/capabilityDiscoveryHandlers.ts:348-408, 473` |
| 43 | §5.4 | Cross-owner contract + privacy projection + untrusted-client discard | PASS event filter + discard; DIRECTIONAL on per-state timestamp allow-list | bridge + handler + projection |
| 44 | §5.5 | `approver_user_id` override semantics — NULL preserves V1, cross-owner override | PASS | `actionService.ts:111, 202` + `actionServicePure.ts:14-20` |
| 45 | §5.6 | Timeout-policy stall behaviour — fail/continue/ask_initiator | PASS (incl. `cross_owner.ask_initiator_decision` registered) | `workflowGateStallNotifyJob.ts:154-296` + `core.ts:818-839` |
| 46 | §5.7 | UPSERT-derived version, no preflight SELECT, watcher dedupe | PASS | `operatorSandboxFileEventBridge.ts:73-93` + Pure helpers |
| 47 | §5.8 | 4096-byte cap + priority order | PASS | `operatorSessionInitialContextBundlerPure.ts:55, 94-173` |
| 48 | §6.1 | RLS coverage on `operator_run_files` | PASS | migration 0348 RLS policy + `rlsProtectedTables.ts` entry |
| 49 | §6.4 | Recompute-in-tx invariant | DIRECTIONAL | helper exists with `tx` param, but no production caller writes `agents.ownerUserId` |
| 50 | §6.5 | Projection at read time (two-layer enforcement) | PASS | service-layer (`agentExecutionEventService.ts`) + route-layer (`agentRuns.ts`, `taskEventStream.ts`) |
| 51 | §9.3 | Concurrency guards — UPSERT serialisation + watcher dedupe + same-tx recompute | PASS | `operatorSandboxFileEventBridge.ts:73-93` + spec-compliant predicate |
| 52 | §9.4 | Single terminal-event predicate `WHERE id = $1 AND terminal_at IS NULL` | PASS | `workflowGateStallNotifyJob.ts:161-170, 196-205, 234-244` |
| 53 | §9.7 | State machine closure — 10-value union enforced at DB | PASS | migration 0347 CHECK + `delegation_outcomes` schema |
| 54 | ADR | `docs/decisions/0023-approval-follows-executor-owner.md` | PASS (status: accepted) | `docs/decisions/0023-approval-follows-executor-owner.md` + listed in `docs/decisions/README.md:72` |

---

## 3. Mechanical fixes applied

None. Every detected gap requires design judgement (schema-vs-data trade-off, runtime-integration decision, payload-shape convention, projection-helper expansion) and is routed to `tasks/todo.md` accordingly. Strict fail-closed posture per playbook Step 3 — "when in doubt, classify as DIRECTIONAL_GAP, not MECHANICAL_GAP."

---

## 4. Directional gaps (routed to `tasks/todo.md`)

All eight gaps appended under `## Deferred from spec-conformance review — personal-assistant-v2-operator (2026-05-13)`:

- **PA-V2-CONFORMANCE-1** — `operator_run_files.subaccount_id` is nullable in code; spec §4.1 specified `NOT NULL`.
- **PA-V2-CONFORMANCE-2** — Initial-context bundler reads timezone from `subaccount_agents.scheduleTimezone`, not `users` table as spec §5.8 + §4.2 stated. Working-hours and recent-activity-summary are silently null/omitted.
- **PA-V2-CONFORMANCE-3** — `operatorSessionLifecycleService.startSession` has zero production callers; spec §4.3 said wire into the `operator_runs` insert path.
- **PA-V2-CONFORMANCE-4** — `operatorSessionService.handleFileWriteToolCall` has zero production callers; spec §4.3 said wire into the operator-session tool-registry handler.
- **PA-V2-CONFORMANCE-5** — File event payload uses `eventType`/`sizeBytes` (convention) and OMITS `emittedAt`. Spec §5.7 sketched `type`/`size`/`emittedAt`. Likely a convergence rename plus one true omission.
- **PA-V2-CONFORMANCE-6** — `runTraceProjectionForViewer` filters event-types but does not strip per-state timestamps from cross-owner sub-step rows. Spec §5.4 "Initiator-visible lifecycle timing invariant" requires the timestamp allow-list.
- **PA-V2-CONFORMANCE-7** — `recomputeCapabilityMapWithOwner(tx?)` is not invoked from any `agents.ownerUserId` write path. Spec §6.4 said recompute in the same transaction.
- **PA-V2-CONFORMANCE-8** — `entrypoint.sh` launches the file-watcher with `&` (backgrounded shell), not `child_process.fork()`. The watcher's `process.send` will silently no-op. Sandbox runtime is infra-managed but the V1-shipped state will not deliver watcher events when paired with a fork-launched parent.

---

## 5. Files modified by this run

- `tasks/todo.md` — appended one deferred section with eight items (PA-V2-CONFORMANCE-1..8).
- `tasks/review-logs/spec-conformance-log-personal-assistant-v2-operator-full-2026-05-13T20-55-39Z.md` (this file).

No production code was modified.

---

## 6. Next step

**NON_CONFORMANT** — eight directional gaps must be addressed by the main session before `pr-reviewer`.

The user should:
1. Triage the eight items in `tasks/todo.md` § "Deferred from spec-conformance review — personal-assistant-v2-operator (2026-05-13)".
2. Decide which are spec amendments (e.g., #2 timezone source if `users` doesn't carry timezone, #5 field rename to match registry convention) vs code fixes (e.g., #1 NOT NULL backfill, #6 projection allow-list).
3. Document any accepted gaps in `tasks/builds/personal-assistant-v2-operator/handoff.md` so finalisation can record `REVIEW_GAP` lines if needed.

Since no production code was modified by this run, **no `pr-reviewer` re-run is required for code state**. After triage and any code fixes, the standard Phase 2 review pipeline (`pr-reviewer` → `reality-checker` → `dual-reviewer`) applies.
