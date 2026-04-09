# Testing Structure — April 2026

Standalone reference document capturing the testing-strategy analysis performed against the Automation OS codebase in April 2026. This is a snapshot for future work — the recommendations here will be revisited and potentially superseded as the app matures.

**Context when this was written:** the platform is pre-production, no live users, features are still evolving rapidly, and the "significant testing" phase has not yet started. A separate ticket will flesh out the concrete tests recommended here.

**Related documents:**
- `docs/improvements-roadmap-spec.md` — the detailed implementation spec that triggered this testing-strategy analysis
- `docs/improvements-roadmap.md` — phased roadmap that the spec implements
- `CLAUDE.md` — platform playbook (references the existing `test:gates` / `test:qa` scripts)

---

## Table of contents

1. [Honest inventory — what actually exists today](#honest-inventory)
2. [Testing philosophy observation](#testing-philosophy-observation)
3. [Current-phase recommendations (rapid evolution)](#current-phase-recommendations-rapid-evolution)
4. [Later-phase recommendations (stabilisation)](#later-phase-recommendations-stabilisation)
5. [Concrete action items for the separate ticket](#concrete-action-items-for-the-separate-ticket)

---

## Honest inventory

An audit of the repo (as of April 2026, main commit `3e0f4ac` + this branch) reveals a deliberate testing posture: heavy investment in static analysis, minimal runtime testing.

### Backend runtime tests

**Exactly 2 files**, both using `tsx` with ad-hoc assertions:

- `server/lib/playbook/__tests__/playbook.test.ts`
- `server/services/__tests__/runContextLoader.test.ts`

No test framework. No Vitest. No Jest. The convention is:

1. Extract pure logic into a sibling `*Pure.ts` file that has zero database or environment dependencies.
2. Write a `*.test.ts` next to it that imports from the pure module and asserts with plain TypeScript.
3. Run via `tsx <path>` directly or via an explicit script entry in `package.json` (only `playbooks:test` is wired today).

The `runContextLoader.test.ts` file explicitly documents this convention:

> The repo doesn't have Jest / Vitest configured, so we follow the same lightweight pattern as `server/lib/playbook/__tests__/playbook.test.ts`.

### Backend static analysis

**24 `verify-*.sh` gate scripts + 4 QA spec scripts.** This is where roughly 95% of the "testing" investment actually lives.

- `scripts/run-all-gates.sh` runs every `verify-*.sh` script. Each script greps the codebase for a specific structural invariant.
- `scripts/run-all-qa-tests.sh` (113 lines) is a bash check-list that asserts file existence, schema field presence, function references, and migration existence.
- `scripts/run-spec-v2-tests.sh` is a similar check-list for the org-level agents v2 spec implementation.
- `scripts/run-paperclip-features-tests.sh` is another spec-specific check-list.

Examples of gate scripts:

- `verify-async-handler.sh` — every async route uses `asyncHandler`
- `verify-org-scoped-writes.sh` — every write query includes `organisationId`
- `verify-no-db-in-routes.sh` — routes don't call `db` directly
- `verify-multi-tenancy-readiness.sh` — multi-tenant prerequisites are in place
- `verify-authentication-readiness.sh` — auth middleware chain is correct
- `verify-schema-compliance.sh` — Drizzle schemas match conventions

**Characteristics:** fast (sub-second each), deterministic, grep-based, maintenance-free as long as the patterns stay the same. They are essentially custom lints tailored to the project's conventions.

**`npm test` runs:** `test:gates` + `test:qa`. Both are bash-based.

### Frontend tests

**Zero.** No `*.test.tsx` files. No Vitest. No Jest. No React Testing Library. No MSW (Mock Service Worker). No frontend testing dependencies in `package.json`.

### API contract tests

**Zero dedicated.** No supertest. No dedicated route testing infrastructure. API shape is covered **indirectly** by the static gates (`verify-async-handler.sh`, `verify-org-id-source.sh`, `verify-no-direct-role-checks.sh`, etc.) which ensure routes follow conventions structurally, but nothing exercises routes at runtime with real HTTP calls.

### End-to-end tests

**Zero of the Automation OS app itself.**

Playwright **is** installed as a runtime dependency (`"playwright": "^1.59.1"`), but it serves two entirely different purposes:

1. **IEE browser worker** — `worker/src/browser/*.ts` uses Playwright to drive headless browsers for the `browser_task` execution path. This is agent infrastructure, not test infrastructure.
2. **`run_playwright_test` agent skill** — defined in `server/skills/run_playwright_test.md`, lets autonomous agents run Playwright tests against the **customer's** application as part of a dev task. This is again a runtime agent capability, not a test of Automation OS.

There is **no** `playwright.config.ts` at the repo root. There is **no** `e2e/` directory. There are **no** `*.spec.ts` or `*.e2e.ts` files anywhere in `server/`, `client/`, or `worker/`.

### Summary table

| Layer | Count | Technology |
|---|---|---|
| Backend runtime unit tests | 2 | tsx + ad-hoc assertions |
| Backend static gates | 24 | bash + grep |
| Backend QA spec scripts | 4 | bash + grep |
| Frontend tests (any kind) | 0 | — |
| API contract tests | 0 | — |
| E2E tests of the app | 0 | — |
| Playwright config at repo root | 0 | — |

**Net:** the team has made a deliberate bet on **heavy static analysis + minimal runtime tests**. For a rapidly-evolving codebase, this is a defensible choice — static gates don't break when behaviour changes, only when structure does.

---

## Testing philosophy observation

The existing testing investment tells a clear story that's worth making explicit:

1. **Static gates don't rot.** A `verify-async-handler.sh` script that greps for `asyncHandler` wrappers catches a real class of bug (developer forgot the wrapper on a new route) regardless of what that route does, what model it calls, or what business logic it contains. The gate passes for 100 route changes in a row until someone breaks the convention — then it fails loudly.

2. **Runtime tests rot when behaviour rots.** A unit test that asserts `processIntake()` returns `{ priority: 'high' }` under condition X becomes maintenance burden the moment the priority system changes shape. In a pre-production codebase where the priority system might get rewritten next week, the test value is negative — it slows iteration more than it catches bugs.

3. **TypeScript already catches a huge class of bugs.** The codebase is strict-mode TypeScript throughout. Type errors catch contract violations at compile time, which is effectively a test that runs on every save.

4. **Pure-function tests are the stable layer.** Pure functions rarely change signature. Testing them is cheap and the tests survive refactors. The team's `*Pure.ts` + `*.test.ts` convention is explicitly targeting this stable layer.

5. **The coverage that matters is structural, not behavioural.** In a multi-tenant SaaS with strict conventions (`asyncHandler`, `resolveSubaccount`, org-scoped queries, `failure()` from a closed enum), the bugs that reach production are overwhelmingly convention violations — a missed `where` clause, an unwrapped async route, a raw error throw. Static gates catch these better than runtime tests ever will.

**The conclusion:** the current posture isn't "under-tested". It's "tested in a way that matches the app's phase". The right move is to expand the existing philosophy, not replace it.

---

## Current-phase recommendations (rapid evolution)

The instinct behind the original question — "a full multi-phase testing environment might not be the right type for it, because we're still rapidly evolving features" — is exactly right. Here's the recommended posture for the current phase.

### Five rules

1. **Static gates stay the primary testing investment.** Cheap, fast, low-maintenance, and catches the class of regression that matters most in a rapidly-evolving codebase (structural drift). Add a new `verify-*.sh` script for every major structural change in the improvements roadmap. See action items at the bottom of this document for the specific list.

2. **Keep the `*Pure.ts` + `*.test.ts` convention for pure logic only.** Don't force a framework. Write unit tests for:
   - Anything in a `*Pure.ts` file (the team already does this).
   - Any new utility that parses, normalises, compares, or transforms data (`parseVerdict`, `extractToolIntentConfidence`, `compareTrajectory`, `topicClassifier`, `parsePlan`).
   - Specifically **not** for components that orchestrate (services, routes, middlewares) — those change too often to be worth unit-testing individually.

3. **Add exactly one runtime smoke test.** A single "agent hello world" integration test that dispatches a trivial agent run against a fixture subaccount with the LLM stubbed, walks through `preCall → preTool → postTool` middleware, and asserts the run completes with a known outcome. Runs in <5 seconds, catches catastrophic breakage immediately, near-zero maintenance because it exercises the happy path only.

4. **The P1.2 regression capture plan is the long-game test suite.** Every HITL rejection becomes a replayable test case automatically. Zero upfront investment. Compounds as the app is used. This is the opposite of ordinary testing — it's a passive learning loop where the users generate the test oracle by correcting the agents.

5. **Invest in tests that don't break when features change, skip tests that do.** This is the meta-rule. Every test decision in this phase should pass this filter.

### Three mandatory integration tests — carved-out exceptions

A small number of items in the improvements roadmap carry enough risk that the "skip integration tests" rule doesn't apply to them. These items share three traits: (a) they're hot-path behaviour changes, (b) the failure mode is silent correctness bugs, not loud crashes, and (c) the behaviour is inherently cross-component (unit tests cannot meaningfully cover it).

For these items, add integration tests — but only these, and only because they fit the filter.

| # | Test file | Sprint | Covers | Why it's an exception |
|---|---|---|---|---|
| **I1** | `rls.context-propagation.test.ts` | 2 (P1.1) | RLS execution contract across HTTP, background jobs, and admin bypass paths. Includes a deliberate no-context query to verify fail-closed behaviour. | RLS bugs are silent (zero-row queries instead of errors). Static gates can't catch propagation failures. |
| **I2** | `agentRun.crash-resume-parity.test.ts` | 3 (P2.1) | Kill-point matrix (crash at 3 different points in the loop), config-snapshot enforcement on resume, HITL async resume via pg-boss job. | Checkpoint/resume correctness can't be verified by unit tests — you need a real run. Determinism bugs here are catastrophic. |
| **I3** | `playbookBulk.parent-child-idempotency.test.ts` | 4 (P3.1) | Fan-out of bulk playbook children, child retry idempotency, parent retry idempotency, concurrency cap enforcement, partial failure handling. | Bulk dispatch has the worst failure modes in the whole roadmap (duplicate side effects on retry). Must be covered. |

**Rules for these tests:**

- Each is a single file, uses the existing tsx convention, uses `loadFixtures()` from section D.
- Each uses the LLM stub from P0.1 Layer 2 — no real LLM calls.
- Target runtime: <30 seconds per test file.
- Filenames contain `integration` so they can be filtered if runtime becomes a concern.
- They count in the total test surface (making it 14 unit tests + 8 gates + 1 smoke + **3 integration** + fixtures).

**These three are the only integration tests in the current phase.** Any additional integration test proposal must meet the same three-trait filter (hot path + silent bug + cross-component) to be in scope.

### What to explicitly skip right now

| Skip | Why |
|---|---|
| **Frontend unit tests** | React components change weekly. Unit tests become maintenance burden faster than they add safety. Rely on TypeScript + static gates. Revisit when UI stabilises per-feature. |
| **API contract tests (supertest)** | Static gates already verify route structure (`verify-async-handler.sh`, `verify-org-id-source.sh`, etc.). Runtime API tests duplicate that coverage at higher cost. Revisit when the API surface stabilises. |
| **E2E tests of the Automation OS app** | Playwright stays installed for its current two purposes (IEE browser worker, agent skill). No `e2e/` directory at the repo root until at least the MVP is stable. E2E tests against rapidly-evolving UIs are the highest-maintenance form of test. |
| **Migration safety tests** | No data to migrate (dev environment). Apply migration, iterate, move on. |
| **Performance baselines** | Performance doesn't matter at this stage. Capture baselines only when performance becomes a real concern. |
| **Load tests** | Same reason. |
| **Composition / middleware-interaction tests** | Covered structurally by static gates (`verify-middleware-pipeline-order.sh` etc.) + behaviourally by the single smoke test. |
| **Resilience / chaos tests** | The serialise-deserialise round-trip unit test for P2.1 is sufficient for the current phase. |
| **Adversarial security tests beyond static gates** | `verify-rls-coverage.sh` and `verify-scope-requirements-present.sh` are the primary defence. Penetration testing is a stabilisation-phase concern. |

Each of these is a legitimate category that a mature testing strategy would include. They are deliberately excluded from the current phase because the cost-to-value ratio is wrong for rapidly-evolving code.

---

## Later-phase recommendations (stabilisation)

### The trigger to move to Phase 2 is per-feature, not per-calendar

Don't set a calendar date. Don't wait for a release milestone. Move a feature into Phase 2 testing when **you can point at it and say "this has been stable for 4+ weeks and isn't about to change"**. Different features will cross this threshold at different times — that's fine. Phase 2 is a progressive expansion, not a flag-day transition.

Examples of features that will likely stabilise earliest:

- Auth flow (login, JWT, session management)
- Org creation and subaccount resolution
- Permission set management
- Layout / navigation shell

Examples of features that will take longer to stabilise:

- Playbook authoring (Studio is still evolving)
- Agent skill configuration
- Reporting Agent / cascading data sources (recently landed; likely to iterate)
- HITL review UX

### Phase 2 testing investments, in order

When a feature crosses the stabilisation threshold, add testing for it in this order:

1. **Frontend unit tests (React Testing Library)** for stable UI surfaces. Start with Layout, auth flows, the agent edit page — things that hardly ever change. Add MSW for API mocking at the same time.

2. **API contract tests (supertest or similar)** for stable endpoints. Start with auth, org management, subaccount resolution — the plumbing routes that hundreds of other routes depend on. These catch regressions when someone accidentally changes a response shape.

3. **Real E2E tests with Playwright against critical user flows.** Create `e2e/` at the repo root, add a `playwright.config.ts` pointed at a local dev server, write **5-10 tests** for the flows that absolutely cannot break:
   - Login
   - Creating a task on a subaccount board
   - Approving a HITL gate
   - Triggering an agent run
   - Viewing an agent run detail page

   Keep the count deliberately small. E2E tests are the most expensive tests to maintain; a large E2E suite against a living app becomes a time sink.

4. **Activate the regression suite built from P1.2 captures.** By the time Phase 2 begins, the P1.2 capture loop has been running through Phase 1 and should have dozens or hundreds of real rejection cases. Turn on the weekly cron from P1.2 and start catching regressions automatically.

5. **Frontend integration tests with MSW.** Once the API surface is stable enough that mocking it isn't a daily chore, add integration tests that exercise the full frontend data flow with mocked backends.

6. **Performance baselines.** Add baselines for the hot paths once performance actually matters:
   - `runAgenticLoop()` iterations per second
   - `policyEngineService.evaluatePolicy()` p99
   - `resolveSystemPrompt()` with memory-block merge (P4.2)
   - RLS `set_config()` overhead per request (P1.1)

7. **Consider introducing Vitest at that point** — but only if the `tsx` + static-gate pattern is actually breaking down, not because "proper testing frameworks are better". The current convention works for its job and switching costs are real. The trigger to switch: the number of `*.test.ts` files exceeds ~20, OR the tests start needing shared setup/teardown that tsx can't express cleanly.

### Phase 2 anti-recommendations

Things to still **not** build even in Phase 2:

- **100% code coverage targets.** Coverage metrics incentivise writing tests for things that don't need them.
- **Mutation testing.** Too expensive to maintain against a codebase with any logic churn.
- **Property-based testing (fast-check)** for anything except pure functions. The setup cost is too high for the payoff.
- **Visual regression tests** (Percy, Chromatic). Wait until the design system stabilises and a brand-visible bug would actually be a P0. Not before.
- **Contract tests with Pact** (or similar). Only valuable if you have multiple services owned by different teams consuming each other's APIs. Not our situation.

---

## Concrete action items for the separate ticket

This section is the actionable checklist for whoever picks up the "flesh out testing" ticket. It is scoped to the current-phase posture only — Phase 2 items are not included because they shouldn't be built yet.

### A. New static gate scripts (15 total)

Each is a new file in `scripts/verify-*.sh`, wired into `scripts/run-all-gates.sh`. Each is <30 lines of bash, single-purpose, grep-based.

| # | Gate script | Sprint | What it checks |
|---|---|---|---|
| A1 | `verify-action-registry-zod.sh` | 1 | Every entry in `server/config/actionRegistry.ts` uses Zod (`z.object`), none uses the legacy `ParameterSchema` interface shape. |
| A2 | `verify-pure-helper-convention.sh` | 1 | For every `*.test.ts` file in `**/__tests__/`, assert a sibling `*Pure.ts` file exists and is imported. Prevents drift from the convention. |
| A3 | `verify-idempotency-strategy-declared.sh` | 1 | Every `ACTION_REGISTRY` entry declares `idempotencyStrategy: 'read_only' \| 'keyed_write' \| 'locked'`. Enforces the Execution Model contract (every side-effecting handler must declare how it stays safe under retry). |
| A4 | `verify-rls-coverage.sh` | 2 | For every protected table listed in `server/config/rlsProtectedTables.ts`, assert a `CREATE POLICY` statement exists in `migrations/*.sql`. Fails CI if a new protected table is added without an RLS policy. |
| A5 | `verify-rls-contract-compliance.sh` | 2 | No raw `db.select(...)` / `db.insert(...)` calls exist outside services or outside the ALS wrapper. Enforces Layer A of the RLS execution contract. |
| A6 | `verify-scope-assertion-callsites.sh` | 2 | For every known retrieval boundary (runContextLoader, workspaceMemoryService, taskAttachmentContextService, etc.), assert the file contains a call to `assertScope(`. Prevents new retrieval code from skipping the assertion. |
| A7 | `verify-pretool-middleware-registered.sh` | 2 | Assert `actionService.proposeAction` is called from exactly one place — the `preTool` middleware in `agentExecutionService.ts`. Fails if any per-case callsite reappears in `skillExecutor.ts`. |
| A8 | `verify-job-idempotency-keys.sh` | 2 | Every new `boss.send('...')` call includes a `singletonKey` option. Enforces the job idempotency contract from the cross-cutting idempotency section. |
| A9 | `verify-reflection-middleware-registered.sh` | 3 | Assert `reflectionLoopMiddleware` is registered in `pipeline.postTool` in `agentExecutionService.ts`. |
| A10 | `verify-middleware-state-serialised.sh` | 3 | Assert every field on the `MiddlewareContext` runtime type has a matching field on `SerialisableMiddlewareContext` (or is marked `// ephemeral:` with a comment). Enforces Rule 2 of the checkpoint persistence contract — no middleware state is recomputed on resume. |
| A11 | `verify-run-state-source-of-truth.sh` | 3 | No new code reads `agent_run_snapshots.toolCallsLog` directly except the one allow-listed debug UI file. Prevents drift between `toolCallsLog` and `agent_run_messages` during the deprecation window. |
| A12 | `verify-playbook-run-mode-enforced.sh` | 4 | Assert `playbookEngineService` branches on `runMode` per tick — grep for the four mode constants (`auto`, `supervised`, `background`, `bulk`). |
| A13 | `verify-critique-gate-shadow-only.sh` | 5 | Assert `CRITIQUE_GATE_SHADOW_MODE = true` in `limits.ts` AND no callsite in `agentExecutionService.ts` routes agent behaviour based on the gate result (gate writes telemetry only). |
| A14 | `verify-confidence-escape-hatch-wired.sh` | 5 | Assert the `preTool` middleware contains the confidence escape-hatch branch, `MIN_TOOL_ACTION_CONFIDENCE` is declared in `limits.ts`, and `blocked_by: 'low_confidence'` is in the `ask_clarifying_question` skill's parameter schema. |
| A15 | `verify-universal-skills-preserved.sh` | 5 | Assert every `preCall`/`preTool`/`postCall`/`postTool` middleware that mutates `activeTools` does so via the `mutateActiveToolsPreservingUniversal()` helper. Raw mutation (direct `activeTools = activeTools.filter(...)`) is blocked. Also asserts `SerialisableMiddlewareContext` does not contain an `activeTools` field. Enforces the universal-skill runtime invariant — prevents a subtle class of bugs where a future middleware silently drops the recovery path. |

**Protected tables list for A4** (derived from `server/config/rlsProtectedTables.ts` manifest, maintained per the "RLS policy ships with CREATE TABLE" rule): `tasks`, `actions`, `agent_runs`, `agent_run_snapshots`, `agent_run_messages`, `review_items`, `review_audit_records`, `workspace_memories`, `llm_requests`, `task_activities`, `task_deliverables`, `audit_events`, `tool_call_security_events`, `regression_cases`, `memory_blocks`, `memory_block_attachments`.

The list grew from 11 to 16 across the roadmap. New protected tables added in later sprints (`agent_run_messages`, `tool_call_security_events`, `regression_cases`, `memory_blocks`, `memory_block_attachments`) each ship their RLS policy atomically with their CREATE TABLE per the sequencing rule in P2.1.

### B. New runtime unit test files (11 total)

Follow the existing `*Pure.ts` + `*.test.ts` convention. Each file is runnable via `tsx <path>` and will be wired into a new `npm run test:unit` script that discovers all `**/__tests__/*.test.ts` files.

| # | Test file | Companion pure module | Tests |
|---|---|---|---|
| B1 | `server/services/__tests__/agentExecutionService.phase.test.ts` | `agentExecutionServicePure.ts` (extracted in P0.1 Layer 3) | `selectExecutionPhase(iteration, previousResponseHadToolCalls, totalToolCalls)` returns the right phase for each boundary condition. |
| B2 | `server/services/__tests__/agentExecutionService.validateToolCalls.test.ts` | Same | `validateToolCalls` catches: unknown tool name, missing required field, invalid input shape, extra fields (warn-only). |
| B3 | `server/services/__tests__/agentExecutionService.middlewareContext.test.ts` | Same | `buildMiddlewareContext(...)` constructs the expected shape from loop params. |
| B4 | `server/config/__tests__/actionRegistry.test.ts` | `actionRegistry.ts` directly | Every `ACTION_REGISTRY` entry parses as Zod, has valid `defaultGateLevel`, has `actionCategory` in the closed set. Adds one assertion per entry. |
| B5 | `server/lib/__tests__/scopeAssertion.test.ts` | `scopeAssertion.ts` | `assertScope()` passes on matching org/subaccount, throws `scope_violation` on mismatch, handles nullable subaccountId correctly. |
| B6 | `server/services/__tests__/regressionCapture.test.ts` | `regressionCaptureService.ts` pure helpers | `captureFromAuditRecord()` is idempotent, skips approvals, captures rejections + edits with the right shape. |
| B7 | `server/services/__tests__/agentExecutionService.checkpoint.test.ts` | Pure helpers in `agentExecutionServicePure.ts` | `serialiseMiddlewareContext()` → `deserialiseMiddlewareContext()` round-trip produces byte-equal output. |
| B8 | `server/services/middleware/__tests__/reflectionLoopPure.test.ts` | `reflectionLoopPure.ts` | `parseVerdict()` handles valid `APPROVE` / `BLOCKED` / malformed / missing verdict cases. |
| B9 | `server/services/__tests__/agentExecutionService.toolIntent.test.ts` | `agentExecutionServicePure.ts` | `extractToolIntentConfidence(messages, toolName)` returns the right confidence for various conversation shapes. |
| B10 | `server/services/__tests__/trajectoryServicePure.test.ts` | `trajectoryServicePure.ts` | `compare()` for each match mode (`exact`, `in-order`, `any-order`, `single-tool`), `argMatchers` partial equality. |
| B11 | `server/services/__tests__/topicClassifier.test.ts` | `topicClassifierPure.ts` | Keyword rules return the right topics for a corpus of representative user messages. Low-confidence input falls back to "no filter". |

Additional candidates (not counted in the 11 but worth adding if the implementer picks the relevant items):

- `plan.test.ts` for `parsePlan()` and `isComplexRun()` from P4.3
- `critiqueGatePure.test.ts` for the critique result parser from P4.4

### C. The one runtime smoke test

**File:** `server/services/__tests__/agentExecution.smoke.test.ts`

**Sprint:** created in Sprint 1 once the P0.1 LLM stub is in place. Updated in each subsequent sprint to add one line of new-behaviour coverage.

**What it does:**

1. Loads fixtures (see section D below).
2. Creates an LLM stub that returns one canned response: a tool call to `read_workspace` followed by a `done`.
3. Dispatches an agent run against the fixture subaccount.
4. Walks through `preCall → preTool → postTool` middleware.
5. Asserts:
   - Run reaches `completed`
   - All middleware phases ran in the expected order
   - No scope violations
   - No uncaught errors
   - `actions` table has the expected row for the tool call

**Target runtime:** <5 seconds.

**Maintenance posture:** the smoke test exercises the happy path only. When a middleware phase is added (e.g. Sprint 3 adds reflection, Sprint 5 adds critique gate), add one assertion to the smoke test. Do not add failure-case coverage to this test — failure cases are covered by the per-item unit tests.

### D. Minimal fixture set

**Location:** `server/services/__tests__/fixtures/`

**Loader:** `server/services/__tests__/fixtures/loadFixtures.ts` exports a single `loadFixtures()` function that the smoke test and any cross-item test can call.

**Contents:**

| Fixture | ID | Notes |
|---|---|---|
| Organisation | `fixture-org-001` | The only org fixture. |
| Subaccount | `fixture-sub-001` | Primary fixture subaccount. |
| Subaccount | `fixture-sub-002` | Second subaccount so cross-tenant tests are possible. |
| Agent | `fixture-agent-001` | One agent definition. |
| Subaccount agent link | `fixture-link-001` | `fixture-agent-001` linked to `fixture-sub-001`. |
| Subaccount agent link | `fixture-link-002` | Same agent linked to `fixture-sub-002` (for shared memory block tests in P4.2). |
| Task | `fixture-task-001` | One task on `fixture-sub-001`. |
| `review_code` output — APPROVE | `fixture-review-approve.txt` | For `parseVerdict` happy path. |
| `review_code` output — BLOCKED | `fixture-review-blocked.txt` | For `parseVerdict` block path. |
| `review_code` output — malformed | `fixture-review-malformed.txt` | For `parseVerdict` degrade path. |

**Not fixture'd:** LLM request/response recordings. Tests that need LLM output use the stub from P0.1 Layer 2 and inject the response inline.

### E. The `npm run test:unit` wiring

**File:** `scripts/run-all-unit-tests.sh`

**Behaviour:** discovers all `**/__tests__/*.test.ts` files, runs each via `tsx`, aggregates results, exits non-zero on any failure.

**Package.json additions:**
```json
"test:unit": "bash scripts/run-all-unit-tests.sh",
"test": "npm run test:gates && npm run test:qa && npm run test:unit"
```

**Why a bash discovery script and not a JS test runner?** Consistency with the existing `test:gates` / `test:qa` pattern. The team already has a "one bash script discovers and runs everything" convention — don't introduce a second pattern.

### F. Total test surface added

| Kind | Count |
|---|---|
| New static gates | 15 |
| New unit test files | 11 |
| New integration tests (I1-I3) | 3 |
| New smoke tests | 1 |
| New fixture files | ~10 |
| New bash runners | 1 (`run-all-unit-tests.sh`) |
| New npm scripts | 1 (`test:unit`) |
| P1.2 regression capture (passive, grows with usage) | 1 pipeline |

**Total new files in the testing layer:** ~42 (15 gates + 11 unit tests + 3 integration tests + 1 smoke test + ~10 fixtures + 1 bash runner + 1 npm script change). All follow existing conventions. No new frameworks. No new dependencies beyond what's already in `package.json`.

---

## Summary

The current testing posture (static-heavy, runtime-light) is the right shape for a rapidly-evolving pre-production codebase. This document recommends expanding that posture in a narrow, targeted way rather than switching to a full multi-level testing environment prematurely.

The "proper" multi-level testing environment (frontend unit + API contract + E2E + regression + performance + visual) is absolutely the right target — but the trigger to start building it is **per-feature stabilisation**, not **calendar time or release milestones**. Move features into Phase 2 testing as they individually settle down, and keep the rapid-evolution posture for everything still evolving.

**When this document is outdated:** when the first 3-5 features have been stable for 4+ weeks AND the `tsx` + static-gate convention starts showing genuine strain (>20 test files, shared setup needed, test runtime > 30s). At that point, this document gets superseded by a Phase 2 testing plan.



