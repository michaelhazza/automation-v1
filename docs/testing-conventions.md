# Testing Conventions

This document codifies the testing posture and conventions for Automation OS. It is the canonical reference for anyone adding a test to this codebase.

**Context:** the platform is pre-production, features evolve rapidly, and the test investment is deliberately weighted toward static analysis over runtime tests. See `docs/testing-structure-Apr26.md` for the full phased testing strategy and the rationale behind this posture.

---

## Three layers of testing

Automation OS has exactly three testing layers. New tests go in the layer that matches their purpose — do not introduce new layers.

### 1. Static gates (`scripts/verify-*.sh`)

**Where:** `scripts/` (wired into `scripts/run-all-gates.sh`).

**When to add:** every major structural change gets a new `verify-*.sh` script that encodes the invariant as a grep-based check. Static gates catch structural drift without breaking when behaviour changes — they only break when someone violates the convention.

**Run via:** `npm run test:gates`.

**Examples:** `verify-async-handler.sh`, `verify-org-scoped-writes.sh`, `verify-no-db-in-routes.sh`, `verify-rls-coverage.sh`.

### 2. QA spec scripts (`scripts/run-*-tests.sh`)

**Where:** `scripts/run-all-qa-tests.sh`, `scripts/run-spec-v2-tests.sh`, `scripts/run-paperclip-features-tests.sh`.

**When to add:** when a spec is implemented and you want to assert that the expected files, schema fields, service functions, and migrations exist. QA scripts are check-lists in bash — they do not exercise code at runtime, they just verify structural presence.

**Run via:** `npm run test:qa`.

### 3. Runtime unit tests (`**/__tests__/*.test.ts`)

**Where:** a `__tests__/` directory next to the module being tested.

**When to add:** for pure-logic functions only — things that parse, normalise, transform, compare, or classify data. Do **not** unit-test services, routes, or middlewares — they change too often to be worth the maintenance burden in the current rapid-evolution phase.

**Run via:** `npm run test:unit`.

---

## The `*Pure.ts` + `*.test.ts` convention

This is the non-negotiable shape for runtime unit tests. Every `*.test.ts` file must have a sibling `*Pure.ts` module that it imports from. The gate script `verify-pure-helper-convention.sh` enforces this.

### Why

Runtime tests that depend on `db`, `env`, `services/*`, or any other impure module cannot run without a full database + environment setup. That makes them slow, flaky, and painful to maintain. Extracting pure logic into a sibling module lets the test import exactly what it needs and nothing else.

### The pattern

**1. Extract pure logic into a `*Pure.ts` file.**

```
server/services/runContextLoader.ts        <- impure (imports db, env, services)
server/services/runContextLoaderPure.ts    <- pure (zero db/env/service imports)
```

The pure module exports pure functions with no side effects, no I/O, and no environment access. It may import types from anywhere, but **it may not import runtime values from impure modules**. Types are erased at runtime, so type-only imports do not make the module impure.

**2. Write the test next to the pure module.**

```
server/services/__tests__/runContextLoader.test.ts
```

The test imports from the pure module only. It does not import from the impure module, does not set up a database, does not read environment variables.

**3. Use Vitest.**

The single permitted runner is **Vitest 2.x**. Import `test` and `expect` from `vitest`. No handwritten harness, no `node:test`, no `node:assert`.

```ts
import { test, expect } from 'vitest';
import { processContextPool } from '../runContextLoaderPure.js';

test('processes an empty pool', () => {
  const result = processContextPool([], { maxTokens: 1000 });
  expect(result.eager.length).toBe(0);
});
```

Run a single test file during development:

```bash
npx vitest run server/services/__tests__/runContextLoader.test.ts
```

**Forbidden patterns** — enforced by `scripts/verify-test-quality.sh`:
- `function asyncTest(...)` — handwritten harness
- `import test from 'node:test'` — node:test runner
- `import assert from 'node:assert'` — node:assert API (use `expect()` instead)
- `let passed = 0`, `let failed = 0`, `passed++`, `failed++` — counter boilerplate
- `pendingTests`, `Promise.all(pendingTests)` — module-load test queues
- `process.exit` / `process.exitCode` in test files — use `test.skip` / `test.skipIf` / `throw`
- `*.test.ts` outside `**/__tests__/**/` — Vitest's discovery glob will not pick it up
- A test file with zero `test()` / `describe()` / `it()` blocks — silently runs no tests

### Skip-gates (integration / DB-backed tests)

```ts
const SKIP = process.env.NODE_ENV !== 'integration';
describe.skipIf(SKIP)('DB-backed feature', () => {
  test('inserts a row', async () => {
    const { db } = await import('../../db/index.js');
    // ...
  });
});
```

Integration tests self-skip when `NODE_ENV=test` (the CI default). They only run when `NODE_ENV=integration`.

### Real-DB vs mocked-DB rule

Three test shapes exist for code that touches `db`. Pick the lightest shape that proves the thing you actually need to prove. Going heavier than necessary slows the suite; going lighter than necessary leaves the bug uncovered.

**Shape 1 — Pure (`*Pure.test.ts`).** No `db` involvement at all, neither real nor mocked. The pure helper takes plain values, returns plain values. This is the default and where the bulk of unit coverage lives. Canonical template: `server/services/__tests__/runContextLoader.test.ts`.

**Use when:** the logic under test parses, normalises, transforms, compares, or classifies values. The function never reaches for `db`. If your code currently calls `db` but the interesting logic is pure, extract a `*Pure.ts` sibling and test that — per the §"`*Pure.ts` + `*.test.ts` convention" rule.

**Shape 2 — Mocked-DB (`*.test.ts` with `vi.mock('../../db/index.js', …)`).** The `db` handle is replaced at module level with a hand-built chainable mock that returns canned rows. The service-under-test runs its real code, but every `.select().from().where()` chain resolves to whatever the test scripted. Canonical templates: `server/services/__tests__/credentialBrokerService.test.ts`, `server/services/__tests__/userOwnedAgentCredentialIsolation.test.ts`.

**Use when:** the unit being tested is a *thin orchestrator over db* — it builds a query, calls db, then does light post-processing (auth-check, error mapping, scope assertion). The correctness concern is "does the service pass the right scoping fields", "does it throw the right typed error", "does it map the row shape correctly". A mocked-db test answers those without needing a real schema.

**Do NOT use when:** the concern is whether the SQL is correct, whether RLS policies fire, whether a constraint catches a bad write, whether a transaction rolls back, whether a UNIQUE WHERE-clause partial index actually deduplicates. Mocks always say what you scripted; they cannot catch a malformed query or a missing policy.

**Shape 3 — Real-DB integration (`*.integration.test.ts`).** Live Postgres, real schema, real RLS. Gated on `process.env.NODE_ENV === 'integration'` so it skips by default and only runs in the CI integration job (or a developer running `NODE_ENV=integration npx vitest run …` locally). Dynamic-imports `db` and schema modules INSIDE the test body or `beforeAll`, so the import chain never fires during normal unit runs. Canonical templates: `server/services/__tests__/ghlOAuthStateStore.integration.test.ts`, `server/routes/__tests__/briefsArtefactsPagination.integration.test.ts`.

**Use when:** you need to verify *DB behaviour itself*, not service logic. Examples that require real-DB:
- RLS policy fires under a non-superuser role (`verify-rls-coverage.sh` partner — see TI-008).
- A `UNIQUE … WHERE` partial index actually deduplicates the rows it claims to.
- A row-level constraint (`CHECK`, `EXCLUDE`, foreign-key cascade) catches the case you think it does.
- Cursor pagination matches the unpaginated total across concurrent inserts.
- A nonce-consume is single-use across concurrent callers.

The integration test pays a real cost — schema setup, Postgres roundtrips, isolation between test orgs via `CANONICAL_ORG_ID` etc. — so reserve it for assertions a mock cannot make.

**Decision table:**

| Concern | Shape |
|---|---|
| Pure transformation, parsing, comparison | Pure |
| Service builds a query and post-processes its result | Mocked-DB |
| Service maps DB errors to typed application errors | Mocked-DB |
| Service emits the correct log / audit events on success | Mocked-DB |
| RLS / row-level policy enforcement | Real-DB |
| Partial-index / `UNIQUE WHERE` dedupe behaviour | Real-DB |
| Concurrent-write correctness (`ON CONFLICT`, advisory locks, nonces) | Real-DB |
| Migration-time backfill correctness | Real-DB |
| Cursor pagination across concurrent inserts | Real-DB |

When in doubt, start with the pure shape, then escalate only when you find yourself stubbing schema details rather than business logic.

### Module-load side effects (I-7b)

Test files MUST NOT mutate shared state at import time. No top-level registry registration, no top-level singleton init, no top-level network setup. Setup belongs in `beforeAll` / `beforeEach` or inside the `test()` body.

### Env mutation (I-8b)

Tests that mutate `process.env` MUST restore it:

```ts
let envSnapshot: typeof process.env;
beforeEach(() => { envSnapshot = { ...process.env }; });
afterEach(() => { process.env = envSnapshot; });
```

---

## Test discovery

Vitest discovers every `**/__tests__/*.test.ts` file automatically (per `vitest.config.ts`). A file is included the moment it lands — no registration step. The discovery glob is the only allowed location: `verify-test-quality.sh` rejects any `*.test.ts` outside `**/__tests__/**/`.

To run a single test file during development:

```bash
npx vitest run server/services/__tests__/runContextLoader.test.ts
```

To run the whole unit layer:

```bash
npm run test:unit
```

To run everything (gates + qa + unit):

```bash
npm test
```

---

## Things explicitly NOT in scope for the current phase

The following test categories are deliberately excluded from this phase of the project. Do not add them without a conscious phase transition (documented in `docs/testing-structure-Apr26.md`).

- Frontend unit tests (no Vitest, no Jest, no React Testing Library for `client/`)
- API contract tests (no supertest-style route exercise)
- End-to-end tests of the Automation OS app itself (Playwright is installed as a runtime dependency for the IEE browser worker and the `run_playwright_test` agent skill — not for testing our own UI)
- Performance baselines
- Load / stress tests
- Visual regression tests
- Migration safety tests (no data to migrate — dev environment)
- Composition / middleware interaction tests beyond the three carved-out integration tests in the improvements roadmap

The one runtime integration test that **is** in scope is the single smoke test at `server/services/__tests__/agentExecution.smoke.test.ts`, plus the three carved-out integration tests listed in `docs/improvements-roadmap-spec.md`:

- `rls.context-propagation.test.ts` (Sprint 2, P1.1)
- `agentRun.crash-resume-parity.test.ts` (Sprint 3, P2.1)
- `playbookBulk.parent-child-idempotency.test.ts` (Sprint 4, P3.1)

These are exceptions to the "no integration tests" rule because they cover hot-path behavioural changes where silent correctness bugs are the failure mode and static gates alone are insufficient.

---

## Adding a new test — checklist

Before pushing a new `*.test.ts` file:

- [ ] Is the logic being tested genuinely pure? If it touches `db`, `env`, or any impure module, extract the pure logic into a `*Pure.ts` sibling first.
- [ ] Does the test file live in a `__tests__/` directory next to the pure module?
- [ ] Does the test import from the pure module only (not from the impure counterpart)?
- [ ] Does the test use the lightweight `test()`/`assert()` pattern (no framework imports)?
- [ ] Does the file end with `process.exit(1)` on failure so `run-all-unit-tests.sh` picks up the exit code?
- [ ] Does `npm run test:unit` discover and run the new file without manual registration?
- [ ] Does `verify-pure-helper-convention.sh` pass?

If all of the above are true, the test is ready.

---

## References

- `docs/testing-structure-Apr26.md` — full phased testing strategy (rapid evolution vs stabilisation)
- `docs/improvements-roadmap-spec.md` — per-item test plans for every Sprint 1–5 feature
- `server/lib/playbook/__tests__/playbook.test.ts` — canonical template (predates this doc)
- `server/services/__tests__/runContextLoader.test.ts` — canonical template (predates this doc)
