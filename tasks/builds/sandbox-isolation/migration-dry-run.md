# Sandbox Isolation — Classification Dry-Run

**Script:** `scripts/migrations/sandbox-isolation-classification-dry-run.ts`
**Spec:** Spec B §18.4, plan C13
**Run date:** 2026-05-11T07:30:40.295Z
**Overall status:** PASS (9/9 passed)

## Classification table

| Task type | Class | Status | Rationale |
|---|---|---|---|
| goal-only (minimal) | worker_trusted | PASS | Dev Agent exploration task — trusted repo operation with no customer-derived code or LLM-emitted scripts. |
| repo checkout + branch | worker_trusted | PASS | Controlled repo checkout — git operations against a known branch. No customer input in the execution path. |
| commands only | worker_trusted | PASS | Pre-authored build/test commands against the internal repo. Commands originate from the agent definition, not from customer-supplied input. |
| repo + branch + commands | worker_trusted | PASS | Full dev pipeline: checkout + build + typecheck. All commands are internal and predefined. |
| repo + checks (all quality gates) | worker_trusted | PASS | Dev Agent quality check configuration — lint, typecheck, test are all internal CI commands, not derived from customer input. |
| checks only (lint) | worker_trusted | PASS | Single-phase lint check against the internal repository. |
| checks only (typecheck) | worker_trusted | PASS | Single-phase typecheck against the internal repository. |
| checks only (test) | worker_trusted | PASS | Single-phase test run against the internal repository. |
| fully specified (all optional fields) | worker_trusted | PASS | Maximum-field dev task. No customer-derived input in any field; all commands are internal. |

## Summary

All V1 `DevTaskPayload` variants classify as `worker_trusted` — this is
correct per spec §7.2. The Dev Agent's current task universe consists entirely
of trusted repo/dev operations (Tier 5): git checkout, build commands, test
runs, and quality checks against internal repositories.

No current variant dispatches customer-derived code or LLM-emitted scripts
over customer data. Future task variants that carry such data will:
1. Introduce an explicit discriminator in the payload schema.
2. Update `classifyExecutionClass()` to return `'sandbox'` for those variants.
3. Be caught by the `verify-sandbox-classification` CI gate (C14).

## Spec §7.2 mapping

| Spec class | Examples | Runs where | V1 DevTaskPayload? |
|---|---|---|---|
| Customer-uploaded data parsing | CSV, Excel, PDF | Sandbox | No |
| LLM-emitted scripts over customer data | Python/JS transforms | Sandbox | No |
| Customer-derived transformation logic | Any customer/LLM source | Sandbox | No |
| Deterministic internal orchestration | Routing, metadata, harvest | Worker | No |
| Trusted repo / dev operations | Controlled repo commands | Worker (Tier 5) | **Yes — all current variants** |
