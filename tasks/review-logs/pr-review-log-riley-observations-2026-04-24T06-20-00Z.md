# PR Review — Riley Observations Wave 1
**Branch:** claude/start-riley-architect-pipeline-7ElHp vs main
**Reviewed:** 2026-04-24T06:20:00Z
**Verdict:** BLOCK — 11 blocking issues
**Spec:** docs/riley-observations-dev-spec.md §4 + §5

See full review log in conversation history (pr-reviewer agent output).

## Blocking Issues (summary)
1. checkScope rejects system-scoped Automations (§5.8 bug)
2. Outbound webhook unsigned — HMAC contract missing
3. Engine resolution unscoped — cross-org security gap
4. Automation query missing soft-delete filter
5. Input mapping stringifies all values — should use resolveInputs
6. §5.9 completed-event payload missing workflowId, stepId, orgId etc.
7. Engine-not-found emits no telemetry event
8. Default timeout 30s not 300s; step.timeoutSeconds ignored
9. FK column rename missing in migration 0219 (review_audit_records.workflow_run_id)
10. User-visible "playbook" strings remain in client pages
11. §5.9 status fallback maps unknown codes to automation_not_found

## Architectural (route to tasks/todo.md)
- #9: Migration 0219 column rename for review_audit_records
