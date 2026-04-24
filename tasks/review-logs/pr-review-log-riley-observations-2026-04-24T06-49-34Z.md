# PR Review — Riley Observations Wave 1

**Branch:** `claude/start-riley-architect-pipeline-7ElHp` vs `main`
**Reviewed at:** 2026-04-24T06:49:34Z
**Reviewer:** pr-reviewer agent

---

## Blocking Issues

### 1. `invoke_automation` NOT wired into workflowEngineService dispatch switch

`server/services/workflowEngineService.ts` dispatch switch has no `case 'invoke_automation':` branch and no `default:` guard. When a workflow tick reaches an `invoke_automation` step run, the switch falls through silently — the step stays in its prior state and `invokeAutomationStep()` is never called. All new §5 code paths are only reachable from tests.

**Fix:** Add an `invoke_automation` case mirroring `action_call` pattern: call `invokeAutomationStep()`, handle three return statuses (`ok` → `completeStepRunInternal`, `error` → `failStepRunInternal`, `review_required` → `awaiting_approval` + `workflow_step_reviews` row). Add `default:` exhaustiveness guard.

### 2. `projectOutputMapping` cannot resolve `{{ response.* }}` — output mapping broken

`server/services/invokeAutomationStepPure.ts` lines 101-113; called from `invokeAutomationStepService.ts` line 315.

`responseBody` is passed as the first arg but never merged into the template context. A mapping like `{ contactId: '{{ response.id }}' }` renders against the run context only, finds no `response` namespace, and returns undefined.

**Fix:** Build context with `response` merged in before rendering:
```ts
const ctxWithResponse = { ...ctx, response: responseBody };
```

### 3. `workspaceHealthServicePure.test.ts` uses pre-rename field names

Lines 50, 168, 173, 180, 195 etc. push to `ctx.processes` with `workflowEngineId` and reference `processConnectionMappings`. After the rename these fail typecheck and the test run.

**Fix:** Replace `ctx.processes` → `ctx.automations`, `processConnectionMappings` → `automationConnectionMappings`, `workflowEngineId` → `automationEngineId` throughout.

### 4. Invalid `Automation` fixture field in `invokeAutomationStepPure.test.ts`

Line 63: `workflowEngineId: 'engine-1'` should be `automationEngineId: 'engine-1'` (only compiles due to `as unknown as Automation` cast on line 77).

### 5. Missing down migration for 0222

`migrations/_down/` contains 0219, 0220, 0221 but no 0222. Convention is to have paired reversibility for every Wave 1 rename migration.

**Fix:** Add `migrations/_down/0222_rename_automations_columns.sql` reversing the column renames.

---

## Strong Recommendations

### 1. Additional test coverage needed

- Output mapping resolving `{{ response.id }}` (validates Fix #2)
- org→subaccount-native scope check (currently uncovered)
- Explicit `gateLevel: 'review'` override on a `read_only` automation
- End-to-end retry path with `idempotent: true` automation hitting 503

### 2. `MAX_RETRY_ATTEMPTS` unused import in `invokeAutomationStepService.ts`

Imported on line 26 but never referenced directly. Remove.

### 3. Engine-scope check uses `?? ''` placeholder

Line 187: `automation.organisationId ?? ''` — empty string never matches a UUID, works by accident. Rewrite to check `isNull` explicitly when org is null.

### 4. Enforce leading `/` in `webhookPath`

`resolveDispatch` line 188 concatenates `engineBaseUrl + automation.webhookPath`. If path lacks leading slash the URL is malformed. Normalise or validate in the multi-webhook assertion.

### 5. HMAC signs only `stepRunId`, not body

Not a new risk (re-uses existing convention), but add an inline comment so future readers know the body is not body-integrity-protected.

---

## Non-blocking Improvements

1. `shouldBlock_nonIdempotentGuard` → `shouldBlockNonIdempotentRetry` (mixed casing)
2. Migration 0219 FK added before column rename (unusual ordering, not incorrect)
3. `review_audit_records.workflow_run_id` name now misleads (references `flow_runs`)
4. `workflow.step.automation.completed` events don't carry `automationEngineId`/`engineType` (useful for reconciliation)
5. `AutomationsPage` reads `res.data ?? []` but `AutomationPickerDrawer` reads `data?.automations ?? []` — one is wrong
6. `resolveInputs({ _v: expr }, …)` wrapping is clever but obscure — consider exposing `resolveValue()` helper

---

## Verdict

**Request changes.** Three blocking correctness issues and two blocking consistency issues before merge.
