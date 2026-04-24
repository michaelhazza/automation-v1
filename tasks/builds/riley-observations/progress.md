# Riley Observations Wave 1 — Closeout

**Status:** APPROVED FOR MERGE — PR #186
**Branch:** `claude/start-riley-architect-pipeline-7ElHp`
**Final HEAD:** `bf46addc` (post-`origin/main` merge; 111/111 Riley-relevant tests passing)
**PR:** https://github.com/michaelhazza/automation-v1/pull/186

---

## What shipped

### Naming pass (Part 1 / spec §4)

Three strictly-ordered migrations rebrand the core vocabulary:

- **M1 (migration 0219)** — `workflow_runs` → `flow_runs` (schema + service rename)
- **M2 (migration 0220)** — `processes` → `automations` (5-table rename + §5.4a `side_effects` + `idempotent` capability-contract columns)
- **M3 (migration 0221)** — `playbooks` → `workflows` (9 tables, lib directory, skill markdown, socket rooms)
- **W1-6 (migration 0222)** — column renames on `automations` (`workflow_engine_id` → `automation_engine_id`, `parent_process_id` → `parent_automation_id`, `system_process_id` → `system_automation_id`) with paired down-migration

Plus the file-extension convention rename (W1-29): `server/playbooks/*.playbook.ts` → `server/workflows/*.workflow.ts`.

### `invoke_automation` step type (Part 2 / spec §5)

New first-class Workflow DSL step type with:
- Pure dispatcher (`invokeAutomationStepPure.ts` — `resolveDispatch`, `checkScope`, `resolveGateLevel`, `shouldBlock_nonIdempotentGuard`, `clampMaxAttempts`, `projectOutputMapping`, `validateDispatchOutput`)
- Stateful service (`invokeAutomationStepService.ts` — HMAC signing, retry loop, telemetry, soft-delete-guarded engine resolution, required-connection pre-dispatch check)
- Best-effort schema validator (`invokeAutomationSchemaValidator.ts`)
- Two new tracing events (`workflow.step.automation.dispatched` + `workflow.step.automation.completed`)
- Engine wiring in `workflowEngineService.ts` dispatch switch + `default:` exhaustiveness guard
- Validator extensions (`retry_ceiling_exceeded`, `unknown_step_type`)
- Studio UI: step-type picker + `AutomationPickerDrawer` + EventRow `invoke_automation` failure row

### Spec deltas applied during the cycle

- W1-43: §5.10a rule 4 multi-webhook assertion in `resolveDispatch`
- W1-44: §5.8 required-connection pre-dispatch check
- W1-38: engine-not-found mapped to `automation_composition_invalid` (§5.7 vocabulary)

---

## Review arc

| Phase | Outcome |
|---|---|
| `spec-conformance` | 8 mechanical fixes auto-applied; 6 directional gaps routed (4 closed in subsequent commits, W1-38 fixed mid-cycle, 2 remain — Mock 08/09 product/UX call) |
| `pr-reviewer` | 5 blocking findings — all fixed in `db9e838f` |
| `dual-reviewer` (Codex × 3 iterations) | 7 findings — 2 accepted (HMAC `X-Automation-Step-Run-Id` header + authoring-time validator walks `inputMapping`), 3 rejected, 2 deferred |
| `chatgpt-pr-review` round 1 | 7 findings — 5 fix, 1 reject, 1 user-facing (Option A approved) |
| `chatgpt-pr-review` round 2 | 5 findings — 2 fix, 2 reject (factually wrong), 1 defer |
| `chatgpt-pr-review` round 3 | 6 findings — 3 fix, 1 defer, 1 already-deferred, 1 doc-merged. Reviewer verdict: **merge** |

### Review log artefacts (durable, in `tasks/review-logs/`)

- `spec-conformance-log-riley-observations-wave1-2026-04-24T05-37-51Z.md`
- `pr-review-log-riley-observations-2026-04-24T06-49-34Z.md`
- `dual-review-log-riley-observations-2026-04-24T08-04-47Z.md`
- `chatgpt-pr-review-riley-observations-2026-04-24T10-25-11Z.md` (rounds 1–3 in one file)

---

## Quality gate

- **Server typecheck**: 76 pre-existing errors on main; **zero new errors** introduced. Net-fixed 2 rename-drift issues in `workspaceHealthFindings.ts`.
- **Unit tests**: 172 pass / 3 pre-existing fail (all 3 from cached-context Phase 1, untouched by Riley).
- **Riley-specific tests**: **111/111 passing** — 23 dispatcher + 18 workspace-health + 39 workflow-lib + 31 eventRowPure.
- **Origin/main merge**: post-merge re-test passed; only conflict was `tasks/todo.md` (additive, both sides preserved).

---

## Deferred follow-ups (in `tasks/todo.md`)

These are non-blocking; PR is ready to merge as-is. Each item has full trigger conditions and suggested approach captured in the relevant log.

1. **W1-52/53 — Mock 08/09 library posture** — `WorkflowsLibraryPage` and `AutomationsPage` not simplified to spec §3a.2 lock 8 mocks (product/UX call).
2. **Server-side enforcement of non-idempotent retry contract** (R2-5 / R3-4) — required when the "Retry step" backend endpoint is built.
3. **Wire fallback warn codes to a counter metric** (R3-1) — required when client metrics infrastructure lands.
4. **Review-gated `invoke_automation` steps don't dispatch after approval** (dual-review iter 2) — pre-existing cross-cutting architectural pattern.
5. **Late-completion invalidation race in tick switch** (dual-review iter 3) — pre-existing cross-cutting pattern across `action_call`, `agent_call`, `prompt`, `invoke_automation`.

---

## Out of scope (deferred to subsequent waves)

- W2 (Explore/Execute mode) — `tasks/builds/riley-observations/plan-w2-explore-execute-mode.md`
- W3 (context-assembly telemetry) — `plan-w3-context-assembly-telemetry.md`
- W4 (heartbeat gate) — `plan-w4-heartbeat-gate.md`

Each is its own PR once Wave 1 lands on main.
