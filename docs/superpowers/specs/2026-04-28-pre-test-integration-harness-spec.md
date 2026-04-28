# Pre-Test Integration Test Harness — Spec

**Created:** 2026-04-28
**Status:** draft (ready for spec-reviewer)
**Source backlog:** `tasks/todo.md` (post-merge audit triage of pre-test-backend-hardening + pre-test-brief-and-ux review pipelines, 2026-04-28 session)
**Predecessor specs:**
- `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md` (merged via PR #223)
- `docs/superpowers/specs/2026-04-28-pre-test-brief-and-ux-spec.md` (merged via PR #222)

---

## Contents

- [§0 Why this spec exists](#0-why-this-spec-exists)
  - [§0.1 Framing assumptions](#01-framing-assumptions)
  - [§0.2 Testing posture](#02-testing-posture)
  - [§0.3 No new primitives unless named](#03-no-new-primitives-unless-named)
  - [§0.4 Scope boundary](#04-scope-boundary)
- [§1 Items](#1-items)
  - [§1.1 Fake-webhook receiver harness](#11-fake-webhook-receiver-harness)
  - [§1.2 Fake-provider adapter harness](#12-fake-provider-adapter-harness)
  - [§1.3 Convert `llmRouterLaelIntegration.test.ts` stubs to real assertions](#13-convert-llmrouterlaelintegrationtestts-stubs-to-real-assertions)
  - [§1.4 Convert `workflowEngineApprovalResumeDispatch.integration.test.ts` stubs to real assertions](#14-convert-workflowengineapprovalresumedispatchintegrationtestts-stubs-to-real-assertions)
  - [§1.5 Decision — Failure-path `agent_run_llm_payloads` row (REQ §1.1 Gap D)](#15-decision--failure-path-agent_run_llm_payloads-row-req-11-gap-d)
  - [§1.6 Decision — `AutomationStepError` shape (REQ §1.2 Gap B)](#16-decision--automationsteperror-shape-req-12-gap-b)
- [§2 Sequencing](#2-sequencing)
- [§3 Out of scope](#3-out-of-scope)
- [§4 Definition of Done](#4-definition-of-done)
- [§5 Tracking](#5-tracking)

---

## §0 Why this spec exists

The two pre-test specs (backend-hardening + brief-and-ux) shipped via the full review pipeline. Spec-conformance and ChatGPT PR review both surfaced the same gap: **the integration tests for the two architecturally significant items in Spec 1 are stubs**.

- `server/services/__tests__/llmRouterLaelIntegration.test.ts` — 3 cases, all `test.skip` with `assert.ok(true, 'TODO: implement with test DB harness')`. Covers the LAEL-P1-1 emission ordering, `budget_blocked` silence, and non-agent-run silence invariants — the safety properties LAEL-P1-1 was specifically designed to enforce.
- `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts` — 3 cases, all `test.skip`. Covers the supervised-`invoke_automation` dispatch invariant, including the **call-count assertion the spec specifically demanded** ("a double-approve … results in exactly one webhook dispatch, asserted by direct call-count on the test webhook receiver — NOT inferred from terminal status alone").

CI is green; the stubs pass trivially. **The two most architecturally significant items in the pre-test backend hardening spec ship without automated regression coverage.**

The follow-up was named in `tasks/todo.md § Deferred from chatgpt-pr-review — pre-test-backend-hardening (2026-04-28)`:

> **LAEL + approval-resume integration test harness — convert deferred `test.skip` stubs to real assertions**
> Build the shared fake-webhook receiver + fake-provider adapter as the next chunk after this PR merges. Convert the six skipped tests to real assertions exercising the real DB transaction boundaries.

This spec ships that follow-up — plus two small either-way decisions (REQ §1.1 Gap D failure-path payload row, REQ §1.2 Gap B `AutomationStepError` shape) that affect what the integration tests assert. Bundling them avoids re-opening the integration tests after the decisions land.

**Why before testing specifically.** Without the integration tests, any regression in `llmRouter` emission or `decideApproval` dispatch silently breaks during the testing round. The failure modes — "missing observability event", "ghost webhook fire" — are not always visible to a tester running through user flows. The integration tests are the safety net that makes those failure modes loud.

### §0.1 Framing assumptions

Imported from `docs/spec-context.md`:

- **Pre-production.** Backwards compatibility shims, feature flags, and migration windows are not required.
- **Rapid evolution.** Prefer simple, deterministic implementations over abstractions designed for hypothetical reuse.
- **No feature flags.** Test-only behaviour is gated by the test runner itself, not by env vars in production code.
- **Prefer existing primitives.** `tryEmitAgentEvent`, `agentRunPayloadWriter.buildPayloadRow`, `shouldEmitLaelLifecycle`, `decideApproval`, `dispatchInvokeAutomationInternal`, `incrementProcessLocalFailureCounter`, the existing `*PostCommit.integration.test.ts` patterns, and the existing test-DB connection helper used by `hermesTier1Integration.test.ts` already exist. This spec consumes them; it does not introduce parallel abstractions.

### §0.2 Testing posture

Per `docs/spec-context.md` and the carve-out documented in the predecessor specs:

- **Carved-out integration tests** are the explicit purpose of this spec. The carve-out covers RLS, idempotency / concurrency control, and crash-resume parity — the LAEL emission ordering AND the approval-resume one-webhook-on-double-approve invariants both sit inside it.
- **No new test runner or harness framework.** Use `node:test` + `node:assert` plus the existing test-DB connection. The two new harness modules (§1.1, §1.2) are thin shared fixtures, not a new framework.
- **No mocking framework.** Spies via `mock.method` (matches existing convention). The fake-webhook receiver is a real Express-or-equivalent server bound to localhost; the fake-provider adapter is a function value passed where a real adapter would be. Both are explicit code, not magic mocks.
- **Tests must exercise real DB transaction boundaries.** A failing tx must actually fail; a budget-blocked path must actually take the early-return; a contested-key catch must actually catch. Tests that "simulate" these via `if (testMode)` branches in production code are explicitly forbidden by §0.3.
- **DB isolation invariant (mandatory).** Per-test `runId` + `afterEach` cleanup is necessary but not sufficient. Every integration test in §1.3 / §1.4 MUST satisfy ONE of:
  1. **Tx rollback wrapper.** All DB writes the test triggers occur inside a single transaction the test starts and rolls back at end. (Preferred where the production code under test does not require post-commit visibility — e.g. tests that don't depend on a commit-side trigger or job-pickup boundary.)
  2. **Hard-scoping-key + pre-test cleanup guard.** Where (1) is not viable (production code commits its own tx, the test depends on post-commit observable state, etc.), every test query MUST be scoped by a unique-per-test scoping key (`runId` for §1.3, `workflow_run_id` for §1.4) AND the test MUST run a pre-test cleanup pass against shared tables (`agent_execution_events`, `agent_run_llm_payloads`, `cost_aggregates`, `workflow_step_runs`, `workflow_runs`, `automations`, plus the ledger `llm_requests_all`) deleting any rows matching the test's scoping key BEFORE the test body runs. The pre-test guard is what makes a poisoned prior run recoverable without manual DB reset.
- **Suite-rerun idempotency.** Running the full integration suite twice in the same DB without manual reset MUST produce identical results. This is an explicit acceptance criterion enforced via the §2 pre-merge gates.

### §0.3 No new primitives unless named

No item in §1 may introduce a new abstraction, helper module, primitive, or system-level pattern unless that primitive is **explicitly named in the item's Files list and Approach section**. This rule mirrors the predecessor specs' §0.3 rule.

Concrete consequences:
- §1.1 names exactly one new harness file (`server/services/__tests__/fixtures/fakeWebhookReceiver.ts`). No additional helpers may emerge.
- §1.2 names exactly one new harness file (`server/services/__tests__/fixtures/fakeProviderAdapter.ts`) plus a way to inject it (see §1.2 step 3 — uses an existing adapter-registry hook, not a new one).
- §1.3 and §1.4 modify only the two existing stub test files.
- §1.5 names exactly one production-code change point in `llmRouter.ts` (the failure-path branch at line ~1265). No new "failure-path-payload-builder" abstraction; the existing `buildPayloadRow` is reused with a partial-response argument.
- §1.6 names exactly one type definition (`server/lib/workflow/types.ts:79`) and a finite caller-site update list. No "structured-error-context" framework.

If implementation surfaces a need for a primitive not named here, **stop, log to `tasks/todo.md`, and ship the item against its stated scope only**.

### §0.4 Scope boundary

Items explicitly inside scope:
1. The two harness modules (§1.1, §1.2).
2. Conversion of the six existing stub tests to real assertions (§1.3, §1.4).
3. Two small decisions that affect what those tests assert (§1.5, §1.6).

Items explicitly **outside** scope (route to follow-up if needed):
- Any other deferred item from the pre-test predecessor specs' review tails (manual smoke recordings, KNOWLEDGE.md entries, log prefix standardisation, error banner state-type upgrades, runtime branching guards, middleware ordering tags). Those are housekeeping; tracked separately under their own todo.md sections.
- Any item from the codebase-audit-followups spec, paperclip-hierarchy follow-ups, riley-observations follow-ups, etc.
- Pre-existing fragility (cachedSystemMonitorAgentId per-org cache, server cycle count, etc.).

This spec is **single-session, single-PR, no concurrency** with other in-flight work. The harness files are new (no merge conflicts); the stub conversions touch only the two integration test files; the decisions touch a tightly-scoped set of files. Estimated effort: 1–1.5 days.

---

## §1 Items

### §1.1 Fake-webhook receiver harness

**Source.** `tasks/todo.md § Deferred from chatgpt-pr-review — pre-test-backend-hardening (2026-04-28)` → "LAEL + approval-resume integration test harness". Required by §1.4.

**Files.**
- `server/services/__tests__/fixtures/fakeWebhookReceiver.ts` (NEW — shared test harness module).
- `server/services/__tests__/fixtures/__tests__/fakeWebhookReceiver.test.ts` (NEW — self-test for the harness itself).

**Goal.** A reusable test harness that boots a localhost HTTP server, records every request that arrives at it, and exposes the recorded calls for direct assertion. Multiple integration tests must be able to spin one up, exercise production code that fires webhooks at it, and assert on the captured calls.

**Approach.**
1. **Shape.** Export a single factory function:
   ```ts
   // server/services/__tests__/fixtures/fakeWebhookReceiver.ts
   export interface FakeWebhookCall {
     receivedAt: Date;
     method: string;
     path: string;
     headers: Record<string, string>;
     body: unknown;
   }

   export interface FakeWebhookReceiver {
     readonly url: string;             // e.g. http://127.0.0.1:54321
     readonly calls: readonly FakeWebhookCall[];
     readonly callCount: number;
     setStatusCode(status: number): void;  // for testing 4xx/5xx response paths
     setResponseBody(body: unknown): void;
     setLatencyMs(ms: number): void;       // simulate slow webhook (timeout tests)
     setDropConnection(drop: boolean): void; // close socket without responding (timeout / connection-reset tests)
     reset(): void;                         // clear calls + reset overrides
     close(): Promise<void>;
   }

   export async function startFakeWebhookReceiver(): Promise<FakeWebhookReceiver>;
   ```
2. **Implementation.** Use Node's built-in `node:http` server bound to `127.0.0.1` on port `0` (let the OS assign a free port — return the resolved port in `url`). Every incoming request:
   - Reads the body (`Buffer.concat` on `data` events; JSON-parse if `Content-Type: application/json`, otherwise pass through as Buffer).
   - Pushes a `FakeWebhookCall` onto the internal array (the call is recorded BEFORE any drop / latency decision — testers must always be able to assert "the request reached us" even if the response was dropped).
   - If `dropConnection === true`, destroy the underlying socket without writing a response (simulates connection reset / mid-flight timeout). The recorded call still appears in `receiver.calls`.
   - Otherwise: waits `latencyMs` if set, then responds with the configured status code (default 200) and response body (default `{ ok: true }`).
3. **Lifecycle.** Tests call `startFakeWebhookReceiver()` in `before` / `beforeEach` and `await receiver.close()` in `after` / `afterEach`. The harness MUST handle `close()` while a request is in-flight without unhandled-promise warnings (use `server.close(callback)` and resolve once the callback fires).
4. **Concurrency safety.** Two tests running in parallel each get their own receiver on a different OS-assigned port. The harness does NOT share state across instances — the `calls` array is per-receiver.
5. **No production-code coupling.** The harness file lives under `server/services/__tests__/fixtures/`, NOT under `server/lib/`. Production code MUST NOT import from `__tests__/`. Confirmed by gate: existing `scripts/verify-no-test-imports.sh` already covers this if present; if not, this spec does not introduce a new gate (out of §0.3).
6. **Self-test.** A small test file exercises the harness contract: start receiver → POST a request via `fetch(receiver.url + '/anything', {...})` → assert `receiver.calls` has the request. Set status 500, repeat, assert client received 500. Set latencyMs 100, repeat, assert request completes after >= 100ms. Call `setDropConnection(true)`, POST, assert the client-side `fetch` rejects (connection reset / network error) AND `receiver.calls` still records the request. Toggle `setDropConnection(false)`, POST, assert response received normally. Reset, assert calls empty AND drop flag cleared.

**Acceptance criteria.**
- `startFakeWebhookReceiver()` returns a receiver bound to a free localhost port; multiple concurrent receivers each get a different port.
- A POST to the receiver's URL appears in `receiver.calls` with method, path, headers, parsed body.
- `setStatusCode(500)` causes subsequent responses to be 500.
- `setLatencyMs(100)` causes responses to delay ~100ms.
- `setDropConnection(true)` causes subsequent requests to record the call but receive no response (socket destroyed before response write); client sees a network-error-class rejection. `setDropConnection(false)` returns to normal response behaviour.
- `reset()` clears calls and reverts overrides (status, latency, body, drop-connection).
- `close()` releases the port; a subsequent `startFakeWebhookReceiver()` can reuse it (verified by acquiring a receiver on the same port — the OS may not assign the same port, but the close MUST not leak).
- Self-test passes deterministically (no flake on 5 reruns).

**Tests.** The harness self-test described in step 6 is the test. No additional pure tests required — the harness is itself only used by tests.

**Dependencies.** None beyond Node stdlib (`node:http`).

**Risk.** Low. New isolated test file; no production code touched.

**Definition of Done.** Self-test green on first run AND 5 reruns; harness exported with the documented surface; `tasks/todo.md` § "LAEL + approval-resume integration test harness" line annotated with this commit's SHA.

---

### §1.2 Fake-provider adapter harness

**Source.** Same as §1.1. Required by §1.3.

**Files.**
- `server/services/__tests__/fixtures/fakeProviderAdapter.ts` (NEW — shared test harness module).
- `server/services/__tests__/fixtures/__tests__/fakeProviderAdapter.test.ts` (NEW — self-test).

**Goal.** A reusable test harness that produces a `LlmAdapter`-compatible function value with configurable response, latency, error, and call-recording. Multiple integration tests must be able to instantiate one, register it via the existing adapter-registry mechanism, exercise production code that calls LLM providers, and assert on the captured invocations.

**Approach.**
1. **Shape.**
   ```ts
   // server/services/__tests__/fixtures/fakeProviderAdapter.ts
   import type { ProviderAdapter, ProviderCallArgs, ProviderCallResult } from '../../providers/types.js';

   export interface FakeProviderCall {
     receivedAt: Date;
     args: ProviderCallArgs;
   }

   export interface FakeProviderAdapter extends ProviderAdapter {
     readonly calls: readonly FakeProviderCall[];
     readonly callCount: number;
     setResponse(response: ProviderCallResult): void;
     setError(error: Error): void;          // next call rejects with this
     setLatencyMs(ms: number): void;
     reset(): void;
   }

   export function createFakeProviderAdapter(opts?: {
     defaultResponse?: ProviderCallResult;
   }): FakeProviderAdapter;
   ```
2. **Default response.** When `setResponse` / `setError` are not called, the adapter returns a deterministic stub response with token counts populated (so cost calculations downstream produce non-zero values testers can assert against). The defaults match the shape `llmRouter` expects to land in the terminal-write tx — system prompt echo back, one assistant message, `tokensIn: 100, tokensOut: 50`, no tool calls.
3. **Registration (scoped + reversible — no reliance on unique keys).** The existing adapter registry in `server/services/providers/registry.ts` exposes a registration function (verify the exact name when implementing). The contract is:
   - `registerProviderAdapter(key, adapter)` MUST capture the previous adapter at `key` (if any) and return a `restore()` function. `restore()` MUST put the registry back to **exactly** the prior state at `key` — if there was a previous adapter, restore it; if there was none, delete the key. `restore()` MUST be idempotent (calling it twice is a no-op the second time).
   - Tests MUST always call `restore()` in `finally` (NOT just on the happy path). This makes registration scoped + reversible regardless of which provider key the test uses.
   - With this contract, the rule is **NOT** "tests must use distinct provider keys" — same-key sequential AND same-key parallel tests must not interfere as long as each test's registration is bracketed by its own `restore()` in `finally`.
   ```ts
   const fakeAdapter = createFakeProviderAdapter();
   const restore = registerProviderAdapter('fake-test-provider', fakeAdapter);
   try {
     // exercise production code that routes to 'fake-test-provider'
   } finally {
     restore();  // restores the EXACT prior state at this key (previous adapter, or absent)
   }
   ```
   If the registry does not expose a clean register/unregister API matching this contract, this spec adds the minimum API needed (named in the §0.3 file list above). Do NOT introduce a new "provider injection framework"; the bare add/remove pair with prior-state capture is sufficient.
4. **Concurrency safety.** Each `createFakeProviderAdapter()` call returns a fresh instance with its own `calls` array. Combined with step 3's prior-state-capture contract, two tests using the SAME provider key (sequentially or in parallel) MUST NOT interfere — each test's `restore()` undoes its own registration without depending on key uniqueness. Document the restore-in-finally contract in the harness file's JSDoc.
5. **No production-code coupling.** Same as §1.1 — the harness lives under `__tests__/fixtures/`. The production-side change is bounded to the registry's add/remove API if needed.
6. **Self-test.** Exercises: default-response path, `setResponse` override, `setError` rejects on next call, `setLatencyMs` delays, `reset` clears calls and overrides, registry add/remove preserves prior state.

**Acceptance criteria.**
- `createFakeProviderAdapter()` returns an adapter with the documented surface.
- A call routed via the registry to the fake adapter records the invocation in `adapter.calls`.
- `setError(new Error('boom'))` causes the next adapter call to reject with that error; subsequent calls return the default response again (one-shot, NOT sticky — tests should call `setError` per scenario).
- `setLatencyMs(50)` makes the next call take >= 50ms.
- `reset()` clears `calls` AND any pending `setResponse` / `setError` / `setLatencyMs` overrides.
- Registering and un-registering does not leak state into subsequent tests (verified by self-test that creates two adapters in sequence under the same provider key, asserts the second sees zero calls when the first's were 3).
- **Same-key non-interference.** Two tests using the SAME provider key (sequentially OR in parallel) do not interfere — verified by a self-test that registers adapter A, exercises it (3 calls), restores, then registers adapter B at the same key and exercises it; B's `calls.length === <B-only count>` and the registry returns to its pre-A state after both restores. A second self-test variant uses `Promise.all` to register/exercise/restore two different adapters at the same key concurrently and asserts each sees only its own calls.
- **Restore exactness.** If the key was unbound before `register()`, after `restore()` the key is unbound (NOT bound to undefined or to a sentinel). If the key was bound to a prior adapter, after `restore()` the key is bound to exactly that prior adapter (verified by registering A, then registering B over A, then calling B's restore — A is callable again).
- **Restore idempotency.** Calling `restore()` twice in succession is a no-op the second time (does not throw, does not re-restore stale state).

**Tests.** Self-test described in step 6 is the test.

**Dependencies.** Existing `ProviderAdapter` type from `server/services/providers/types.ts`. Existing registry from `registry.ts` (verify the exact register/unregister surface during implementation; if missing, add the minimum named in step 3).

**Risk.** Low-medium. Touches the provider registry — risk that production code paths inadvertently pick up the fake provider in non-test environments. Mitigation: registry add/remove is a function call, not a config file; the fake provider can ONLY be registered from test code that imports the harness. The `verify-no-test-imports.sh` discipline (or equivalent) prevents production code from importing the harness.

**Definition of Done.** Self-test green on first run AND 5 reruns; harness exported with the documented surface; registry add/remove API is callable from tests without touching env vars or config files.

---

### §1.3 Convert `llmRouterLaelIntegration.test.ts` stubs to real assertions

**Source.** `tasks/todo.md § Deferred from spec-conformance review — pre-test-backend-hardening` → REQ §1.1 Gap F.

**Files.**
- `server/services/__tests__/llmRouterLaelIntegration.test.ts` (existing — 3 stubs to convert).
- Test-DB connection helper used by `hermesTier1Integration.test.ts` (read-only consume — locate exact import path during implementation).
- `server/services/__tests__/fixtures/fakeProviderAdapter.ts` (consumer — built in §1.2).

**Goal.** Replace the three `test.skip` stubs with assertions that exercise the real `llmRouter.routeCall` code path against a real test DB, using the fake provider adapter from §1.2. Each test verifies one acceptance criterion from the predecessor spec's §1.1.

**Approach.**
1. **Test 1 — happy-path agent-run emission.**
   - Setup: register fake provider with default response (200 tokens, no errors). Create an `agent_runs` row in the test DB with a known `runId`. Construct a `ProviderCallContext` with `sourceType: 'agent_run'`, the runId, a known `organisationId` and `subaccountId`.
   - Act: invoke `llmRouter.routeCall(...)` against the fake provider.
   - Assert (in order):
     - `agent_execution_events` table has a row with `event_type = 'llm.requested'`, `run_id` matching, ledger row id non-null, sequence number N.
     - `agent_execution_events` has a subsequent row with `event_type = 'llm.completed'`, `run_id` matching, sequence number N+1, terminal status `'success'`, `payloadRowId` non-null.
     - **No interleaving invariant.** Between the `llm.requested` row (sequence N) and the `llm.completed` row (sequence N+1) for this `run_id`, no other `llm.*` event rows exist for the same `run_id`. Asserted as: query `agent_execution_events` for this run_id with `event_type LIKE 'llm.%'` ordered by sequence, expect exactly two rows in [requested, completed] order. This protects against future sequence-generation changes where `N+1` arithmetic could pass coincidentally while another `llm.*` event slips between them.
     - `agent_run_llm_payloads` has exactly one row with `run_id` matching and the same `id` as the `payloadRowId` referenced in the `llm.completed` event payload.
     - The `llm_requests_all` ledger has the corresponding success row.
   - Cleanup: clear the four tables for that runId via `assertNoRowsForRunId(runId, [...])`; un-register the fake provider.
2. **Test 2 — `budget_blocked` silence.**
   - Setup: register a fake provider, but configure the run's budget breaker to refuse the call (set up the `cost_aggregates` and `agent_runs.maxCostCents` rows in test DB to put the run into `budget_blocked` state before dispatch).
   - Act: invoke `llmRouter.routeCall(...)`.
   - Assert:
     - The ledger row for this call has status `'budget_blocked'` (existing behaviour).
     - **Zero rows** in `agent_execution_events` for this runId with `event_type IN ('llm.requested', 'llm.completed')`.
     - **Zero rows** in `agent_run_llm_payloads` for this runId.
     - Fake provider's `callCount === 0` (the adapter was never reached).
3. **Test 3 — non-agent-run silence.**
   - Setup: register fake provider. Construct a `ProviderCallContext` with `sourceType: 'slack'` (or `'whisper'` — whichever non-agent source is exercised in production).
   - Act: invoke `llmRouter.routeCall(...)`.
   - Assert:
     - Fake provider's `callCount === 1` (the call went through).
     - **Zero rows** in `agent_execution_events` (no `runId` to scope by, but no agent-run rows should appear regardless).
     - **Zero rows** in `agent_run_llm_payloads`.
     - The ledger row exists with the appropriate `source_type`.
4. **Test isolation (per §0.2 DB isolation invariant).** Each test creates its own `runId` (via `crypto.randomUUID()`) and uses it as the hard scoping key. Because `llmRouter.routeCall` commits its own internal tx (the success path's terminal-write tx) the tests use scope variant (2) of the §0.2 invariant: hard-scoping-key + pre-test cleanup guard.
   - **Pre-test guard.** Each test, in `beforeEach`, runs `assertNoRowsForRunId(runId)` (helper defined in step 4a below) against the four shared tables (`agent_execution_events`, `agent_run_llm_payloads`, `llm_requests_all`, `cost_aggregates`) — if any rows exist for this `runId`, delete them before the test body runs. This makes a poisoned prior run recoverable.
   - **Cleanup.** `afterEach` runs the same delete pass and asserts zero rows for the runId after delete (catches FK-cascade failures or rows that escape scope).
   - Wrap setup + assertions in try/finally so cleanup runs even if assertions fail.
4a. **Cleanup helper.** Add a small helper, co-located with the existing test-DB harness, with the following surface (no new abstraction module — inline next to existing helpers):
   ```ts
   // Co-located with the existing test-DB harness used by hermesTier1Integration.test.ts.
   // Asserts zero rows for the given runId across the named tables; deletes if rows exist.
   // Throws if delete fails or if rows remain after delete (indicates an FK or scope leak).
   async function assertNoRowsForRunId(
     runId: string,
     tables: ReadonlyArray<'agent_execution_events' | 'agent_run_llm_payloads' | 'llm_requests_all' | 'cost_aggregates'>,
   ): Promise<void>;
   ```
   The helper is the only place these queries are written — tests MUST NOT inline ad-hoc cleanup queries (prevents copy-paste drift across tests). For §1.4 the helper accepts `'workflow_step_runs' | 'workflow_runs' | 'automations'` instead.
5. **DB harness reuse.** Match the connection-and-cleanup pattern from `hermesTier1Integration.test.ts`. Do NOT introduce a new test-DB primitive. If the existing harness lacks something needed (e.g. seeding helpers for `agent_runs`), the spec allows extending it inline — but the extension must stay in the existing harness file, not spawn a new abstraction.
6. **DB requirement.** Tests assume a test DB exists and is accessible via the standard `DATABASE_URL` for tests. The npm script that runs the integration suite (locate during implementation — likely already set up via `pgboss-zod-hardening` work) handles connection setup. This spec does NOT introduce new DB-bootstrap tooling.

**Acceptance criteria.**
- All three tests pass against a clean test DB on first run AND 5 reruns.
- Each test cleans up its own rows (verifiable by running the suite, then querying `agent_execution_events` and `agent_run_llm_payloads` for any leftover test runIds — none should remain).
- **Suite-rerun idempotency.** Running the §1.3 suite twice in the same DB without manual reset produces identical results (the pre-test guard recovers from any poisoned prior state).
- The original `tasks/todo.md` REQ §1.1 Gap F is closeable upon merge.
- The tests fail noisily (NOT silently or via `.skip`) if any of the §1.1 acceptance criteria from the predecessor spec regress.

**Tests.** This entire item IS the test addition. The pre-existing pure-function tests for `shouldEmitLaelLifecycle` (40-case matrix) remain in place; they are NOT replaced.

**Dependencies.** §1.2 (fake-provider adapter). §1.5 (failure-path payload row decision) affects Test 1's assertion around `payloadRowId` — sequencing matters; see §2.

**Risk.** Medium. Real-DB integration tests have a flake risk if cleanup is incomplete. Mitigation: per-test unique `runId`, `try/finally` cleanup, and the 5-rerun acceptance criterion catches flakiness early.

**Definition of Done.** All three tests are real assertions (no `.skip`, no `assert.ok(true)`); pass on first run + 5 reruns; cleanup verified; `tasks/todo.md` REQ §1.1 Gap F entry annotated with this commit's SHA.

---

### §1.4 Convert `workflowEngineApprovalResumeDispatch.integration.test.ts` stubs to real assertions

**Source.** `tasks/todo.md § Deferred from spec-conformance review — pre-test-backend-hardening` → REQ §1.3 Gap C.

**Files.**
- `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts` (existing — 3 stubs to convert).
- Test-DB connection helper (read-only consume).
- `server/services/__tests__/fixtures/fakeWebhookReceiver.ts` (consumer — built in §1.1).

**Goal.** Replace the three `test.skip` stubs with assertions that exercise the real `decideApproval` → `dispatchInvokeAutomationInternal` code path against a real test DB, using the fake webhook receiver from §1.1. The third test (concurrent double-approve) MUST use the receiver's `callCount` for its assertion — this is the call-count contract the predecessor spec specifically demanded.

**Approach.**
1. **Test 1 — approve fires webhook + reaches `completed`.**
   - Setup: start a fake webhook receiver. Create a test-DB row chain: `workflow_runs` (status `running`), `workflow_step_runs` (status `awaiting_approval`, `step_kind = 'invoke_automation'`, `step_definition.automationId` pointing at a contrived `automations` row), `automations` (with `webhookPath = receiver.url + '/auto'`, `webhookSecret = 'test-secret'`).
   - Act: call `decideApproval({ stepRunId, decision: 'approved', actorUserId, ... })`.
   - Assert (in order):
     - `receiver.callCount === 1` AND the recorded call has `path === '/auto'`.
     - The HMAC header on the recorded request matches the expected signature for the request body + `webhookSecret`.
     - After dispatch settles, `workflow_step_runs.status === 'completed'` for the stepRunId.
     - The `agent_execution_events` (or workflow-run-events) timeline shows `dispatch_source: 'approval_resume'` on the dispatch-related event.
   - Cleanup: close receiver; delete test rows.
2. **Test 2 — concurrent double-approve fires webhook exactly once.**
   - Setup: same as Test 1.
   - Act: `await Promise.all([decideApproval(...args), decideApproval(...args)])` with the same args.
   - Assert (the contract this test specifically protects):
     - `receiver.callCount === 1` (NOT 2 — this is the load-bearing assertion at the HTTP layer).
     - **DB-side uniqueness assertion (load-bearing alongside callCount).** Exactly one row in the dispatch audit channel for this `stepRunId` with `dispatch_source = 'approval_resume'` — the field/table is whichever channel persists supervised-`invoke_automation` dispatches (locate during implementation; candidates are `agent_execution_events` with the dispatch event_type, or a `workflow_dispatch_log`-style table). The DB-side assertion is required because `receiver.callCount` alone can mask duplicate dispatch that gets retried/swallowed at the HTTP layer (a second dispatch attempt that fails on the receiver's idempotency could still indicate broken backend exactly-once semantics). If both assertions fail, the test fails — the two are not redundant; they protect different layers.
     - One of the two `decideApproval` calls returns the success result; the other returns the existing-decision result (idempotent replay path).
     - `workflow_step_runs.status === 'completed'` (single terminal state).
     - Exactly one corresponding row in the approval-decision audit table.
   - **No `pg_sleep` or timing-based assertions.** Race resolution is structural — the existing `awaiting_approval → running` UPDATE race in `workflowEngineService.ts:1752-1759` is what makes the second caller see "step is no longer awaiting_approval" and short-circuit. The test relies on that structural property, not on timing luck.
3. **Test 3 — reject completes without webhook.**
   - Setup: same as Test 1.
   - Act: `decideApproval({ ..., decision: 'rejected' })`.
   - Assert:
     - `receiver.callCount === 0`.
     - `workflow_step_runs.status === 'rejected'`.
     - The approval-decision audit row is `'rejected'`.
4. **Test isolation (per §0.2 DB isolation invariant).** Each test creates its own `workflow_run_id` and `step_run_id` via `crypto.randomUUID()`. Receiver instances are per-test (started in `beforeEach`, closed in `afterEach`). Because `decideApproval` commits its own tx, tests use scope variant (2): hard-scoping-key + pre-test cleanup guard.
   - **Pre-test guard.** Each test, in `beforeEach`, runs `assertNoRowsForRunId` (see §1.3 step 4a) against the §1.4-relevant tables (`workflow_step_runs`, `workflow_runs`, `automations`, plus the dispatch audit channel used in Test 2's DB-side assertion) — deletes any rows matching the test's scoping IDs before the test body runs.
   - **Cleanup.** `afterEach` runs the same delete pass and asserts zero rows for the IDs after delete.
   - Wrap setup + assertions in try/finally so cleanup runs even if assertions fail.
5. **DB harness reuse.** Same pattern as §1.3 — extend the existing test-DB harness if needed; do NOT introduce a new abstraction. The `assertNoRowsForRunId` helper from §1.3 step 4a is reused (with the §1.4 table set passed in).
6. **HMAC verification.** The expected HMAC formula lives in `server/lib/engineAuth.ts` (or wherever `buildEngineAuthHeaders` resides). The test re-computes the expected header from the same inputs and compares — does not duplicate the algorithm. **The HMAC assertion fails if the expected header is missing from the recorded request, NOT only if it mismatches** — a missing signature header is a regression class distinct from a wrong signature value, and the test must fail loudly on either. Implement as: assert header present (fail fast if absent), then assert header value matches expected.

**Acceptance criteria.**
- All three tests pass against a clean test DB on first run AND 5 reruns.
- Test 2 specifically asserts on `receiver.callCount === 1` AND on the DB-side uniqueness invariant (exactly one dispatch row with `dispatch_source = 'approval_resume'`) — failing either causes the test to fail noisily.
- Test 1's HMAC assertion fails if the signature header is missing AND if the value mismatches — a missing header is a distinct regression class.
- Cleanup leaves no test workflow rows in the DB after the suite runs.
- **Suite-rerun idempotency.** Running the §1.4 suite twice in the same DB without manual reset produces identical results.
- `tasks/todo.md` REQ §1.3 Gap C is closeable upon merge.

**Tests.** This entire item IS the test addition. The pre-existing pure-function tests for `resolveApprovalDispatchActionPure` remain in place.

**Dependencies.** §1.1 (fake-webhook receiver). §1.6 (`AutomationStepError` shape decision) does NOT block this item — these tests don't assert on the error shape, only on dispatch behaviour and terminal status.

**Risk.** Medium. Same flake-risk profile as §1.3. The Test 2 race condition is structural, but a slow CI environment could in theory hit a different ordering than dev. Mitigation: the 5-rerun acceptance criterion + the structural race resolution (UPDATE-then-conditional-branch, not sleep-based) keep the test deterministic.

**Definition of Done.** All three tests are real assertions; Test 2 explicitly asserts on `callCount`; pass on first run + 5 reruns; cleanup verified; `tasks/todo.md` REQ §1.3 Gap C entry annotated with this commit's SHA.

---

### §1.5 Decision — Failure-path `agent_run_llm_payloads` row (REQ §1.1 Gap D)

**Source.** `tasks/todo.md § Deferred from spec-conformance review — pre-test-backend-hardening` → REQ §1.1 Gap D. Code site: `server/services/llmRouter.ts:1265` ("No payload row on failure — no provider response to persist.").

**Files.**
- `server/services/llmRouter.ts` (the failure-path branch around line 1265).
- `server/services/agentRunPayloadWriter.ts` (existing — `buildPayloadRow`; verify it can accept a partial response).
- `server/services/__tests__/agentRunPayloadWriterFailurePathPure.test.ts` (NEW).
- `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md` (read + amend §1.1 acceptance criteria to match the chosen direction — the predecessor spec lives in-repo; this spec edits its acceptance text in the same PR).

**Goal.** Resolve the contradiction between the predecessor spec's §1.1 acceptance criterion ("A failed-mid-flight agent-run LLM call produces … the corresponding `agent_run_llm_payloads` row") and the implementation comment ("No payload row on failure — no provider response to persist"). Pick one direction, ship it, update the spec text. The decision MUST be made before §1.3 lands because Test 1 in §1.3 needs to know whether to assert "row exists" or "row absent" on failure paths (Test 1 is happy-path only, but a future failure-path test will assert this).

**Approach — pick ONE of the two directions.**

**Option A — Persist a failure-path partial row (matches predecessor spec).**
- `buildPayloadRow` already accepts a `response` parameter; extend the signature to accept `response: ProviderCallResult | null` and produce a row with `response: null`, `tokensIn: 0`, `tokensOut: 0`, `costWithMarginCents: 0`, `status: 'failed'` when null is passed.
- The failure path in `llmRouter.ts` builds and inserts the row in the same terminal-write tx as the ledger, mirroring the success path's tx structure. The post-commit invariant — "ledger row and payload row commit together OR roll back together" — extends to failure rows.
- Update the `llm.completed` event payload to set `payloadRowId` to the inserted row's id (currently `null` on failure).
- **Partial-response semantics.** The `response: null` shape applies ONLY when there is no usable provider output to persist. If the provider produced a structurally-valid partial response (e.g. streaming was interrupted mid-completion but the partial assistant message + partial token counts are present and parseable into the existing `ProviderCallResult` shape), the row MUST be persisted with the partial response, NOT null. Concretely:
  - **No usable output** (provider rejected before stream open, network error before any bytes, response un-parseable) → `response: null`, zero tokens, zero cost, `status: 'failed'`.
  - **Partial-but-structurally-valid output** (stream opened, partial assistant text accumulated, provider closed mid-flight) → `response: <partial ProviderCallResult>`, populated `tokensIn` (may be exact since input was fully sent) and `tokensOut` (whatever bytes streamed back), cost reflecting the partial usage, `status: 'failed'` (the call still failed at the boundary even though some output exists).
  - The decision of "structurally valid" is local to the provider adapter — adapters that already build a `ProviderCallResult` incrementally during streaming pass whatever they have at the failure boundary; adapters that build atomically pass null. The shape of the failure-path branch in `llmRouter.ts` is `buildPayloadRow(..., partialResultOrNull)` — `null` only when the adapter has no parseable output, never as a default-on-failure shortcut.
- Tests: extend §1.3 Test 1's matrix with a fourth case for the failure path; the predecessor's acceptance criterion now passes.
- **Pros.** Closes the spec-vs-impl gap. Failed LLM calls are inspectable in `agent_run_llm_payloads` for debugging during testing. Symmetric with success path, easier to reason about. Preserves partial-response observability for streaming-failure debugging.
- **Cons.** Adds a tx insert on every failure (small DB write cost). Changes the "no provider response" semantics — the `response` column on the failure row may be null OR a partial result, requiring readers to handle null (already true for new rows that haven't completed; not a new shape).

**Option B — Amend predecessor spec to make failure-path row optional.**
- Edit `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md` §1.1 Acceptance criteria to drop the "the corresponding `agent_run_llm_payloads` row" clause from the failed-mid-flight bullet. Replace with: "A failed-mid-flight agent-run LLM call (provider error) produces `llm.requested` → `llm.completed` (with `terminalStatus: 'failed'` in the payload). NO `agent_run_llm_payloads` row is inserted — the provider produced no response to persist."
- Keep `llmRouter.ts` failure-path comment; no production code change.
- Tests: §1.3's failure-path test (if added later) asserts "row absent".
- **Pros.** Zero new DB writes. Implementation as-is is minimal.
- **Cons.** Failure-path observability is lost. During testing, a tester investigating "why did this LLM call fail?" must reconstruct context from `llm_requests_all` + `agent_execution_events.llm.completed` payload rather than reading the persisted prompt + tool definitions.

**Decision criterion.** Pick **Option A** unless implementation surfaces a concrete blocker (e.g. `buildPayloadRow` cannot handle a null response without significant refactor — verify during implementation; if true, route the refactor to a sub-spec rather than ship Option B).

**Default for this spec:** Option A. The predecessor spec's acceptance criterion is the canonical contract; the implementation comment was a deferral, not a deliberate decision. Option A restores the contract.

**Acceptance criteria (Option A).**
- A failed `llmRouter.routeCall` for an agent run with **no usable provider output** inserts exactly one row in `agent_run_llm_payloads` with `run_id` matching, `response IS NULL`, `tokens_in = 0`, `tokens_out = 0`, `status = 'failed'`.
- A failed `llmRouter.routeCall` for an agent run with a **structurally-valid partial provider output** (e.g. streaming interrupted mid-completion) inserts exactly one row in `agent_run_llm_payloads` with `run_id` matching, `response` containing the partial `ProviderCallResult`, `tokens_in`/`tokens_out`/`cost_with_margin_cents` reflecting the partial usage, `status = 'failed'`.
- Partial responses MUST be persisted whenever they are structurally valid — the failure-path branch never discards parseable provider output.
- The `llm.completed` event for that call has `payloadRowId` non-null and equal to the inserted row's id (in BOTH the null-response and partial-response cases).
- Tx rollback (e.g. ledger-write fails after payload row insert succeeds) drops both rows together.
- A future §1.3 failure-path test (not in this spec's scope, but should be addable in a follow-up) can assert both shapes: "row exists with null response" (no-output case) and "row exists with partial response" (interrupted-streaming case).
- The predecessor spec's §1.1 acceptance criterion line is unchanged (it already says "the corresponding row" which Option A satisfies).

**Acceptance criteria (Option B, if chosen).**
- The predecessor spec's §1.1 §1.1 acceptance criterion is amended to explicitly say "no row".
- The `llm.completed` event payload still has `payloadRowId: null` and `payloadInsertStatus: 'failed'` (current behaviour).
- §1.3 Test 1's assertion on `payloadRowId !== null` only applies to the success case, not failure.

**Tests.**
- `server/services/__tests__/agentRunPayloadWriterFailurePathPure.test.ts` — pure tests for `buildPayloadRow`. (Option A only.) Cases:
  1. `response: null` → returns a row shape with `response: null`, zero tokens, zero cost, `status: 'failed'`.
  2. `response: <partial ProviderCallResult>` (with partial assistant text + non-zero `tokensOut`) → returns a row with `response: <same partial>`, populated tokens/cost matching the partial, `status: 'failed'`.
  3. Round-trip: a partial response passed in is byte-identical to the persisted `response` field (no silent truncation in the failure branch).
- The integration assertions for the failure-path flow are **not** built in this spec; they belong to a follow-up that adds a failure-path case to §1.3's test matrix. This spec's job is the decision and the production-code change.

**Dependencies.** None. This decision affects §1.3's test design (whether to add a failure-path case later) but does not gate §1.3's three documented tests, all of which are happy-path / pre-dispatch / non-agent-run.

**Risk.** Low for Option A — small additive change. Lower for Option B — only docs.

**Definition of Done.** Option chosen and recorded in this spec's §5 Tracking with rationale; if Option A: pure test green, production code change in `llmRouter.ts` and `agentRunPayloadWriter.ts`, predecessor spec acceptance text remains accurate; if Option B: predecessor spec text edited; `tasks/todo.md` REQ §1.1 Gap D entry annotated with this commit's SHA AND the chosen option.

---

### §1.6 Decision — `AutomationStepError` shape (REQ §1.2 Gap B)

**Source.** `tasks/todo.md § Deferred from spec-conformance review — pre-test-backend-hardening` → REQ §1.2 Gap B. Type definition: `server/lib/workflow/types.ts:79`. Predecessor spec section: `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md` §1.2 Approach step 2.

**Files.**
- `server/lib/workflow/types.ts` (`AutomationStepError` interface).
- `server/services/invokeAutomationStepService.ts` (the `automation_missing_connection` error construction site).
- All call sites that consume `AutomationStepError` (locate via grep — likely a small list: error-handler routing, log emitters, possibly the workflow tick switch).
- `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md` (predecessor spec §1.2 Approach step 2 — amend if Option B).
- `server/services/__tests__/invokeAutomationStepErrorShapePure.test.ts` (NEW — round-trip test for the chosen shape).

**Goal.** Resolve the divergence between the predecessor spec's §1.2 Approach step 2 (which specified an error shape with `type: 'configuration'`, `status: 'missing_connection'`, `context: { automationId, missingKeys }`) and the existing `AutomationStepError` type (which has `type: 'validation' | 'execution' | 'timeout' | 'external' | 'unknown'`, no `status` field, no `context` field). Pick one direction.

**Approach — pick ONE of the two directions.**

**Option A — Extend `AutomationStepError` to match the spec.**
- Add `'configuration'` to the `type` literal union.
- Add optional `status?: string` field. **Status values MUST be namespaced stable identifiers, treated as a closed vocabulary, NOT free-form text.** The vocabulary at this spec's landing time is `'missing_connection'` only; future entries (e.g. `'rate_limited'`, `'invalid_credentials'`, `'quota_exceeded'`) extend the vocabulary by being added to the JSDoc comment on the field AND to a `KNOWN_AUTOMATION_STEP_ERROR_STATUSES` `as const` tuple co-located with the type. Any code that constructs an `AutomationStepError` with a `status` value MUST pick from the known list — bare-string values are a regression class. The field stays typed `string` (rather than a literal union) at this point because tightening it now would force a refactor on every existing consumer; the discipline is enforced by convention + the `as const` list, with tightening to a literal union slated for the first follow-up that consolidates consumer handling.
- Add optional `context?: Record<string, unknown>` field for structured error data. The shape per `status` is documented in JSDoc — e.g. `status: 'missing_connection'` ⇒ `context: { automationId: string, missingKeys: string[] }`. Consumers that read `context` MUST narrow on `status` first.
- Update `invokeAutomationStepService.ts` to populate `type: 'configuration'`, `status: 'missing_connection'`, `context: { automationId, missingKeys }` on the missing-connection error path.
- Update every consumer (likely 3–5 call sites — locate via grep on `AutomationStepError`) to handle the new optional fields gracefully (most consumers will ignore them — unchanged behaviour for existing error codes).
- **Pros.** Closes the spec-vs-impl gap. Structured-context consumers (future log aggregators, error-classification dashboards) can read `error.context.missingKeys` programmatically. Symmetric with how other parts of the codebase carry structured error context. Namespaced status discipline keeps the field from drifting into free text.
- **Cons.** Type union widening is mildly intrusive — exhaustive-switch consumers (if any) need to handle the new variant. Mitigation: optional `context` and `status` mean most consumers don't change. Status discipline relies on convention until the literal-union tightening lands.

**Option B — Amend predecessor spec to match the existing type.**
- Edit the predecessor spec's §1.2 Approach step 2 to drop the `type: 'configuration'`, `status: 'missing_connection'`, `context: { automationId, missingKeys }` example. Replace with the actual shape: `type: 'execution'`, `code: 'automation_missing_connection'`, `message: \`Automation '${automation.id}' is missing required connections: ${missing.join(', ')}\``.
- Document the rationale: "the AutomationStepError type does not currently carry structured context; the missing keys are inlined into the message text. Future structured-context callers should grep the message format if needed."
- No production code change.
- **Pros.** Zero refactor.
- **Cons.** Loses programmatic access to `missingKeys` — anything that wants the structured field must regex-parse the message. Spec drifts further from "structured errors" as a posture.

**Decision criterion.** Pick **Option A** if the testing round (or any near-term work) needs to read missing connection keys programmatically — e.g. an admin UI panel "Connections needed" that lists the missing keys per failed dispatch. Pick **Option B** if no such consumer exists or is planned in the next 1–2 specs.

**Default for this spec:** Option A — small but productive type widening, aligns the codebase with the spec's intent. The optional-field shape keeps consumer impact minimal.

**Acceptance criteria (Option A).**
- `AutomationStepError.type` accepts `'configuration'` as a value.
- `AutomationStepError.status` and `.context` exist as optional fields.
- A `KNOWN_AUTOMATION_STEP_ERROR_STATUSES` `as const` tuple is co-located with the type definition; at landing time it contains `['missing_connection']`. JSDoc on the `status` field references this list as the source of valid values.
- `invokeAutomationStepService` `automation_missing_connection` path produces an error with `type: 'configuration'`, `status: 'missing_connection'`, `context.missingKeys: string[]`, `context.automationId: string`.
- All existing call sites that construct or consume `AutomationStepError` still type-check and behave identically for non-`'configuration'` errors.
- A pure test round-trips a constructed error and asserts the shape.
- A pure test asserts every `status` value used in production code at landing time is present in `KNOWN_AUTOMATION_STEP_ERROR_STATUSES` (catches future drift if a new caller invents a bare-string status).
- `tasks/todo.md` REQ §1.2 Gap B entry annotated with this commit's SHA AND chosen option.

**Acceptance criteria (Option B, if chosen).**
- Predecessor spec §1.2 Approach step 2 is edited to match the existing type.
- No production code change.
- `tasks/todo.md` REQ §1.2 Gap B entry annotated with the spec-edit commit AND chosen option.

**Tests.**
- `server/services/__tests__/invokeAutomationStepErrorShapePure.test.ts` (Option A) — pure tests:
  1. Construct an error via the missing-connection path; assert all four fields populated (`type`, `status`, `context.automationId`, `context.missingKeys`).
  2. Construct an error via an existing path (e.g. a contrived `'execution'` error); assert `status` and `context` are `undefined` (existing behaviour preserved).
  3. TypeScript compile-time check via a type-narrowing example: `if (err.type === 'configuration') { /* err.context is allowed */ }` compiles.
  4. **Status vocabulary discipline.** Assert that the `status` value produced by the missing-connection path is included in `KNOWN_AUTOMATION_STEP_ERROR_STATUSES`. This makes "someone added a new status without updating the list" a test failure rather than a silent drift.

**Dependencies.** None. This is independent of §1.1–§1.4.

**Risk.** Low for Option A. Type union widening is the only risk; mitigated by the optional-field shape.

**Definition of Done.** Option chosen and recorded in §5 Tracking with rationale; production code or spec text updated per the chosen option; pure test green (Option A); `tasks/todo.md` REQ §1.2 Gap B entry annotated with the commit SHA and chosen option.

---

## §2 Sequencing

The six items have an explicit dependency graph:

```
§1.1 fake-webhook ─────┐
                       ├──▶ §1.4 approval-resume tests
§1.2 fake-provider ────┐
                       ├──▶ §1.3 LAEL tests
§1.5 Gap D decision ───┘     (§1.5 affects which assertions §1.3 makes)

§1.6 Gap B decision  (independent)
```

Recommended order:

1. **§1.5 Gap D decision** — make the call FIRST. The decision affects what §1.3 asserts. Default: Option A (persist failure-path partial row). Document rationale in §5 Tracking.
2. **§1.6 Gap B decision** — independent of the others; can land in parallel or alongside §1.5. Default: Option A (extend `AutomationStepError`).
3. **§1.1 fake-webhook receiver harness** — new isolated test fixture; no blockers.
4. **§1.2 fake-provider adapter harness** — new isolated test fixture; no blockers. Can run in parallel with §1.1.
5. **§1.3 LAEL test conversion** — depends on §1.2 (fake-provider) AND §1.5 (Gap D decision shapes assertions).
6. **§1.4 approval-resume test conversion** — depends on §1.1 (fake-webhook) AND §1.5/§1.6 (decisions affect environment but not the documented test assertions; either-way safe).

**Branch.** Single feature branch (suggested name `claude/pre-test-integration-harness`). Each §1.x ships as its own commit. Final PR consolidates all six.

**Pre-merge gates.**
- `npx tsc --noEmit` passes (especially important for §1.6 Option A since it widens a type union).
- `bash scripts/run-all-unit-tests.sh` passes.
- The four new self-tests + integration-test suites pass on first run AND 5 reruns. **Fail-fast-on-first-flake.** A single failing run within the 5-rerun set is a gate failure — DO NOT average results, DO NOT retry the failing run individually, DO NOT mark "1 / 5 failed but the failure looked transient" as acceptable. Flake is a regression class; root-cause it before merge.
- **Suite-rerun idempotency.** Running the integration suite twice in the same DB without manual reset produces identical results — verified by running the suite once, then immediately running it a second time without DB reset; both runs must pass and leave the DB in the same final state.
- The two harness self-tests are part of `run-all-unit-tests.sh`.
- Test-DB cleanup verified: after the suite, `agent_execution_events`, `agent_run_llm_payloads`, `workflow_step_runs`, `workflow_runs`, `automations` (test-only rows), and `cost_aggregates` (test-only rows) carry no residual rows for the test runIds.
- `npm run test:gates` is the merge-gate per the gate-cadence rule in CLAUDE.md — run only at PR-finalisation time.

---

## §3 Out of scope

Items deliberately excluded from this spec:

- **Manual smoke recordings from the predecessor specs** (REQ S3-8, N7-11, S8-11, DR2-10). Housekeeping; tick at PR-prep time of each predecessor spec, not in this spec.
- **KNOWLEDGE.md entries** for the post-commit emit pattern, the fake-harness pattern, etc. Captured at session-finalize per the `chatgpt-pr-review` agent's pattern, not as a §1 item.
- **`tasks/todo.md` ticking for the predecessor specs' DR2/S8/N7/S3.** Same — paperwork, done at PR-prep.
- **PLAN-REVIEW-P4/P5/P7/P8** items (error banner state-type upgrade, runtime branching guard, middleware ordering tag, log prefix standardisation). Each is "blocked on follow-up spec" — none of them are testing-blocking.
- **REQ §1.1 Gap E (catch-path contested-key DELETE).** Already resolved per the todo.md update note: the INSERT was wrapped in `db.transaction` so any thrown error auto-rolls-back, eliminating the defensive DELETE. No follow-up needed.
- **REQ §1.7 Gap A (async-worker exclusion).** Already resolved in commit `7ebac102`.
- **N3 (promote `requireUuid` shared helper), N4 (fragile test refactor), S4 (decideApproval inflated newVersion).** All routed to "wait until trigger" or "future spec".
- **Migration 0240 phasing.** Only matters at scale; pre-launch posture defers it.
- **`cachedSystemMonitorAgentId` per-org cache.** Pre-existing; not testing-blocking.
- **Any code-intel-phase-0 follow-ups** (watcher race hardening, reseed scripts, build-code-graph split). Separate workstream; not bundled here.
- **Failure-path integration test for §1.3.** Covered by §1.5's decision but NOT by §1.3's three documented tests. A follow-up can add a fourth test ("failed agent-run LLM call inserts failure-path payload row") once §1.5 lands; out of scope for this spec.
- **Any new gate or CI script.** Per §0.3, no new gate added — `verify-no-test-imports.sh` (or equivalent) discipline is assumed to already exist.

Per §0.3, scope expansion during implementation is forbidden — log to `tasks/todo.md` and continue.

---

## §4 Definition of Done

The spec is complete when ALL of the following hold:

1. Each §1.x item's per-item Definition of Done is met.
2. The two stub test files contain zero `test.skip` calls and zero `assert.ok(true, 'TODO: …')` placeholders.
3. `tasks/todo.md` reflects every closed item (REQ §1.1 Gap D, REQ §1.1 Gap F, REQ §1.2 Gap B, REQ §1.3 Gap C, plus the harness backlog entry) with `[x]` marks and one-line resolution notes pointing at commit SHAs.
4. The branch passes the §2 pre-merge gates.
5. The PR description summarises the chosen options for §1.5 and §1.6, and links to the spec sections.
6. `tasks/builds/<slug>/progress.md` carries a session-end summary with the option choices recorded.
7. `KNOWLEDGE.md` is updated with the fake-harness pattern (it generalises beyond LAEL + approval-resume — any future integration test that exercises real DB transaction boundaries with a controllable external dependency benefits from the same pattern).

---

## §5 Tracking

Per-item status table — single source of truth. Update after each commit.

| Item | Status | Commit SHA | Decision (§1.5/§1.6 only) | Notes |
|------|--------|------------|----------------------------|-------|
| §1.1 fake-webhook receiver | pending | — | — | — |
| §1.2 fake-provider adapter | pending | — | — | — |
| §1.3 LAEL test conversion | pending | — | — | depends on §1.2, §1.5 |
| §1.4 approval-resume test conversion | pending | — | — | depends on §1.1 |
| §1.5 Gap D decision | pending | — | _to be recorded_ | default: Option A |
| §1.6 Gap B decision | pending | — | _to be recorded_ | default: Option A |

**Backlog tickoff checklist** — when each item closes, mark the corresponding line in `tasks/todo.md`:

- [ ] REQ §1.1 Gap D in `tasks/todo.md § Deferred from spec-conformance review — pre-test-backend-hardening (2026-04-28)`
- [ ] REQ §1.1 Gap F in same section
- [ ] REQ §1.2 Gap B in same section
- [ ] REQ §1.3 Gap C in same section
- [ ] "LAEL + approval-resume integration test harness" in `tasks/todo.md § Deferred from chatgpt-pr-review — pre-test-backend-hardening (2026-04-28)`

