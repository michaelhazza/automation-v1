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

**3. Use the lightweight assertion harness.**

No framework. No Jest. No Vitest. Just a small `test()`/`assert()` helper at the top of each test file and a summary at the bottom.

```ts
/**
 * Runnable via: npx tsx server/services/__tests__/runContextLoader.test.ts
 */

import { processContextPool } from '../runContextLoaderPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Tests go here
test('processes an empty pool', () => {
  const result = processContextPool([], { maxTokens: 1000 });
  assertEqual(result.eager.length, 0, 'no eager sources');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

**Canonical templates:** look at these two files for the exact pattern to match:
- `server/lib/playbook/__tests__/playbook.test.ts`
- `server/services/__tests__/runContextLoader.test.ts`

---

## Test discovery

`scripts/run-all-unit-tests.sh` discovers every `**/__tests__/*.test.ts` file under the repo (excluding `node_modules` and `dist`) and runs each one via `tsx`. A file is automatically included the moment it lands — no registration step.

To run a single test file during development:

```bash
npx tsx server/services/__tests__/runContextLoader.test.ts
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
