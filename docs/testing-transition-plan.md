# Testing Transition Plan

**Purpose:** Define the conditions under which the codebase shifts from its current gates-only testing posture to a full unit and integration test posture, and inventory what must exist before that shift can safely happen.

**This document does not flip the posture.** The flip happens when the trigger condition below is met. Until then, the posture described in `DEVELOPMENT_GUIDELINES.md` §7 and `references/test-gate-policy.md` remains in effect.

---

## Trigger

T-minus-14 calendar days before first live agency client onboarding. Self-correcting trigger: lands when it needs to, regardless of slippage.

When the onboarding date is known, the operator sets a calendar reminder 14 days out and opens a PR that updates `docs/spec-context.md` to flip `testing_posture`. That PR is the gate. It does not merge until the suites listed in the Inventory section below exist and pass.

## Inventory

### 1. Integration tests for RLS-protected flows

An integration test suite that exercises the database directly against a live Postgres instance (with RLS enforcement active) for the tables and flows most likely to surface cross-tenant leaks.

Each test should assert that a query made under one organisation's session variable cannot read or modify rows belonging to another organisation.

The tables requiring integration coverage, drawn from `server/config/rlsProtectedTables.ts`, are grouped by sensitivity and volume of production traffic:

**Core agent run surface** (highest read/write frequency):
- `tasks`, `actions`, `agent_runs` (migration 0079)
- `agent_run_messages` (migration 0084)
- `agent_execution_events`, `agent_run_prompts`, `agent_run_llm_payloads` (migration 0227)

**HITL and review** (human-in-the-loop decisions):
- `review_items`, `review_audit_records` (migration 0080)
- `tool_call_security_events` (migration 0082)

**LLM billing audit** (financial exposure):
- `llm_requests`, `llm_requests_archive`, `audit_events` (migrations 0081, 0188)

**Memory and workspace** (accumulated agent intelligence):
- `workspace_memories`, `workspace_memory_entries` (migrations 0080, 0245)
- `memory_blocks` (migration 0088)
- `agent_beliefs`, `agent_briefings`, `subaccount_state_summaries` (migrations 0112, 0105)

**Canonical CRM layer** (PII and financial data):
- `canonical_accounts`, `canonical_contacts`, `canonical_opportunities` (migration 0168)
- `canonical_conversations`, `canonical_revenue` (migration 0168)

**Access control** (permission structure):
- `service_principals`, `teams`, `team_members`, `delegation_grants` (migration 0167)
- `org_user_roles`, `organisation_secrets`, `permission_sets` (migration 0245)

**Cached context and knowledge** (document content):
- `reference_documents`, `document_bundles`, `bundle_resolution_snapshots` (migrations 0229, 0204, 0207)
- `reference_document_chunks` (migration 0289)

The remaining tables in the manifest have equivalent RLS policies. The groups above cover the highest-risk cross-tenant leak surfaces. The others should be swept in a second pass once the core suite is green.

The existing file `server/services/__tests__/rls.context-propagation.test.ts` is the natural home for this coverage.

### 2. Workflow engine smoke tests

A smoke test suite that exercises `WorkflowEngineService` (in `server/services/workflowEngineService.ts`) end-to-end for each step type the engine can dispatch.

The engine handles the following step types, each of which needs at minimum a happy-path run:

- `user_input` — pauses the run and waits for external input
- `approval` — pauses the run and waits for human approval
- `conditional` — evaluates a condition and routes to the true or false branch
- `agent_decision` — dispatches an agent run that produces a structured branch choice
- `agent_call` / `prompt` — dispatches an agent run for general-purpose reasoning
- `action_call` — routes to an action executor via `workflowActionCallExecutor`
- `invoke_automation` — triggers a sub-automation run
- `agent` / `action` — Studio-authored aliases for `agent_call` and `action_call`

The public API methods that must be exercised as part of the smoke surface: `enqueueTick`, `tick`, `completeStepRun`, `failStepRun`, `onAgentRunCompleted`, `watchdogSweep`, `registerWorkers`.

### 3. The four obese services' critical paths

These four services are the largest files in the codebase. Each requires upstream splitting before comprehensive tests are practical. However, the critical paths listed below can be tested against a test double or a lightweight integration fixture once the posture flips. The splitting work is a separate workstream and is out of scope here.

#### `server/services/skillExecutor.ts`

The main dispatch mechanism is `skillExecutor.execute`, which routes to a handler in `SKILL_HANDLERS` by skill name. Critical paths:

- `execute` — valid skill name resolves to the correct handler; unknown skill name returns a structured error; MCP-prefixed skill names route to `mcpClientManager`
- `SKILL_HANDLERS` key enumeration — the set of registered skill names matches `ACTION_REGISTRY` entries (guards against the §8.23 divergence class)
- `registerProcessor` — processor hooks registered at module load time are reachable via the registry

#### `server/services/workflowEngineService.ts`

Partially covered by the smoke tests above. Additional critical paths for the non-tick API:

- `completeStepRun` — marks a step as complete and enqueues the next tick
- `failStepRun` — marks a step as failed with a reason string
- `onAgentRunCompleted` — handles the completion hook fired by `agentRunService`

#### `server/services/skillAnalyzerServicePure.ts`

This file contains pure functions with no database or network side effects. These can be tested today under the current posture and should be among the first covered post-flip:

- `cosineSimilarity` — semantic similarity scoring for embedding vectors
- `classifyBand` — maps a similarity score to a named band (`likely_duplicate`, `ambiguous`, `distinct`)
- `computeBestMatches` — selects the best-matching library skill for each candidate embedding
- `buildClassificationPrompt` — constructs the LLM prompt for pairwise classification
- `parseClassificationResponse` — validates and parses the LLM classification JSON response
- `deriveClassificationFailureReason` — maps an error to a structured failure reason

Because `cosineSimilarity` and `classifyBand` are pure functions with no side effects, they are testable today under the current posture using `npx vitest run`. If time allows before flip-day, these two functions make a good early entry.

#### `server/services/agentExecutionService.ts`

The main entry point is `agentExecutionService.executeRun`. Critical paths:

- `executeRun` — kill switch check, idempotency key lookup, run record creation, and the full agentic loop dispatch
- `resumeAgentRun` (top-level export) — checkpoint load, config-version drift check, and loop resume from a saved checkpoint

## Sequencing

The suites should be activated in this order, from lowest implementation risk to highest.

**First: integration tests for RLS-protected flows.**

These are the lowest-risk tests to write because they exercise the database layer directly and the assertion model is simple: a row owned by organisation A is not readable under organisation B's session variable. The test harness already exists at `server/services/__tests__/rls.context-propagation.test.ts`. No service splitting is required.

**Second: workflow engine smoke tests.**

The workflow engine is a self-contained state machine with a well-defined public API and clear input/output contracts per step type. A smoke test can stand up a minimal run record and assert that each step type transitions correctly. This is more involved than RLS tests but does not require splitting any service.

**Third: the four obese services' critical paths.**

`skillExecutor.ts` and `workflowEngineService.ts` are the most testable of the four without splitting, building on the smoke suite. `skillAnalyzerServicePure.ts` pure functions can be added at any time. Full coverage of `agentExecutionService.executeRun` requires either a lightweight integration fixture or service splitting, which is tracked separately and deferred.

## Effort estimate

| Suite | Effort |
|---|---|
| Integration tests for RLS-protected flows (core tables, 8 groups) | M |
| Integration tests for RLS-protected flows (remaining tables, second pass) | M |
| Workflow engine smoke tests (all step types, happy path) | M |
| Workflow engine smoke tests (failure paths and watchdog) | S |
| `skillAnalyzerServicePure.ts` pure function tests | S |
| `skillExecutor.ts` dispatch and registry tests | M |
| `workflowEngineService.ts` public API tests (completeStepRun, failStepRun, onAgentRunCompleted) | S |
| `agentExecutionService.ts` critical path tests | L |

The minimum pre-flip requirement covers the first three rows above. Those represent roughly three medium-effort workstreams, which can be completed in the 14-day window if started immediately when the trigger fires.

## Out of scope

This document does not flip the testing posture. The flip requires a dedicated PR that updates `docs/spec-context.md` and is gated on the suites in the Inventory section above existing and passing.

The following are also explicitly out of scope for this transition plan:

- Writing individual test cases. This document lists suites and their minimum scope, not individual test cases.
- Splitting the four obese services. That is a separate workstream.
- End-to-end (Playwright) or API-level (Supertest) tests. Those belong in a later phase once the unit and integration layer is stable.
- Load, performance, or chaos testing.

## Maintenance

This doc is both a planning artifact (sequencing toward the testing-posture flip) and a policy artifact (suite inventory referenced by `DEVELOPMENT_GUIDELINES.md §7`). The two roles age at different rates — file paths and service names drift faster than the sequencing rationale.

Review quarterly OR whenever a service split / rename lands. Update the suite inventory, the obese-services list, and the file paths to reflect current state. The sequencing / effort / out-of-scope sections rarely need touching outside a major architecture shift.

## Cross-references

- **`DEVELOPMENT_GUIDELINES.md` §7** — current testing posture (`static_gates_primary`). States that new runtime tests are added only for pure functions until `docs/spec-context.md` flips `testing_posture`. Includes the instruction: "When `docs/spec-context.md` flips `testing_posture`, update §7 of this document to describe the new posture."
- **`references/test-gate-policy.md`** — the CI-only rule: what is forbidden locally, what is allowed, and why. The forbidden list remains in force until the posture flip.
- **`server/services/skillExecutor.ts`** — skill dispatch registry (`SKILL_HANDLERS`, `skillExecutor.execute`).
- **`server/services/workflowEngineService.ts`** — tick-driven workflow execution engine (`WorkflowEngineService`).
- **`server/services/skillAnalyzerServicePure.ts`** — pure-function embedding and classification helpers.
- **`server/services/agentExecutionService.ts`** — agent run lifecycle (`executeRun`, `resumeAgentRun`).
